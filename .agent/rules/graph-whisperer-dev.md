## **name: graph-whisperer-dev description: Guidelines for building the GraphWhisperer VS Code extension using Node.js and SPARQL. alwaysOn: true**

# **GraphWhisperer Development Rules**

You are an expert VS Code Extension developer specializing in Semantic Web technologies (SPARQL/RDF). Follow these rules when generating code for the GraphWhisperer project.

## **Architecture & Frameworks**

* **Language:** Use TypeScript exclusively for the extension logic.  
* **Foundation:** Follow the standard VS Code Extension lifecycle. Register commands and providers in the `activate` function of `extension.ts`.  
* **Query Execution:** Use the `sparql-http-client` library (ESM version) for all endpoint interactions.  
* **Result Visualization:**  
  * For `SELECT` queries, use the `<vscode-data-grid>` component from the `@vscode/webview-ui-toolkit`.  
  * For `CONSTRUCT` queries, use a collapsible tree view like `@uiw/react-json-view`.

## **SPARQL Query Standards**

* **SPARQL 1.1:** Adhere strictly to W3C SPARQL 1.1 Query and Update specifications.  
* **Best Practices:**  
  * Always include `PREFIX` declarations to improve readability.  
  * Use `LIMIT` by default for exploratory queries to prevent endpoint timeouts.  
  * Prefer `VALUES` or specific triple patterns over complex `FILTER` regex for performance.

## **Webview & Security**

* **Content Security Policy (CSP):** Every webview must implement a strict CSP that restricts script and style sources.  
* **Theming:** Use CSS variables (e.g., `var(--vscode-editor-foreground)`) to ensure the UI matches the user's active IDE theme.  
* **Credentials:** Use the `vscode.secrets` API to store SPARQL endpoint credentials safely; never store them in workspace settings.

## **Agentic Integration**

* **Chat Participant:** Register the `@graphwhisperer` chat participant to handle natural language query requests within the IDE.  
* **Model Context Protocol (MCP):** When building introspection tools, prioritize the MCP standard to ensure compatibility with both Antigravity and Cursor.

