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
import { checkImageAspectRatio, poseAspectRatioNote } from "../utils/image-options.js";
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
      description: `Generate a 2D image from text, e.g. a design for the user to approve before 3D. Typically ~30 s.
Cost: nano-banana 3, nano-banana-2 6, nano-banana-2-lite 3, nano-banana-2-1 4, nano-banana-pro 9, GPT Image models 9 credits.

To make it 3D: meshy_image_to_3d with input_task_id = this task (multi-view output: meshy_multi_image_to_3d).

Example: { ai_model: "nano-banana-pro", prompt: "game character", generate_multi_view: true, pose_mode: "t-pose" }`,
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
        // The API rejects aspect_ratio together with generate_multi_view.
        if (params.generate_multi_view && params.aspect_ratio) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: aspect_ratio cannot be set when generate_multi_view is true. Drop one of them."
            }]
          };
        }
        checkImageAspectRatio(params.ai_model, params.aspect_ratio);
        const request: TextToImageApiRequest = {
          ai_model: params.ai_model,
          prompt: params.prompt,
          generate_multi_view: params.generate_multi_view
        };
        if (params.aspect_ratio) request.aspect_ratio = params.aspect_ratio;
        if (params.pose_mode) request.pose_mode = params.pose_mode;
        if (params.remove_background !== undefined) request.remove_background = params.remove_background;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/text-to-image", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const poseNote = poseAspectRatioNote(params.ai_model, params.pose_mode, params.aspect_ratio);
        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Text-to-image task created successfully. Task ID: ${taskId}${poseNote ? `. ${poseNote}` : ""}`,
          estimated_time: "~30 seconds"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Image Generation Task Created",
          `Generating image from prompt: "${params.prompt}"${poseNote ? `\n\n${poseNote}` : ""}`,
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
      description: `Edit or restyle images with a text prompt. Cost: nano-banana 3, nano-banana-2 6, nano-banana-2-lite 3, nano-banana-2-1 4, nano-banana-pro 9, GPT Image models 12 credits.
Give exactly ONE reference source: input_task_id (all images of an earlier image task), reference_file_paths (local files; never base64-encode them yourself) or reference_image_urls.

To make the result 3D: meshy_image_to_3d with input_task_id = this task (multi-view output: meshy_multi_image_to_3d).

Example: { ai_model: "nano-banana-2", prompt: "make it red", input_task_id: "abc-123" }`,
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
      if (params.generate_multi_view && params.aspect_ratio) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: aspect_ratio cannot be set when generate_multi_view is true. Drop one of them." }]
        };
      }
      try {
        checkImageAspectRatio(params.ai_model, params.aspect_ratio);
        const request: ImageToImageApiRequest = {
          ai_model: params.ai_model,
          prompt: params.prompt,
          generate_multi_view: params.generate_multi_view
        };
        if (params.input_task_id) {
          request.input_task_id = params.input_task_id;
        } else if (params.reference_file_paths && params.reference_file_paths.length > 0) {
          request.reference_image_urls = await Promise.all(
            params.reference_file_paths.map(fp => fileToDataUri(fp))
          );
        } else if (params.reference_image_urls && params.reference_image_urls.length > 0) {
          request.reference_image_urls = params.reference_image_urls;
        } else {
          throw new Error("Provide input_task_id, reference_image_urls or reference_file_paths.");
        }
        if (params.aspect_ratio) request.aspect_ratio = params.aspect_ratio;
        if (params.remove_background !== undefined) request.remove_background = params.remove_background;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/image-to-image", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Image-to-image task created successfully. Task ID: ${taskId}`,
          estimated_time: "~30 seconds"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Image-to-Image Task Created",
          params.input_task_id
            ? `Transforming the output image(s) of task "${params.input_task_id}".`
            : `Transforming ${request.reference_image_urls?.length ?? 0} reference image(s) with AI.`,
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
