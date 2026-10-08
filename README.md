# Meshy MCP Server

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Meshy AI](https://www.meshy.ai) 3D generation platform. Enables AI agents to create, manage, and download 3D models, textures, images, rigged characters, and animations through natural conversation.

## Features

24 tools covering the full Meshy API:

| Category | Tools |
|----------|-------|
| **3D Generation** | `meshy_text_to_3d`, `meshy_text_to_3d_refine`, `meshy_image_to_3d`, `meshy_multi_image_to_3d` |
| **Creative Lab** | `meshy_creative_lab` (7 products) |
| **Post-Processing** | `meshy_remesh`, `meshy_retexture`, `meshy_rig`, `meshy_animate` |
| **Conversion** | `meshy_convert`, `meshy_resize`, `meshy_uv_unwrap` |
| **Image Generation** | `meshy_text_to_image`, `meshy_image_to_image` |
| **Task Management** | `meshy_get_task_status`, `meshy_list_tasks`, `meshy_cancel_task`, `meshy_download_model` |
| **Workspace** | `meshy_list_models` |
| **3D Printing** | `meshy_send_to_slicer`, `meshy_analyze_printability`, `meshy_repair_printability`, `meshy_process_multicolor` |
| **Account** | `meshy_check_balance` |

### Key Capabilities

- **Text to 3D**: Generate 3D models from text descriptions (preview + refine pipeline)
- **Image to 3D**: Convert single or multiple images into 3D models
- **Meshy 7.1 (v0.6.0)**: `ai_model: "meshy-7.1"` (and `latest`) on text-to-3d, image-to-3d and multi-image-to-3d. `geometry_resolution: "standard" | "2k" | "4k"` picks the geometry pass (+5 credits for 2k/4k; multi-image supports standard/2k). `ultra_mode` is deprecated
- **Meshy 6 Lite (v0.6.0)**: `ai_model: "meshy-6-lite"` — fast, 5-credit mesh (15 textured, 2K textures only) on every generation endpoint
- **Smart Topology**: `model_type: "smart-topology"` with `ai_model: "meshy-t2"` on text-to-3d (new in v0.6.0) and image-to-3d. Clean, part-separated triangle mesh generated directly at 100–15,000 faces (default 4,000) for 5 credits of mesh
- **Multi-view texture on multi-image (v0.6.0)**: `texture_image_urls` — 1–4 views of the same object drive the texture (Meshy 7.1)
- **8K Textures (v0.5.0)**: `texture_resolution: "2k" | "4k" | "8k"` on image-to-3d, multi-image-to-3d, text-to-3d refine and retexture (8K costs 15 credits vs 10). Replaces the now-deprecated `hd_texture` flag
- **Multi-view Retexture (v0.5.0)**: `multiview_image_urls` — 1–4 ordered views of the *same object* drive the texture instead of a single style reference (requires Meshy 7)
- **Auto-Rigging & Animation**: Add skeletons and animations to humanoid characters
- **Creative Lab**: One tool — a photo → a finished, print-ready product. **7 products (v0.5.0)**: figure, lamp, keychain, fridge-magnet, vinyl-figure, brick-figure and keycap. Runs prototype→build end-to-end and returns only the final 3D model
- **Format & Size Utilities**: `convert` (format conversion incl. 3MF, 1 credit), `resize` (real-world dimensions, 1 credit), `uv_unwrap` (clean UV layout for external texturing, 5 credits)
- **2D Image Models**: `text_to_image` / `image_to_image` support `nano-banana`, `nano-banana-2`, `nano-banana-pro`, `gpt-image-2`, `gpt-image-2-5-flare` and `gpt-image-2-5-sunburst`
- **3D Printability Suite**:
  - `analyze_printability` — free FDM check (watertight, volume, holes, non-manifold edges, degenerate faces)
  - `repair_printability` — 10-credit topology repair, now also accepting **.fbx / .gltf** input (v0.5.0)
  - `process_multicolor` — 10-credit multi-color 3MF for AMS/MMU printers
- **Slicer Integration**: Auto-detect 7 installed slicers (OrcaSlicer, Bambu, Creality, Elegoo, Anycubic, PrusaSlicer, Cura) and return launch commands the agent can execute
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Workflow Intelligence**: Server instructions guide the agent through correct tool chains for each use case

### Models & Credits

`ai_model` is not the same set on every endpoint, and `latest` does not resolve to the same model everywhere ([text](https://docs.meshy.ai/en/api/text-to-3d), [image](https://docs.meshy.ai/en/api/image-to-3d), [multi-image](https://docs.meshy.ai/en/api/multi-image-to-3d), [retexture](https://docs.meshy.ai/en/api/retexture)):

| Endpoint | Accepted `ai_model` | `latest` resolves to |
|---|---|---|
| `meshy_text_to_3d` / `_refine` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` — plus `meshy-t2` with `model_type: "smart-topology"` (preview only) | Meshy 7.1 |
| `meshy_image_to_3d` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` — plus `meshy-t2` with `model_type: "smart-topology"` | Meshy 7.1 |
| `meshy_multi_image_to_3d` | `meshy-7.1`, `meshy-6`, `meshy-6-lite`, `latest` (no Smart Topology) | Meshy 7.1 |
| `meshy_retexture` | `meshy-7`, `meshy-6`, `meshy-6-lite`, `latest` (no `meshy-7.1`) | Meshy 7 |

Legacy ids still accepted: `meshy-7` on generation (deprecated, billed like `meshy-7.1`) and single-image `meshy-t1`. `meshy-5` is deprecated (served as `meshy-6-lite`) and retires on 2026-10-10: use `meshy-6-lite`.

Generation cost ([pricing](https://docs.meshy.ai/en/api/pricing)):

| `ai_model` | Mesh only | + 2K/4K texture | + 8K texture |
|---|---|---|---|
| `meshy-7.1` / `latest` | 20 | 30 | 35 |
| `meshy-6` | 20 | 30 | 35 |
| `meshy-6-lite` | 5 | 15 | — (2K only) |
| `meshy-t2` (smart-topology, single-image) | 5 | 15 | 20 |

Text-to-3D preview is billed mesh-only; refine adds 10 (15 at 8K). `geometry_resolution: "2k"` or `"4k"` (Ultra pass, Meshy 7.1 / `latest`) adds **+5**; multi-image supports `"2k"` only. `ultra_mode` is deprecated and maps to `"2k"`. `model_type: "lowpoly"` retires on 2026-10-30: use `smart-topology` + `meshy-t2`.

Smart Topology (`meshy-t2`) generates directly at `target_polycount` (100–15,000 faces, default 4,000) and skips remeshing. For standard models, `target_polycount` needs `should_remesh: true` and is overridden by `decimation_mode`.

Retexture is 10 credits (15 at 8K). Creative Lab is **36** credits for every product (6 + 30; lamp is 30 + 6) except **keycap, which is 62** (12 + 50). Other tools: remesh 5, rig 5, animate 3, convert 1, resize 1, uv-unwrap 5, analyze-printability free, repair-printability 10, multicolor 10.

## Prerequisites

- Node.js >= 18
- A Meshy API key ([get one here](https://www.meshy.ai/settings/api) — requires Pro plan or above)

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

## Troubleshooting

- **`MESHY_API_KEY environment variable is required`** — returned by every tool when the key didn't reach the server. Make sure it sits inside an `"env": {...}` block in your `mcp.json`, not in `args`. Restart the server after fixing it.
- **`spawn npx ENOENT`** (Windows) — wrap with `cmd /c` (see Cursor block above).
- **`error: unknown option '-y'`** (Claude Code on Windows) — use `claude mcp add-json` instead of `claude mcp add … -- npx -y …`.
- **Cursor doesn't list `meshy`** — make sure `mcp.json` is valid JSON (no trailing commas), then fully restart Cursor.
- **`Authentication failed: the Meshy API rejected MESHY_API_KEY (401)`** — the key is mistyped, revoked or expired. Regenerate at https://www.meshy.ai/settings/api, update your config and restart the server.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `MESHY_API_KEY` | **Required.** Your Meshy API key (starts with `msy_`) | — |
| `MESHY_API_HOST` | API base URL | `https://api.meshy.ai` |
| `TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `PORT` | Port for HTTP transport | `3000` |
| `CHARACTER_LIMIT` | Max response size in characters | `25000` |

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
