# cursor-better-feedback

MCP feedback tool with interactive UI for Cursor. Replaces the built-in AskQuestion with a more robust feedback mechanism using MCP Apps.

## Installation

Add to your Cursor MCP configuration (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "feedback": {
      "command": "npx",
      "args": ["cursor-better-feedback", "--stdio"],
      "env": {
        "FEEDBACK_TIMEOUT": "1200",
        "FEEDBACK_FONT_SIZE": "12px"
      }
    }
  }
}
```

### Configuration (via `env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `FEEDBACK_TIMEOUT` | `1200` | Default timeout in seconds (1-3600) |
| `FEEDBACK_FONT_SIZE` | `12px` | UI font size (any valid CSS value) |

## Local Development

```bash
# Install dependencies
npm install

# Build (UI + server)
npm run build

# Run in HTTP mode (for testing with basic-host)
npm run serve

# Run in stdio mode (for Cursor integration)
npm run serve:stdio

# Development mode (watch + auto-rebuild)
npm run dev
```

### Testing with basic-host

```bash
# Terminal 1: Start the server
npm run build && npm run serve

# Terminal 2: Start the basic-host test harness
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm start

# Open http://localhost:8080 in your browser
```

## How It Works

1. The LLM calls `feedback(message="...")` when it needs user input
2. Cursor renders the feedback UI in an iframe (MCP Apps)
3. User types feedback and clicks Submit
4. The UI calls `submit_feedback` to resolve the pending tool call
5. The LLM receives the feedback text and continues

If the host doesn't support MCP Apps, the tool falls back to returning a text prompt asking the user to provide feedback in their next message.
