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
  [TaskType.MULTI_COLOR_PRINT]: "/openapi/v1/print/multi-color",
  [TaskType.PRINT_ANALYZE]: "/openapi/v1/print/analyze",
  [TaskType.PRINT_REPAIR]: "/openapi/v1/print/repair"
};

/**
 * All endpoint base paths in priority order for auto-inference
 */
export const ALL_TASK_ENDPOINTS = Object.values(TASK_ENDPOINTS);

/**
 * Task types that have list endpoints (excludes rigging and animation which have no list API)
 */
export const LIST_CAPABLE_TASK_TYPES: TaskType[] = [
  TaskType.TEXT_TO_3D,
  TaskType.IMAGE_TO_3D,
  TaskType.MULTI_IMAGE_TO_3D,
  TaskType.REMESH,
  TaskType.RETEXTURE,
  TaskType.TEXT_TO_IMAGE,
  TaskType.IMAGE_TO_IMAGE,
  TaskType.MULTI_COLOR_PRINT,
  TaskType.PRINT_ANALYZE,
  TaskType.PRINT_REPAIR
];

/**
 * Map task type to its API endpoint base path
 */
export function getTaskEndpoint(taskType: TaskType): string {
  return TASK_ENDPOINTS[taskType];
}
