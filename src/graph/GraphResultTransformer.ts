import type { RdfNode, RdfEdge, GraphPayload } from '../shared/graphViewMessages';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function localName(uri: string): string {
    const hashIdx = uri.lastIndexOf('#');
    if (hashIdx >= 0) { return uri.substring(hashIdx + 1); }
    const slashIdx = uri.lastIndexOf('/');
    if (slashIdx >= 0) { return uri.substring(slashIdx + 1); }
    return uri;
}

export interface Triple {
    subject: string;
    predicate: string;
    object: string;
    objectType?: 'NamedNode' | 'Literal' | 'BlankNode';
}

export class GraphResultTransformer {

    /**
     * Transform CONSTRUCT/DESCRIBE results (array of quads with .value properties)
     * into graph data. The raw quads come from sparql-http-client stream.
     */
    static fromConstruct(rawTriples: Array<{
        subject: string;
        predicate: string;
        object: string;
        graph?: string;
    }>): { nodes: RdfNode[]; edges: RdfEdge[] } {
        const nodeMap = new Map<string, RdfNode>();
        const edges: RdfEdge[] = [];
        const literalProperties = new Map<string, Array<{ predicate: string; value: string }>>();

        for (const triple of rawTriples) {
            const s = triple.subject;
            const p = triple.predicate;
            const o = triple.object;

            // Subject is always a node
            if (!nodeMap.has(s)) {
                nodeMap.set(s, {
                    uri: s,
                    label: localName(s),
                    type: 'Resource',
                    types: [],
                    properties: [],
                });
            }

            // Heuristic: if the object looks like a URI (starts with http:// or urn:)
            const isObjectUri = o.startsWith('http://') || o.startsWith('https://') || o.startsWith('urn:');

            if (isObjectUri) {
                if (p === RDF_TYPE) {
                    // Enrich node type, don't create edge
                    const node = nodeMap.get(s)!;
                    node.types.push(o);
                    node.type = localName(o);
                } else {
                    // Object is a URI → it's a node, predicate is an edge
                    if (!nodeMap.has(o)) {
                        nodeMap.set(o, {
                            uri: o,
                            label: localName(o),
                            type: 'Resource',
                            types: [],
                            properties: [],
                        });
                    }
                    edges.push({
                        id: `${s}--${p}--${o}`,
                        sourceUri: s,
                        targetUri: o,
                        predicate: p,
                        predicateLabel: localName(p),
                    });
                }
            } else {
                // Literal → store as property on the subject node
                if (!literalProperties.has(s)) {
                    literalProperties.set(s, []);
                }
                literalProperties.get(s)!.push({ predicate: p, value: o });
            }
        }

        // Attach literal properties to nodes
        for (const [uri, props] of literalProperties) {
            const node = nodeMap.get(uri);
            if (node) {
                node.properties = props.map(p => ({
                    predicate: p.predicate,
                    predicateLabel: localName(p.predicate),
                    value: p.value,
                    valueType: 'literal' as const,
                }));
                // Use rdfs:label or similar as the node label if available
                const labelProp = props.find(p =>
                    p.predicate === 'http://www.w3.org/2000/01/rdf-schema#label' ||
                    p.predicate === 'http://schema.org/name' ||
                    p.predicate === 'http://xmlns.com/foaf/0.1/name'
                );
                if (labelProp) {
                    node.label = labelProp.value;
                }
            }
        }

        return { nodes: Array.from(nodeMap.values()), edges };
    }

    /**
     * Transform SELECT results with auto-detected graph pattern
     */
    static fromSelect(bindings: Array<Record<string, string>>, pattern: 'spo' | 'pair'): { nodes: RdfNode[]; edges: RdfEdge[] } {
        if (pattern === 'spo') {
            return this.fromSelectSpo(bindings);
        }
        return this.fromSelectPair(bindings);
    }

    private static fromSelectSpo(bindings: Array<Record<string, string>>): { nodes: RdfNode[]; edges: RdfEdge[] } {
        const vars = Object.keys(bindings[0] || {});
        const lower = vars.map(v => v.toLowerCase());

        const sVar = vars[lower.findIndex(v => ['s', 'subject', 'source'].includes(v))];
        const pVar = vars[lower.findIndex(v => ['p', 'predicate', 'property', 'rel'].includes(v))];
        const oVar = vars[lower.findIndex(v => ['o', 'object', 'target'].includes(v))];

        // Convert to triples format and reuse fromConstruct
        const triples = bindings.map(row => ({
            subject: row[sVar],
            predicate: row[pVar],
            object: row[oVar],
        }));

        return this.fromConstruct(triples);
    }

    private static fromSelectPair(bindings: Array<Record<string, string>>): { nodes: RdfNode[]; edges: RdfEdge[] } {
        const vars = Object.keys(bindings[0] || {});
        // Find columns that look like URIs
        const uriCols = vars.filter(v => {
            const val = bindings[0][v];
            return val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('urn:'));
        });

        if (uriCols.length < 2) {
            return { nodes: [], edges: [] };
        }

        const sourceCol = uriCols[0];
        const targetCol = uriCols[1];
        // Use a third column as the relationship label if available
        const labelCol = vars.find(v => !uriCols.includes(v));

        const nodeMap = new Map<string, RdfNode>();
        const edges: RdfEdge[] = [];

        for (const row of bindings) {
            const s = row[sourceCol];
            const o = row[targetCol];
            const p = labelCol ? row[labelCol] : 'related';

            if (!s || !o) { continue; }

            if (!nodeMap.has(s)) {
                nodeMap.set(s, { uri: s, label: localName(s), type: 'Resource', types: [] });
            }
            if (!nodeMap.has(o)) {
                nodeMap.set(o, { uri: o, label: localName(o), type: 'Resource', types: [] });
            }
            edges.push({
                id: `${s}--${p}--${o}`,
                sourceUri: s,
                targetUri: o,
                predicate: p,
                predicateLabel: localName(p),
            });
        }

        return { nodes: Array.from(nodeMap.values()), edges };
    }
}

/**
 * Detect if SELECT bindings can be auto-mapped to a graph structure
 */
export function detectGraphPattern(bindings: Array<Record<string, string>>): 'spo' | 'pair' | 'manual' {
    if (bindings.length === 0) { return 'manual'; }
    const vars = Object.keys(bindings[0]);
    const lower = vars.map(v => v.toLowerCase());

    const hasS = lower.some(v => ['s', 'subject', 'source'].includes(v));
    const hasP = lower.some(v => ['p', 'predicate', 'property', 'rel'].includes(v));
    const hasO = lower.some(v => ['o', 'object', 'target'].includes(v));

    if (hasS && hasP && hasO) { return 'spo'; }

    // Check for at least two URI-valued columns
    const uriCols = vars.filter(v => {
        const val = bindings[0][v];
        return val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('urn:'));
    });
    if (uriCols.length >= 2) { return 'pair'; }

    return 'manual';
}
