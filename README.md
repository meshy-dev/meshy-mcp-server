# Meshy MCP Server

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Meshy AI](https://www.meshy.ai) 3D generation platform. Enables AI agents to create, manage, and download 3D models, textures, images, rigged characters, and animations through natural conversation.

## Features

19 tools covering the full Meshy API:

| Category | Tools |
|----------|-------|
| **3D Generation** | `meshy_text_to_3d`, `meshy_text_to_3d_refine`, `meshy_image_to_3d`, `meshy_multi_image_to_3d` |
| **Post-Processing** | `meshy_remesh`, `meshy_retexture`, `meshy_rig`, `meshy_animate` |
| **Image Generation** | `meshy_text_to_image`, `meshy_image_to_image` |
| **Task Management** | `meshy_get_task_status`, `meshy_list_tasks`, `meshy_cancel_task`, `meshy_download_model` |
| **Workspace** | `meshy_list_models` |
| **3D Printing** | `meshy_send_to_slicer`, `meshy_analyze_printability`, `meshy_process_multicolor` |
| **Account** | `meshy_check_balance` |

### Key Capabilities

- **Text to 3D**: Generate 3D models from text descriptions (preview + refine pipeline)
- **Image to 3D**: Convert single or multiple images into 3D models
- **Auto-Rigging & Animation**: Add skeletons and animations to humanoid characters
- **Multi-Color 3D Printing**: Process textured models into multi-color 3MF files for 3D printing
- **Slicer Integration**: Auto-detect installed slicer software and open models directly
- **Print-Ready OBJ**: Built-in coordinate transformation (Y-up → Z-up) for 3D printing
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Workflow Intelligence**: Server instructions guide the agent through correct tool chains for each use case

## Quick Start

### Prerequisites

- Node.js >= 18
- A Meshy API key ([get one here](https://www.meshy.ai/settings/api) — requires Pro plan or above)

### Claude Code

```bash
claude mcp add meshy -- npx -y @meshy-ai/meshy-mcp-server -e MESHY_API_KEY=msy_YOUR_API_KEY
```

That's it. The server includes built-in workflow instructions — no additional configuration needed.

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "meshy": {
      "command": "npx",
      "args": ["-y", "@meshy-ai/meshy-mcp-server"],
      "env": {
        "MESHY_API_KEY": "msy_YOUR_API_KEY"
      }
    }
  }
}
```

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
