# Meshy MCP Server

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Meshy AI](https://www.meshy.ai) 3D generation platform. Enables AI agents to create, manage, and download 3D models, textures, images, rigged characters, and animations through natural conversation.

## Features

20 tools covering the full Meshy API:

| Category | Tools |
|----------|-------|
| **3D Generation** | `meshy_text_to_3d`, `meshy_text_to_3d_refine`, `meshy_image_to_3d`, `meshy_multi_image_to_3d` |
| **Post-Processing** | `meshy_remesh`, `meshy_retexture`, `meshy_rig`, `meshy_animate` |
| **Image Generation** | `meshy_text_to_image`, `meshy_image_to_image` |
| **Task Management** | `meshy_get_task_status`, `meshy_list_tasks`, `meshy_cancel_task`, `meshy_download_model` |
| **Workspace** | `meshy_list_models` |
| **3D Printing** | `meshy_send_to_slicer`, `meshy_analyze_printability`, `meshy_repair_printability`, `meshy_process_multicolor` |
| **Account** | `meshy_check_balance` |

### Key Capabilities

- **Text to 3D**: Generate 3D models from text descriptions (preview + refine pipeline)
- **Image to 3D**: Convert single or multiple images into 3D models
- **Auto-Rigging & Animation**: Add skeletons and animations to humanoid characters
- **3D Printability Suite (v0.3.0)**:
  - `analyze_printability` — free FDM check (watertight, volume, holes, non-manifold edges, degenerate faces)
  - `repair_printability` — 10-credit topology repair (output format mirrors input)
  - `process_multicolor` — 10-credit multi-color 3MF for AMS/MMU printers
- **Slicer Integration**: Auto-detect 7 installed slicers (OrcaSlicer, Bambu, Creality, Elegoo, Anycubic, PrusaSlicer, Cura) and return launch commands the agent can execute
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Workflow Intelligence**: Server instructions guide the agent through correct tool chains for each use case

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
