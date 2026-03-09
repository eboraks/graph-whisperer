import type { RdfNode, RdfEdge } from './graphReducer';

// Simple hash for consistent colors based on type
function typeColor(type: string): string {
  const colors = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2',
    '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
    '#9c755f', '#bab0ac',
  ];
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = ((hash << 5) - hash + type.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export interface CytoscapeElement {
  group: 'nodes' | 'edges';
  data: Record<string, any>;
}

export function toElements(
  nodes: Map<string, RdfNode>,
  edges: Map<string, RdfEdge>
): CytoscapeElement[] {
  const elements: CytoscapeElement[] = [];

  for (const node of nodes.values()) {
    elements.push({
      group: 'nodes',
      data: {
        id: node.uri,
        label: node.label,
        type: node.type,
        color: typeColor(node.type),
      },
    });
  }

  for (const edge of edges.values()) {
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.sourceUri,
        target: edge.targetUri,
        predicate: edge.predicate,
        predicateLabel: edge.predicateLabel,
      },
    });
  }

  return elements;
}
