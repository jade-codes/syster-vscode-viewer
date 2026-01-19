import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
import { nodeTypes as baseNodeTypes, edgeTypes, SysMLNode } from '@opensyster/diagram-ui';
import type { SymbolData } from '@opensyster/diagram-core';
import '@xyflow/react/dist/style.css';

// Debug: log available node types
console.log('[Diagram] Available nodeTypes:', Object.keys(baseNodeTypes));
console.log('[Diagram] nodeTypes object:', baseNodeTypes);

// Create a fallback node component for unknown types
const FallbackNode: React.FC<{ id: string; data: SymbolData }> = ({ data }) => (
  <SysMLNode
    id={data.qualifiedName}
    data={data}
    borderColor="#6b7280"
    stereotype={data.kind || 'unknown'}
    showFeatures={true}
  />
);

// Extend nodeTypes with a default fallback
const nodeTypes = {
  ...baseNodeTypes,
  default: FallbackNode,
};

// VS Code API for messaging
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// Types from LSP
interface DiagramSymbol {
  name: string;
  qualifiedName: string;
  kind: string;
  definitionKind?: string;
  usageKind?: string;
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

// Types that should be shown as features inside their parent, not as separate nodes
const FEATURE_TYPES = new Set([
  'Attribute',      // AttributeUsage should be a feature
  'Reference',      // ReferenceUsage should be a feature
]);

// Check if a symbol should be rendered as a feature inside parent, not a standalone node
function isFeatureSymbol(symbol: DiagramSymbol): boolean {
  if (symbol.kind === 'Usage' && symbol.usageKind) {
    return FEATURE_TYPES.has(symbol.usageKind);
  }
  return false;
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
  
  // Determine node type based on kind
  // The node type must match keys in nodeTypes from diagram-ui
  let nodeType = 'default';
  if (symbol.kind === 'Definition' && symbol.definitionKind) {
    nodeType = `${symbol.definitionKind}Def`;
  } else if (symbol.kind === 'Usage' && symbol.usageKind) {
    nodeType = `${symbol.usageKind}Usage`;
  } else if (symbol.kind === 'Package') {
    nodeType = 'Package';
  } else if (symbol.kind === 'Feature') {
    nodeType = 'Feature';
  } else if (symbol.kind === 'Classifier' && symbol.definitionKind) {
    nodeType = `${symbol.definitionKind}Def`;
  }
  
  // Debug: log node types being created
  console.log(`[Diagram] Symbol: ${symbol.name}, kind=${symbol.kind}, defKind=${symbol.definitionKind}, usageKind=${symbol.usageKind} => nodeType=${nodeType}`);
  
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
      kind: nodeType, // Pass the computed nodeType for fallback rendering
    },
  };
}

// Convert LSP relationship to React Flow edge
function relationshipToEdge(rel: DiagramRelationship, index: number): Edge {
  return {
    id: `edge_${index}`,
    source: rel.source.replace(/::/g, '_'),
    target: rel.target.replace(/::/g, '_'),
    type: rel.type,
    label: rel.type,
  };
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
          // Process symbols to attach features to parents (filter out attribute usages etc.)
          const processedSymbols = processSymbols(data.symbols);
          console.log(`[Diagram] Original: ${data.symbols.length} symbols, After processing: ${processedSymbols.length} nodes`);
          
          const newNodes = processedSymbols.map((s, i) => symbolToNode(s, i));
          const newEdges = data.relationships.map((r, i) => relationshipToEdge(r, i));
          
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
