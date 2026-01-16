# SysML v2 Diagram Viewer

A VS Code extension for viewing SysML v2 diagrams.

## Features

- Read-only diagram viewer for SysML v2 models
- Interactive React Flow based visualization
- Automatic layout of model elements
- Navigation to source code from diagram elements

## Requirements

- [SysML v2 Language Support](https://marketplace.visualstudio.com/items?itemName=jade-codes.sysml-language-support) extension

## Installation

Install from the VS Code Marketplace or Open VSX Registry.

## Usage

1. Open a `.sysml` or `.kerml` file
2. Run command: `SysML: Show Diagram`
3. The diagram will appear in a side panel

## Development

```bash
npm install
npm run compile
npm run package
```

## License

MIT

## Development

### DevContainer Setup (Recommended)

This project includes a DevContainer configuration for a consistent development environment.

**Using VS Code:**
1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open this repository in VS Code
3. Click "Reopen in Container" when prompted (or use Command Palette: "Dev Containers: Reopen in Container")

**What's included:**
- Node.js 20 LTS
- Bun runtime
- ESLint, Prettier
- GitHub CLI
- All VS Code extensions pre-configured

### Manual Setup

If not using DevContainer:

```bash
# Install dependencies
npm install
# or
bun install

# Run tests
npm test
# or
bun test
```
