/**
 * Zod schemas for post-processing tools (remesh, retexture, rig, animate)
 */

import { z } from "zod";
import { AIModel, OriginAt, TextureResolution, Topology, AnimationPostProcessOp, SkeletonTemplate } from "../constants.js";
import { ResponseFormatSchema, UrlSchema } from "./common.js";

/**
 * Remesh input schema
 */
export const RemeshInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("A SUCCEEDED text-to-3d (preview or refine), image-to-3d or retexture task"),
  model_url: UrlSchema
    .optional()
    .describe("Public URL of a .glb / .gltf / .obj / .fbx / .stl model (max 400 MB), or a GLB data URI (max 100 MB)"),
  target_formats: z.array(z.enum(["glb", "fbx", "obj", "usdz", "blend", "stl", "3mf"]))
    .default(["glb"])
    .describe("Formats to produce (default ['glb'])."),
  topology: z.nativeEnum(Topology)
    .optional()
    .describe("quad or triangle (default)"),
  target_polycount: z.number()
    .int()
    .min(100, "Polycount must be at least 100")
    .max(300000, "Polycount cannot exceed 300,000")
    .optional()
    .describe("100–300,000 (default 30,000)"),
  decimation_mode: z.number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Adaptive decimation 1 (ultra) – 4 (low); overrides target_polycount."),
  resize_height: z.number()
    .optional()
    .describe("Deprecated: use meshy_resize."),
  resize_longest_side: z.number()
    .optional()
    .describe("Deprecated: use meshy_resize."),
  auto_size: z.boolean()
    .optional()
    .describe("Deprecated: use meshy_resize."),
  origin_at: z.nativeEnum(OriginAt)
    .optional()
    .describe("Deprecated: use meshy_resize."),
  convert_format_only: z.boolean()
    .optional()
    .describe("Deprecated: use meshy_convert."),
  alpha_thumbnail: z.boolean()
    .optional()
    .describe("Also return a transparent-background preview (alpha_thumbnail_url)."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Retexture input schema
 */
export const RetextureInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("A SUCCEEDED text-to-3d (preview or refine), image-to-3d or remesh task"),
  model_url: UrlSchema
    .optional()
    .describe("Public URL of a .glb / .gltf / .obj / .fbx / .stl model (max 400 MB), or a GLB data URI (max 100 MB)"),
  text_style_prompt: z.string()
    .max(800, "Prompt must not exceed 800 characters")
    .optional()
    .describe("The texture style in words (max 800 characters). Not with meshy-n1."),
  image_style_url: UrlSchema
    .optional()
    .describe("One image used as the style reference. With meshy-n1: a view of the object, read as the front view."),
  multiview_image_urls: z.array(UrlSchema)
    .min(1, "Provide at least 1 view")
    .max(4, "At most 4 views are accepted")
    .optional()
    .describe("1–4 views of the same object: element 0 is the primary (front) view, the others in any order. Needs ai_model 'meshy-7' ('latest' is sent as 'meshy-7'; element 0 alone drives metallic/roughness) or 'meshy-n1'."),
  ai_model: z.enum([AIModel.MESHY_6_LITE, AIModel.MESHY_6, AIModel.MESHY_7, AIModel.MESHY_N1, AIModel.LATEST])
    .default(AIModel.LATEST)
    .describe("'latest' (default, = Meshy 7), 'meshy-7', 'meshy-6', 'meshy-6-lite' (fast, 2K only), or 'meshy-n1' (Meshy N1: a 2K base color texture from image_style_url or 1–4 multiview_image_urls, front view first; no text prompt, no PBR; 10 credits). No meshy-7.1 here."),
  enable_original_uv: z.boolean()
    .optional()
    .describe("Keep the existing UVs instead of a fresh unwrap. Default true with input_task_id, false with model_url (safest for uploads)."),
  enable_pbr: z.boolean()
    .default(false)
    .describe("Also make metallic/roughness/normal maps. Not with meshy-n1."),
  texture_resolution: z.nativeEnum(TextureResolution)
    .optional()
    .describe("Base color texture: 2k (default), 4k or 8k (15 credits instead of 10; PBR maps stay 4K, no emission map). 4k/8k not on meshy-6-lite or meshy-n1."),
  hd_texture: z.boolean()
    .optional()
    .describe("Deprecated: use texture_resolution '4k'."),
  remove_lighting: z.boolean()
    .optional()
    .describe("Remove highlights/shadows from the base color (meshy-6 only; API default true there). Not with meshy-n1."),
  target_formats: z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"]))
    .optional()
    .describe("Formats to produce (default: all but 3mf; list '3mf' to get it)."),
  alpha_thumbnail: z.boolean()
    .optional()
    .describe("Also return a transparent-background preview (alpha_thumbnail_url)."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Rig (rigging) input schema
 */
export const RigInputSchema = z.object({
  input_task_id: z.string()
    .min(1)
    .optional()
    .describe("A SUCCEEDED task with a textured humanoid model"),
  model_url: UrlSchema
    .optional()
    .describe("Public URL of a textured humanoid .glb (max 400 MB), or a GLB data URI (max 100 MB)"),
  height_meters: z.number()
    .default(1.7)
    .describe("Character height in meters; helps scaling"),
  texture_image_url: UrlSchema
    .optional()
    .describe("Deprecated: leave it out when the model has its own textures (Meshy models and most GLBs do), which the rig keeps. Sending it makes this image the only texture and drops the PBR maps. Only for a model_url GLB without textures: its UV-unwrapped base color (.png, max 20 MB). Not with include_fingers."),
  skeleton_template: z.nativeEnum(SkeletonTemplate)
    .optional()
    .describe("The skeleton the rig is delivered on, which sets bone names and hierarchy: pick the one the user's engine or tool expects (mixamo, ue5_mannequin, unity_humanoid, blender_rigify_basic_human, ...). Default meshyrig: Meshy's 24-bone skeleton, in centimeters. Any other value (or include_fingers) delivers meters, that skeleton's bones, an animation clip named retarget_clip and end bones in the FBX. meshy_animate on this rig uses the same skeleton. A model Meshy can't rig on that skeleton fails the task: retry with meshyrig or another value."),
  include_fingers: z.boolean()
    .optional()
    .describe("true adds finger bones to the character's hands, on any skeleton_template (Mixamo names such as LeftHandThumb1 on meshyrig). Same credit cost. Works best on hands with clearly separated fingers; mittens, gloves or stylized hands can get fewer finger bones. The API refuses it without charge for a quad-topology input task (400) or a model it can rig only without fingers (422); if the hands can't be rigged the task fails, so retry or set false. Not with texture_image_url."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Animate input schema
 */
export const AnimateInputSchema = z.object({
  rig_task_id: z.string()
    .min(1, "Rig task ID is required")
    .describe("The SUCCEEDED rigging task"),
  action_id: z.number()
    .int("Action ID must be an integer")
    .optional()
    .describe("One preset action; find ids with meshy_list_animations (free), never guess."),
  action_ids: z.array(z.number().int())
    .min(1)
    .max(10)
    .refine(ids => new Set(ids).size === ids.length, "action_ids must be unique")
    .optional()
    .describe("1–10 unique preset ids, returned as ONE file with one clip per action, in this order (e.g. for a game-engine state machine)."),
  motion_task_id: z.string()
    .min(1)
    .optional()
    .describe("A SUCCEEDED meshy_text_to_motion task (biped rigs only; within 3 days, before the clip expires)."),
  post_process: z.object({
    operation_type: z.nativeEnum(AnimationPostProcessOp)
      .describe("change_fps (with fps), fbx2usdz or extract_armature"),
    fps: z.union([
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(60)
    ])
      .optional()
      .describe("Target FPS for change_fps")
  })
    .optional()
    .describe("Optional post-processing"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Text-to-motion input schema
 */
export const TextToMotionInputSchema = z.object({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(400, "Prompt must not exceed 400 characters")
    .describe("The motion, e.g. 'jumps over a gap and lands in a crouch' (max 400 characters)."),
  duration: z.number()
    .min(2, "Duration must be at least 2 seconds")
    .max(10, "Duration cannot exceed 10 seconds")
    .multipleOf(0.5, "Duration must be a multiple of 0.5 seconds")
    .describe("Clip length in seconds: 2–10 in steps of 0.5."),
  mode: z.enum(["prime", "swift"])
    .optional()
    .describe("'prime' (default): highest quality, FBX. 'swift': faster and cheaper, BVH."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Animation library lookup input schema
 */
export const ListAnimationsInputSchema = z.object({
  search: z.string()
    .min(1)
    .optional()
    .describe("Case-insensitive substring of the animation name or key, e.g. 'walk', 'punch', 'dance'."),
  category: z.enum(["WalkAndRun", "BodyMovements", "DailyActions", "Fighting", "Dancing"])
    .optional()
    .describe("Only this category."),
  sub_category: z.string()
    .min(1)
    .optional()
    .describe("Only this sub-category, e.g. 'AttackingwithWeapon'. Names repeat across categories, so pair it with category to be exact."),
  action_ids: z.array(z.number().int())
    .min(1)
    .max(200)
    .optional()
    .describe("Resolve these ids (up to 200); ids that no longer exist are simply absent."),
  response_format: ResponseFormatSchema
}).strict();

