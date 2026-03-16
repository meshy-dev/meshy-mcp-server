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
- **3D Printing Workflow**: Download models, check printability, send to Bambu Studio
- **Smart File Organization**: Auto-saves to `meshy_output/` with project folders, metadata, and history tracking
- **Built-in Polling**: `meshy_get_task_status` with `wait=true` auto-polls with exponential backoff

## Quick Start

### Prerequisites

- Node.js >= 18
- A Meshy API key ([get one here](https://www.meshy.ai/settings/api) — requires Pro plan or above)

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "meshy": {
      "command": "npx",
      "args": ["-y", "meshy-mcp-server"],
      "env": {
        "MESHY_API_KEY": "msy_YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add meshy -- npx -y meshy-mcp-server
```

Then set your API key in your environment:

```bash
export MESHY_API_KEY="msy_YOUR_API_KEY"
```

### Smithery

[![smithery badge](https://smithery.ai/badge/meshy-mcp-server)](https://smithery.ai/server/meshy-mcp-server)

```bash
npx -y @smithery/cli install meshy-mcp-server --client claude
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `MESHY_API_KEY` | **Required.** Your Meshy API key (starts with `msy_`) | — |
| `MESHY_API_HOST` | API base URL | `https://api.meshy.ai` |
| `TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `PORT` | Port for HTTP transport | `3000` |
| `CHARACTER_LIMIT` | Max response size in characters | `25000` |

### Test Mode

Use the test API key to try the server without credits:

```
MESHY_API_KEY=msy_dummy_api_key_for_test_mode_12345678
```

## Agent Skill

This package includes an agent workflow skill in the `skill/` directory. The skill provides:

- Workflow guidance for multi-step 3D generation pipelines
- Cost awareness and credit tracking
- 3D printing workflows with slicer integration
- API parameter reference

To use the skill in Cursor or Claude Code, copy `skill/SKILL.md` to your project's skills directory.

## Development

```bash
# Clone and install
git clone https://github.com/Arlieeee/meshy-mcp-server.git
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
