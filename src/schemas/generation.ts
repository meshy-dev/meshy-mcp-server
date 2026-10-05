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
    .describe("Base color texture resolution: 2k (default), 4k, or 8k. 4k/8k need meshy-6 / meshy-7.1 / latest / meshy-t2 (meshy-6-lite is 2k only). 8k adds 5 credits to the texture stage (15 instead of 10). PBR maps stay at 2K. Replaces hd_texture.");
const multiViewThumbnails = () =>
  z.boolean().optional()
    .describe("Also return 4 cardinal-view thumbnails (front/back/left/right). Default false.");
const geometryResolution = () =>
  z.enum(["standard", "2k", "4k"]).optional()
    .describe("Meshy 7.1 geometry pass: standard (default), 2k (Ultra, 2048³) or 4k (Ultra, 4096³, finest detail). 2k/4k need meshy-7.1/latest with model_type standard and add 5 credits. Confirm the surcharge with the user first.");
const deprecatedUltraMode = () =>
  z.boolean().optional()
    .describe("DEPRECATED — prefer geometry_resolution. true is equivalent to the 2k geometry pass; cannot conflict with geometry_resolution or be used with Smart Topology/lowpoly.");
const lightingRemoval = () =>
  z.boolean().optional()
    .describe("Remove highlights/shadows from the base color texture. Only honored on meshy-6 (API default true there); not sent for other models.");
const generationTexturePrompt = () =>
  z.string()
    .max(800, "Texture prompt must not exceed 800 characters")
    .optional()
    .describe("Text to guide texturing. Max 800 characters");
const deprecatedSymmetryMode = () =>
  z.nativeEnum(SymmetryMode).optional()
    .describe("DEPRECATED — no longer affects output (kept for backward compatibility). Values: 'off', 'auto', 'on'.");
import {
  ResponseFormatSchema,
  UrlSchema
} from "./common.js";

const GenerationPromptSchema = z.string()
  .min(2, "Prompt must be at least 2 characters")
  .max(800, "Prompt must not exceed 800 characters")
  .describe("Text description of the 3D model (max 800 characters)");

/**
 * Text-to-3D input schema
 */
export const TextTo3DInputSchema = z.object({
  prompt: GenerationPromptSchema,
  ai_model: z.enum([
    AIModel.LATEST, AIModel.MESHY_7_1, AIModel.MESHY_6, AIModel.MESHY_6_LITE,
    AIModel.MESHY_7, AIModel.MESHY_5, SmartTopologyModel.MESHY_T2
  ])
    .optional()
    .describe("Standard (model_type standard): 'latest' (default, = Meshy 7.1) or 'meshy-7.1' = best quality, 20 credits; 'meshy-6' = 20 credits; 'meshy-6-lite' = fast and cheap, 5 credits. 'meshy-7' is deprecated (use meshy-7.1); 'meshy-5' is deprecated and retires 2026-10-10 (use meshy-6-lite). Smart Topology (model_type smart-topology): 'meshy-t2' = clean part-separated triangle mesh at a set face count, 5 credits. Omitted ai_model defaults to latest, or to meshy-t2 under smart-topology. IMPORTANT: ask the user which model to use and confirm the cost first."),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("standard (default), smart-topology (T2, triangle-only), or deprecated lowpoly. Smart Topology ignores remesh and adaptive-decimation controls."),
  geometry_resolution: geometryResolution(),
  ultra_mode: deprecatedUltraMode(),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Standard remesh target: 100–300,000 faces. Supported T2 routes generate directly at 100–15,000 faces (default 4,000)."),
  decimation_mode: decimationMode(),
  symmetry_mode: deprecatedSymmetryMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Enable standard remeshing to apply a target count. Defaults false for Meshy 6/7/7.1. Ignored on Smart Topology routes."),
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
    .describe("Standard (model_type standard): 'latest' (default, = Meshy 7.1) or 'meshy-7.1' = best quality; 'meshy-6'; 'meshy-6-lite' = fast and cheap, 2K textures only. 'meshy-7' is deprecated (use meshy-7.1). Smart Topology (model_type smart-topology): 'meshy-t2' (default) = clean part-separated mesh at a set face count; legacy 'meshy-t1' still accepted. Credits: meshy-7.1/latest/meshy-6 20 mesh-only, 30 textured (35 at 8K); meshy-6-lite 5 / 15; meshy-t2 5 / 15 (20 at 8K). IMPORTANT: ask the user which model to use and confirm the cost first."),
  geometry_resolution: geometryResolution(),
  ultra_mode: deprecatedUltraMode(),
  model_type: z.nativeEnum(ModelType)
    .optional()
    .describe("Model type: 'standard' (default), 'smart-topology' (part-separated geometry via meshy-t1/meshy-t2), or deprecated 'lowpoly'. Prefer Smart Topology for controllable lower-poly generation; confirm current costs."),
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
    .describe("Standard remesh target: 100–300,000 faces. Supported T2 routes generate directly at 100–15,000 faces (default 4,000)."),
  decimation_mode: decimationMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Enable standard remeshing to apply a target count. Defaults false for Meshy 6/7/7.1. Ignored on Smart Topology routes."),
  symmetry_mode: deprecatedSymmetryMode(),
  should_texture: z.boolean()
    .optional()
    .describe("Whether to generate textures. Default true"),
  texture_prompt: generationTexturePrompt(),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  image_enhancement: z.boolean()
    .optional()
    .describe("Optimize input image. Supported on meshy-6, meshy-7.1, and latest. Set false to preserve deliberate source styling."),
  remove_lighting: lightingRemoval(),
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
  texture_prompt: generationTexturePrompt(),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  ai_model: z.nativeEnum(AIModel)
    .optional()
    .describe("Texture model override: 'meshy-7.1', 'latest' (= Meshy 7.1), 'meshy-6' or 'meshy-6-lite' (2K only). 'meshy-7' is deprecated. Omit (recommended) to inherit the preview's model. Do not pass meshy-t2 here. Texturing costs 10 credits (15 at 8K)."),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  remove_lighting: lightingRemoval(),
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
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe("'latest' (default, = Meshy 7.1) or 'meshy-7.1' = best quality; 'meshy-6'; 'meshy-6-lite' = fast and cheap, 2K textures only. 'meshy-7' is deprecated (use meshy-7.1). Smart Topology is not available here. Credits: meshy-7.1/latest/meshy-6 20 mesh-only, 30 textured (35 at 8K); meshy-6-lite 5 / 15. IMPORTANT: ask the user which model to use and confirm the cost first."),
  geometry_resolution: z.enum(["standard", "2k"]).optional()
    .describe("Meshy 7.1 geometry pass: standard (default) or 2k (Ultra, +5 credits). 4k is not available on multi-image. Needs meshy-7.1/latest. Confirm the surcharge first."),
  ultra_mode: deprecatedUltraMode(),
  model_type: z.enum([ModelType.STANDARD, ModelType.LOWPOLY])
    .optional()
    .describe("Model type: standard or deprecated lowpoly. Smart Topology is unavailable on multi-image generation."),
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
    .describe("Multi-image standard remesh target: 100–300,000 faces. Requires should_remesh true; decimation_mode takes precedence. Smart Topology is not supported on this endpoint."),
  decimation_mode: decimationMode(),
  should_remesh: z.boolean()
    .optional()
    .describe("Enable standard remeshing to apply a target count. Defaults false for Meshy 6/7/7.1."),
  symmetry_mode: deprecatedSymmetryMode(),
  should_texture: z.boolean()
    .optional()
    .describe("Whether to generate textures. Default true"),
  texture_prompt: generationTexturePrompt(),
  texture_image_url: UrlSchema
    .optional()
    .describe("Image URL to guide texturing"),
  texture_image_urls: z.array(z.string())
    .min(1)
    .max(4)
    .optional()
    .describe("Multi-view texture: 1–4 public URLs or data URIs of the SAME object from different views; element 0 is the front view. Guides texture only and is independent of image_urls. Requires meshy-7.1/latest; cannot be combined with texture_image_url or texture_prompt."),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  image_enhancement: z.boolean()
    .optional()
    .describe("Optimize input images. Supported on meshy-6, meshy-7.1, and latest. Set false to preserve source styling."),
  remove_lighting: z.boolean()
    .optional()
    .describe("Remove highlights/shadows from the base color texture. Honored on meshy-6, meshy-7.1 and latest (API default true); not sent for other models."),
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
