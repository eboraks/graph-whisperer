import React from 'react';

interface ToolbarProps {
  nodeCount: number;
  edgeCount: number;
  queryType: 'construct' | 'select' | null;
  tripleCount: number;
  onFit: () => void;
  onClear: () => void;
}

export function Toolbar({ nodeCount, edgeCount, queryType, tripleCount, onFit, onClear }: ToolbarProps) {
  return (
    <div className="toolbar">
      <span>{nodeCount} nodes &middot; {edgeCount} edges</span>
      {queryType && <span className="badge">{queryType.toUpperCase()}</span>}
      <span>{tripleCount} triples</span>
      <div style={{ flex: 1 }} />
      <button onClick={onFit} title="Fit to view">Fit</button>
      <button onClick={onClear} title="Clear graph">Clear</button>
    </div>
  );
}
