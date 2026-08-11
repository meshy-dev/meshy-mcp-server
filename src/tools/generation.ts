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

PREFER THE IMAGE ROUTE: for higher quality and more control, generate a design image first (meshy_text_to_image) then meshy_image_to_3d. Use direct text-to-3d for a quick draft or when the user explicitly asks for it.

This tool creates a new 3D generation task and returns a task_id that can be used to poll the status. The generation process is asynchronous and typically takes 2-3 minutes.

Args:
  - prompt (string): Text description of the 3D model (2-600 characters)
  - ai_model (enum): AI model - "meshy-5" (previous gen, 5 credits), "meshy-6" (best quality, 20 credits), "latest" (default, resolves to meshy-6). NOTE: text-to-3d does NOT accept "meshy-7", and "latest" here is still Meshy 6 (image-to-3d differs). IMPORTANT: Ask the user which model to use before proceeding
  - model_type (enum, optional): "standard" (default) or "lowpoly" (smart-topology is image-to-3d only). When "lowpoly", ai_model/topology/target_polycount/should_remesh are ignored
  - topology (enum, optional): Mesh topology - "quad" or "triangle"
  - target_polycount (number, optional): Target polygon count (100–300,000)
  - symmetry_mode (enum, optional): "off", "auto" (default), or "on"
  - should_remesh (boolean, optional): Whether to remesh. Default false for meshy-6, true for others
  - pose_mode (enum, optional): "a-pose" or "t-pose". IMPORTANT: Use "t-pose" when the user intends to rig or animate the model
  - target_formats (string[], optional): Output formats. Default: all except 3mf. For 3D printing white model, pass ["obj"].
  - auto_size (boolean, optional): AI auto-estimate real-world height. Default false.
  - origin_at (enum, optional): "bottom" or "center". Default "bottom" when auto_size is true.
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Workflow: This creates a PREVIEW (untextured mesh). After completion, ask the user if they want to add textures via meshy_text_to_3d_refine. Preview and refine ai_model should match — all models (meshy-5, meshy-6, latest) support both preview and refine.

For 3D printing: pass target_formats: ["obj"] to only generate OBJ format (faster).
For rigging/animation: use pose_mode: "t-pose" for best results.

Returns:
  { "task_id": "abc-123-def", "status": "PENDING", "estimated_time": "2-3 minutes" }

Next Steps:
  Use meshy_get_task_status with the task_id to wait for completion.

Examples:
  - "Create a low-poly dragon" → { prompt: "dragon", model_type: "lowpoly" }
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
        if (params.decimation_mode !== undefined) {
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
  - ai_model: "meshy-5", "meshy-6", "meshy-7", or "latest" (default, resolves to Meshy 7). For part-separated
    geometry at a fraction of the cost, set model_type:"smart-topology" (ai_model defaults to "meshy-t2",
    5 credits mesh instead of 20). Ask user which model before proceeding
  - ultra_mode (boolean, optional): Meshy 7 high-detail geometry pass, +5 credits. Needs ai_model "meshy-7"
    (or "latest" while it resolves to Meshy 7); rejected on meshy-5/meshy-6 and with lowpoly/smart-topology
  - model_type: "standard" (default), "smart-topology", or "lowpoly" (deprecated)
  - pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true). Set false for untextured mesh
  - enable_pbr: PBR maps (default false). Set true for metallic/roughness/normal maps
  - texture_prompt, texture_image_url: Guide texturing
  - texture_resolution: "2k" (default) / "4k" / "8k". 8K costs 15 credits instead of 10 — confirm first.
    Replaces the deprecated hd_texture flag
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
        const request: ImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false
        };

        // Image source: chain from an upstream image task, or resolve a URL/local file.
        if (params.input_task_id) {
          request.input_task_id = params.input_task_id;
        } else {
          request.image_url = await resolveImageSource(params.image_url, params.file_path);
        }

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
        // Smart Topology is its own model family: the API rejects
        // model_type "smart-topology" paired with a standard ai_model.
        // Omitting ai_model is fine — it defaults to meshy-t2.
        const isSmartTopologyModel = params.ai_model === "meshy-t1" || params.ai_model === "meshy-t2";
        if (params.model_type === "smart-topology" && params.ai_model && !isSmartTopologyModel) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: model_type "smart-topology" requires ai_model "meshy-t1" or "meshy-t2" (or omit ai_model to get the meshy-t2 default), but "${params.ai_model}" was given.`
            }]
          };
        }
        if (isSmartTopologyModel && params.model_type && params.model_type !== "smart-topology") {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: ai_model "${params.ai_model}" is a Smart Topology model and requires model_type "smart-topology", but "${params.model_type}" was given.`
            }]
          };
        }

        // ultra_mode is a Meshy-7-only knob: the API 400s when the resolved model
        // is not Meshy 7, and rejects it outright alongside model_type "lowpoly".
        // Catch the unambiguous mistakes here so the user is not charged a
        // round-trip for a request that cannot succeed.
        if (params.ultra_mode) {
          if (params.ai_model && params.ai_model !== "meshy-7" && params.ai_model !== "latest") {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `Error: ultra_mode is only supported for meshy-7, but ai_model is "${params.ai_model}". Set ai_model to "meshy-7" (recommended, +5 credits on top of the 20-credit mesh), or drop ultra_mode.`
              }]
            };
          }
          if (params.model_type === "lowpoly" || params.model_type === "smart-topology") {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `Error: ultra_mode requires standard Meshy 7 generation and cannot be combined with model_type "${params.model_type}".`
              }]
            };
          }
          request.ultra_mode = true;
        }

        // texture_resolution (and the deprecated hd_texture) need an HD-capable
        // model — everything except meshy-5. image_enhancement / remove_lighting
        // stay on the narrower meshy-6/latest lane: sending them with meshy-5
        // makes the API 400, and Meshy 7 silently ignores remove_lighting.
        const isHDCapableImage = params.ai_model !== "meshy-5";
        const isMeshy6Image = params.ai_model === "meshy-6" || params.ai_model === "latest" || !params.ai_model;
        if (isHDCapableImage) {
          if (params.texture_resolution !== undefined) {
            request.texture_resolution = params.texture_resolution;
          }
          if (params.hd_texture !== undefined) {
            request.hd_texture = params.hd_texture;
          }
        }
        if (isMeshy6Image) {
          if (params.image_enhancement !== undefined) {
            request.image_enhancement = params.image_enhancement;
          }
          if (params.remove_lighting !== undefined) {
            request.remove_lighting = params.remove_lighting;
          }
        }
        if (params.save_pre_remeshed_model !== undefined) {
          request.save_pre_remeshed_model = params.save_pre_remeshed_model;
        }
        if (params.decimation_mode !== undefined) {
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
  - texture_prompt (string, optional): Text to guide texturing. Max 600 characters
  - texture_image_url (string, optional): Image URL to guide texturing
  - ai_model (enum): AI model - "meshy-5", "meshy-6", or "latest" (default). Should match the preview's ai_model to avoid model mismatch errors.
  - remove_lighting (boolean, optional): Remove highlights/shadows from base color texture. Default true. Only meshy-6/latest
  - target_formats (string[], optional): Output formats. Default: all except 3mf.
  - auto_size (boolean, optional): AI auto-estimate real-world height. Default false.
  - origin_at (enum, optional): "bottom" or "center".
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

IMPORTANT: The ai_model used for refine should match the preview's ai_model. All models (meshy-5, meshy-6, latest) support refine.

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
          ai_model: params.ai_model
        };

        if (params.texture_prompt) {
          request.texture_prompt = params.texture_prompt;
        }
        if (params.texture_image_url) {
          request.texture_image_url = params.texture_image_url;
        }
        // texture_resolution / hd_texture / remove_lighting are meshy-6/latest-only
        // here; sending them with meshy-5 makes the API 400. Note texture_resolution
        // applies to text-to-3d REFINE only — the preview stage produces no texture.
        const isMeshy6Refine = params.ai_model === "meshy-6" || params.ai_model === "latest" || !params.ai_model;
        if (isMeshy6Refine) {
          if (params.texture_resolution !== undefined) {
            request.texture_resolution = params.texture_resolution;
          }
          if (params.hd_texture !== undefined) {
            request.hd_texture = params.hd_texture;
          }
          if (params.remove_lighting !== undefined) {
            request.remove_lighting = params.remove_lighting;
          }
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
  - ai_model: "meshy-5", "meshy-6", "meshy-7", or "latest" (default, resolves to Meshy 7). NOTE: smart-topology
    (meshy-t1/meshy-t2) and ultra_mode are single-image-only and NOT available here. Ask user which model first
  - model_type: "standard" or "lowpoly", pose_mode, topology, target_polycount, should_remesh, symmetry_mode
  - should_texture: Whether to generate textures (default true)
  - enable_pbr: PBR maps (default false)
  - texture_prompt, texture_image_url: Guide texturing
  - texture_resolution: "2k" (default) / "4k" / "8k". 8K costs 15 credits instead of 10 — confirm first.
    Replaces the deprecated hd_texture flag
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
        const request: MultiImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false
        };

        // Image source: chain from an upstream multi-view image task, or resolve URLs/local files.
        let imageCount = 0;
        if (params.input_task_id) {
          request.input_task_id = params.input_task_id;
        } else if (params.file_paths && params.file_paths.length > 0) {
          request.image_urls = await Promise.all(
            params.file_paths.map(fp => fileToDataUri(fp))
          );
          imageCount = request.image_urls.length;
        } else if (params.image_urls && params.image_urls.length > 0) {
          request.image_urls = params.image_urls;
          imageCount = request.image_urls.length;
        } else {
          throw new Error("Provide one of input_task_id, image_urls, or file_paths.");
        }

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
        // texture_resolution / hd_texture need an HD-capable model (anything but
        // meshy-5). image_enhancement / remove_lighting stay meshy-6/latest-only;
        // sending them with meshy-5 makes the API 400.
        const isHDCapableMulti = params.ai_model !== "meshy-5";
        const isMeshy6Multi = params.ai_model === "meshy-6" || params.ai_model === "latest" || !params.ai_model;
        if (isHDCapableMulti) {
          if (params.texture_resolution !== undefined) request.texture_resolution = params.texture_resolution;
          if (params.hd_texture !== undefined) request.hd_texture = params.hd_texture;
        }
        if (isMeshy6Multi) {
          if (params.image_enhancement !== undefined) request.image_enhancement = params.image_enhancement;
          if (params.remove_lighting !== undefined) request.remove_lighting = params.remove_lighting;
        }
        if (params.save_pre_remeshed_model !== undefined) request.save_pre_remeshed_model = params.save_pre_remeshed_model;
        if (params.decimation_mode !== undefined) request.decimation_mode = params.decimation_mode;
        if (params.target_formats) request.target_formats = params.target_formats;
        if (params.alpha_thumbnail !== undefined) request.alpha_thumbnail = params.alpha_thumbnail;
        if (params.multi_view_thumbnails !== undefined) request.multi_view_thumbnails = params.multi_view_thumbnails;
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/multi-image-to-3d", request as unknown as Record<string, unknown>);
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
