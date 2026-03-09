import { useRef, useEffect, useCallback } from 'react';
import cytoscape, { Core } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { CytoscapeElement } from './transformElements';

cytoscape.use(coseBilkent);

interface UseCytoscapeProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onNodeSelect: (uri: string) => void;
  onNodeExpand: (uri: string) => void;
}

export function useCytoscape(
  { containerRef, onNodeSelect, onNodeExpand }: UseCytoscapeProps
) {
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) { return; }

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'background-color': 'data(color)',
            'width': 35,
            'height': 35,
            'font-size': '11px',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'color': '#cccccc',
            'text-outline-color': '#1e1e1e',
            'text-outline-width': 2,
            'text-max-width': '100px',
            'text-wrap': 'ellipsis',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#555555',
            'target-arrow-color': '#555555',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(predicateLabel)',
            'font-size': '9px',
            'text-rotation': 'autorotate',
            'color': '#888888',
            'text-outline-color': '#1e1e1e',
            'text-outline-width': 1,
          },
        },
        {
          selector: ':selected',
          style: {
            'border-width': 3,
            'border-color': '#007fd4',
          },
        },
      ],
      layout: { name: 'cose-bilkent' as any, animate: 'end', animationDuration: 500 },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    cy.on('tap', 'node', (evt) => onNodeSelect(evt.target.id()));
    cy.on('dbltap', 'node', (evt) => onNodeExpand(evt.target.id()));
    cy.on('tap', (evt) => { if (evt.target === cy) { onNodeSelect(''); } });

    cyRef.current = cy;

    // ResizeObserver for panel resize handling
    const observer = new ResizeObserver(() => {
      cy.resize();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [containerRef]);

  const setElements = useCallback((elements: CytoscapeElement[]) => {
    const cy = cyRef.current;
    if (!cy) { return; }
    cy.elements().remove();
    cy.add(elements as any);
    cy.layout({
      name: 'cose-bilkent' as any, animate: 'end', animationDuration: 500, fit: true,
    }).run();
  }, []);

  const addElements = useCallback((elements: CytoscapeElement[]) => {
    const cy = cyRef.current;
    if (!cy) { return; }
    const newEls = elements.filter(el => !cy.getElementById(el.data.id).length);
    if (!newEls.length) { return; }
    cy.add(newEls as any);
    cy.layout({
      name: 'cose-bilkent' as any, animate: 'end', animationDuration: 500, fit: false,
    }).run();
  }, []);

  const focusNode = useCallback((uri: string) => {
    const cy = cyRef.current;
    if (!cy) { return; }
    const node = cy.getElementById(uri);
    if (node.length) {
      cy.animate({ center: { eles: node }, zoom: 2 } as any, { duration: 400 } as any);
      node.select();
    }
  }, []);

  const fitView = useCallback(() => cyRef.current?.fit(undefined, 50), []);

  return { setElements, addElements, focusNode, fitView, cyRef };
}
