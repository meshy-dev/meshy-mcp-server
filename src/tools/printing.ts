/**
 * 3D printing tools (send to slicer, analyze printability, process multicolor)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  SendToSlicerInputSchema,
  AnalyzePrintabilityInputSchema,
  ProcessMulticolorInputSchema
} from "../schemas/printing.js";
import { ResponseFormat } from "../constants.js";

/**
 * Build Bambu Studio URL scheme.
 */
function buildBambuStudioUrl(modelUrl: string, fileName: string): string {
  const urlWithFragment = `${modelUrl}#/${fileName}`;
  // macOS uses bambustudioopen://, others use bambustudio://open?file=
  const isMac = process.platform === "darwin";
  if (isMac) {
    return `bambustudioopen://${encodeURIComponent(urlWithFragment)}`;
  }
  return `bambustudio://open?file=${encodeURIComponent(urlWithFragment)}`;
}

/**
 * Register 3D printing tools with the MCP server
 */
export function registerPrintingTools(server: McpServer, _client: MeshyClient) {
  // Send to slicer tool
  server.registerTool(
    "meshy_send_to_slicer",
    {
      title: "Send Model to 3D Printing Slicer",
      description: `Send a 3D model to Bambu Studio via URL scheme, or provide 3MF download for other slicers.

Currently only Bambu Studio supports one-click URL scheme launch. For other slicers (OrcaSlicer, Cura, Creality Print, etc.), visit the Meshy webapp (meshy.ai) for more one-click send options.

Args:
  - model_url (string): Download URL of the model file (required)
  - slicer_type (string): Target slicer. Only "bambu" supports one-click launch. For any other value, provides 3MF download with manual import instructions. (default: "bambu")
  - file_name (string): File name for the model (default: "meshy_model.3mf")
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns (Bambu Studio):
  {
    "slicer_url": "bambustudio://open?file=...",
    "slicer_name": "Bambu Studio",
    "model_url": "https://...",
    "instructions": "Open the URL to launch Bambu Studio..."
  }

Returns (other slicers):
  {
    "model_url": "https://...",
    "instructions": "Download the 3MF file and open it in your slicer..."
  }

Examples:
  - Send to Bambu: { model_url: "https://cdn.meshy.ai/model.3mf" }
  - Other slicer: { model_url: "https://cdn.meshy.ai/model.3mf", slicer_type: "orcaslicer" }`,
      inputSchema: SendToSlicerInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: z.infer<typeof SendToSlicerInputSchema>) => {
      try {
        // Bambu Studio: generate URL scheme for one-click launch
        if (params.slicer_type === "bambu") {
          const slicerUrl = buildBambuStudioUrl(params.model_url, params.file_name);

          const output = {
            slicer_url: slicerUrl,
            slicer_name: "Bambu Studio",
            model_url: params.model_url,
            instructions: `Open the following URL to launch Bambu Studio with the model loaded. On macOS, you can run: open "${slicerUrl}"`
          };

          let textContent: string;
          if (params.response_format === ResponseFormat.MARKDOWN) {
            textContent = `# Send to Bambu Studio

**Slicer URL**:
\`\`\`
${output.slicer_url}
\`\`\`

**Instructions**:
${output.instructions}

**Reminders**:
- Make sure Bambu Studio is installed on your computer
- Check print settings (layer height, infill, supports) in the slicer before printing
- The model URL is temporary and will expire after 24 hours`;
          } else {
            textContent = JSON.stringify(output, null, 2);
          }

          return {
            content: [{ type: "text", text: textContent }],
            structuredContent: output
          };
        }

        // Non-Bambu slicers: provide 3MF download link and manual import guidance
        const output = {
          model_url: params.model_url,
          file_name: params.file_name,
          requested_slicer: params.slicer_type,
          instructions: `Download the 3MF file and open it directly in your slicer software. Most slicers support double-clicking a .3mf file to open it.`
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = `# 3MF Download for Slicer Import

Currently the agent/skill only supports one-click launch for **Bambu Studio**. For more one-click send options, visit the Meshy webapp at **meshy.ai**.

## How to Import

1. **Download** the 3MF file from the URL below
2. **Open** the downloaded \`.3mf\` file — most slicers will auto-launch when you double-click it
3. Alternatively, open your slicer and use **File → Import** to load the file

**Download URL**:
${params.model_url}

**File Name**: ${params.file_name}

**Common Slicer Import Methods**:
- **OrcaSlicer**: File → Import → select .3mf file
- **Cura**: File → Open File(s) → select .3mf file
- **Creality Print**: File → Open → select .3mf file
- **PrusaSlicer**: File → Import → select .3mf file

**Reminders**:
- The download URL is temporary and will expire after 24 hours
- Check print settings (layer height, infill, supports) before printing`;
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

  // Analyze printability tool (placeholder)
  server.registerTool(
    "meshy_analyze_printability",
    {
      title: "Analyze Model Printability",
      description: `[PLACEHOLDER] Analyze a 3D model's suitability for 3D printing.

Currently returns a manual checklist for print readiness. Will be replaced with automated analysis when the Meshy printability API becomes available.

Args:
  - task_id (string): Task ID of the completed model to analyze (required)
  - task_type (enum): Task type (default: "text-to-3d")
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "status": "manual_check_required",
    "checklist": [ ... ],
    "recommendations": [ ... ]
  }

Examples:
  - Analyze model: { task_id: "abc-123", task_type: "text-to-3d" }`,
      inputSchema: AnalyzePrintabilityInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof AnalyzePrintabilityInputSchema>) => {
      try {
        const checklist = [
          { item: "Wall thickness", recommendation: "Minimum 1.2mm for FDM, 0.8mm for resin", status: "check_manually" },
          { item: "Overhangs", recommendation: "Keep below 45° or add supports", status: "check_manually" },
          { item: "Manifold mesh", recommendation: "Ensure mesh is watertight with no holes", status: "check_manually" },
          { item: "Minimum detail size", recommendation: "At least 0.4mm for FDM nozzle, 0.05mm for resin", status: "check_manually" },
          { item: "Base stability", recommendation: "Flat base or add a brim/raft in slicer", status: "check_manually" },
          { item: "Floating parts", recommendation: "All parts should be connected or printed separately", status: "check_manually" }
        ];

        const recommendations = [
          "Import the 3MF file into your slicer to check for mesh errors",
          "Use the slicer's built-in repair tool if issues are detected",
          "Consider adding supports for overhanging features",
          "Scale the model appropriately for your printer's build volume",
          "For figurines/miniatures, consider hollowing the model to save material"
        ];

        const output = {
          task_id: params.task_id,
          status: "manual_check_required",
          message: "Automated printability analysis is not yet available. Please review the checklist below.",
          checklist,
          recommendations
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = `# Printability Analysis

**Task ID**: ${params.task_id}
**Status**: Manual check required

> Automated printability analysis is not yet available. Please review the checklist below.

## Checklist

| Check | Recommendation | Status |
|-------|---------------|--------|
${checklist.map(c => `| ${c.item} | ${c.recommendation} | Check manually |`).join("\n")}

## Recommendations

${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
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

  // Process multicolor tool (placeholder)
  server.registerTool(
    "meshy_process_multicolor",
    {
      title: "Process Multi-Color 3D Print",
      description: `[PLACEHOLDER] Process a 3D model for multi-color 3D printing.

Currently returns multi-color printing guidance. Will be replaced with automated color separation when the Meshy multi-color API becomes available.

Args:
  - task_id (string): Task ID of the completed model to process (required)
  - task_type (enum): Task type (default: "text-to-3d")
  - num_colors (number): Number of colors to process (2-16, default: 4)
  - response_format (enum): Output format - "markdown" or "json" (default: "markdown")

Returns:
  {
    "status": "guidance_only",
    "num_colors": 4,
    "suggestions": [ ... ]
  }

Examples:
  - Process 4-color: { task_id: "abc-123", task_type: "text-to-3d", num_colors: 4 }`,
      inputSchema: ProcessMulticolorInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ProcessMulticolorInputSchema>) => {
      try {
        const suggestions = [
          `Use a multi-color capable printer (e.g., Bambu Lab AMS, Prusa MMU) for ${params.num_colors}-color printing`,
          "Retexture the model with distinct color regions using meshy_retexture before export",
          "In your slicer, use the color painting tool to manually assign filament colors to different regions",
          "Consider using a single-extruder printer with manual filament swaps at specific layer heights",
          "For resin printing, consider painting the model after printing for best color results"
        ];

        const output = {
          task_id: params.task_id,
          status: "guidance_only",
          message: "Automated multi-color processing is not yet available. See suggestions below.",
          num_colors: params.num_colors,
          suggestions
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = `# Multi-Color Processing

**Task ID**: ${params.task_id}
**Requested Colors**: ${params.num_colors}
**Status**: Guidance only

> Automated multi-color processing is not yet available. See suggestions below.

## Suggestions

${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Current Workaround

1. Use \`meshy_retexture\` to apply distinct color regions to your model
2. Download as 3MF format using \`meshy_download_model\` with format="3mf"
3. In your slicer's color painting tool, assign filament colors to regions
4. Slice and print with your multi-color setup`;
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
