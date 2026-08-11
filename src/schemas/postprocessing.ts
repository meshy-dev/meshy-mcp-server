/**
 * Zod schemas for post-processing tools (remesh, retexture, rig, animate)
 */

import { z } from "zod";
import { AIModel, RemeshFormat, OriginAt, TextureResolution, Topology, AnimationPostProcessOp } from "../constants.js";
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
  target_formats: z.array(z.enum(["glb", "fbx", "obj", "usdz", "blend", "stl", "3mf"]))
    .default(["glb"])
    .describe("Output formats to generate (default: ['glb']). NOTE: 3MF is NOT included by default — you MUST explicitly include '3mf' to receive it."),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("Mesh topology type (quad or triangle)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("Target polygon count for the remeshed model (100–300,000)"),
  decimation_mode: z.number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Adaptive decimation polycount level (1=ultra, 2=high, 3=medium, 4=low). When set, target_polycount is ignored."),
  resize_height: z.number()
    .default(0)
    .describe("Resize model to this height in meters (0 = no resize). Mutually exclusive with auto_size."),
  resize_longest_side: z.number()
    .optional()
    .describe("Resize so the model's longest side matches this value in meters (aspect ratio preserved). Alternative to resize_height."),
  auto_size: z.boolean()
    .optional()
    .describe("Use AI to auto-estimate real-world height. Mutually exclusive with resize_height. Default false."),
  origin_at: z.nativeEnum(OriginAt)
    .optional()
    .describe("Where to place the model origin: 'bottom' or 'center'. Default 'bottom' when auto_size is true."),
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
    .describe("Text prompt describing the desired texture style. Max 600 characters. Mutually exclusive with image_style_url and multiview_image_urls — provide exactly one style input."),
  image_style_url: UrlSchema
    .optional()
    .describe("URL of a SINGLE image to use as texture style reference. Mutually exclusive with text_style_prompt and multiview_image_urls."),
  multiview_image_urls: z.array(UrlSchema)
    .min(1, "Provide at least 1 view")
    .max(4, "At most 4 views are accepted")
    .optional()
    .describe("1–4 ordered views OF THE SAME OBJECT (not style references) — element 0 is the primary reference and alone drives the metallic/roughness prediction. Requires ai_model 'meshy-7' or 'latest'. Mutually exclusive with text_style_prompt and image_style_url."),
  ai_model: z.enum([AIModel.MESHY_5, AIModel.MESHY_6, AIModel.MESHY_7, AIModel.LATEST])
    .default(AIModel.LATEST)
    .describe("AI model: 'meshy-5', 'meshy-6', 'meshy-7', or 'latest' (default — resolves to Meshy 7). multiview_image_urls requires meshy-7 or latest. Texturing costs 10 credits at 2K/4K, 15 at 8K."),
  enable_original_uv: z.boolean()
    .default(true)
    .describe("Preserve the original UV mapping"),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Enable physically-based rendering textures"),
  texture_resolution: z.nativeEnum(TextureResolution)
    .optional()
    .describe("Base color texture resolution: '2k' (default), '4k', or '8k'. 8K costs 15 credits instead of 10 — confirm with the user before selecting it. Only supported on meshy-6 / meshy-7 / latest; PBR maps stay at 2K. Replaces the deprecated hd_texture flag."),
  hd_texture: z.boolean()
    .optional()
    .describe("DEPRECATED — use texture_resolution instead (hd_texture: true is exactly texture_resolution: '4k'). Kept for backward compatibility."),
  remove_lighting: z.boolean()
    .default(true)
    .describe("Removes highlights and shadows from the base color texture for cleaner results under custom lighting. Default true. Only supported when ai_model is meshy-6 or latest"),
  target_formats: z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"]))
    .optional()
    .describe("Output formats to generate. When omitted, produces glb/obj/fbx/stl/usdz but NOT 3mf. To get 3MF, you MUST include '3mf' explicitly."),
  alpha_thumbnail: z.boolean()
    .optional()
    .describe("Also render a transparent-background (RGBA) preview, returned as alpha_thumbnail_url. Default false."),
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
