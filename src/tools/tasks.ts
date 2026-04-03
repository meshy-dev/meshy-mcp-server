/**
 * Task management tools (get status with wait mode, list, cancel, download)
 */

import { z } from "zod";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient, getTaskWithAutoInference } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  GetTaskStatusInputSchema,
  ListTasksInputSchema,
  CancelTaskInputSchema,
  DownloadModelInputSchema
} from "../schemas/tasks.js";
import { TaskStatusOutputSchema } from "../schemas/output.js";
import {
  ResponseFormat,
  TaskStatus,
  TaskType,
  CHARACTER_LIMIT,
  POLL_INITIAL_DELAY,
  POLL_MAX_DELAY,
  POLL_BACKOFF_FACTOR,
  POLL_FINALIZATION_DELAY
} from "../constants.js";
import { Task, GetTaskResponse, TextureUrlsObject } from "../types.js";
import { getTaskEndpoint, LIST_CAPABLE_TASK_TYPES } from "../utils/endpoints.js";
import {
  resolveProjectDir,
  getFilePath,
  getTextureFilePath,
  inferStage,
  recordTask,
  saveThumbnail,
  getOutputRootPath,
  TaskRecord
} from "../services/output-manager.js";

/**
 * Download a file from URL to local path using streaming.
 * Returns file size in bytes.
 */
/**
 * Fix OBJ file for 3D printing: Y-up → Z-up rotation, scale, center, bottom at Z=0.
 */
function fixObjForPrinting(filePath: string, targetHeightMm: number = 75): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  interface VertexData { tag: "v"; x: number; y: number; z: number; extra: string }
  interface NormalData { tag: "vn"; x: number; y: number; z: number }
  interface LineData { tag: "line"; text: string }
  type Entry = VertexData | NormalData | LineData;

  const entries: Entry[] = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const line of lines) {
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      // Y-up to Z-up: (x, y, z) → (x, -z, y)
      const rx = x, ry = -z, rz = y;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
      entries.push({ tag: "v", x: rx, y: ry, z: rz, extra: parts.slice(4).join(" ") });
    } else if (line.startsWith("vn ")) {
      const parts = line.split(/\s+/);
      const nx = parseFloat(parts[1]);
      const ny = parseFloat(parts[2]);
      const nz = parseFloat(parts[3]);
      entries.push({ tag: "vn", x: nx, y: -nz, z: ny });
    } else {
      entries.push({ tag: "line", text: line });
    }
  }

  const height = maxZ - minZ;
  const scale = height > 1e-6 ? targetHeightMm / height : 1.0;
  const xOff = -(minX + maxX) / 2 * scale;
  const yOff = -(minY + maxY) / 2 * scale;
  const zOff = -(minZ * scale);

  const output: string[] = [];
  for (const entry of entries) {
    if (entry.tag === "v") {
      const tx = entry.x * scale + xOff;
      const ty = entry.y * scale + yOff;
      const tz = entry.z * scale + zOff;
      const extra = entry.extra ? ` ${entry.extra}` : "";
      output.push(`v ${tx.toFixed(6)} ${ty.toFixed(6)} ${tz.toFixed(6)}${extra}`);
    } else if (entry.tag === "vn") {
      output.push(`vn ${entry.x.toFixed(6)} ${entry.y.toFixed(6)} ${entry.z.toFixed(6)}`);
    } else {
      output.push(entry.text);
    }
  }

  fs.writeFileSync(filePath, output.join("\n"), "utf-8");
  console.error(`OBJ fixed for printing: Y-up→Z-up, ${targetHeightMm}mm, centered, bottom at Z=0`);
}

async function downloadFileToLocal(url: string, saveTo: string): Promise<number> {
  // Ensure directory exists
  const dir = path.dirname(saveTo);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120000 // 120s timeout
  });

  const writer = fs.createWriteStream(saveTo);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => {
      const stats = fs.statSync(saveTo);
      resolve(stats.size);
    });
    writer.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Render a progress bar
 */
function renderProgressBar(progress: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${clamped}%`;
}

/**
 * Format task for display (single-poll mode)
 */
function formatTask(task: Task, format: ResponseFormat): string {
  if (format === ResponseFormat.MARKDOWN) {
    const lines = [`# Task: ${task.id}`, ""];

    const progress = task.progress || 0;
    lines.push(`${renderProgressBar(progress)} — ${task.status}`);
    lines.push("");

    lines.push(`**Phase**: ${task.phase}`);
    lines.push(`**Created**: ${new Date(task.created_at).toLocaleString()}`);
    if (task.updated_at) lines.push(`**Updated**: ${new Date(task.updated_at).toLocaleString()}`);
    lines.push("");

    if (task.status === TaskStatus.SUCCEEDED && task.model_urls) {
      lines.push("## Result");

      const formats = Object.keys(task.model_urls).filter(k => task.model_urls![k as keyof typeof task.model_urls]);
      lines.push(`- **Available Formats**: ${formats.join(', ').toUpperCase()}`);
      if (task.thumbnail_url) lines.push(`- **Thumbnail**: ${task.thumbnail_url}`);

      if (task.vertex_count && task.face_count) {
        lines.push(`- **Vertices**: ${task.vertex_count.toLocaleString()}`);
        lines.push(`- **Faces**: ${task.face_count.toLocaleString()}`);
      }
      lines.push("");

      // Handle texture_urls — can be array of objects or single object
      const textures = task.texture_urls;
      if (textures && !Array.isArray(textures)) {
        lines.push("## Textures");
        if (textures.base_color) lines.push(`- Base Color: Available`);
        if (textures.metallic) lines.push(`- Metallic: Available`);
        if (textures.roughness) lines.push(`- Roughness: Available`);
        if (textures.normal) lines.push(`- Normal Map: Available`);
        lines.push("");
      } else if (Array.isArray(textures) && textures.length > 0) {
        lines.push("## Textures");
        const first = textures[0];
        if (first.base_color) lines.push(`- Base Color: Available`);
        if (first.metallic) lines.push(`- Metallic: Available`);
        if (first.roughness) lines.push(`- Roughness: Available`);
        if (first.normal) lines.push(`- Normal Map: Available`);
        lines.push("");
      }

      lines.push("**Next Steps**: Use `meshy_download_model` to get download URLs.");
    } else if (task.status === TaskStatus.IN_PROGRESS) {
      if (progress >= 95) {
        lines.push("The task is in finalization (this is normal and can take 30-120s). Do NOT cancel.");
        lines.push("");
        lines.push("**TIP**: Use `meshy_get_task_status` with wait=true (default) to auto-wait until completion.");
      } else {
        lines.push("The task is still processing.");
        lines.push("");
        lines.push("**TIP**: Use `meshy_get_task_status` with wait=true (default) to auto-wait until completion.");
      }
    } else if (task.status === TaskStatus.PENDING) {
      lines.push("The task is queued and will start processing soon.");
      lines.push("");
      lines.push("**TIP**: Use `meshy_get_task_status` with wait=true (default) to auto-wait until completion.");
    } else if (task.status === TaskStatus.FAILED && task.task_error) {
      lines.push(`## Error`);
      if (task.task_error.code) lines.push(`**Code**: ${task.task_error.code}`);
      lines.push(`**Message**: ${task.task_error.message}`);
    }

    return lines.join("\n");
  } else {
    return JSON.stringify(task, null, 2);
  }
}

/**
 * Build a rich success response with progress bar for wait mode
 */
function buildWaitSuccessResponse(
  task: GetTaskResponse,
  taskId: string,
  taskType: TaskType,
  waitTimeSec: number,
  pollCount: number
) {
  const lines = [
    `# Task Completed`,
    "",
    `${renderProgressBar(100)} — SUCCEEDED (${waitTimeSec}s, ${pollCount} polls)`,
    "",
    `**Task ID**: ${taskId}`,
    ""
  ];

  // Model info
  if (task.vertex_count && task.face_count) {
    lines.push(`## Model Info`);
    lines.push(`- **Vertices**: ${task.vertex_count.toLocaleString()}`);
    lines.push(`- **Faces**: ${task.face_count.toLocaleString()}`);
    lines.push("");
  }

  // Available formats
  if (task.model_urls) {
    const formats = Object.keys(task.model_urls).filter(
      k => task.model_urls![k as keyof typeof task.model_urls]
    );
    if (formats.length > 0) {
      lines.push(`## Available Formats`);
      lines.push(`${formats.join(", ").toUpperCase()}`);
      lines.push("");
    }
  }

  // Rigging results
  if (taskType === TaskType.RIGGING && task.result) {
    lines.push("## Rigging Result");
    if (task.result.rigged_character_glb_url) lines.push("- Rigged character: GLB available");
    if (task.result.rigged_character_fbx_url) lines.push("- Rigged character: FBX available");
    if (task.result.basic_animations) {
      lines.push("- **Walking animation**: included FREE");
      lines.push("- **Running animation**: included FREE");
    }
    lines.push("");
    lines.push("**NOTE**: Walking and running animations are included FREE with rigging. Do NOT call `meshy_animate` for these — only use it for CUSTOM animations (3 credits each).");
    lines.push("");
  }

  // Animation results
  if (taskType === TaskType.ANIMATION && task.result) {
    lines.push("## Animation Result");
    if (task.result.animation_glb_url) lines.push("- Animation GLB available");
    if (task.result.animation_fbx_url) lines.push("- Animation FBX available");
    lines.push("");
  }

  // Next steps
  lines.push("**Next Steps**: Use `meshy_download_model` with task_id \"" + taskId + "\"" +
    (taskType !== TaskType.TEXT_TO_3D ? ` and task_type "${taskType}"` : "") +
    " to get download URLs.");

  const modelUrls: Record<string, string> = {};
  if (task.model_urls) {
    for (const [k, v] of Object.entries(task.model_urls)) {
      if (v) modelUrls[k] = v;
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      outcome: "SUCCEEDED" as const,
      task_id: taskId,
      status: "SUCCEEDED",
      progress: 100,
      wait_time_seconds: waitTimeSec,
      poll_count: pollCount,
      model_urls: Object.keys(modelUrls).length > 0 ? modelUrls : undefined,
      vertex_count: task.vertex_count,
      face_count: task.face_count
    }
  };
}

/**
 * Register task management tools with the MCP server
 */
export function registerTaskTools(server: McpServer, client: MeshyClient) {
  // Get task status tool (with optional wait mode)
  server.registerTool(
    "meshy_get_task_status",
    {
      title: "Get Task Status",
      description: `Check task status or wait for completion. Supports two modes:

**wait=true (default)**: Auto-polls with exponential backoff (5s→30s, 15s at 95%+) until SUCCEEDED/FAILED/TIMEOUT. Returns full result with progress bar. Recommended — call once and get the final result.

**wait=false**: Returns current status immediately (single query) with progress bar.

Args:
  - task_id (string): Task ID returned from generation tools (required)
  - task_type (enum, optional): Task type for endpoint routing (default: "text-to-3d"). Auto-infers if wrong.
  - wait (boolean): Auto-wait until completion (default: true)
  - timeout_seconds (number): Max wait time when wait=true (default: 300, max: 300)
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns (wait=true, SUCCEEDED):
  Progress bar + full task data + model info + download instructions

Returns (wait=false):
  Progress bar + current status snapshot

Examples:
  - Auto-wait: { task_id: "abc-123" }
  - Quick check: { task_id: "abc-123", wait: false }
  - Image-to-3d: { task_id: "abc-123", task_type: "image-to-3d" }
  - Short timeout: { task_id: "abc-123", timeout_seconds: 60 }`,
      inputSchema: GetTaskStatusInputSchema,
      outputSchema: TaskStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof GetTaskStatusInputSchema>, extra) => {
      const preferredEndpoint = getTaskEndpoint(params.task_type);

      // --- wait=false: single query mode ---
      if (!params.wait) {
        try {
          const { task } = await getTaskWithAutoInference(client, params.task_id, preferredEndpoint);
          const textContent = formatTask(task, params.response_format);
          const modelUrls: Record<string, string> = {};
          if (task.model_urls) {
            for (const [k, v] of Object.entries(task.model_urls)) {
              if (v) modelUrls[k] = v;
            }
          }
          return {
            content: [{ type: "text", text: textContent }],
            structuredContent: {
              outcome: task.status as string,
              task_id: params.task_id,
              status: task.status,
              progress: task.progress || 0,
              model_urls: Object.keys(modelUrls).length > 0 ? modelUrls : undefined,
              vertex_count: task.vertex_count,
              face_count: task.face_count,
              error_code: task.task_error?.code,
              error_message: task.task_error?.message
            }
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: handleMeshyError(error) }]
          };
        }
      }

      // --- wait=true: polling mode ---
      const timeoutMs = params.timeout_seconds * 1000;
      const startTime = Date.now();
      let pollCount = 0;
      let currentDelay = POLL_INITIAL_DELAY;
      let resolvedEndpoint = preferredEndpoint;

      try {
        while (true) {
          pollCount++;
          let task: GetTaskResponse;

          // First poll: use auto-inference to resolve the correct endpoint
          if (pollCount === 1) {
            const result = await getTaskWithAutoInference(client, params.task_id, preferredEndpoint);
            task = result.task;
            resolvedEndpoint = result.endpoint;
          } else {
            task = await client.get<GetTaskResponse>(`${resolvedEndpoint}/${params.task_id}`);
          }

          const progress = task.progress || 0;

          // Send progress notification via logging (primary channel)
          try {
            server.sendLoggingMessage({
              level: "info",
              data: `${renderProgressBar(progress)} — ${task.status} (poll #${pollCount})`
            });
          } catch {
            // Logging not critical
          }

          // Send structured progress notification (enhanced channel for clients that support it)
          if (extra._meta?.progressToken !== undefined) {
            try {
              await server.server.notification({
                method: "notifications/progress",
                params: {
                  progressToken: extra._meta.progressToken,
                  progress: progress,
                  total: 100,
                  message: `${task.status} - ${renderProgressBar(progress)}`
                }
              });
            } catch {
              // Client may not support progress notifications, silently ignore
            }
          }

          // Terminal: SUCCEEDED
          if (task.status === TaskStatus.SUCCEEDED) {
            const waitTimeSec = Math.round((Date.now() - startTime) / 1000);
            return buildWaitSuccessResponse(task, params.task_id, params.task_type, waitTimeSec, pollCount);
          }

          // Terminal: FAILED
          if (task.status === TaskStatus.FAILED) {
            const waitTimeSec = Math.round((Date.now() - startTime) / 1000);
            const errorMsg = task.task_error?.message || "Unknown error";
            const errorCode = task.task_error?.code || "";
            return {
              isError: true,
              content: [{
                type: "text" as const,
                text: `# Task Failed

${renderProgressBar(progress)} — FAILED (${waitTimeSec}s, ${pollCount} polls)

**Task ID**: ${params.task_id}
**Error**: ${errorCode ? `[${errorCode}] ` : ""}${errorMsg}

The task failed during processing. You may want to retry with different parameters.`
              }],
              structuredContent: {
                outcome: "FAILED" as const,
                task_id: params.task_id,
                status: "FAILED",
                progress,
                error_code: errorCode || undefined,
                error_message: errorMsg,
                wait_time_seconds: waitTimeSec,
                poll_count: pollCount
              }
            };
          }

          // Terminal: CANCELED
          if (task.status === TaskStatus.CANCELED) {
            const waitTimeSec = Math.round((Date.now() - startTime) / 1000);
            return {
              content: [{
                type: "text" as const,
                text: `# Task Canceled

${renderProgressBar(progress)} — CANCELED (${waitTimeSec}s, ${pollCount} polls)

**Task ID**: ${params.task_id}`
              }],
              structuredContent: {
                outcome: "CANCELED" as const,
                task_id: params.task_id,
                status: "CANCELED",
                progress,
                wait_time_seconds: waitTimeSec,
                poll_count: pollCount
              }
            };
          }

          // Check timeout before sleeping
          const elapsed = Date.now() - startTime;
          if (elapsed + currentDelay > timeoutMs) {
            const waitTimeSec = Math.round(elapsed / 1000);
            return {
              isError: true,
              content: [{
                type: "text" as const,
                text: `# Task Timeout

${renderProgressBar(progress)} — ${task.status} (${waitTimeSec}s, ${pollCount} polls)

**Task ID**: ${params.task_id}
**Timeout**: ${params.timeout_seconds}s exceeded

The task is still processing. You can:
1. Call \`meshy_get_task_status\` again with a longer timeout_seconds
2. Call with wait=false to check status manually`
              }],
              structuredContent: {
                outcome: "TIMEOUT" as const,
                task_id: params.task_id,
                status: task.status,
                progress,
                wait_time_seconds: waitTimeSec,
                poll_count: pollCount
              }
            };
          }

          // Determine delay: fixed 15s during finalization, otherwise backoff
          const delayToUse = progress >= 95 ? POLL_FINALIZATION_DELAY : currentDelay;

          await sleep(delayToUse);

          // Increase delay for next iteration (backoff)
          if (progress < 95) {
            currentDelay = Math.min(currentDelay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY);
          }
        }
      } catch (error) {
        const waitTimeSec = Math.round((Date.now() - startTime) / 1000);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `${handleMeshyError(error)}\n\n**Wait Time**: ${waitTimeSec}s (${pollCount} polls)\n\nYou can retry with \`meshy_get_task_status\` or use wait=false to check manually.`
          }]
        };
      }
    }
  );

  // List tasks tool
  server.registerTool(
    "meshy_list_tasks",
    {
      title: "List Generation Tasks",
      description: `List tasks across all task types with filtering and pagination.

Queries one or all task types. When task_type is omitted, queries ALL 7 list-capable endpoints in parallel and merges results sorted by creation time.

Args:
  - task_type (enum, optional): Filter by task type. If omitted, queries ALL types and merges results.
    Supported: "text-to-3d", "image-to-3d", "multi-image-to-3d", "remesh", "retexture", "text-to-image", "image-to-image"
    Note: "rigging" and "animation" do NOT have list endpoints.
  - sort_by (enum): Sort by creation time - "-created_at" (newest first, default) or "+created_at" (oldest first)
  - status (enum, optional): Filter by status - "PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"
  - phase (enum, optional): Filter by phase - "draft", "generate", "texture", "stylize", "animate"
  - limit (number): Results per page per endpoint, 1-50 (default: 20). When querying all types, total results may be up to 7 × limit.
  - offset (number): Skip N results for pagination (default: 0)
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "page_count": 20,                  // Tasks in this response
    "offset": 0,
    "tasks": [ { task_type: "text-to-3d", ... }, ... ],
    "has_more": true,
    "next_offset": 20
  }

Pagination:
  To get next page, use the returned next_offset value.

Examples:
  - List all recent tasks: { limit: 10 }
  - List only image-to-3d: { task_type: "image-to-3d", limit: 20 }
  - List successful tasks: { status: "SUCCEEDED", limit: 20 }
  - Get second page: { limit: 20, offset: 20 }

Error Handling:
  - Automatically truncates if response exceeds size limit
  - Partial endpoint failures are tolerated (uses Promise.allSettled)`,
      inputSchema: ListTasksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ListTasksInputSchema>) => {
      try {
        const pageSize = Math.min(params.limit, 50); // API max is 50
        const pageNum = Math.floor(params.offset / pageSize) + 1;
        const baseQueryParams: Record<string, string | number> = {
          page_size: pageSize,
          page_num: pageNum,
          sort_by: params.sort_by
        };

        if (params.status) baseQueryParams.status = params.status;
        if (params.phase) baseQueryParams.phase = params.phase;

        // Determine which endpoints to query
        const taskTypesToQuery: TaskType[] = params.task_type
          ? [params.task_type]
          : LIST_CAPABLE_TASK_TYPES;

        // Query endpoints (parallel for multi-type, single for specific type)
        interface TaggedTask {
          id: string;
          name: string;
          task_type: string;
          status: string;
          progress: number;
          phase: string;
          created_at: string | number;
          vertex_count?: number;
          face_count?: number;
        }

        let allTasks: TaggedTask[] = [];

        if (taskTypesToQuery.length === 1) {
          // Single endpoint query
          const endpoint = getTaskEndpoint(taskTypesToQuery[0]);
          const tasks = await client.get<Task[]>(endpoint, baseQueryParams);
          const taskList = Array.isArray(tasks) ? tasks : [];
          allTasks = taskList.map(task => ({
            id: task.id,
            name: task.name || task.prompt || "Untitled",
            task_type: taskTypesToQuery[0],
            status: task.status,
            progress: task.progress,
            phase: task.phase,
            created_at: task.created_at,
            vertex_count: task.vertex_count,
            face_count: task.face_count
          }));
        } else {
          // Parallel query across all list-capable endpoints
          const results = await Promise.allSettled(
            taskTypesToQuery.map(async (tt) => {
              const endpoint = getTaskEndpoint(tt);
              const tasks = await client.get<Task[]>(endpoint, baseQueryParams);
              const taskList = Array.isArray(tasks) ? tasks : [];
              return taskList.map(task => ({
                id: task.id,
                name: task.name || task.prompt || "Untitled",
                task_type: tt as string,
                status: task.status,
                progress: task.progress,
                phase: task.phase,
                created_at: task.created_at,
                vertex_count: task.vertex_count,
                face_count: task.face_count
              }));
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              allTasks.push(...result.value);
            }
            // Rejected results are silently skipped (partial failure tolerance)
          }

          // Sort merged results by created_at
          allTasks.sort((a, b) => {
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            return params.sort_by === "+created_at" ? timeA - timeB : timeB - timeA;
          });
        }

        const output = {
          page_count: allTasks.length,
          offset: params.offset,
          queried_types: taskTypesToQuery,
          tasks: allTasks,
          has_more: taskTypesToQuery.length === 1 ? allTasks.length >= pageSize : false,
          next_offset: taskTypesToQuery.length === 1 && allTasks.length >= pageSize
            ? params.offset + allTasks.length
            : undefined
        };

        // Helper to render tasks as markdown
        const renderTasksMarkdown = (tasks: typeof output.tasks, totalCount: number, truncated = false) => {
          const lines = [`# Tasks`, ""];
          const typeLabel = params.task_type ? `[${params.task_type}]` : "[all types]";
          lines.push(`**Showing**: ${totalCount} tasks ${typeLabel} (offset: ${output.offset})`);
          if (truncated) lines.push(`*(truncated from ${allTasks.length} results)*`);
          lines.push("");

          for (const task of tasks) {
            const typeTag = taskTypesToQuery.length > 1 ? ` [${task.task_type}]` : "";
            lines.push(`## ${task.name}${typeTag} (${task.id})`);
            lines.push(`- **Status**: ${task.status} ${task.status === TaskStatus.IN_PROGRESS ? `(${task.progress}%)` : ''}`);
            lines.push(`- **Phase**: ${task.phase}`);
            lines.push(`- **Created**: ${new Date(task.created_at).toLocaleString()}`);
            if (task.vertex_count) {
              lines.push(`- **Geometry**: ${task.vertex_count.toLocaleString()} vertices, ${task.face_count?.toLocaleString()} faces`);
            }
            lines.push("");
          }

          if (output.has_more) {
            lines.push(`**More results available**. Use offset=${output.next_offset} to see next page.`);
          }
          return lines.join("\n");
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = renderTasksMarkdown(output.tasks, output.page_count);
        } else {
          textContent = JSON.stringify(output, null, 2);
        }

        // Check character limit — re-render in same format with fewer tasks
        if (textContent.length > CHARACTER_LIMIT) {
          const truncatedTasks = output.tasks.slice(0, Math.max(1, Math.floor(output.tasks.length / 2)));
          output.tasks = truncatedTasks;
          output.page_count = truncatedTasks.length;
          if (params.response_format === ResponseFormat.MARKDOWN) {
            textContent = renderTasksMarkdown(truncatedTasks, truncatedTasks.length, true) +
              `\n\n[Response truncated. Use smaller limit or add task_type filter to see more results.]`;
          } else {
            textContent = JSON.stringify(output, null, 2) +
              `\n\n[Response truncated. Use smaller limit or add task_type filter to see more results.]`;
          }
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error)
          }]
        };
      }
    }
  );

  // Cancel task tool
  server.registerTool(
    "meshy_cancel_task",
    {
      title: "Cancel Generation Task",
      description: `Cancel a pending or in-progress 3D generation task.

This tool cancels a task that is currently PENDING or IN_PROGRESS. Completed or failed tasks cannot be canceled.

Args:
  - task_id (string): Task ID to cancel (required)
  - task_type (enum, optional): Task type to route to correct endpoint (default: "text-to-3d"). Auto-infers if wrong.

Returns:
  {
    "success": true,
    "message": "Task canceled successfully",
    "task_id": "abc-123",
    "previous_status": "IN_PROGRESS"
  }

Use Cases:
  - Cancel tasks that are taking too long
  - Free up task slots when at limit
  - Stop incorrect generations

Examples:
  - Cancel task: { task_id: "abc-123" }

Error Handling:
  - Returns error if task is already completed
  - Returns "NotFound" if task doesn't exist`,
      inputSchema: CancelTaskInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof CancelTaskInputSchema>) => {
      try {
        const preferredEndpoint = getTaskEndpoint(params.task_type);
        const { task, endpoint } = await getTaskWithAutoInference(client, params.task_id, preferredEndpoint);
        const previousStatus = task.status;

        // Cancel the task
        await client.delete(`${endpoint}/${params.task_id}`);

        const output = {
          success: true,
          message: "Task canceled successfully",
          task_id: params.task_id,
          previous_status: previousStatus
        };

        const textContent = `# Task Canceled

**Task ID**: ${params.task_id}
**Previous Status**: ${previousStatus}

The task has been canceled successfully.`;

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error)
          }]
        };
      }
    }
  );

  // Download model tool
  server.registerTool(
    "meshy_download_model",
    {
      title: "Get Model Download URLs",
      description: `Download a completed 3D model to local disk with automatic file organization.

IMPORTANT: Ask the user which format they need BEFORE downloading. Do NOT download all formats.
Format recommendations: GLB (viewing), OBJ (white model printing), 3MF (multicolor printing), FBX (game engines), USDZ (AR).

By default, files are auto-saved to meshy_output/ under the current working directory with smart naming and history tracking. Use save_to to override with a custom path.

Args:
  - task_id (string): Task ID of completed model (required)
  - task_type (enum, optional): Task type to route to correct endpoint (default: "text-to-3d"). Auto-infers if wrong.
  - format (enum): Model format - "glb", "fbx", "usdz", "stl", "obj", or "3mf" (default: "glb"). IMPORTANT: Ask user which format they need before downloading.
  - include_textures (boolean): Include texture files (default: true)
  - save_to (string, optional): Override auto path with a custom ABSOLUTE path. If omitted, auto-saves to meshy_output/{timestamp}_{prompt}_{id}/.
  - parent_task_id (string, optional): Parent task ID for chaining (e.g., preview_task_id for refine). Places output in the same project folder.
  - print_ready (boolean, optional): If true and format="obj", auto-fix for 3D printing: Y-up→Z-up, scale to height, center, bottom at Z=0.
  - print_height_mm (number, optional): Target height in mm when print_ready=true. Default 75. Adjust per user request.

Returns:
  { "local_path": "/path/to/file.obj", "file_size_bytes": 12345678, "project_dir": "...", "print_fixed": true }

Examples:
  - Auto-save: { task_id: "abc-123", format: "glb" }
  - 3D printing: { task_id: "abc-123", format: "obj", print_ready: true, print_height_mm: 100 }
  - Chained refine: { task_id: "def-456", parent_task_id: "abc-123", format: "glb" }

Error Handling:
  - Returns error if task is not SUCCEEDED
  - If download fails, falls back to returning URLs`,
      inputSchema: DownloadModelInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof DownloadModelInputSchema>) => {
      try {
        const preferredEndpoint = getTaskEndpoint(params.task_type);
        const { task } = await getTaskWithAutoInference(client, params.task_id, preferredEndpoint);

        if (task.status !== TaskStatus.SUCCEEDED) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: Task is not completed yet. Current status: ${task.status}. Use meshy_get_task_status to check progress.`
            }]
          };
        }

        let fmt = params.format;

        // 3MF format: not yet supported by API
        if (fmt === "3mf" && !task.model_urls?.["3mf" as keyof typeof task.model_urls]) {
          const hasObj = !!task.model_urls?.obj;
          return {
            isError: true,
            content: [{
              type: "text",
              text: `# 3MF Format Not Yet Supported

3MF download is not yet available. This feature is coming soon.

${hasObj
  ? `This model has **OBJ** format available. Would you like to download the OBJ file instead?

OBJ files can be imported directly into most slicer software:
- **Bambu Studio**: File → Import → select .obj file
- **OrcaSlicer**: File → Import → select .obj file
- **Cura**: File → Open File(s) → select .obj file
- **Creality Print**: File → Open → select .obj file
- **PrusaSlicer**: File → Import → select .obj file

**IMPORTANT**: Please confirm before I proceed with the OBJ download. Do NOT use \`meshy_send_to_slicer\` — manually import the downloaded file in your slicer instead.`
  : `Unfortunately, OBJ format is also not available for this model. Available formats: ${task.model_urls ? Object.keys(task.model_urls).join(', ') : 'none'}`}`
            }]
          };
        }

        // Rigging tasks: result.rigged_character_{format}_url
        if (params.task_type === TaskType.RIGGING && task.result) {
          const lines = [`# Rigging Download URLs`, "", `**Task ID**: ${params.task_id}`, ""];

          lines.push("## Rigged Character");
          if (task.result.rigged_character_glb_url)
            lines.push(`- **GLB**: ${task.result.rigged_character_glb_url}`);
          if (task.result.rigged_character_fbx_url)
            lines.push(`- **FBX**: ${task.result.rigged_character_fbx_url}`);
          lines.push("");

          if (task.result.basic_animations) {
            const anim = task.result.basic_animations;
            lines.push("## Basic Animations (FREE with rigging)");
            lines.push("### Walking");
            if (anim.walking_glb_url) lines.push(`- **GLB**: ${anim.walking_glb_url}`);
            if (anim.walking_fbx_url) lines.push(`- **FBX**: ${anim.walking_fbx_url}`);
            if (anim.walking_armature_glb_url) lines.push(`- **Armature GLB**: ${anim.walking_armature_glb_url}`);
            lines.push("### Running");
            if (anim.running_glb_url) lines.push(`- **GLB**: ${anim.running_glb_url}`);
            if (anim.running_fbx_url) lines.push(`- **FBX**: ${anim.running_fbx_url}`);
            if (anim.running_armature_glb_url) lines.push(`- **Armature GLB**: ${anim.running_armature_glb_url}`);
            lines.push("");
            lines.push("**NOTE**: These animations were included FREE with rigging. Do NOT call `meshy_animate` for walking/running.");
            lines.push("");
          }

          lines.push("**Note**: Download URLs expire after 24 hours.");

          const output = {
            download_url: fmt === "fbx"
              ? task.result.rigged_character_fbx_url
              : task.result.rigged_character_glb_url,
            format: fmt,
            rigged_character_glb_url: task.result.rigged_character_glb_url,
            rigged_character_fbx_url: task.result.rigged_character_fbx_url,
            basic_animations: task.result.basic_animations,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          };

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: output
          };
        }

        // Animation tasks: result.animation_{format}_url
        if (params.task_type === TaskType.ANIMATION && task.result) {
          const lines = [`# Animation Download URLs`, "", `**Task ID**: ${params.task_id}`, ""];

          lines.push("## Animation Files");
          if (task.result.animation_glb_url) lines.push(`- **GLB**: ${task.result.animation_glb_url}`);
          if (task.result.animation_fbx_url) lines.push(`- **FBX**: ${task.result.animation_fbx_url}`);
          if (task.result.processed_usdz_url) lines.push(`- **USDZ**: ${task.result.processed_usdz_url}`);
          if (task.result.processed_armature_fbx_url) lines.push(`- **Armature FBX**: ${task.result.processed_armature_fbx_url}`);
          if (task.result.processed_animation_fps_fbx_url) lines.push(`- **FPS-converted FBX**: ${task.result.processed_animation_fps_fbx_url}`);
          lines.push("");
          lines.push("**Note**: Download URLs expire after 24 hours.");

          const output = {
            download_url: fmt === "fbx"
              ? task.result.animation_fbx_url
              : fmt === "usdz"
                ? task.result.processed_usdz_url
                : task.result.animation_glb_url,
            format: fmt,
            animation_glb_url: task.result.animation_glb_url,
            animation_fbx_url: task.result.animation_fbx_url,
            processed_usdz_url: task.result.processed_usdz_url,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          };

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: output
          };
        }

        // Standard tasks (text-to-3d, image-to-3d, remesh, retexture): top-level model_urls
        if (!task.model_urls) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: Task completed but no model URLs available. " +
                (task.result
                  ? "This task may use a different response format. Try meshy_get_task_status with response_format='json' to see the raw response."
                  : "")
            }]
          };
        }

        const downloadUrl = task.model_urls[fmt as keyof typeof task.model_urls];
        if (!downloadUrl) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: Format ${fmt} is not available for this model. Available formats: ${Object.keys(task.model_urls).join(', ')}`
            }]
          };
        }

        let textureUrls: TextureUrlsObject | undefined;
        if (params.include_textures && task.texture_urls) {
          if (Array.isArray(task.texture_urls) && task.texture_urls.length > 0) {
            textureUrls = task.texture_urls[0];
          } else if (!Array.isArray(task.texture_urls)) {
            textureUrls = task.texture_urls;
          }
        }

        // Determine save path: explicit save_to OR auto-managed output directory
        const stage = inferStage(params.task_type, task.type);
        let savePath: string;
        let projectDir: string | undefined;

        if (params.save_to) {
          savePath = params.save_to;
        } else {
          // Auto-save to meshy_output/{timestamp}_{prompt}_{id}/
          projectDir = resolveProjectDir(
            params.task_id,
            params.task_type,
            task.prompt,
            params.parent_task_id,
            task.created_at
          );
          savePath = getFilePath(projectDir, stage, fmt);
        }

        try {
          const fileSize = await downloadFileToLocal(downloadUrl, savePath);

          // Auto-fix OBJ for 3D printing if requested
          if (params.print_ready && fmt === "obj") {
            fixObjForPrinting(savePath, params.print_height_mm || 75);
          }

          const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
          const savedFiles = [path.basename(savePath)];

          // Download textures alongside the model
          const savedTextures: string[] = [];
          if (params.include_textures && textureUrls) {
            for (const [texType, texUrl] of Object.entries(textureUrls)) {
              if (texUrl && typeof texUrl === "string") {
                try {
                  let texPath: string;
                  if (projectDir) {
                    texPath = getTextureFilePath(projectDir, stage, texType, texUrl);
                  } else {
                    const saveDir = path.dirname(savePath);
                    const baseName = path.basename(savePath, path.extname(savePath));
                    const texExt = texUrl.includes(".png") ? ".png" : ".jpg";
                    texPath = path.join(saveDir, `${baseName}_${texType}${texExt}`);
                  }
                  await downloadFileToLocal(texUrl, texPath);
                  savedTextures.push(texPath);
                  savedFiles.push(path.basename(texPath));
                } catch {
                  // Texture download failed, continue
                }
              }
            }
          }

          // Auto-download thumbnail for managed projects
          if (projectDir && task.thumbnail_url) {
            saveThumbnail(projectDir, task.thumbnail_url).catch(() => {});
          }

          // Record task in project metadata
          if (projectDir) {
            const record: TaskRecord = {
              task_id: params.task_id,
              task_type: params.task_type,
              stage,
              prompt: task.prompt,
              status: task.status,
              files: savedFiles,
              created_at: new Date().toISOString()
            };
            recordTask(projectDir, record);
          }

          const output = {
            download_url: downloadUrl,
            local_path: savePath,
            project_dir: projectDir,
            file_size_bytes: fileSize,
            format: fmt,
            texture_paths: savedTextures.length > 0 ? savedTextures : undefined,
            vertex_count: task.vertex_count,
            face_count: task.face_count,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          };

          let textContent = `# Model Downloaded

**Task ID**: ${params.task_id}
**Format**: ${fmt.toUpperCase()}
**Local File**: ${savePath}
**File Size**: ${fileSizeMB} MB`;

          if (projectDir) {
            textContent += `\n**Project Folder**: ${projectDir}`;
          }

          if (task.vertex_count && task.face_count) {
            textContent += `\n\n## Model Info\n- **Vertices**: ${task.vertex_count.toLocaleString()}\n- **Faces**: ${task.face_count.toLocaleString()}`;
          }

          if (savedTextures.length > 0) {
            textContent += `\n\n## Saved Textures\n${savedTextures.map(t => `- ${t}`).join("\n")}`;
          }

          textContent += `\n\n**Note**: Source URL expires after 24 hours. The local file is permanent.`;

          return {
            content: [{ type: "text", text: textContent }],
            structuredContent: output
          };
        } catch (downloadError) {
          // Download failed — fall back to returning URLs
          const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
          const output = {
            download_url: downloadUrl,
            format: fmt,
            download_error: errorMsg,
            texture_urls: textureUrls,
            vertex_count: task.vertex_count,
            face_count: task.face_count,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          };

          return {
            content: [{
              type: "text",
              text: `# Download Failed — URLs Provided Instead

**Error**: ${errorMsg}

**Download URL** (use manually):
${downloadUrl}

**Note**: Download URLs expire after 24 hours.`
            }],
            structuredContent: output
          };
        }
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error)
          }]
        };
      }
    }
  );
}
