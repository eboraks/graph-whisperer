export interface RdfNode {
  uri: string;
  label: string;
  type: string;
  types: string[];
  properties?: PropertyValue[];
}

export interface RdfEdge {
  id: string;
  sourceUri: string;
  targetUri: string;
  predicate: string;
  predicateLabel: string;
}

export interface PropertyValue {
  predicate: string;
  predicateLabel: string;
  value: string;
  valueType: 'uri' | 'literal';
  language?: string;
  datatype?: string;
}

export interface ResourceDetail {
  uri: string;
  label: string;
  types: string[];
  properties: PropertyValue[];
  incomingCount: number;
  outgoingCount: number;
}

export interface GraphState {
  nodes: Map<string, RdfNode>;
  edges: Map<string, RdfEdge>;
  selectedUri: string | null;
  selectedDetail: ResourceDetail | null;
  queryType: 'construct' | 'select' | null;
  tripleCount: number;
  isLoading: boolean;
  error: string | null;
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
};

export type GraphAction =
  | { type: 'SHOW_RESULTS'; nodes: RdfNode[]; edges: RdfEdge[];
      queryType: 'construct' | 'select'; tripleCount: number }
  | { type: 'MERGE_NEIGHBORHOOD'; nodes: RdfNode[]; edges: RdfEdge[] }
  | { type: 'SELECT_RESOURCE'; uri: string; detail: ResourceDetail }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_GRAPH' };

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case 'SHOW_RESULTS': {
      const nodes = new Map<string, RdfNode>();
      const edges = new Map<string, RdfEdge>();
      action.nodes.forEach(n => nodes.set(n.uri, n));
      action.edges.forEach(e => edges.set(e.id, e));
      return {
        ...state, nodes, edges,
        queryType: action.queryType,
        tripleCount: action.tripleCount,
        selectedUri: null, selectedDetail: null,
        isLoading: false, error: null,
      };
    }
    case 'MERGE_NEIGHBORHOOD': {
      const nodes = new Map(state.nodes);
      const edges = new Map(state.edges);
      action.nodes.forEach(n => nodes.set(n.uri, n));
      action.edges.forEach(e => edges.set(e.id, e));
      return { ...state, nodes, edges, isLoading: false };
    }
    case 'SELECT_RESOURCE':
      return { ...state, selectedUri: action.uri, selectedDetail: action.detail, isLoading: false };
    case 'CLEAR_SELECTION':
      return { ...state, selectedUri: null, selectedDetail: null };
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.message, isLoading: false };
    case 'CLEAR_GRAPH':
      return { ...initialState };
    default:
      return state;
  }
}
