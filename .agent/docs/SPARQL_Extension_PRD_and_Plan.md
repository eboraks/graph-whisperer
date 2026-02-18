# SPARQL VS Code Extension: "Graph Whisperer"

## Product Requirements Document (PRD) & Implementation Plan

### 1. Executive Summary

Develop a professional-grade Visual Studio Code extension for RDF/SPARQL development, specifically optimized for **GraphDB**. The extension will provide a modern query authoring environment, seamless results visualization in a dedicated bottom panel, and robust integration with **Agentic AI** (Cursor, Antigravity) via the **Model Context Protocol (MCP)**.

### 2. User Stories

1.  **Configuration**: As a developer, I want to easily configure my connection to a local GraphDB instance (URL, Repository ID) using Basic Authentication so I can securely access my data.
2.  **Query Execution**: As a developer, I want to write a SPARQL query in a `.sparql` file and execute it with a single command/keyboard shortcut, running the entire file as one query.
3.  **Result Visualization**: As a developer, I want to see query results in a dedicated **bottom panel** (similar to the Terminal/Output view) without obscuring my code.
    - **Tabular Data**: Function `SELECT` queries should appear in a sortable data grid.
    - **Graph Data**: Function `CONSTRUCT` or `DESCRIBE` queries should appear as an interactive JSON tree.
4.  **Agentic Assistance**: As an AI User (via Cursor/Antigravity), I want the AI to be able to "drive" the extension—executing queries and inspecting the schema autonomously—so it can answer my natural language questions about the graph.

---

### 3. Functional Requirements

#### 3.1. Connectivity & Configuration

- **Target Database**: GraphDB (running locally via Docker).
- **Authentication**: Basic Authentication (Username/Password).
- **Settings Management**:
  - `graphwhisperer.endpoint`: URL to the GraphDB endpoint (e.g., `http://localhost:7200/repositories/my-repo`).
  - `graphwhisperer.username`: stored in VS Code `SecretStorage`.
  - `graphwhisperer.password`: stored in VS Code `SecretStorage`.

#### 3.2. Editor Features

- **File Support**: `.sparql`, `.rq`.
- **Syntax Highlighting**: Standard SPARQL 1.1 syntax highlighting (keywords, variables, literals).
- **Execution Model**: "Run File" command ($ \text{Cmd+Enter} $ or Play button). Executes the entire file content.

#### 3.3. Results View (UI)

- **Location**: Bottom Panel (integrated into the VS Code Panel area alongside Terminal/Output).
- **View Types**:
  - **Data Grid**: For `SELECT` queries. Columns auto-generated from variables.
  - **JSON Tree**: For `CONSTRUCT`/`DESCRIBE` queries (Rendered as JSON-LD or similar).
- **Interactions**:
  - Copy cell/row/tree node.
  - Basic sorting on columns.

#### 3.4. Agentic Integration (MCP)

- The extension will bundle or communicate with an **MCP Server** to expose tools to the IDE's AI.
- **Exposed Tools**:
  - `sparql_execute_query(query: string)`: Runs a query against the configured endpoint.
  - `sparql_get_schema()`: Runs introspection queries to retrieve classes/properties.
- **Context**: Provide context files (`.cursor/rules`) to guide the AI on how to use these tools.

---

### 4. Technical Architecture

#### 4.1. Core Components

- **Extension Host**: TypeScript/Node.js.
- **SPARQL Client**: `sparql-http-client` for robust HTTP handling and stream parsing.
  - _Note_: GraphDB requires specific headers for JSON-LD/SPARQL-JSON.
- **UI Framework**: React + Vite (bundled into the extension) + `@vscode/webview-ui-toolkit`.
- **State Management**: `zustand` (or React Context) for managing result state within the Webview.

#### 4.2. UI Layout Strategy

To match the "SQL Server" look (bottom panel):

- Register a `WebviewViewProvider` with the id `graphwhisperer.results`.
- Contribute this view to the `panel` location in `package.json`.
  ```json
  "contributes": {
    "viewsContainers": {
      "panel": [
        {
          "id": "graphwhisperer",
          "title": "SPARQL Results",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "graphwhisperer": [
        {
          "id": "graphwhisperer.results",
          "name": "Query Results",
          "type": "webview"
        }
      ]
    }
  }
  ```

#### 4.3. MCP Implementation

- Use `@modelcontextprotocol/sdk`.
- The extension will start a local MCP server (stdio or SSE) that the IDE (Cursor) interacts with.
- _Alternative_: Since Cursor natively supports MCP, we can document how to add the extension's bundled server script to Cursor's MCP settings.

---

### 5. Implementation Plan

#### Phase 1: Foundation & Connectivity (Days 1-2)

- **Goal**: Execute a simple query against GraphDB and log the result to the console.
- **Tasks**:
  1.  [x] Initialize VS Code extension project (TypeScript).
  2.  [x] Set up `sparql-http-client` and Basic Auth configuration settings.
  3.  [x] Create the `Run Query` command that reads the current file.
  4.  [x] Verify connection to local GraphDB Docker instance.

#### Phase 2: Results Visualization (Days 3-5)

- **Goal**: Display results in the Bottom Panel.
- **Tasks**:
  1.  [x] Implement `WebviewViewProvider` for the bottom panel.
  2.  [x] Set up the React build pipeline for the Webview.
  3.  [x] Implement the **Custom React Table** component for `SELECT` results.
      - **Note**: This should be a custom-built component (or use a lightweight library like `tanstack-table`) styled to match VS Code, rather than just relying on generic webviews.
  4.  [x] Implement the **JSON Tree** component (using `react-json-view` or similar) for `CONSTRUCT` results.
  5.  [x] Handle error states (invalid query, connection refused).

#### Phase 3: Agentic Interface (MCP) (Days 6-7)

- **Goal**: Let Cursor "talk" to GraphDB.
- **Tasks**:
  1.  [x] Create a standalone script `server.ts` implementing the MCP protocol.
  2.  [x] Expose the `query` tool wrapping the `sparql-http-client`.
  3.  [x] Expose a `introspect_schema` tool (canned queries to fetch `owl:Class` and properties).
  4.  [x] Add `.cursor/rules/sparql-agent.mdc` to the project to teach Cursor how to use these tools.

#### Phase 4: Polish & Packaging (Day 8)

- **Tasks**:
  1.  Add extension icon and branding.
  2.  Clean up logging.
  3.  Package (`vsce package`) and test installation.

#### Phase 5: Ontology Explorer Enhancements (New)

- **Goal**: Make the ontology view a powerful tool for navigating and building queries.
- **Features**:
  1.  **Deep Traversal (3-Hops)**:
      - Navigate from Class -> Property -> Range Class -> Property.
      - Stop at 3 levels of depth to prevent infinite circular queries.
      - Differentiate `owl:ObjectProperty` (expandable) from `owl:DatatypeProperty` (leaf).
  2.  **Search**:
      - Add a "Search" action to the view title.
      - Server-side SPARQL filter (`FILTER(regex(?label, "term", "i"))`) to find matching classes/properties without loading the whole graph.
  3.  **Drag & Drop**:
      - Allow dragging a class or property from the tree directly into the SPARQL editor.
      - Dropping inserts the full URI (or prefixed name if prefixes exist).
- **Technical Plan**:
  - Implement `vscode.TreeDragAndDropController`.
  - Refactor `OntologyProvider.getChildren` to accept context/depth.
  - New SPARQL queries for fetching property ranges (using `rdfs:range` or `?s ?p ?o` sampling).

---

#### Phase 6: Editor Intelligence & AI Integration (New)

- **Goal**: Empower both developers and AI agents with ontology-aware suggestions and context.
- **Features**:
  1.  **Intelligent SPARQL Completion (IntelliSense)**:
      - Implement `vscode.CompletionItemProvider`.
      - **Context-Aware Properties**: If a variable is inferred to be of type `T`, suggest only properties valid for `T` (domain/range check).
      - **Variable Naming**: Suggest semantic variable names (e.g., `?film` for `vocab:Film`) when typing `?`.
  2.  **Copilot Integration (Chat Participant)**:
      - Register a Chat Participant `@graphwhisperer` using `vscode.chat.createChatParticipant`.
      - Allow users to ask natural language questions about the ontology (e.g., "@graphwhisperer How do I find all films with a specific character?").
      - The participant uses the `OntologyProvider` cache to ground its answers.
  3.  **Agent Context Export (Drift/Rules)**:
      - Auto-generate a lightweight schema summary `.vscode/ontology_summary.md` (hidden or visible).
      - This file acts as "context" for generic agents (Cursor, Antigravity) that scan the file system, enabling them to understand the data model without needing explicit tool calls.
- **Technical Plan**:
  - Use `vscode.languages.registerCompletionItemProvider` for SPARQL.
  - Implement a basic SPARQL parser (or use regex for simple cases) to infer variable types in the current query.
  - Implement `vscode.chat.createChatParticipant` handler.

---

### 6. Development Prerequisites

- **Docker**: For running GraphDB locally.
- **Node.js**: v18+.
- **GraphDB Image**: `ontotext/graphdb:10.6.3` (or latest).
