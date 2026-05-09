# Changelog

## [0.3.0] - 2026-05-08

### Added

- **`meshy_repair_printability`** — new tool calling `POST /openapi/v1/print/repair`
  - Repairs non-manifold edges, degenerate faces, holes, and ensures watertightness
  - Cost: 10 credits per call
  - Provide exactly one of `input_task_id` or `model_url` (.glb / .stl / .obj, max 100 MB)
  - Output format mirrors input format: `input_task_id` → GLB; `model_url` with .stl → STL; etc.
  - Note: textures are NOT preserved (geometry-only repair)
  - Task type `"print-repair"` for polling via `meshy_get_task_status`
  - Response stream available via SSE
- `PRINT_REPAIR` task type with endpoint mapping
- `RepairPrintabilityInputSchema` (input_task_id / model_url, mutually exclusive)
- `AnalyzePrintabilityApiRequest`, `RepairPrintabilityApiRequest`, `PrintabilityResult` interfaces in `types.ts`
- Helper `validateExactlyOneSource()` in `schemas/printing.ts` for runtime input_task_id/model_url checks
- `PRINT_REPAIR_CREDITS` and `PRINT_ANALYZE_CREDITS` constants

### Changed

- **`meshy_analyze_printability`**: replaced placeholder with real Meshy printability API integration
  - Calls `POST /openapi/v1/print/analyze`
  - **FREE** (0 credits) per call
  - Provide exactly one of `input_task_id` or `model_url` (input_task_id requires Meshy 6 or any Preview model)
  - Returns task_id for polling via `meshy_get_task_status` (task_type: `"print-analyze"`)
  - Once SUCCEEDED, the task object's `printability` field reports `status` (healthy/warning/error/unknown), `issue_count`, and `metrics` (is_watertight, volume, non_manifold_edges, degenerate_faces, holes)
  - Removed legacy `task_id` + `task_type` parameters; replaced with `input_task_id` / `model_url` mutually-exclusive pair
- **`meshy_process_multicolor`**: now accepts `model_url` in addition to `input_task_id`
  - Both are mutually exclusive (provide exactly one)
  - Public docs confirm `.glb` and `.fbx` supported via `model_url`
- **`PRINT_ANALYZE`** added to `TaskType` enum and routed through `endpoints.ts`
- **`LIST_CAPABLE_TASK_TYPES`** now includes `MULTI_COLOR_PRINT`, `PRINT_ANALYZE`, `PRINT_REPAIR` — all three new printability endpoints support list/delete/stream
- **Server tool count**: 19 → 20

### Updated

- `error-handler.ts`: 402/InsufficientCredits message now mentions running free `analyze` before paying for `repair` / `multicolor`; new tip for `analyze` 404s about the Meshy 6 / Preview model requirement
- `Task.printability?` field added so polling tools can surface analyze results without casts
- `meshy_get_task_status`: when polling a `print-analyze` task, the SUCCEEDED summary now renders the full `printability` block (status icon, error/warning counts, geometry metrics table, repair recommendation) and `structuredContent.printability` carries the raw block. Previously the analysis result was discarded by the formatter even though the API returned it
- HTTP transport (`TRANSPORT=http`): `express.json` body limit raised from the 100 KB default to 100 MB so callers can pass `data:` URIs to `model_url` for `print/analyze` / `print/repair` / `print/multi-color` (the Meshy API itself permits up to 100 MB). The `print/repair` via `data:` URI backend bug surfaced during 0.3.0 e2e testing (BAC-1180) was fixed upstream on 2026-05-09 and re-verified end-to-end; the temporary remesh-staging workaround that briefly shipped in the error handler has been removed
- `/health` endpoint reports the real package version
- Bumped version to 0.3.0

## [0.2.0] - 2026-04-02

### Changed

- **meshy_process_multicolor**: Replaced placeholder with real Meshy multi-color API integration
  - Calls POST `/openapi/v1/print/multi-color` with `input_task_id`, `max_colors`, `max_depth`
  - Returns task_id for polling via `meshy_get_task_status` (task_type: "multi-color-print")
  - Outputs 3MF download URL on completion
  - Cost: 10 credits per call
  - Renamed `num_colors` parameter to `max_colors` (API alignment)
  - Added `max_depth` parameter (3-6, controls segmentation granularity)
  - Removed `task_type` parameter (implicit for this endpoint)

- **meshy_send_to_slicer**: Added cross-platform slicer detection
  - Auto-detects installed slicers on macOS, Windows, and Linux
  - Supports 7 slicers: OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next, PrusaSlicer, UltiMaker Cura
  - New `slicer_type: "auto"` default detects and recommends the best available slicer
  - New `is_multicolor` flag filters for multicolor-capable slicers only
  - Returns `launch_command` for the agent to execute (MCP does not launch directly)
  - Falls back to download URL + install suggestions when no slicer is detected
  - Preserves backward compat with Bambu Studio URL scheme

- **meshy_download_model**: Updated format description to recommend asking user for format before downloading

### Added

- Cross-platform slicer detection utility (`src/utils/slicer-detector.ts`)
- `MULTI_COLOR_PRINT` task type with endpoint mapping
- `3mf` format in Task.model_urls type
- Multicolor-specific error guidance in error handler
- `SlicerType` enum with 7 slicer types + auto
- `MULTICOLOR_CAPABLE_SLICERS` constant

### Updated

- SKILL.md: Documented multicolor workflow, updated slicer list, added format selection guidance
- Bumped version to 0.2.0

## [1.0.0] - 2026-03-16

### Added

- Initial public release
- 19 MCP tools covering the full Meshy AI API:
  - **3D Generation**: text-to-3d, text-to-3d-refine, image-to-3d, multi-image-to-3d
  - **Post-Processing**: remesh, retexture, rig, animate
  - **Image Generation**: text-to-image, image-to-image
  - **Task Management**: get-task-status (with built-in wait/polling), list-tasks, cancel-task, download-model
  - **Workspace**: list-models
  - **3D Printing**: send-to-slicer, analyze-printability, process-multicolor
  - **Account**: check-balance
- Smart file organization with auto-save to `meshy_output/` directory
- Built-in exponential backoff polling via `wait=true` parameter
- Local file support for image-to-3d (auto base64 encoding)
- Chained task support with parent_task_id for project folder grouping
- Dual transport: stdio (default) and HTTP
- Agent workflow skill included in `skill/` directory
- Smithery MCP Registry support
