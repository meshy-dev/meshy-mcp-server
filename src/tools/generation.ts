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
  resolveTextureModel,
  supportsImageEnhancement
} from "../utils/generation-options.js";
import { MODEL_CHOICE_GUIDE } from "../model-guide.js";
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
      description: `Generate an untextured 3D PREVIEW from a text prompt; texture it afterwards with meshy_text_to_3d_refine once the user approves. Typically 2–3 minutes.
Cost: 20 credits (meshy-7.1 / latest / meshy-6), 5 (meshy-6-lite, meshy-t2, meshy-t2.5); Ultra geometry +5.

PREFER THE IMAGE ROUTE: for higher quality and more control, generate a design image first (meshy_text_to_image), let the user approve it, then meshy_image_to_3d with input_task_id = the image task (textured in one task). Use direct text-to-3d for a quick draft or when the user explicitly asks for it.

Examples:
  - Low-poly: { prompt: "dragon", model_type: "smart-topology", ai_model: "meshy-t2", target_polycount: 4000 }
  - Max detail: { prompt: "ornate knight helmet", ai_model: "meshy-7.1", geometry_resolution: "4k" }
  - 3D print: { prompt: "cat", target_formats: ["obj"] }`,
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
      description: `Generate a 3D model from one image, textured by default (no refine step; should_texture false for a bare mesh). Typically 2–3 minutes.
Cost: the mesh (meshy-7.1 / latest / meshy-6 20; meshy-6-lite, meshy-t2, meshy-t2.5 5) + 10 for the texture (15 at 8K), whichever texture_model; Ultra geometry +5.

IMAGE INPUT (exactly ONE):
  - file_path: a local image (RECOMMENDED; never base64-encode it yourself)
  - image_url: a public URL
  - input_task_id: a SUCCEEDED meshy_text_to_image / meshy_image_to_image task with ONE image (multi-view output → meshy_multi_image_to_3d)

${MODEL_CHOICE_GUIDE}
Omit texture_model for the geometry's default; "none" is should_texture false; 2 to 4 photos go to meshy_multi_image_to_3d.

Example (game character): { file_path: "/path/to/character.png", ai_model: "meshy-t2.5", target_polycount: 15000, texture_model: "meshy-n1", pose_mode: "t-pose" }`,
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
        const textureModel = resolveTextureModel(options.ai_model, options.smartTopology, params);
        const request: ImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false,
          ai_model: options.ai_model,
          model_type: options.model_type,
        };
        if (textureModel !== undefined) request.texture_model = textureModel;
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
      description: `Texture a SUCCEEDED meshy_text_to_3d preview. Cost: 10 credits (15 at 8K). Get the user's approval first; omit ai_model to inherit the preview's model.

Example: { preview_task_id: "abc-123", texture_prompt: "rusty metal", enable_pbr: true }`,
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
      description: `Generate a 3D model from 1–4 views of the same object (better reconstruction), textured by default.
Cost: the mesh (meshy-7.1 / latest / meshy-6 20; meshy-6-lite 5) + 10 for the texture (15 at 8K), whichever texture_model; Ultra geometry +5.

IMAGE INPUT (exactly ONE):
  - file_paths: 1–4 local images (never base64-encode them yourself)
  - image_urls: 1–4 public URLs
  - input_task_id: a SUCCEEDED meshy_text_to_image / meshy_image_to_image task (multi-view included); its images are the input

${MODEL_CHOICE_GUIDE}
Omit texture_model for the geometry's default; "none" is should_texture false; smart topology (meshy-t2.5 / meshy-t2) is meshy_image_to_3d only.

Example (real object from photos): { file_paths: ["/path/front.jpg", "/path/side.jpg"], ai_model: "meshy-7.1", texture_model: "meshy-7" }`,
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
        const textureModel = resolveTextureModel(options.ai_model, false, params);
        const request: MultiImageTo3DApiRequest = {
          enable_pbr: params.enable_pbr,
          moderation: false,
          ai_model: options.ai_model,
        };
        if (textureModel !== undefined) request.texture_model = textureModel;
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
