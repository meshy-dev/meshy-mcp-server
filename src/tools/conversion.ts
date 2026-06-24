/**
 * Standalone post-processing tools: convert, resize, uv-unwrap.
 *
 *   - POST /openapi/v1/convert    — 1 credit, format conversion (cheaper than remesh)
 *   - POST /openapi/v1/resize     — 1 credit, real-world resizing
 *   - POST /openapi/v1/uv-unwrap  — 5 credits, fresh UV layout (GLB only, ≤40k faces)
 *
 * All three accept exactly one of input_task_id / model_url.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  ConvertInputSchema,
  ResizeInputSchema,
  UvUnwrapInputSchema,
  validateExactlyOneResizeMode
} from "../schemas/conversion.js";
import { validateExactlyOneSource } from "../schemas/printing.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import { ResponseFormat } from "../constants.js";
import {
  CreateTaskApiResponse,
  ConvertApiRequest,
  ResizeApiRequest,
  UvUnwrapApiRequest
} from "../types.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";

/**
 * Register conversion / resize / uv-unwrap tools with the MCP server
 */
export function registerConversionTools(server: McpServer, client: MeshyClient) {
  // ── Convert ─────────────────────────────────────────────────────────
  server.registerTool(
    "meshy_convert",
    {
      title: "Convert 3D Model Format",
      description: `Convert an existing 3D model into one or more file formats. Cost: 1 credit (cheaper than remesh for format-only conversion).

Provide EXACTLY ONE of input_task_id / model_url, plus target_formats.

Args:
  - input_task_id (string, optional): SUCCEEDED Meshy task whose model to convert. Mutually exclusive with model_url.
  - model_url (string, optional): Public URL or data URI of a model (.glb / .gltf / .obj / .fbx / .stl). Mutually exclusive with input_task_id.
  - target_formats (array, REQUIRED): Output formats. Options: glb, fbx, obj, usdz, blend, stl, 3mf.
  - response_format (enum): "markdown" or "json" (default: "markdown")

Next Steps:
  Use meshy_get_task_status with task_id and task_type="convert" to wait for completion, then meshy_download_model.

Examples:
  - To STL+3MF for printing: { input_task_id: "abc-123", target_formats: ["stl", "3mf"] }
  - From a URL:               { model_url: "https://example.com/model.glb", target_formats: ["fbx"] }`,
      inputSchema: ConvertInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ConvertInputSchema>) => {
      const validationError = validateExactlyOneSource(params);
      if (validationError) {
        return { isError: true, content: [{ type: "text", text: validationError }] };
      }
      try {
        const request: ConvertApiRequest = { target_formats: params.target_formats };
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/convert",
          request as unknown as Record<string, unknown>
        );
        const taskId = response.result;
        const sourceDesc = params.input_task_id ? `task "${params.input_task_id}"` : "model URL";

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Convert task created for ${sourceDesc} → ${params.target_formats.join(", ")}. Cost: 1 credit.`,
            estimated_time: "10-30 seconds"
          },
          params.response_format as ResponseFormat,
          "Convert Task Created",
          `Converting ${sourceDesc} to: ${params.target_formats.join(", ")}.`,
          "convert"
        );
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_convert" }) }] };
      }
    }
  );

  // ── Resize ──────────────────────────────────────────────────────────
  server.registerTool(
    "meshy_resize",
    {
      title: "Resize 3D Model to Real-World Dimensions",
      description: `Resize an existing 3D model to real-world dimensions. Cost: 1 credit.

Provide EXACTLY ONE of input_task_id / model_url, AND exactly one resize mode.

Args:
  - input_task_id (string, optional): SUCCEEDED Meshy task (output is GLB). Mutually exclusive with model_url.
  - model_url (string, optional): Public URL or data URI of a model (.glb / .gltf / .obj / .fbx / .stl); output preserves input format. Mutually exclusive with input_task_id.
  - resize_height (number, optional): Exact height in meters.
  - resize_longest_side (number, optional): Longest side in meters (aspect ratio preserved).
  - auto_size (boolean, optional): AI-estimate the real-world height and resize.
    (Provide EXACTLY ONE of resize_height / resize_longest_side / auto_size.)
  - origin_at (enum, optional): "bottom" (default) or "center".
  - response_format (enum): "markdown" or "json" (default: "markdown")

Next Steps:
  Use meshy_get_task_status with task_id and task_type="resize" to wait for completion.

Examples:
  - 5 cm tall figurine: { input_task_id: "abc-123", resize_height: 0.05 }
  - Auto-size:          { model_url: "https://example.com/model.glb", auto_size: true }`,
      inputSchema: ResizeInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ResizeInputSchema>) => {
      const sourceError = validateExactlyOneSource(params);
      if (sourceError) {
        return { isError: true, content: [{ type: "text", text: sourceError }] };
      }
      const modeError = validateExactlyOneResizeMode(params);
      if (modeError) {
        return { isError: true, content: [{ type: "text", text: modeError }] };
      }
      try {
        const request: ResizeApiRequest = {};
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;
        if (params.resize_height !== undefined) request.resize_height = params.resize_height;
        if (params.resize_longest_side !== undefined) request.resize_longest_side = params.resize_longest_side;
        if (params.auto_size !== undefined) request.auto_size = params.auto_size;
        if (params.origin_at) request.origin_at = params.origin_at;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/resize",
          request as unknown as Record<string, unknown>
        );
        const taskId = response.result;
        const sourceDesc = params.input_task_id ? `task "${params.input_task_id}"` : "model URL";
        const modeDesc = params.auto_size
          ? "auto-estimated size"
          : params.resize_height !== undefined
            ? `${params.resize_height} m tall`
            : `${params.resize_longest_side} m longest side`;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Resize task created for ${sourceDesc} (${modeDesc}). Cost: 1 credit.`,
            estimated_time: "10-30 seconds"
          },
          params.response_format as ResponseFormat,
          "Resize Task Created",
          `Resizing ${sourceDesc} to ${modeDesc}.`,
          "resize"
        );
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_resize" }) }] };
      }
    }
  );

  // ── UV Unwrap ───────────────────────────────────────────────────────
  server.registerTool(
    "meshy_uv_unwrap",
    {
      title: "Generate UV Unwrap for a 3D Model",
      description: `Generate a clean, non-overlapping UV layout ("UV white model") for an existing 3D model — the prerequisite step before external texturing (Blender, Substance Painter, Unreal). Cost: 5 credits.

The output preserves the input geometry with fresh UV coordinates and a placeholder grey material (treated as untextured by standard tools). Quad/n-gon meshes are triangulated.

LIMITS: GLB only; meshes over 40,000 faces are rejected with 400 — run meshy_remesh first to reduce polycount.

Provide EXACTLY ONE of:
  - input_task_id (string, optional): SUCCEEDED Meshy task that produced a GLB (≤40k faces). Mutually exclusive with model_url.
  - model_url (string, optional): Public URL or data URI of a .glb model (≤40k faces). Mutually exclusive with input_task_id.
  - response_format (enum): "markdown" or "json" (default: "markdown")

Next Steps:
  Use meshy_get_task_status with task_id and task_type="uv-unwrap" to wait for completion, then meshy_download_model (format "glb").

Examples:
  - From a task: { input_task_id: "abc-123" }
  - From a URL:  { model_url: "https://example.com/model.glb" }`,
      inputSchema: UvUnwrapInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof UvUnwrapInputSchema>) => {
      const validationError = validateExactlyOneSource(params);
      if (validationError) {
        return { isError: true, content: [{ type: "text", text: validationError }] };
      }
      try {
        const request: UvUnwrapApiRequest = {};
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/uv-unwrap",
          request as unknown as Record<string, unknown>
        );
        const taskId = response.result;
        const sourceDesc = params.input_task_id ? `task "${params.input_task_id}"` : "model URL";

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `UV Unwrap task created for ${sourceDesc}. Cost: 5 credits.`,
            estimated_time: "~2 minutes"
          },
          params.response_format as ResponseFormat,
          "UV Unwrap Task Created",
          `Generating a fresh UV layout for ${sourceDesc}. Output is a single GLB UV white model.`,
          "uv-unwrap"
        );
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_uv_unwrap" }) }] };
      }
    }
  );
}
