/**
 * Post-processing tools (remesh, retexture, rig, animate, text-to-motion, animation library)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  RemeshInputSchema,
  RetextureInputSchema,
  RigInputSchema,
  AnimateInputSchema,
  TextToMotionInputSchema,
  ListAnimationsInputSchema
} from "../schemas/postprocessing.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import {
  AIModel,
  ANIMATE_CREDITS_PER_ACTION,
  CHARACTER_LIMIT,
  ResponseFormat,
  RIGGING_MAX_FACES,
  TEXT_TO_MOTION_CREDITS
} from "../constants.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";
import { checkMeshyN1Retexture, checkTextureResolution } from "../utils/generation-options.js";
import { getTaskWithAutoInference } from "../services/meshy-client.js";
import { buildApiRequest } from "../utils/request-builder.js";
import {
  CreateTaskApiResponse,
  RetextureApiRequest,
  RigApiRequest,
  AnimateApiRequest,
  LibraryAnimation
} from "../types.js";

/**
 * Register post-processing tools with the MCP server
 */
export function registerPostProcessingTools(server: McpServer, client: MeshyClient) {
  // Remesh tool
  server.registerTool(
    "meshy_remesh",
    {
      title: "Remesh 3D Model",
      description: `Remesh an existing model: change its polygon count or topology. Cost: 5 credits. For a format change only use meshy_convert (1 credit); to scale, meshy_resize (1 credit).

Example: { input_task_id: "abc-123", topology: "quad", target_polycount: 10000, target_formats: ["fbx"] }`,
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

        // Only fields the caller set; the deprecated resize / convert fields
        // are no longer sent with placeholder values.
        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/remesh", buildApiRequest({}, params));
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
      description: `Apply new AI textures to an existing model. Cost: 10 credits (15 at 8K).

Ask the user for EXACTLY ONE style input (the tool rejects combinations):
  - text_style_prompt: the style in words ("rusty metal", "cartoon")
  - image_style_url: one image used as a STYLE reference
  - multiview_image_urls: 1–4 photos OF THE SAME OBJECT from different angles (not style references)

ai_model "meshy-n1" (Meshy N1, 10 credits) textures from reference images only: image_style_url (one view of the object, read as the front) or multiview_image_urls (front view first, the rest in any order). It makes a 2K base color texture and nothing else, so it takes no text_style_prompt, enable_pbr, 4k/8k or remove_lighting, and the model must be within the Meshy N1 face limit in the API docs.

Example: { input_task_id: "abc-123", text_style_prompt: "rusty metal" }
Meshy N1: { input_task_id: "abc-123", ai_model: "meshy-n1", multiview_image_urls: ["<front>", "<back>"] }`,
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

        if (params.ai_model === AIModel.MESHY_N1) checkMeshyN1Retexture(params);

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

        // multiview_image_urls exists on Meshy 7 and Meshy N1 only, and the API
        // requires the explicit id. On retexture "latest" is Meshy 7, so it is
        // sent as "meshy-7"; meshy-n1 is sent as given.
        let aiModel: string = params.ai_model;
        if (params.multiview_image_urls?.length) {
          if (aiModel === AIModel.LATEST) {
            aiModel = AIModel.MESHY_7;
          } else if (aiModel !== AIModel.MESHY_7 && aiModel !== AIModel.MESHY_N1) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `Error: multiview_image_urls requires ai_model "meshy-7" or "meshy-n1", but "${params.ai_model}" was given.`
              }]
            };
          }
        }
        checkTextureResolution(aiModel, params.texture_resolution, params.hd_texture, "meshy-6, meshy-7 or latest");

        const request: RetextureApiRequest = {
          enable_pbr: params.enable_pbr
        };
        // Meshy-generated models (input_task_id) keep their UV layout by default, as
        // the docs recommend; uploads (model_url) take the API default (fresh unwrap).
        const keepUV = params.enable_original_uv ?? (params.input_task_id ? true : undefined);
        if (keepUV !== undefined) request.enable_original_uv = keepUV;

        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;
        if (params.text_style_prompt) request.text_style_prompt = params.text_style_prompt;
        if (params.image_style_url) request.image_style_url = params.image_style_url;
        if (params.multiview_image_urls?.length) request.multiview_image_urls = params.multiview_image_urls;
        request.ai_model = aiModel;
        if (params.target_formats) request.target_formats = params.target_formats;
        if (params.alpha_thumbnail !== undefined) request.alpha_thumbnail = params.alpha_thumbnail;
        if (params.texture_resolution !== undefined) request.texture_resolution = params.texture_resolution;
        if (params.hd_texture !== undefined) request.hd_texture = params.hd_texture;
        // remove_lighting is meshy-6-only; meshy-6-lite and meshy-n1 refuse it with
        // any value, and meshy-7 ignores it, so it is dropped for every other model.
        if (aiModel === AIModel.MESHY_6 && params.remove_lighting !== undefined) request.remove_lighting = params.remove_lighting;

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
      description: `Auto-rig a humanoid character for animation. Cost: 5 credits, including free walking + running animations (GLB + FBX, separate files).

REQUIREMENT: a textured humanoid (biped) model with a clear body and limbs, ≤300,000 faces (checked first; remesh if over). model_url must be a .glb facing +Z. Generate characters with pose_mode "t-pose" for the best rig.

Next steps: meshy_download_model (task_type "rigging") returns the rigged model and walk/run URLs. Other actions: meshy_list_animations → meshy_animate. A described motion: meshy_text_to_motion → meshy_animate with motion_task_id.`,
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
            const { task: sourceTask } = await getTaskWithAutoInference(client, params.input_task_id);
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
          `Rigging INCLUDES walking + running animations for free, as separate files. \`meshy_download_model\` (task_type "rigging") returns their URLs.\n\`meshy_animate\` (3 credits per action) is for other actions, or walk/run bundled into one multi-clip file.`,
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
      description: `Animate a rigged character (rig_task_id). Cost: 3 credits per action. Give exactly ONE of action_id, action_ids or motion_task_id.

meshy_rig already returns walking and running free, as separate files; include their ids in action_ids only to bundle them into one multi-clip file. meshy_download_model (task_type "animation") returns the file URLs.

Example: { rig_task_id: "abc-123", action_ids: [1, 4, 92] }`,
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
      const sources = [params.action_id !== undefined, params.action_ids !== undefined, params.motion_task_id !== undefined];
      if (sources.filter(Boolean).length !== 1) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: give exactly one of action_id, action_ids or motion_task_id." }]
        };
      }
      try {
        const request: AnimateApiRequest = { rig_task_id: params.rig_task_id };
        if (params.action_id !== undefined) request.action_id = params.action_id;
        if (params.action_ids) request.action_ids = params.action_ids;
        if (params.motion_task_id) request.motion_task_id = params.motion_task_id;

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
          params.action_ids
            ? `Applying ${params.action_ids.length} actions as clips in one file (${params.action_ids.length * ANIMATE_CREDITS_PER_ACTION} credits).`
            : params.motion_task_id
              ? `Applying the motion clip of task "${params.motion_task_id}" to the rigged character.`
              : "Applying custom animation to the rigged character.",
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

  // Text-to-motion tool
  server.registerTool(
    "meshy_text_to_motion",
    {
      title: "Generate Motion Clip from Text",
      description: `Generate a character motion clip (skeleton motion, not a model) from text. Cost: ${TEXT_TO_MOTION_CREDITS.prime} credits (prime) or ${TEXT_TO_MOTION_CREDITS.swift} (swift) — confirm first. Clips are kept for 3 days.

Apply it to a rigged biped with meshy_animate (motion_task_id), or save the clip with meshy_download_model (FBX for prime, BVH for swift; format is ignored).

Example: { prompt: "a boxer throws a jab-cross combo", duration: 4 }`,
      inputSchema: TextToMotionInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof TextToMotionInputSchema>) => {
      try {
        const request: Record<string, unknown> = { prompt: params.prompt, duration: params.duration };
        if (params.mode) request.mode = params.mode;
        const response = await client.post<CreateTaskApiResponse>("/openapi/v1/text-to-motion", request);
        const taskId = response.result;
        const mode = params.mode ?? "prime";
        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Text-to-motion task created (${mode}, ${TEXT_TO_MOTION_CREDITS[mode]} credits). Task ID: ${taskId}`,
            estimated_time: "10-30 seconds"
          },
          params.response_format,
          "Text-to-Motion Task Created",
          `Generating a ${params.duration}s ${mode === "prime" ? "FBX" : "BVH"} motion clip: "${params.prompt}"`,
          "text-to-motion"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error) }]
        };
      }
    }
  );

  // Animation library lookup
  server.registerTool(
    "meshy_list_animations",
    {
      title: "Find Animation Actions",
      description: `Look up preset animations: the action ids meshy_animate takes. Free. Filters combine; with none the whole (long) library comes back, so prefer search or category.

Returns [{ action_id, name, key, category, sub_category, preview_url }]; preview_url is an animated GIF.`,
      inputSchema: ListAnimationsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ListAnimationsInputSchema>) => {
      try {
        const query: Record<string, unknown> = {};
        if (params.search) query.search = params.search;
        if (params.category) query.category = params.category;
        if (params.sub_category) query.sub_category = params.sub_category;
        if (params.action_ids) query.action_ids = params.action_ids.join(",");

        const data = await client.get<LibraryAnimation[]>("/openapi/v1/animations/library", query);
        const animations = Array.isArray(data) ? data : [];

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = [
            `# Animation Library (${animations.length} match${animations.length === 1 ? "" : "es"})`,
            "",
            "| action_id | Name | Category / Sub-category | Preview |",
            "|---|---|---|---|",
            ...animations.map(a => `| ${a.action_id} | ${a.name} | ${a.category} / ${a.sub_category} | ${a.preview_url} |`)
          ].join("\n");
        } else {
          textContent = JSON.stringify(animations, null, 2);
        }
        if (textContent.length > CHARACTER_LIMIT) {
          textContent = textContent.slice(0, CHARACTER_LIMIT) +
            "\n\n[Truncated: narrow the result with search, category or sub_category.]";
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: { count: animations.length, animations }
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error) }]
        };
      }
    }
  );
}
