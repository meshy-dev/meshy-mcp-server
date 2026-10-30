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
import {
  ResponseFormatSchema,
  UrlSchema
} from "./common.js";

/**
 * Shared optional parameters reused across generation/refine schemas.
 * Defined as factory functions so each schema gets a fresh ZodType instance.
 * 3MF is NOT included in the default output — it must be requested.
 */
const targetFormats = () =>
  z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"])).optional()
    .describe("Formats to produce (default: all but 3mf; list '3mf' to get it). Fewer formats finish faster.");
const decimationMode = () =>
  z.number().int().min(1).max(4).optional()
    .describe("Adaptive decimation 1 (ultra) – 4 (low); overrides target_polycount.");
const alphaThumbnail = () =>
  z.boolean().optional()
    .describe("Also return a transparent-background preview (alpha_thumbnail_url).");
const hdTexture = () =>
  z.boolean().optional()
    .describe("Deprecated: use texture_resolution '4k'.");
const textureResolution = () =>
  z.nativeEnum(TextureResolution).optional()
    .describe("Base color texture: 2k (default), 4k or 8k (+5 credits; PBR maps stay 4K, no emission map). 4k/8k not on meshy-6-lite.");
const multiViewThumbnails = () =>
  z.boolean().optional()
    .describe("Also return front/back/left/right thumbnails.");
const geometryResolution = () =>
  z.enum(["standard", "2k", "4k"]).optional()
    .describe("Ultra geometry pass: standard (default), 2k or 4k (finest); meshy-7.1/latest with model_type standard only, +5 credits.");
const deprecatedUltraMode = () =>
  z.boolean().optional()
    .describe("Deprecated: use geometry_resolution '2k'.");
const lightingRemoval = () =>
  z.boolean().optional()
    .describe("Remove highlights/shadows from the base color (meshy-6 only; API default true there).");
const generationTexturePrompt = () =>
  z.string()
    .max(800, "Texture prompt must not exceed 800 characters")
    .optional()
    .describe("Text to guide texturing (max 800 characters).");
const textureImageUrl = () =>
  UrlSchema.optional().describe("Image URL to guide texturing.");
const deprecatedSymmetryMode = () =>
  z.nativeEnum(SymmetryMode).optional()
    .describe("Deprecated: has no effect.");
const poseMode = () =>
  z.nativeEnum(PoseMode).optional()
    .describe("'a-pose' or 't-pose'; use 't-pose' when the model will be rigged or animated.");
const topology = () =>
  z.nativeEnum(Topology).optional()
    .describe("quad or triangle (default).");
const polycount = (describe: string) =>
  z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe(describe);
const shouldRemesh = () =>
  z.boolean().optional()
    .describe("Remesh to target_polycount / topology (default false).");
const shouldTexture = () =>
  z.boolean().optional()
    .describe("Generate textures (default true); false gives a cheaper untextured mesh.");
const enablePbr = () =>
  z.boolean().default(false)
    .describe("Also make metallic/roughness/normal maps.");
const imageEnhancement = () =>
  z.boolean().optional()
    .describe("Optimize the input image (meshy-6/7.1/latest); false keeps deliberate styling.");
const savePreRemeshed = () =>
  z.boolean().optional()
    .describe("Also keep the GLB from before remeshing (with should_remesh).");
const autoSize = () =>
  z.boolean().optional()
    .describe("AI-estimate the real-world height and resize to it (default false).");
const originAt = () =>
  z.enum(["bottom", "center"]).optional()
    .describe("'bottom' or 'center' (default bottom with auto_size).");
const modelType = () =>
  z.nativeEnum(ModelType).optional()
    .describe("standard (default); smart-topology (ai_model meshy-t2 or meshy-t2.5): a clean, part-separated, triangle-only mesh made directly at target_polycount, ignoring remesh/decimation. lowpoly (Meshy T1) is retired: use smart-topology with meshy-t2.5.");

const STANDARD_MODELS = "'latest' (default, = Meshy 7.1) or 'meshy-7.1' (best), 'meshy-6', 'meshy-6-lite' (fast, cheap, 2K textures only); 'meshy-7' is deprecated";

/**
 * Text-to-3D input schema
 */
export const TextTo3DInputSchema = z.object({
  prompt: z.string()
    .min(2, "Prompt must be at least 2 characters")
    .max(800, "Prompt must not exceed 800 characters")
    .describe("What to model (max 800 characters)"),
  ai_model: z.enum([
    AIModel.LATEST, AIModel.MESHY_7_1, AIModel.MESHY_6, AIModel.MESHY_6_LITE,
    AIModel.MESHY_7, SmartTopologyModel.MESHY_T2, SmartTopologyModel.MESHY_T2_5
  ])
    .optional()
    .describe(`${STANDARD_MODELS}. With model_type smart-topology: 'meshy-t2' (the default there) or 'meshy-t2.5' (newest, sharper detail for game assets).`),
  model_type: modelType(),
  geometry_resolution: geometryResolution(),
  ultra_mode: deprecatedUltraMode(),
  topology: topology(),
  target_polycount: polycount("Standard: remesh target 100–300,000, needs should_remesh true. Smart Topology: meshy-t2 100–15,000 (default 4,000), meshy-t2.5 100–30,000 (default 15,000)."),
  decimation_mode: decimationMode(),
  symmetry_mode: deprecatedSymmetryMode(),
  should_remesh: shouldRemesh(),
  pose_mode: poseMode(),
  target_formats: targetFormats(),
  alpha_thumbnail: alphaThumbnail(),
  auto_size: autoSize(),
  origin_at: originAt(),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-3D input schema
 */
export const ImageTo3DInputSchema = z.object({
  image_url: z.string()
    .optional()
    .describe("Public image URL. For local files use file_path."),
  file_path: z.string()
    .optional()
    .describe("Absolute path to a local .jpg/.jpeg/.png/.webp; the server encodes it."),
  input_task_id: z.string()
    .optional()
    .describe("A SUCCEEDED text-to-image / image-to-image task with exactly one image, used as the input."),
  ai_model: z.union([z.nativeEnum(AIModel), z.nativeEnum(SmartTopologyModel)])
    .optional()
    .describe(`${STANDARD_MODELS}. With model_type smart-topology: 'meshy-t2' (the default there) or 'meshy-t2.5' (newest, sharper detail for game assets).`),
  geometry_resolution: geometryResolution(),
  ultra_mode: deprecatedUltraMode(),
  model_type: modelType(),
  pose_mode: poseMode(),
  enable_pbr: enablePbr(),
  topology: topology(),
  target_polycount: polycount("Standard: remesh target 100–300,000, needs should_remesh true. Smart Topology: meshy-t2 100–15,000 (default 4,000), meshy-t2.5 100–30,000 (default 15,000)."),
  decimation_mode: decimationMode(),
  should_remesh: shouldRemesh(),
  symmetry_mode: deprecatedSymmetryMode(),
  should_texture: shouldTexture(),
  texture_prompt: generationTexturePrompt(),
  texture_image_url: textureImageUrl(),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  image_enhancement: imageEnhancement(),
  remove_lighting: lightingRemoval(),
  save_pre_remeshed_model: savePreRemeshed(),
  target_formats: targetFormats(),
  alpha_thumbnail: alphaThumbnail(),
  multi_view_thumbnails: multiViewThumbnails(),
  auto_size: autoSize(),
  origin_at: originAt(),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Text-to-3D Refine input schema
 */
export const TextTo3DRefineInputSchema = z.object({
  preview_task_id: z.string()
    .min(1, "Preview task ID is required")
    .describe("The SUCCEEDED preview task to texture"),
  enable_pbr: enablePbr(),
  texture_prompt: generationTexturePrompt(),
  texture_image_url: textureImageUrl(),
  ai_model: z.nativeEnum(AIModel)
    .optional()
    .describe("Optional override: 'meshy-7.1', 'latest' (= 7.1), 'meshy-6', 'meshy-6-lite' (2K only). Omit (recommended) to inherit the preview's model; not meshy-t2/t2.5."),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  remove_lighting: z.boolean().optional()
    .describe("Remove highlights/shadows from the base color (meshy-6 only). Sent as-is when ai_model is omitted, so omit it after a meshy-6-lite preview (the API rejects it)."),
  target_formats: targetFormats(),
  alpha_thumbnail: alphaThumbnail(),
  auto_size: autoSize(),
  origin_at: originAt(),
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
    .describe("1–4 public image URLs."),
  file_paths: z.array(z.string())
    .min(1)
    .max(4)
    .optional()
    .describe("1–4 absolute paths to local .jpg/.jpeg/.png/.webp images; the server encodes them."),
  input_task_id: z.string()
    .optional()
    .describe("A SUCCEEDED text-to-image / image-to-image task (multi-view included) whose images are the input."),
  ai_model: z.nativeEnum(AIModel)
    .default(AIModel.LATEST)
    .describe(`${STANDARD_MODELS}. No Smart Topology here.`),
  geometry_resolution: z.enum(["standard", "2k"]).optional()
    .describe("Ultra geometry pass: standard (default) or 2k (+5 credits); meshy-7.1/latest only. No 4k here."),
  ultra_mode: deprecatedUltraMode(),
  pose_mode: poseMode(),
  enable_pbr: enablePbr(),
  topology: topology(),
  target_polycount: polycount("Remesh target 100–300,000, needs should_remesh true."),
  decimation_mode: decimationMode(),
  should_remesh: shouldRemesh(),
  symmetry_mode: deprecatedSymmetryMode(),
  // Ignored and never sent, so the retired "lowpoly" stays accepted here: refusing it
  // would fail a request for a field that has no effect.
  model_type: z.enum([ModelType.STANDARD, "lowpoly"])
    .optional()
    .describe("Deprecated; ignored (this endpoint has no model_type)."),
  should_texture: shouldTexture(),
  texture_prompt: generationTexturePrompt(),
  texture_image_url: textureImageUrl(),
  texture_image_urls: z.array(z.string())
    .min(1)
    .max(4)
    .optional()
    .describe("1–4 views (URLs or data URIs) of the SAME object to drive the texture; element 0 is the front. meshy-7.1/latest only; not with texture_prompt / texture_image_url."),
  texture_resolution: textureResolution(),
  hd_texture: hdTexture(),
  image_enhancement: imageEnhancement(),
  remove_lighting: z.boolean()
    .optional()
    .describe("Remove highlights/shadows from the base color (meshy-6/7.1/latest; API default true)."),
  save_pre_remeshed_model: savePreRemeshed(),
  target_formats: targetFormats(),
  alpha_thumbnail: alphaThumbnail(),
  multi_view_thumbnails: multiViewThumbnails(),
  auto_size: autoSize(),
  origin_at: originAt(),
  response_format: ResponseFormatSchema
}).strict();
