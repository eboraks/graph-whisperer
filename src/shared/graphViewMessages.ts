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
  | { command: 'webview:ready' }

// ── Data Shapes ──────────────────────────────────────────

export interface RdfNode {
  uri: string
  label: string
  type: string
  types: string[]
  properties?: PropertyValue[]
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
