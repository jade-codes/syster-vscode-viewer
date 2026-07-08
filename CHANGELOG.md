# Changelog

All notable changes to the SysML v2 Diagram Viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1-alpha] - 2026-07-08

### Fixed

- **Webview no longer crashes with "React is not defined".** The esbuild bundle used the classic JSX transform, which compiles `<Foo/>` to `React.createElement(...)` and requires `React` in scope in every file. `diagram-ui` is bundled from source and some of its files use JSX without importing the React default, so nodes threw on render. The webview build now uses the automatic JSX runtime (`jsx: 'automatic'`), so no file needs `React` in scope.
- **Unknown node types no longer blank the webview.** The local `FallbackNode` override called `SysMLNode` with a removed prop API and no `category`, throwing inside the theme lookup. Removed it in favor of `diagram-ui`'s node types, which already register a safe `default`.
- Resolved the remaining `tsc --noEmit` errors (dead `SymbolData` import, `useNodesState`/`useEdgesState` inferring `never[]`).

### Added

- **View selection.** A "Select View" command and toolbar button let you pick which SysML v2 view (e.g. General View) the diagram renders, via the language server's `syster/getSysMLViews`.
- **Explicit view errors.** When a selected view cannot be applied, the canvas is cleared and the error is surfaced (`viewError`) instead of falling back to a stale or generic diagram.
- **Render error boundary.** Render-time exceptions now show a visible message instead of unmounting the tree to a blank screen.
