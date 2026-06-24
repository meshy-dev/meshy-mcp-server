/**
 * Server-level instructions sent to clients on connection.
 * Provides top-level workflow routing so the agent picks the right tool chain.
 * Specific parameter details and constraints live in each tool's description.
 */

export const MESHY_INSTRUCTIONS = `
# Meshy AI — Workflow Guide

## Rule 1: Cost Confirmation
Before calling ANY tool that costs credits, present the cost and wait for user confirmation.

| Tool | Credits |
|------|---------|
| meshy_text_to_3d | 5–20 |
| meshy_text_to_3d_refine | 10 |
| meshy_image_to_3d / meshy_multi_image_to_3d | 5–30 |
| meshy_retexture | 10 |
| meshy_remesh | 5 |
| meshy_rig | 5 (includes walking + running) |
| meshy_animate | 3 |
| meshy_process_multicolor | 10 |
| meshy_convert | 1 |
| meshy_resize | 1 |
| meshy_uv_unwrap | 5 |
| meshy_creative_lab | 36 (prototype 6 + build 30, run end-to-end) |
| meshy_text_to_image / meshy_image_to_image | nano-banana 3 / nano-banana-2 6 / nano-banana-pro 9 / gpt-image-2: text 9, image 12 |

## Rule 2: Determine Output Format BEFORE Generating
The API parameter target_formats controls which formats are produced. Decide the output format before calling any generation tool, because target_formats must be set at creation time. Ask user about their intended use first.

## Rule 3: Identify the Use Case, Then Confirm with User
Determine which scenario below best matches, present a suggested plan to the user, and confirm before executing. Do not mix steps across scenarios.

---

Each scenario below is a recommended workflow. Discuss with the user to confirm the plan before executing.

## Scenario A: 3D Printing (white model)
Trigger: user mentions print, slicer, figurine, miniature, statue, physical model — single-color.
Suggested flow:
1. Detect installed slicers (meshy_send_to_slicer, slicer_type:"auto") — present list, save for later
2. Generate untextured model (text-to-3d or image-to-3d) with target_formats:["obj"]
3. Wait for completion
4. Download OBJ with print_ready=true (auto coordinate fix for slicer)
5. Present slicer list from step 1, ask user which to use, execute launch_command via Bash

## Scenario B: 3D Printing (multicolor)
Trigger: user wants multicolor/color print.
Suggested flow:
1. Detect multicolor-capable slicers (meshy_send_to_slicer, is_multicolor:true) — present list, save for later
2. Generate a textured model — via text-to-3d (preview + refine) or image-to-3d with textures
3. Multi-color processing (meshy_process_multicolor) with input_task_id from the textured task — 10 credits, outputs 3MF
4. Wait for completion (task_type:"multi-color-print")
5. Download 3MF
6. Present slicer list from step 1, ask user which to use, execute launch_command via Bash

## Scenario C: Game Engine (Unity/Unreal/Godot)
Trigger: user mentions game, Unity, Unreal, Godot, game-ready.
Suggested flow:
1. Generate model with target_formats:["fbx"]
2. Add textures (refine or retexture)
3. Remesh for game-ready topology (meshy_remesh, topology:"quad", appropriate polycount)
4. Download FBX

## Scenario D: Character Animation
Trigger: user mentions rig, animate, walking, running, character animation.
Suggested flow:
1. Generate model with pose_mode:"t-pose"
2. Add textures (refine or retexture)
3. Rig the model (meshy_rig, ≤300K faces; if over, remesh to reduce polycount first)
4. Download — rigging includes walking+running free. Only use meshy_animate for custom animations.

## Scenario E: AR / Apple
Trigger: user mentions AR, USDZ, Vision Pro, Quick Look.
Suggested flow:
1. Generate model with target_formats:["usdz"]
2. Add textures (refine or retexture)
3. Remesh for USDZ format conversion (meshy_remesh, target_formats:["usdz"])
4. Download USDZ

## Scenario F: Retexture
Trigger: user wants to change textures/style of existing model.
Suggested flow:
1. Ask user for text_style_prompt OR image_style_url (one required, image takes precedence)
2. Apply retexture (meshy_retexture)

## Scenario H: Cheap Format Conversion / Resize
Trigger: user has an existing model (task or URL) and only needs another file format, or wants it scaled to real-world dimensions — no re-generation.
Suggested flow:
1. Format only → meshy_convert with target_formats (1 credit). Cheaper than remesh for format-only changes; supports 3mf.
2. Real-world size → meshy_resize (1 credit) with exactly one of resize_height / resize_longest_side / auto_size.
3. Wait for completion (task_type "convert" / "resize"), then meshy_download_model.

## Scenario I: UV Unwrap (before external texturing)
Trigger: user wants to texture a model in Blender / Substance Painter / Unreal, or needs a clean UV layout / "UV white model".
Suggested flow:
1. Ensure the source is a GLB with ≤40,000 faces — if denser, run meshy_remesh with a lower target_polycount first.
2. meshy_uv_unwrap (5 credits) with input_task_id or model_url.
3. Wait for completion (task_type "uv-unwrap"), then meshy_download_model (format "glb"). The output is a single GLB with fresh UVs and a placeholder material.

## Scenario J: Creative Lab Consumer Products (figure / keychain / fridge-magnet / lamp)
Trigger: user wants a stylized physical-product model — chibi figure, keychain, fridge magnet, or lamp — from a photo (or, for lamp, a text prompt).
Suggested flow:
1. Confirm the 36-credit cost with the user.
2. Call meshy_creative_lab once with product + a source (file_path / image_url, or text for lamp). It runs the full prototype→build pipeline internally and returns the final 3D model — the intermediate concept image is internal and is NOT shown to the user.
3. Download the result with meshy_download_model (task_type "creative-lab-{product}-build"); for lamp this saves all parts (lamp + base STLs).

## Scenario G: General 3D Model (default)
Trigger: none of the above.
Suggested flow:
1. Ask user about intended use to determine format
2. Generate model
3. Ask: add textures (refine)?
4. Download in chosen format
`;
