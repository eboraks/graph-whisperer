import * as vscode from 'vscode';
import SparqlClient from 'sparql-http-client';
import { OntologyProvider } from './views/OntologyProvider';
import { ResultsPanel } from './panels/ResultsPanel';
import { SparqlCompletionItemProvider } from './features/SparqlCompletionItemProvider';
import { GraphWhispererChat } from './features/GraphWhispererChat';
import { SparqlLinter } from './features/SparqlLinter';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "graph-whisperer" is now active!');

    // Register Results Panel
    const resultsProvider = new ResultsPanel(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ResultsPanel.viewType, resultsProvider)
    );

    // Helper to get client options
    const getClientOptions = async (): Promise<any> => {
        const config = vscode.workspace.getConfiguration('graphwhisperer');
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
            let password = await context.secrets.get('graphwhisperer.password');
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

    // Register Ontology Provider
    const ontologyProvider = new OntologyProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('graphwhisperer.ontology', ontologyProvider)
    );
    // Enable Drag & Drop
    const treeView = vscode.window.createTreeView('graphwhisperer.ontology', {
        treeDataProvider: ontologyProvider,
        dragAndDropController: ontologyProvider
    });
    context.subscriptions.push(treeView);

    // Refresh Command
    const refreshOntologyDisposable = vscode.commands.registerCommand('graphwhisperer.refreshOntology', async () => {
        const options = await getClientOptions();
        if (options) {
            const client = new SparqlClient(options);
            ontologyProvider.refresh(client);
        } else {
             vscode.window.showErrorMessage('Endpoint not configured.');
        }
    });

    // Search Command
    const searchOntologyDisposable = vscode.commands.registerCommand('graphwhisperer.searchOntology', async () => {
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

    const runQueryDisposable = vscode.commands.registerCommand('graphwhisperer.runQuery', async () => {
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

        try {
            const client = new SparqlClient(clientOptions);
            
            // Pre-process query to remove comments for detection
            const cleanQuery = query.replace(/#.*$/gm, ""); // Remove comments
            
            // Detect query type
            const isAsk = /\bASK\b/i.test(cleanQuery);
            const isConstruct = /\b(CONSTRUCT|DESCRIBE)\b/i.test(cleanQuery);
            
            if (isAsk) {
                 const result = await client.query.ask(query);
                 vscode.window.showInformationMessage(`ASK Query Executed: ${result}`);
                 resultsProvider.updateResults([{ result }], 'table'); 
                 vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
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
                    vscode.window.showInformationMessage(`Query executed successfully. Returned ${results.length} triples.`);
                    resultsProvider.updateResults(results, 'json');
                    vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
                });

                stream.on('error', (err: any) => {
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
                   vscode.window.showInformationMessage(`Query executed successfully. Returned ${results.length} rows.`);
                   resultsProvider.updateResults(results, 'table'); 
                   vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
                });
                
                stream.on('error', (err: any) => {
                     vscode.window.showErrorMessage(`Stream error (SELECT): ${err.message}`);
                });
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error executing query: ${error.message || error}`);
        }
    });

    const setPasswordDisposable = vscode.commands.registerCommand('graphwhisperer.setPassword', async () => {
        const password = await vscode.window.showInputBox({
            prompt: 'Enter your GraphDB password',
            password: true, 
            placeHolder: 'Password'
        });

        if (password !== undefined) {
             await context.secrets.store('graphwhisperer.password', password);
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
    GraphWhispererChat.register(context, ontologyProvider);

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
