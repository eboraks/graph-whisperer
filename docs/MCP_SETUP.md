This project exposes an MCP server to allow AI agents like Cursor to query your GraphDB instance directly.

### Configuration

1.  **Dependencies**: Ensure `npm install` has been run. You need `@modelcontextprotocol/sdk` and `zod`.
2.  **Environment Variables**: The server can be configured via environment variables:
    - `GRAPHDB_ENDPOINT`: URL to your repository (default: `http://localhost:7200/repositories/my-repo`)
    - `GRAPHDB_USERNAME`: (Optional)
    - `GRAPHDB_PASSWORD`: (Optional)

### Using with Cursor

To add this MCP server to Cursor:

1.  Open **Cursor Settings** -> **Features** -> **MCP**.
2.  Click **+ Add New Server**.
3.  **Name**: `Graph Whisperer`
4.  **Type**: `command`
5.  **Command**: `node /absolute/path/to/graph-whisperer/out/mcp/server.js` (Note: Point to the compiled JS file in `out/`)
6.  **Environment Variables**: Add your `GRAPHDB_ENDPOINT`, etc. here if needed.

### Available Tools

- `sparql_query(query: string)`: Executes a SPARQL query.
- `sparql_get_schema()`: Returns a list of classes and properties in the graph.
