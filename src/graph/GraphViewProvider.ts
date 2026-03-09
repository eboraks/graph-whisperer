import * as vscode from 'vscode';
import { GraphExplorerService } from './GraphExplorerService';
import type { GraphViewMessage, GraphViewRequest, GraphPayload } from '../shared/graphViewMessages';

export class GraphViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sparqlwhisperer.graphView';
    private view?: vscode.WebviewView;
    private pendingPayload?: GraphPayload;
    private webviewReady = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private service: GraphExplorerService
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
            ],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        this.webviewReady = false;
        webviewView.onDidDispose(() => {
            this.webviewReady = false;
        });

        // Handle messages FROM the webview
        webviewView.webview.onDidReceiveMessage(
            async (msg: GraphViewRequest) => {
                try {
                    switch (msg.command) {
                        case 'webview:ready': {
                            this.webviewReady = true;
                            if (this.pendingPayload) {
                                this.postMessage({ command: 'graph:showResults', data: this.pendingPayload });
                                this.pendingPayload = undefined;
                            }
                            break;
                        }
                        case 'graph:requestDetail': {
                            const data = await this.service.getResourceDetail(msg.uri);
                            this.postMessage({
                                command: 'graph:resourceDetailResult', data
                            });
                            break;
                        }
                        case 'graph:expandNeighborhood': {
                            const data = await this.service.getNeighborhood(
                                msg.uri, 1, msg.limit ?? 50
                            );
                            this.postMessage({
                                command: 'graph:neighborhoodResult', data
                            });
                            break;
                        }
                        case 'graph:exportPng': {
                            // Handled in webview via cy.png()
                            break;
                        }
                    }
                } catch (err: any) {
                    this.postMessage({
                        command: 'graph:error',
                        message: err.message || 'Query failed',
                    });
                }
            }
        );
    }

    /** Called by query execution pipeline to push graph results */
    public showGraphResults(payload: GraphPayload) {
        this.pendingPayload = payload;
        if (this.view && this.webviewReady) {
            this.view.show(true);
            this.postMessage({ command: 'graph:showResults', data: payload });
            this.pendingPayload = undefined;
        } else if (this.view) {
            this.view.show(true);
        }
    }

    public clear() {
        this.postMessage({ command: 'graph:clear' });
    }

    private postMessage(msg: GraphViewMessage) {
        this.view?.webview.postMessage(msg);
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'graphView.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'graphView.css')
        );
        const nonce = getNonce();

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
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
}
