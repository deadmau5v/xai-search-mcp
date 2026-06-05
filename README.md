# XAI Search MCP Server

A **Streamable HTTP** MCP server built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (`McpAgent` class) that exposes a single **X_Search** tool for deep searching x.com posts and articles via the [xAI Grok API](https://docs.x.ai/).

## Features

- **X_Search tool** – Deep search x.com posts, threads, and articles using xAI's Grok model
- **Handle filtering** – Filter by `allowed_x_handles` or `excluded_x_handles` (max 20)
- **Date range** – Restrict results with `from_date` / `to_date` (ISO8601)
- **Media understanding** – Optional image and video analysis in posts
- **Citations** – Returns source URLs and snippets from search results
- **Persistent state** – Per-session Durable Object with built-in SQLite
- **Streamable HTTP** – Modern MCP transport (no deprecated SSE)
- **Auto-deploy** – GitHub Actions CI/CD pipeline included

## Architecture

```
MCP Client (Claude, Cursor, etc.)
        │
        ▼  Streamable HTTP
┌───────────────────────┐
│  Cloudflare Worker    │
│  XaiSearchMCP        │
│  (McpAgent)          │
│                       │
│  ┌───────────────┐   │
│  │  X_Search     │   │
│  │  tool         │──────►  xAI API (api.x.ai/v1)
│  └───────────────┘   │     Bearer XAI_API_KEY
│                       │
│  Durable Object       │
│  (per-session state)  │
└───────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- A [Cloudflare account](https://dash.cloudflare.com/)
- An [xAI API key](https://console.x.ai/)

### 1. Clone & Install

```bash
git clone https://github.com/deadmau5v/xai-search-mcp.git
cd xai-search-mcp
npm install
```

### 2. Configure Secrets

For local development, create `.dev.vars`:

```bash
XAI_API_KEY=your_xai_api_key_here
```

For production, set the secret via Wrangler:

```bash
npx wrangler secret put XAI_API_KEY
```

### 3. Develop Locally

```bash
npm run dev
```

The MCP server runs at `http://localhost:8787/mcp`.

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

The MCP server will be live at `https://xai-search-mcp.<your-account>.workers.dev/mcp`.

## Tool Reference

### X_Search

Deep search x.com posts and articles using xAI Grok.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `allowed_x_handles` | string[] | ❌ | Only search posts from these handles (max 20) |
| `excluded_x_handles` | string[] | ❌ | Exclude posts from these handles (max 20) |
| `from_date` | string | ❌ | Start date (ISO8601, e.g. "2025-01-01") |
| `to_date` | string | ❌ | End date (ISO8601, e.g. "2025-12-31") |
| `enable_image_understanding` | boolean | ❌ | Analyze images in posts |
| `enable_video_understanding` | boolean | ❌ | Analyze videos in posts |

**Example invocation (MCP client):**

```json
{
  "tool": "X_Search",
  "arguments": {
    "query": "What are people saying about AI agents?",
    "from_date": "2026-01-01",
    "to_date": "2026-06-06"
  }
}
```

## Connect from MCP Clients

### Claude Desktop

```json
{
  "mcpServers": {
    "xai-search": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://xai-search-mcp.<your-account>.workers.dev/mcp"
      ]
    }
  }
}
```

### Cursor / VS Code

Add to your MCP settings:

```json
{
  "mcp": {
    "servers": {
      "xai-search": {
        "url": "https://xai-search-mcp.<your-account>.workers.dev/mcp",
        "transport": "streamable-http"
      }
    }
  }
}
```

## GitHub Actions CI/CD

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys to Cloudflare Workers on every push to `main`.

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers edit permissions |
| `XAI_API_KEY` | Your xAI API key |

## Project Structure

```
xai-search-mcp/
├── src/
│   └── index.ts              # McpAgent server with X_Search tool
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions auto-deploy
├── wrangler.toml             # Cloudflare Workers config
├── package.json
├── tsconfig.json
├── .gitignore
├── .dev.vars.example         # Local dev secrets template
└── README.md
```

## License

MIT
