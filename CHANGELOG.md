# Changelog

## [0.4.0] - 2026-06-24

### Added

- **`meshy_convert`** — new tool calling `POST /openapi/v1/convert` (1 credit)
  - Dedicated, cheaper format conversion than remesh; `target_formats` required
  - Options: glb, fbx, obj, usdz, blend, stl, 3mf
  - Provide exactly one of `input_task_id` or `model_url`; task type `"convert"`
- **`meshy_resize`** — new tool calling `POST /openapi/v1/resize` (1 credit)
  - Resize to real-world dimensions; provide exactly one of `resize_height` / `resize_longest_side` / `auto_size`
  - Provide exactly one of `input_task_id` or `model_url`; task type `"resize"`
- **`meshy_uv_unwrap`** — new tool calling `POST /openapi/v1/uv-unwrap` (5 credits)
  - Generates a clean, non-overlapping UV layout ("UV white model") before external texturing
  - GLB only; meshes over 40,000 faces are rejected with 400 (remesh first); task type `"uv-unwrap"`
- **`meshy_creative_lab`** — ONE tool that runs the full Creative Lab pipeline end-to-end (36 credits)
  - Products: `figure`, `lamp`, `keychain`, `fridge-magnet`. Input: a source photo (image_url/file_path) or, for products that support it (e.g. lamp), `text` (+ optional `image_subject`)
  - Internally runs prototype (6cr) → build (30cr), hides the intermediate concept image, and returns ONLY the final 3D model. Blocks while both stages run (~2–5 min) with progress notifications; if the prototype fails the build is not started (only 6cr charged)
  - Returns the build `task_id` + model formats; download with `meshy_download_model` (task_type `"creative-lab-{product}-build"`). Backend GET routes are stage-specific (`.../v1/prototype/:id`, `.../v1/build/:id`)
- New task types `CONVERT`, `RESIZE`, `UV_UNWRAP`, and 8 stage-specific creative-lab task types (prototype/build per product: figure, lamp, keychain, fridge-magnet) with endpoint + list routing
- New `CreativeLabProduct` and `ConvertFormat` (includes `3mf`) enums; credit constants `CONVERT_CREDITS`, `RESIZE_CREDITS`, `UV_UNWRAP_CREDITS`, `CREATIVE_LAB_PROTOTYPE_CREDITS`, `CREATIVE_LAB_BUILD_CREDITS`, `UV_UNWRAP_MAX_FACES`
- New request interfaces in `types.ts`: `ConvertApiRequest`, `ResizeApiRequest`, `UvUnwrapApiRequest`, `CreativeLabPrototypeApiRequest`, `CreativeLabBuildApiRequest`
- New generation/post-processing params: `hd_texture` (4K base color), `decimation_mode` (1–4), `alpha_thumbnail` (RGBA preview → `alpha_thumbnail_url`), `multi_view_thumbnails`, `resize_longest_side` (remesh)
- `input_task_id` chaining on `meshy_image_to_3d` and `meshy_multi_image_to_3d` — feed a SUCCEEDED text-to-image / image-to-image task's output as the image source
- New image models on `meshy_text_to_image` / `meshy_image_to_image`: `nano-banana-2` (6 credits) and `gpt-image-2` (text 9 / image 12, limited aspect ratios)

### Changed

- **`meshy_get_task_status`**: now surfaces `consumed_credits` (and `alpha_thumbnail_url`) in the status output and `structuredContent`
- **`meshy_download_model`**: now downloads **image-task output** too — `text-to-image` / `image-to-image` results live in `image_urls` (not `model_urls`), so the tool previously returned "no model URLs" and agents had to fetch the API key and curl the image manually. It now detects image tasks and saves the generated PNG/JPG locally (extension inferred from the URL); `image_urls` is also surfaced in `meshy_get_task_status` output/`structuredContent`
- **`meshy_download_model`**: corrected the 3MF message — 3MF IS supported, but only when it was generated (request via `target_formats:["3mf"]`, or use `meshy_convert` / `meshy_process_multicolor`); added `blend` to the downloadable format list; available formats are now listed when 3MF is missing
- **`meshy_download_model`**: for a Creative Lab build whose `model_urls` use bespoke keys (e.g. lamp → `base_stl` + `lamp_stl`) that don't match the requested `format`, it now downloads ALL parts instead of reporting "format unavailable"
- **`task_type` is now fault-tolerant** on `meshy_get_task_status` / `meshy_cancel_task` / `meshy_download_model`: an imperfect value (e.g. `creative-lab-lamp` instead of `creative-lab-lamp-prototype`) no longer hard-rejects — it coerces and the server auto-infers the endpoint, so agents never need to fall back to manual HTTP
- `symmetry_mode` marked **DEPRECATED** across text/image/multi-image generation schemas (no longer affects output; kept for backward compatibility)
- `error-handler.ts`: tool-aware hints — 400 for `meshy_uv_unwrap` (GLB ≤40k faces, remesh first); 404 for `meshy_uv_unwrap` (resource not found / temporarily unavailable)
- `instructions.ts`: cost table and usage scenarios extended (convert/resize, UV unwrap, Creative Lab end-to-end flow; updated image-model costs)
- **Server tool count**: 20 → 24

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
