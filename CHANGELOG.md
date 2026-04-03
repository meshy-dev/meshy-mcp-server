# Changelog

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
