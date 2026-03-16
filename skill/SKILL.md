---
name: meshy-3d-generation
description: Generate 3D models, textures, images, rig characters, and animate them using Meshy MCP tools. Use when the user asks to create or generate 3D models, convert images or text to 3D, texture or retexture models, rig characters, animate models, or mentions Meshy.
---

# Meshy 3D Generation (MCP Workflow)

Orchestrate Meshy MCP tools to generate 3D assets via conversation. The MCP server handles all API calls, authentication, and polling. This skill provides workflow guidance, cost awareness, and constraint knowledge.

For full API parameter reference, read [reference.md](reference.md).

## IMPORTANT: First-Use Session Notice

When this skill is first activated in a session, inform the user:

> All generated files will be automatically saved to `meshy_output/` in the current working directory. Each generation project gets its own folder with smart naming (`{timestamp}_{prompt}_{id}/`), including model files, textures, and thumbnails. Task history is tracked in `meshy_output/history.json`.

This only needs to be said **once per session**, at the beginning.

## File Organization

All downloads are auto-managed by the MCP server — **do NOT manually construct file paths or use `save_to`** unless the user explicitly requests a custom location.

- `meshy_download_model` without `save_to` → auto-saves to `meshy_output/{YYYYMMDD_HHmmss}_{prompt}_{task_id}/`
- Chained tasks (refine, rig, animate) use `parent_task_id` to group into the same project folder
- Thumbnails and textures are auto-downloaded alongside the model
- Task metadata is recorded in each project's `metadata.json`

### Chaining Example

```
# Step 1: Download preview
meshy_download_model({ task_id: "abc-123", task_type: "text-to-3d" })
# → saved to meshy_output/20260316_143052_a-cute-dragon_abc12345/preview.glb

# Step 2: Download refined (link to same project folder)
meshy_download_model({ task_id: "def-456", task_type: "text-to-3d", parent_task_id: "abc-123" })
# → saved to meshy_output/20260316_143052_a-cute-dragon_abc12345/refined.glb

# Step 3: Download rigged (link to same project folder)
meshy_download_model({ task_id: "ghi-789", task_type: "rigging", parent_task_id: "abc-123" })
# → saved to meshy_output/20260316_143052_a-cute-dragon_abc12345/rigged.glb
```

## Step 1: Determine User Intent

| User wants to... | MCP Tool | Credits |
|---|---|---|
| 3D model from text | `meshy_text_to_3d` | 20 |
| Texture a preview model | `meshy_text_to_3d_refine` | 10 |
| 3D model from one image | `meshy_image_to_3d` | 20–30 |
| 3D model from multiple images | `meshy_multi_image_to_3d` | 20–30 |
| New textures on existing model | `meshy_retexture` | 10 |
| Change mesh topology/format | `meshy_remesh` | 5 |
| Add skeleton for animation | `meshy_rig` | 5 (includes walking + running) |
| Animate a rigged character (custom) | `meshy_animate` | 3 |
| 2D image from text | `meshy_text_to_image` | 3–9 |
| Transform a 2D image | `meshy_image_to_image` | 3–9 |
| Wait for task / check status | `meshy_get_task_status` | 0 |
| Check credit balance | `meshy_check_balance` | 0 |
| List past tasks | `meshy_list_tasks` | 0 |
| Cancel a running task | `meshy_cancel_task` | 0 |
| Get download URLs | `meshy_download_model` | 0 |
| Browse workspace models | `meshy_list_models` | 0 |
| Send model to slicer | `meshy_send_to_slicer` | 0 |
| Check print readiness | `meshy_analyze_printability` | 0 |
| Multi-color processing | `meshy_process_multicolor` | 0 |

## Step 2: Confirm Cost Before Execution

**CRITICAL**: Present the full cost summary and wait for user confirmation before calling any generation tool.

For single-step tasks:
```
I'll generate a 3D model of "<prompt>". Cost: 20 credits (preview). Shall I proceed?
```

For multi-step pipelines, show the full breakdown:

| Step | Tool | Credits |
|---|---|---|
| Preview | `meshy_text_to_3d` | 20 |
| Refine | `meshy_text_to_3d_refine` | 10 |
| Rig | `meshy_rig` | 5 (includes walking + running) |
| **Total** | | **35** |

> **Note:** Rigging includes basic walking + running animations for free. Only add `meshy_animate` (3 credits) for custom animations beyond walking/running.

## Step 3: Execute Workflows

### Polling Strategy — IMPORTANT

**Preferred**: Use `meshy_get_task_status` with wait=true (default) — call it ONCE and it auto-polls with exponential backoff until the task completes. Returns full task data with progress bar on success.

**Alternative** (manual polling with `meshy_get_task_status` wait=false):
- **Interval**: wait **30–45 seconds** between each poll call. Never poll faster than 20 seconds.
- **Max calls**: at most **4–5 polls** per task. Tasks typically take 1–3 minutes.
- **99% is normal**: Tasks often sit at 99% for 30–120 seconds during finalization. Do NOT cancel or retry.
- **Tell the user first**: Before starting to poll, send a message like "Generating your model — this usually takes 1–3 minutes..." so they know to wait.

### Text to 3D (most common — two stages)

1. Call `meshy_text_to_3d` with user's prompt → returns `task_id`
2. Call `meshy_get_task_status` with the task_id → auto-waits until SUCCEEDED (wait=true by default)
3. Call `meshy_download_model` to get download URLs (use `save_to` param for reliable local download)
4. Ask user: "Want to refine (add textures)?"
5. If yes → call `meshy_text_to_3d_refine` with `preview_task_id`
6. Poll → download refined model

Key parameters to discuss with user:
- `prompt`: max 600 chars
- `model_type`: `"standard"` (default) or `"lowpoly"`
- `topology`: `"triangle"` (default) or `"quad"`
- `target_polycount`: 100–300,000 (default 30,000)
- `ai_model`: `"latest"` (default, best quality) or `"meshy-5"`

> **Refine compatibility**: Only previews generated with `meshy-5` or `latest` can be refined. `meshy-6` previews do NOT support `meshy_text_to_3d_refine` (API returns 400). If the user wants to refine later, always use `meshy-5` or `latest` for the preview step.

### Image to 3D

1. Call `meshy_image_to_3d`:
   - **Local file**: use `file_path` parameter (e.g. `file_path: "/path/to/image.jpg"`). PREFERRED. Server handles encoding automatically. **Do NOT manually base64-encode images.**
   - **Public URL**: use `image_url` parameter
   - **NEVER use both** file_path and image_url
2. Call `meshy_get_task_status` → auto-waits until done (wait=true by default)
3. Call `meshy_download_model` (use `save_to` for reliable local download)
4. For multi-image (2-4 views): use `meshy_multi_image_to_3d` with `file_paths` or `image_urls`

### Rig + Animate Pipeline

**IMPORTANT: When the user explicitly asks to rig or animate, the generation step (text-to-3d / image-to-3d) MUST use `pose_mode: "t-pose"` for best rigging results.** If the model was already generated without t-pose, recommend regenerating with `pose_mode: "t-pose"` first.

1. **Check polycount** — model must be ≤ 300,000 faces. If higher, call `meshy_remesh` first with `target_polycount: 100000`
2. Call `meshy_rig` — only works with **humanoid bipedal characters** with clearly defined limbs. The tool **auto-checks face count** and blocks with a remesh suggestion if exceeded.
3. Call `meshy_get_task_status` with task_type "rigging" → auto-waits
4. **Rigging automatically includes basic walking + running animations** (in `result.basic_animations`). Download these for free with `meshy_download_model` (task_type "rigging") — no separate `meshy_animate` call needed.
5. Only call `meshy_animate` if the user needs a **specific animation** beyond walking/running (e.g., custom action_id from Animation Library). This saves 3 credits.

**IMPORTANT**: When planning costs, if the user only needs walking/running animation, do NOT include the `meshy_animate` step (3 credits) in the cost breakdown — rigging already covers it.

### Retexture

Call `meshy_retexture` with:
- Model source: `input_task_id` or `model_url`
- Style source: `text_style_prompt` or `image_style_url`
- Recommend `enable_pbr: true` for metallic/roughness/normal maps

### Download Models

Use `meshy_download_model` — files are auto-saved to `meshy_output/` with smart organization:
- **Do NOT pass `save_to`** unless the user requests a specific path — auto-save handles everything
- For chained tasks (refine/rig/animate), pass `parent_task_id` to group files in the same project folder
- Textures are saved alongside the model when `include_textures: true`
- Thumbnails are auto-downloaded
- Falls back to returning URLs if download fails

Examples:
- Auto-save: `{ task_id: "abc-123", task_type: "text-to-3d" }`
- Chained: `{ task_id: "def-456", task_type: "text-to-3d", parent_task_id: "abc-123" }`
- Custom path (only if user asks): `{ task_id: "abc-123", save_to: "/Users/me/models/chair.glb" }`

### Remesh / Format Conversion

Call `meshy_remesh` to change topology, polycount, or export format. Set `convert_format_only: true` to skip remeshing and only convert.

## Step 4: Report Results

After each tool succeeds, report:
1. Downloaded file paths (auto-saved to project folder) and sizes
2. Project folder path (so user knows where everything is)
3. Task IDs (needed for follow-up operations)
4. Available formats (glb, fbx, obj, usdz)
5. Suggest logical next steps (refine → rig → animate)

## 3D Printing Workflow

### Intent Detection
Proactively ask the user about 3D printing when these keywords appear:
- Direct: print, 3d print, slicer, slice, bambu, orca, prusa, cura
- Implied: figurine, miniature, statue, physical model, desk toy, phone stand

### Text-to-3D Print Pipeline

| Step | Tool | Credits | Notes |
|------|------|---------|-------|
| 1. Preview | `meshy_text_to_3d` | 20 | Generates untextured mesh (white model) |
| 2. Printability Check | `meshy_analyze_printability` | 0 | Check mesh quality (placeholder) |
| 3. Download 3MF | `meshy_download_model` format="3mf" | 0 | Download model for printing |
| 4. Send to Slicer | `meshy_send_to_slicer` | 0 | Opens slicer via URL scheme |
| 5. (Optional) Multi-color | Ask user if multi-color needed | - | See below |

If multi-color printing is needed:
- Call `meshy_text_to_3d_refine` (10 credits) to add textures
- Then `meshy_process_multicolor` to process colors

### Image-to-3D Print Pipeline

| Step | Tool | Credits | Notes |
|------|------|---------|-------|
| 1. Generate | `meshy_image_to_3d` with `should_texture: false` | 20 | Untextured mesh (white model) |
| 2. Printability Check | `meshy_analyze_printability` | 0 | Check mesh quality (placeholder) |
| 3. Download 3MF | `meshy_download_model` format="3mf" | 0 | Download model for printing |
| 4. Send to Slicer | `meshy_send_to_slicer` | 0 | Opens slicer via URL scheme |
| 5. (Optional) Multi-color | Ask user if multi-color needed | - | See below |

If multi-color printing is needed:
- Call `meshy_retexture` (10 credits) or re-run `meshy_image_to_3d` with `should_texture: true` (+10 credits)
- Then `meshy_process_multicolor` to process colors

### Key Rules for Print Workflow
- Default download format is 3MF — use `meshy_download_model` with `format="3mf"`
- **Agent skill currently only supports sending to Bambu Studio.** For more slicer options (OrcaSlicer, Cura, Creality Print, etc.), use the webapp at https://www.meshy.ai
- After sending to slicer, remind user to check print settings in their slicer software
- **NOTE**: If `meshy_download_model` returns "3MF Format Not Yet Supported":
  1. **Ask the user** if they'd like to download OBJ format instead — **do NOT auto-download**
  2. **Do NOT call `meshy_send_to_slicer`** — the OBJ file must be manually imported
  3. Only after user confirms, call `meshy_download_model` with `format="obj"`
  4. Guide the user to manually import the OBJ file into Bambu Studio: File -> Import -> select .obj file

## Critical Constraints

- **99% progress is normal**: Tasks sit at 99% for 30–120s during finalization. Do NOT cancel or retry.
- **Polycount for rigging**: Must be ≤ 300,000. Remesh first if needed.
- **Rigging model type**: Only humanoid bipedal characters with clear limbs.
- **Rigging includes basic animations**: Walking + running GLBs come free with rigging. Skip `meshy_animate` unless a custom animation is needed.
- **PBR maps**: Must set `enable_pbr: true` explicitly to get metallic/roughness/normal textures.
- **Asset retention**: Files deleted after **3 days** (non-Enterprise). Download immediately.
- **Format check**: Not all formats are always available. Check before downloading.
- **API key requirement**: Requires a **Pro plan or above**. Get key at https://www.meshy.ai/settings/api

## Additional Resources

For the complete API endpoint reference including all parameters, response schemas, and error codes, read [reference.md](reference.md).
