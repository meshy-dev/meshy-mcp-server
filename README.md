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
- **Meshy 7 + Ultra (v0.5.0)**: `ai_model: "meshy-7"` on image-to-3d, multi-image-to-3d and retexture, plus `ultra_mode` for an extra high-detail geometry pass (+5 credits, single-image only)
- **Smart Topology (v0.5.0)**: `model_type: "smart-topology"` (models `meshy-t2` / `meshy-t1`) produces part-separated geometry with a configurable polycount for **5 credits of mesh instead of 20**
- **8K Textures (v0.5.0)**: `texture_resolution: "2k" | "4k" | "8k"` on image-to-3d, multi-image-to-3d, text-to-3d refine and retexture (8K costs 15 credits vs 10). Replaces the now-deprecated `hd_texture` flag
- **Multi-view Retexture (v0.5.0)**: `multiview_image_urls` — 1–4 ordered views of the *same object* drive the texture instead of a single style reference (requires Meshy 7)
- **Auto-Rigging & Animation**: Add skeletons and animations to humanoid characters
- **Creative Lab**: One tool — a photo or a line of text → a finished, print-ready product. **7 products (v0.5.0)**: figure, lamp, keychain, fridge-magnet, vinyl-figure, brick-figure and keycap. Runs prototype→build end-to-end and returns only the final 3D model
- **Format & Size Utilities**: `convert` (format conversion incl. 3MF, 1 credit), `resize` (real-world dimensions, 1 credit), `uv_unwrap` (clean UV layout for external texturing, 5 credits)
- **2D Image Models**: `text_to_image` / `image_to_image` support `nano-banana`, `nano-banana-2`, `nano-banana-pro` and `gpt-image-2`
- **3D Printability Suite**:
  - `analyze_printability` — free FDM check (watertight, volume, holes, non-manifold edges, degenerate faces)
  - `repair_printability` — 10-credit topology repair, now also accepting **.fbx / .gltf** input (v0.5.0)
  - `process_multicolor` — 10-credit multi-color 3MF for AMS/MMU printers
- **Slicer Integration**: Auto-detect 7 installed slicers (OrcaSlicer, Bambu, Creality, Elegoo, Anycubic, PrusaSlicer, Cura) and return launch commands the agent can execute
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Workflow Intelligence**: Server instructions guide the agent through correct tool chains for each use case

### Models & Credits

`ai_model` is **not** the same set on every endpoint, and `latest` does not resolve to the same model everywhere:

| Endpoint | Accepted `ai_model` | `latest` resolves to |
|---|---|---|
| `meshy_image_to_3d` | `meshy-5`, `meshy-6`, `meshy-7`, `latest` — plus `meshy-t1` / `meshy-t2` with `model_type: "smart-topology"` | Meshy 7 |
| `meshy_multi_image_to_3d` | `meshy-5`, `meshy-6`, `meshy-7`, `latest` | Meshy 7 |
| `meshy_retexture` | `meshy-5`, `meshy-6`, `meshy-7`, `latest` | Meshy 7 |
| `meshy_text_to_3d` / `_refine` | `meshy-5`, `meshy-6`, `latest` — **no `meshy-7`** | Meshy 6 |

Image-to-3D cost by model:

| `ai_model` | Mesh only | + texture | + 8K texture |
|---|---|---|---|
| `meshy-7` / `latest` | 20 | 30 | 35 |
| `meshy-6` | 20 | 30 | 35 |
| `meshy-t2` (smart-topology) | 5 | 15 | 20 |
| `meshy-5` | 5 | 15 | — |

`ultra_mode: true` adds **+5** credits. Creative Lab is **36** credits (6 + 30) for every product except **keycap, which is 62** (12 + 50). Other tools: remesh 5, rig 5, animate 3, convert 1, resize 1, uv-unwrap 5, analyze-printability free, repair-printability 10, multicolor 10.

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

- **`MESHY_API_KEY environment variable is required`** — the key didn't reach the server. Make sure it sits inside an `"env": {...}` block in your `mcp.json`, not in `args`.
- **`spawn npx ENOENT`** (Windows) — wrap with `cmd /c` (see Cursor block above).
- **`error: unknown option '-y'`** (Claude Code on Windows) — use `claude mcp add-json` instead of `claude mcp add … -- npx -y …`.
- **Cursor doesn't list `meshy`** — make sure `mcp.json` is valid JSON (no trailing commas), then fully restart Cursor.
- **Tool calls return 401** — the API key is invalid or revoked. Regenerate at https://www.meshy.ai/settings/api.

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
npm install

# Development with hot reload
npm run dev

# Build
npm run build

# Type check
npm run lint

# Run
npm start
```

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
