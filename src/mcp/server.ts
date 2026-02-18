#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import SparqlClient from 'sparql-http-client';

// Default configuration (can be overridden by environment variables)
const ENDPOINT = process.env.GRAPHDB_ENDPOINT || 'http://localhost:7200/repositories/my-repo';
const USERNAME = process.env.GRAPHDB_USERNAME;
const PASSWORD = process.env.GRAPHDB_PASSWORD;

console.error('Connecting to GraphDB endpoint:', ENDPOINT);

// Initialize SPARQL client
const clientOptions: any = {
    endpointUrl: ENDPOINT
};
if (USERNAME && PASSWORD) {
    clientOptions.user = USERNAME;
    clientOptions.password = PASSWORD;
}
const client = new SparqlClient(clientOptions);

const server = new Server(
  {
    name: "graph-whisperer-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

interface SparqlResponse {
  results: {
    bindings: Array<{
      [key: string]: { type: string; value: string };
    }>;
  };
}

// Tool Implementation
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "sparql_query",
        description: "Executing a SPARQL query against the configured GraphDB repository. Use this to read data (SELECT/CONSTRUCT/DESCRIBE/ASK). Updates (INSERT/DELETE) are also supported via UPDATE keyword but be careful.",
        inputSchema: zodToJsonSchema(z.object({
          query: z.string().describe("The full SPARQL query string to execute"),
        })),
      },
      {
        name: "sparql_get_schema",
        description: "Introspect the graph schema to understand available classes and properties. Returns a list of classes (rdfs:Class, owl:Class) and properties used in the graph. Use this first, but if looking for specific concepts (like 'Human'), prefer using sparql_query with a keyword search pattern.",
        inputSchema: zodToJsonSchema(z.object({})),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  switch (request.params.name) {
    case "sparql_query": {
      const { query } = request.params.arguments as { query: string };
      console.error('Executing query:', query);
      
      try {
        // Detect query type to use correct method
        const isSelect = /^\s*(PREFIX\s+.*\s+)*SELECT/i.test(query);
        const isAsk = /^\s*(PREFIX\s+.*\s+)*ASK/i.test(query);
        const isUpdate = /^\s*(PREFIX\s+.*\s+)*(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)/i.test(query); // Simple update check

        let result;
        if (isUpdate) {
            // sparql-http-client update method might not return standard response format immediately useful for text
            // but let's try it if available or use select/update method
            // Actually, client.query.update() exists
            await (client.query as any).update(query);
            return {
                content: [{ type: "text", text: "Update executed successfully." }],
            };
        } else if (isAsk) {
             result = await client.query.ask(query);
             return {
                content: [{ type: "text", text: `Result: ${result}` }],
             };
        } else if (isSelect) {
            const stream = await client.query.select(query);
            result = await streamToString(stream);
        } else {
             // Construct/Describe (returns quads)
             const stream = await client.query.construct(query);
             result = await streamToString(stream);
        }

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      } catch (error: any) {
        console.error('Query error:', error);
        return {
             isError: true,
             content: [{ type: "text", text: `Error executing query: ${error.message}` }],
        };
      }
    }

    case "sparql_get_schema": {
      console.error('Getting schema...');
      try {
        // 1. Get Classes
        const classQuery = `
          SELECT DISTINCT ?class WHERE {
            { ?s a ?class }
            UNION
            { ?class a owl:Class }
            UNION
            { ?class a rdfs:Class }
            FILTER(isIRI(?class))
          } LIMIT 100
        `;
        const classStream = await client.query.select(classQuery);
        const classes = await streamToArray(classStream);
        
        // 2. Get Properties
        const propQuery = `
          SELECT DISTINCT ?prop WHERE {
            ?s ?prop ?o 
            FILTER(isIRI(?prop))
          } LIMIT 100
        `;
        const propStream = await client.query.select(propQuery);
        const props = await streamToArray(propStream);

        const schemaSummary = {
            classes: classes.map((b: any) => b.class?.value),
            properties: props.map((b: any) => b.prop?.value)
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(schemaSummary, null, 2),
            },
          ],
        };
      } catch (error: any) {
         console.error('Schema introspection error:', error);
         return {
             isError: true,
             content: [{ type: "text", text: `Error checking schema: ${error.message}` }],
        };
      }
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

// Helper to convert Zod schema to JSON Schema for MCP
function zodToJsonSchema(schema: z.ZodType<any>): any {
    // Basic implementation for object schemas we use
    // For a robust implementation, use 'zod-to-json-schema' package if needed, 
    // but for simple object inputs, we can manual construct or rely on basic properties.
    // However, MCP expects a JSON schema object.
    
    // Let's implement a minimal converter for our specific needs to avoid extra dependency if possible,
    // or just return a loose schema. But strictly speaking we should use a proper converter.
    // For now, let's manually constructing the schema object for our known tools.
    
    if (schema instanceof z.ZodObject) {
         const shape = schema.shape;
         const properties: any = {};
         const required: string[] = [];
         
         for (const key in shape) {
             const field = shape[key];
             if (!field.isOptional()) required.push(key);
             
             // Very basic type mapping
             let type = 'string'; // Default
             let description = field.description;
             
             if (field instanceof z.ZodString) type = 'string';
             // Add more types if needed
             
             properties[key] = { type, description };
         }
         
         return {
             type: 'object',
             properties,
             required
         };
    }
    return { type: 'object' }; // Fallback
}

async function streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('data', (chunk: any) => {
             // sparql-http-client returns objects (bindings or quads), not string chunks usually?
             // Actually for select it returns row objects.
             if (typeof chunk === 'object') {
                 data += JSON.stringify(chunk) + '\n';
             } else {
                 data += chunk.toString();
             }
        });
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
    });
}

async function streamToArray(stream: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const data: any[] = [];
        stream.on('data', (chunk: any) => data.push(chunk));
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
    });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Graph Whisperer MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
