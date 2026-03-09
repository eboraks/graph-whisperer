import * as http from 'http';
import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import SparqlClient from 'sparql-http-client';
import type { QueryResultsSnapshot } from '../features/SparqlWhispererChat';

export class McpManager implements vscode.Disposable {
    private httpServer?: http.Server;
    private mcpServer?: Server;
    private activeSessions = new Map<string, SSEServerTransport>();
    private statusBarItem: vscode.StatusBarItem;
    private lastResults?: QueryResultsSnapshot;

    constructor(
        private getClientOptions: () => Promise<any>
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    }

    /** Called by the extension after each query execution */
    public setLastResults(snapshot: QueryResultsSnapshot) {
        this.lastResults = snapshot;
    }

    async start(port: number): Promise<void> {
        if (this.httpServer) {
            this.stop();
        }

        const mcpServer = new Server(
            { name: 'sparql-whisperer-mcp', version: '0.1.0' },
            { capabilities: { tools: {} } }
        );

        this.registerTools(mcpServer);

        this.httpServer = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://localhost:${port}`);

            if (req.method === 'GET' && url.pathname === '/sse') {
                const transport = new SSEServerTransport('/message', res);
                this.activeSessions.set(transport.sessionId, transport);

                res.on('close', () => {
                    this.activeSessions.delete(transport.sessionId);
                });

                await mcpServer.connect(transport);
            } else if (req.method === 'POST' && url.pathname === '/message') {
                const sessionId = url.searchParams.get('sessionId');
                const transport = sessionId ? this.activeSessions.get(sessionId) : undefined;

                if (transport) {
                    await transport.handlePostMessage(req, res);
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('No active session');
                }
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        return new Promise((resolve, reject) => {
            this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    vscode.window.showWarningMessage(
                        `MCP server port ${port} is already in use. Change it in sparqlwhisperer.mcp.port.`
                    );
                }
                reject(err);
            });

            this.httpServer!.listen(port, () => {
                this.mcpServer = mcpServer;
                this.statusBarItem.text = `$(plug) MCP :${port}`;
                this.statusBarItem.tooltip = `SPARQL Whisperer MCP Server\nhttp://localhost:${port}/sse`;
                this.statusBarItem.show();
                console.log(`[SparqlWhisperer] MCP server started on http://localhost:${port}/sse`);
                resolve();
            });
        });
    }

    stop(): void {
        for (const [, transport] of this.activeSessions) {
            try { transport.close?.(); } catch { /* ignore */ }
        }
        this.activeSessions.clear();
        this.httpServer?.close();
        this.httpServer = undefined;
        this.mcpServer?.close();
        this.mcpServer = undefined;
        this.statusBarItem.hide();
        console.log('[SparqlWhisperer] MCP server stopped');
    }

    dispose(): void {
        this.stop();
        this.statusBarItem.dispose();
    }

    private registerTools(server: Server): void {
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'sparql_query',
                    description:
                        'Execute a SPARQL query (SELECT/CONSTRUCT/DESCRIBE/ASK) against the connected GraphDB repository. Updates (INSERT/DELETE) are also supported.',
                    inputSchema: {
                        type: 'object' as const,
                        properties: {
                            query: { type: 'string', description: 'The full SPARQL query string' },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'sparql_get_schema',
                    description:
                        'Introspect the graph schema: lists classes and properties. Use this first to understand the data model before writing queries.',
                    inputSchema: {
                        type: 'object' as const,
                        properties: {},
                    },
                },
                {
                    name: 'read_query_results',
                    description:
                        'Read the latest query results from the SPARQL Whisperer extension. Returns the most recent query, its type, result rows/triples, and graph visualization summary. Use this to understand what the user is currently looking at without re-running queries.',
                    inputSchema: {
                        type: 'object' as const,
                        properties: {},
                    },
                },
            ],
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
            // read_query_results doesn't need a client connection
            if (request.params.name === 'read_query_results') {
                return this.handleReadQueryResults();
            }

            const clientOptions = await this.getClientOptions();
            if (!clientOptions) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'GraphDB endpoint not configured. Set sparqlwhisperer.endpoint in VS Code settings.' }],
                };
            }
            const client = new SparqlClient(clientOptions);

            switch (request.params.name) {
                case 'sparql_query':
                    return this.handleQuery(client, request.params.arguments.query);
                case 'sparql_get_schema':
                    return this.handleGetSchema(client);
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });
    }

    private async handleQuery(client: SparqlClient, query: string) {
        try {
            const cleanQuery = query.replace(/#.*$/gm, '');
            const isAsk = /\bASK\b/i.test(cleanQuery);
            const isConstruct = /\b(CONSTRUCT|DESCRIBE)\b/i.test(cleanQuery);
            const isUpdate = /\b(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b/i.test(cleanQuery);

            if (isUpdate) {
                await (client.query as any).update(query);
                return { content: [{ type: 'text', text: 'Update executed successfully.' }] };
            }

            if (isAsk) {
                const result = await client.query.ask(query);
                return { content: [{ type: 'text', text: `Result: ${result}` }] };
            }

            if (isConstruct) {
                const stream = await client.query.construct(query);
                const quads = await this.streamToArray(stream);
                const triples = quads.map((q: any) => ({
                    subject: q.subject.value,
                    predicate: q.predicate.value,
                    object: q.object.value,
                }));
                return { content: [{ type: 'text', text: JSON.stringify(triples, null, 2) }] };
            }

            // SELECT
            const stream = await client.query.select(query);
            const results = await this.streamToArray(stream);
            const rows = results.map((row: any) => {
                const clean: any = {};
                for (const key of Object.keys(row)) {
                    clean[key] = row[key].value;
                }
                return clean;
            });
            return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
        } catch (error: any) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error: ${error.message}` }],
            };
        }
    }

    private handleReadQueryResults() {
        if (!this.lastResults) {
            return {
                content: [{ type: 'text', text: 'No query results available yet. Run a SPARQL query first using the extension (Cmd+Enter in a .sparql file).' }],
            };
        }

        const r = this.lastResults;
        const result: any = {
            queryType: r.queryType,
            query: r.query,
            timestamp: new Date(r.timestamp).toISOString(),
        };

        if (r.queryType === 'select' && r.rows) {
            result.rowCount = r.rows.length;
            result.rows = r.rows.slice(0, 50);
        } else if (r.queryType === 'construct' && r.triples) {
            result.tripleCount = r.triples.length;
            result.triples = r.triples.slice(0, 50);
        } else if (r.queryType === 'ask') {
            result.askResult = r.askResult;
        }

        if (r.graphSummary) {
            result.graphSummary = r.graphSummary;
        }

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    private async handleGetSchema(client: SparqlClient) {
        try {
            const classQuery = `SELECT DISTINCT ?class WHERE {
                { ?s a ?class } UNION { ?class a owl:Class } UNION { ?class a rdfs:Class }
                FILTER(isIRI(?class))
            } LIMIT 100`;

            const propQuery = `SELECT DISTINCT ?prop WHERE {
                ?s ?prop ?o FILTER(isIRI(?prop))
            } LIMIT 100`;

            const [classStream, propStream] = await Promise.all([
                client.query.select(classQuery),
                client.query.select(propQuery),
            ]);
            const [classes, props] = await Promise.all([
                this.streamToArray(classStream),
                this.streamToArray(propStream),
            ]);

            const schema = {
                classes: classes.map((b: any) => b.class?.value),
                properties: props.map((b: any) => b.prop?.value),
            };
            return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
        } catch (error: any) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error: ${error.message}` }],
            };
        }
    }

    private streamToArray(stream: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const data: any[] = [];
            stream.on('data', (chunk: any) => data.push(chunk));
            stream.on('end', () => resolve(data));
            stream.on('error', reject);
        });
    }
}
