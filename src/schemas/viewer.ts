/**
 * 3D viewer input schema
 */

import { z } from "zod";
import { TaskIdSchema, TaskTypeSchema } from "./common.js";

export const ViewModelInputSchema = z.object({
  task_id: TaskIdSchema.optional()
    .describe("Finished task whose model to show (the server fetches its GLB; nothing is saved)."),
  task_type: TaskTypeSchema,
  file_path: z.string()
    .optional()
    .describe("Instead of task_id: absolute path to a local .glb file, e.g. one meshy_download_model saved. Local (stdio) server only.")
}).strict();

/** The viewer alone (MESHY_TOOLS=viewer): local files only, no task lookups. */
export const ViewLocalModelInputSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the local .glb file to show.")
}).strict();
