/**
 * Balance tool — check Meshy account credit balance
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import { CheckBalanceInputSchema } from "../schemas/balance.js";
import { BalanceOutputSchema } from "../schemas/output.js";
import { ResponseFormat } from "../constants.js";
import { BalanceResponse } from "../types.js";

/**
 * Register the balance tool with the MCP server
 */
export function registerBalanceTool(server: McpServer, client: MeshyClient) {
  server.registerTool(
    "meshy_check_balance",
    {
      title: "Check Credit Balance",
      description: `Check your Meshy account credit balance.

Returns the current number of credits available in your account.

Args:
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  { "balance": 150 }

Examples:
  - Check balance: {}
  - JSON format: { response_format: "json" }`,
      inputSchema: CheckBalanceInputSchema,
      outputSchema: BalanceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof CheckBalanceInputSchema>) => {
      try {
        const data = await client.get<BalanceResponse>("/openapi/v1/balance");

        const output = { balance: data.balance };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = `# Meshy Credit Balance\n\n**Balance**: ${data.balance} credits`;
        } else {
          textContent = JSON.stringify(output, null, 2);
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
