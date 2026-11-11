#!/usr/bin/env node
/**
 * Meshy MCP Server
 *
 * Model Context Protocol server for Meshy AI's 3D generation platform.
 * Enables AI agents to create and manage 3D models programmatically.
 */

// Load environment variables from .env file
import dotenv from "dotenv";
// Redirect console.log to stderr during dotenv load to prevent stdio corruption
// (dotenv may call console.log which would corrupt the stdio JSON-RPC transport)
const originalLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);
dotenv.config();
console.log = originalLog;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import { createMeshyClient } from "./services/meshy-client.js";
import type { HostInfo } from "./utils/user-agent.js";
import { registerGenerationTools } from "./tools/generation.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerPostProcessingTools } from "./tools/postprocessing.js";
import { registerConversionTools } from "./tools/conversion.js";
import { registerImageTools } from "./tools/image.js";
import { registerPrintingTools } from "./tools/printing.js";
import { registerCreativeLabTools } from "./tools/creative-lab.js";
import { registerBalanceTool } from "./tools/balance.js";
import { registerViewerTools } from "./tools/viewer.js";
import { MESHY_INSTRUCTIONS, VIEWER_ONLY_INSTRUCTIONS } from "./instructions.js";
import { VERSION } from "./version.js";

/**
 * Which tools to register, from MESHY_TOOLS: every tool (unset or "all"), or
 * "viewer" for the 3D viewer alone, for an integration that creates and
 * downloads models another way and only needs to show them. Any other value
 * stops the server: falling back to every tool would hand that integration
 * the paid tools it meant to leave out.
 */
function readToolSet(): "all" | "viewer" {
  const value = process.env.MESHY_TOOLS?.trim().toLowerCase() || "all";
  if (value === "all" || value === "viewer") return value;
  console.error(`MESHY_TOOLS must be "all" or "viewer", not "${process.env.MESHY_TOOLS}".`);
  process.exit(1);
}

const TOOL_SET = readToolSet();

// Create MCP server instance
const server = new McpServer(
  { name: "@meshy-ai/meshy-mcp-server", version: VERSION },
  { instructions: TOOL_SET === "viewer" ? VIEWER_ONLY_INSTRUCTIONS : MESHY_INSTRUCTIONS }
);

/**
 * Initialize server and register tools. `clientInfo` names the connected MCP
 * client in the API User-Agent.
 */
async function initializeServer(clientInfo?: () => HostInfo | undefined) {
  try {
    if (TOOL_SET === "viewer") {
      // No Meshy client: the viewer shows local files and never calls the API,
      // so this mode needs no API key.
      registerViewerTools(server);
      console.error("✓ Server initialized with the 3D viewer only (MESHY_TOOLS=viewer)");
      return;
    }

    // Create Meshy API client (the key is checked on the first tool call)
    const meshyClient = createMeshyClient(clientInfo);
    console.error("✓ Meshy client initialized");

    // Register all tools
    console.error("Registering MCP tools...");

    registerGenerationTools(server, meshyClient);
    console.error("  ✓ Generation tools registered (text-to-3d, text-to-3d-refine, image-to-3d, multi-image-to-3d)");

    registerTaskTools(server, meshyClient);
    console.error("  ✓ Task management tools registered (get status, list, cancel, download)");

    registerWorkspaceTools(server, meshyClient);
    console.error("  ✓ Workspace tools registered (list models)");

    registerPostProcessingTools(server, meshyClient);
    console.error("  ✓ Post-processing tools registered (remesh, retexture, rig, animate, text-to-motion, animation library)");

    registerConversionTools(server, meshyClient);
    console.error("  ✓ Conversion tools registered (convert, resize, uv-unwrap)");

    registerImageTools(server, meshyClient);
    console.error("  ✓ Image tools registered (text-to-image, image-to-image)");

    registerPrintingTools(server, meshyClient);
    console.error("  ✓ Printing tools registered (send-to-slicer, analyze-printability, repair-printability, process-multicolor, auto-split)");

    registerCreativeLabTools(server, meshyClient);
    console.error("  ✓ Creative Lab tool registered (end-to-end prototype→build)");

    registerBalanceTool(server, meshyClient);
    console.error("  ✓ Account tools registered (check-balance, list-usage)");

    registerViewerTools(server, meshyClient);
    console.error("  ✓ 3D viewer registered (view-model, an MCP App)");

    console.error("✓ Server initialized successfully with 29 tools");
  } catch (error) {
    console.error("Failed to initialize server:", error);
    throw error;
  }
}

/**
 * Strip the `$schema` dialect marker from every tool schema we publish.
 *
 * The SDK converts our Zod schemas with zod-to-json-schema, which stamps
 * `"$schema": "http://json-schema.org/draft-07/schema#"` on both inputSchema
 * and outputSchema — with no way to override it (verified on SDK 1.27-1.30,
 * Zod 3 and 4). Claude Desktop compiles tool schemas with an Ajv configured
 * for JSON Schema 2020-12 only, so it rejects every tool carrying that marker:
 * "Tool 'x' has an invalid outputSchema: JSON Schema declares an unsupported
 * dialect". Our schemas use nothing dialect-specific, so dropping the marker
 * lets each client validate under its own default (2020-12) and keeps the
 * schemas themselves intact.
 *
 * Remove this once the SDK stops hardcoding draft-07.
 */
function stripSchemaDialect(transport: Transport): Transport {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const tools = (message as { result?: { tools?: unknown } }).result?.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        delete tool?.inputSchema?.$schema;
        delete tool?.outputSchema?.$schema;
      }
    }
    return send(message, options);
  };
  return transport;
}

/**
 * Run server with stdio transport (for local integrations)
 */
async function runStdio() {
  console.error("Starting Meshy MCP Server (stdio mode)...");

  // One client per process, so its handshake clientInfo names the host.
  await initializeServer(() => server.server.getClientVersion());

  // SDK 1.32 closes the stdio connection on any incoming message over 10 MB,
  // which would cut off a model_url `data:` URI (documented up to 100 MB).
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 128 * 1024 * 1024 });
  await server.connect(stripSchemaDialect(transport));

  console.error("✓ Meshy MCP Server running via stdio");
  console.error("Ready to accept requests from MCP client");
}

/**
 * Run server with HTTP transport (for remote access)
 */
async function runHTTP() {
  console.error("Starting Meshy MCP Server (HTTP mode)...");

  // No clientInfo: one stateless server answers every caller, so the last
  // handshake seen need not be the caller's. MESHY_CLIENT still applies.
  await initializeServer();

  const app = express();
  // Allow large request bodies so callers can pass `model_url` as a `data:` URI
  // for the print/analyze, print/repair, and print/multi-color tools. Meshy
  // accepts a data: URI model up to 100 MB (an http(s) URL up to 400 MB, which
  // never passes through this body). The cap applies to the whole JSON body, so
  // with base64 an inline model tops out near 75 MB.
  app.use(express.json({ limit: "100mb" }));

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", server: "meshy-mcp-server", version: VERSION });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => transport.close());

    await server.connect(stripSchemaDialect(transport));
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);

  app.listen(port, () => {
    console.error(`✓ Meshy MCP Server running on http://localhost:${port}/mcp`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}

/**
 * Main entry point
 */
async function main() {
  const transport = process.env.TRANSPORT || "stdio";

  if (TOOL_SET === "viewer" && transport === "http") {
    console.error("MESHY_TOOLS=viewer needs the stdio transport: it shows local files, which the HTTP server does not read.");
    process.exit(1);
  }

  try {
    if (transport === "http") {
      await runHTTP();
    } else {
      await runStdio();
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.error("\nShutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("\nShutting down gracefully...");
  process.exit(0);
});

// Start the server
main();
