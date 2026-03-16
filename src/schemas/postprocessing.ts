/**
 * Zod schemas for post-processing tools (remesh, retexture, rig, animate)
 */

import { z } from "zod";
import { AIModel, RemeshFormat, OriginAt, Topology, AnimationPostProcessOp } from "../constants.js";
import { ResponseFormatSchema, UrlSchema } from "./common.js";

/**
 * Remesh input schema
 */
export const RemeshInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("Task ID of an existing completed task to remesh"),
  model_url: UrlSchema
    .optional()
    .describe("Direct URL to a model file to remesh"),
  target_formats: z.array(z.nativeEnum(RemeshFormat))
    .default([RemeshFormat.GLB])
    .describe("Output formats to generate (default: ['glb'])"),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the remeshed model (100–300,000)"),
  resize_height: z.number()
    .default(0)
    .describe("Resize model to this height in meters (0 = no resize)"),
  origin_at: z.nativeEnum(OriginAt)
    .optional()
    .describe("Where to place the model origin: 'bottom' or 'center'"),
  convert_format_only: z.boolean()
    .default(false)
    .describe("Only convert format without remeshing"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Retexture input schema
 */
export const RetextureInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("Task ID of an existing completed task to retexture"),
  model_url: UrlSchema
    .optional()
    .describe("Direct URL to a model file to retexture"),
  text_style_prompt: z.string()
    .max(600, "Prompt must not exceed 600 characters")
    .optional()
    .describe("Text prompt describing the desired texture style. Max 600 characters"),
  image_style_url: UrlSchema
    .optional()
    .describe("URL of an image to use as texture style reference"),
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default, currently resolves to Meshy 6). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (10 credits), meshy-5 = previous gen (10 credits)"),
  enable_original_uv: z.boolean()
    .default(true)
    .describe("Preserve the original UV mapping"),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Enable physically-based rendering textures"),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Rig (rigging) input schema
 */
export const RigInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("Task ID of an existing completed task to rig"),
  model_url: UrlSchema
    .optional()
    .describe("Direct URL to a model file to rig"),
  height_meters: z.number()
    .default(1.7)
    .describe("Height of the character in meters (default: 1.7)"),
  texture_image_url: UrlSchema
    .optional()
    .describe("URL of a texture image to apply to the model"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Animate input schema
 */
export const AnimateInputSchema = z.object({
  rig_task_id: z.string()
    .min(1, "Rig task ID is required")
    .describe("Task ID of the completed rigging task to animate"),
  action_id: z.number()
    .int("Action ID must be an integer")
    .describe("ID of the animation action to apply"),
  post_process: z.object({
    operation_type: z.nativeEnum(AnimationPostProcessOp)
      .describe("Post-processing operation to apply"),
    fps: z.union([
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(60)
    ])
      .optional()
      .describe("Target FPS for change_fps operation")
  })
    .optional()
    .describe("Optional post-processing to apply after animation"),
  response_format: ResponseFormatSchema
}).strict();
