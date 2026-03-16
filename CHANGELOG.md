# Changelog

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
