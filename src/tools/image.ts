/**
 * Image generation tools (text-to-image, image-to-image)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { fileToDataUri } from "../services/file-utils.js";
import { TextToImageInputSchema, ImageToImageInputSchema } from "../schemas/image.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import { ResponseFormat } from "../constants.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";
import {
  CreateTaskApiResponse,
  TextToImageApiRequest,
  ImageToImageApiRequest
} from "../types.js";

/**
 * Register image generation tools with the MCP server
 */
export function registerImageTools(server: McpServer, client: MeshyClient) {
  // Text-to-image tool
  server.registerTool(
    "meshy_text_to_image",
    {
      title: "Generate 2D Image from Text",
      description: `Generate a 2D image from a text description using Meshy AI.

Useful for creating reference images that can then be used with image-to-3d or image-to-image.

Args:
  - ai_model (enum): AI model to use - "nano-banana" or "nano-banana-pro" (required)
  - prompt (string): Text description of the image to generate (2-600 characters, required)
  - generate_multi_view (boolean, optional): Generate multiple viewpoint images (default: false)
  - pose_mode (enum, optional): Pose for character images - "a-pose" or "t-pose"
  - aspect_ratio (enum, optional): Image aspect ratio (default: "1:1"). Options: "1:1", "16:9", "9:16", "4:3", "3:4"
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Image generation task created...",
    "estimated_time": "1-2 minutes"
  }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="text-to-image" to check progress.

Examples:
  - Basic image: { ai_model: "nano-banana", prompt: "a cute cartoon cat" }
  - Widescreen: { ai_model: "nano-banana-pro", prompt: "fantasy landscape", aspect_ratio: "16:9" }
  - Multi-view character: { ai_model: "nano-banana-pro", prompt: "game character", generate_multi_view: true }

Error Handling:
  - Returns "InsufficientCredits" if account needs upgrade`,
      inputSchema: TextToImageInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof TextToImageInputSchema>) => {
      try {
        const request: TextToImageApiRequest = {
          ai_model: params.ai_model,
          prompt: params.prompt,
          generate_multi_view: params.generate_multi_view,
          aspect_ratio: params.aspect_ratio
        };

        if (params.pose_mode) request.pose_mode = params.pose_mode;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/text-to-image", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Text-to-image task created successfully. Task ID: ${taskId}`,
          estimated_time: "1-2 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Image Generation Task Created",
          `Generating image from prompt: "${params.prompt}"`,
          "text-to-image"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error)
          }]
        };
      }
    }
  );

  // Image-to-image tool
  server.registerTool(
    "meshy_image_to_image",
    {
      title: "Transform Image using AI",
      description: `Transform images using AI with a text prompt and reference images using Meshy AI.

Reference Image Input (provide ONE of these):
  - reference_image_urls (array): 1–5 publicly accessible reference image URLs
  - reference_file_paths (array): 1–5 absolute paths to LOCAL image files. Server reads and encodes them automatically.

IMPORTANT: For local files, always use reference_file_paths instead of manually base64-encoding.

Other Args:
  - ai_model (enum): "nano-banana" or "nano-banana-pro" (required)
  - prompt (string): Text description guiding the transformation (required)
  - generate_multi_view (boolean, optional): Generate multiple viewpoint images (default: false)
  - response_format (enum): Output format (default: "markdown")

Examples:
  - Local file: { ai_model: "nano-banana", prompt: "make it a robot", reference_file_paths: ["/path/to/image.jpg"] }
  - Public URL: { ai_model: "nano-banana", prompt: "make it a robot", reference_image_urls: ["https://..."] }

Error Handling:
  - Returns "InvalidImageUrl" if any reference image is not accessible
  - Returns "File not found" if any file_path doesn't exist`,
      inputSchema: ImageToImageInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ImageToImageInputSchema>) => {
      try {
        let resolvedUrls: string[];
        if (params.reference_file_paths && params.reference_file_paths.length > 0) {
          resolvedUrls = await Promise.all(
            params.reference_file_paths.map(fp => fileToDataUri(fp))
          );
        } else if (params.reference_image_urls && params.reference_image_urls.length > 0) {
          resolvedUrls = params.reference_image_urls;
        } else {
          throw new Error("Either reference_image_urls or reference_file_paths must be provided.");
        }

        const request: ImageToImageApiRequest = {
          ai_model: params.ai_model,
          prompt: params.prompt,
          reference_image_urls: resolvedUrls,
          generate_multi_view: params.generate_multi_view
        };

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/image-to-image", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Image-to-image task created successfully. Task ID: ${taskId}`,
          estimated_time: "1-2 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Image-to-Image Task Created",
          `Transforming ${resolvedUrls.length} reference image(s) with AI.`,
          "image-to-image"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error)
          }]
        };
      }
    }
  );
}
