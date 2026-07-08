import * as esbuild from 'esbuild';
import path from 'path';

const isDev = process.argv.includes('--dev');

// Resolve paths to ensure single instances
const reactPath = path.resolve('./node_modules/react');
const reactDomPath = path.resolve('./node_modules/react-dom');
const xyflowReactPath = path.resolve('./node_modules/@xyflow/react');
const xyflowSystemPath = path.resolve('./node_modules/@xyflow/system');

await esbuild.build({
  entryPoints: ['./src/index.tsx'],
  bundle: true,
  outfile: '../media/index.js',
  format: 'iife',
  minify: !isDev,
  sourcemap: isDev ? 'inline' : false,
  // Use the automatic JSX runtime so JSX compiles to `react/jsx-runtime`
  // imports rather than `React.createElement`. diagram-ui is bundled from
  // source and some of its files (e.g. nodes/nodeFactory.tsx) use JSX without
  // importing the React default — the classic transform threw "React is not
  // defined" at render time for those.
  jsx: 'automatic',
  loader: {
    '.css': 'css',
  },
  // Alias to ensure single instances across all packages
  alias: {
    'react': reactPath,
    'react-dom': reactDomPath,
    '@xyflow/react': xyflowReactPath,
    '@xyflow/system': xyflowSystemPath,
  },
  // Define for React
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  },
});

console.log('✓ Build complete');
