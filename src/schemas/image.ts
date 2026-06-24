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
    .describe("AI model: 'nano-banana' (3 credits), 'nano-banana-2' (6), 'nano-banana-pro' (9), or 'gpt-image-2' (9). gpt-image-2 supports only a limited set of aspect ratios."),
  prompt: PromptSchema,
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Generate multiple viewpoint images (front, side, back)"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character images: 'a-pose' or 't-pose'"),
  aspect_ratio: z.nativeEnum(AspectRatio)
    .default(AspectRatio.SQUARE)
    .describe("Aspect ratio. Support is model-specific: nano-banana / nano-banana-2 / nano-banana-pro accept '1:1','16:9','9:16','4:3','3:4'; gpt-image-2 accepts ONLY '1:1','3:2','2:3' ('3:2'/'2:3' are gpt-image-2-only and rejected by the nano-banana family). Default '1:1'."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-image input schema
 */
export const ImageToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("AI model: 'nano-banana' (3 credits), 'nano-banana-2' (6), 'nano-banana-pro' (9), or 'gpt-image-2' (12 for image-to-image)."),
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
