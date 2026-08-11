/**
 * Zod schemas for generation tools
 */

import { z } from "zod";
import {
  AIModel,
  ModelType,
  SmartTopologyModel,
  SymmetryMode,
  TextureResolution,
  Topology,
  PoseMode
} from "../constants.js";

/**
 * Shared target_formats schema.
 * 3MF is NOT included in default output — must be explicitly requested.
 */
const TargetFormatsSchema = z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"]))
  .optional()
  .describe("Output formats to generate. When omitted, produces glb/obj/fbx/stl/usdz but NOT 3mf. To get 3MF, you MUST include '3mf' explicitly (e.g. [\"glb\", \"3mf\"]). Specifying formats can reduce task completion time.");

/**
 * Shared optional parameters reused across generation/refine schemas.
 * Defined as factory functions so each schema gets a fresh ZodType instance.
 */
const decimationMode = () =>
  z.number().int().min(1).max(4).optional()
    .describe("Adaptive decimation polycount level (1=ultra, 2=high, 3=medium, 4=low). When set, target_polycount is ignored.");
const alphaThumbnail = () =>
  z.boolean().optional()
    .describe("Also render a transparent-background (RGBA) preview, returned as alpha_thumbnail_url. Default false.");
const hdTexture = () =>
  z.boolean().optional()
    .describe("DEPRECATED — use texture_resolution instead (hd_texture: true is exactly texture_resolution: '4k'). Kept for backward compatibility.");
const textureResolution = () =>
  z.nativeEnum(TextureResolution).optional()
    .describe("Base color texture resolution: '2k' (default), '4k', or '8k'. 8K costs 15 credits instead of 10 — confirm with the user before selecting it. Only supported on meshy-6 / meshy-7 / latest / smart-topology; PBR maps stay at 2K. Replaces the deprecated hd_texture flag.");
const multiViewThumbnails = () =>
  z.boolean().optional()
    .describe("Also return 4 cardinal-view thumbnails (front/back/left/right). Default false.");
const deprecatedSymmetryMode = () =>
  z.nativeEnum(SymmetryMode).optional()
    .describe("DEPRECATED — no longer affects output (kept for backward compatibility). Values: 'off', 'auto', 'on'.");
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
  ai_model: z.enum([AIModel.MESHY_5, AIModel.MESHY_6, AIModel.LATEST])
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default). NOTE: text-to-3d does NOT accept 'meshy-7', and its 'latest' still resolves to Meshy 6 (unlike image-to-3d, where latest is Meshy 7). IMPORTANT: Before calling this tool, ask the user which model to use and explain the differences: meshy-6/latest = best quality (20 credits), meshy-5 = previous gen (5 credits)"),
  model_type: z.enum([ModelType.STANDARD, ModelType.LOWPOLY])
    .optional()
    .describe("Model type: 'standard' or 'lowpoly' (smart-topology is image-to-3d only). When 'lowpoly', ai_model/topology/target_polycount/should_remesh are ignored"),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the model (100–300,000)"),
  decimation_mode: decimationMode(),
  symmetry_mode: deprecatedSymmetryMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character models: 'a-pose' or 't-pose'. IMPORTANT: When the user intends to rig or animate the model, default to 't-pose' for best rigging results"),
  target_formats: TargetFormatsSchema,
  alpha_thumbnail: alphaThumbnail(),
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
  input_task_id: z.string()
    .optional()
    .describe("Chain from a SUCCEEDED text-to-image or image-to-image task: use its generated image as the input instead of image_url/file_path. Provide only one image source."),
  ai_model: z.union([z.nativeEnum(AIModel), z.nativeEnum(SmartTopologyModel)])
    .optional()
    .describe("AI model. Standard generation: 'meshy-5', 'meshy-6', 'meshy-7', or 'latest' (default — resolves to Meshy 7 here). Smart Topology generation (set model_type: 'smart-topology'): 'meshy-t2' (default, recommended — native part separation) or 'meshy-t1'. IMPORTANT: Before calling this tool, ask the user which model to use and explain the trade-off: meshy-7/latest = best quality (20 credits mesh, 30 textured); meshy-t2 smart-topology = clean part-separated geometry and much cheaper (5 credits mesh, 15 textured); meshy-5 = previous gen (5 credits). NOTE: passing remove_lighting with 'latest' keeps the task on Meshy 6."),
  ultra_mode: z.boolean()
    .optional()
    .describe("Meshy 7 Ultra — run the extra high-detail geometry pass (+5 credits). Only valid when the task actually runs Meshy 7: pass ai_model 'meshy-7' explicitly (reliable), or 'latest' while latest resolves to Meshy 7. On meshy-5/meshy-6 the API returns 400. Single-image only — not available on multi-image-to-3d. Cannot be combined with model_type 'lowpoly'. Confirm the extra cost with the user first."),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("Model type: 'standard' (default), 'smart-topology' (part-separated geometry via meshy-t1/meshy-t2, much cheaper), or 'lowpoly' (deprecated — prefer smart-topology)"),
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
  decimation_mode: decimationMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  symmetry_mode: deprecatedSymmetryMode(),
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
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
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
  alpha_thumbnail: alphaThumbnail(),
  multi_view_thumbnails: multiViewThumbnails(),
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
  ai_model: z.enum([AIModel.MESHY_5, AIModel.MESHY_6, AIModel.LATEST])
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', or 'latest' (default). NOTE: text-to-3d does NOT accept 'meshy-7' and its 'latest' still resolves to Meshy 6. Texturing costs 10 credits at 2K/4K, 15 at 8K."),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  target_formats: TargetFormatsSchema,
  alpha_thumbnail: alphaThumbnail(),
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
  input_task_id: z.string()
    .optional()
    .describe("Chain from a SUCCEEDED text-to-image / image-to-image task that produced multi-view images, using them as the input instead of image_urls/file_paths."),
  ai_model: z.enum([AIModel.MESHY_5, AIModel.MESHY_6, AIModel.MESHY_7, AIModel.LATEST])
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', 'meshy-7', or 'latest' (default — resolves to Meshy 7). Smart Topology (meshy-t1/meshy-t2) and ultra_mode are single-image-only and NOT available here. IMPORTANT: Before calling this tool, ask the user which model to use: meshy-7/latest = best quality (20 credits mesh, 30 textured), meshy-5 = previous gen (5 credits)"),
  model_type: z.enum([ModelType.STANDARD, ModelType.LOWPOLY])
    .optional()
    .describe("Model type: 'standard' or 'lowpoly' (smart-topology is single-image-to-3d only)"),
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
  decimation_mode: decimationMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Whether to remesh. Default false for meshy-6, true for others"),
  symmetry_mode: deprecatedSymmetryMode(),
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
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
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
  alpha_thumbnail: alphaThumbnail(),
  multi_view_thumbnails: multiViewThumbnails(),
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height and resize the model. Default false."),
  origin_at: z.enum(["bottom", "center"])
    .optional()
    .describe("Origin position: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
  response_format: ResponseFormatSchema
}).strict();
