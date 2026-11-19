/**
 * Shared task endpoint mapping
 */

import { TaskType } from "../constants.js";

const TASK_ENDPOINTS: Record<TaskType, string> = {
  [TaskType.TEXT_TO_3D]: "/openapi/v2/text-to-3d",
  [TaskType.IMAGE_TO_3D]: "/openapi/v1/image-to-3d",
  [TaskType.MULTI_IMAGE_TO_3D]: "/openapi/v1/multi-image-to-3d",
  [TaskType.REMESH]: "/openapi/v1/remesh",
  [TaskType.RETEXTURE]: "/openapi/v1/retexture",
  [TaskType.RIGGING]: "/openapi/v1/rigging",
  [TaskType.ANIMATION]: "/openapi/v1/animations",
  [TaskType.TEXT_TO_IMAGE]: "/openapi/v1/text-to-image",
  [TaskType.IMAGE_TO_IMAGE]: "/openapi/v1/image-to-image",
  [TaskType.CONVERT]: "/openapi/v1/convert",
  [TaskType.RESIZE]: "/openapi/v1/resize",
  [TaskType.UV_UNWRAP]: "/openapi/v1/uv-unwrap",
  [TaskType.MULTI_COLOR_PRINT]: "/openapi/v1/print/multi-color",
  [TaskType.PRINT_ANALYZE]: "/openapi/v1/print/analyze",
  [TaskType.PRINT_REPAIR]: "/openapi/v1/print/repair",
  [TaskType.PRINT_SPLIT]: "/openapi/v1/print/split",
  [TaskType.TEXT_TO_MOTION]: "/openapi/v1/text-to-motion",
  [TaskType.RELIEF]: "/openapi/v1/relief",
  // Creative Lab — stage-specific bases. base+"/:id" = GET status, base alone = list, base = POST create.
  [TaskType.CREATIVE_LAB_FIGURE_PROTOTYPE]: "/openapi/creative-lab/figure/v1/prototype",
  [TaskType.CREATIVE_LAB_FIGURE_BUILD]: "/openapi/creative-lab/figure/v1/build",
  [TaskType.CREATIVE_LAB_LAMP_PROTOTYPE]: "/openapi/creative-lab/lamp/v1/prototype",
  [TaskType.CREATIVE_LAB_LAMP_BUILD]: "/openapi/creative-lab/lamp/v1/build",
  [TaskType.CREATIVE_LAB_KEYCHAIN_PROTOTYPE]: "/openapi/creative-lab/keychain/v1/prototype",
  [TaskType.CREATIVE_LAB_KEYCHAIN_BUILD]: "/openapi/creative-lab/keychain/v1/build",
  [TaskType.CREATIVE_LAB_FRIDGE_MAGNET_PROTOTYPE]: "/openapi/creative-lab/fridge-magnet/v1/prototype",
  [TaskType.CREATIVE_LAB_FRIDGE_MAGNET_BUILD]: "/openapi/creative-lab/fridge-magnet/v1/build",
  [TaskType.CREATIVE_LAB_VINYL_FIGURE_PROTOTYPE]: "/openapi/creative-lab/vinyl-figure/v1/prototype",
  [TaskType.CREATIVE_LAB_VINYL_FIGURE_BUILD]: "/openapi/creative-lab/vinyl-figure/v1/build",
  [TaskType.CREATIVE_LAB_BRICK_FIGURE_PROTOTYPE]: "/openapi/creative-lab/brick-figure/v1/prototype",
  [TaskType.CREATIVE_LAB_BRICK_FIGURE_BUILD]: "/openapi/creative-lab/brick-figure/v1/build",
  [TaskType.CREATIVE_LAB_KEYCAP_PROTOTYPE]: "/openapi/creative-lab/keycap/v1/prototype",
  [TaskType.CREATIVE_LAB_KEYCAP_BUILD]: "/openapi/creative-lab/keycap/v1/build",
  [TaskType.CREATIVE_LAB_FIDGET_PIXEL_PROTOTYPE]: "/openapi/creative-lab/fidget-pixel/v1/prototype",
  [TaskType.CREATIVE_LAB_FIDGET_PIXEL_BUILD]: "/openapi/creative-lab/fidget-pixel/v1/build",
  [TaskType.CREATIVE_LAB_FIDGET_COLLAPSIBLE]: "/openapi/creative-lab/fidget-collapsible/v1"
};

/**
 * Order in which to probe for a task of unknown type.
 *
 * Several GET routes are not scoped to their task type: text-to-3d, image-to-3d,
 * multi-image-to-3d, retexture and print/repair return any of the caller's
 * tasks, shaped for that route (a text-to-3d probe turns a rigging task into a
 * text-to-3d one, with no rig result). getTaskWithAutoInference therefore reads
 * the task's own `type` and re-fetches it from that type's route. Image-to-3d
 * goes first because it answers for every task except Creative Lab and
 * text-to-motion; text-to-3d goes last.
 */
export const PROBE_TASK_TYPES: TaskType[] = [
  TaskType.IMAGE_TO_3D,
  ...(Object.keys(TASK_ENDPOINTS) as TaskType[]).filter(
    t => t !== TaskType.IMAGE_TO_3D && t !== TaskType.TEXT_TO_3D
  ),
  TaskType.TEXT_TO_3D
];

/**
 * The API's own names for task types that this server spells differently. The
 * API puts them in a task's `type` field;
 * accepting them as task_type lets an agent pass that value straight back.
 */
const API_TYPE_ALIASES: Record<string, TaskType> = {
  "text-to-3d-preview": TaskType.TEXT_TO_3D,
  "text-to-3d-refine": TaskType.TEXT_TO_3D,
  "rig": TaskType.RIGGING,
  "animate": TaskType.ANIMATION,
  "print-multi-color": TaskType.MULTI_COLOR_PRINT
};

const TASK_TYPE_VALUES = new Set<string>(Object.values(TaskType));

/** This server's TaskType for a task_type input or an API `type` value, or undefined. */
export function toTaskType(value: unknown): TaskType | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (TASK_TYPE_VALUES.has(key)) return key as TaskType;
  return API_TYPE_ALIASES[key];
}

/**
 * Every task type has a list endpoint (GET on its base path).
 */
export const LIST_CAPABLE_TASK_TYPES = Object.keys(TASK_ENDPOINTS) as TaskType[];

/** What meshy_list_tasks queries when no type is given: generation and image tasks. */
export const DEFAULT_LIST_TASK_TYPES: TaskType[] = [
  TaskType.TEXT_TO_3D,
  TaskType.IMAGE_TO_3D,
  TaskType.MULTI_IMAGE_TO_3D,
  TaskType.TEXT_TO_IMAGE,
  TaskType.IMAGE_TO_IMAGE
];

/** Types whose own output is not a 3D model: images, motion clips, analyses, Creative Lab prototypes. */
const NON_MODEL_TASK_TYPES = new Set<TaskType>([
  TaskType.TEXT_TO_IMAGE,
  TaskType.IMAGE_TO_IMAGE,
  TaskType.TEXT_TO_MOTION,
  TaskType.PRINT_ANALYZE
]);

/** Task types that produce a downloadable 3D model. */
export const MODEL_TASK_TYPES = LIST_CAPABLE_TASK_TYPES.filter(
  t => !NON_MODEL_TASK_TYPES.has(t) && !t.endsWith("-prototype")
) as [TaskType, ...TaskType[]];

/**
 * Map task type to its API endpoint base path
 */
export function getTaskEndpoint(taskType: TaskType): string {
  return TASK_ENDPOINTS[taskType];
}
