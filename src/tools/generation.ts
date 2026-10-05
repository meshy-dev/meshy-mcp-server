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
  checkMultiViewTexture,
  checkTextureResolution,
  resolveGenerationOptions,
  supportsImageEnhancement
} from "../utils/generation-options.js";
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

PREFER THE IMAGE ROUTE: for higher quality and more control, generate a design image first (meshy_text_to_image) then meshy_image_to_3d. Use direct text-to-3d for a quick draft or when the user explicitly asks for it.

This tool creates a new 3D generation task and returns a task_id that can be used to poll the status. The generation process is asynchronous and typically takes 2-3 minutes.

Args:
  - prompt (string): Text description of the 3D model (2-800 characters)
  - ai_model: "latest" (default, = Meshy 7.1) / "meshy-7.1" / "meshy-6" (20 credits), "meshy-6-lite" (5 credits) for standard; "meshy-t2" (5 credits) for Smart Topology. "meshy-7" is deprecated. Ask the user which model and confirm the cost first
  - model_type: "standard" (default), "smart-topology" (T2, triangle-only), or deprecated "lowpoly"
  - geometry_resolution: "standard" (default), "2k" or "4k" Ultra pass (+5 credits) on Meshy 7.1/latest standard generation. Confirm the surcharge first
  - ultra_mode: deprecated compatibility alias for geometry_resolution "2k"
  - topology (enum, optional): Mesh topology - "quad" or "triangle"
  - target_polycount (number, optional): Target polygon count (100–300,000)
  - symmetry_mode (enum, optional): "off", "auto" (default), or "on"
  - should_remesh (boolean, optional): Standard remeshing, default false for Meshy 6/7/7.1. Ignored on Smart Topology
  - pose_mode (enum, optional): "a-pose" or "t-pose". IMPORTANT: Use "t-pose" when the user intends to rig or animate the model
  - target_formats (string[], optional): Output formats. Default: all except 3mf. For 3D printing white model, pass ["obj"].
  - auto_size (boolean, optional): AI auto-estimate real-world height. Default false.
  - origin_at (enum, optional): "bottom" or "center". Default "bottom" when auto_size is true.
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Workflow: This creates an untextured PREVIEW. After completion, obtain permission for texturing via meshy_text_to_3d_refine. Omit refine ai_model to inherit the preview model; T2 is not a refine override.
Smart Topology generates directly at target_polycount (100–15,000 faces, default 4,000) and ignores remesh/decimation controls. Standard targeting requires should_remesh true.

For 3D printing: pass target_formats: ["obj"] to only generate OBJ format (faster).
For rigging/animation: use pose_mode: "t-pose" for best results.

Returns:
  { "task_id": "abc-123-def", "status": "PENDING", "estimated_time": "2-3 minutes" }

Next Steps:
  Use meshy_get_task_status with the task_id to wait for completion.

Examples:
  - "Create a low-poly dragon" → { prompt: "dragon", model_type: "smart-topology", ai_model: "meshy-t2", target_polycount: 4000 }
  - "Max detail" → { prompt: "ornate knight helmet", ai_model: "meshy-7.1", geometry_resolution: "4k" }
  - "Generate for 3D print" → { prompt: "cat", target_formats: ["obj"] }
  - "Character for animation" → { prompt: "warrior", pose_mode: "t-pose" }`,
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
        const options = resolveGenerationOptions(params, "text");
        const request: TextTo3DApiRequest = {
          mode: "preview",
          prompt: params.prompt,
          ai_model: options.ai_model,
          model_type: options.model_type,
          moderation: false,
        };
        if (options.geometry_resolution !== undefined) {
          request.geometry_resolution = options.geometry_resolution;
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
        if (!options.smartTopology && params.should_remesh !== undefined) {
          request.should_remesh = params.should_remesh;
        }
        if (params.pose_mode) {
          request.pose_mode = params.pose_mode;
        }
        if (!options.smartTopology && params.decimation_mode !== undefined) {
          request.decimation_mode = params.decimation_mode;
        }
        if (params.target_formats) {
          request.target_formats = params.target_formats;
        }
        if (params.alpha_thumbnail !== undefined) {
          request.alpha_thumbnail = params.alpha_thumbnail;
        }
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

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
  - ai_model: "latest" (default, = Meshy 7.1) / "meshy-7.1" / "meshy-6" (20 mesh, 30 textured), "meshy-6-lite" (5 / 15, 2K textures only) for standard; "meshy-t2" (5 / 15) for Smart Topology. "meshy-7" is deprecated; legacy "meshy-t1" still accepted. Ask the user which model and confirm the cost first
  - geometry_resolution: "standard" (default), "2k" or "4k" Ultra pass (+5 credits) on Meshy 7.1/latest standard generation. Confirm the surcharge first
  - ultra_mode: deprecated compatibility alias for the 2k pass. Legacy explicit Meshy 7 single-image Ultra is retained
  - model_type: "standard" (default), "smart-topology", or "lowpoly" (deprecated)
  - pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true). Set false for untextured mesh
  - enable_pbr: PBR maps (default false). Set true for metallic/roughness/normal maps
  - texture_prompt, texture_image_url: Guide texturing
  - texture_resolution: "2k" (default) / "4k" / "8k". 8K adds 5 credits — confirm first. Not on meshy-6-lite.
    Replaces the deprecated hd_texture flag
  - image_enhancement: Supported on meshy-6, meshy-7.1, and latest; false preserves deliberate input styling
  - remove_lighting: Meshy 6 only; omitted values are not inserted into requests
  - save_pre_remeshed_model, response_format

Note: Image-to-3D has no separate refine step. Texturing is controlled by should_texture (default true).
T2 targets 100–15,000 faces directly (default 4,000). Smart Topology ignores topology/remesh/pre-remesh/decimation controls; these are not forwarded. Standard targeting requires should_remesh true.

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
        const options = resolveGenerationOptions(params, "image");
        const request: ImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false,
          ai_model: options.ai_model,
          model_type: options.model_type,
        };
        if (options.geometry_resolution !== undefined)
          request.geometry_resolution = options.geometry_resolution;
        if (options.ultra_mode !== undefined)
          request.ultra_mode = options.ultra_mode;

        // Image source: chain from an upstream image task, or resolve a URL/local file.
        if (params.input_task_id) {
          request.input_task_id = params.input_task_id;
        } else {
          request.image_url = await resolveImageSource(params.image_url, params.file_path);
        }

        if (params.pose_mode) {
          request.pose_mode = params.pose_mode;
        }
        if (!options.smartTopology && params.topology) {
          request.topology = params.topology;
        }
        if (params.target_polycount) {
          request.target_polycount = params.target_polycount;
        }
        if (!options.smartTopology && params.should_remesh !== undefined) {
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
        checkTextureResolution(options.ai_model, params.texture_resolution, params.hd_texture);
        if (params.texture_resolution !== undefined) {
          request.texture_resolution = params.texture_resolution;
        }
        if (params.hd_texture !== undefined) {
          request.hd_texture = params.hd_texture;
        }
        if (supportsImageEnhancement(options.ai_model) && params.image_enhancement !== undefined) {
          request.image_enhancement = params.image_enhancement;
        }
        if (
          options.ai_model === "meshy-6" &&
          params.remove_lighting !== undefined
        ) {
          request.remove_lighting = params.remove_lighting;
        }
        if (
          !options.smartTopology &&
          params.save_pre_remeshed_model !== undefined
        ) {
          request.save_pre_remeshed_model = params.save_pre_remeshed_model;
        }
        if (!options.smartTopology && params.decimation_mode !== undefined) {
          request.decimation_mode = params.decimation_mode;
        }
        if (params.target_formats) {
          request.target_formats = params.target_formats;
        }
        if (params.alpha_thumbnail !== undefined) {
          request.alpha_thumbnail = params.alpha_thumbnail;
        }
        if (params.multi_view_thumbnails !== undefined) {
          request.multi_view_thumbnails = params.multi_view_thumbnails;
        }
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

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
  - texture_prompt (string, optional): Text to guide texturing. Max 800 characters
  - texture_image_url (string, optional): Image URL to guide texturing
  - texture_resolution: "2k" (default) / "4k" / "8k". 10 credits, 15 at 8K. Not on meshy-6-lite
  - ai_model: Optional override: "meshy-7.1", "latest" (= Meshy 7.1), "meshy-6", "meshy-6-lite". Omit to inherit the preview model. T2 is not a refine override
  - remove_lighting: Meshy 6 only. With an inherited model it is passed through, so omit it when the preview used meshy-6-lite (the API rejects it there)
  - target_formats (string[], optional): Output formats. Default: all except 3mf.
  - auto_size (boolean, optional): AI auto-estimate real-world height. Default false.
  - origin_at (enum, optional): "bottom" or "center".
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

IMPORTANT: Omitted ai_model inherits the preview model rather than forcing latest. Obtain texturing approval before submitting; confirm current costs and preview compatibility for an explicit override.

Returns:
  { "task_id": "abc-123-def", "status": "PENDING", "estimated_time": "2-3 minutes" }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="text-to-3d" to check progress.

Examples:
  - Basic refine: { preview_task_id: "abc-123" }
  - With PBR: { preview_task_id: "abc-123", enable_pbr: true }
  - Guided texture: { preview_task_id: "abc-123", texture_prompt: "rusty metal" }`,
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
        };
        if (params.ai_model !== undefined) request.ai_model = params.ai_model;

        if (params.texture_prompt) {
          request.texture_prompt = params.texture_prompt;
        }
        if (params.texture_image_url) {
          request.texture_image_url = params.texture_image_url;
        }
        // Without an override, the API inherits the preview model.
        checkTextureResolution(params.ai_model, params.texture_resolution, params.hd_texture);
        if (params.texture_resolution !== undefined) {
          request.texture_resolution = params.texture_resolution;
        }
        if (params.hd_texture !== undefined) {
          request.hd_texture = params.hd_texture;
        }
        if (
          (params.ai_model === undefined || params.ai_model === "meshy-6") &&
          params.remove_lighting !== undefined
        ) {
          request.remove_lighting = params.remove_lighting;
        }
        if (params.target_formats) {
          request.target_formats = params.target_formats;
        }
        if (params.alpha_thumbnail !== undefined) {
          request.alpha_thumbnail = params.alpha_thumbnail;
        }
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

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
  - ai_model: "latest" (default, = Meshy 7.1) / "meshy-7.1" / "meshy-6" (20 mesh, 30 textured), "meshy-6-lite" (5 / 15, 2K textures only). "meshy-7" is deprecated. Smart Topology is unavailable here. Ask the user which model and confirm the cost first
  - geometry_resolution: "standard" (default) or "2k" Ultra pass (+5 credits) on Meshy 7.1/latest. No 4k here
  - ultra_mode: deprecated compatibility alias for the 2k pass; confirm higher-detail cost
  - model_type: "standard" or "lowpoly", pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true)
  - enable_pbr: PBR maps (default false)
  - texture_prompt, texture_image_url: Guide texturing
  - texture_image_urls: 1–4 views of the same object to drive the texture (front view first). Meshy 7.1/latest only;
    not combinable with texture_prompt / texture_image_url
  - texture_resolution: "2k" (default) / "4k" / "8k". 8K adds 5 credits — confirm first. Not on meshy-6-lite.
    Replaces the deprecated hd_texture flag
  - image_enhancement: Supported on meshy-6, meshy-7.1, and latest; false preserves input styling
  - remove_lighting: Supported on meshy-6, meshy-7.1, and latest
  - save_pre_remeshed_model, response_format

Examples:
  - Local files: { file_paths: ["/path/front.jpg", "/path/side.jpg"] }
  - Public URLs: { image_urls: ["https://example.com/front.jpg", "https://example.com/side.jpg"] }
  - Multi-view texture: { image_urls: ["https://example.com/front.jpg"], texture_image_urls: ["https://example.com/front-color.jpg", "https://example.com/back-color.jpg"] }

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
        const options = resolveGenerationOptions(params, "multi-image");
        checkMultiViewTexture(options.ai_model, params);
        checkTextureResolution(options.ai_model, params.texture_resolution, params.hd_texture);
        const request: MultiImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false,
          ai_model: options.ai_model,
          model_type: options.model_type,
        };
        if (options.geometry_resolution !== undefined) {
          request.geometry_resolution = options.geometry_resolution as
            | "standard"
            | "2k";
        }

        // Image source: chain from an upstream multi-view image task, or resolve URLs/local files.
        let imageCount = 0;
        if (params.input_task_id) {
          request.input_task_id = params.input_task_id;
        } else if (params.file_paths && params.file_paths.length > 0) {
          request.image_urls = await Promise.all(
            params.file_paths.map((fp) => fileToDataUri(fp)),
          );
          imageCount = request.image_urls.length;
        } else if (params.image_urls && params.image_urls.length > 0) {
          request.image_urls = params.image_urls;
          imageCount = request.image_urls.length;
        } else {
          throw new Error(
            "Provide one of input_task_id, image_urls, or file_paths.",
          );
        }

        if (params.pose_mode) request.pose_mode = params.pose_mode;
        if (params.topology) request.topology = params.topology;
        if (params.target_polycount)
          request.target_polycount = params.target_polycount;
        if (params.should_remesh !== undefined)
          request.should_remesh = params.should_remesh;
        if (params.symmetry_mode) request.symmetry_mode = params.symmetry_mode;
        if (params.should_texture !== undefined)
          request.should_texture = params.should_texture;
        if (params.texture_prompt)
          request.texture_prompt = params.texture_prompt;
        if (params.texture_image_url)
          request.texture_image_url = params.texture_image_url;
        if (params.texture_image_urls?.length)
          request.texture_image_urls = params.texture_image_urls;
        if (params.texture_resolution !== undefined)
          request.texture_resolution = params.texture_resolution;
        if (params.hd_texture !== undefined)
          request.hd_texture = params.hd_texture;
        // Multi-image honors both flags on meshy-6, meshy-7.1 and latest.
        if (supportsImageEnhancement(options.ai_model)) {
          if (params.image_enhancement !== undefined)
            request.image_enhancement = params.image_enhancement;
          if (params.remove_lighting !== undefined)
            request.remove_lighting = params.remove_lighting;
        }
        if (params.save_pre_remeshed_model !== undefined)
          request.save_pre_remeshed_model = params.save_pre_remeshed_model;
        if (params.decimation_mode !== undefined)
          request.decimation_mode = params.decimation_mode;
        if (params.target_formats)
          request.target_formats = params.target_formats;
        if (params.alpha_thumbnail !== undefined)
          request.alpha_thumbnail = params.alpha_thumbnail;
        if (params.multi_view_thumbnails !== undefined)
          request.multi_view_thumbnails = params.multi_view_thumbnails;
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/multi-image-to-3d",
          request as unknown as Record<string, unknown>,
        );
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Multi-image 3D generation task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        const sourceDesc = params.input_task_id
          ? `upstream task "${params.input_task_id}"`
          : `${imageCount} image(s)`;

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "3D Generation Task Created (Multi-Image-to-3D)",
          `Your 3D model is being generated from ${sourceDesc}.`,
          "multi-image-to-3d",
        );
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: handleMeshyError(error, {
                tool: "meshy_multi_image_to_3d",
              }),
            },
          ],
        };
      }
    }
  );
}
