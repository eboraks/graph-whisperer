import * as vscode from 'vscode';
import SparqlClient from 'sparql-http-client';
import { ResultsPanel } from './panels/ResultsPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "graph-whisperer" is now active!');

    // Register Results Panel
    const provider = new ResultsPanel(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ResultsPanel.viewType, provider)
    );

    const disposable = vscode.commands.registerCommand('graphwhisperer.runQuery', async () => {
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

        // Configuration
        const config = vscode.workspace.getConfiguration('graphwhisperer');
        const endpoint = config.get<string>('endpoint');
        const username = config.get<string>('username');
        
        if (!endpoint) {
             vscode.window.showErrorMessage('GraphDB endpoint is not configured.');
             return;
        }

        vscode.window.showInformationMessage(`Running query against: ${endpoint}`);

        // Initialize the client
        const clientOptions: any = {
            endpointUrl: endpoint
        };

        if (username) {
            // Retrieve password from secrets
            const password = await context.secrets.get('graphwhisperer.password');
            if (password) {
                clientOptions.user = username;
                clientOptions.password = password;
            } else {
                 vscode.window.showWarningMessage('Username is set but no password found in secrets. Proceeding without auth.');
            }
        }

        // const outputChannel = vscode.window.createOutputChannel('Graph Whisperer Results');
        // outputChannel.clear();
        // outputChannel.show(true);

        try {
            const client = new SparqlClient(clientOptions);
            
            // Simple regex to detect query type
            const isSelect = /^\s*(PREFIX\s+.*\s+)*SELECT/i.test(query);
            const isAsk = /^\s*(PREFIX\s+.*\s+)*ASK/i.test(query);
            
            if (isSelect) {
                const stream = await client.query.select(query);
                const results: any[] = [];
                stream.on('data', (row: any) => {
                    results.push(row);
                });

                stream.on('end', () => {
                    vscode.window.showInformationMessage(`Query executed successfully. Returned ${results.length} results.`);
                    provider.updateResults(results, 'table');
                    vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
                });

                stream.on('error', (err: any) => {
                    vscode.window.showErrorMessage(`Stream error: ${err.message}`);
                });
            } else if (isAsk) {
                 const result = await client.query.ask(query);
                 vscode.window.showInformationMessage(`ASK Query Executed: ${result}`);
                 provider.updateResults([{ result }], 'table'); // Show as single row table
                 vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
            } else {
                // Assert CONSTRUCT or DESCRIBE (or assume it returns quads)
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
                    provider.updateResults(results, 'json');
                    vscode.commands.executeCommand('workbench.view.extension.graphwhisperer');
                });

                stream.on('error', (err: any) => {
                    vscode.window.showErrorMessage(`Stream error: ${err.message}`);
                });
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error executing query: ${error.message || error}`);
        }
    });

    const setPasswordDisposable = vscode.commands.registerCommand('graphwhisperer.setPassword', async () => {
        const password = await vscode.window.showInputBox({
            prompt: 'Enter your GraphDB password',
            password: true, // Mask the input
            placeHolder: 'Password'
        });

        if (password !== undefined) {
             // Store specific to this extension
             await context.secrets.store('graphwhisperer.password', password);
             vscode.window.showInformationMessage('Password saved securely.');
        }
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(setPasswordDisposable);
}

export function deactivate() {}
