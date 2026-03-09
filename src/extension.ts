import * as vscode from 'vscode';
import SparqlClient from 'sparql-http-client';
import { OntologyProvider } from './views/OntologyProvider';
import { ResultsPanel } from './panels/ResultsPanel';
import { SparqlCompletionItemProvider } from './features/SparqlCompletionItemProvider';
import { SparqlWhispererChat, type QueryResultsSnapshot } from './features/SparqlWhispererChat';
import { SparqlLinter } from './features/SparqlLinter';
import { GraphViewProvider } from './graph/GraphViewProvider';
import { GraphExplorerService } from './graph/GraphExplorerService';
import { GraphResultTransformer, detectGraphPattern } from './graph/GraphResultTransformer';
import { McpManager } from './mcp/mcpManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "sparql-whisperer" is now active!');

    // Register Results Panel
    const resultsProvider = new ResultsPanel(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ResultsPanel.viewType, resultsProvider)
    );

    // Register Graph View Panel
    // Create a placeholder client; it will be updated when queries run
    const placeholderClient = new SparqlClient({ endpointUrl: 'http://localhost:7200/repositories/placeholder' });
    const graphExplorerService = new GraphExplorerService(placeholderClient);
    const graphViewProvider = new GraphViewProvider(context.extensionUri, graphExplorerService);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GraphViewProvider.viewType,
            graphViewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Command to manually focus the Graph tab
    context.subscriptions.push(
        vscode.commands.registerCommand('sparqlwhisperer.showGraphView', () => {
            vscode.commands.executeCommand('sparqlwhisperer.graphView.focus');
        })
    );

    // Helper to get client options
    const getClientOptions = async (): Promise<any> => {
        const config = vscode.workspace.getConfiguration('sparqlwhisperer');
        const endpoint = config.get<string>('endpoint');
        const username = config.get<string>('username');
        const configPassword = config.get<string>('password'); // From settings.json (insecure)

        if (!endpoint) {
             return null;
        }

        const options: any = {
            endpointUrl: endpoint
        };

        if (username) {
            // Priority: SecretStorage > Settings
            let password = await context.secrets.get('sparqlwhisperer.password');
            if (!password && configPassword) {
                password = configPassword;
            }

            if (password) {
                options.user = username;
                options.password = password;
            }
        }
        return options;
    };

    // Start MCP server if enabled
    const mcpManager = new McpManager(getClientOptions);
    context.subscriptions.push(mcpManager);

    const config = vscode.workspace.getConfiguration('sparqlwhisperer');
    if (config.get<boolean>('mcp.enabled', true)) {
        const port = config.get<number>('mcp.port', 3330);
        mcpManager.start(port).catch(err => {
            console.error('[SparqlWhisperer] Failed to start MCP server:', err.message);
        });
    }

    // Restart MCP server when settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sparqlwhisperer.mcp')) {
                const cfg = vscode.workspace.getConfiguration('sparqlwhisperer');
                const enabled = cfg.get<boolean>('mcp.enabled', true);
                if (enabled) {
                    const port = cfg.get<number>('mcp.port', 3330);
                    mcpManager.start(port).catch(err => {
                        console.error('[SparqlWhisperer] Failed to restart MCP server:', err.message);
                    });
                } else {
                    mcpManager.stop();
                }
            }
        })
    );

    // Register Ontology Provider
    const ontologyProvider = new OntologyProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sparqlwhisperer.ontology', ontologyProvider)
    );
    // Enable Drag & Drop
    const treeView = vscode.window.createTreeView('sparqlwhisperer.ontology', {
        treeDataProvider: ontologyProvider,
        dragAndDropController: ontologyProvider
    });
    context.subscriptions.push(treeView);

    // Refresh Command
    const refreshOntologyDisposable = vscode.commands.registerCommand('sparqlwhisperer.refreshOntology', async () => {
        const options = await getClientOptions();
        if (options) {
            const client = new SparqlClient(options);
            ontologyProvider.refresh(client);
        } else {
             vscode.window.showErrorMessage('Endpoint not configured.');
        }
    });

    // Search Command
    const searchOntologyDisposable = vscode.commands.registerCommand('sparqlwhisperer.searchOntology', async () => {
        const searchTerm = await vscode.window.showInputBox({
            placeHolder: 'Search classes and properties...',
            title: 'Search Ontology Explorer',
            prompt: 'Enter search term to filter (empty to clear)'
        });

        if (searchTerm !== undefined) {
             // Even if empty, we call search to reset the view
             await ontologyProvider.search(searchTerm);
        }
    });
    
    context.subscriptions.push(searchOntologyDisposable);

    // Auto-refresh on activation if configured
    getClientOptions().then(options => {
        if (options) {
            const client = new SparqlClient(options);
            ontologyProvider.refresh(client);
        }
    });

    const runQueryDisposable = vscode.commands.registerCommand('sparqlwhisperer.runQuery', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }

        const document = editor.document;
        const query = document.getText();

        if (!query.trim()) {
            vscode.window.showErrorMessage('SPARQL query is empty.');
            return;
        }

        const clientOptions = await getClientOptions();
        
        if (!clientOptions) {
             vscode.window.showErrorMessage('GraphDB endpoint is not configured.');
             return;
        }

        if (clientOptions.user && !clientOptions.password) {
             vscode.window.showWarningMessage('Username is set but no password found (secrets or settings). Proceeding without auth.');
        }

        vscode.window.showInformationMessage(`Running query against: ${clientOptions.endpointUrl}`);
        console.log('[SparqlWhisperer] Running query, endpoint:', clientOptions.endpointUrl);

        try {
            const client = new SparqlClient(clientOptions);
            // Update the graph explorer service with the current client
            graphExplorerService.updateClient(client);
            
            // Pre-process query to remove comments for detection
            const cleanQuery = query.replace(/#.*$/gm, ""); // Remove comments
            
            // Detect query type
            const isAsk = /\bASK\b/i.test(cleanQuery);
            const isConstruct = /\b(CONSTRUCT|DESCRIBE)\b/i.test(cleanQuery);
            
            console.log('[SparqlWhisperer] Query type detection — isAsk:', isAsk, 'isConstruct:', isConstruct);
            console.log('[SparqlWhisperer] Clean query:', cleanQuery.substring(0, 200));

            if (isAsk) {
                 const result = await client.query.ask(query);
                 vscode.window.showInformationMessage(`ASK Query Executed: ${result}`);
                 resultsProvider.updateResults([{ result }], 'table');
                 vscode.commands.executeCommand('workbench.view.extension.sparqlwhisperer');
                 const askSnapshot = { query, queryType: 'ask' as const, askResult: result, timestamp: Date.now() };
                 SparqlWhispererChat.setLastResults(askSnapshot);
                 mcpManager.setLastResults(askSnapshot);
            } else if (isConstruct) {
                // For CONSTRUCT, we strictly need to ensure the client asks for RDF
                // sparql-http-client's .construct() usually handles this, 
                // but if 406 occurs, it means the server can't satisfy the default Accept.
                // GraphDB usually accepts 'text/turtle' or 'application/ld+json'.
                
                // We pass the query as is.
                const stream = await client.query.construct(query);
                const results: any[] = [];
                stream.on('data', (quad: any) => {
                    results.push({
                        subject: quad.subject.value,
                        predicate: quad.predicate.value,
                        object: quad.object.value,
                        graph: quad.graph.value
                    });
                });

                stream.on('end', () => {
                    console.log('[SparqlWhisperer] CONSTRUCT stream ended, results:', results.length);
                    console.log('[SparqlWhisperer] First triple:', JSON.stringify(results[0]));
                    vscode.window.showInformationMessage(`Query executed successfully. Returned ${results.length} triples.`);
                    resultsProvider.updateResults(results, 'json');
                    vscode.commands.executeCommand('workbench.view.extension.sparqlwhisperer');

                    // Push to Graph View
                    const graphData = GraphResultTransformer.fromConstruct(results);
                    console.log('[SparqlWhisperer] Graph data: nodes=', graphData.nodes.length, 'edges=', graphData.edges.length);
                    graphViewProvider.showGraphResults({
                        ...graphData,
                        queryType: 'construct',
                        tripleCount: results.length,
                    });

                    // Share with chat agent and MCP
                    const constructSnapshot: QueryResultsSnapshot = {
                        query, queryType: 'construct', triples: results,
                        graphSummary: {
                            nodeCount: graphData.nodes.length,
                            edgeCount: graphData.edges.length,
                            nodeLabels: graphData.nodes.map(n => n.label),
                            edgeLabels: graphData.edges.map(e => e.predicateLabel),
                        },
                        timestamp: Date.now(),
                    };
                    SparqlWhispererChat.setLastResults(constructSnapshot);
                    mcpManager.setLastResults(constructSnapshot);
                });

                stream.on('error', (err: any) => {
                    console.error('[SparqlWhisperer] CONSTRUCT stream error:', err);
                    vscode.window.showErrorMessage(`Stream error (CONSTRUCT): ${err.message}`);
                });
            } else {
                // Assume SELECT if not ASK or CONSTRUCT/DESCRIBE
                const stream = await client.query.select(query);
                
                const results: any[] = [];
                stream.on('data', (row: any) => {
                    const cleanRow: any = {};
                    Object.keys(row).forEach(key => {
                        cleanRow[key] = row[key].value;
                    });
                    results.push(cleanRow);
                });
                
                stream.on('end', () => {
                   console.log('[SparqlWhisperer] SELECT stream ended, results:', results.length);
                   console.log('[SparqlWhisperer] First row:', JSON.stringify(results[0]));
                   vscode.window.showInformationMessage(`Query executed successfully. Returned ${results.length} rows.`);
                   resultsProvider.updateResults(results, 'table');
                   vscode.commands.executeCommand('workbench.view.extension.sparqlwhisperer');

                   // Attempt graph transformation for SELECT results
                   const pattern = detectGraphPattern(results);
                   console.log('[SparqlWhisperer] SELECT graph pattern:', pattern);
                   const snapshot: QueryResultsSnapshot = {
                       query, queryType: 'select', rows: results, timestamp: Date.now(),
                   };
                   if (pattern !== 'manual') {
                       const graphData = GraphResultTransformer.fromSelect(results, pattern);
                       if (graphData.nodes.length > 0) {
                           graphViewProvider.showGraphResults({
                               ...graphData,
                               queryType: 'select',
                               tripleCount: results.length,
                           });
                           snapshot.graphSummary = {
                               nodeCount: graphData.nodes.length,
                               edgeCount: graphData.edges.length,
                               nodeLabels: graphData.nodes.map(n => n.label),
                               edgeLabels: graphData.edges.map(e => e.predicateLabel),
                           };
                       }
                   }
                   SparqlWhispererChat.setLastResults(snapshot);
                   mcpManager.setLastResults(snapshot);
                });
                
                stream.on('error', (err: any) => {
                     console.error('[SparqlWhisperer] SELECT stream error:', err);
                     vscode.window.showErrorMessage(`Stream error (SELECT): ${err.message}`);
                });
            }

        } catch (error: any) {
            console.error('[SparqlWhisperer] Query execution error:', error);
            vscode.window.showErrorMessage(`Error executing query: ${error.message || error}`);
        }
    });

    const setPasswordDisposable = vscode.commands.registerCommand('sparqlwhisperer.setPassword', async () => {
        const password = await vscode.window.showInputBox({
            prompt: 'Enter your GraphDB password',
            password: true, 
            placeHolder: 'Password'
        });

        if (password !== undefined) {
             await context.secrets.store('sparqlwhisperer.password', password);
             vscode.window.showInformationMessage('Password saved securely.');
        }
    });

    context.subscriptions.push(runQueryDisposable);
    context.subscriptions.push(setPasswordDisposable);
    context.subscriptions.push(refreshOntologyDisposable);
    // Register IntelliSense Provider
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'sparql',
        new SparqlCompletionItemProvider(ontologyProvider),
        '?', ' ' // Trigger characters
    );
    context.subscriptions.push(completionProvider);

    // Register Chat Participant
    SparqlWhispererChat.register(context, ontologyProvider);

    // Register Linter
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('sparql-lint');
    context.subscriptions.push(diagnosticCollection);
    const linter = new SparqlLinter(diagnosticCollection);

    // On Open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => linter.lint(doc))
    );
    
    // On Save (or Change with throttling? Let's use Open and Save first to be safe, or Change)
    // Using onDidChangeTextDocument for basic realtime linting
    let timeout: NodeJS.Timeout | undefined = undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
            }
            timeout = setTimeout(() => {
                linter.lint(event.document);
            }, 500); // 500ms debounce
        })
    );

    // Lint all visible sparql documents on activation
    if (vscode.window.activeTextEditor) {
        linter.lint(vscode.window.activeTextEditor.document);
    }
}

export function deactivate() {}
