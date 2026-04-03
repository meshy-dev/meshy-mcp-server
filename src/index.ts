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
import express from "express";
import { createMeshyClient } from "./services/meshy-client.js";
import { registerGenerationTools } from "./tools/generation.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerPostProcessingTools } from "./tools/postprocessing.js";
import { registerImageTools } from "./tools/image.js";
import { registerPrintingTools } from "./tools/printing.js";
import { registerBalanceTool } from "./tools/balance.js";
import { MESHY_INSTRUCTIONS } from "./instructions.js";

// Create MCP server instance
const server = new McpServer(
  { name: "@meshy-ai/meshy-mcp-server", version: "0.2.0" },
  { instructions: MESHY_INSTRUCTIONS }
);

/**
 * Initialize server and register tools
 */
async function initializeServer() {
  try {
    // Create and validate Meshy API client
    const meshyClient = await createMeshyClient();
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
    console.error("  ✓ Post-processing tools registered (remesh, retexture, rig, animate)");

    registerImageTools(server, meshyClient);
    console.error("  ✓ Image tools registered (text-to-image, image-to-image)");

    registerPrintingTools(server, meshyClient);
    console.error("  ✓ Printing tools registered (send-to-slicer, analyze-printability, process-multicolor)");

    registerBalanceTool(server, meshyClient);
    console.error("  ✓ Balance tool registered (check-balance)");

    console.error("✓ Server initialized successfully with 19 tools");
    return meshyClient;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    throw error;
  }
}

/**
 * Run server with stdio transport (for local integrations)
 */
async function runStdio() {
  console.error("Starting Meshy MCP Server (stdio mode)...");

  await initializeServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("✓ Meshy MCP Server running via stdio");
  console.error("Ready to accept requests from MCP client");
}

/**
 * Run server with HTTP transport (for remote access)
 */
async function runHTTP() {
  console.error("Starting Meshy MCP Server (HTTP mode)...");

  await initializeServer();

  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", server: "meshy-mcp-server", version: "1.0.0" });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
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
