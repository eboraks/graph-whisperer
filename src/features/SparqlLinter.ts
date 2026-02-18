import * as vscode from 'vscode';
import { Parser, SparqlQuery, Pattern, BlockPattern } from 'sparqljs';

export class SparqlLinter {
    private parser: any;
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor(collection: vscode.DiagnosticCollection) {
        this.parser = new Parser();
        this.diagnosticCollection = collection;
    }

    public lint(document: vscode.TextDocument) {
        if (document.languageId !== 'sparql') {
            return;
        }

        const query = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        if (!query.trim()) {
            this.diagnosticCollection.clear();
            return;
        }

        try {
            const parsedQuery = this.parser.parse(query);
            this.validateVariables(parsedQuery, document, diagnostics);
        } catch (error: any) {
            // Parse Error
            if (error.hash && error.hash.loc) {
                const loc = error.hash.loc;
                // sparqljs loc is 1-based usually
                const range = new vscode.Range(
                    new vscode.Position(loc.first_line - 1, loc.first_column),
                    new vscode.Position(loc.last_line - 1, loc.last_column)
                );
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Syntax Error: ${error.message}`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diagnostic);
            } else {
                 // Fallback if no location
                 const range = new vscode.Range(0, 0, 0, 0);
                 const diagnostic = new vscode.Diagnostic(
                    range,
                    `Syntax Error: ${error.message}`,
                    vscode.DiagnosticSeverity.Error
                 );
                 diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private validateVariables(query: SparqlQuery, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
        // Collect defined variables (in SELECT clause)
        // Collect used variables (in WHERE clauses)
        
        const definedVars = new Set<string>();
        const usedVars = new Set<string>();
        const variableLocations = new Map<string, vscode.Range[]>();

        // 1. Traverse to find Definitions (SELECT ?v)
        if (query.type === 'query') {
            const q = query as any;
            q.variables?.forEach((v: any) => {
                // v can be a string (variable name) or object (expression with 'variable')
                if (typeof v === 'object' && 'value' in v && v.termType === 'Variable') {
                     definedVars.add(v.value);
                } else if (typeof v === 'object' && 'variable' in v) {
                     // e.g. (COUNT(?x) AS ?count)
                     if (v.variable?.value) definedVars.add(v.variable.value);
                } else if (v.termType === 'Variable') {
                     definedVars.add(v.value);
                }
            });
        }

        // 2. Traverse WHERE clause to find Usages
        const q = query as any;
        if (q.where) {
            this.traversePatterns(q.where, usedVars, variableLocations, document);
        }

        // 3. Logic:
        // A. Defined but not used (Warning)
        // B. Used but not defined (Warning) -> Only applies if SELECT variables limit the output.
        //    Actually, "Used but not defined" in SPARQL context usually means "Used in SELECT but not bound in WHERE".
        //    Let's implement: "Variable in SELECT is not bound in WHERE clause".
        
        const selectVars = Array.from(definedVars);
        
        // Check 1: Variable in SELECT but never appears in WHERE
        selectVars.forEach(v => {
            if (!usedVars.has(v) && v !== '*') {
                 // We need a location for this variable in the SELECT clause to mark it.
                 // Since AST might not give ranges for everything, we might scan the first few lines?
                 // Or we scan the text for `?v`.
                 const range = this.findVariableRangeInSelect(document, v);
                 if (range) {
                     diagnostics.push(new vscode.Diagnostic(
                         range,
                         `Variable ?${v} is selected but not used in the WHERE clause.`,
                         vscode.DiagnosticSeverity.Warning
                     ));
                 }
            }
        });
    }

    private traversePatterns(patterns: Pattern[], usedVars: Set<string>, locations: Map<string, vscode.Range[]>, doc: vscode.TextDocument) {
        patterns.forEach(pattern => {
            if (pattern.type === 'bgp') {
                pattern.triples.forEach((triple: any) => {
                    [triple.subject, triple.predicate, triple.object].forEach((term: any) => {
                        if (term.termType === 'Variable') {
                            usedVars.add(term.value);
                        }
                    });
                });
            } else if (pattern.type === 'optional' || pattern.type === 'union' || pattern.type === 'group' || pattern.type === 'minus' || pattern.type === 'graph' || pattern.type === 'service') {
                if (pattern.patterns) {
                    this.traversePatterns(pattern.patterns, usedVars, locations, doc);
                }
            } else if (pattern.type === 'filter') {
                // Traverse expression
            }
        });
    }

    private findVariableRangeInSelect(doc: vscode.TextDocument, varName: string): vscode.Range | undefined {
        const text = doc.getText();
        
        // 0. Mask ALL comments globally to avoid matching keywords inside comments
        // Replace content of comments with spaces to preserve indices
        const maskedText = text.replace(/#.*/g, (match) => ' '.repeat(match.length));
        
        // 1. Find the SELECT block (simple heuristic: from "SELECT" to "WHERE")
        // Note: This is simplified and might fail with nested queries, but better than global regex.
        // A robust parser would give us the location, but sparse AST doesn't always have it.
        const selectRegex = /\bSELECT\b/i;
        const whereRegex = /\bWHERE\b/i;
        
        const selectMatch = selectRegex.exec(maskedText);
        if (!selectMatch) return undefined;
        
        // Find the first WHERE after SELECT
        // We need to be careful about subqueries. We assume the first SELECT's variables 
        // are before the first WHERE that follows it at the same nesting level. 
        // For now, let's just search textual range.
        
        const substring = maskedText.substring(selectMatch.index);
        let whereMatch = whereRegex.exec(substring);
        if (!whereMatch) return undefined; // Should be impossible for valid query
        
        const start = selectMatch.index;
        const end = selectMatch.index + whereMatch.index; // Absolute index of WHERE
        
        const selectClause = maskedText.substring(start, end);

        // 3. Find the variable in the masked clause
        const varRegex = new RegExp(`\\?${varName}\\b`);
        const match = varRegex.exec(selectClause);
        
        if (match) {
            const absoluteIndex = start + match.index;
            const pos = doc.positionAt(absoluteIndex);
            return new vscode.Range(pos, pos.translate(0, varName.length + 1));
        }
        
        return undefined;
    }
}
