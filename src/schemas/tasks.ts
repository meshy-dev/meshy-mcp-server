/**
 * Zod schemas for task management tools
 */

import { z } from "zod";
import { TaskStatus, TaskPhase, TaskType, POLL_MAX_TIMEOUT } from "../constants.js";
import { MODEL_TASK_TYPES, toTaskType } from "../utils/endpoints.js";
import { ResponseFormatSchema, PaginationSchema, TaskIdSchema, TaskTypeSchema, TaskTypeFilterSchema } from "./common.js";

/**
 * Get task status input schema (also supports wait mode)
 */
export const GetTaskStatusInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  wait: z.boolean()
    .default(true)
    .describe("true (default): poll until it finishes; false: return the current status."),
  timeout_seconds: z.number()
    .int()
    .min(10, "Timeout must be at least 10 seconds")
    .max(POLL_MAX_TIMEOUT / 1000, `Timeout cannot exceed ${POLL_MAX_TIMEOUT / 1000} seconds`)
    .default(300)
    .describe("Max wait for this call when wait=true; the task keeps running after it."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * List tasks input schema
 */
export const ListTasksInputSchema = z.object({
  task_type: TaskTypeFilterSchema.optional()
    .describe("One task type to list (same names as meshy_get_task_status)."),
  task_types: z.array(TaskTypeFilterSchema)
    .min(1)
    .optional()
    .describe("Task types to list, merged with task_type. Default: text-to-3d, image-to-3d, multi-image-to-3d, text-to-image, image-to-image."),
  sort_by: z.enum(["+created_at", "-created_at"])
    .default("-created_at")
    .describe("'-created_at' newest first (default) or '+created_at'"),
  status: z.nativeEnum(TaskStatus)
    .optional()
    .describe("Only tasks with this status"),
  phase: z.nativeEnum(TaskPhase)
    .optional()
    .describe("Only tasks in this phase"),
  response_format: ResponseFormatSchema
}).merge(PaginationSchema).strict();

/**
 * Cancel task input schema
 */
export const CancelTaskInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  confirm_delete: z.boolean()
    .optional()
    .describe("true to permanently delete a finished task, only after the user agreed.")
}).strict();

/**
 * Download model input schema
 */
export const DownloadModelInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  format: z.enum(["glb", "fbx", "usdz", "stl", "obj", "blend", "3mf"])
    .optional()
    .describe("Model format (default glb, or a relief's first format when it has no GLB; omit for every Creative Lab part)."),
  include_textures: z.boolean()
    .default(true)
    .describe("Also save the texture maps"),
  save_to: z.string()
    .optional()
    .describe("Absolute file path to save to instead of meshy_output/{timestamp}_{prompt}_{id}/"),
  parent_task_id: z.string()
    .optional()
    .describe("Earlier task of the same chain (e.g. the preview of a refine); saves into its project folder, where files of the same stage replace each other, so pass only a task of this chain."),
  print_ready: z.boolean()
    .optional()
    .describe("OBJ only: rotate Y-up to Z-up, scale to print_height_mm, center, bottom at Z=0. Changes only the local file (free); meshy_resize (1 credit) rescales the model on Meshy."),
  print_height_mm: z.number()
    .optional()
    .describe("Height in mm with print_ready (default 75; '15 cm' → 150).")
}).strict();

/**
 * List models input schema
 */
export const ListModelsInputSchema = z.object({
  task_types: z.array(z.preprocess(value => toTaskType(value) ?? value, z.enum(MODEL_TASK_TYPES)))
    .min(1)
    .default([TaskType.IMAGE_TO_3D])
    .describe("Model task types to list (default [\"image-to-3d\"], one request). Pass several, e.g. [\"text-to-3d\", \"image-to-3d\", \"multi-image-to-3d\"], to widen; each type is one more request."),
  workspace_id: z.string()
    .optional()
    .describe("Deprecated; ignored."),
  filter: z.enum(["all", "published", "private"])
    .optional()
    .describe("Deprecated; ignored."),
  response_format: ResponseFormatSchema
}).merge(PaginationSchema).strict();
