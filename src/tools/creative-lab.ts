/**
 * Creative Lab tool — one tool that turns a photo (or text prompt) into a finished
 * physical-product 3D model, end-to-end.
 *
 * The Meshy API has two stages — prototype (concept image, 6cr) then build (textured
 * 3D model, 30cr) — linked by input_task_id. This tool runs BOTH internally, hides the
 * intermediate concept image, and returns only the final 3D product (total 36 credits).
 *
 * Products (OpenAPI): figure, lamp, keychain, fridge-magnet.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { resolveImageSource } from "../services/file-utils.js";
import { CreativeLabInputSchema } from "../schemas/creative-lab.js";
import {
  ResponseFormat,
  TaskStatus,
  CreativeLabProduct,
  creativeLabCredits,
  CREATIVE_LAB_KEYCAP_PROTOTYPE_CREDITS,
  POLL_INITIAL_DELAY,
  POLL_MAX_DELAY,
  POLL_BACKOFF_FACTOR,
  POLL_FINALIZATION_DELAY
} from "../constants.js";
import {
  CreateTaskApiResponse,
  CreativeLabPrototypeApiRequest,
  CreativeLabBuildApiRequest,
  GetTaskResponse
} from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Text progress bar (no trailing % — the MCP client appends the percentage itself). */
function progressBar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

/**
 * Poll a Creative Lab stage (prototype or build) until terminal or timeout.
 * Returns the last task object seen (caller checks status).
 */
async function pollStage(
  client: MeshyClient,
  basePath: string,
  taskId: string,
  timeoutMs: number,
  onPoll: (status: string, progress: number) => void
): Promise<GetTaskResponse> {
  const start = Date.now();
  let delay = POLL_INITIAL_DELAY;
  let task = await client.get<GetTaskResponse>(`${basePath}/${taskId}`);
  while (true) {
    const progress = task.progress || 0;
    onPoll(task.status, progress);
    if (
      task.status === TaskStatus.SUCCEEDED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELED
    ) {
      return task;
    }
    const wait = progress >= 95 ? POLL_FINALIZATION_DELAY : delay;
    if (Date.now() - start + wait > timeoutMs) {
      return task; // timed out — return last (non-terminal) state
    }
    await sleep(wait);
    if (progress < 95) {
      delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY);
    }
    task = await client.get<GetTaskResponse>(`${basePath}/${taskId}`);
  }
}

/**
 * Register the Creative Lab tool with the MCP server
 */
export function registerCreativeLabTools(server: McpServer, client: MeshyClient) {
  server.registerTool(
    "meshy_creative_lab",
    {
      title: "Creative Lab — Make a Product (end-to-end)",
      description: `Turn a source photo (or text prompt) into a finished Creative Lab product 3D model.

Products and cost:
  - "figure" (chibi collectible), "lamp" (3D-printable lampshade), "keychain", "fridge-magnet",
    "vinyl-figure" (vinyl-toy style), "brick-figure" (brick-minifigure style) → 36 credits (6 + 30)
  - "keycap" (Cherry MX 1u keycap) → 62 credits (12 + 50)

This runs the full two-stage Meshy pipeline internally — concept prototype then 3D build — and returns ONLY the final 3D model. The intermediate concept image is internal and is never surfaced. One call does everything; it blocks while both stages run (typically 2–5 minutes) and reports progress.

IMPORTANT: confirm the credit cost with the user before calling — and note keycap costs 62, not 36.

INPUT — provide ONE source:
  - Local image → file_path: "/absolute/path/photo.jpg" (.jpg/.jpeg/.png/.webp)
  - Remote image → image_url: "https://example.com/photo.jpg" (or data URI)
  - Text prompt → text: "..."  (ONLY "lamp" accepts text; every other product is image-only)

Args:
  - product (enum, REQUIRED): "figure" | "lamp" | "keychain" | "fridge-magnet" | "vinyl-figure" | "brick-figure" | "keycap"
  - image_url / file_path (string, optional): image source
  - text (string, optional): text prompt instead of an image (lamp only; ≤800 chars)
  - image_subject (enum, optional): "character" | "landscape" — lamp only
  - head_size_mm (number, optional): keycap only — head longest edge in mm (10–40, default 23)
  - base_model (string, optional): keycap only — "cherry-mx-1x1-r1" (the only profile today)
  - name (string, optional): display name (≤100 chars)
  - timeout_seconds (number): max wait per stage (default 300, max 600)
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns: the final build task_id + available model formats (GLB / OBJ+MTL). Then use meshy_download_model with task_type "creative-lab-{product}-build" to save the model.

To multicolor-print the result: a Creative Lab model can only be sent to meshy_process_multicolor as model_url — pass its build GLB URL, or a data URI of the downloaded GLB.

Examples:
  - { product: "figure", file_path: "/Users/me/portrait.jpg" }
  - { product: "lamp", text: "a stylized owl on a branch under moonlight" }
  - { product: "keycap", file_path: "/Users/me/cat.jpg", head_size_mm: 25 }

If the prototype stage fails, the build is NOT started (only the prototype is charged).`,
      inputSchema: CreativeLabInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof CreativeLabInputSchema>, extra) => {
      try {
        const hasImage = Boolean(params.image_url || params.file_path);
        if (!hasImage && !params.text) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error: provide one input source — image_url, file_path, or text." }]
          };
        }

        const product = params.product;

        // Lamp is the only product whose prototype accepts a text prompt; the
        // rest require image_url and 400 without it.
        if (params.text && !hasImage && product !== CreativeLabProduct.LAMP) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: the "${product}" product is image-only — provide image_url or file_path. Only "lamp" accepts a text prompt.`
            }]
          };
        }

        const credits = creativeLabCredits(product);
        const protoBase = `/openapi/creative-lab/${product}/v1/prototype`;
        const buildBase = `/openapi/creative-lab/${product}/v1/build`;
        const timeoutMs = params.timeout_seconds * 1000;

        // Progress relay — reports a single combined 0–100% bar; the prototype/build split
        // is internal and not surfaced. (prototype maps to 0–30%, build to 30–100%.)
        const notify = (stage: "prototype" | "build", _status: string, progress: number) => {
          const overall = stage === "prototype"
            ? Math.round(progress * 0.3)
            : 30 + Math.round(progress * 0.7);
          try {
            server.sendLoggingMessage({
              level: "info",
              data: `Creating your ${product} ${progressBar(overall)}`
            });
          } catch {
            // logging not critical
          }
          if (extra?._meta?.progressToken !== undefined) {
            server.server.notification({
              method: "notifications/progress",
              params: {
                progressToken: extra._meta.progressToken,
                progress: overall,
                total: 100,
                // No literal % here — the MCP client appends the percentage itself.
                message: `Creating your ${product} ${progressBar(overall)}`
              }
            }).catch(() => {});
          }
        };

        // ── Stage 1: prototype ──────────────────────────────────────────
        const protoReq: CreativeLabPrototypeApiRequest = {};
        if (params.text && !hasImage) {
          protoReq.text = params.text;
        } else {
          protoReq.image_url = await resolveImageSource(params.image_url, params.file_path);
          if (params.image_subject) protoReq.image_subject = params.image_subject;
        }
        if (params.name) protoReq.name = params.name;

        const protoResp = await client.post<CreateTaskApiResponse>(
          protoBase,
          protoReq as unknown as Record<string, unknown>
        );
        const protoId = protoResp.result;
        const proto = await pollStage(client, protoBase, protoId, timeoutMs, (s, p) => notify("prototype", s, p));

        if (proto.status !== TaskStatus.SUCCEEDED) {
          const reason = proto.status === TaskStatus.FAILED
            ? `failed: ${proto.task_error?.message || "unknown error"}`
            : `did not finish in ${params.timeout_seconds}s (status ${proto.status})`;
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: Creative Lab ${product} prototype ${reason}. The build stage was NOT started, so only the ${credits.prototype}-credit prototype was charged. Prototype task_id: ${protoId}.`
            }]
          };
        }

        // ── Stage 2: build ──────────────────────────────────────────────
        const buildReq: CreativeLabBuildApiRequest = { input_task_id: protoId };
        if (params.name) buildReq.name = params.name;

        // Keycap is the one product whose build is not input_task_id-only: it
        // requires candidate_id, picked from the candidate_ids the prototype
        // returns, and accepts an options object. Every other product 400s on
        // these fields, so they are keycap-scoped.
        if (product === CreativeLabProduct.KEYCAP) {
          const candidateId = (proto as unknown as { candidate_ids?: string[] }).candidate_ids?.[0];
          if (!candidateId) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `Error: the keycap prototype (task_id ${protoId}) succeeded but returned no candidate_ids, so the build cannot be started. Only the ${CREATIVE_LAB_KEYCAP_PROTOTYPE_CREDITS}-credit prototype was charged.`
              }]
            };
          }
          buildReq.candidate_id = candidateId;
          const options: { base_model?: string; head_size_mm?: number } = {};
          if (params.base_model) options.base_model = params.base_model;
          if (params.head_size_mm !== undefined) options.head_size_mm = params.head_size_mm;
          if (Object.keys(options).length > 0) buildReq.options = options;
        }

        const buildResp = await client.post<CreateTaskApiResponse>(
          buildBase,
          buildReq as unknown as Record<string, unknown>
        );
        const buildId = buildResp.result;
        const build = await pollStage(client, buildBase, buildId, timeoutMs, (s, p) => notify("build", s, p));

        if (build.status !== TaskStatus.SUCCEEDED) {
          const reason = build.status === TaskStatus.FAILED
            ? `failed: ${build.task_error?.message || "unknown error"}`
            : `did not finish in ${params.timeout_seconds}s (status ${build.status})`;
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: Creative Lab ${product} build ${reason}. Build task_id: ${buildId} (task_type "creative-lab-${product}-build" — you can poll it with meshy_get_task_status).`
            }]
          };
        }

        const formats = build.model_urls
          ? Object.keys(build.model_urls).filter(k => build.model_urls![k as keyof typeof build.model_urls])
          : [];
        const totalCredits = (proto.consumed_credits || 0) + (build.consumed_credits || 0);

        const output = {
          task_id: buildId,
          status: "SUCCEEDED",
          product,
          model_urls: build.model_urls,
          formats,
          consumed_credits: totalCredits,
          prototype_task_id: protoId
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Creative Lab ${product} — Done

**Build Task ID**: ${buildId}
**Available Formats**: ${formats.join(", ").toUpperCase() || "none"}
**Credits Consumed**: ${totalCredits} (prototype + build)

The final 3D ${product} is ready. Download it with \`meshy_download_model\` (task_id "${buildId}", task_type "creative-lab-${product}-build").`;
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_creative_lab" }) }]
        };
      }
    }
  );
}
