# Graph Whisperer — Visual Graph Explorer Development Plan

**Stack:** VS Code Extension (TypeScript) · React Webview (Vite) · Cytoscape.js · GraphDB (SPARQL)

---

## 1. Project Overview

Add an interactive **Graph View** tab to Graph Whisperer that lives in the VS Code **bottom panel** — alongside Terminal, Problems, and the existing Results tab. When a user executes a SPARQL query (especially `CONSTRUCT`), the results are automatically visualized as a force-directed graph using Cytoscape.js. Users can click nodes to inspect properties, double-click to expand neighborhoods, and maximize the panel for a full-screen exploration experience.

The flow mirrors how the existing `ResultsPanel` works for tabular results: **write query → execute → see visualization**. The Graph View is simply another rendering mode for SPARQL results.

---

## 2. Architecture Fit

### 2.1 Where It Lives in VS Code

```
┌─────────────────────────────────────────────────────────┐
│  Editor Area                                            │
│  ┌────────────────────────────────────────────────────┐ │
│  │  query.sparql                                      │ │
│  │  CONSTRUCT { ?s ?p ?o } WHERE { ... }              │ │
│  │                                  ▶ Run Query       │ │
│  └────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  Bottom Panel  (user can drag to resize / maximize)     │
│  ┌──────────┐ ┌───────────────┐ ┌──────────┐           │
│  │ Terminal  │ │ Results Table │ │ Graph ◀──┼── NEW     │
│  └──────────┘ └───────────────┘ └──────────┘           │
│  ┌──────────────────────────────────────────────────┐   │
│  │            Cytoscape.js Canvas                    │   │
│  │      ┌───┐        ┌───┐                          │   │
│  │      │ A │───────▶│ B │    (force-directed)      │   │
│  │      └───┘        └───┘                          │   │
│  │         \          │                              │   │
│  │          \   ┌───┐                                │   │
│  │           └▶│ C │                                │   │
│  │              └───┘                                │   │
│  │                                                   │   │
│  │  [Fit] [Re-layout] [Clear]      Detail: Node A ▸ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                        ▲
                 Sidebar │
          ┌──────────────┴───────────┐
          │ Ontology Explorer (tree) │  ← existing
          │   Classes                │
          │   Properties             │
          └──────────────────────────┘
```

**Key UX decisions:**

- The Graph View tab auto-focuses when a `CONSTRUCT` query returns results.
- For `SELECT` queries, the Results Table remains the default tab, but a "Show as Graph" button lets users switch.
- The user can **drag the bottom panel divider** to resize, or click the maximize icon to go full-height — this gives the "expand to see full view" behavior natively.

### 2.2 Architectural Pillars

| Pillar | Existing Component | Graph View Role |
|---|---|---|
| **Extension Host** (`src/`) | `SparqlClient`, `OntologyProvider`, `ResultsPanel` | Intercepts query results, transforms triples/bindings into graph data, pushes to Graph View webview. |
| **Webview UI** (`webview-ui/`) | React + Vite `ResultsPanel` | New `GraphView` component renders Cytoscape.js canvas, controls toolbar, and detail drawer. |
| **MCP Server** (`src/mcp/`) | `sparql_get_schema`, `sparql_query` | Optionally expose graph visualization triggers to external AI agents. |

### 2.3 Data Flow

```
┌───────────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                     │
│                                                               │
│  User runs query                                              │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────┐    raw SPARQL     ┌───────────────────────┐ │
│  │ SparqlClient  │ ──── results ───▶│ GraphResultTransformer │ │
│  │ (existing)    │                  │ (new)                  │ │
│  └──────────────┘                  │                         │ │
│                                    │ CONSTRUCT → triples     │ │
│                                    │ SELECT    → heuristic   │ │
│                                    │              extraction │ │
│                                    └───────────┬─────────────┘ │
│                                                │               │
│                                    { nodes, edges } (JSON)    │
│                                                │               │
│                            postMessage         │               │
└────────────────────────────────┬───────────────┘               │
                                 │                                │
                                 ▼                                │
┌───────────────────────────────────────────────────────────────┐
│                React Webview (Bottom Panel Tab)                │
│                                                               │
│  ┌─────────────┐  ┌────────────────────┐  ┌───────────────┐  │
│  │  Toolbar     │  │  Cytoscape Canvas  │  │ Detail Drawer │  │
│  │  [Fit][Clear]│  │  (graph render)    │  │ (properties)  │  │
│  └─────────────┘  └────────────────────┘  └───────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

**The Extension Host pushes data to the webview** — the webview does not initiate SPARQL queries. This keeps the webview stateless and mirrors how `ResultsPanel` already works.

---

## 3. Technology Choices

### 3.1 Graph Visualization — Cytoscape.js

Cytoscape.js runs in the webview's sandboxed iframe on a `<canvas>` element.

**npm packages (installed in `webview-ui/`):**

| Package | Purpose |
|---|---|
| `cytoscape` | Core graph rendering and interaction |
| `cytoscape-cose-bilkent` | Force-directed layout with compound node support |
| `cytoscape-popper` + `@floating-ui/dom` | Tooltip positioning on hover (optional, Phase 3) |

### 3.2 Bottom Panel Registration — `WebviewViewProvider`

To place a webview tab in the bottom panel, VS Code requires a `WebviewViewProvider` registered to a view declared in the `panel` viewContainer. This is different from `createWebviewPanel()` (which opens in the editor area).

### 3.3 Webview State Management

React `useReducer` + Context for graph state. The `acquireVsCodeApi()` wrapper pattern already in `webview-ui/` handles `postMessage`.

---

## 4. Query-to-Graph Transformation

The critical new piece is converting SPARQL results into graph data. Different query types require different strategies.

### 4.1 `CONSTRUCT` Queries (Primary Path)

`CONSTRUCT` returns a set of RDF triples — this maps 1:1 to a graph:

```
CONSTRUCT { ?s ?p ?o } WHERE { ... }
```

Each triple becomes: **subject** → node, **object** → node (if IRI) or property (if literal), **predicate** → edge.

```typescript
// src/graph/GraphResultTransformer.ts

interface GraphData {
  nodes: RdfNode[]
  edges: RdfEdge[]
}

function transformConstructResult(triples: Triple[]): GraphData {
  const nodeMap = new Map<string, RdfNode>()
  const edges: RdfEdge[] = []

  for (const triple of triples) {
    const s = triple.subject.value
    const p = triple.predicate.value
    const o = triple.object.value

    // Subject is always a node
    if (!nodeMap.has(s)) {
      nodeMap.set(s, {
        uri: s,
        label: localName(s),
        type: 'Resource',
        types: [],
      })
    }

    if (triple.object.termType === 'NamedNode') {
      // Object is an IRI → it's a node, and the predicate is an edge
      if (!nodeMap.has(o)) {
        nodeMap.set(o, {
          uri: o,
          label: localName(o),
          type: 'Resource',
          types: [],
        })
      }

      // Handle rdf:type specially: enrich node type, don't create edge
      if (p === RDF_TYPE) {
        const node = nodeMap.get(s)!
        node.types.push(o)
        node.type = localName(o)
      } else {
        edges.push({
          id: `${s}--${p}--${o}`,
          sourceUri: s,
          targetUri: o,
          predicate: p,
          predicateLabel: localName(p),
        })
      }
    }
    // Literals are stored for the detail panel, not rendered as nodes
  }

  return { nodes: Array.from(nodeMap.values()), edges }
}
```

### 4.2 `SELECT` Queries (Heuristic Mapping)

`SELECT` returns tabular bindings. The extension applies heuristics to detect graph structure:

**Strategy A — Auto-detect `?s ?p ?o` pattern:**

If the result set contains columns named `s`/`subject`, `p`/`predicate`/`property`, and `o`/`object`, treat them like `CONSTRUCT` triples.

**Strategy B — Pair columns with IRI values:**

If the result has two IRI-typed columns and a connecting column, infer `source → relationship → target`.

**Strategy C — Manual "Show as Graph" with column mapping:**

If auto-detection fails, present a small mapping UI: "Which column is the source? Which is the target? Which is the label?"

```typescript
function detectGraphPattern(bindings: Binding[]): 'spo' | 'pair' | 'manual' {
  if (bindings.length === 0) return 'manual'
  const vars = Object.keys(bindings[0])
  const lower = vars.map(v => v.toLowerCase())

  // Check for s/p/o naming convention
  const hasS = lower.some(v => ['s', 'subject', 'source'].includes(v))
  const hasP = lower.some(v => ['p', 'predicate', 'property', 'rel'].includes(v))
  const hasO = lower.some(v => ['o', 'object', 'target'].includes(v))

  if (hasS && hasP && hasO) return 'spo'

  // Check for at least two IRI columns
  const iriCols = vars.filter(v =>
    bindings[0][v]?.termType === 'NamedNode'
  )
  if (iriCols.length >= 2) return 'pair'

  return 'manual'
}
```

### 4.3 `ASK` / `UPDATE` Queries

These don't produce graph-renderable results. The Graph View tab simply shows a message: "This query type does not produce graph results."

---

## 5. Message Protocol — Extension Host ↔ Webview

### 5.1 Message Types

```typescript
// src/shared/graphViewMessages.ts

// ── Extension Host → Webview (push-only for results) ────

export type GraphViewMessage =
  | { command: 'graph:showResults'; data: GraphPayload }
  | { command: 'graph:resourceDetailResult'; data: ResourceDetail }
  | { command: 'graph:neighborhoodResult'; data: GraphPayload }
  | { command: 'graph:error'; message: string }
  | { command: 'graph:clear' }

// ── Webview → Extension Host (user interactions) ─────────

export type GraphViewRequest =
  | { command: 'graph:requestDetail'; uri: string }
  | { command: 'graph:expandNeighborhood'; uri: string; limit?: number }
  | { command: 'graph:exportPng' }

// ── Data Shapes ──────────────────────────────────────────

export interface RdfNode {
  uri: string
  label: string
  type: string
  types: string[]
}

export interface RdfEdge {
  id: string
  sourceUri: string
  targetUri: string
  predicate: string
  predicateLabel: string
}

export interface GraphPayload {
  nodes: RdfNode[]
  edges: RdfEdge[]
  queryType: 'construct' | 'select'
  tripleCount: number
}

export interface PropertyValue {
  predicate: string
  predicateLabel: string
  value: string
  valueType: 'uri' | 'literal'
  language?: string
  datatype?: string
}

export interface ResourceDetail {
  uri: string
  label: string
  types: string[]
  properties: PropertyValue[]
  incomingCount: number
  outgoingCount: number
}
```

**Notice the asymmetry:** the Extension Host *pushes* graph results (triggered by query execution). The webview only *requests* data when the user clicks a node (detail) or double-clicks (expand). This is the same push pattern the existing `ResultsPanel` uses.

---

## 6. Extension Host — Implementation

### 6.1 New Files

```
src/
├── graph/
│   ├── GraphViewProvider.ts          # WebviewViewProvider for bottom panel tab
│   ├── GraphResultTransformer.ts     # CONSTRUCT/SELECT → nodes + edges
│   ├── GraphExplorerService.ts       # Neighborhood expansion, resource detail queries
│   └── sparqlQueries.ts              # SPARQL query templates
```

### 6.2 Registering the Bottom Panel Tab

In VS Code, a **bottom panel webview** requires a `WebviewViewProvider` registered to a view declared inside a panel-area `viewContainer`.

**`package.json` contributions:**

```jsonc
{
  "contributes": {
    "viewsContainers": {
      "panel": [
        {
          "id": "graphWhispererPanel",
          "title": "Graph Whisperer",
          "icon": "resources/graph-icon.svg"
        }
      ]
    },
    "views": {
      "graphWhispererPanel": [
        {
          "id": "graphWhisperer.graphView",
          "name": "Graph",
          "type": "webview",
          "visibility": "visible"
        }
      ]
    },
    "commands": [
      {
        "command": "graphWhisperer.showGraphView",
        "title": "Show Graph View",
        "category": "Graph Whisperer",
        "icon": "$(type-hierarchy)"
      }
    ]
  }
}
```

This places a **"Graph"** tab in a "Graph Whisperer" section of the bottom panel. The user sees it next to Terminal, Problems, Output, etc.

### 6.3 `GraphViewProvider` (WebviewViewProvider)

```typescript
// src/graph/GraphViewProvider.ts

import * as vscode from 'vscode'
import { GraphExplorerService } from './GraphExplorerService'
import type { GraphViewMessage, GraphViewRequest, GraphPayload }
  from '../shared/graphViewMessages'

export class GraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'graphWhisperer.graphView'
  private view?: vscode.WebviewView
  private service: GraphExplorerService

  constructor(
    private readonly extensionUri: vscode.Uri,
    service: GraphExplorerService
  ) {
    this.service = service
  }

  // ── Called by VS Code when the view tab becomes visible ──
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist'),
      ],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    // ── Handle messages FROM the webview ──────────────
    webviewView.webview.onDidReceiveMessage(
      async (msg: GraphViewRequest) => {
        try {
          switch (msg.command) {
            case 'graph:requestDetail': {
              const data = await this.service.getResourceDetail(msg.uri)
              this.postMessage({
                command: 'graph:resourceDetailResult', data
              })
              break
            }
            case 'graph:expandNeighborhood': {
              const data = await this.service.getNeighborhood(
                msg.uri, 1, msg.limit ?? 50
              )
              this.postMessage({
                command: 'graph:neighborhoodResult', data
              })
              break
            }
            case 'graph:exportPng': {
              // Handled in webview via cy.png(), then sent back
              break
            }
          }
        } catch (err: any) {
          this.postMessage({
            command: 'graph:error',
            message: err.message || 'Query failed',
          })
        }
      }
    )
  }

  // ── Public: called by query execution pipeline ─────
  public showGraphResults(payload: GraphPayload) {
    // Reveal the Graph tab in the bottom panel
    if (this.view) {
      this.view.show(true)   // true = preserveFocus (don't steal from editor)
      this.postMessage({ command: 'graph:showResults', data: payload })
    }
  }

  public clear() {
    this.postMessage({ command: 'graph:clear' })
  }

  private postMessage(msg: GraphViewMessage) {
    this.view?.webview.postMessage(msg)
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'graphView.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'graphView.css')
    )
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Graph View</title>
</head>
<body>
  <div id="graph-view-root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('')
}
```

### 6.4 Hooking Into the Query Execution Pipeline

The key integration point: when the user runs a SPARQL query, the existing execution pipeline already sends results to `ResultsPanel`. Now it also sends graph data to `GraphViewProvider`.

```typescript
// In the existing query execution handler (e.g. src/commands/executeQuery.ts)

import { GraphResultTransformer } from '../graph/GraphResultTransformer'

// After query execution, alongside existing ResultsPanel update:

if (queryType === 'CONSTRUCT') {
  const graphData = GraphResultTransformer.fromConstruct(triples)
  graphViewProvider.showGraphResults({
    ...graphData,
    queryType: 'construct',
    tripleCount: triples.length,
  })
  // Auto-focus the Graph tab for CONSTRUCT queries
}

if (queryType === 'SELECT') {
  // Existing: send to ResultsPanel for table view
  resultsPanel.showResults(bindings)

  // New: also attempt graph transformation
  const pattern = detectGraphPattern(bindings)
  if (pattern !== 'manual') {
    const graphData = GraphResultTransformer.fromSelect(bindings, pattern)
    graphViewProvider.showGraphResults({
      ...graphData,
      queryType: 'select',
      tripleCount: bindings.length,
    })
  }
}
```

### 6.5 Extension Activation

```typescript
// In src/extension.ts — add to existing activate()

const graphExplorerService = new GraphExplorerService(sparqlClient)
const graphViewProvider = new GraphViewProvider(
  context.extensionUri,
  graphExplorerService
)

// Register the bottom panel webview view
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    GraphViewProvider.viewType,
    graphViewProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  )
)

// Command to manually focus the Graph tab
context.subscriptions.push(
  vscode.commands.registerCommand('graphWhisperer.showGraphView', () => {
    vscode.commands.executeCommand('graphWhisperer.graphView.focus')
  })
)

// Make graphViewProvider available to the query execution pipeline
// (pass it to your command handlers or store on a shared context)
```

### 6.6 SPARQL Query Templates (for Expand & Detail)

These are used when the user interacts with the graph (click, double-click), not for the initial query execution.

#### Neighborhood Expansion (double-click a node)

```sparql
# Outgoing relationships from a resource
SELECT ?s ?sLabel ?sType ?p ?pLabel ?o ?oLabel ?oType WHERE {
  VALUES ?s { <${uri}> }
  ?s ?p ?o .
  FILTER(isIRI(?o))
  FILTER(?p != rdf:type)
  OPTIONAL { ?s rdfs:label ?sLabel }
  OPTIONAL { ?s a ?sType }
  OPTIONAL { ?p rdfs:label ?pLabel }
  OPTIONAL { ?o rdfs:label ?oLabel }
  OPTIONAL { ?o a ?oType }
}
LIMIT ${limit}
```

```sparql
# Incoming relationships to a resource
SELECT ?s ?sLabel ?sType ?p ?pLabel ?o ?oLabel ?oType WHERE {
  VALUES ?o { <${uri}> }
  ?s ?p ?o .
  FILTER(isIRI(?s))
  FILTER(?p != rdf:type)
  OPTIONAL { ?s rdfs:label ?sLabel }
  OPTIONAL { ?s a ?sType }
  OPTIONAL { ?p rdfs:label ?pLabel }
  OPTIONAL { ?o rdfs:label ?oLabel }
  OPTIONAL { ?o a ?oType }
}
LIMIT ${limit}
```

#### Resource Detail (single-click a node)

```sparql
SELECT ?predicate ?predicateLabel ?value WHERE {
  <${uri}> ?predicate ?value .
  OPTIONAL { ?predicate rdfs:label ?predicateLabel }
}
```

---

## 7. React Webview — Cytoscape.js in the Bottom Panel

### 7.1 Installation (in `webview-ui/`)

```bash
cd webview-ui
npm install cytoscape cytoscape-cose-bilkent
npm install -D @types/cytoscape
```

### 7.2 Vite Entry Point

Add a separate entry for the graph view:

```typescript
// webview-ui/src/graphView/main.tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { GraphViewApp } from './GraphViewApp'

const root = createRoot(document.getElementById('graph-view-root')!)
root.render(<GraphViewApp />)
```

**Vite config** — add a second entry in `vite.config.ts`:

```typescript
build: {
  rollupOptions: {
    input: {
      resultsPanel: 'src/resultsPanel/main.tsx',    // existing
      graphView: 'src/graphView/main.tsx',           // new
    },
    output: {
      entryFileNames: '[name].js',
      assetFileNames: '[name].[ext]',
    },
  },
}
```

### 7.3 VS Code API Bridge

```typescript
// webview-ui/src/graphView/vscodeApi.ts
import type { GraphViewRequest, GraphViewMessage }
  from '../../../src/shared/graphViewMessages'

const vscode = acquireVsCodeApi()

export function postRequest(msg: GraphViewRequest) {
  vscode.postMessage(msg)
}

export function onMessage(cb: (msg: GraphViewMessage) => void): () => void {
  const handler = (event: MessageEvent) => cb(event.data)
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
```

### 7.4 Graph State Reducer

```typescript
// webview-ui/src/graphView/graphReducer.ts
import type { RdfNode, RdfEdge, ResourceDetail } from '...'

export interface GraphState {
  nodes: Map<string, RdfNode>
  edges: Map<string, RdfEdge>
  selectedUri: string | null
  selectedDetail: ResourceDetail | null
  queryType: 'construct' | 'select' | null
  tripleCount: number
  isLoading: boolean
  error: string | null
}

export const initialState: GraphState = {
  nodes: new Map(),
  edges: new Map(),
  selectedUri: null,
  selectedDetail: null,
  queryType: null,
  tripleCount: 0,
  isLoading: false,
  error: null,
}

export type GraphAction =
  | { type: 'SHOW_RESULTS'; nodes: RdfNode[]; edges: RdfEdge[];
      queryType: 'construct' | 'select'; tripleCount: number }
  | { type: 'MERGE_NEIGHBORHOOD'; nodes: RdfNode[]; edges: RdfEdge[] }
  | { type: 'SELECT_RESOURCE'; uri: string; detail: ResourceDetail }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_GRAPH' }

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case 'SHOW_RESULTS': {
      // Replace entire graph with new query results
      const nodes = new Map<string, RdfNode>()
      const edges = new Map<string, RdfEdge>()
      action.nodes.forEach(n => nodes.set(n.uri, n))
      action.edges.forEach(e => edges.set(e.id, e))
      return {
        ...state, nodes, edges,
        queryType: action.queryType,
        tripleCount: action.tripleCount,
        selectedUri: null, selectedDetail: null,
        isLoading: false, error: null,
      }
    }
    case 'MERGE_NEIGHBORHOOD': {
      // Add to existing graph (expand)
      const nodes = new Map(state.nodes)
      const edges = new Map(state.edges)
      action.nodes.forEach(n => nodes.set(n.uri, n))
      action.edges.forEach(e => edges.set(e.id, e))
      return { ...state, nodes, edges, isLoading: false }
    }
    case 'SELECT_RESOURCE':
      return { ...state, selectedUri: action.uri, selectedDetail: action.detail }
    case 'CLEAR_SELECTION':
      return { ...state, selectedUri: null, selectedDetail: null }
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading, error: null }
    case 'SET_ERROR':
      return { ...state, error: action.message, isLoading: false }
    case 'CLEAR_GRAPH':
      return { ...initialState }
    default:
      return state
  }
}
```

### 7.5 Cytoscape React Hook

```typescript
// webview-ui/src/graphView/useCytoscape.ts
import { useRef, useEffect, useCallback } from 'react'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import coseBilkent from 'cytoscape-cose-bilkent'

cytoscape.use(coseBilkent)

interface UseCytoscapeProps {
  containerRef: React.RefObject<HTMLDivElement>
  onNodeSelect: (uri: string) => void
  onNodeExpand: (uri: string) => void
}

export function useCytoscape(
  { containerRef, onNodeSelect, onNodeExpand }: UseCytoscapeProps
) {
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'background-color': 'data(color)',
            'width': 'mapData(degree, 1, 10, 30, 70)',
            'height': 'mapData(degree, 1, 10, 30, 70)',
            'font-size': '11px',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            // VS Code theme-aware colors
            'color': 'var(--vscode-foreground)',
            'text-outline-color': 'var(--vscode-panel-background)',
            'text-outline-width': 2,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': 'var(--vscode-editorWidget-border)',
            'target-arrow-color': 'var(--vscode-editorWidget-border)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(predicateLabel)',
            'font-size': '9px',
            'text-rotation': 'autorotate',
            'color': 'var(--vscode-descriptionForeground)',
          },
        },
        {
          selector: ':selected',
          style: {
            'border-width': 3,
            'border-color': 'var(--vscode-focusBorder)',
          },
        },
      ],
      layout: { name: 'cose-bilkent', animate: 'end', animationDuration: 500 },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    })

    cy.on('tap', 'node', (evt) => onNodeSelect(evt.target.id()))
    cy.on('dbltap', 'node', (evt) => onNodeExpand(evt.target.id()))
    cy.on('tap', (evt) => { if (evt.target === cy) onNodeSelect('') })

    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [containerRef])

  const setElements = useCallback((elements: ElementDefinition[]) => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().remove()
    cy.add(elements)
    cy.layout({
      name: 'cose-bilkent', animate: 'end', animationDuration: 500, fit: true,
    }).run()
  }, [])

  const addElements = useCallback((elements: ElementDefinition[]) => {
    const cy = cyRef.current
    if (!cy) return
    const newEls = elements.filter(el => !cy.getElementById(el.data.id).length)
    if (!newEls.length) return
    cy.add(newEls)
    cy.layout({
      name: 'cose-bilkent', animate: 'end', animationDuration: 500, fit: false,
    }).run()
  }, [])

  const focusNode = useCallback((uri: string) => {
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(uri)
    if (node.length) {
      cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 400 })
      node.select()
    }
  }, [])

  const fitView = useCallback(() => cyRef.current?.fit(undefined, 50), [])

  return { setElements, addElements, focusNode, fitView, cyRef }
}
```

### 7.6 Main App Component

```tsx
// webview-ui/src/graphView/GraphViewApp.tsx
import React, { useReducer, useRef, useEffect, useCallback, useMemo } from 'react'
import { graphReducer, initialState } from './graphReducer'
import { useCytoscape } from './useCytoscape'
import { toElements } from './transformElements'
import { postRequest, onMessage } from './vscodeApi'
import { Toolbar } from './components/Toolbar'
import { DetailDrawer } from './components/DetailDrawer'
import { EmptyState } from './components/EmptyState'

export function GraphViewApp() {
  const [state, dispatch] = useReducer(graphReducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleNodeSelect = useCallback((uri: string) => {
    if (!uri) { dispatch({ type: 'CLEAR_SELECTION' }); return }
    dispatch({ type: 'SET_LOADING', loading: true })
    postRequest({ command: 'graph:requestDetail', uri })
  }, [])

  const handleNodeExpand = useCallback((uri: string) => {
    dispatch({ type: 'SET_LOADING', loading: true })
    postRequest({ command: 'graph:expandNeighborhood', uri, limit: 50 })
  }, [])

  const { setElements, addElements, focusNode, fitView } =
    useCytoscape({ containerRef, onNodeSelect: handleNodeSelect, onNodeExpand: handleNodeExpand })

  // ── Listen for messages from Extension Host ────────
  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.command) {
        case 'graph:showResults':
          dispatch({
            type: 'SHOW_RESULTS',
            nodes: msg.data.nodes,
            edges: msg.data.edges,
            queryType: msg.data.queryType,
            tripleCount: msg.data.tripleCount,
          })
          break
        case 'graph:neighborhoodResult':
          dispatch({
            type: 'MERGE_NEIGHBORHOOD',
            nodes: msg.data.nodes,
            edges: msg.data.edges,
          })
          break
        case 'graph:resourceDetailResult':
          dispatch({
            type: 'SELECT_RESOURCE',
            uri: msg.data.uri,
            detail: msg.data,
          })
          break
        case 'graph:clear':
          dispatch({ type: 'CLEAR_GRAPH' })
          break
        case 'graph:error':
          dispatch({ type: 'SET_ERROR', message: msg.message })
          break
      }
    })
  }, [])

  // ── Sync state → Cytoscape ─────────────────────────
  const elements = useMemo(
    () => toElements(state.nodes, state.edges),
    [state.nodes, state.edges]
  )

  // SHOW_RESULTS replaces, MERGE_NEIGHBORHOOD adds
  const prevActionRef = useRef<string>('')
  useEffect(() => {
    if (state.nodes.size === 0) return
    // Always do a full setElements (the reducer already merged)
    setElements(elements)
  }, [elements])

  const hasGraph = state.nodes.size > 0

  return (
    <div className="graph-view">
      {hasGraph && (
        <Toolbar
          nodeCount={state.nodes.size}
          edgeCount={state.edges.size}
          queryType={state.queryType}
          tripleCount={state.tripleCount}
          onFit={fitView}
          onClear={() => dispatch({ type: 'CLEAR_GRAPH' })}
        />
      )}

      {!hasGraph && <EmptyState />}

      <div
        ref={containerRef}
        className="graph-canvas"
        style={{ display: hasGraph ? 'block' : 'none' }}
      />

      {state.selectedDetail && (
        <DetailDrawer
          detail={state.selectedDetail}
          onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
          onNavigate={(uri) => {
            handleNodeExpand(uri)
            setTimeout(() => focusNode(uri), 600)
          }}
        />
      )}
    </div>
  )
}
```

### 7.7 Empty State Component

When no query has been run yet:

```tsx
// webview-ui/src/graphView/components/EmptyState.tsx
export function EmptyState() {
  return (
    <div className="empty-state">
      <span className="codicon codicon-type-hierarchy" />
      <p>Run a SPARQL <code>CONSTRUCT</code> query to visualize results as a graph.</p>
      <p className="hint">
        <code>SELECT</code> queries with <code>?s ?p ?o</code> columns
        will also render automatically.
      </p>
    </div>
  )
}
```

### 7.8 CSS (theme-aware)

```css
/* webview-ui/src/graphView/graphView.css */

.graph-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--vscode-panel-background);
  color: var(--vscode-foreground);
  overflow: hidden;
}

.graph-canvas {
  flex: 1;
  min-height: 0;  /* critical for Cytoscape sizing */
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.toolbar button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  padding: 2px 8px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
}

.detail-drawer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 300px;
  background: var(--vscode-sideBar-background);
  border-left: 1px solid var(--vscode-panel-border);
  overflow-y: auto;
  padding: 12px;
  font-size: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  gap: 8px;
}

.empty-state .codicon {
  font-size: 48px;
  opacity: 0.3;
}
```

---

## 8. User Interaction Flow

```
User writes a SPARQL query in the editor:
  CONSTRUCT { ?s ?p ?o }
  WHERE { ?s a ex:Person . ?s ?p ?o }

User clicks ▶ Run Query (or Ctrl+Enter)
        │
        ▼
Extension Host executes via SparqlClient
        │
        ├──▶ ResultsPanel.showResults()      (existing: table/JSON view)
        │
        └──▶ GraphResultTransformer
                .fromConstruct(triples)
                    │
                    ▼
             GraphViewProvider
                .showGraphResults(payload)
                    │
                    ▼  postMessage
             Graph View tab auto-reveals in bottom panel
             Cytoscape renders force-directed graph
             Toolbar shows: "47 nodes · 83 edges · CONSTRUCT"

User drags panel divider up for more space
  (or clicks maximize ⬜ icon for full-height view)

User single-clicks a node (ex:JohnDoe)
        │
        ▼  postMessage to Extension Host
    { command: 'graph:requestDetail', uri: 'ex:JohnDoe' }
        │
    Extension Host runs SPARQL detail query
        │
        ▼  postMessage to Webview
    Detail drawer slides in from right:
      URI: ex:JohnDoe
      Types: ex:Person
      Properties:
        ex:name → "John Doe"
        ex:age  → 34
        ex:worksAt → ex:Acme  (clickable → navigate)

User double-clicks a node (ex:Acme)
        │
        ▼  postMessage to Extension Host
    { command: 'graph:expandNeighborhood', uri: 'ex:Acme' }
        │
    Extension Host runs outgoing + incoming SPARQL
        │
        ▼  postMessage to Webview
    New nodes/edges merge into existing graph
    Layout re-runs incrementally (fit: false)
```

---

## 9. Key Implementation Notes

### Bottom Panel vs. Editor Panel

`WebviewViewProvider` (used here) places the view in the bottom/side panel areas. This is different from `createWebviewPanel()` which places a tab in the editor area. The `WebviewViewProvider` approach is correct for a "results-like" view that complements the editor.

### `retainContextWhenHidden: true`

Passed in the `registerWebviewViewProvider` options. Without it, switching to the Terminal tab and back destroys and re-creates the webview (and the entire Cytoscape canvas). This option keeps it alive in the background.

### VS Code Theme Integration

Cytoscape supports CSS custom properties. Using `var(--vscode-panel-background)`, `var(--vscode-foreground)`, etc. makes the graph adapt to light, dark, and high-contrast themes automatically.

### Resize Handling

When the user drags the panel divider, the Cytoscape container resizes. Cytoscape does not auto-detect container size changes. Add a `ResizeObserver` on the container div:

```typescript
useEffect(() => {
  if (!containerRef.current || !cyRef.current) return
  const observer = new ResizeObserver(() => {
    cyRef.current?.resize()
    cyRef.current?.fit(undefined, 30)
  })
  observer.observe(containerRef.current)
  return () => observer.disconnect()
}, [])
```

### Content Security Policy

The CSP must allow `'unsafe-inline'` for styles (Cytoscape injects inline styles) and a `nonce` for scripts. This is handled in `GraphViewProvider.getHtml()`.

### URI as Node ID

Full URIs are used as Cytoscape node IDs, making deduplication trivial across query results and neighborhood expansions.

### Label Fallback

Not all resources have `rdfs:label`. The transformer extracts the local name (fragment after `#` or last path segment) as fallback.

---

## 10. MCP Server Extension (Optional)

Expose graph visualization triggers to external AI agents:

```typescript
{
  name: 'sparql_explore_neighborhood',
  description: 'Get the 1-hop neighborhood of an RDF resource',
  parameters: { uri: 'string', limit: 'number' },
  handler: (params) => graphExplorerService.getNeighborhood(params.uri, 1, params.limit)
}
```

---

## 11. Development Phases

### Phase 1 — Pipeline & Panel (Week 1)

- Register `GraphViewProvider` as a `WebviewViewProvider` in `package.json` and `extension.ts`.
- Build `GraphResultTransformer` with `fromConstruct()` for triple-to-graph conversion.
- Hook into the existing query execution pipeline to push results to the Graph View.
- Scaffold the React webview entry point with an empty state.

### Phase 2 — Cytoscape Rendering (Weeks 2–3)

- Install Cytoscape.js + cose-bilkent in `webview-ui/`.
- Build `useCytoscape` hook, state reducer, and transform utility.
- Build `GraphViewApp` with canvas, toolbar, and detail drawer.
- Wire `postMessage` end-to-end: query execution → graph render.
- Test with real `CONSTRUCT` queries against GraphDB.

### Phase 3 — SELECT Support & Interactivity (Week 4)

- Implement `detectGraphPattern()` for SELECT result heuristic mapping.
- Add column-mapping UI fallback for non-standard SELECT results.
- Double-click-to-expand with incremental layout.
- Single-click detail drawer with property list and clickable URI navigation.
- `ResizeObserver` for panel resize handling.

### Phase 4 — Polish & Theme (Week 5)

- VS Code theme-aware styling (CSS variables throughout).
- RDF type-based node coloring.
- Graph controls: fit view, re-layout, clear, export PNG.
- Loading/error states.
- Keyboard shortcuts.
- Toolbar showing stats (node count, edge count, query type).

### Phase 5 — Advanced Features (Week 6+)

- "Show as Graph" button in the existing Results Table for any SELECT query.
- Right-click → "Explore in Graph" on URIs in result tables.
- Click class in Ontology Explorer sidebar → visualize instances in Graph View.
- Graph filtering panel: toggle RDF types and predicates on/off.
- Export as Turtle/JSON-LD.
- MCP tools for AI agent graph exploration.

---

## 12. Package Summary

```
webview-ui/ (npm):
  cytoscape               ^3.30
  cytoscape-cose-bilkent   ^4.1
  @types/cytoscape         (devDep)

src/ (Extension Host — existing deps):
  sparql-http-client       existing
  sparqljs                 existing
  vscode                   existing
```

No new Extension Host dependencies needed.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Cytoscape canvas renders at 0×0 in bottom panel | Set `flex: 1; min-height: 0` on container; add `ResizeObserver` calling `cy.resize()`. |
| Large CONSTRUCT results crash webview | Cap rendering at ~500 nodes; show warning + "Show first N triples" for larger results. |
| Webview loses state when user switches panel tabs | Use `retainContextWhenHidden: true` in `registerWebviewViewProvider`. |
| SELECT queries don't have obvious graph structure | Auto-detect `?s ?p ?o` pattern; fall back to column-mapping UI; keep table view as default for SELECT. |
| Theme mismatch (dark/light) | Use `var(--vscode-*)` CSS variables exclusively in Cytoscape styles and all webview CSS. |
| Panel resize doesn't trigger Cytoscape redraw | `ResizeObserver` on the container div calls `cy.resize()` + `cy.fit()`. |
| Resources without labels show raw URIs | Extract local name from URI; truncate long URIs with tooltip for full IRI. |
| CSP blocks Cytoscape rendering | Allow `'unsafe-inline'` for styles in the `<meta>` CSP tag. |
