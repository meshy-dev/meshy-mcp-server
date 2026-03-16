/**
 * Output schemas for MCP structured content.
 * These define the shape of structuredContent returned by tools.
 */

import { z } from "zod";

/**
 * Output schema for task creation tools (text-to-3d, image-to-3d, remesh, etc.)
 */
export const TaskCreatedOutputSchema = z.object({
  task_id: z.string().describe("Unique task identifier for polling with meshy_get_task_status"),
  status: z.string().describe("Initial task status (typically 'PENDING')"),
  message: z.string().describe("Human-readable status message"),
  estimated_time: z.string().describe("Estimated completion time")
});

/**
 * Output schema for meshy_check_balance
 */
export const BalanceOutputSchema = z.object({
  balance: z.number().describe("Current credit balance")
});

/**
 * Output schema for meshy_get_task_status
 * Covers all outcomes: SUCCEEDED, FAILED, CANCELED, TIMEOUT, IN_PROGRESS, PENDING
 */
export const TaskStatusOutputSchema = z.object({
  outcome: z.enum(["SUCCEEDED", "FAILED", "CANCELED", "TIMEOUT", "IN_PROGRESS", "PENDING"])
    .describe("Final outcome of the status check"),
  task_id: z.string().describe("Task identifier"),
  status: z.string().describe("Current task status from the API"),
  progress: z.number().describe("Progress percentage (0-100)"),
  // wait mode fields
  wait_time_seconds: z.number().optional().describe("Total wait time in seconds (wait mode only)"),
  poll_count: z.number().optional().describe("Number of polls performed (wait mode only)"),
  // success fields
  model_urls: z.record(z.string()).optional().describe("Available model download URLs"),
  vertex_count: z.number().optional().describe("Number of vertices in the model"),
  face_count: z.number().optional().describe("Number of faces in the model"),
  // error fields
  error_code: z.string().optional().describe("Error code if task failed"),
  error_message: z.string().optional().describe("Error message if task failed")
});
