# Meshy MCP Server

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Meshy AI](https://www.meshy.ai) 3D generation platform. Enables AI agents to create, manage, and download 3D models, textures, images, rigged characters, and animations through natural conversation.

## Features

28 tools covering the full Meshy API:

| Category | Tools |
|----------|-------|
| **3D Generation** | `meshy_text_to_3d`, `meshy_text_to_3d_refine`, `meshy_image_to_3d`, `meshy_multi_image_to_3d` |
| **Creative Lab** | `meshy_creative_lab` (9 products) |
| **Post-Processing** | `meshy_remesh`, `meshy_retexture` |
| **Rigging & Animation** | `meshy_rig`, `meshy_animate`, `meshy_text_to_motion`, `meshy_list_animations` |
| **Conversion** | `meshy_convert`, `meshy_resize`, `meshy_uv_unwrap` |
| **Image Generation** | `meshy_text_to_image`, `meshy_image_to_image` |
| **Task Management** | `meshy_get_task_status`, `meshy_list_tasks`, `meshy_cancel_task`, `meshy_download_model` |
| **Workspace** | `meshy_list_models` |
| **3D Printing** | `meshy_send_to_slicer`, `meshy_analyze_printability`, `meshy_repair_printability`, `meshy_process_multicolor`, `meshy_auto_split` |
| **Account** | `meshy_check_balance`, `meshy_list_usage` |

### Key Capabilities

- **Safe retries (v0.6.3)**: a create request is never resent after a timeout or server error, so a task is never created and billed twice; status checks retry at the API's suggested interval
- **Text to 3D**: Generate 3D models from text descriptions (preview + refine pipeline)
- **Image to 3D**: Convert single or multiple images into 3D models
- **Meshy 7.1 (v0.6.0)**: `ai_model: "meshy-7.1"` (and `latest`) on text-to-3d, image-to-3d and multi-image-to-3d. `geometry_resolution: "standard" | "2k" | "4k"` picks the geometry pass (+5 credits for 2k/4k; multi-image supports standard/2k). `ultra_mode` is deprecated
- **Meshy 6 Lite (v0.6.0)**: `ai_model: "meshy-6-lite"` — fast, 5-credit mesh (15 textured, 2K textures only) on every generation endpoint
- **Smart Topology**: `model_type: "smart-topology"` with `ai_model: "meshy-t2"` on text-to-3d (new in v0.6.0) and image-to-3d. Clean, part-separated triangle mesh generated directly at 100–15,000 faces (default 4,000) for 5 credits of mesh. `meshy-t2.5` (v0.6.4) is the newest Smart Topology model, with sharper detail for game assets: 100–30,000 faces (default 15,000), same cost
- **Multi-view texture on multi-image (v0.6.0)**: `texture_image_urls` — 1–4 views of the same object drive the texture (Meshy 7.1)
- **8K Textures (v0.5.0)**: `texture_resolution: "2k" | "4k" | "8k"` on image-to-3d, multi-image-to-3d, text-to-3d refine and retexture (8K costs 15 credits vs 10). Replaces the now-deprecated `hd_texture` flag
- **Multi-view Retexture (v0.5.0)**: `multiview_image_urls` — 1–4 ordered views of the *same object* drive the texture instead of a single style reference (requires Meshy 7)
- **Auto-Rigging & Animation**: Add skeletons and animations to humanoid characters. `meshy_animate` takes one preset action, up to 10 actions as clips in one file, or a generated motion (v0.6.3); `meshy_list_animations` finds action ids
- **Text to Motion (v0.6.3)**: generate a motion clip from a description (`prime` FBX, 10 credits / `swift` BVH, 3 credits) and apply it to a rigged character
- **Creative Lab**: One tool — a photo → a finished, print-ready product. **9 products**: figure, lamp, keychain (with engraved `name_text`), fridge-magnet, vinyl-figure, brick-figure, keycap, and (v0.6.3) fidget-pixel and fidget-collapsible. Runs the whole pipeline and returns only the final 3D model; build options and output format are configurable
- **Format & Size Utilities**: `convert` (format conversion incl. 3MF, 1 credit), `resize` (real-world dimensions, 1 credit), `uv_unwrap` (clean UV layout for external texturing, 5 credits)
- **2D Image Models**: `text_to_image` / `image_to_image` support `nano-banana`, `nano-banana-2`, `nano-banana-2-lite`, `nano-banana-2-1`, `nano-banana-pro`, `gpt-image-2`, `gpt-image-2-5-flare` and `gpt-image-2-5-sunburst`, with transparent-background output (`remove_background`). Image-to-image can edit an earlier result by `input_task_id`
- **3D Printability Suite**:
  - `analyze_printability` — free check (watertight, volume, holes, non-manifold edges, degenerate faces), plus a wall-thickness check for a given printer type and print size (v0.6.3)
  - `repair_printability` — 10-credit topology repair (.glb / .gltf / .obj / .fbx / .stl) that can also thicken thin walls
  - `process_multicolor` — 10-credit multi-color 3MF for AMS/MMU printers, `realistic` or `cartoon` style, with a slicer preset for 9 printer brands
  - `auto_split` (v0.6.3) — 10 credits: cut a model into printable parts automatically, by named parts, or by color, with optional connectors
- **Usage reporting (v0.6.3)**: `list_usage` lists finished API tasks with their credits (Studio / Enterprise teams)
- **Task and model listing (v0.6.3)**: `list_tasks` lists tasks of any status from text-to-3d, image-to-3d, multi-image-to-3d, text-to-image and image-to-image by default (pass `task_types` for printing, rigging, animation, motion, post-processing or Creative Lab tasks); `list_models` lists finished 3D models of any model-producing type (image-to-3d by default), each with the `task_type` and formats to download. Before 0.6.3, `list_tasks` queried every type and `list_models` listed text-to-3d only; see the CHANGELOG's behavior changes
- **Slicer Integration**: Auto-detect 7 installed slicers (OrcaSlicer, Bambu, Creality, Elegoo, Anycubic, PrusaSlicer, Cura; all but Cura open multi-color 3MF) and return launch commands the agent can execute
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Workflow Intelligence**: Server instructions guide the agent through correct tool chains for each use case

### Models & Credits

`ai_model` is not the same set on every endpoint, and `latest` does not resolve to the same model everywhere ([text](https://docs.meshy.ai/en/api/text-to-3d), [image](https://docs.meshy.ai/en/api/image-to-3d), [multi-image](https://docs.meshy.ai/en/api/multi-image-to-3d), [retexture](https://docs.meshy.ai/en/api/retexture)):

| Endpoint | Accepted `ai_model` | `latest` resolves to |
|---|---|---|
| `meshy_text_to_3d` / `_refine` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` — plus `meshy-t2` / `meshy-t2.5` with `model_type: "smart-topology"` (preview only) | Meshy 7.1 |
| `meshy_image_to_3d` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` — plus `meshy-t2` / `meshy-t2.5` with `model_type: "smart-topology"` | Meshy 7.1 |
| `meshy_multi_image_to_3d` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` (no Smart Topology) | Meshy 7.1 |
| `meshy_retexture` | `meshy-7`, `meshy-6`, `meshy-6-lite`, `latest` (no `meshy-7.1`) | Meshy 7 |

Legacy id still accepted: `meshy-7` on generation (deprecated, billed like `meshy-7.1`). `meshy-5` and Meshy T1 (`meshy-t1`, `model_type: "lowpoly"`) are retired and no longer accepted; use `meshy-6-lite` and `smart-topology` + `meshy-t2.5`.

Generation cost ([pricing](https://docs.meshy.ai/en/api/pricing)):

| `ai_model` | Mesh only | + 2K/4K texture | + 8K texture |
|---|---|---|---|
| `meshy-7.1` / `latest` | 20 | 30 | 35 |
| `meshy-6` | 20 | 30 | 35 |
| `meshy-6-lite` | 5 | 15 | — (2K only) |
| `meshy-t2` / `meshy-t2.5` (smart-topology, single-image) | 5 | 15 | 20 |

Text-to-3D preview is billed mesh-only; refine adds 10 (15 at 8K). `geometry_resolution: "2k"` or `"4k"` (Ultra pass, Meshy 7.1 / `latest`) adds **+5**; multi-image supports `"2k"` only. `ultra_mode` is deprecated and maps to `"2k"`.

Smart Topology generates directly at `target_polycount` and skips remeshing: `meshy-t2` 100–15,000 faces (default 4,000), `meshy-t2.5` 100–30,000 (default 15,000). Without `ai_model`, `model_type: "smart-topology"` uses `meshy-t2`. Output is triangle-only. For standard models, `target_polycount` needs `should_remesh: true` and is overridden by `decimation_mode`.

Retexture is 10 credits (15 at 8K). Creative Lab is **36** credits per product (6 + 30; lamp is 30 + 6) except **keycap, 62** (12 + 50) and **fidget-collapsible, 6** (single stage). Images: nano-banana 3, nano-banana-2 6, nano-banana-2-lite 3, nano-banana-2-1 4, nano-banana-pro 9, GPT Image models 9 (text) / 12 (image). Other tools: remesh 5, rig 5, animate 3 per action, text-to-motion 10 (prime) / 3 (swift), convert 1, resize 1, uv-unwrap 5, analyze-printability free, repair-printability 10, multicolor 10, auto-split 10.

## Prerequisites

- Node.js >= 18
- A Meshy API key ([get one here](https://www.meshy.ai/developers/keys) — requires Pro plan or above)

## Installation

Pick whichever fits your workflow — they all produce the same config.

### Option 1 · One-Command Install · Recommended

[`add-mcp`](https://github.com/neondatabase/add-mcp) auto-detects every AI client on your machine (Cursor, Claude Code, Claude Desktop, Windsurf, Codex, VS Code, Cline, …) and writes the right config to each:

```bash
npx add-mcp @meshy-ai/meshy-mcp-server --env MESHY_API_KEY=msy_YOUR_API_KEY
```

After it finishes, jump to [Activate](#activate-after-install) for your client.

### Option 2 · Install by Asking Your AI Agent

Already chatting with Cursor / Claude Code / Codex? Paste this prompt:

```
Install the Meshy MCP server for me. Docs: https://github.com/meshy-dev/meshy-mcp-server
Use this env var: MESHY_API_KEY=msy_YOUR_API_KEY
```

The agent will run `add-mcp` (or write `mcp.json` directly) and tell you when it's ready. You'll still need the **Activate** step for your client.

### Option 3 · Manual Install

<details>
<summary><b>Cursor</b></summary>

Paste into `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "meshy": {
      "command": "npx",
      "args": ["-y", "@meshy-ai/meshy-mcp-server"],
      "env": { "MESHY_API_KEY": "msy_YOUR_API_KEY" }
    }
  }
}
```

> **Windows**: replace `"command": "npx"` with `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@meshy-ai/meshy-mcp-server"]`.

</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add-json meshy '{"command":"npx","args":["-y","@meshy-ai/meshy-mcp-server"],"env":{"MESHY_API_KEY":"msy_YOUR_API_KEY"}}'
```

</details>

<details>
<summary><b>CoWork OS</b></summary>

[CoWork OS](https://github.com/CoWork-OS/CoWork-OS) ships Meshy as a built-in connector, pinned to a reviewed version of this server. Open **Settings → Connectors → Meshy**, click **Install & Connect** and paste your API key — no `mcp.json` needed. Models show in the chat as interactive 3D cards, and every credit-spending call shows its estimated cost on the approval card first.

</details>

<details>
<summary><b>Other clients</b> (Windsurf, Claude Desktop, Codex, VS Code, Cline…)</summary>

Use **Option 1** — `add-mcp` writes the correct config for each.

</details>

## Activate After Install

Most clients auto-load the new server, but **Cursor and VS Code require a manual toggle**:

| Client | What to do | Verify |
|---|---|---|
| **Cursor** | Restart → `Settings` → `MCP & Integrations` → toggle `meshy` **on** → wait for green dot ● → open a **new chat** | `List the meshy tools available` |
| **Claude Code** | Nothing — auto-loads on next message | `/mcp` shows `meshy ✓ connected` |
| **Claude Desktop** | Quit & relaunch the app | `List the meshy tools available` |
| **Windsurf** | Refresh in the Cascade panel's MCP section | `List the meshy tools available` |
| **VS Code** | Run command `MCP: List Servers` → click `meshy` → **Start** | `List the meshy tools available` |
| **Codex** | Nothing — auto-loads on next session | `List the meshy tools available` |
| **CoWork OS** | Built in: `Settings` → `Connectors` → `Meshy` → **Install & Connect**, paste your key (no `mcp.json` needed) | `Make a low-poly treasure chest and show it in 3D` |

## Troubleshooting

- **`MESHY_API_KEY environment variable is required`** — returned by every tool when the key didn't reach the server. Make sure it sits inside an `"env": {...}` block in your `mcp.json`, not in `args`. Restart the server after fixing it.
- **`spawn npx ENOENT`** (Windows) — wrap with `cmd /c` (see Cursor block above).
- **`error: unknown option '-y'`** (Claude Code on Windows) — use `claude mcp add-json` instead of `claude mcp add … -- npx -y …`.
- **Cursor doesn't list `meshy`** — make sure `mcp.json` is valid JSON (no trailing commas), then fully restart Cursor.
- **`Authentication failed: the Meshy API rejected MESHY_API_KEY (401)`** — the key is mistyped, revoked or expired. Regenerate at https://www.meshy.ai/developers/keys, update your config and restart the server.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `MESHY_API_KEY` | **Required.** Your Meshy API key (starts with `msy_`) | — |
| `MESHY_API_HOST` | API base URL | `https://api.meshy.ai` |
| `TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `PORT` | Port for HTTP transport | `3000` |
| `CHARACTER_LIMIT` | Max response size in characters | `25000` |
| `MESHY_CLIENT` | Optional. Identifies the integrating app in Meshy's logs, format `name/version` (e.g. `hermes-meshy-plugin/0.4.0`) | — |

## Development

```bash
# Clone and install
git clone https://github.com/meshy-dev/meshy-mcp-server.git
cd meshy-mcp-server
npm ci

# Development with hot reload
npm run dev

# Build
npm run build

# Type check
npm run lint

# Build and run offline mocked-request tests (no API key or credits required)
npm test

# Run
npm start
```

### Maintaining a local checkout

See [setup, updates, and rollback](docs/maintenance.md) for running a reviewed local build, pinning package versions, testing model routing without paid API calls, and reconnecting a client safely.

## HTTP Transport

For remote access, run in HTTP mode:

```bash
TRANSPORT=http PORT=3000 npm start
```

Endpoints:
- `POST /mcp` — MCP protocol endpoint
- `GET /health` — Health check

## License

[MIT](LICENSE)
