import * as vscode from 'vscode';
import { OntologyProvider } from '../views/OntologyProvider';

export class GraphWhispererChat {
    
    constructor(private ontologyProvider: OntologyProvider) {}

    public static register(context: vscode.ExtensionContext, ontologyProvider: OntologyProvider) {
        const handler = new GraphWhispererChat(ontologyProvider);
        const participant = vscode.chat.createChatParticipant('graphwhisperer', (request, context, response, token) => {
            return handler.handleRequest(request, context, response, token);
        });
        
        participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg'); // Ensure icon exists or use default
        context.subscriptions.push(participant);
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

        // 2. Construct System Prompt
        const messages = [
            vscode.LanguageModelChatMessage.User(
                `You are a SPARQL expert assistant named "Graph Whisperer". 
                Your goal is to help the user write queries based on their specific ontology.
                
                ${ontologyContext}
                
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
