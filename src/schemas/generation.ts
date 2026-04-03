/**
 * Zod schemas for generation tools
 */

import { z } from "zod";
import { AIModel, ModelType, SymmetryMode, Topology, PoseMode } from "../constants.js";

/**
 * Shared target_formats schema.
 * 3MF is NOT included in default output — must be explicitly requested.
 */
const TargetFormatsSchema = z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"]))
  .optional()
  .describe("Output formats to generate. When omitted, produces glb/obj/fbx/stl/usdz but NOT 3mf. To get 3MF, you MUST include '3mf' explicitly (e.g. [\"glb\", \"3mf\"]). Specifying formats can reduce task completion time.");
import {
  ResponseFormatSchema,
  PromptSchema,
  UrlSchema
} from "./common.js";

/**
 * Text-to-3D input schema
 */
export const TextTo3DInputSchema = z.object({
  prompt: PromptSchema,
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default, currently resolves to Meshy 6). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (20 credits), meshy-5 = previous gen (5 credits)"),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("Model type: 'standard' or 'lowpoly'. When 'lowpoly', ai_model/topology/target_polycount/should_remesh are ignored"),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the model (100–300,000)"),
  symmetry_mode: z.nativeEnum(SymmetryMode)
    .optional()
    .describe("Symmetry mode: 'off', 'auto' (default), or 'on'"),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character models: 'a-pose' or 't-pose'. IMPORTANT: When the user intends to rig or animate the model, default to 't-pose' for best rigging results"),
  target_formats: TargetFormatsSchema,
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height and resize the model. Default false."),
  origin_at: z.enum(["bottom", "center"])
    .optional()
    .describe("Origin position: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-3D input schema
 */
export const ImageTo3DInputSchema = z.object({
  image_url: z.string()
    .optional()
    .describe("PUBLIC image URL (https://...). Use ONLY for remote images. For local files use file_path instead. NEVER manually base64-encode."),
  file_path: z.string()
    .optional()
    .describe("ABSOLUTE path to LOCAL image (.jpg/.png). PREFERRED for local files. Server auto-encodes. Example: /Users/me/photo.jpg. NEVER manually base64-encode."),
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default, currently resolves to Meshy 6). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (20 credits), meshy-5 = previous gen (5 credits)"),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("Model type: 'standard' or 'lowpoly'"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character models: 'a-pose' or 't-pose'. IMPORTANT: When the user intends to rig or animate the model, default to 't-pose' for best rigging results"),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Enable physically-based rendering textures. Default false"),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the model (100–300,000)"),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  symmetry_mode: z.nativeEnum(SymmetryMode)
    .optional()
    .describe("Symmetry mode: 'off', 'auto' (default), or 'on'"),
  should_texture: z.boolean()
    .optional()
    .describe("Whether to generate textures. Default true"),
  texture_prompt: z.string()
    .max(600)
    .optional()
    .describe("Text to guide texturing. Max 600 characters"),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  image_enhancement: z.boolean()
    .optional()
    .describe("Optimize input image for better results. Default true. Meshy-6/latest only"),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  save_pre_remeshed_model: z.boolean()
    .optional()
    .describe("Store GLB before remeshing. Default false. Only applies when should_remesh is true"),
  target_formats: TargetFormatsSchema,
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height and resize the model. Default false."),
  origin_at: z.enum(["bottom", "center"])
    .optional()
    .describe("Origin position: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Text-to-3D Refine input schema
 */
export const TextTo3DRefineInputSchema = z.object({
  preview_task_id: z.string()
    .min(1, "Preview task ID is required")
    .describe("Task ID of the completed preview task to refine"),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Enable physically-based rendering textures"),
  texture_prompt: z.string()
    .max(600, "Texture prompt must not exceed 600 characters")
    .optional()
    .describe("Text to guide texturing. Max 600 characters"),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default, currently resolves to Meshy 6). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (10 credits), meshy-5 = previous gen (10 credits)"),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  target_formats: TargetFormatsSchema,
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height and resize the model. Default false."),
  origin_at: z.enum(["bottom", "center"])
    .optional()
    .describe("Origin position: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Multi-image-to-3D input schema
 */
export const MultiImageTo3DInputSchema = z.object({
  image_urls: z.array(z.string())
    .min(1)
    .max(4)
    .optional()
    .describe("Array of 1–4 publicly accessible image URLs. Provide this OR file_paths, not both"),
  file_paths: z.array(z.string())
    .min(1)
    .max(4)
    .optional()
    .describe("Array of 1–4 absolute paths to local image files (.jpg, .jpeg, .png). The server reads and encodes them automatically"),
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default, currently resolves to Meshy 6). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (20 credits), meshy-5 = previous gen (5 credits)"),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("Model type: 'standard' or 'lowpoly'"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character models: 'a-pose' or 't-pose'. IMPORTANT: When the user intends to rig or animate the model, default to 't-pose' for best rigging results"),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Enable physically-based rendering textures. Default false"),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the model (100–300,000)"),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  symmetry_mode: z.nativeEnum(SymmetryMode)
    .optional()
    .describe("Symmetry mode: 'off', 'auto' (default), or 'on'"),
  should_texture: z.boolean()
    .optional()
    .describe("Whether to generate textures. Default true"),
  texture_prompt: z.string()
    .max(600)
    .optional()
    .describe("Text to guide texturing. Max 600 characters"),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  image_enhancement: z.boolean()
    .optional()
    .describe("Optimize input images for better results. Default true. Meshy-6/latest only"),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  save_pre_remeshed_model: z.boolean()
    .optional()
    .describe("Store GLB before remeshing. Default false. Only applies when should_remesh is true"),
  target_formats: TargetFormatsSchema,
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height and resize the model. Default false."),
  origin_at: z.enum(["bottom", "center"])
    .optional()
    .describe("Origin position: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
  response_format: ResponseFormatSchema
}).strict();
