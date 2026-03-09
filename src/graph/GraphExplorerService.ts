import SparqlClient from 'sparql-http-client';
import type { RdfNode, RdfEdge, GraphPayload, ResourceDetail, PropertyValue } from '../shared/graphViewMessages';

function localName(uri: string): string {
    const hashIdx = uri.lastIndexOf('#');
    if (hashIdx >= 0) { return uri.substring(hashIdx + 1); }
    const slashIdx = uri.lastIndexOf('/');
    if (slashIdx >= 0) { return uri.substring(slashIdx + 1); }
    return uri;
}

export class GraphExplorerService {
    constructor(private client: SparqlClient) {}

    public updateClient(client: SparqlClient) {
        this.client = client;
    }

    /**
     * Get 1-hop neighborhood of a resource (outgoing + incoming edges)
     */
    async getNeighborhood(uri: string, _depth: number = 1, limit: number = 50): Promise<GraphPayload> {
        const outgoingQuery = `
            SELECT ?s ?p ?o ?oLabel ?oType WHERE {
                VALUES ?s { <${uri}> }
                ?s ?p ?o .
                FILTER(isIRI(?o))
                FILTER(?p != <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>)
                OPTIONAL { ?o <http://www.w3.org/2000/01/rdf-schema#label> ?oLabel }
                OPTIONAL { ?o a ?oType }
            }
            LIMIT ${limit}
        `;

        const incomingQuery = `
            SELECT ?s ?p ?o ?sLabel ?sType WHERE {
                VALUES ?o { <${uri}> }
                ?s ?p ?o .
                FILTER(isIRI(?s))
                FILTER(?p != <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>)
                OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?sLabel }
                OPTIONAL { ?s a ?sType }
            }
            LIMIT ${limit}
        `;

        const nodeMap = new Map<string, RdfNode>();
        const edges: RdfEdge[] = [];

        // Ensure the center node exists
        nodeMap.set(uri, {
            uri,
            label: localName(uri),
            type: 'Resource',
            types: [],
        });

        // Process outgoing
        const outStream = await this.client.query.select(outgoingQuery);
        await new Promise<void>((resolve, reject) => {
            outStream.on('data', (row: any) => {
                const o = row.o.value;
                const p = row.p.value;
                if (!nodeMap.has(o)) {
                    nodeMap.set(o, {
                        uri: o,
                        label: row.oLabel?.value || localName(o),
                        type: row.oType?.value ? localName(row.oType.value) : 'Resource',
                        types: row.oType?.value ? [row.oType.value] : [],
                    });
                }
                edges.push({
                    id: `${uri}--${p}--${o}`,
                    sourceUri: uri,
                    targetUri: o,
                    predicate: p,
                    predicateLabel: localName(p),
                });
            });
            outStream.on('end', resolve);
            outStream.on('error', reject);
        });

        // Process incoming
        const inStream = await this.client.query.select(incomingQuery);
        await new Promise<void>((resolve, reject) => {
            inStream.on('data', (row: any) => {
                const s = row.s.value;
                const p = row.p.value;
                if (!nodeMap.has(s)) {
                    nodeMap.set(s, {
                        uri: s,
                        label: row.sLabel?.value || localName(s),
                        type: row.sType?.value ? localName(row.sType.value) : 'Resource',
                        types: row.sType?.value ? [row.sType.value] : [],
                    });
                }
                edges.push({
                    id: `${s}--${p}--${uri}`,
                    sourceUri: s,
                    targetUri: uri,
                    predicate: p,
                    predicateLabel: localName(p),
                });
            });
            inStream.on('end', resolve);
            inStream.on('error', reject);
        });

        return {
            nodes: Array.from(nodeMap.values()),
            edges,
            queryType: 'construct',
            tripleCount: edges.length,
        };
    }

    /**
     * Get detailed properties of a resource
     */
    async getResourceDetail(uri: string): Promise<ResourceDetail> {
        const query = `
            SELECT ?predicate ?value WHERE {
                <${uri}> ?predicate ?value .
            }
        `;

        const properties: PropertyValue[] = [];
        const types: string[] = [];
        let label = localName(uri);

        const stream = await this.client.query.select(query);
        await new Promise<void>((resolve, reject) => {
            stream.on('data', (row: any) => {
                const pred = row.predicate.value;
                const val = row.value.value;
                const isUri = row.value.termType === 'NamedNode';

                if (pred === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
                    types.push(val);
                } else {
                    properties.push({
                        predicate: pred,
                        predicateLabel: localName(pred),
                        value: val,
                        valueType: isUri ? 'uri' : 'literal',
                        language: row.value.language || undefined,
                        datatype: row.value.datatype?.value || undefined,
                    });

                    // Extract label
                    if (pred === 'http://www.w3.org/2000/01/rdf-schema#label' ||
                        pred === 'http://schema.org/name' ||
                        pred === 'http://xmlns.com/foaf/0.1/name') {
                        label = val;
                    }
                }
            });
            stream.on('end', resolve);
            stream.on('error', reject);
        });

        // Count connections
        const countQuery = `
            SELECT
                (COUNT(DISTINCT ?out) AS ?outgoing)
                (COUNT(DISTINCT ?in) AS ?incoming)
            WHERE {
                { <${uri}> ?p1 ?out . FILTER(isIRI(?out)) }
                UNION
                { ?in ?p2 <${uri}> . FILTER(isIRI(?in)) }
            }
        `;

        let outgoingCount = 0;
        let incomingCount = 0;

        try {
            const countStream = await this.client.query.select(countQuery);
            await new Promise<void>((resolve, reject) => {
                countStream.on('data', (row: any) => {
                    outgoingCount = parseInt(row.outgoing?.value || '0', 10);
                    incomingCount = parseInt(row.incoming?.value || '0', 10);
                });
                countStream.on('end', resolve);
                countStream.on('error', reject);
            });
        } catch {
            // Non-critical, ignore counting errors
        }

        return {
            uri,
            label,
            types,
            properties,
            incomingCount,
            outgoingCount,
        };
    }
}
