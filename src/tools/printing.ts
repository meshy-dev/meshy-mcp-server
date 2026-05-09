/**
 * 3D printing tools — slicer detection, printability analysis, model repair, multicolor processing.
 *
 * Wires up real Meshy print API endpoints:
 *   - POST /openapi/v1/print/analyze   — free FDM printability check
 *   - POST /openapi/v1/print/repair    — 10 credits, fixes topology issues
 *   - POST /openapi/v1/print/multi-color — 10 credits, outputs multicolor 3MF
 *
 * Slicer detection scans the local filesystem for 7 supported slicers and
 * returns launch commands; the agent (not this server) executes them.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeshyClient } from "../services/meshy-client.js";
import { handleMeshyError } from "../services/error-handler.js";
import {
  SendToSlicerInputSchema,
  AnalyzePrintabilityInputSchema,
  RepairPrintabilityInputSchema,
  ProcessMulticolorInputSchema,
  validateExactlyOneSource
} from "../schemas/printing.js";
import { ResponseFormat, SlicerType } from "../constants.js";
import {
  CreateTaskApiResponse,
  AnalyzePrintabilityApiRequest,
  RepairPrintabilityApiRequest,
  MultiColorPrintApiRequest
} from "../types.js";
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

/** Format detected slicers into a markdown table. */
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
3. Generate, analyze, optionally repair / multicolor-process, and download the model
4. At the END, take the launch_command, replace {file} with the local file path, execute via Bash

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
        let detected: DetectedSlicer[] = [];
        if (params.slicer_type === "auto") {
          detected = detectInstalledSlicers();
        } else {
          const specific = detectSlicer(params.slicer_type as SlicerType);
          if (specific) detected = [specific];
        }

        if (params.is_multicolor) {
          detected = detected.filter(s => s.supportsMulticolor);
        }

        const recommended = params.is_multicolor
          ? getBestMulticolorSlicer(detected)
          : (detected[0] || null);

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
          content: [{ type: "text", text: handleMeshyError(error) }]
        };
      }
    }
  );

  // ── Analyze Printability ────────────────────────────────────────
  server.registerTool(
    "meshy_analyze_printability",
    {
      title: "Analyze Model Printability (FDM)",
      description: `Run automated FDM printability analysis on a 3D model. Cost: FREE (0 credits).

Reports watertightness, volume, holes, non-manifold edges, and degenerate faces. Use this BEFORE 3D printing to decide whether the mesh needs repair (\`meshy_repair_printability\`).

Provide EXACTLY ONE of:
  - input_task_id: a SUCCEEDED Meshy task. **Must use Meshy 6 or any Preview model**. Supported task types: text-to-3d, image-to-3d, multi-image-to-3d, remesh, retexture.
  - model_url: a public URL of a 3D model file (.glb / .gltf / .obj / .fbx / .stl, max 100 MB).

Args:
  - input_task_id (string, optional): Upstream Meshy task ID
  - model_url (string, optional): Public model URL
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns:
  { "task_id": "...", "status": "PENDING", ... }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="print-analyze" to wait for completion.
  Once SUCCEEDED, the task object's \`printability\` field contains:
    - status: "healthy" / "warning" / "error" / "unknown"
    - issue_count, error_count, warning_count
    - metrics: { is_watertight, volume, non_manifold_edges, degenerate_faces, holes }
  - status="error" → call meshy_repair_printability before printing.
  - status="warning" → repair is optional but recommended for FDM.

Examples:
  - From a task: { input_task_id: "abc-123" }
  - From a URL:  { model_url: "https://example.com/model.glb" }`,
      inputSchema: AnalyzePrintabilityInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof AnalyzePrintabilityInputSchema>) => {
      const validationError = validateExactlyOneSource(params);
      if (validationError) {
        return {
          isError: true,
          content: [{ type: "text", text: validationError }]
        };
      }
      try {
        const request: AnalyzePrintabilityApiRequest = {};
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/print/analyze",
          request as unknown as Record<string, unknown>
        );

        const taskId = response.result;
        const sourceDesc = params.input_task_id
          ? `task "${params.input_task_id}"`
          : `model URL`;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Printability analysis started for ${sourceDesc}. Cost: FREE.`,
            estimated_time: "10-30 seconds"
          },
          params.response_format as ResponseFormat,
          "Printability Analysis Task Created",
          `Analyzing ${sourceDesc} for FDM printability. The result will report watertightness, volume, non-manifold edges, degenerate faces, and holes.`,
          "print-analyze"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error) }]
        };
      }
    }
  );

  // ── Repair Printability ─────────────────────────────────────────
  server.registerTool(
    "meshy_repair_printability",
    {
      title: "Repair Model Topology for 3D Printing",
      description: `Repair a 3D model's topology issues for FDM printing — fixes non-manifold edges, degenerate faces, holes, and ensures watertightness. Cost: 10 credits.

Output format mirrors the input format:
  - input_task_id → output is GLB
  - model_url with .stl → output is STL
  - model_url with .obj → output is OBJ
  - model_url with .glb → output is GLB

Provide EXACTLY ONE of:
  - input_task_id: a SUCCEEDED Meshy task that produced a GLB asset.
  - model_url: a public URL of a 3D model (.glb / .stl / .obj, max 100 MB).

Args:
  - input_task_id (string, optional): Upstream Meshy task ID
  - model_url (string, optional): Public model URL
  - response_format (enum): "markdown" or "json" (default: "markdown")

Returns:
  { "task_id": "...", "status": "PENDING", ... }

Next Steps:
  Use meshy_get_task_status with task_id and task_type="print-repair" to wait for completion.
  Once SUCCEEDED, model_urls contains the repaired model in the same format as the input.
  Note: textures are NOT preserved — repair operates on geometry only.

Examples:
  - From a task: { input_task_id: "abc-123" }
  - From an STL: { model_url: "https://example.com/model.stl" }`,
      inputSchema: RepairPrintabilityInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof RepairPrintabilityInputSchema>) => {
      const validationError = validateExactlyOneSource(params);
      if (validationError) {
        return {
          isError: true,
          content: [{ type: "text", text: validationError }]
        };
      }
      try {
        const request: RepairPrintabilityApiRequest = {};
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/print/repair",
          request as unknown as Record<string, unknown>
        );

        const taskId = response.result;
        const sourceDesc = params.input_task_id
          ? `task "${params.input_task_id}"`
          : `model URL`;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Topology repair started for ${sourceDesc}. Cost: 10 credits.`,
            estimated_time: "30-60 seconds"
          },
          params.response_format as ResponseFormat,
          "Printability Repair Task Created",
          `Repairing ${sourceDesc}'s topology (non-manifold edges, holes, degenerate faces). Output preserves the input format; textures are not preserved.`,
          "print-repair"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error) }]
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
  - max_colors: depends on their printer's multi-color capability (e.g. Bambu AMS supports 4-16 colors).
  - max_depth: affects color boundary precision and file size. Higher = finer but larger.

Provide EXACTLY ONE of input_task_id / model_url.

Args:
  - input_task_id (string, optional): Task ID of a completed TEXTURED model. Mutually exclusive with model_url.
  - model_url (string, optional): Public URL of a textured .glb or .fbx model. Mutually exclusive with input_task_id.
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
  - Custom: { input_task_id: "abc-123", max_colors: 8, max_depth: 5 }
  - From URL: { model_url: "https://example.com/textured.glb", max_colors: 6 }`,
      inputSchema: ProcessMulticolorInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: z.infer<typeof ProcessMulticolorInputSchema>) => {
      const validationError = validateExactlyOneSource(params);
      if (validationError) {
        return {
          isError: true,
          content: [{ type: "text", text: validationError }]
        };
      }
      try {
        const request: MultiColorPrintApiRequest = {
          max_colors: params.max_colors,
          max_depth: params.max_depth
        };
        if (params.input_task_id) request.input_task_id = params.input_task_id;
        if (params.model_url) request.model_url = params.model_url;

        const response = await client.post<CreateTaskApiResponse>(
          "/openapi/v1/print/multi-color",
          request as unknown as Record<string, unknown>
        );

        const taskId = response.result;
        const sourceDesc = params.input_task_id
          ? `task "${params.input_task_id}"`
          : `model URL`;

        return formatTaskCreatedResponse(
          {
            task_id: taskId,
            status: "PENDING",
            message: `Multi-color processing started for ${sourceDesc} with ${params.max_colors} colors (depth: ${params.max_depth}). Cost: 10 credits.`,
            estimated_time: "2-5 minutes"
          },
          params.response_format as ResponseFormat,
          "Multi-Color Processing Task Created",
          `Processing ${sourceDesc} into ${params.max_colors} colors (depth: ${params.max_depth}). The output will be a 3MF file for multi-color 3D printing.`,
          "multi-color-print"
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleMeshyError(error) }]
        };
      }
    }
  );
}
