/**
 * Relief tool — one photo → a bas-relief 3D model and a 16-bit grayscale depth
 * map, for 3D printing, laser engraving and CNC carving.
 *
 *   - POST /openapi/v1/relief — 20 credits per task, depth-map-only included
 *
 * The task is read, listed and deleted on the same route (task_type "relief");
 * meshy_download_model saves its model and depth map.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { resolveImageSource } from "../services/file-utils.js";
import { ReliefInputSchema, checkReliefParams } from "../schemas/relief.js";
import { TaskCreatedOutputSchema } from "../schemas/output.js";
import { RELIEF_CREDITS, TaskType } from "../constants.js";
import { CreateTaskApiResponse } from "../types.js";
import { getTaskEndpoint } from "../utils/endpoints.js";
import { buildApiRequest } from "../utils/request-builder.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";

/**
 * Register the Relief tool with the MCP server
 */
export function registerReliefTools(server: McpServer, client: MeshyClient) {
  server.registerTool(
    "meshy_relief",
    {
      title: "Relief — Photo to Bas-Relief Model",
      description: `Turn one photo (file_path or image_url) into a bas-relief 3D model and a 16-bit grayscale depth map, for 3D printing, laser engraving, CNC carving and plaques. Cost: ${RELIEF_CREDITS} credits, depth map only included; needs a paid plan. Confirm the use and options first.

  - variant: "low" (default) shallow, for laser engraving, CNC and thin plaques; "high" deeper, for 3D-printed pieces
  - should_generate_model false: the depth map only (a height map for laser / CNC software), no model
  - target_formats: only these are made (default glb + stl). STL (mm, Z up) and 3MF keep the real size. Files are large: at mesh_resolution 1024 a GLB is ~40–50 MB and an STL ~80–105 MB; ~150 / ~300 MB at 2048, more with a bend
  - color_mapping true: GLB, OBJ, FBX and USDZ carry the photo's color; STL and 3MF stay white
Photo: JPG, PNG or WebP, at most 20 MB, at least 32×32 px, longer side at most ~16× the shorter.

Wait with meshy_get_task_status (task_type "relief"), then meshy_download_model, which also saves the depth map. A relief task cannot be the input of other tools (remesh, convert, resize, auto split...), so set its formats and size here.

Example (3D print): { file_path: "/path/to/photo.jpg", variant: "high", size_mm: 120, target_formats: ["stl"] }`,
      inputSchema: ReliefInputSchema,
      outputSchema: TaskCreatedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ReliefInputSchema>) => {
      const invalid = checkReliefParams(params);
      if (invalid) {
        return { isError: true, content: [{ type: "text", text: `Error: ${invalid}` }] };
      }
      try {
        const { image_url, file_path, ...options } = params;
        const request = buildApiRequest({ image_url: await resolveImageSource(image_url, file_path) }, options);

        const response = await client.post<CreateTaskApiResponse>(getTaskEndpoint(TaskType.RELIEF), request);
        const taskId = response.result;
        const depthOnly = params.should_generate_model === false;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Relief task created${depthOnly ? " (depth map only)" : ""}. Cost: ${RELIEF_CREDITS} credits.`,
            estimated_time: "a few minutes"
          },
          params.response_format,
          "Relief Task Created",
          depthOnly
            ? "Building the depth map of the photo, with no model. `meshy_download_model` saves it as a 16-bit PNG."
            : `Building a ${params.variant ?? "low"} relief from the photo (${(params.target_formats ?? ["glb", "stl"]).join(", ")}). \`meshy_download_model\` saves the model and its depth map.`,
          TaskType.RELIEF
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error, { tool: "meshy_relief" }) }]
        };
      }
    }
  );
}
