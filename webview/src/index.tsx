import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
} from '@xyflow/react';
import { nodeTypes as baseNodeTypes, edgeTypes } from '@opensyster/diagram-ui';
import type { SymbolData } from '@opensyster/diagram-core';
import '@xyflow/react/dist/style.css';

// Debug: log available node types
console.log('[Diagram] Available nodeTypes:', Object.keys(baseNodeTypes));
console.log('[Diagram] nodeTypes object:', baseNodeTypes);

// baseNodeTypes already includes a 'default' entry (UnifiedSysMLNode),
// so no fallback component is needed.
const nodeTypes = baseNodeTypes;

// VS Code API for messaging
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// Types from LSP — must match DiagramSymbol in diagram.rs (camelCase)
interface DiagramSymbol {
  name: string;
  qualifiedName: string;
  nodeType: string;
  parent?: string;
  features?: string[];
  typedBy?: string;
  direction?: string;
}

interface DiagramRelationship {
  type: string;
  source: string;
  target: string;
}

interface DiagramData {
  symbols: DiagramSymbol[];
  relationships: DiagramRelationship[];
}

// Node types that should be shown as features inside their parent, not as separate nodes
const FEATURE_NODE_TYPES = new Set([
  'AttributeUsage',
  'ReferenceUsage',
]);

// Check if a symbol should be rendered as a feature inside parent, not a standalone node
function isFeatureSymbol(symbol: DiagramSymbol): boolean {
  return FEATURE_NODE_TYPES.has(symbol.nodeType);
}

// Get parent qualified name from a qualified name (e.g., "A::B::C" -> "A::B")
function getParentQualifiedName(qualifiedName: string): string | null {
  const lastSeparator = qualifiedName.lastIndexOf('::');
  if (lastSeparator === -1) return null;
  return qualifiedName.substring(0, lastSeparator);
}

// Process symbols to attach features to their parent nodes
function processSymbols(symbols: DiagramSymbol[]): DiagramSymbol[] {
  // Build a map of qualified name -> symbol for quick lookup
  const symbolMap = new Map<string, DiagramSymbol>();
  symbols.forEach(s => symbolMap.set(s.qualifiedName, s));
  
  // Identify feature symbols and their parents
  const featuresByParent = new Map<string, string[]>();
  const topLevelSymbols: DiagramSymbol[] = [];
  
  for (const symbol of symbols) {
    if (isFeatureSymbol(symbol)) {
      // This is a feature - attach to parent
      const parentQN = getParentQualifiedName(symbol.qualifiedName);
      if (parentQN && symbolMap.has(parentQN)) {
        const features = featuresByParent.get(parentQN) || [];
        // Format as "name : type" or just "name"
        const featureStr = symbol.typedBy 
          ? `${symbol.name} : ${symbol.typedBy}`
          : symbol.name;
        features.push(featureStr);
        featuresByParent.set(parentQN, features);
      } else {
        // Parent not found, show as standalone
        topLevelSymbols.push(symbol);
      }
    } else {
      // Top-level symbol
      topLevelSymbols.push(symbol);
    }
  }
  
  // Attach features to parent symbols
  return topLevelSymbols.map(symbol => ({
    ...symbol,
    features: [
      ...(symbol.features || []),
      ...(featuresByParent.get(symbol.qualifiedName) || []),
    ],
  }));
}

// Convert LSP symbol to React Flow node
function symbolToNode(symbol: DiagramSymbol, index: number): Node<SymbolData & { kind?: string }> {
  const cols = 4;
  const nodeWidth = 180;
  const nodeHeight = 100;
  const gap = 40;

  const row = Math.floor(index / cols);
  const col = index % cols;

  // Use nodeType directly from LSP — it already matches NODE_TYPES keys
  const nodeType = symbol.nodeType || 'default';

  return {
    id: symbol.qualifiedName.replace(/::/g, '_'),
    type: nodeType,
    position: {
      x: col * (nodeWidth + gap) + gap,
      y: row * (nodeHeight + gap) + gap
    },
    data: {
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      features: symbol.features,
      typedBy: symbol.typedBy,
      direction: symbol.direction as 'in' | 'out' | 'inout' | undefined,
      kind: nodeType,
    },
  };
}

/**
 * Build a lookup from short name and qualified name to node ID.
 * The LSP may use short names (e.g., "Engine") as edge targets,
 * but node IDs use qualified names with :: replaced by _.
 */
function buildNameToIdMap(symbols: DiagramSymbol[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of symbols) {
    const id = s.qualifiedName.replace(/::/g, '_');
    map.set(s.qualifiedName, id);
    // Also map short name — last writer wins if ambiguous, which is acceptable
    map.set(s.name, id);
  }
  return map;
}

/** Resolve a relationship endpoint to a node ID using the name map */
function resolveEndpoint(name: string, nameMap: Map<string, string>): string | null {
  // Try exact match first (qualified name)
  const exact = nameMap.get(name);
  if (exact) return exact;
  // Try as-is with :: replacement (in case it's already qualified)
  const replaced = name.replace(/::/g, '_');
  if (nameMap.has(name)) return replaced;
  return null;
}

// Convert LSP relationships to React Flow edges, resolving targets
function relationshipsToEdges(
  relationships: DiagramRelationship[],
  symbols: DiagramSymbol[],
): Edge[] {
  const nameMap = buildNameToIdMap(symbols);
  const edges: Edge[] = [];

  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const source = resolveEndpoint(rel.source, nameMap);
    const target = resolveEndpoint(rel.target, nameMap);

    // Only create edge if both endpoints resolve to existing nodes
    if (source && target && source !== target) {
      edges.push({
        id: `edge_${i}`,
        source,
        target,
        type: rel.type,
        label: rel.type,
      });
    }
  }

  return edges;
}

function DiagramApp() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'diagram': {
          const data = message.data as DiagramData;
          // Filter out anonymous symbols (e.g., <anon#8@L0>)
          const namedSymbols = data.symbols.filter(s => !s.name.startsWith('<anon'));
          // Process symbols to attach features to parents (filter out attribute usages etc.)
          const processedSymbols = processSymbols(namedSymbols);
          console.log(`[Diagram] Original: ${data.symbols.length} symbols, Named: ${namedSymbols.length}, After processing: ${processedSymbols.length} nodes`);

          const newNodes = processedSymbols.map((s, i) => symbolToNode(s, i));
          const newEdges = relationshipsToEdges(data.relationships, processedSymbols);
          
          setNodes(newNodes);
          setEdges(newEdges);
          setStats({ nodes: newNodes.length, edges: newEdges.length });
          setLoading(false);
          setError(null);
          break;
        }
        case 'error':
          setError(message.message);
          setLoading(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setNodes, setEdges]);

  // Request initial data
  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    vscode.postMessage({ type: 'refresh' });
  }, []);

  if (error) {
    return (
      <div className="error-container">
        <div className="error-message">{error}</div>
        <button onClick={handleRefresh}>Retry</button>
      </div>
    );
  }

  return (
    <div className="diagram-app">
      <div className="toolbar">
        <button onClick={handleRefresh} disabled={loading}>
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
        <span className="stats">
          {stats.nodes} nodes, {stats.edges} edges
        </span>
      </div>
      <div className="diagram-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}

// Styles
const styles = document.createElement('style');
styles.textContent = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  html, body, #root {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
  
  .diagram-app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  
  .toolbar {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    display: flex;
    gap: 12px;
    align-items: center;
    background: var(--vscode-editor-background, #1e1e1e);
  }
  
  .toolbar button {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    padding: 6px 14px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 13px;
  }
  
  .toolbar button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  
  .toolbar button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .stats {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }
  
  .diagram-container {
    flex: 1;
    position: relative;
  }
  
  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
  }
  
  .error-message {
    color: var(--vscode-errorForeground, #f48771);
    padding: 16px;
    max-width: 400px;
    text-align: center;
  }
  
  /* React Flow overrides for VS Code theme */
  .react-flow__node {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 2px solid var(--vscode-textLink-foreground, #3794ff);
    border-radius: 8px;
    padding: 10px;
    font-size: 12px;
  }
  
  .react-flow__node.selected {
    border-color: var(--vscode-focusBorder, #007fd4);
    box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007fd4);
  }
  
  .react-flow__edge-path {
    stroke: var(--vscode-textLink-foreground, #3794ff);
  }
  
  .react-flow__controls {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
  }
  
  .react-flow__controls-button {
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    fill: var(--vscode-editor-foreground, #d4d4d4);
  }
  
  .react-flow__controls-button:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }
  
  .react-flow__background {
    background: var(--vscode-editor-background, #1e1e1e);
  }
`;
document.head.appendChild(styles);

// Mount app
const root = createRoot(document.getElementById('root')!);
root.render(
  <ReactFlowProvider>
    <DiagramApp />
  </ReactFlowProvider>
);
