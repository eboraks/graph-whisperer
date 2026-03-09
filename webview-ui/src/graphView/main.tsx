import React from 'react';
import { createRoot } from 'react-dom/client';
import { GraphViewApp } from './GraphViewApp';
import './graphView.css';

const root = createRoot(document.getElementById('graph-view-root')!);
root.render(
  <React.StrictMode>
    <GraphViewApp />
  </React.StrictMode>
);
