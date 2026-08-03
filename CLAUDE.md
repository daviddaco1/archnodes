# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`project-visualizer` (npm name) — a visual architecture editor for backend/frontend graphs, plus an MCP server so AI agents can read/write the same graph. It ships three things from one `project.json` data file:

1. **CLI** (`src/`) — Express REST API + MCP stdio server + project store, compiled to `dist/`.
2. **Client** (`client/`) — React + `@xyflow/react` (React Flow) visual editor, served as a static SPA by the Express server.
3. **Skills** (`skills/*.md`) — instructions for AI agents (e.g. Claude via MCP) describing how to import an existing codebase into the graph, scaffold code from the graph, or keep graph and code in sync.

The core idea: a project's architecture (domains, routes, endpoints, middleware, services, models, tables, pages, components, forms, state stores, etc.) is modeled as a typed graph of nodes + edges. That graph is the single source of truth, editable either through the visual canvas or through MCP tool calls from an agent.

## Commands

Root (CLI/server, TypeScript compiled with `tsc`, tested with Vitest):
```
npm run build       # tsc -p tsconfig.json -> dist/
npm run dev          # tsc -w (watch mode)
npm test             # vitest run (all tests in src/**/*.test.ts)
npm run test:watch   # vitest watch mode
```
Run a single test file: `npx vitest run src/validation/rules.test.ts`. Run a single test by name: `npx vitest run -t "test name"`.

Client (`client/`, Vite + React, no test suite):
```
npm run dev       # vite dev server (proxies /api -> http://localhost:4173)
npm run build     # tsc --noEmit && vite build -> client/dist/
npm run preview   # vite preview
```

Running the app end-to-end: build the client first (`npm run build` inside `client/`), then from repo root `node dist/cli.js start --project <name> [--port 4173]` — the server serves `client/dist` as static files if present, otherwise API-only. There is no top-level script that chains both builds; run them in each directory.

Other CLI commands: `dist/cli.js mcp --project <name>` (starts the MCP stdio server for AI agents) and `dist/cli.js init --project <name> [--template <id>]` (interactive wizard if TTY + no `--template`, otherwise applies one of the templates in `src/init/templates.ts`).

## Architecture

### Data model (`src/types/graph.ts`)

Everything is a `GraphNode<T>` = `{ id, type, label, position, parentId?, containerId?, generated?, createdAt, updatedAt, props }`, where `props` is a per-type interface (`NodePropsMap`). Node types split into three groups:
- **Backend**: `domain, subdomain, route, endpoint, middleware, service, model, table, db, orm, repository, tool, queue, externalApi, scheduler, errorHandler, envConfig, websocket, email, redisKey`
- **Frontend**: `page, layout, component, form, stateStore, apiCall, hook, navigationRouter, guard, modalDialog, themeToken, asset`
- **Structural**: `container` (visual-only grouping, see below)

Two kinds of relationship, both stored as `GraphEdge { source, target, edgeType }`:
- `"hierarchy"` — real parent/child (e.g. domain→route→endpoint→middleware→service). Governs `parentId` and drives the tree walk used by markdown export and the scaffold/sync skills.
- `"invalidates"` — the one non-hierarchy edge kind, `endpoint -> (redisKey | endpoint)`, for cache invalidation wiring.

There's a third, separate concept: **ref fields** — plain string/array fields *inside* `props` that point at another node's id by convention (e.g. `subdomain.props.domainId`, `apiCall.props.endpointRef`, `navigationRouter.props.routes[].pageId`). These are NOT edges; they're validated by path-walking `REF_FIELDS` specs, not by graph traversal. Don't confuse the two when adding a new relationship — decide whether it's a structural hierarchy/invalidates edge or a ref field, and wire it into the right table.

`containerId` (used via `setContainer`) is a fourth, independent concept: pure visual/canvas grouping (a React Flow subflow) with no validation rule and no effect on hierarchy — never conflate it with `parentId`.

### Validation (`src/validation/rules.ts`)

Single source of truth for what's structurally legal, consumed by both the REST API and the MCP server:
- `HIERARCHY_RULES`: which parent node types may have which child node types (also drives `create_node`'s `parentId` and `connect_nodes`'s hierarchy edges).
- `REF_FIELDS`: per-node-type list of `{ field, targetType, array? }` specs for the ref-field convention above, including array/nested-array path syntax (`"routes[].pageId"`, `"cacheable.invalidatedBy[]"`).
- `REQUIRED_FIELDS`: required `props` keys per node type.
- `SPECIAL_EDGES`: the `invalidates` edge's allowed `from`/`to` types.
- `validateProjectGraph(graph)` runs all four checks (required fields, hierarchy edges, ref fields, special edges) and returns `{ valid, issues[] }`. Note the deliberate split in enforcement strictness: `assertValidNode` in the store hard-rejects only broken/mistyped refs at write time (a bad ref corrupts data); missing required fields are *not* write-blocking — they surface only through `validate_project`/`GET /api/validate`, because the visual editor is expected to create a bare node and fill it in afterward.

### Store (`src/store/project-store.ts`)

`createProjectStore(projectName, opts?)` loads/creates `<baseDir ?? ~/.project-visualizer/projects>/<projectName>/project.json` and returns a `ProjectStore` with the CRUD + validation API. Persistence is synchronous, whole-file, write-to-`.tmp`-then-rename on every mutation — there's no incremental diffing or locking, so treat the store as single-writer. `getProject(scope)` filters nodes/edges to `"backend"` or `"frontend"` node-type sets (see `BACKEND_NODE_TYPES`/`FRONTEND_NODE_TYPES`); `"all"` returns the raw graph.

### Two servers, one store (`src/server.ts`, `src/mcp/server.ts`)

Both `createServer` (Express REST API) and `createMcpServer` (MCP tools over stdio) are thin wrappers around the same `ProjectStore` and the same `validation/rules.ts` tables — they expose the same operations (`get_schema`/`GET /api/schema`, `create_node`/`POST /api/nodes`, `validate_project`/`GET /api/validate`, `export_markdown`/`GET /api/export/markdown`, etc.) through two transports. When adding a new store operation, wire it into both, keeping the shape of errors consistent (`ValidationError.issues` surfaced as `{ error, issues }` over HTTP and as an `isError: true` text result over MCP).

The Express server also statically serves `client/dist` (built React SPA) with a catch-all route, if that directory exists — so the CLI's `start` command doubles as both API and app server.

### Markdown export (`src/export/markdown.ts`)

`exportMarkdown(graph, validation?, domainId?)` renders the graph into an LLM-context-friendly markdown document: manifest, then per-domain trees (route nesting, endpoint middleware chain + resolved service, aggregated returns table, cache config), floating infra sections (models/tables/tools/external APIs/emails), then frontend (navigation, pages with their component/apiCall/form descendants, stores), then validation warnings. It includes a hand-rolled minimal YAML emitter (`toYamlBlock`) instead of a dependency — intentional, the only inputs are our own plain-data `props` objects.

### Agent skills (`skills/*.md`)

Written for an AI agent driving the MCP server, not for humans:
- `codebase-import.md` — bootstrap a graph from an existing codebase (code → graph, one-shot/replace).
- `project-scaffold.md` — generate a real codebase from a graph (graph → code, phase-by-phase: schema → stack → backend by hierarchy walk → frontend by hierarchy walk → mark `generated: true`).
- `project-sync.md` — keep an already-scaffolded codebase and the graph consistent both directions (push via `generated`/`updatedAt` staleness, pull via re-reading source and reconciling).

These encode the intended workflow contract (e.g. "never silently delete nodes to fix broken refs", "don't mark `generated: true` on an import") — read them before changing anything that a scaffold/sync agent would rely on (validation error codes, ref field paths, the `generated` flag's meaning).

### Client (`client/src/`)

- `context/GraphContext.tsx` — the one global state container: fetches `/api/project` + `/api/schema` on mount, exposes `nodes/edges/manifest/schema/connectionRules` plus `selectedNodeId` to the whole tree. `connectionRules` is derived from the schema's `connections` list via `buildRuleMap` (`components/canvas/edgeValidation.ts`) and used to allow/reject drag-to-connect on the canvas client-side (mirroring, not replacing, server-side validation).
- `api/client.ts` — the only place that talks to the REST API; typed wrappers, one `ApiError` with an optional `issues` array pass-through from the server's validation errors.
- `components/canvas/` — React Flow canvas: `GraphCanvas` (nodes/edges rendering + connect/move handlers), `GenericNode` (generic per-type node renderer), `ContainerNode` (the visual-only `containerId` grouping).
- `components/properties/` — the node inspector/edit form: `PropertyPanel` → `PropertyForm` → `FieldRenderer`/`ArrayField`/`RefSelectField`, driven by `schema/nodeSchemas.ts` (per-type field definitions used to render the right input for each `props` field, including ref-picker fields).
- `components/palette/`, `components/layout/` — node palette (create-node drag source, scoped to current tab's node types) and top-level layout (`Tabs` for backend/frontend/overview, `Toolbar` for validate/export actions).
- `client/src/types/graph.ts` is a hand-kept copy of `src/types/graph.ts` (client has no build-time access to the server's `src/`) — when changing the graph data model, update both.

## Conventions worth knowing

- Backend source (`src/`) compiles under `NodeNext` module resolution — internal imports use explicit `.js` extensions (e.g. `from "../store/project-store.js"`) even though the source files are `.ts`.
- Tests live next to source as `*.test.ts` (Vitest, `environment: "node"`); there is no separate `test/` directory.
- Some CLI-facing strings (wizard prompts, template labels/descriptions) are in Spanish; code identifiers, types, and comments are in English. Match whichever you're editing.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Suggest running /cost when a session is running long to monitor cache ratio.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.