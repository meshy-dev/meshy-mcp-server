/**
 * Generation tools (text-to-3d, image-to-3d)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { resolveImageSource, fileToDataUri } from "../services/file-utils.js";
import { TextTo3DInputSchema, ImageTo3DInputSchema, TextTo3DRefineInputSchema, MultiImageTo3DInputSchema } from "../schemas/generation.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import { ResponseFormat } from "../constants.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";
import {
  CreateTaskApiResponse,
  TextTo3DApiRequest,
  ImageTo3DApiRequest,
  TextTo3DRefineApiRequest,
  MultiImageTo3DApiRequest
} from "../types.js";

/**
 * Register generation tools with the MCP server
 */
export function registerGenerationTools(server: McpServer, client: MeshyClient) {
  // Text-to-3D tool
  server.registerTool(
    "meshy_text_to_3d",
    {
      title: "Generate 3D Model from Text",
      description: `Generate a 3D model from a text description using Meshy AI.

This tool creates a new 3D generation task and returns a task_id that can be used to poll the status. The generation process is asynchronous and typically takes 2-3 minutes.

Args:
  - prompt (string): Text description of the 3D model (2-600 characters)
  - ai_model (enum): AI model - "meshy-5" (previous gen, 5 credits), "meshy-6" (best quality, 20 credits), "latest" (default, resolves to meshy-6). IMPORTANT: Ask the user which model to use before proceeding
  - model_type (enum, optional): "standard" (default) or "lowpoly". When "lowpoly", ai_model/topology/target_polycount/should_remesh are ignored
  - topology (enum, optional): Mesh topology - "quad" or "triangle"
  - target_polycount (number, optional): Target polygon count (100–300,000)
  - symmetry_mode (enum, optional): "off", "auto" (default), or "on"
  - should_remesh (boolean, optional): Whether to remesh. Default false for meshy-6, true for others
  - pose_mode (enum, optional): "a-pose" or "t-pose". IMPORTANT: Use "t-pose" when the user intends to rig or animate the model
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",           // Use this to poll status
    "status": "PENDING",                // Initial status
    "message": "Task created...",       // Human-readable message
    "estimated_time": "2-3 minutes"     // Estimated completion time
  }

Next Steps:
  After creating a task, use meshy_get_task_status with the task_id to poll progress.

Examples:
  - "Create a low-poly dragon" → { prompt: "dragon", model_type: "lowpoly" }
  - "Generate a realistic cat" → { prompt: "cat", ai_model: "meshy-6" }

Error Handling:
  - Returns "InsufficientCredits" if account needs upgrade
  - Returns "TooManyPendingTasks" if too many tasks running`,
      inputSchema: TextTo3DInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof TextTo3DInputSchema>) => {
      try {
        // Prepare API request - flat structure matching Meshy API
        const request: TextTo3DApiRequest = {
          mode: "preview",
          prompt: params.prompt,
          ai_model: params.ai_model,
          moderation: false
        };

        if (params.model_type) {
          request.model_type = params.model_type;
        }
        if (params.target_polycount) {
          request.target_polycount = params.target_polycount;
        }
        if (params.topology) {
          request.topology = params.topology;
        }
        if (params.symmetry_mode) {
          request.symmetry_mode = params.symmetry_mode;
        }
        if (params.should_remesh !== undefined) {
          request.should_remesh = params.should_remesh;
        }
        if (params.pose_mode) {
          request.pose_mode = params.pose_mode;
        }

        // Create task via API
        const response = await client.post<CreateTaskApiResponse>("/openapi/v2/text-to-3d", request as unknown as Record<string, unknown>);

        // API returns { "result": "task-id" }
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `3D generation task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "3D Generation Task Created",
          `Your 3D model is being generated from the prompt: "${params.prompt}"`
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

  // Image-to-3D tool
  server.registerTool(
    "meshy_image_to_3d",
    {
      title: "Generate 3D Model from Image",
      description: `Generate a 3D model from a single image using Meshy AI.

This tool creates a new 3D generation task from an image and returns a task_id.

IMAGE INPUT (provide ONE, NEVER both):
  - Local file → file_path: "/absolute/path/to/image.jpg" (RECOMMENDED)
  - Remote URL → image_url: "https://example.com/image.jpg"
  - NEVER manually base64-encode. NEVER use both file_path and image_url.

Other Args:
  - ai_model: "meshy-5", "meshy-6", or "latest" (default). Ask user which model before proceeding
  - model_type, pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true). Set false for untextured mesh
  - enable_pbr: PBR maps (default false). Set true for metallic/roughness/normal maps
  - texture_prompt, texture_image_url: Guide texturing
  - image_enhancement: Optimize input image (default true, meshy-6/latest only)
  - remove_lighting: Remove highlights/shadows from base color texture (default true, meshy-6/latest only)
  - save_pre_remeshed_model, response_format

Note: Image-to-3D does NOT have a separate refine step. Texturing is controlled by should_texture (default true).

Examples:
  - Local file: { file_path: "/path/to/cat.jpg" }
  - Public URL: { image_url: "https://example.com/cat.jpg" }
  - With pose: { file_path: "/path/to/character.png", pose_mode: "a-pose" }

Error Handling:
  - Returns "InvalidImageUrl" if image is not accessible
  - Returns "File not found" if file_path doesn't exist`,
      inputSchema: ImageTo3DInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ImageTo3DInputSchema>) => {
      try {
        const imageUrl = await resolveImageSource(params.image_url, params.file_path);

        const request: ImageTo3DApiRequest = {
          image_url: imageUrl,
          enable_pbr: params.enable_pbr,
          moderation: false
        };

        if (params.ai_model) {
          request.ai_model = params.ai_model;
        }
        if (params.model_type) {
          request.model_type = params.model_type;
        }
        if (params.pose_mode) {
          request.pose_mode = params.pose_mode;
        }
        if (params.topology) {
          request.topology = params.topology;
        }
        if (params.target_polycount) {
          request.target_polycount = params.target_polycount;
        }
        if (params.should_remesh !== undefined) {
          request.should_remesh = params.should_remesh;
        }
        if (params.symmetry_mode) {
          request.symmetry_mode = params.symmetry_mode;
        }
        if (params.should_texture !== undefined) {
          request.should_texture = params.should_texture;
        }
        if (params.texture_prompt) {
          request.texture_prompt = params.texture_prompt;
        }
        if (params.texture_image_url) {
          request.texture_image_url = params.texture_image_url;
        }
        if (params.image_enhancement !== undefined) {
          request.image_enhancement = params.image_enhancement;
        }
        if (params.remove_lighting !== undefined) {
          request.remove_lighting = params.remove_lighting;
        }
        if (params.save_pre_remeshed_model !== undefined) {
          request.save_pre_remeshed_model = params.save_pre_remeshed_model;
        }

        // Create task via API (image-to-3d uses v1, not v2)
        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/image-to-3d", request as unknown as Record<string, unknown>);

        // API returns { "result": "task-id" }
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `3D generation task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "3D Generation Task Created (Image-to-3D)",
          "Your 3D model is being generated from the provided image.",
          "image-to-3d"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error, { tool: "meshy_image_to_3d" })
          }]
        };
      }
    }
  );

  // Text-to-3D Refine tool
  server.registerTool(
    "meshy_text_to_3d_refine",
    {
      title: "Refine Text-to-3D Preview",
      description: `Apply textures to a completed text-to-3D preview mesh using Meshy AI.

This tool takes a completed preview task and generates a fully textured model. Run meshy_text_to_3d first to get a preview, then use this tool to add high-quality textures.

Args:
  - preview_task_id (string): Task ID of the completed preview task to refine (required)
  - enable_pbr (boolean): Enable physically-based rendering textures (default: false)
  - texture_prompt (string, optional): Text to guide texturing. Max 600 characters
  - texture_image_url (string, optional): Image URL to guide texturing
  - ai_model (enum): AI model - "meshy-5", "meshy-6", or "latest" (default). Ask user which model before proceeding
  - remove_lighting (boolean, optional): Remove highlights/shadows from base color texture. Default true. Only meshy-6/latest
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Refine task created...",
    "estimated_time": "2-3 minutes"
  }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="text-to-3d" to check progress.

Examples:
  - Basic refine: { preview_task_id: "abc-123" }
  - With PBR: { preview_task_id: "abc-123", enable_pbr: true }
  - Guided texture: { preview_task_id: "abc-123", texture_prompt: "rusty metal" }

Error Handling:
  - Returns "NotFound" if preview_task_id doesn't exist
  - Returns error if preview task is not yet completed`,
      inputSchema: TextTo3DRefineInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof TextTo3DRefineInputSchema>) => {
      try {
        const request: TextTo3DRefineApiRequest = {
          mode: "refine",
          preview_task_id: params.preview_task_id,
          enable_pbr: params.enable_pbr,
          ai_model: params.ai_model
        };

        if (params.texture_prompt) {
          request.texture_prompt = params.texture_prompt;
        }
        if (params.texture_image_url) {
          request.texture_image_url = params.texture_image_url;
        }
        if (params.remove_lighting !== undefined) {
          request.remove_lighting = params.remove_lighting;
        }

        const response = await client.post<CreateTaskApiResponse>("/openapi/v2/text-to-3d", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Text-to-3D refine task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Text-to-3D Refine Task Created",
          `Texturing the preview model from task "${params.preview_task_id}".`
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

  // Multi-image-to-3D tool
  server.registerTool(
    "meshy_multi_image_to_3d",
    {
      title: "Generate 3D Model from Multiple Images",
      description: `Generate a 3D model from 1–4 images using Meshy AI.

Use multiple views of the same object for better 3D reconstruction.

Image Input (provide ONE of these):
  - image_urls (array): 1–4 publicly accessible image URLs
  - file_paths (array): 1–4 absolute paths to LOCAL image files. Server reads and encodes them automatically.

IMPORTANT: For local files, always use file_paths instead of manually base64-encoding.

Other Args:
  - ai_model: "meshy-5", "meshy-6", or "latest" (default). Ask user which model before proceeding
  - model_type, pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true)
  - enable_pbr: PBR maps (default false)
  - texture_prompt, texture_image_url: Guide texturing
  - image_enhancement: Optimize input images (default true, meshy-6/latest only)
  - remove_lighting: Remove highlights/shadows from base color texture (default true, meshy-6/latest only)
  - save_pre_remeshed_model, response_format

Examples:
  - Local files: { file_paths: ["/path/front.jpg", "/path/side.jpg"] }
  - Public URLs: { image_urls: ["https://example.com/front.jpg", "https://example.com/side.jpg"] }

Error Handling:
  - Returns "InvalidImageUrl" if any image is not accessible
  - Returns "File not found" if any file_path doesn't exist`,
      inputSchema: MultiImageTo3DInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof MultiImageTo3DInputSchema>) => {
      try {
        let resolvedUrls: string[];
        if (params.file_paths && params.file_paths.length > 0) {
          resolvedUrls = await Promise.all(
            params.file_paths.map(fp => fileToDataUri(fp))
          );
        } else if (params.image_urls && params.image_urls.length > 0) {
          resolvedUrls = params.image_urls;
        } else {
          throw new Error("Either image_urls or file_paths must be provided.");
        }

        const request: MultiImageTo3DApiRequest = {
          image_urls: resolvedUrls,
          enable_pbr: params.enable_pbr,
          moderation: false
        };

        if (params.ai_model) request.ai_model = params.ai_model;
        if (params.model_type) request.model_type = params.model_type;
        if (params.pose_mode) request.pose_mode = params.pose_mode;
        if (params.topology) request.topology = params.topology;
        if (params.target_polycount) request.target_polycount = params.target_polycount;
        if (params.should_remesh !== undefined) request.should_remesh = params.should_remesh;
        if (params.symmetry_mode) request.symmetry_mode = params.symmetry_mode;
        if (params.should_texture !== undefined) request.should_texture = params.should_texture;
        if (params.texture_prompt) request.texture_prompt = params.texture_prompt;
        if (params.texture_image_url) request.texture_image_url = params.texture_image_url;
        if (params.image_enhancement !== undefined) request.image_enhancement = params.image_enhancement;
        if (params.remove_lighting !== undefined) request.remove_lighting = params.remove_lighting;
        if (params.save_pre_remeshed_model !== undefined) request.save_pre_remeshed_model = params.save_pre_remeshed_model;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/multi-image-to-3d", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Multi-image 3D generation task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "3D Generation Task Created (Multi-Image-to-3D)",
          `Your 3D model is being generated from ${resolvedUrls.length} image(s).`,
          "multi-image-to-3d"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error, { tool: "meshy_multi_image_to_3d" })
          }]
        };
      }
    }
  );
}
