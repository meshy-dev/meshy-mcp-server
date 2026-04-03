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
import { ResponseFormat, SlicerType, MULTICOLOR_CAPABLE_SLICERS } from "../constants.js";
import { CreateTaskApiResponse, MultiColorPrintApiRequest } from "../types.js";
import { formatTaskCreatedResponse } from "../utils/response-formatter.js";
import {
  detectInstalledSlicers,
  detectSlicer,
  getBestMulticolorSlicer,
  DetectedSlicer
} from "../utils/slicer-detector.js";

/**
 * Build Bambu Studio URL scheme (kept for backward compat).
 */
function buildBambuStudioUrl(modelUrl: string, fileName: string): string {
  const urlWithFragment = `${modelUrl}#/${fileName}`;
  const isMac = process.platform === "darwin";
  if (isMac) {
    return `bambustudioopen://${encodeURIComponent(urlWithFragment)}`;
  }
  return `bambustudio://open?file=${encodeURIComponent(urlWithFragment)}`;
}

/**
 * Format detected slicers into a markdown table.
 */
function formatSlicerTable(slicers: DetectedSlicer[]): string {
  if (slicers.length === 0) return "No slicers detected.";
  const rows = slicers.map(s =>
    `| ${s.displayName} | ${s.supportsMulticolor ? "Yes" : "No"} | \`${s.path}\` |`
  );
  return `| Slicer | Multicolor | Path |
|--------|-----------|------|
${rows.join("\n")}`;
}

/**
 * Register 3D printing tools with the MCP server
 */
export function registerPrintingTools(server: McpServer, client: MeshyClient) {
  // ── Send to Slicer ──────────────────────────────────────────────
  server.registerTool(
    "meshy_send_to_slicer",
    {
      title: "Send Model to 3D Printing Slicer",
      description: `Detect installed 3D printing slicer software and return launch commands.

IMPORTANT: This tool should be called as the FIRST STEP in any 3D printing workflow — before generating the model. Save the result and reuse it at the end to open the model in the user's chosen slicer.

Supports 7 slicers: OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next, PrusaSlicer, UltiMaker Cura.
Multicolor-capable: OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next.

Usage pattern:
1. Call this tool at the START of a print workflow to detect slicers
2. Present detected slicers to the user
3. Generate and download the model
4. At the END, ask user which slicer to use from the detected list
5. Take the launch_command, replace {file} with the local file path, execute via Bash

Args:
  - model_url (string): Download URL of the model file (can be a placeholder at detection time)
  - slicer_type (enum): 'auto' (default, detect all) or a specific slicer
  - file_name (string): File name for the model (default: "meshy_model.3mf")
  - is_multicolor (boolean): If true, only recommends multicolor-capable slicers (default: false)
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns:
  {
    "detected_slicers": [{"name": "OrcaSlicer", "launch_command": "open -a \\"OrcaSlicer\\" \\"{file}\\"", ...}],
    "recommended_slicer": {"name": "...", "launch_command": "..."},
    "model_url": "https://..."
  }

The launch_command contains {file} as placeholder. Replace it with the actual local file path before executing via Bash.`,
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
        // Step 1: Detect slicers
        let detected: DetectedSlicer[] = [];
        if (params.slicer_type === "auto") {
          detected = detectInstalledSlicers();
        } else {
          const specific = detectSlicer(params.slicer_type as SlicerType);
          if (specific) detected = [specific];
        }

        // Step 2: Filter for multicolor if requested
        if (params.is_multicolor) {
          detected = detected.filter(s => s.supportsMulticolor);
        }

        // Step 3: Pick recommended slicer
        const recommended = params.is_multicolor
          ? getBestMulticolorSlicer(detected)
          : (detected[0] || null);

        // Step 4: Build launch command with actual file name
        const slicerList = detected.map(s => ({
          name: s.displayName,
          type: s.type,
          path: s.path,
          supports_multicolor: s.supportsMulticolor,
          launch_command: s.launchCommand.replace("{file}", params.model_url),
          url_scheme: s.urlScheme
        }));

        const recommendedOutput = recommended ? {
          name: recommended.displayName,
          type: recommended.type,
          launch_command: recommended.launchCommand.replace("{file}", params.model_url),
          supports_multicolor: recommended.supportsMulticolor
        } : null;

        // Bambu URL scheme as bonus
        const bambuSlicer = detected.find(s => s.type === SlicerType.BAMBU);
        const bambuUrlScheme = bambuSlicer
          ? buildBambuStudioUrl(params.model_url, params.file_name)
          : undefined;

        const output = {
          detected_slicers: slicerList,
          recommended_slicer: recommendedOutput,
          model_url: params.model_url,
          file_name: params.file_name,
          bambu_url_scheme: bambuUrlScheme,
          is_multicolor: params.is_multicolor
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          if (detected.length === 0) {
            const slicerSuggestions = params.is_multicolor
              ? "OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, or Anycubic Slicer Next"
              : "OrcaSlicer, Bambu Studio, PrusaSlicer, UltiMaker Cura, or others";
            textContent = `# No Slicer Detected

No ${params.is_multicolor ? "multicolor-capable " : ""}slicer software was found on this system.

**Recommended slicers to install**: ${slicerSuggestions}

**Manual steps**:
1. Download the model from: ${params.model_url}
2. Install a slicer from the list above
3. Open the downloaded file in the slicer: File → Import → select the file`;
          } else {
            const launchCmd = recommendedOutput?.launch_command || "";
            textContent = `# Slicer Detection Result

## Detected Slicers

${formatSlicerTable(detected)}

## Recommended: ${recommendedOutput?.name || "None"}

**Launch command** (execute via Bash):
\`\`\`
${launchCmd}
\`\`\`

**Model URL**: ${params.model_url}
**File Name**: ${params.file_name}${bambuUrlScheme ? `\n\n**Bambu Studio URL Scheme**:\n\`\`\`\n${bambuUrlScheme}\n\`\`\`` : ""}

**Reminders**:
- Execute the launch command above to open the model in the slicer
- Check print settings (layer height, infill, supports) in the slicer before printing
- The model URL is temporary and will expire after 24 hours`;
          }
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

  // ── Analyze Printability (placeholder) ──────────────────────────
  server.registerTool(
    "meshy_analyze_printability",
    {
      title: "Analyze Model Printability",
      description: `[PLACEHOLDER] Analyze a 3D model's suitability for 3D printing.

Currently returns a manual checklist for print readiness. Will be replaced with automated analysis when the Meshy printability API becomes available.

Args:
  - task_id (string): Task ID of the completed model to analyze (required)
  - task_type (string): Task type (default: "text-to-3d")
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
          "Import the model file into your slicer to check for mesh errors",
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

  // ── Process Multicolor (real API) ───────────────────────────────
  server.registerTool(
    "meshy_process_multicolor",
    {
      title: "Process Multi-Color 3D Print",
      description: `Process a textured 3D model for multi-color 3D printing. Cost: 10 credits.

Segments the model's texture into discrete color regions and creates a task that outputs a 3MF file ready for multi-color slicers (OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next).

PREREQUISITES:
  - The input model MUST have textures. Run meshy_text_to_3d_refine or meshy_retexture first.
  - A multicolor-capable slicer should be installed on the user's system.

IMPORTANT: Before calling, ask the user to confirm:
  - max_colors: depends on their printer's multi-color capability (e.g. Bambu AMS supports 4-16 colors). Ask how many colors they want.
  - max_depth: affects color boundary precision and file size. Higher = finer but larger. Ask user's preference or suggest default 4.

Args:
  - input_task_id (string): Task ID of a completed TEXTURED model (required)
  - max_colors (number): Max colors for segmentation (1-16, default: 4). MUST confirm with user based on their printer capability.
  - max_depth (number): Segmentation depth (3-6, default: 4). Higher = finer separation, larger file. MUST confirm with user.
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns:
  { "task_id": "...", "status": "PENDING", ... }

Next Steps:
  1. Use meshy_get_task_status with task_id and task_type="multi-color-print" to wait for completion
  2. The completed task will have a 3MF download URL in model_urls
  3. Use meshy_download_model with format="3mf" to download
  4. Use meshy_send_to_slicer with is_multicolor=true to open the 3MF in a multicolor slicer

Examples:
  - Default: { input_task_id: "abc-123" }
  - Custom: { input_task_id: "abc-123", max_colors: 8, max_depth: 5 }`,
      inputSchema: ProcessMulticolorInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ProcessMulticolorInputSchema>) => {
      try {
        const request: MultiColorPrintApiRequest = {
          input_task_id: params.input_task_id
        };
        if (params.max_colors !== undefined) request.max_colors = params.max_colors;
        if (params.max_depth !== undefined) request.max_depth = params.max_depth;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/print/multi-color",
          request as unknown as Record<string, unknown>
        );

        const taskId = response.result;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Multi-color processing started for task "${params.input_task_id}" with ${params.max_colors} colors (depth: ${params.max_depth}). Cost: 10 credits.`,
            estimated_time: "2-5 minutes"
          },
          params.response_format as ResponseFormat,
          "Multi-Color Processing Task Created",
          `Processing model from task "${params.input_task_id}" into ${params.max_colors} colors (depth: ${params.max_depth}). The output will be a 3MF file for multi-color 3D printing.`,
          "multi-color-print"
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
