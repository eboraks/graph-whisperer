import React, { useReducer, useRef, useEffect, useCallback, useMemo } from 'react';
import { graphReducer, initialState } from './graphReducer';
import { useCytoscape } from './useCytoscape';
import { toElements } from './transformElements';
import { postRequest, onMessage } from './vscodeApi';
import { Toolbar } from './components/Toolbar';
import { DetailDrawer } from './components/DetailDrawer';
import { EmptyState } from './components/EmptyState';

export function GraphViewApp() {
  const [state, dispatch] = useReducer(graphReducer, initialState);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActionRef = useRef<string>('');

  const handleNodeSelect = useCallback((uri: string) => {
    if (!uri) { dispatch({ type: 'CLEAR_SELECTION' }); return; }
    dispatch({ type: 'SET_LOADING', loading: true });
    postRequest({ command: 'graph:requestDetail', uri });
  }, []);

  const handleNodeExpand = useCallback((uri: string) => {
    dispatch({ type: 'SET_LOADING', loading: true });
    postRequest({ command: 'graph:expandNeighborhood', uri, limit: 50 });
  }, []);

  const { setElements, addElements, focusNode, fitView } =
    useCytoscape({ containerRef, onNodeSelect: handleNodeSelect, onNodeExpand: handleNodeExpand });

  // Signal to Extension Host that the webview is ready
  useEffect(() => {
    postRequest({ command: 'webview:ready' });
  }, []);

  // Listen for messages from Extension Host
  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.command) {
        case 'graph:showResults':
          lastActionRef.current = 'SHOW_RESULTS';
          dispatch({
            type: 'SHOW_RESULTS',
            nodes: msg.data.nodes,
            edges: msg.data.edges,
            queryType: msg.data.queryType,
            tripleCount: msg.data.tripleCount,
          });
          break;
        case 'graph:neighborhoodResult':
          lastActionRef.current = 'MERGE_NEIGHBORHOOD';
          dispatch({
            type: 'MERGE_NEIGHBORHOOD',
            nodes: msg.data.nodes,
            edges: msg.data.edges,
          });
          break;
        case 'graph:resourceDetailResult':
          dispatch({
            type: 'SELECT_RESOURCE',
            uri: msg.data.uri,
            detail: msg.data,
          });
          break;
        case 'graph:clear':
          dispatch({ type: 'CLEAR_GRAPH' });
          break;
        case 'graph:error':
          dispatch({ type: 'SET_ERROR', message: msg.message });
          break;
      }
    });
  }, []);

  // Sync state -> Cytoscape
  const elements = useMemo(
    () => toElements(state.nodes, state.edges),
    [state.nodes, state.edges]
  );

  useEffect(() => {
    if (state.nodes.size === 0) { return; }
    if (lastActionRef.current === 'MERGE_NEIGHBORHOOD') {
      addElements(elements);
    } else {
      setElements(elements);
    }
  }, [elements]);

  const hasGraph = state.nodes.size > 0;

  return (
    <div className="graph-view">
      {hasGraph && (
        <Toolbar
          nodeCount={state.nodes.size}
          edgeCount={state.edges.size}
          queryType={state.queryType}
          tripleCount={state.tripleCount}
          onFit={fitView}
          onClear={() => dispatch({ type: 'CLEAR_GRAPH' })}
        />
      )}

      {!hasGraph && <EmptyState />}

      {state.error && (
        <div className="error-banner">{state.error}</div>
      )}

      {state.isLoading && (
        <div className="loading-indicator">Loading...</div>
      )}

      <div
        ref={containerRef}
        className="graph-canvas"
        style={{ display: hasGraph ? 'block' : 'none' }}
      />

      {state.selectedDetail && (
        <DetailDrawer
          detail={state.selectedDetail}
          onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
          onNavigate={(uri) => {
            handleNodeExpand(uri);
            setTimeout(() => focusNode(uri), 600);
          }}
        />
      )}
    </div>
  );
}
