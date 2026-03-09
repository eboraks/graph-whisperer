import React from 'react';

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">&#9670;</div>
      <p>Run a SPARQL <code>CONSTRUCT</code> query to visualize results as a graph.</p>
      <p className="hint">
        <code>SELECT</code> queries with <code>?s ?p ?o</code> columns
        will also render automatically.
      </p>
    </div>
  );
}
