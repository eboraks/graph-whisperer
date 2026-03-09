interface GraphViewRequest {
  command: 'graph:requestDetail' | 'graph:expandNeighborhood' | 'graph:exportPng' | 'webview:ready';
  uri?: string;
  limit?: number;
}

interface GraphViewMessage {
  command: string;
  data?: any;
  message?: string;
}

const vscode = (window as any).acquireVsCodeApi
  ? (window as any).acquireVsCodeApi()
  : { postMessage: () => {} };

export function postRequest(msg: GraphViewRequest) {
  vscode.postMessage(msg);
}

export function onMessage(cb: (msg: GraphViewMessage) => void): () => void {
  const handler = (event: MessageEvent) => cb(event.data);
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
