/**
 * Workspace tools (list models)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { ListModelsInputSchema } from "../schemas/tasks.js";
import { ResponseFormat, TaskStatus, CHARACTER_LIMIT } from "../constants.js";
import { Task, ModelSummary } from "../types.js";

/**
 * Register workspace tools with the MCP server
 */
export function registerWorkspaceTools(server: McpServer, client: MeshyClient) {
  // List models tool
  server.registerTool(
    "meshy_list_models",
    {
      title: "List Workspace Models",
      description: `Browse 3D models in your workspace with filtering and pagination.

This tool lists all completed models in your workspace. Only shows models with status SUCCEEDED.

Args:
  - workspace_id (string, optional): Workspace ID (uses default workspace if omitted)
  - filter (enum): Filter by visibility - "all", "published", or "private" (default: "all")
  - limit (number): Results per page, 1-100 (default: 20)
  - offset (number): Skip N results for pagination (default: 0)
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "page_count": 20,
    "offset": 0,
    "models": [
      {
        "id": "abc-123",
        "name": "Dragon model",
        "thumbnail_url": "https://...",
        "created_at": "2026-03-02T10:00:00Z",
        "vertex_count": 45231,
        "face_count": 89456,
        "is_published": false
      }
    ],
    "has_more": true,
    "next_offset": 20
  }

Use Cases:
  - Browse your generated models
  - Find models by creation date
  - Filter published vs private models

Examples:
  - List recent models: { limit: 10 }
  - List published models: { filter: "published" }
  - Get second page: { limit: 20, offset: 20 }

Error Handling:
  - Automatically truncates if response exceeds size limit`,
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
        const pageSize = params.limit;
        const pageNum = Math.floor(params.offset / pageSize) + 1;
        const queryParams: Record<string, string | number> = {
          status: TaskStatus.SUCCEEDED,
          page_size: pageSize,
          page_num: pageNum
        };

        // API returns Task[] directly
        const response = await client.get<Task[]>("/openapi/v2/text-to-3d", queryParams);
        const tasks = Array.isArray(response) ? response : [];

        let filteredTasks = tasks;
        if (params.filter === "published") {
          filteredTasks = filteredTasks.filter(task => task.model_urls && task.is_published);
        } else if (params.filter === "private") {
          filteredTasks = filteredTasks.filter(task => task.model_urls && !task.is_published);
        }

        const models: ModelSummary[] = filteredTasks
          .filter(task => task.model_urls)
          .map(task => ({
            id: task.id,
            name: task.name || task.prompt || "Untitled Model",
            thumbnail_url: task.thumbnail_url || "",
            created_at: task.created_at,
            vertex_count: task.vertex_count,
            face_count: task.face_count,
            is_published: task.is_published || false
          }));

        const output = {
          page_count: models.length,
          offset: params.offset,
          models,
          has_more: tasks.length >= pageSize,
          next_offset: tasks.length >= pageSize
            ? params.offset + tasks.length
            : undefined
        };

        // Helper to render models as markdown
        const renderModelsMarkdown = (modelList: ModelSummary[], totalCount: number, truncated = false) => {
          const lines = [`# Workspace Models`, ""];
          lines.push(`**Showing**: ${totalCount} models on this page (offset: ${output.offset})`);
          if (truncated) lines.push(`*(truncated from ${models.length} results)*`);
          lines.push("");

          for (const model of modelList) {
            lines.push(`## ${model.name}`);
            lines.push(`- **ID**: ${model.id}`);
            lines.push(`- **Created**: ${new Date(model.created_at).toLocaleString()}`);
            if (model.vertex_count && model.face_count) {
              lines.push(`- **Geometry**: ${model.vertex_count.toLocaleString()} vertices, ${model.face_count.toLocaleString()} faces`);
            }
            lines.push(`- **Published**: ${model.is_published ? 'Yes' : 'No'}`);
            lines.push(`- **Thumbnail**: ${model.thumbnail_url}`);
            lines.push("");
          }

          if (output.has_more) {
            lines.push(`**More results available**. Use offset=${output.next_offset} to see next page.`);
          }
          return lines.join("\n");
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = renderModelsMarkdown(output.models, output.page_count);
        } else {
          textContent = JSON.stringify(output, null, 2);
        }

        // Check character limit — re-render in same format with fewer models
        if (textContent.length > CHARACTER_LIMIT) {
          const truncatedModels = output.models.slice(0, Math.max(1, Math.floor(output.models.length / 2)));
          output.models = truncatedModels;
          output.page_count = truncatedModels.length;
          if (params.response_format === ResponseFormat.MARKDOWN) {
            textContent = renderModelsMarkdown(truncatedModels, truncatedModels.length, true) +
              `\n\n[Response truncated. Use smaller limit to see more results.]`;
          } else {
            textContent = JSON.stringify(output, null, 2) +
              `\n\n[Response truncated. Use smaller limit to see more results.]`;
          }
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output
        };
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
