import * as vscode from 'vscode';
import { OntologyProvider, OntologyItem } from '../views/OntologyProvider';

export class SparqlCompletionItemProvider implements vscode.CompletionItemProvider {
    
    constructor(private ontologyProvider: OntologyProvider) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        
        // 1. Variable Suggestion: Triggered by '?'
        if (linePrefix.endsWith('?')) {
            return this.provideVariableSuggestions(document, position);
        }

        // 2. Property Suggestion: Triggered by whitespace after a subject
        // Heuristic: Check if the previous word looks like a subject (variable or IRI)
        // and we are looking for a predicate.
        if (this.isPositionForPredicate(linePrefix)) {
            return this.providePropertySuggestions(document, position);
        }

        return undefined;
    }

    private provideVariableSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        // Suggest variable names based on known classes
        const matches: vscode.CompletionItem[] = [];
        
        // Get all classes from Ontology cache
        const classes = this.ontologyProvider.getClasses(); // We need to expose this from Provider
        
        for (const cls of classes) {
            // Logic: if class is "vocab:Film", suggest "?film"
            const label = cls.label.toLowerCase();
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Variable);
            item.detail = `Variable for ${cls.label}`;
            item.documentation = `Suggested variable name for class ${cls.uri}`;
            matches.push(item);
        }
        
        return matches;
    }

    private providePropertySuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        // 1. Identify the subject of the current triple
        const subjectVariable = this.getSubjectAtLine(document, position);
        
        if (!subjectVariable) {
            // Fallback: Suggest all properties if we can't determine subject
             return this.ontologyProvider.getProperties().map(p => {
                const item = new vscode.CompletionItem(p.label, vscode.CompletionItemKind.Field);
                item.detail = p.uri;
                return item;
             });
        }

        // 2. Find the type of the subject
        const subjectType = this.inferTypeForVariable(document, subjectVariable);
        
        if (!subjectType) {
             // Fallback: Suggest all properties
             return this.ontologyProvider.getProperties().map(p => {
                const item = new vscode.CompletionItem(p.label, vscode.CompletionItemKind.Field);
                item.detail = p.uri;
                return item;
             });
        }

        // 3. Filter properties that are valid for this type (Domain check)
        // Since we don't have a strict domain index yet, we can heuristically 
        // return properties that are "associated" with this class in the tree view logic.
        // For now, let's return all properties but prioritize ones that "sound" related or 
        // if we build a better index later.
        
        // Better approach: OntologyProvider usually fetches properties FOR a class.
        // We can expose `getPropertiesForClass(classUri)` publicly or use the cache map.
        
        // Ideally, we need a map of Class -> Properties.
        // OntologyProvider builds this dynamically. 
        // Let's assumme for now we just dump all properties, 
        // but we can improve this to be context aware if we hold that data.
        
        return this.ontologyProvider.getProperties().map(p => {
            const item = new vscode.CompletionItem(p.label, vscode.CompletionItemKind.Field);
            item.detail = p.uri;
            return item;
         });
    }

    private isPositionForPredicate(linePrefix: string): boolean {
        // Check if we are presumably typing a predicate
        // Example: "?s " -> yes
        // Example: "?s ?p " -> no (expecting object)
        // Simplistic regex: Text ends with whitespace, and there is one token before it that isn't a keyword like WHERE/SELECT
        const trimmed = linePrefix.trim();
        const parts = trimmed.split(/\s+/);
        // If 1 part (subject), we are typing predicate. 
        // Note: This is very basic.
        return parts.length === 1 && !linePrefix.endsWith(';') && !linePrefix.endsWith('.');
    }

    private getSubjectAtLine(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const line = document.lineAt(position).text;
        const parts = line.trim().split(/\s+/);
        if (parts.length > 0) {
            return parts[0];
        }
        return undefined;
    }

    private inferTypeForVariable(document: vscode.TextDocument, variable: string): string | undefined {
        // Scan the document for "variable a Class" pattern
        const text = document.getText();
        const regex = new RegExp(`${variable.replace('?', '\\?')} a ([^\\s;.]+)`, 'g');
        const match = regex.exec(text);
        if (match) {
            return match[1]; // The class URI or prefixed name
        }
        return undefined;
    }
}
