/**
 * Output directory manager for Meshy generation tasks.
 *
 * Organizes all downloaded files under {cwd}/meshy_output/ with:
 *   - Per-project folders: {YYYYMMDD_HHmmss}_{prompt_slug}_{task_id_prefix}/
 *   - Auto-downloaded thumbnails
 *   - Per-project metadata.json tracking task chains
 *   - Global history.json index
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";

const OUTPUT_DIR_NAME = "meshy_output";

// ─── Types ───────────────────────────────────────────────────────────

export interface TaskRecord {
  task_id: string;
  task_type: string;
  stage: string;
  prompt?: string;
  status: string;
  files: string[];
  created_at: string;
}

interface ProjectMetadata {
  project_name: string;
  folder: string;
  root_task_id: string;
  created_at: string;
  updated_at: string;
  tasks: TaskRecord[];
}

interface HistoryEntry {
  folder: string;
  prompt: string;
  task_type: string;
  root_task_id: string;
  created_at: string;
  updated_at: string;
  task_count: number;
}

interface HistoryFile {
  version: number;
  projects: HistoryEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getOutputRoot(): string {
  return path.join(process.cwd(), OUTPUT_DIR_NAME);
}

/**
 * Sanitize a prompt into a filesystem-safe slug (max 30 chars).
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")  // keep CJK chars
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
}

/**
 * Format a date as YYYYMMDD_HHmmss in local timezone.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Infer a human-readable stage name from task type and API response type field.
 */
export function inferStage(taskType: string, apiType?: string): string {
  if (apiType) {
    if (apiType.includes("preview")) return "preview";
    if (apiType.includes("refine")) return "refined";
  }
  switch (taskType) {
    case "text-to-3d": return "model";
    case "image-to-3d": return "model";
    case "multi-image-to-3d": return "model";
    case "remesh": return "remeshed";
    case "retexture": return "retextured";
    case "rigging": return "rigged";
    case "animation": return "animated";
    case "multi-color-print": return "multicolor";
    default: return "model";
  }
}

// ─── Core Functions ──────────────────────────────────────────────────

/**
 * Ensure the output root directory exists.
 */
function ensureOutputRoot(): string {
  const root = getOutputRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

/**
 * Find an existing project folder by root_task_id (for chained tasks like refine/rig/animate).
 */
function findProjectByRootTask(rootTaskId: string): string | null {
  const root = getOutputRoot();
  if (!fs.existsSync(root)) return null;

  const historyPath = path.join(root, "history.json");
  if (!fs.existsSync(historyPath)) return null;

  try {
    const history: HistoryFile = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const entry = history.projects.find(p => p.root_task_id === rootTaskId);
    if (entry) {
      const fullPath = path.join(root, entry.folder);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  } catch {
    // Corrupted history, ignore
  }
  return null;
}

/**
 * Find an existing project folder that contains a specific task_id.
 */
function findProjectByTaskId(taskId: string): string | null {
  const root = getOutputRoot();
  if (!fs.existsSync(root)) return null;

  const historyPath = path.join(root, "history.json");
  if (!fs.existsSync(historyPath)) return null;

  try {
    const history: HistoryFile = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    for (const entry of history.projects) {
      const metaPath = path.join(root, entry.folder, "metadata.json");
      if (!fs.existsSync(metaPath)) continue;
      const meta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (meta.tasks.some(t => t.task_id === taskId)) {
        return path.join(root, entry.folder);
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Resolve (or create) the project directory for a task.
 *
 * For chained tasks (refine → preview, rig → source), pass parentTaskId
 * to place the output in the same project folder as the parent.
 */
export function resolveProjectDir(
  taskId: string,
  taskType: string,
  prompt?: string,
  parentTaskId?: string,
  createdAt?: string | number
): string {
  const root = ensureOutputRoot();

  // 1. Check if this task already has a project folder
  const existing = findProjectByTaskId(taskId);
  if (existing) return existing;

  // 2. Check if parent task has a project folder (for chained tasks)
  if (parentTaskId) {
    const parentDir = findProjectByTaskId(parentTaskId);
    if (parentDir) return parentDir;

    const parentRoot = findProjectByRootTask(parentTaskId);
    if (parentRoot) return parentRoot;
  }

  // 3. Create new project folder: {YYYYMMDD_HHmmss}_{prompt_slug}_{task_id_prefix}
  const date = createdAt ? new Date(typeof createdAt === "number" ? createdAt : createdAt) : new Date();
  const timestamp = formatTimestamp(date);
  const slug = prompt ? slugify(prompt) : taskType;
  const idPrefix = taskId.slice(0, 8);
  const folderName = `${timestamp}_${slug}_${idPrefix}`;

  const projectDir = path.join(root, folderName);
  fs.mkdirSync(projectDir, { recursive: true });

  // Initialize metadata.json
  const metadata: ProjectMetadata = {
    project_name: prompt || taskType,
    folder: folderName,
    root_task_id: taskId,
    created_at: date.toISOString(),
    updated_at: date.toISOString(),
    tasks: []
  };
  fs.writeFileSync(
    path.join(projectDir, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  // Update global history
  updateHistory(folderName, {
    folder: folderName,
    prompt: prompt || "",
    task_type: taskType,
    root_task_id: taskId,
    created_at: date.toISOString(),
    updated_at: date.toISOString(),
    task_count: 0
  });

  return projectDir;
}

/**
 * Generate the file path for a model download within a project directory.
 * Returns: /path/to/project/stage.ext (e.g., preview.glb, refined.glb)
 */
export function getFilePath(projectDir: string, stage: string, format: string): string {
  return path.join(projectDir, `${stage}.${format}`);
}

/**
 * Generate texture file path within a project directory.
 * Returns: /path/to/project/stage_texType.ext (e.g., refined_base_color.png)
 */
export function getTextureFilePath(
  projectDir: string,
  stage: string,
  textureType: string,
  url: string
): string {
  const ext = url.includes(".png") ? ".png" : ".jpg";
  return path.join(projectDir, `${stage}_${textureType}${ext}`);
}

/**
 * Record a completed task into the project's metadata.json.
 */
export function recordTask(projectDir: string, record: TaskRecord): void {
  const metaPath = path.join(projectDir, "metadata.json");
  let metadata: ProjectMetadata;

  if (fs.existsSync(metaPath)) {
    metadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } else {
    metadata = {
      project_name: record.prompt || record.task_type,
      folder: path.basename(projectDir),
      root_task_id: record.task_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tasks: []
    };
  }

  // Avoid duplicate records
  if (!metadata.tasks.some(t => t.task_id === record.task_id && t.stage === record.stage)) {
    metadata.tasks.push(record);
  }
  metadata.updated_at = new Date().toISOString();

  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  // Update history task count
  const folderName = path.basename(projectDir);
  const root = getOutputRoot();
  const historyPath = path.join(root, "history.json");
  if (fs.existsSync(historyPath)) {
    try {
      const history: HistoryFile = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      const entry = history.projects.find(p => p.folder === folderName);
      if (entry) {
        entry.task_count = metadata.tasks.length;
        entry.updated_at = metadata.updated_at;
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Download and save thumbnail to the project directory.
 * Silently skips on failure.
 */
export async function saveThumbnail(projectDir: string, thumbnailUrl: string): Promise<string | null> {
  const thumbPath = path.join(projectDir, "thumbnail.png");
  // Skip if already downloaded
  if (fs.existsSync(thumbPath)) return thumbPath;

  try {
    const response = await axios.get(thumbnailUrl, {
      responseType: "arraybuffer",
      timeout: 15000
    });
    fs.writeFileSync(thumbPath, Buffer.from(response.data));
    return thumbPath;
  } catch {
    return null;
  }
}

/**
 * Update (or create) the global history.json index.
 */
function updateHistory(folderName: string, entry: HistoryEntry): void {
  const root = ensureOutputRoot();
  const historyPath = path.join(root, "history.json");

  let history: HistoryFile;
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    } catch {
      history = { version: 1, projects: [] };
    }
  } else {
    history = { version: 1, projects: [] };
  }

  // Update existing or add new
  const idx = history.projects.findIndex(p => p.folder === folderName);
  if (idx >= 0) {
    history.projects[idx] = { ...history.projects[idx], ...entry };
  } else {
    history.projects.push(entry);
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Get the output root path (for display purposes).
 */
export function getOutputRootPath(): string {
  return getOutputRoot();
}
