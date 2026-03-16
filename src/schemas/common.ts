/**
 * Common Zod schemas shared across tools
 */

import { z } from "zod";
import { ResponseFormat, TaskType } from "../constants.js";

/**
 * Response format schema
 */
export const ResponseFormatSchema = z.nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

/**
 * Pagination schema
 */
export const PaginationSchema = z.object({
  limit: z.number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(20)
    .describe("Maximum number of results to return"),
  offset: z.number()
    .int()
    .min(0, "Offset cannot be negative")
    .default(0)
    .describe("Number of results to skip for pagination")
});

/**
 * Task ID schema
 */
export const TaskIdSchema = z.string()
  .min(1, "Task ID is required")
  .describe("Unique task identifier (UUID)");

/**
 * URL schema
 */
export const UrlSchema = z.string()
  .url("Must be a valid URL")
  .describe("Publicly accessible URL");

/**
 * Prompt schema
 */
export const PromptSchema = z.string()
  .min(2, "Prompt must be at least 2 characters")
  .max(600, "Prompt must not exceed 600 characters")
  .describe("Text description");

/**
 * Task type schema
 */
export const TaskTypeSchema = z.nativeEnum(TaskType)
  .default(TaskType.TEXT_TO_3D)
  .describe("Task type to determine correct API endpoint. Defaults to 'text-to-3d'");
