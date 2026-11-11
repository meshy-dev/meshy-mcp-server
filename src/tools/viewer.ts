/**
 * 3D viewer (meshy_view_model): an MCP App that shows a model inside hosts
 * that render MCP Apps (SEP-1865), such as Cursor, Claude and VS Code.
 *
 * The viewer page never fetches Meshy's asset URLs itself: the asset host does
 * not allow cross-origin reads from an app frame. The server loads the GLB and
 * the page reads it back as base64 resource chunks. Chunks stay small because
 * some MCP clients drop the whole connection on one oversized message (the
 * TypeScript SDK's stdio client stops at 10 MB).
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient, getTaskWithAutoInference } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { RequestValidationError } from "../utils/generation-options.js";
import { ViewLocalModelInputSchema, ViewModelInputSchema } from "../schemas/viewer.js";
import { TaskStatus, TaskType } from "../constants.js";
import { Task } from "../types.js";

export const VIEWER_URI = "ui://meshy/model-viewer.html";
export const UI_MIME_TYPE = "text/html;profile=mcp-app";
const UI_EXTENSION = "io.modelcontextprotocol/ui";

/** Raw bytes per resource chunk (base64 makes each message about 2.7 MB). */
export const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_BYTES = 200 * 1024 * 1024;
/** Models kept for their viewers: the newest few, within a memory budget and an hour. */
export const MAX_KEPT_MODELS = 4;
const MAX_KEPT_BYTES = 256 * 1024 * 1024;
const KEEP_MS = 60 * 60 * 1000;
/** Model loads at once; each can hold up to MAX_MODEL_BYTES while it downloads. */
const MAX_LOADING = 2;

interface KeptModel {
  id: string;
  /** What was opened: the same task or unchanged file reuses the kept copy. */
  key: string;
  name: string;
  bytes: Buffer;
  source: { task_id: string; task_type: TaskType } | { file_path: string };
  usedAt: number;
}

const kept = new Map<string, KeptModel>();
let loading = 0;

/** Drop expired models, then the oldest until the count and byte budgets hold. */
function evict(now = Date.now()): void {
  for (const [id, model] of kept) if (now - model.usedAt > KEEP_MS) kept.delete(id);
  let total = 0;
  for (const model of kept.values()) total += model.bytes.length;
  for (const [id, model] of kept) {
    if (kept.size <= 1 || (kept.size <= MAX_KEPT_MODELS && total <= MAX_KEPT_BYTES)) break;
    kept.delete(id);
    total -= model.bytes.length;
  }
}

/** A kept model, marked as just used (Map order is least recently used first). */
function touch(model: KeptModel): KeptModel {
  model.usedAt = Date.now();
  kept.delete(model.id);
  kept.set(model.id, model);
  return model;
}

function findKept(key: string): KeptModel | undefined {
  evict();
  for (const model of kept.values()) if (model.key === key) return touch(model);
  return undefined;
}

function isGlb(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2;
}

const MB = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/** The task's GLB: rigged or animated output first, then the model itself, then any GLB part. */
function glbUrl(task: Task, taskType: TaskType): string | undefined {
  if (taskType === TaskType.RIGGING && task.result?.rigged_character_glb_url) return task.result.rigged_character_glb_url;
  if (taskType === TaskType.ANIMATION && task.result?.animation_glb_url) return task.result.animation_glb_url;
  if (task.model_urls?.glb) return task.model_urls.glb;
  return Object.values(task.model_urls ?? {}).find(
    (url): url is string => typeof url === "string" && /\.glb(\?|$)/i.test(url)
  );
}

async function downloadGlb(url: string, taskId: string): Promise<Buffer> {
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: MAX_MODEL_BYTES,
    });
    return Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  } catch (error) {
    if (!axios.isAxiosError(error)) throw error;
    const status = error.response?.status;
    if (status === 403 || status === 404 || status === 410) {
      throw new RequestValidationError(
        `The GLB of task ${taskId} is no longer available (HTTP ${status}). Meshy keeps task files for 3 days; show a downloaded copy with file_path instead.`
      );
    }
    if (/maxContentLength/i.test(error.message)) {
      throw new RequestValidationError(`The GLB of task ${taskId} is over ${MB(MAX_MODEL_BYTES)}, too large for the viewer.`);
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      throw new RequestValidationError(`Downloading the GLB of task ${taskId} timed out. Try again.`);
    }
    throw new RequestValidationError(
      `Could not download the GLB of task ${taskId}${status ? ` (HTTP ${status})` : `: ${error.message}`}.`
    );
  }
}

async function openTaskModel(client: MeshyClient, taskId: string, taskTypeHint?: TaskType): Promise<KeptModel> {
  const key = `task:${taskId}`;
  const known = findKept(key);
  if (known) return known;

  const { task, taskType } = await getTaskWithAutoInference(client, taskId, taskTypeHint);
  if (task.status !== TaskStatus.SUCCEEDED) {
    throw new RequestValidationError(`Task ${taskId} is ${task.status}, not finished. Wait for it with meshy_get_task_status.`);
  }
  const url = glbUrl(task, taskType);
  if (!url) {
    const formats = Object.keys(task.model_urls ?? {}).join(", ") || "none";
    throw new RequestValidationError(`Task ${taskId} has no GLB to show (formats: ${formats}). The viewer shows GLB only.`);
  }
  const bytes = await downloadGlb(url, taskId);
  const name = task.name || task.prompt || taskId;
  if (!isGlb(bytes)) throw new RequestValidationError(`${name} is not a binary glTF (.glb) file; the viewer shows GLB only.`);
  return { id: randomUUID(), key, name, bytes, source: { task_id: taskId, task_type: taskType }, usedAt: Date.now() };
}

function openFileModel(filePath: string, canUseTaskId: boolean): KeptModel {
  if (!path.isAbsolute(filePath)) throw new RequestValidationError(`file_path must be absolute: ${filePath}`);
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new RequestValidationError(`File not found: ${filePath}`);
    if (code === "EISDIR") throw new RequestValidationError(`Not a file: ${filePath}`);
    // macOS answers EPERM when the client lacks access to a protected folder (Documents, Desktop, Downloads).
    throw new RequestValidationError(
      `Cannot read ${filePath} (${code ?? "error"}). If it is in a protected folder such as Documents, the app running this server needs access to it${canUseTaskId ? ", or show the model by task_id" : ""}.`
    );
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new RequestValidationError(`Not a file: ${filePath}`);
    // Check the GLB header before reading the rest, so other files are never read whole.
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    if (!isGlb(header)) throw new RequestValidationError(`${path.basename(filePath)} is not a binary glTF (.glb) file; the viewer shows GLB only.`);
    if (stat.size > MAX_MODEL_BYTES) {
      throw new RequestValidationError(`${filePath} is ${MB(stat.size)}; the viewer takes up to ${MB(MAX_MODEL_BYTES)}.`);
    }
    const key = `file:${filePath}:${stat.size}:${stat.mtimeMs}`;
    const known = findKept(key);
    if (known) return known;
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const n = fs.readSync(fd, bytes, read, stat.size - read, read);
      if (n === 0) break;
      read += n;
    }
    return { id: randomUUID(), key, name: path.basename(filePath), bytes: bytes.subarray(0, read), source: { file_path: filePath }, usedAt: Date.now() };
  } finally {
    fs.closeSync(fd);
  }
}

let viewerHtml: string | undefined;

/** The built viewer page: dist/viewer/model-viewer.html next to dist/tools/. */
function readViewerHtml(): string {
  if (viewerHtml) return viewerHtml;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "../viewer/model-viewer.html"), path.join(here, "../../dist/viewer/model-viewer.html")]) {
    if (fs.existsSync(candidate)) return (viewerHtml = fs.readFileSync(candidate, "utf8"));
  }
  throw new Error("The 3D viewer page is missing; build the server with `npm run build`.");
}

/**
 * Whether the connected client said it renders MCP Apps; undefined when that
 * is unknowable (the stateless HTTP transport serves every caller at once).
 */
function clientShowsApps(server: McpServer): boolean | undefined {
  if (process.env.TRANSPORT === "http") return undefined;
  const capabilities = server.server.getClientCapabilities() as
    | { extensions?: Record<string, { mimeTypes?: string[] } | undefined> }
    | undefined;
  if (!capabilities) return undefined;
  const ui = capabilities.extensions?.[UI_EXTENSION];
  return Boolean(ui && (!ui.mimeTypes || ui.mimeTypes.includes(UI_MIME_TYPE)));
}

/**
 * Register the 3D viewer tool and the resources its page reads.
 *
 * Without `client` the tool is local only (MESHY_TOOLS=viewer): it takes
 * file_path alone, never calls the Meshy API, and names no other Meshy tool.
 */
export function registerViewerTools(server: McpServer, client?: MeshyClient) {
  server.registerTool(
    "meshy_view_model",
    {
      title: "View Model in 3D",
      description: client
        ? `Show a finished model in an interactive 3D viewer in the conversation, where the user can rotate and zoom it. Works in hosts that display MCP Apps; free, saves nothing.

Pass task_id (the server fetches the task's GLB: the model, a rigged character or an animation) or file_path (a local .glb, e.g. from meshy_download_model). GLB only.`
        : `Show a local .glb model in an interactive 3D viewer in the conversation, where the user can rotate and zoom it. Works in hosts that display MCP Apps; free, saves nothing.

Pass file_path, the absolute path of the .glb file. GLB only.`,
      // One handler serves both schemas: what the local one parses is a subset of the full one.
      inputSchema: (client ? ViewModelInputSchema : ViewLocalModelInputSchema) as typeof ViewModelInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: Boolean(client)
      },
      _meta: { ui: { resourceUri: VIEWER_URI }, "ui/resourceUri": VIEWER_URI }
    },
    async (params: z.infer<typeof ViewModelInputSchema>) => {
      try {
        if (client && Boolean(params.task_id) === Boolean(params.file_path)) {
          throw new RequestValidationError("Pass exactly one of task_id or file_path.");
        }
        if (params.file_path && process.env.TRANSPORT === "http") {
          throw new RequestValidationError("file_path works only when the server runs locally (stdio). Pass task_id instead.");
        }
        if (clientShowsApps(server) === false) {
          return {
            content: [{
              type: "text",
              text: `This client did not report support for MCP Apps, so it cannot show the 3D viewer; nothing was loaded. ${client ? "Save the model with meshy_download_model and open it" : "Open the file"} in a 3D app instead.`
            }]
          };
        }
        if (loading >= MAX_LOADING) {
          throw new RequestValidationError("Other models are still loading for the viewer; try again in a moment.");
        }

        loading++;
        let model: KeptModel;
        try {
          model = client && params.task_id
            ? await openTaskModel(client, params.task_id, params.task_type)
            : openFileModel(params.file_path!, Boolean(client));
        } finally {
          loading--;
        }
        touch(model);
        evict();

        const view = {
          id: model.id,
          name: model.name,
          bytes: model.bytes.length,
          chunks: Math.ceil(model.bytes.length / CHUNK_BYTES),
          chunk_bytes: CHUNK_BYTES,
          ...model.source
        };
        const saved = params.task_id ? " Nothing was saved: meshy_download_model saves the file." : "";
        return {
          content: [{
            type: "text",
            text: `Showing "${view.name}" (${MB(view.bytes)} GLB) in the interactive 3D viewer; the user can drag to rotate and scroll to zoom.${saved}`
          }],
          structuredContent: { model: view }
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_view_model" }) }]
        };
      }
    }
  );

  server.registerResource(
    "model-viewer",
    VIEWER_URI,
    {
      title: "Meshy 3D viewer",
      description: "Interactive viewer page for meshy_view_model (MCP App).",
      mimeType: UI_MIME_TYPE
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: UI_MIME_TYPE,
        text: readViewerHtml(),
        _meta: { ui: { prefersBorder: true } }
      }]
    })
  );

  server.registerResource(
    "model-chunk",
    new ResourceTemplate("meshy-model://{id}/{chunk}", { list: undefined }),
    {
      title: "Model data for the 3D viewer",
      description: "One base64 chunk of a model opened with meshy_view_model.",
      mimeType: "application/octet-stream"
    },
    async (uri, variables) => {
      evict();
      const model = kept.get(String(variables.id));
      if (!model) throw new Error("This model is no longer open; call meshy_view_model again.");
      touch(model);
      const chunk = Number(variables.chunk);
      const chunks = Math.ceil(model.bytes.length / CHUNK_BYTES);
      if (!Number.isInteger(chunk) || chunk < 0 || chunk >= chunks) {
        throw new Error(`Chunk ${variables.chunk} is out of range (0-${chunks - 1}).`);
      }
      const slice = model.bytes.subarray(chunk * CHUNK_BYTES, (chunk + 1) * CHUNK_BYTES);
      return {
        contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: slice.toString("base64") }]
      };
    }
  );
}
