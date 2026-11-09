/**
 * Zod schemas for image generation tools (text-to-image, image-to-image)
 */

import { z } from "zod";
import { TextToImageModel, AspectRatio, PoseMode } from "../constants.js";
import { ResponseFormatSchema, PromptSchema, UrlSchema } from "./common.js";

const removeBackground = () => z.boolean()
  .optional()
  .describe("Transparent-background PNG (no effect on multi-view output).");

const aspectRatio = (note = "") => z.nativeEnum(AspectRatio)
  .optional()
  .describe(`Default '1:1'; '3:2' and '2:3' are GPT Image models only (refused on nano-banana). Not with generate_multi_view.${note}`);

/**
 * Text-to-image input schema
 */
export const TextToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("Image model; ask the user."),
  prompt: PromptSchema,
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Front/side/back views (input for meshy_multi_image_to_3d). Not with aspect_ratio."),
  pose_mode: z.nativeEnum(PoseMode)
    .optional()
    .describe("Character pose: 'a-pose' or 't-pose'. nano-banana models render a pose at 3:4 whatever aspect_ratio says."),
  aspect_ratio: aspectRatio(" With pose_mode, nano-banana models render 3:4 regardless."),
  remove_background: removeBackground(),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Image-to-image input schema
 */
export const ImageToImageInputSchema = z.object({
  ai_model: z.nativeEnum(TextToImageModel)
    .describe("Image model; ask the user."),
  prompt: PromptSchema,
  input_task_id: z.string()
    .optional()
    .describe("A SUCCEEDED text-to-image / image-to-image task; all its images are the references. Wins over the other sources."),
  reference_image_urls: z.array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe("1–5 public .jpg/.jpeg/.png/.webp URLs"),
  reference_file_paths: z.array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe("1–5 absolute paths to local images; the server encodes them"),
  generate_multi_view: z.boolean()
    .default(false)
    .describe("Front/side/back views (input for meshy_multi_image_to_3d). Not with aspect_ratio."),
  aspect_ratio: aspectRatio(),
  remove_background: removeBackground(),
  response_format: ResponseFormatSchema
}).strict();
