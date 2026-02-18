import * as vscode from 'vscode';
import SparqlClient from 'sparql-http-client';

export class OntologyProvider implements vscode.TreeDataProvider<OntologyItem>, vscode.TreeDragAndDropController<OntologyItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<OntologyItem | undefined | void> = new vscode.EventEmitter<OntologyItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<OntologyItem | undefined | void> = this._onDidChangeTreeData.event;
    
    // Drag & Drop
    dropMimeTypes = ['text/uri-list'];
    dragMimeTypes = ['text/uri-list', 'text/plain'];

    constructor(private client?: SparqlClient) {}
    
    handleDrag(source: readonly OntologyItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Promise<void> {
        if (source.length === 0) { return; }
        
        const uris = source.map(item => item.uri).filter(uri => !!uri).join('\r\n');
        // valid 'text/uri-list' causes VS Code to try opening the URI as a file. 
        // We ONLY want text insertion, so we remove 'text/uri-list'.
        dataTransfer.set('text/plain', new vscode.DataTransferItem(uris));
    }
    
    refresh(client?: SparqlClient): void {
        if (client) {
            this.client = client;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: OntologyItem): vscode.TreeItem {
        return element;
    }

    // Cache for client-side search
    private cache: Map<string, OntologyItem> = new Map();

    public getClasses(): OntologyItem[] {
        return Array.from(this.cache.values()).filter(i => i.type === 'class');
    }

    public getProperties(): OntologyItem[] {
        return Array.from(this.cache.values()).filter(i => i.type === 'property');
    }

    async getChildren(element?: OntologyItem): Promise<OntologyItem[]> {
        if (!this.client) {
             return [new OntologyItem('Not Connected', vscode.TreeItemCollapsibleState.None)];
        }

        // Return filtered results if search is active and we are at root
        if (!element && this.filterTerm) {
            const lowerTerm = this.filterTerm.toLowerCase();
            const matches: OntologyItem[] = [];
            
            // Search in cache
            for (const item of this.cache.values()) {
                if (item.label.toLowerCase().includes(lowerTerm)) {
                    matches.push(item);
                }
            }
            
            if (matches.length === 0) {
                return [new OntologyItem(`No results for "${this.filterTerm}"`, vscode.TreeItemCollapsibleState.None)];
            }
            
            return matches.sort((a, b) => a.label.localeCompare(b.label));
        }

        // Depth Check
        if (element && element.depth >= 3) {
            return [new OntologyItem('Max depth reached', vscode.TreeItemCollapsibleState.None)];
        }

        if (!element) {
            // Root: Get Classes (Level 0)
            try {
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

                const stream = await this.client.query.select(classQuery);
                const classes = await this.streamToArray(stream);

                if (classes.length === 0) {
                     return [new OntologyItem('No classes found', vscode.TreeItemCollapsibleState.None)];
                }

                const items = classes.map((row: any) => {
                    const uri = row.class.value;
                    const label = this.getLocalName(uri);
                    const item = new OntologyItem(
                        label,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'class',
                        uri,
                        0 
                    );
                    this.cache.set(uri, item);
                    return item;
                });
                return items.sort((a, b) => a.label.localeCompare(b.label));

            } catch (err: any) {
                console.error('Ontology Explorer Error:', err);
                vscode.window.showErrorMessage(`Ontology Error: ${err.message}`);
                return [new OntologyItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        } 
        else if (element.type === 'class' && element.uri) {
            // Expand Class: Get Properties (Level 1)
             return this.getPropertiesForClass(element.uri, element.depth + 1);
        }
        else if (element.type === 'property' && element.objectProperty) {
            // Expand Object Property: Get Properties of Target Class (Level 2+)
            return this.getPropertiesForClass(element.objectProperty, element.depth + 1);
        }
        
        return [];
    }

    private async getPropertiesForClass(classUri: string, depth: number): Promise<OntologyItem[]> {
        try {
            // Fetch properties used on instances of this class
            // Check for owl:ObjectProperty or usage as a link (isIRI)
            const propQuery = `
                SELECT DISTINCT ?prop ?rangeClass ?type WHERE {
                  ?s a <${classUri}> .
                  ?s ?prop ?o .
                  FILTER(isIRI(?prop))
                  
                  OPTIONAL { ?prop a ?type }
                  OPTIONAL { ?o a ?inferredType }
                  OPTIONAL { ?prop rdfs:range ?declaredRange }
                  
                  BIND(COALESCE(?declaredRange, ?inferredType) AS ?rangeClass)
                  BIND(isIRI(?o) AS ?isObject)
                } LIMIT 50
            `;

            const stream = await this.client!.query.select(propQuery);
            const props = await this.streamToArray(stream);

            if (props.length === 0) {
                return [new OntologyItem('No properties found', vscode.TreeItemCollapsibleState.None)];
            }


            const uniqueProps = new Map<string, any>();

            for (const row of props) {
                const uri = row.prop.value;
                const label = this.getLocalName(uri);
                const type = row.type ? row.type.value : undefined;
                const isObjectRef = row.isObject ? (row.isObject.value === 'true' || row.isObject.value === true) : false;

                // Determine if it's an Object Property
                let isObjectProperty = type === 'http://www.w3.org/2002/07/owl#ObjectProperty';
                
                if (!isObjectProperty && type !== 'http://www.w3.org/2002/07/owl#DatatypeProperty') {
                     if (isObjectRef || row.rangeClass) {
                         isObjectProperty = true;
                     }
                }

                let targetClass = row.rangeClass ? row.rangeClass.value : undefined;
                if (isObjectProperty && !targetClass) {
                    targetClass = 'http://www.w3.org/2002/07/owl#Thing'; 
                }

                // Merge with existing if present
                if (uniqueProps.has(uri)) {
                    const existing = uniqueProps.get(uri);
                    // Upgrade to object property if new row confirms it
                    if (isObjectProperty && !existing.isObjectProperty) {
                        existing.isObjectProperty = true;
                        existing.targetClass = targetClass;
                    }
                    // Keep best target class (prefer specific over Thing)
                    if (existing.targetClass === 'http://www.w3.org/2002/07/owl#Thing' && targetClass && targetClass !== 'http://www.w3.org/2002/07/owl#Thing') {
                         existing.targetClass = targetClass;
                    }
                } else {
                    uniqueProps.set(uri, { label, uri, isObjectProperty, targetClass, depth });
                }
            }

            const items: OntologyItem[] = [];
            for (const prop of uniqueProps.values()) {
                const state = prop.isObjectProperty ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
                const item = new OntologyItem(
                    prop.label,
                    state,
                    'property',
                    prop.uri,
                    depth,
                    prop.targetClass
                );
                this.cache.set(prop.uri, item);
                items.push(item);
            }
            
            return items.sort((a, b) => a.label.localeCompare(b.label));

        } catch (err: any) {
            return [new OntologyItem('Error fetching properties', vscode.TreeItemCollapsibleState.None)];
        }
    }
    
    private filterTerm: string = '';

    async search(term: string): Promise<void> {
        this.filterTerm = term;
        this.refresh();
    }

    private getLocalName(uri: string): string {
        const parts = uri.split(/[#/]/);
        return parts[parts.length - 1] || uri; 
    }




    private async streamToArray(stream: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const results: any[] = [];
            stream.on('data', (row: any) => results.push(row));
            stream.on('end', () => resolve(results));
            stream.on('error', reject);
        });
    }
}

export class OntologyItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type?: 'class' | 'property',
        public readonly uri?: string,
        public readonly depth: number = 0,
        public readonly objectProperty?: string // URI of the target class if this is an object property
    ) {
        super(label, collapsibleState);
        this.tooltip = uri || label;
        this.description = type; 
        
        // Context value for Drag & Drop
        this.contextValue = 'ontologyItem';

        // NOTE: We do NOT set resourceUri here because it causes VS Code 
        // to treat drag & drop as a file copy/open operation. 
        // We rely on handleDrag to provide text/plain data.
        
        // Icon Selection
        if (type === 'class') {
            this.iconPath = new vscode.ThemeIcon('symbol-class');
        } else if (type === 'property') {
            // "Object Properties" behave like classes in the tree (expandable to show children)
            // User requested these to also use symbol-class
            if (this.objectProperty) {
                this.iconPath = new vscode.ThemeIcon('symbol-class');
            } else {
                this.iconPath = new vscode.ThemeIcon('symbol-field');
            }
        } else {
             this.iconPath = new vscode.ThemeIcon('warning'); 
        }
    }
}
