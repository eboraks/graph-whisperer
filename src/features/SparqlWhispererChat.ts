import * as vscode from 'vscode';
import { OntologyProvider } from '../views/OntologyProvider';

export interface QueryResultsSnapshot {
    query: string;
    queryType: 'select' | 'construct' | 'ask';
    rows?: any[];           // SELECT results (first N rows)
    triples?: any[];        // CONSTRUCT triples (first N)
    askResult?: boolean;
    graphSummary?: { nodeCount: number; edgeCount: number; nodeLabels: string[]; edgeLabels: string[] };
    timestamp: number;
}

export class SparqlWhispererChat {
    private static instance: SparqlWhispererChat;
    private lastResults?: QueryResultsSnapshot;

    constructor(
        private ontologyProvider: OntologyProvider,
        private context: vscode.ExtensionContext
    ) {
        SparqlWhispererChat.instance = this;
    }

    public static register(context: vscode.ExtensionContext, ontologyProvider: OntologyProvider) {
        const handler = new SparqlWhispererChat(ontologyProvider, context);
        const participant = vscode.chat.createChatParticipant('sparqlwhisperer', (request, context, response, token) => {
            return handler.handleRequest(request, context, response, token);
        });

        participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');
        context.subscriptions.push(participant);
    }

    public static setLastResults(snapshot: QueryResultsSnapshot) {
        if (SparqlWhispererChat.instance) {
            SparqlWhispererChat.instance.lastResults = snapshot;
        }
    }

    async handleRequest(
        request: vscode.ChatRequest, 
        context: vscode.ChatContext, 
        stream: vscode.ChatResponseStream, 
        token: vscode.CancellationToken
    ): Promise<any> {
        
        stream.progress('Analyzing ontology context...');
        
        // 1. Prepare Context from Ontology Cache
        const classes = this.ontologyProvider.getClasses();
        const properties = this.ontologyProvider.getProperties();
        
        // Summarize ontology for the LLM
        let ontologyContext = "Here is the summary of the current specific ontology/schema available in the GraphDB endpoint:\n\n";
        
        if (classes.length === 0 && properties.length === 0) {
            ontologyContext += "No ontology data loaded. Please ask the user to connect to GraphDB and refresh the ontology explorer.\n";
        } else {
            ontologyContext += `Found ${classes.length} Classes and ${properties.length} Properties.\n`;
            
            ontologyContext += "Classes:\n";
            classes.slice(0, 50).forEach(c => ontologyContext += `- ${c.label} (${c.uri})\n`); // Limit to 50 to save tokens
            if (classes.length > 50) ontologyContext += "...(more classes truncated)\n";
            
            ontologyContext += "\nProperties:\n";
            properties.slice(0, 50).forEach(p => ontologyContext += `- ${p.label} (${p.uri})\n`);
            if (properties.length > 50) ontologyContext += "...(more properties truncated)\n";
        }

        // 2. Prepare last query results context
        let resultsContext = '';
        if (this.lastResults) {
            const r = this.lastResults;
            resultsContext = `\n\n## Latest Query Results\n`;
            resultsContext += `Query (${r.queryType.toUpperCase()}):\n\`\`\`sparql\n${r.query}\n\`\`\`\n`;

            if (r.queryType === 'select' && r.rows) {
                const preview = r.rows.slice(0, 30);
                resultsContext += `Returned ${r.rows.length} rows. First ${preview.length} rows:\n`;
                resultsContext += '```json\n' + JSON.stringify(preview, null, 2) + '\n```\n';
            } else if (r.queryType === 'construct' && r.triples) {
                const preview = r.triples.slice(0, 30);
                resultsContext += `Returned ${r.triples.length} triples. First ${preview.length}:\n`;
                resultsContext += '```json\n' + JSON.stringify(preview, null, 2) + '\n```\n';
            } else if (r.queryType === 'ask') {
                resultsContext += `ASK result: ${r.askResult}\n`;
            }

            if (r.graphSummary) {
                const g = r.graphSummary;
                resultsContext += `\nGraph visualization: ${g.nodeCount} nodes, ${g.edgeCount} edges.\n`;
                if (g.nodeLabels.length > 0) {
                    resultsContext += `Node labels (sample): ${g.nodeLabels.slice(0, 20).join(', ')}\n`;
                }
                if (g.edgeLabels.length > 0) {
                    resultsContext += `Edge labels (sample): ${g.edgeLabels.slice(0, 20).join(', ')}\n`;
                }
            }
        }

        // 3. Load Skill Instructions and Rules from Settings
        const config = vscode.workspace.getConfiguration('sparqlwhisperer');
        const skillInstructions = config.get<string>('agent.introspectionSkill') || '';
        const agentRules = config.get<string>('agent.rules') || '';

        // 4. Construct System Prompt
        const messages = [
            vscode.LanguageModelChatMessage.User(
                `You are a SPARQL expert assistant named "SPARQL Whisperer".
                Your goal is to help the user write queries based on their specific ontology.
                You can see the latest query results and graph visualization data below to provide informed answers.

                ${ontologyContext}
                ${resultsContext}

                Here are your core instructions and skills for SPARQL introspection:
                ${skillInstructions}

                Here are your general development rules:
                ${agentRules}

                User Question: ${request.prompt}`
            )
        ];

        // 3. Send to Language Model
        try {
            // Select the default model (usually GPT-4 or Copilot's specific model)
            // We use the vendor 'copilot' and family 'gpt-4' if possible, or just select first available
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4' }); // Prefer GPT-4
            let model = models[0];
            if (!model) {
                 const allModels = await vscode.lm.selectChatModels();
                 model = allModels[0];
            }
            
            if (!model) {
                stream.markdown("Error: No language model available via VS Code Chat API.");
                return;
            }

            const chatResponse = await model.sendRequest(messages, {}, token);
            
            for await (const fragment of chatResponse.text) {
                stream.markdown(fragment);
            }
            
        } catch (err: any) {
            stream.markdown(`Error processing request: ${err.message}`);
        }
    }
}
