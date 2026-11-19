/**
 * Output schemas for MCP structured content.
 * These define the shape of structuredContent returned by tools.
 */

import { z } from "zod";

/**
 * Output schema for task creation tools (text-to-3d, image-to-3d, remesh, etc.)
 */
export const TaskCreatedOutputSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  message: z.string(),
  estimated_time: z.string()
});

/**
 * Output schema for meshy_check_balance
 */
export const BalanceOutputSchema = z.object({
  balance: z.number().describe("Credits available now (usually monthly_credits + permanent_credits; lower when a member or workspace credit limit applies)"),
  monthly_credits: z.number().optional().describe("Credits that expire at the next monthly refresh"),
  permanent_credits: z.number().optional().describe("Credits that never expire (credit packs, rewards)"),
  monthly_resets_at: z.string().optional().describe("Next monthly refresh (ISO 8601); omitted when none is scheduled")
});

/**
 * Output schema for meshy_get_task_status
 * Covers all outcomes: SUCCEEDED, FAILED, CANCELED, TIMEOUT, IN_PROGRESS, PENDING
 */
export const TaskStatusOutputSchema = z.object({
  outcome: z.enum(["SUCCEEDED", "FAILED", "CANCELED", "TIMEOUT", "IN_PROGRESS", "PENDING"])
    .describe("Outcome of this call; TIMEOUT means the wait ended, not the task"),
  task_id: z.string(),
  task_type: z.string().optional().describe("The task's actual type (pass it as task_type to the download and cancel tools)"),
  status: z.string(),
  progress: z.number().describe("0–100"),
  // wait mode fields
  wait_time_seconds: z.number().optional(),
  poll_count: z.number().optional(),
  // success fields
  model_urls: z.record(z.string()).optional(),
  image_urls: z.array(z.string()).optional(),
  vertex_count: z.number().optional(),
  face_count: z.number().optional(),
  thumbnail_url: z.string().optional(),
  alpha_thumbnail_url: z.string().optional(),
  depth_map_url: z.string().optional().describe("Relief: the 16-bit grayscale depth map (PNG, relative heights)"),
  printability: z.record(z.unknown()).optional().describe("print-analyze result: status, issue counts, metrics, thin walls"),
  part_count: z.number().optional().describe("Auto Split: number of parts"),
  prompt_ignored: z.boolean().optional().describe("Auto Split: the prompt was unreadable, so the cuts were chosen automatically"),
  result: z.record(z.unknown()).optional().describe("Rigging, animation and text-to-motion file URLs"),
  consumed_credits: z.number().optional().describe("Credits consumed by the task (0 for FAILED — credits are refunded on failure)"),
  // error fields
  error_type: z.string().optional().describe("Failure category if the task failed: invalid_input (fix the input), timeout / service_unavailable / server_error (refunded; create it again)"),
  error_code: z.string().optional().describe("e.g. image_too_complex"),
  error_message: z.string().optional(),
  error_doc_url: z.string().optional().describe("Resolution guide for error_code")
});
