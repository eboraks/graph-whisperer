# MCP Server Setup

SPARQL Whisperer includes a built-in [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server that gives AI agents direct access to your GraphDB endpoint. The server auto-starts when the extension activates and uses the same connection settings — no separate configuration or environment variables needed.

## How it works

1. You install and configure the SPARQL Whisperer extension (set your endpoint, credentials).
2. The extension starts an MCP server on `http://localhost:3330/sse` (SSE transport).
3. You point your AI tool to that URL (one-time setup).
4. The AI agent can now run SPARQL queries, introspect your schema, and read your latest query results.

## Extension settings

| Setting                      | Description                                          | Default |
| :--------------------------- | :--------------------------------------------------- | :------ |
| `sparqlwhisperer.mcp.enabled` | Auto-start the built-in MCP server                  | `true`  |
| `sparqlwhisperer.mcp.port`    | Port for the MCP server (SSE transport)             | `3330`  |

When the server is running, you'll see a **`MCP :3330`** indicator in the VS Code status bar.

## Connecting your AI tool

### Cursor

1. Open **Cursor Settings** > **Features** > **MCP**.
2. Click **+ Add New Server**.
3. Fill in:
   - **Name**: `SPARQL Whisperer`
   - **Type**: `sse`
   - **URL**: `http://localhost:3330/sse`
4. Click **Save**.

The three tools (`sparql_query`, `sparql_get_schema`, `read_query_results`) will appear in Cursor's tool list.

### Claude Code

Run this command in your terminal:

```bash
claude mcp add sparql-whisperer --transport sse http://localhost:3330/sse
```

Or add it manually to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "sparql-whisperer": {
      "type": "sse",
      "url": "http://localhost:3330/sse"
    }
  }
}
```

Then restart Claude Code. Verify with `/mcp` — you should see `sparql-whisperer` listed with 3 tools.

### Windsurf

1. Open **Settings** > **Cascade** > **MCP**.
2. Add a new server with type `sse` and URL `http://localhost:3330/sse`.

### Other MCP-compatible tools

Add an SSE-type MCP server pointing to `http://localhost:3330/sse`. Refer to your tool's MCP documentation for exact steps.

## Available tools

| Tool | Input | Description |
| :--- | :---- | :---------- |
| `sparql_query` | `query` (string) | Execute any SPARQL query: SELECT, CONSTRUCT, ASK, DESCRIBE, INSERT, DELETE |
| `sparql_get_schema` | _(none)_ | Lists classes and properties in the graph (up to 100 each). Use this first to understand the data model. |
| `read_query_results` | _(none)_ | Returns the latest query results from the extension (rows, triples, graph summary) without re-running queries. Use this to see what the user is currently looking at. |

## Troubleshooting

**"No tools found" / agent can't see tools**
- Make sure the extension is running — look for `MCP :3330` in the VS Code status bar.
- Verify the URL is exactly `http://localhost:3330/sse` (not just `localhost:3330`).
- Restart your AI tool after adding the MCP config.

**Port already in use**
- Another instance of VS Code (or another app) is using port 3330.
- Change the port in settings: `sparqlwhisperer.mcp.port` (e.g., to `3331`), then update your AI tool's config to match.

**"GraphDB endpoint not configured"**
- The MCP server uses the same settings as the extension. Set `sparqlwhisperer.endpoint` in VS Code settings.

**Want to disable the MCP server?**
- Set `sparqlwhisperer.mcp.enabled` to `false` in VS Code settings. The server stops immediately.

## Standalone server (advanced)

For use cases where you want to run the MCP server outside of VS Code (e.g., in a CI pipeline), the standalone stdio-based server is still available:

```bash
GRAPHDB_ENDPOINT=http://localhost:7200/repositories/my-repo \
  node out/mcp/server.js
```

This version uses stdio transport and reads configuration from environment variables (`GRAPHDB_ENDPOINT`, `GRAPHDB_USERNAME`, `GRAPHDB_PASSWORD`).
