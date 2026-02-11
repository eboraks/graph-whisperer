import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import JsonView from '@uiw/react-json-view';
import './index.css';

// Using VS Code API
const vscode = (window as any).acquireVsCodeApi ? (window as any).acquireVsCodeApi() : { postMessage: () => {} };

function App() {
  const [data, setData] = useState<any[]>([]);
  const [viewType, setViewType] = useState<'table' | 'json'>('table');
  const [sorting, setSorting] = useState<SortingState>([]);
  
  // Listen for messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'update') {
        let rows = message.data;
        const type = message.viewType || 'table';
        setViewType(type);

        if (type === 'table') {
             const normalized = rows.map((row: any) => {
                const newRow: any = {};
                Object.keys(row).forEach(key => {
                    const val = row[key];
                    if (val && typeof val === 'object' && 'value' in val) {
                        newRow[key] = val.value;
                    } else {
                        newRow[key] = val;
                    }
                });
                return newRow;
            });
            setData(normalized);
        } else {
            setData(rows); // For JSON, pass raw or as-is
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Dynamically generate columns based on the first row of data
  const columns = useMemo(() => {
    if (viewType !== 'table' || data.length === 0) return [];
    
    // Get all unique keys from all rows to ensure we don't miss sparse columns
    const allKeys = Array.from(new Set(data.flatMap(Object.keys)));
    
    const columnHelper = createColumnHelper<any>();

    return allKeys.map(key => 
        columnHelper.accessor(key, {
            header: key,
            cell: info => info.getValue(),
        })
    );
  }, [data, viewType]);

  const table = useReactTable({
    data: viewType === 'table' ? data : [],
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (data.length === 0) {
    return (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
            No results to display. Run a SPARQL query to see data here.
        </div>
    );
  }

  if (viewType === 'json') {
      return (
          <div style={{ padding: '10px', overflow: 'auto', height: '100%' }}>
              <JsonView 
                value={data} 
                style={{ 
                    // Use VS Code colors for better integration
                    '--w-rjv-background': 'transparent', 
                    '--w-rjv-color': 'var(--vscode-editor-foreground)',
                    '--w-rjv-key-string': 'var(--vscode-debugTokenExpression-name)', // key color
                    '--w-rjv-value-string': 'var(--vscode-debugTokenExpression-string)', // string value
                    '--w-rjv-value-number': 'var(--vscode-debugTokenExpression-number)', // number value
                    '--w-rjv-value-boolean': 'var(--vscode-debugTokenExpression-boolean)', // boolean value
                 } as React.CSSProperties}
                 displayDataTypes={false}
              />
               <div style={{ padding: '8px', borderTop: '1px solid var(--vscode-panel-border)', fontSize: '11px' }}>
                    {data.length} triples
               </div>
          </div>
      );
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  {{
                    asc: ' ▲',
                    desc: ' ▼',
                  }[header.column.getIsSorted() as string] ?? null}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px', borderTop: '1px solid var(--vscode-panel-border)', fontSize: '11px' }}>
          {data.length} results
      </div>
    </div>
  );
}

export default App;
