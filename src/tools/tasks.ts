/**
 * Task management tools (get status with wait mode, list, cancel, download)
 */

import { z } from "zod";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pipeline } from "stream/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MeshyClient, getTaskWithAutoInference, pollTask, listAcrossTypes } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  GetTaskStatusInputSchema,
  ListTasksInputSchema,
  CancelTaskInputSchema,
  DownloadModelInputSchema
} from "../schemas/tasks.js";
import { TaskStatusOutputSchema } from "../schemas/output.js";
import { RELIEF_COLOR_FORMATS, RELIEF_FORMATS } from "../schemas/relief.js";
import {
  ResponseFormat,
  TaskStatus,
  TaskType,
  CHARACTER_LIMIT,
  RELIEF_CREDITS
} from "../constants.js";
import { Task, GetTaskResponse, TaskError, TextureUrlsObject } from "../types.js";
import { DEFAULT_LIST_TASK_TYPES } from "../utils/endpoints.js";
import { describeTaskError } from "../utils/response-formatter.js";
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

/**
 * Download url to saveTo and return the saved size. Each transfer is staged in a folder of its own
 * and published only once complete: moved into place when nothing is at saveTo yet, so a new file
 * takes its size on the disk once; written onto an existing saveTo the way it was always written
 * (through a symlink, refused on a read-only file, keeping its mode). The staging folder sits
 * beside saveTo, or, for an existing file in a folder that takes no new entries, in the system's
 * temporary folder. A transfer that breaks off therefore rejects and leaves whatever saveTo held,
 * and concurrent downloads never share a staging file.
 */
async function downloadFileToLocal(url: string, saveTo: string): Promise<number> {
  // Ensure directory exists
  const dir = path.dirname(saveTo);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let exists = true;
  try {
    fs.lstatSync(saveTo);
  } catch {
    exists = false;
  }

  let staging: string;
  try {
    staging = fs.mkdtempSync(path.join(dir, ".meshy-download-"));
  } catch (error) {
    if (!exists) throw error;
    staging = fs.mkdtempSync(path.join(os.tmpdir(), "meshy-download-"));
  }
  try {
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 120000 // 120s timeout
    });
    const staged = path.join(staging, "download");
    await pipeline(response.data, fs.createWriteStream(staged));
    if (exists) {
      await pipeline(fs.createReadStream(staged), fs.createWriteStream(saveTo));
    } else {
      fs.renameSync(staged, saveTo);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return fs.statSync(saveTo).size;
}

/** The first texture set: texture_urls is an array of sets (text-to-3d, relief) or a single set. */
function firstTextureSet(textures: Task["texture_urls"]): TextureUrlsObject | undefined {
  return Array.isArray(textures) ? textures[0] : textures;
}

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * When the task's download URLs stop working: the API's own expires_at, else
 * 3 days after finished_at (API docs: asset retention; Enterprise accounts
 * keep results indefinitely).
 */
function expiresAt(task: Task): string | undefined {
  if (task.expires_at) return new Date(task.expires_at).toISOString();
  const finished = typeof task.finished_at === "number" ? task.finished_at : Date.parse(task.finished_at ?? "");
  return finished > 0 ? new Date(finished + RETENTION_MS).toISOString() : undefined;
}

function expiryNote(task: Task, saved = true): string {
  const at = expiresAt(task);
  return `**Note**: The Meshy download URLs stop working${at ? ` at ${at}` : ""} (results are kept for 3 days after the task finishes).` +
    (saved ? " Local files are permanent." : " Download the files before then.");
}

/**
 * Render a progress bar
 */
function renderProgressBar(progress: number, width = 20, withPercent = true): string {
  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * width);
  const bar = `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
  return withPercent ? `${bar} ${clamped}%` : bar;
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

    if (task.type) lines.push(`**Type**: ${task.type}`);
    if (task.phase) lines.push(`**Phase**: ${task.phase}`);
    lines.push(`**Created**: ${new Date(task.created_at).toLocaleString()}`);
    if (task.updated_at) lines.push(`**Updated**: ${new Date(task.updated_at).toLocaleString()}`);
    lines.push("");

    if (task.status === TaskStatus.SUCCEEDED && task.model_urls) {
      lines.push("## Result");

      // The MTL comes with the OBJ; it is not a format of its own.
      const formats = Object.keys(task.model_urls).filter(k => k !== "mtl" && task.model_urls![k as keyof typeof task.model_urls]);
      lines.push(`- **Available Formats**: ${formats.length > 0 ? formats.join(', ').toUpperCase() : "none"}`);
      if (task.depth_map_url) lines.push(`- **Depth Map**: ${task.depth_map_url}`);
      const reliefTexture = task.type === TaskType.RELIEF ? firstTextureSet(task.texture_urls)?.base_color : undefined;
      if (reliefTexture) lines.push(`- **Texture (base color)**: ${reliefTexture}`);
      if (task.thumbnail_url) lines.push(`- **Thumbnail**: ${task.thumbnail_url}`);
      if (task.alpha_thumbnail_url) lines.push(`- **Alpha Thumbnail**: ${task.alpha_thumbnail_url}`);
      if (typeof task.consumed_credits === "number") lines.push(`- **Credits Consumed**: ${task.consumed_credits}`);

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
    } else if (task.status === TaskStatus.SUCCEEDED && task.image_urls && task.image_urls.length > 0) {
      lines.push("## Result");
      lines.push(`- **Generated Image(s)**: ${task.image_urls.length}`);
      if (typeof task.consumed_credits === "number") lines.push(`- **Credits Consumed**: ${task.consumed_credits}`);
      lines.push("");
      lines.push("**Next Steps**: Use `meshy_download_model` to save the image(s) locally.");
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
      lines.push(describeTaskError(task.task_error));
    }

    return lines.join("\n");
  } else {
    return JSON.stringify(task, null, 2);
  }
}

/** A failed task's task_error as output fields; the API may send null for an unknown code or guide. */
function taskErrorFields(error?: TaskError | null) {
  return {
    error_type: error?.type ?? undefined,
    error_code: error?.code ?? undefined,
    error_message: error?.message ?? undefined,
    error_doc_url: error?.doc_url ?? undefined
  };
}

/** Type-specific result fields for structuredContent; only the ones the task has. */
function taskExtras(task: Task) {
  return {
    thumbnail_url: task.thumbnail_url || undefined,
    alpha_thumbnail_url: task.alpha_thumbnail_url || undefined,
    depth_map_url: task.depth_map_url || undefined,
    // A colored relief returns its texture whatever formats it made, STL / 3MF only included.
    texture_urls: task.type === TaskType.RELIEF ? task.texture_urls ?? undefined : undefined,
    printability: task.printability ?? undefined,
    part_count: task.part_count ?? undefined,
    prompt_ignored: task.prompt_ignored ?? undefined,
    result: task.result ?? undefined
  };
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
    `**Task ID**: ${taskId}`
  ];
  if (typeof task.consumed_credits === "number") {
    lines.push(`**Credits Consumed**: ${task.consumed_credits}`);
  }
  lines.push("");

  // Model info
  if (task.vertex_count && task.face_count) {
    lines.push(`## Model Info`);
    lines.push(`- **Vertices**: ${task.vertex_count.toLocaleString()}`);
    lines.push(`- **Faces**: ${task.face_count.toLocaleString()}`);
    lines.push("");
  }

  // Available formats
  if (task.model_urls) {
    // The MTL comes with the OBJ; it is not a format of its own.
    const formats = Object.keys(task.model_urls).filter(
      k => k !== "mtl" && task.model_urls![k as keyof typeof task.model_urls]
    );
    if (formats.length > 0) {
      lines.push(`## Available Formats`);
      lines.push(`${formats.join(", ").toUpperCase()}`);
      lines.push("");
    }
  }

  // Image-generation results (text-to-image / image-to-image)
  if (task.image_urls && task.image_urls.length > 0) {
    lines.push(`## Generated Image(s)`);
    lines.push(`${task.image_urls.length} image(s) available.`);
    lines.push("");
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
    lines.push("**NOTE**: Walking and running are included FREE as separate files; `meshy_animate` (3 credits per action) is for other actions, or walk/run bundled into one multi-clip file.");
    lines.push("");
  }

  // Animation results
  if (taskType === TaskType.ANIMATION && task.result) {
    lines.push("## Animation Result");
    if (task.result.animation_glb_url) lines.push("- Animation GLB available");
    if (task.result.animation_fbx_url) lines.push("- Animation FBX available");
    lines.push("");
  }

  // Text-to-motion results
  if (taskType === TaskType.TEXT_TO_MOTION && task.result?.motion_url) {
    lines.push("## Motion Clip");
    lines.push(`- ${task.result.motion_format?.toUpperCase() ?? "Clip"}, ${((task.result.duration_ms ?? 0) / 1000).toFixed(1)}s (${task.result.mode ?? "prime"})`);
    lines.push(`- Apply it to a rigged character: \`meshy_animate\` with motion_task_id "${taskId}" (biped rigs, within 3 days)`);
    lines.push("");
  }

  // Relief results: the depth map always, the model unless it was depth-map-only
  if (taskType === TaskType.RELIEF) {
    lines.push("## Relief Result");
    if (!Object.values(task.model_urls ?? {}).some(Boolean)) lines.push("- Depth map only: no model (should_generate_model false)");
    if (task.depth_map_url) lines.push("- Depth map: 16-bit grayscale PNG of relative heights, usable as a laser / CNC height map");
    const texture = firstTextureSet(task.texture_urls)?.base_color;
    if (texture) lines.push(`- Color: GLB, OBJ, FBX and USDZ carry the photo's color; STL and 3MF are white. Texture (base color): ${texture}`);
    lines.push("");
  }

  // Auto Split results
  if (taskType === TaskType.PRINT_SPLIT && task.part_count !== undefined) {
    lines.push(`## Split Result`);
    lines.push(`- **Parts**: ${task.part_count}`);
    if (task.prompt_ignored) lines.push("- The prompt could not be read, so Meshy chose the cuts automatically (prompt_ignored).");
    lines.push("");
  }

  // Printability results (print-analyze tasks)
  if (taskType === TaskType.PRINT_ANALYZE && task.printability) {
    const p = task.printability;
    const m = p.metrics;
    const statusIcon =
      p.status === "healthy" ? "✓" :
      p.status === "warning" ? "⚠" :
      p.status === "error" ? "✗" : "?";
    lines.push(`## Printability Analysis`);
    lines.push(`**Overall**: ${statusIcon} ${p.status.toUpperCase()} — ${p.issue_count} issue(s) (${p.error_count} error, ${p.warning_count} warning)`);
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| watertight | ${m.is_watertight} |`);
    lines.push(`| volume (m³) | ${m.volume.toFixed(6)} |`);
    lines.push(`| non-manifold edges | ${m.non_manifold_edges} |`);
    lines.push(`| degenerate faces | ${m.degenerate_faces} |`);
    lines.push(`| holes | ${m.holes} |`);
    if (p.thin_walls && p.intended_print) {
      const ratio = p.thin_walls.thin_area_ratio;
      lines.push(`| thin walls (< ${p.intended_print.wall_thickness_mm} mm, ${p.intended_print.printer_type} at ${p.intended_print.longest_side_mm} mm) | ${p.thin_walls.status}${ratio !== null ? `, ${(ratio * 100).toFixed(1)}% of the surface` : ""} |`);
    }
    lines.push("");
    if (p.status === "error") {
      lines.push(`**Recommendation**: \`meshy_repair_printability\` (10 credits) before printing — errors block a reliable print.`);
    } else if (p.status === "warning") {
      lines.push(`**Recommendation**: repair is optional; warnings (degenerate faces / holes) won't block printing but may affect surface quality.`);
    } else if (p.status === "healthy") {
      lines.push(`**Recommendation**: model is print-ready — download the analyzed source task's model (not this analyze task, which has no model) and open it in a slicer.`);
    }
    lines.push("");
  }

  // Next steps
  // print-analyze produces metrics, not downloadable assets — skip the "use meshy_download_model" hint.
  if (taskType !== TaskType.PRINT_ANALYZE) {
    // A relief has only the formats it was made in, and a GLB may not be one of them.
    const reliefFormats = taskType === TaskType.RELIEF
      ? Object.keys(task.model_urls ?? {}).filter(k => k !== "mtl" && task.model_urls![k as keyof typeof task.model_urls])
      : [];
    lines.push("**Next Steps**: Use `meshy_download_model` with task_id \"" + taskId + "\"" +
      (taskType !== TaskType.TEXT_TO_3D ? ` and task_type "${taskType}"` : "") +
      (taskType === TaskType.MULTI_COLOR_PRINT ? ' and format "3mf"' : "") +
      (reliefFormats.length > 0 && !reliefFormats.includes("glb") ? ` and format "${reliefFormats[0]}" (its formats: ${reliefFormats.join(", ")})` : "") +
      " to get the files.");
  }

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
      task_type: taskType,
      status: "SUCCEEDED",
      progress: 100,
      wait_time_seconds: waitTimeSec,
      poll_count: pollCount,
      model_urls: Object.keys(modelUrls).length > 0 ? modelUrls : undefined,
      image_urls: task.image_urls && task.image_urls.length > 0 ? task.image_urls : undefined,
      vertex_count: task.vertex_count,
      face_count: task.face_count,
      consumed_credits: task.consumed_credits,
      ...taskExtras(task)
    }
  };
}

/**
 * The file a saved OBJ or MTL names on its first `keyword` line (mtllib, map_Kd), read from the
 * file's start, as a bare file name: the named file is saved next to the one that names it.
 */
function referencedFile(filePath: string, keyword: string): string | undefined {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const head = Buffer.alloc(64 * 1024);
      const read = fs.readSync(fd, head, 0, head.length, 0);
      const line = head.toString("utf-8", 0, read).match(new RegExp(`^\\s*${keyword}\\s+(.+?)\\s*$`, "m"));
      // The file name is the last token (map_Kd may put options such as -s 1 1 1 before it).
      const name = line ? path.basename(line[1].split(/\s+/).pop() ?? "") : "";
      return name && name !== "." && name !== ".." ? name : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** The file name at the end of a download URL's path, or fallback. */
function urlFileName(url: string, fallback: string): string {
  try {
    const name = path.basename(decodeURIComponent(new URL(url).pathname));
    return name && name !== "." && name !== ".." ? name : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Save a finished relief task: the model in params.format (default glb; an OBJ with its MTL and
 * texture) and the depth map next to it. A depth-map-only task has empty model_urls and saves the
 * depth map alone.
 */
async function downloadRelief(task: GetTaskResponse, params: z.infer<typeof DownloadModelInputSchema>): Promise<CallToolResult> {
  const modelUrls = (task.model_urls ?? {}) as Record<string, string | undefined>;
  const formats = Object.keys(modelUrls).filter(k => modelUrls[k] && k !== "mtl");
  const depthUrl = task.depth_map_url || undefined;
  const depthOnly = formats.length === 0;
  const fmt = params.format ?? "glb";
  const modelUrl = depthOnly ? undefined : modelUrls[fmt];

  if (!depthOnly && !modelUrl) {
    const how = (RELIEF_FORMATS as readonly string[]).includes(fmt)
      ? `A relief task has only the formats listed in target_formats when it was created, and other tools cannot convert it: for ${fmt.toUpperCase()}, create a new relief task with "${fmt}" in target_formats (${RELIEF_CREDITS} credits).`
      : `Relief makes ${RELIEF_FORMATS.join(", ")} only.`;
    return {
      isError: true,
      content: [{ type: "text", text: `Error: this relief task has no ${fmt.toUpperCase()} file. Its formats: ${formats.join(", ")}. ${how}` }]
    };
  }
  if (depthOnly && !depthUrl) {
    return {
      isError: true,
      content: [{ type: "text", text: "Error: this relief task has neither a model nor a depth map. Check it with meshy_get_task_status (response_format json)." }]
    };
  }

  // save_to names the model (or, for a depth-map-only task, the depth map); else the project folder.
  const stage = inferStage(TaskType.RELIEF, task.type);
  let projectDir: string | undefined;
  let modelPath: string | undefined;
  let depthPath: string;
  if (params.save_to) {
    const base = path.join(path.dirname(params.save_to), path.basename(params.save_to, path.extname(params.save_to)));
    if (depthOnly) {
      depthPath = path.extname(params.save_to).toLowerCase() === ".png" ? params.save_to : `${base}_depth.png`;
    } else {
      modelPath = params.save_to;
      depthPath = `${base}_depth.png`;
    }
  } else {
    projectDir = resolveProjectDir(params.task_id, TaskType.RELIEF, task.prompt, params.parent_task_id, task.created_at);
    if (!depthOnly) modelPath = getFilePath(projectDir, stage, fmt);
    depthPath = path.join(projectDir, `${stage}_depth.png`);
  }
  // An OBJ, its MTL and its texture go into a folder of their own, named after the model, under
  // the names the OBJ and the MTL refer to: nothing is renamed or rewritten, and another OBJ saved
  // beside it keeps its own material. The depth map goes in with them.
  const mtlUrl = fmt === "obj" && !depthOnly ? modelUrls.mtl : undefined;
  if (mtlUrl && modelPath) {
    const stem = path.basename(modelPath, path.extname(modelPath));
    const objDir = path.join(path.dirname(modelPath), stem);
    modelPath = path.join(objDir, path.basename(modelPath));
    depthPath = path.join(objDir, `${stem}_depth.png`);
  }

  const saved: string[] = [];
  const notSaved: { file: string; url: string; error: string }[] = [];
  const save = async (file: string, url: string, target: string): Promise<number | undefined> => {
    try {
      const size = await downloadFileToLocal(url, target);
      saved.push(target);
      return size;
    } catch (error) {
      notSaved.push({ file, url, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };

  let modelSize: number | undefined;
  let mtlPath: string | undefined;
  let texturePath: string | undefined;
  if (modelUrl && modelPath) {
    const dir = path.dirname(modelPath);
    const stem = path.basename(modelPath, path.extname(modelPath));
    const textureUrl = params.include_textures && RELIEF_COLOR_FORMATS.includes(fmt)
      ? firstTextureSet(task.texture_urls)?.base_color
      : undefined;
    modelSize = await save(fmt, modelUrl, modelPath);
    if (modelSize === undefined) {
      // Without the model its companions name nothing: hand out their URLs with it.
      if (mtlUrl) notSaved.push({ file: "mtl", url: mtlUrl, error: "not downloaded: the model was not saved" });
      if (textureUrl) notSaved.push({ file: "base_color", url: textureUrl, error: "not downloaded: the model was not saved" });
    } else {
      if (mtlUrl) {
        const target = path.join(dir, referencedFile(modelPath, "mtllib") ?? urlFileName(mtlUrl, `${stem}.mtl`));
        if (await save("mtl", mtlUrl, target) !== undefined) mtlPath = target;
      }
      if (textureUrl) {
        const ext = textureUrl.split("?")[0].toLowerCase().includes(".png") ? ".png" : ".jpg";
        const target = mtlUrl
          ? path.join(dir, (mtlPath && referencedFile(mtlPath, "map_Kd")) ?? urlFileName(textureUrl, `${stem}_base_color${ext}`))
          : projectDir
            ? getTextureFilePath(projectDir, stage, "base_color", textureUrl)
            : path.join(dir, `${stem}_base_color${ext}`);
        if (await save("base_color", textureUrl, target) !== undefined) texturePath = target;
      }
    }
  }

  const depthSize = depthUrl ? await save("depth_map", depthUrl, depthPath) : undefined;
  if (depthOnly && depthSize === undefined) {
    return {
      content: [{
        type: "text",
        text: `# Download Failed — URL Provided Instead

**Error**: ${notSaved[0].error}

**Depth Map URL** (use manually):
${depthUrl}

${expiryNote(task, false)}`
      }],
      structuredContent: { depth_map_only: true, depth_map_url: depthUrl, download_error: notSaved[0].error, expires_at: expiresAt(task) }
    };
  }

  if (projectDir) {
    if (task.thumbnail_url) saveThumbnail(projectDir, task.thumbnail_url).catch(() => {});
    recordTask(projectDir, {
      task_id: params.task_id,
      task_type: TaskType.RELIEF,
      stage,
      prompt: task.prompt,
      status: task.status,
      // Relative to the project folder: an OBJ and its companions sit in a folder of their own.
      files: saved.map(p => path.relative(projectDir!, p)),
      created_at: new Date().toISOString()
    });
  }

  const depthSaved = depthSize !== undefined ? depthPath : undefined;
  const notSavedText = notSaved.length > 0
    ? `\n**Not saved** (download these URLs directly):\n${notSaved.map(n => `- ${n.file}: ${n.url} (${n.error})`).join("\n")}`
    : "";
  const folderText = projectDir ? `\n**Project Folder**: ${projectDir}` : "";

  if (depthOnly) {
    return {
      content: [{
        type: "text",
        text: `# Relief Depth Map Downloaded

**Task ID**: ${params.task_id}
**Depth Map**: ${depthPath} (16-bit grayscale PNG of relative heights, ${(depthSize! / (1024 * 1024)).toFixed(2)} MB)${folderText}

This task was created with should_generate_model false: it has a depth map and no model${params.format ? `, so format "${params.format}" was not used` : ""}.

${expiryNote(task)}`
      }],
      structuredContent: {
        depth_map_only: true,
        depth_map_url: depthUrl,
        depth_map_path: depthPath,
        local_path: depthPath,
        project_dir: projectDir,
        file_size_bytes: depthSize,
        expires_at: expiresAt(task)
      }
    };
  }

  if (modelSize === undefined) {
    const modelError = notSaved.find(n => n.file === fmt)?.error ?? "download failed";
    return {
      content: [{
        type: "text",
        text: `# Download Failed — URLs Provided Instead

**Error**: ${modelError}

**Download URL** (use manually):
${modelUrl}${depthSaved ? `\n\n**Depth Map**: ${depthSaved} (saved)` : ""}${folderText}${notSavedText}

${expiryNote(task, false)}`
      }],
      structuredContent: {
        download_url: modelUrl,
        format: fmt,
        download_error: modelError,
        depth_map_url: depthUrl,
        depth_map_path: depthSaved,
        project_dir: projectDir,
        not_saved: notSaved,
        expires_at: expiresAt(task)
      }
    };
  }

  const lines = [
    "# Relief Downloaded",
    "",
    `**Task ID**: ${params.task_id}`,
    `**Format**: ${fmt.toUpperCase()}`,
    `**Local File**: ${modelPath}`,
    `**File Size**: ${(modelSize! / (1024 * 1024)).toFixed(2)} MB`
  ];
  if (mtlPath) lines.push(`**Material (MTL)**: ${mtlPath}`);
  if (texturePath) lines.push(`**Texture**: ${texturePath}`);
  if (depthSaved) lines.push(`**Depth Map**: ${depthSaved} (16-bit grayscale PNG of relative heights)`);
  let text = lines.join("\n") + folderText + notSavedText;
  if (params.print_ready) {
    text += "\n\nprint_ready was not applied: a relief already has its real size. Its STL (millimeters, Z up) and 3MF open at that size.";
  }
  text += `\n\n${expiryNote(task)}`;

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      download_url: modelUrl,
      local_path: modelPath,
      project_dir: projectDir,
      file_size_bytes: modelSize,
      format: fmt,
      mtl_path: mtlPath,
      texture_paths: texturePath ? [texturePath] : undefined,
      depth_map_url: depthUrl,
      depth_map_path: depthSaved,
      not_saved: notSaved.length > 0 ? notSaved : undefined,
      expires_at: expiresAt(task)
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
      description: `Wait for a task to finish (wait=true, default) or check it once (wait=false). Reports the task's real task_type; pass it to the download and cancel tools.

wait=true polls at the API's suggested interval (else 5s→30s backoff) until SUCCEEDED / FAILED / CANCELED or timeout_seconds runs out; a failed status check (timeout, 429, 5xx) is retried at the next poll. Running out of time returns outcome "TIMEOUT": the task keeps running on Meshy — call again with the same task_id (Meshy advises allowing up to 60 minutes from creation).`,
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
      // --- wait=false: single query mode ---
      if (!params.wait) {
        try {
          const { task, taskType } = await getTaskWithAutoInference(client, params.task_id, params.task_type);
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
              task_type: taskType,
              status: task.status,
              progress: task.progress || 0,
              model_urls: Object.keys(modelUrls).length > 0 ? modelUrls : undefined,
              image_urls: task.image_urls && task.image_urls.length > 0 ? task.image_urls : undefined,
              vertex_count: task.vertex_count,
              face_count: task.face_count,
              consumed_credits: task.consumed_credits,
              ...taskExtras(task),
              ...taskErrorFields(task.task_error)
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
      const startTime = Date.now();
      const elapsed = () => Math.round((Date.now() - startTime) / 1000);
      const stillRunning =
        "The task keeps running on Meshy: stopping the wait does not cancel it. Call `meshy_get_task_status` " +
        "again with the same task_id to keep waiting. Meshy advises waiting at least 60 minutes from the task's " +
        "creation before giving up; most tasks finish in a few minutes.";

      try {
        const result = await pollTask(client, params.task_id, params.task_type, params.timeout_seconds * 1000, async (task, polls) => {
          const progress = task.progress || 0;
          try {
            server.sendLoggingMessage({
              level: "info",
              data: `${renderProgressBar(progress)} — ${task.status} (poll #${polls})`
            });
          } catch {
            // Logging not critical
          }
          if (extra._meta?.progressToken !== undefined) {
            try {
              await server.server.notification({
                method: "notifications/progress",
                params: {
                  progressToken: extra._meta.progressToken,
                  progress,
                  total: 100,
                  message: `${task.status} - ${renderProgressBar(progress, 20, false)}`
                }
              });
            } catch {
              // Client may not support progress notifications
            }
          }
        });
        const { task, polls } = result;
        const waitTimeSec = elapsed();
        const progress = task?.progress || 0;

        if (task?.status === TaskStatus.SUCCEEDED) {
          return buildWaitSuccessResponse(task, params.task_id, result.taskType ?? TaskType.TEXT_TO_3D, waitTimeSec, polls);
        }

        if (task?.status === TaskStatus.FAILED) {
          const retryHint = task.task_error?.type === "invalid_input"
            ? "Fix the input (see the message above) before creating the task again."
            : "Credits for a failed task are refunded. Creating it again often works; simplify the input if it keeps failing.";
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `# Task Failed

${renderProgressBar(progress)} — FAILED (${waitTimeSec}s, ${polls} polls)

**Task ID**: ${params.task_id}
**Error**: ${describeTaskError(task.task_error)}

${retryHint}`
            }],
            structuredContent: {
              outcome: "FAILED" as const,
              task_id: params.task_id,
              task_type: result.taskType,
              status: "FAILED",
              progress,
              ...taskErrorFields(task.task_error),
              error_message: task.task_error?.message || "Unknown error",
              wait_time_seconds: waitTimeSec,
              poll_count: polls
            }
          };
        }

        if (task?.status === TaskStatus.CANCELED) {
          return {
            content: [{
              type: "text" as const,
              text: `# Task Canceled

${renderProgressBar(progress)} — CANCELED (${waitTimeSec}s, ${polls} polls)

**Task ID**: ${params.task_id}`
            }],
            structuredContent: {
              outcome: "CANCELED" as const,
              task_id: params.task_id,
              task_type: result.taskType,
              status: "CANCELED",
              progress,
              wait_time_seconds: waitTimeSec,
              poll_count: polls
            }
          };
        }

        // Out of wait budget. The task itself is not affected.
        const lastCheck = result.lastError
          ? `\n**Last status check failed**: ${handleMeshyError(result.lastError)}\n`
          : "";
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `# Still Running

${renderProgressBar(progress)} — ${task?.status ?? "UNKNOWN"} (${waitTimeSec}s, ${polls} polls)

**Task ID**: ${params.task_id}
**Waited**: ${params.timeout_seconds}s (this call's limit)
${lastCheck}
${stillRunning}`
          }],
          structuredContent: {
            outcome: "TIMEOUT" as const,
            task_id: params.task_id,
            task_type: result.taskType,
            status: task?.status ?? "UNKNOWN",
            progress,
            wait_time_seconds: waitTimeSec,
            poll_count: polls
          }
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `${handleMeshyError(error)}\n\n**Wait Time**: ${elapsed()}s`
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
      description: `List tasks of any status, newest first by default, merged across the types queried (one request per type). Default: text-to-3d, image-to-3d, multi-image-to-3d, text-to-image and image-to-image; pass task_type / task_types for printing, rigging, animation, motion, post-processing, relief or Creative Lab tasks. With a task_id in hand, use meshy_get_task_status instead. Tasks created through the API do not appear in the Meshy web app.

status and phase filter the fetched tasks, so a page can be shorter than limit; continue with next_offset while has_more. Types whose request failed are listed in failed_types. For finished 3D models only, meshy_list_models is cheaper.`,
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
        const requested = [...new Set([...(params.task_type ? [params.task_type] : []), ...(params.task_types ?? [])])];
        const taskTypesToQuery: TaskType[] = requested.length > 0 ? requested : DEFAULT_LIST_TASK_TYPES;
        // The list endpoints take only page_num / page_size / sort_by, so
        // status and phase are filtered here.
        const listed = await listAcrossTypes(client, taskTypesToQuery, {
          sortBy: params.sort_by,
          offset: params.offset,
          limit: params.limit,
          keep: task => (!params.status || task.status === params.status) && (!params.phase || task.phase === params.phase)
        });
        const allTasks = listed.items.map(({ task, taskType }) => ({
          id: task.id,
          name: task.name || task.prompt || "Untitled",
          task_type: taskType as string,
          status: task.status,
          progress: task.progress,
          phase: task.phase,
          created_at: task.created_at,
          vertex_count: task.vertex_count,
          face_count: task.face_count
        }));

        const output = {
          page_count: allTasks.length,
          offset: params.offset,
          queried_types: taskTypesToQuery,
          note: requested.length > 0
            ? "Only the queried_types were searched."
            : "Default types only: printing, rigging, animation, motion, post-processing, relief and Creative Lab tasks are not included; pass task_types to list them.",
          tasks: allTasks,
          has_more: listed.hasMore,
          next_offset: listed.hasMore ? params.offset + allTasks.length : undefined,
          failed_types: listed.failed.length > 0 ? listed.failed : undefined
        };

        // Helper to render tasks as markdown
        const renderTasksMarkdown = (tasks: typeof output.tasks, totalCount: number, truncated = false) => {
          const lines = [`# Tasks`, ""];
          const typeLabel = `[${taskTypesToQuery.join(", ")}]`;
          lines.push(`**Showing**: ${totalCount} tasks ${typeLabel} (offset: ${output.offset})`);
          lines.push(`*${output.note}*`);
          if (truncated) lines.push(`*(truncated from ${allTasks.length} results)*`);
          lines.push("");

          for (const task of tasks) {
            const typeTag = taskTypesToQuery.length > 1 ? ` [${task.task_type}]` : "";
            lines.push(`## ${task.name}${typeTag} (${task.id})`);
            lines.push(`- **Status**: ${task.status} ${task.status === TaskStatus.IN_PROGRESS ? `(${task.progress}%)` : ''}`);
            if (task.phase) lines.push(`- **Phase**: ${task.phase}`);
            lines.push(`- **Created**: ${new Date(task.created_at).toLocaleString()}`);
            if (task.vertex_count) {
              lines.push(`- **Geometry**: ${task.vertex_count.toLocaleString()} vertices, ${task.face_count?.toLocaleString()} faces`);
            }
            lines.push("");
          }

          if (output.has_more) {
            lines.push(`**More results available**. Use offset=${output.next_offset} to see next page.`);
          }
          if (output.failed_types) {
            lines.push(`**Not listed** (request failed): ${output.failed_types.join(", ")}`);
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
          output.has_more = true;
          output.next_offset = params.offset + truncatedTasks.length;
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
      title: "Cancel or Delete Task",
      description: `Cancel a queued task, or delete a finished one. What happens depends on the task:

Creative Lab tasks (task_type "creative-lab-..."):
  - PENDING → canceled, credits refunded
  - IN_PROGRESS → canceled, credits NOT refunded
  - SUCCEEDED / FAILED / CANCELED → cannot be canceled or deleted, even with confirm_delete

Every other task:
  - PENDING → deleted, credits refunded
  - IN_PROGRESS → refused: the task keeps running and its credits are not refundable. Wait until it finishes
  - SUCCEEDED / FAILED / CANCELED → PERMANENTLY deleted with its files, no refund. Requires confirm_delete: true — ask the user first

Returns { success, task_id, task_type, previous_status, message }.`,
      inputSchema: CancelTaskInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof CancelTaskInputSchema>) => {
      try {
        const { task, endpoint, taskType } = await getTaskWithAutoInference(client, params.task_id, params.task_type);
        const previousStatus = task.status;
        const creativeLab = taskType.startsWith("creative-lab-");
        const finished = previousStatus === TaskStatus.SUCCEEDED ||
          previousStatus === TaskStatus.FAILED ||
          previousStatus === TaskStatus.CANCELED;

        if (finished && creativeLab) {
          return {
            isError: true,
            content: [{ type: "text", text: `Error: this Creative Lab task is already ${previousStatus}; the API cannot cancel or delete a finished Creative Lab task.` }]
          };
        }
        if (!creativeLab && previousStatus === TaskStatus.IN_PROGRESS) {
          // The API refuses this with 409 anyway; asking it would delete the task,
          // unconfirmed, if it finished between the status read and the DELETE.
          return {
            isError: true,
            content: [{
              type: "text",
              text: "This task is IN_PROGRESS: a running task cannot be stopped and its credits are already spent. Nothing was changed. " +
                "Check it with meshy_get_task_status; delete it after it finishes only if the user wants the result gone (confirm_delete: true)."
            }]
          };
        }
        if (finished && !params.confirm_delete) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `This task is already ${previousStatus}. Deleting it permanently removes the task and its files, with no refund. ` +
                "Nothing was changed. If the user wants that, call again with confirm_delete: true."
            }]
          };
        }

        // A queued task's delete is sent once: a retry seconds later could reach a task that has
        // finished meanwhile. Deleting a finished task, which the user confirmed, may retry.
        await client.delete(`${endpoint}/${params.task_id}`, { retry: finished });

        const message = creativeLab
          ? previousStatus === TaskStatus.PENDING
            ? "Canceled. It was still queued when checked, so its credits were refunded, unless it started in the moment between that check and the cancel."
            : "Canceled; credits for a task that had already started are not refunded."
          : finished
            ? "Deleted permanently, with its files (no refund)."
            : "Deleted. It was still queued when checked, so its credits were refunded, unless it finished in the moment between that check and the delete (then it was deleted with no refund).";

        const output = {
          success: true,
          message,
          task_id: params.task_id,
          task_type: taskType,
          previous_status: previousStatus
        };

        return {
          content: [{
            type: "text",
            text: `# Task ${creativeLab ? "Canceled" : "Deleted"}\n\n**Task ID**: ${params.task_id}\n**Previous Status**: ${previousStatus}\n\n${message}`
          }],
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
      title: "Download Model or Image",
      description: `Save a finished task's output under meshy_output/ (project folders with history), or at save_to.

  - 3D tasks: ONE model format — ask the user which first (GLB viewing, OBJ white-model printing, 3MF multicolor printing, FBX game engines, USDZ AR, BLEND Blender); never download all. A format exists only if it was generated: 3mf needs target_formats ["3mf"] at creation, meshy_convert or meshy_process_multicolor.
  - Creative Lab: omit format to save every part.
  - Relief: the model in format (only the target_formats it was created with; OBJ with its MTL and texture) plus its depth map PNG. A depth-map-only task saves the depth map.
  - Images and text-to-motion clips save their own files and ignore format.
  - Rigging and animation tasks are not saved: they return their file URLs.
If a download fails, its URL is returned instead.

Example (print): { task_id: "abc-123", format: "obj", print_ready: true, print_height_mm: 100 }`,
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
        const { task, taskType } = await getTaskWithAutoInference(client, params.task_id, params.task_type);

        if (task.status !== TaskStatus.SUCCEEDED) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: Task is not completed yet. Current status: ${task.status}. Use meshy_get_task_status to check progress.`
            }]
          };
        }

        // Image-generation tasks (text-to-image / image-to-image) return image_urls (PNG/JPG),
        // not model_urls. Download the image(s) directly — the `format` arg is ignored here.
        const isImageTask =
          taskType === TaskType.TEXT_TO_IMAGE ||
          taskType === TaskType.IMAGE_TO_IMAGE ||
          (!task.model_urls && Array.isArray(task.image_urls) && task.image_urls.length > 0);
        if (isImageTask) {
          const imageUrls = task.image_urls || [];
          if (imageUrls.length === 0) {
            return {
              isError: true,
              content: [{ type: "text", text: "Error: Task completed but no image URLs are available." }]
            };
          }
          // Derive the file extension from the image URL (strip query); Meshy serves png/jpg/webp.
          const imgExt = (u: string) => {
            const m = u.split("?")[0].match(/\.(png|jpe?g|webp)$/i);
            return m ? `.${m[1].toLowerCase()}` : ".png";
          };

          const savedPaths: string[] = [];
          let projectDir: string | undefined;
          if (params.save_to) {
            const dir = path.dirname(params.save_to);
            const stem = path.basename(params.save_to, path.extname(params.save_to));
            for (let i = 0; i < imageUrls.length; i++) {
              const target = imageUrls.length === 1
                ? params.save_to
                : path.join(dir, `${stem}_${i}${imgExt(imageUrls[i])}`);
              await downloadFileToLocal(imageUrls[i], target);
              savedPaths.push(target);
            }
          } else {
            const stage = inferStage(taskType, task.type);
            projectDir = resolveProjectDir(
              params.task_id,
              taskType,
              task.prompt,
              params.parent_task_id,
              task.created_at
            );
            for (let i = 0; i < imageUrls.length; i++) {
              const ext = imgExt(imageUrls[i]);
              const target = path.join(projectDir, imageUrls.length === 1 ? `${stage}${ext}` : `${stage}_${i}${ext}`);
              await downloadFileToLocal(imageUrls[i], target);
              savedPaths.push(target);
            }
            const record: TaskRecord = {
              task_id: params.task_id,
              task_type: taskType,
              stage,
              prompt: task.prompt,
              status: task.status,
              files: savedPaths.map(p => path.basename(p)),
              created_at: new Date().toISOString()
            };
            recordTask(projectDir, record);
          }

          const output = {
            image_urls: imageUrls,
            local_paths: savedPaths,
            project_dir: projectDir,
            count: savedPaths.length,
            expires_at: expiresAt(task)
          };
          const textContent = `# Image(s) Downloaded

**Task ID**: ${params.task_id}
**Saved ${savedPaths.length} image(s)**:
${savedPaths.map(p => `- ${p}`).join("\n")}${projectDir ? `\n**Project Folder**: ${projectDir}` : ""}

${expiryNote(task)}`;
          return {
            content: [{ type: "text", text: textContent }],
            structuredContent: output
          };
        }

        const fmt = params.format ?? "glb";

        // Text-to-motion: one clip in result.motion_url (FBX for prime, BVH for swift).
        if (taskType === TaskType.TEXT_TO_MOTION) {
          const motionUrl = task.result?.motion_url;
          if (!motionUrl) {
            return { isError: true, content: [{ type: "text", text: "Error: Task completed but has no motion clip URL." }] };
          }
          const ext = `.${task.result?.motion_format || "fbx"}`;
          let target = params.save_to;
          let projectDir: string | undefined;
          if (!target) {
            projectDir = resolveProjectDir(params.task_id, taskType, task.prompt, params.parent_task_id, task.created_at);
            target = path.join(projectDir, `motion${ext}`);
          }
          const size = await downloadFileToLocal(motionUrl, target);
          if (projectDir) {
            recordTask(projectDir, {
              task_id: params.task_id,
              task_type: taskType,
              stage: "motion",
              prompt: task.prompt,
              status: task.status,
              files: [path.basename(target)],
              created_at: new Date().toISOString()
            });
          }
          return {
            content: [{
              type: "text",
              text: `# Motion Clip Downloaded

**Task ID**: ${params.task_id}
**Local File**: ${target}
**Format**: ${ext.slice(1).toUpperCase()}${projectDir ? `\n**Project Folder**: ${projectDir}` : ""}

${expiryNote(task)}`
            }],
            structuredContent: { download_url: motionUrl, local_path: target, project_dir: projectDir, file_size_bytes: size, format: ext.slice(1), expires_at: expiresAt(task) }
          };
        }

        if (taskType === TaskType.RELIEF) {
          return await downloadRelief(task, params);
        }

        // Creative Lab products can expose bespoke multi-part model_urls
        // (e.g. lamp → lamp_stl + base_stl, zip output → bundle_zip) that don't
        // match the standard `format` keys. Unless one available format was
        // asked for, download every available part.
        if (
          taskType.startsWith("creative-lab-") &&
          task.model_urls &&
          !(params.format && task.model_urls[params.format as keyof typeof task.model_urls])
        ) {
          const parts = (Object.entries(task.model_urls) as [string, string][]).filter(([, v]) => Boolean(v));
          if (parts.length > 0) {
            const modelExt = (u: string) => {
              const m = u.split("?")[0].match(/\.(glb|gltf|obj|mtl|fbx|usdz|stl|3mf|blend|zip)$/i);
              return m ? `.${m[1].toLowerCase()}` : "";
            };
            const clPaths: string[] = [];
            const notSaved: { part: string; url: string; error: string }[] = [];
            const saveCreativeLabPart = async (key: string, url: string, target: string) => {
              try {
                await downloadFileToLocal(url, target);
                clPaths.push(target);
              } catch (error) {
                notSaved.push({ part: key, url, error: error instanceof Error ? error.message : String(error) });
              }
            };
            let clProjectDir: string | undefined;
            if (params.save_to) {
              const dir = path.dirname(params.save_to);
              const stem = path.basename(params.save_to, path.extname(params.save_to));
              for (const [key, url] of parts) {
                const target = path.join(dir, `${stem}_${key}${modelExt(url)}`);
                await saveCreativeLabPart(key, url, target);
              }
            } else {
              const stage = inferStage(taskType, task.type);
              clProjectDir = resolveProjectDir(params.task_id, taskType, task.prompt, params.parent_task_id, task.created_at);
              for (const [key, url] of parts) {
                const target = path.join(clProjectDir, `${key}${modelExt(url)}`);
                await saveCreativeLabPart(key, url, target);
              }
              const record: TaskRecord = {
                task_id: params.task_id,
                task_type: taskType,
                stage,
                prompt: task.prompt,
                status: task.status,
                files: clPaths.map(p => path.basename(p)),
                created_at: new Date().toISOString()
              };
              recordTask(clProjectDir, record);
            }
            const output = {
              model_urls: task.model_urls,
              local_paths: clPaths,
              project_dir: clProjectDir,
              count: clPaths.length,
              not_saved: notSaved.length > 0 ? notSaved : undefined,
              expires_at: expiresAt(task)
            };
            const textContent = `# Creative Lab Product Downloaded

**Task ID**: ${params.task_id}
**Saved ${clPaths.length} file(s)**:
${clPaths.map(p => `- ${p}`).join("\n")}${clProjectDir ? `\n**Project Folder**: ${clProjectDir}` : ""}${notSaved.length > 0 ? `\n**Not saved** (download these URLs directly):\n${notSaved.map(n => `- ${n.part}: ${n.url} (${n.error})`).join("\n")}` : ""}

${expiryNote(task)}`;
            return {
              content: [{ type: "text", text: textContent }],
              structuredContent: output
            };
          }
        }

        // 3MF is supported, but only if it was actually generated for this task. 3MF is NOT
        // included by default — it must be requested at creation via target_formats: ["3mf"],
        // or produced by the multi-color print / convert tools.
        if (fmt === "3mf" && !task.model_urls?.["3mf" as keyof typeof task.model_urls]) {
          const available = task.model_urls ? Object.keys(task.model_urls).join(", ") : "none";
          return {
            isError: true,
            content: [{
              type: "text",
              text: `# 3MF Not Available For This Task

This task did not generate a 3MF file. 3MF is **not** included by default — it must be requested up front.

**How to get a 3MF**:
- **Regenerate / convert**: include \`"3mf"\` in \`target_formats\` on the generate/refine/remesh call, or run \`meshy_convert\` with \`target_formats: ["3mf"]\` on this task (1 credit).
- **Multi-color printing**: \`meshy_process_multicolor\` always outputs a 3MF directly.

**Available formats for this task**: ${available}. For single-color FDM printing, downloading \`stl\` (or converting to it) also works.`
            }]
          };
        }

        // Rigging tasks: result.rigged_character_{format}_url
        if (taskType === TaskType.RIGGING && task.result) {
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
            lines.push("**NOTE**: These animations were included FREE with rigging; no `meshy_animate` call is needed for them.");
            lines.push("");
          }

          lines.push(expiryNote(task, false));

          const output = {
            download_url: fmt === "fbx"
              ? task.result.rigged_character_fbx_url
              : task.result.rigged_character_glb_url,
            format: fmt,
            rigged_character_glb_url: task.result.rigged_character_glb_url,
            rigged_character_fbx_url: task.result.rigged_character_fbx_url,
            basic_animations: task.result.basic_animations,
            expires_at: expiresAt(task)
          };

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: output
          };
        }

        // Animation tasks: result.animation_{format}_url
        if (taskType === TaskType.ANIMATION && task.result) {
          const lines = [`# Animation Download URLs`, "", `**Task ID**: ${params.task_id}`, ""];

          lines.push("## Animation Files");
          if (task.result.animation_glb_url) lines.push(`- **GLB**: ${task.result.animation_glb_url}`);
          if (task.result.animation_fbx_url) lines.push(`- **FBX**: ${task.result.animation_fbx_url}`);
          if (task.result.processed_usdz_url) lines.push(`- **USDZ**: ${task.result.processed_usdz_url}`);
          if (task.result.processed_armature_fbx_url) lines.push(`- **Armature FBX**: ${task.result.processed_armature_fbx_url}`);
          if (task.result.processed_animation_fps_fbx_url) lines.push(`- **FPS-converted FBX**: ${task.result.processed_animation_fps_fbx_url}`);
          lines.push("");
          lines.push(expiryNote(task, false));

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
            expires_at: expiresAt(task)
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
        const stage = inferStage(taskType, task.type);
        let savePath: string;
        let projectDir: string | undefined;

        if (params.save_to) {
          savePath = params.save_to;
        } else {
          // Auto-save to meshy_output/{timestamp}_{prompt}_{id}/
          projectDir = resolveProjectDir(
            params.task_id,
            taskType,
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

          // Download textures. When a model carries many texture maps (e.g. a full PBR set),
          // group them in a dedicated subfolder so they don't scatter flat next to other files.
          const savedTextures: string[] = [];
          if (params.include_textures && textureUrls) {
            const texEntries = (Object.entries(textureUrls) as [string, string][])
              .filter(([, u]) => u && typeof u === "string");
            const manyTextures = texEntries.length > 2;
            const baseName = path.basename(savePath, path.extname(savePath));
            const texDir = manyTextures
              ? (projectDir ? path.join(projectDir, "textures") : path.join(path.dirname(savePath), `${baseName}_textures`))
              : undefined;
            for (const [texType, texUrl] of texEntries) {
              try {
                const texExt = texUrl.split("?")[0].toLowerCase().includes(".png") ? ".png" : ".jpg";
                let texPath: string;
                if (texDir) {
                  texPath = path.join(texDir, `${texType}${texExt}`);
                } else if (projectDir) {
                  texPath = getTextureFilePath(projectDir, stage, texType, texUrl);
                } else {
                  texPath = path.join(path.dirname(savePath), `${baseName}_${texType}${texExt}`);
                }
                await downloadFileToLocal(texUrl, texPath);
                savedTextures.push(texPath);
                savedFiles.push(texDir ? path.join(path.basename(texDir), path.basename(texPath)) : path.basename(texPath));
              } catch {
                // Texture download failed, continue
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
              task_type: taskType,
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
            expires_at: expiresAt(task)
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

          textContent += `\n\n${expiryNote(task)}`;

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
            expires_at: expiresAt(task)
          };

          return {
            content: [{
              type: "text",
              text: `# Download Failed — URLs Provided Instead

**Error**: ${errorMsg}

**Download URL** (use manually):
${downloadUrl}

${expiryNote(task, false)}`
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
