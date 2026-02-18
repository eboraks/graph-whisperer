## **name: sparql-introspection description: Probes a SPARQL endpoint to discover classes, properties, and graph structure. Use this when the user needs help writing a query or understanding the data model.**

# **SPARQL Introspection Skill**

This skill allows the agent to query the connected triplestore to understand its schema dynamically.

## **Goal**

To provide the AI agent with grounded knowledge of the graph's classes and predicates so it can suggest accurate SPARQL patterns instead of hallucinating schema names.

## **Instructions**

1. **Identify the Endpoint:** Extract the current SPARQL endpoint URL and credentials from the user's workspace settings or `vscode.secrets` storage.
2. **Execute Probes:** Run the following queries to gather context:

### **Query to List Classes**

SELECT DISTINCT ?class WHERE { ?s a ?class. } LIMIT 50

### **Query to Find Classes/Properties by Keyword**

If the user mentions a specific term (e.g., "Human", "species") but you are unsure of the IRI, search for it:

```sparql
SELECT DISTINCT ?match ?type WHERE {
  { ?match a rdfs:Class . BIND("Class" AS ?type) }
  UNION
  { ?match a rdf:Property . BIND("Property" AS ?type) }
  FILTER(CONTAINS(LCASE(STR(?match)), "keyword"))
} LIMIT 10
```

### **Query to List Properties for a Class**

If the user mentions a specific class (e.g., `schema:Person`), probe its predicates:

```sparql
SELECT DISTINCT ?p WHERE {
 ?s a <CLASS_URI> ; ?p ?o.
} LIMIT 50
```

### **Query for Property Usage (Statistical)**

```sparql
SELECT ?p (COUNT(*) AS ?usage) WHERE {
 ?s ?p ?o.
} GROUP BY ?p ORDER BY DESC(?usage) LIMIT 20
```

## **Verification**

Before finalizing any query for the user, **you must verify your assumptions** about the schema.

- **Check existence:** `ASK { ?s a vocab:Character }`
- **Check property domain:** `ASK { ?s a vocab:Character ; vocab:species ?o }`

## **Constraints**

- **Read-Only:** Only execute `SELECT` or `ASK` queries for introspection. Do not attempt `INSERT`, `DELETE`, or `DROP`.
- **Performance:** Always apply a `LIMIT` to introspection queries to avoid overloading the triplestore.
- **Feedback:** If a probe fails (e.g., 401 Unauthorized), report the specific error to the user immediately.
- **No Hallucinations:** Do not guess IRI names. Use the "Keyword Search" or "Property Usage" queries to find the actual names.

## **Decision Tree**

- **If the graph is massive:** Use statistical sampling (Property Usage query) to find the most common patterns first.
- **If looking for specific concepts:** Use the "Keyword Search" query.
- **If the graph uses a known ontology:** (e.g., Schema.org), suggest using standard prefixes to shorten the query, but _verify_ they are actually used.
