## **name: sparql-introspection description: Probes a SPARQL endpoint to discover classes, properties, and graph structure. Use this when the user needs help writing a query or understanding the data model.**

# **SPARQL Introspection Skill**

This skill allows the agent to query the connected triplestore to understand its schema dynamically.

## **Goal**

To provide the AI agent with grounded knowledge of the graph's classes and predicates so it can suggest accurate SPARQL patterns instead of hallucinating schema names.

## **Instructions**

1. **Identify the Endpoint:** Extract the current SPARQL endpoint URL and credentials from the user's workspace settings or `vscode.secrets` storage.  
2. **Execute Probes:** Run the following queries to gather context:

### **Query to List Classessparql**

SELECT DISTINCT?class WHERE { ?s a?class. } LIMIT 50

\#\#\# Query to List Properties for a Class  
If the user mentions a specific class (e.g., \`schema:Person\`), probe its predicates:  
\`\`\`sparql  
SELECT DISTINCT?p WHERE {  
 ?s a \<CLASS\_URI\> ;?p?o.  
} LIMIT 50

### **Query for Property Usage (Statistical)**

Code snippet  
SELECT?p (COUNT(\*) AS?usage) WHERE {  
 ?s?p?o.  
} GROUP BY?p ORDER BY DESC(?usage) LIMIT 20

## **Constraints**

* **Read-Only:** Only execute `SELECT` queries for introspection. Do not attempt `INSERT`, `DELETE`, or `DROP`.  
* **Performance:** Always apply a `LIMIT` to introspection queries to avoid overloading the triplestore.  
* **Feedback:** If a probe fails (e.g., 401 Unauthorized), report the specific error to the user immediately.

## **Decision Tree**

* **If the graph is massive:** Use statistical sampling (Property Usage query) to find the most common patterns first.  
* **If the graph uses a known ontology:** (e.g., Schema.org), suggest using standard prefixes to shorten the query.

