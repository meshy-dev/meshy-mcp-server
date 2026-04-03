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
| meshy_text_to_image / meshy_image_to_image | 3–9 |

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

## Scenario G: General 3D Model (default)
Trigger: none of the above.
Suggested flow:
1. Ask user about intended use to determine format
2. Generate model
3. Ask: add textures (refine)?
4. Download in chosen format
`;
