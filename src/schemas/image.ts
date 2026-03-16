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
    .describe("AI model to use for image generation"),
  prompt: PromptSchema,
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Generate multiple viewpoint images (front, side, back)"),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Pose mode for character images: 'a-pose' or 't-pose'"),
  aspect_ratio: z.nativeEnum(AspectRatio)
    .default(AspectRatio.SQUARE)
    .describe("Aspect ratio of generated image (default: '1:1')"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-image input schema
 */
export const ImageToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("AI model to use for image transformation"),
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
