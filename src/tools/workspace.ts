/**
 * Workspace tools (list models)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient, listAcrossTypes } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { ListModelsInputSchema } from "../schemas/tasks.js";
import { ResponseFormat, TaskStatus, CHARACTER_LIMIT } from "../constants.js";
import { Task, ModelSummary } from "../types.js";

/** The formats a finished task can be downloaded in; empty when it has no model. */
function modelFormats(task: Task): string[] {
  // The MTL comes with the OBJ; it is not a format of its own.
  const formats = Object.entries(task.model_urls ?? {}).filter(([format, url]) => url && format !== "mtl").map(([format]) => format);
  // Rigging and animation tasks keep their files under result.
  const r = task.result;
  if (r?.rigged_character_glb_url || r?.animation_glb_url) formats.push("glb");
  if (r?.rigged_character_fbx_url || r?.animation_fbx_url) formats.push("fbx");
  return formats;
}

/**
 * Register workspace tools with the MCP server
 */
export function registerWorkspaceTools(server: McpServer, client: MeshyClient) {
  server.registerTool(
    "meshy_list_models",
    {
      title: "List Finished 3D Models",
      description: `List your finished 3D models (not AI models), newest first, each with its task_id, task_type and formats ready for meshy_download_model. Queries only image-to-3d by default (one request); pass task_types to widen. meshy_list_tasks lists tasks of any status instead, images included.`,
      inputSchema: ListModelsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ListModelsInputSchema>) => {
      try {
        const listed = await listAcrossTypes(client, params.task_types, {
          sortBy: "-created_at",
          offset: params.offset,
          limit: params.limit,
          keep: task => task.status === TaskStatus.SUCCEEDED && modelFormats(task).length > 0
        });

        const models: ModelSummary[] = listed.items.map(({ task, taskType }) => ({
          id: task.id,
          task_type: taskType,
          name: task.name || task.prompt || "Untitled Model",
          formats: modelFormats(task),
          thumbnail_url: task.thumbnail_url,
          created_at: task.created_at,
          vertex_count: task.vertex_count,
          face_count: task.face_count
        }));

        const output = {
          page_count: models.length,
          offset: params.offset,
          queried_types: params.task_types,
          note: `Only ${params.task_types.join(", ")} queried; models of other types need task_types.`,
          models,
          has_more: listed.hasMore,
          next_offset: listed.hasMore ? params.offset + models.length : undefined,
          failed_types: listed.failed.length > 0 ? listed.failed : undefined
        };

        const renderModelsMarkdown = (modelList: ModelSummary[], truncated = false) => {
          const lines = [`# 3D Models`, ""];
          lines.push(`**Showing**: ${modelList.length} models [${params.task_types.join(", ")}] (offset: ${output.offset})`);
          lines.push(`*${output.note}*`);
          if (truncated) lines.push(`*(truncated from ${models.length} results)*`);
          lines.push("");

          for (const model of modelList) {
            lines.push(`## ${model.name} [${model.task_type}] (${model.id})`);
            lines.push(`- **Formats**: ${model.formats.join(", ")}`);
            lines.push(`- **Created**: ${new Date(model.created_at).toLocaleString()}`);
            if (model.vertex_count && model.face_count) {
              lines.push(`- **Geometry**: ${model.vertex_count.toLocaleString()} vertices, ${model.face_count.toLocaleString()} faces`);
            }
            lines.push("");
          }

          if (output.has_more) {
            lines.push(`**More results available**. Use offset=${output.next_offset} to see next page.`);
          }
          if (output.failed_types) {
            lines.push(`**Not listed** (request failed): ${output.failed_types.join(", ")}`);
          }
          return lines.join("\n");
        };

        let textContent = params.response_format === ResponseFormat.MARKDOWN
          ? renderModelsMarkdown(output.models)
          : JSON.stringify(output, null, 2);

        // Over the character limit: re-render in the same format with half the models.
        if (textContent.length > CHARACTER_LIMIT) {
          const truncatedModels = output.models.slice(0, Math.max(1, Math.floor(output.models.length / 2)));
          output.models = truncatedModels;
          output.page_count = truncatedModels.length;
          output.has_more = true;
          output.next_offset = params.offset + truncatedModels.length;
          textContent = (params.response_format === ResponseFormat.MARKDOWN
            ? renderModelsMarkdown(truncatedModels, true)
            : JSON.stringify(output, null, 2)) +
            `\n\n[Response truncated. Use smaller limit to see more results.]`;
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output
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
