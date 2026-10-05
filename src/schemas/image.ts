/**
 * Zod schemas for image generation tools (text-to-image, image-to-image)
 */

import { z } from "zod";
import { TextToImageModel, AspectRatio, PoseMode } from "../constants.js";
import { ResponseFormatSchema, PromptSchema, UrlSchema } from "./common.js";

/**
 * Text-to-image input schema
 */
export const TextToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("AI model: 'nano-banana' (3 credits), 'nano-banana-2' (6), 'nano-banana-pro' (9), or a GPT Image model: 'gpt-image-2', 'gpt-image-2-5-flare', 'gpt-image-2-5-sunburst' (9 each)."),
  prompt: PromptSchema,
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Generate multiple viewpoint images (front, side, back). Cannot be combined with aspect_ratio."),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character images: 'a-pose' or 't-pose'"),
  aspect_ratio: z.nativeEnum(AspectRatio)
    .optional()
    .describe("Aspect ratio (API default '1:1'). All models accept '1:1','16:9','9:16','4:3','3:4'; '3:2' and '2:3' are GPT Image models only. Leave unset when generate_multi_view is true."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-image input schema
 */
export const ImageToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("AI model: 'nano-banana' (3 credits), 'nano-banana-2' (6), 'nano-banana-pro' (9), or a GPT Image model: 'gpt-image-2', 'gpt-image-2-5-flare', 'gpt-image-2-5-sunburst' (12 each for image-to-image)."),
  prompt: PromptSchema,
  reference_image_urls: z.array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe("Array of 1–5 publicly accessible reference image URLs. Provide this OR reference_file_paths, not both"),
  reference_file_paths: z.array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe("Array of 1–5 absolute paths to local reference image files. The server reads and encodes them automatically"),
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Generate multiple viewpoint images (front, side, back)"),
  response_format: ResponseFormatSchema
}).strict();
