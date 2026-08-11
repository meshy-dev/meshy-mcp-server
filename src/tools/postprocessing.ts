/**
 * Post-processing tools (remesh, retexture, rig, animate)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  RemeshInputSchema,
  RetextureInputSchema,
  RigInputSchema,
  AnimateInputSchema
} from "../schemas/postprocessing.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import { ResponseFormat, RIGGING_MAX_FACES } from "../constants.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";
import { fetchTaskByIdFromKnownEndpoints } from "../services/meshy-client.js";
import {
  CreateTaskApiResponse,
  RemeshApiRequest,
  RetextureApiRequest,
  RigApiRequest,
  AnimateApiRequest
} from "../types.js";

/**
 * Register post-processing tools with the MCP server
 */
export function registerPostProcessingTools(server: McpServer, client: MeshyClient) {
  // Remesh tool
  server.registerTool(
    "meshy_remesh",
    {
      title: "Remesh or Convert 3D Model",
      description: `Remesh an existing 3D model or convert it to different formats using Meshy AI.

Use this to optimize polygon count, change topology, convert formats, or reposition model origin.

Args:
  - input_task_id (string, optional): Task ID of an existing completed task to remesh
  - model_url (string, optional): Direct URL to a model file to remesh
    (Provide either input_task_id or model_url)
  - target_formats (array, optional): Output formats to generate (default: ["glb"]). Options: "glb", "fbx", "obj", "usdz", "blend", "stl"
  - topology (enum, optional): Mesh topology - "quad" or "triangle"
  - target_polycount (number, optional): Target polygon count (100–300,000)
  - resize_height (number, optional): Resize model height in meters (0 = no resize, default: 0)
  - origin_at (enum, optional): Model origin placement - "bottom" or "center"
  - convert_format_only (boolean, optional): Only convert format without remeshing (default: false)
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Remesh task created...",
    "estimated_time": "1-2 minutes"
  }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="remesh" to check progress.

Examples:
  - Remesh by task: { input_task_id: "abc-123", target_polycount: 10000 }
  - Convert format: { model_url: "https://...", target_formats: ["fbx", "obj"], convert_format_only: true }

Error Handling:
  - Returns "NotFound" if input_task_id doesn't exist
  - Returns "InvalidModel" if model_url is not accessible`,
      inputSchema: RemeshInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof RemeshInputSchema>) => {
      try {
        if (!params.input_task_id && !params.model_url) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: Either input_task_id or model_url must be provided."
            }]
          };
        }

        const request: RemeshApiRequest = {
          target_formats: params.target_formats,
          resize_height: params.resize_height,
          convert_format_only: params.convert_format_only
        };

        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;
        if (params.topology) request.topology = params.topology;
        if (params.target_polycount) request.target_polycount = params.target_polycount;
        if (params.origin_at) request.origin_at = params.origin_at;
        if (params.resize_longest_side !== undefined) request.resize_longest_side = params.resize_longest_side;
        if (params.decimation_mode !== undefined) request.decimation_mode = params.decimation_mode;
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/remesh", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Remesh task created successfully. Task ID: ${taskId}`,
          estimated_time: "1-2 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Remesh Task Created",
          "Remeshing the model with the specified parameters.",
          "remesh"
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

  // Retexture tool
  server.registerTool(
    "meshy_retexture",
    {
      title: "Retexture 3D Model",
      description: `Apply new AI-generated textures to an existing 3D model using Meshy AI.

IMPORTANT: Before calling this tool, ask the user to provide EXACTLY ONE style input:
  - text_style_prompt: A text description of the desired texture style (e.g. "rusty metal", "cartoon style")
  - image_style_url: A single reference image URL for the texture STYLE
  - multiview_image_urls: 1-4 photos OF THE SAME OBJECT from different angles (not style refs)
One of these is REQUIRED and they are MUTUALLY EXCLUSIVE — the tool will fail otherwise.

Args:
  - input_task_id (string, optional): Task ID of an existing completed task to retexture
  - model_url (string, optional): Direct URL to a model file to retexture
    (Provide either input_task_id or model_url)
  - text_style_prompt (string): Text prompt describing the desired texture style. Max 600 characters.
  - image_style_url (string): URL of an image to use as texture style reference.
  - multiview_image_urls (string[]): 1-4 ordered views of the SAME object; element 0 is the primary
    reference and alone drives metallic/roughness prediction. Requires ai_model "meshy-7" or "latest".
  - ai_model (enum): AI model - "meshy-5", "meshy-6", "meshy-7", or "latest" (default, resolves to Meshy 7). Ask user which model before proceeding
  - enable_original_uv (boolean): Preserve original UV mapping (default: true)
  - enable_pbr (boolean): Enable PBR textures (default: false)
  - texture_resolution (enum, optional): "2k" (default), "4k", or "8k". 8K costs 15 credits instead of 10 — confirm with the user. Replaces the deprecated hd_texture flag.
  - remove_lighting (boolean, optional): Remove highlights/shadows from base color texture. Default true. Only meshy-6/latest
  - target_formats (string[], optional): Output formats. 3MF must be explicitly included if needed.
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Retexture task created...",
    "estimated_time": "2-3 minutes"
  }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="retexture" to check progress.

Examples:
  - Text style: { input_task_id: "abc-123", text_style_prompt: "rusty metal" }
  - Image style: { model_url: "https://...", image_style_url: "https://style-ref.jpg" }
  - Multi-view: { input_task_id: "abc-123", ai_model: "meshy-7", multiview_image_urls: ["https://front.jpg", "https://side.jpg"] }

Error Handling:
  - Returns "NotFound" if input_task_id doesn't exist
  - Returns error if no style input is provided, or if more than one is provided`,
      inputSchema: RetextureInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof RetextureInputSchema>) => {
      try {
        if (!params.input_task_id && !params.model_url) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: Either input_task_id or model_url must be provided."
            }]
          };
        }

        // The three style inputs are mutually exclusive on the API side
        // (texture.multiview has no prompt field). Reject locally so the caller
        // gets a named field instead of a generic 400.
        const styleInputs = [
          params.text_style_prompt ? "text_style_prompt" : null,
          params.image_style_url ? "image_style_url" : null,
          params.multiview_image_urls?.length ? "multiview_image_urls" : null
        ].filter(Boolean) as string[];

        if (styleInputs.length === 0) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: provide exactly one style input — text_style_prompt, image_style_url, or multiview_image_urls."
            }]
          };
        }
        if (styleInputs.length > 1) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: text_style_prompt, image_style_url and multiview_image_urls are mutually exclusive, but ${styleInputs.join(" and ")} were provided. Pick one.`
            }]
          };
        }

        // multiview_image_urls runs the texture.multiview backend, which only
        // exists on Meshy 7.
        if (params.multiview_image_urls?.length && params.ai_model && params.ai_model !== "meshy-7" && params.ai_model !== "latest") {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: multiview_image_urls requires ai_model "meshy-7" (or "latest"), but "${params.ai_model}" was given.`
            }]
          };
        }

        const request: RetextureApiRequest = {
          enable_original_uv: params.enable_original_uv,
          enable_pbr: params.enable_pbr
        };

        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;
        if (params.text_style_prompt) request.text_style_prompt = params.text_style_prompt;
        if (params.image_style_url) request.image_style_url = params.image_style_url;
        if (params.multiview_image_urls?.length) request.multiview_image_urls = params.multiview_image_urls;
        if (params.ai_model) request.ai_model = params.ai_model;
        if (params.target_formats) request.target_formats = params.target_formats;
        if (params.alpha_thumbnail !== undefined) request.alpha_thumbnail = params.alpha_thumbnail;
        // texture_resolution / hd_texture need an HD-capable model (anything but
        // meshy-5). remove_lighting stays meshy-6/latest-only; sending it with
        // meshy-5 makes the API 400.
        {
          const isHDCapableRetexture = params.ai_model !== "meshy-5";
          const isMeshy6Retexture = params.ai_model === "meshy-6" || params.ai_model === "latest" || !params.ai_model;
          if (isHDCapableRetexture) {
            if (params.texture_resolution !== undefined) request.texture_resolution = params.texture_resolution;
            if (params.hd_texture !== undefined) request.hd_texture = params.hd_texture;
          }
          if (isMeshy6Retexture) {
            if (params.remove_lighting !== undefined) request.remove_lighting = params.remove_lighting;
          }
        }

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/retexture", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Retexture task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Retexture Task Created",
          "Applying new textures to the model.",
          "retexture"
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

  // Rig tool
  server.registerTool(
    "meshy_rig",
    {
      title: "Auto-Rig 3D Character",
      description: `Automatically rig a 3D character model for animation using Meshy AI.

Creates a skeletal rig for character models, enabling them to be animated. Rigging INCLUDES free walking + running animations.

IMPORTANT: The source model should be generated with pose_mode="t-pose" for best rigging results. When the user asks to rig or animate, always ensure the generation step used t-pose. If the model was not generated with t-pose, recommend regenerating with pose_mode="t-pose" first.

CONSTRAINT: Model must have ≤300,000 faces. This tool auto-checks and suggests remeshing if exceeded.

Args:
  - input_task_id (string, optional): Task ID of an existing completed task to rig
  - model_url (string, optional): Direct URL to a model file to rig
    (Provide either input_task_id or model_url)
  - height_meters (number, optional): Height of the character in meters (default: 1.7)
  - texture_image_url (string, optional): URL of a texture image to apply to the model
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Rigging task created...",
    "estimated_time": "2-3 minutes"
  }

Included with rigging (FREE):
  - Walking animation (GLB + FBX)
  - Running animation (GLB + FBX)
  Only call meshy_animate (3 credits) for CUSTOM animations beyond walking/running.

Examples:
  - Basic rig: { input_task_id: "abc-123" }
  - With height: { model_url: "https://...", height_meters: 1.8 }

Error Handling:
  - Returns "NotFound" if input_task_id doesn't exist
  - Returns error if model exceeds 300K faces (suggests remeshing)
  - Returns error if model is not suitable for rigging`,
      inputSchema: RigInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof RigInputSchema>) => {
      try {
        if (!params.input_task_id && !params.model_url) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Error: Either input_task_id or model_url must be provided."
            }]
          };
        }

        // Pre-validate face count for rigging constraint
        if (params.input_task_id) {
          try {
            const result = await fetchTaskByIdFromKnownEndpoints(client, params.input_task_id);
            const sourceTask = result?.task;
            if (sourceTask?.face_count && sourceTask.face_count > RIGGING_MAX_FACES) {
              const faceCount = sourceTask.face_count.toLocaleString();
              const maxFaces = RIGGING_MAX_FACES.toLocaleString();
              return {
                content: [{
                  type: "text",
                  text: `# Rigging Blocked: Face Count Too High

**Model faces**: ${faceCount}
**Maximum allowed**: ${maxFaces}

The model exceeds the ${maxFaces}-face limit for rigging.

**How to fix**:
1. Call \`meshy_remesh\` with input_task_id "${params.input_task_id}" and target_polycount 100000
2. Wait for remesh to complete (use \`meshy_get_task_status\` with task_type "remesh")
3. Then call \`meshy_rig\` with the remeshed task's ID`
                }]
              };
            }
          } catch {
            // If we can't fetch the source task, proceed anyway — the API will catch it
          }
        }

        const request: RigApiRequest = {
          height_meters: params.height_meters
        };

        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;
        if (params.texture_image_url) request.texture_image_url = params.texture_image_url;

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/rigging", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Rigging task created successfully. Task ID: ${taskId}`,
          estimated_time: "2-3 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Rigging Task Created",
          `Rigging INCLUDES walking + running animations for free. Download with \`meshy_download_model\` (task_type "rigging").\nOnly call \`meshy_animate\` (3 credits) for CUSTOM animations beyond walking/running.`,
          "rigging"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: handleMeshyError(error, { tool: "meshy_rig", taskId: params.input_task_id })
          }]
        };
      }
    }
  );

  // Animate tool
  server.registerTool(
    "meshy_animate",
    {
      title: "Animate Rigged 3D Character",
      description: `Apply a CUSTOM animation to a rigged 3D character using Meshy AI. Cost: 3 credits.

NOTE: Walking and running animations are already FREE with meshy_rig. Only use this tool for CUSTOM animations (dancing, jumping, fighting, etc.) that are NOT included in rigging.

Applies a predefined animation action to a character that has been rigged with meshy_rig.

Args:
  - rig_task_id (string): Task ID of the completed rigging task (required)
  - action_id (number): Integer ID of the animation action to apply (required)
  - post_process (object, optional): Optional post-processing to apply after animation:
    - operation_type (enum): "change_fps", "fbx2usdz", or "extract_armature"
    - fps (number, optional): Target FPS for change_fps operation (24, 25, 30, or 60)
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "task_id": "abc-123-def",
    "status": "PENDING",
    "message": "Animation task created...",
    "estimated_time": "1-2 minutes"
  }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="animation" to check progress.

Examples:
  - Basic animate: { rig_task_id: "abc-123", action_id: 1 }
  - With FPS change: { rig_task_id: "abc-123", action_id: 1, post_process: { operation_type: "change_fps", fps: 30 } }

Error Handling:
  - Returns "NotFound" if rig_task_id doesn't exist
  - Returns error if rig task is not yet completed`,
      inputSchema: AnimateInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof AnimateInputSchema>) => {
      try {
        const request: AnimateApiRequest = {
          rig_task_id: params.rig_task_id,
          action_id: params.action_id
        };

        if (params.post_process) {
          request.post_process = params.post_process;
        }

        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/animations", request as unknown as Record<string, unknown>);
        const taskId = response.result;

        const output = {
          task_id: taskId,
          status: "PENDING",
          message: `Animation task created successfully. Task ID: ${taskId}`,
          estimated_time: "1-2 minutes"
        };

        return formatTaskCreatedResponse(
          output,
          params.response_format,
          "Animation Task Created",
          "Applying custom animation to the rigged character.",
          "animation"
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
