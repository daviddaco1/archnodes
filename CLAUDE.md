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

Running the app end-to-end: build the client first (`npm run build` inside `client/`), then from repo root `node dist/cli.js start --project <name> [--port 4173] [--host <host>] [--token <token>] [--allow-insecure-lan] [--role <role>]` — the server serves `client/dist` as static files if present, otherwise API-only. Binds to `127.0.0.1` by default with no auth required (unchanged local-mode behavior); binding to any other `--host` now requires either a token (see `### Security` below) or `--allow-insecure-lan` passed explicitly, or the process refuses to start. There is no top-level script that chains both builds; run them in each directory. `npm run test:client` (root) runs the client's own Vitest suite (`npm test --workspace=client`) — `npm test` at the root still only covers `src/**`.

Other CLI commands: `dist/cli.js mcp --project <name> [--role <role>]` (starts the MCP stdio server for AI agents) and `dist/cli.js init --project <name> [--template <id>]` (interactive wizard if TTY + no `--template`, otherwise applies one of the templates in `src/init/templates.ts`). `npm run perf` (root) runs `src/perf/bench.ts` — a standalone timing script (not a Vitest suite; see `### Performance` below), not something to add thresholds for in CI.

## Architecture

### Data model (`src/types/graph.ts`)

Everything is a `GraphNode<T>` = `{ id, type, label, position, parentId?, containerId?, generated?, createdAt, updatedAt, props }`, where `props` is a per-type interface (`NodePropsMap`). Node types split into three groups:
- **Backend**: `domain, subdomain, route, endpoint, operation, middleware, service, model, table, db, orm, repository, tool, queue, externalApi, scheduler, errorHandler, envConfig, websocket, websocketEvent, websocketEmit, email, redisKey`
- **Frontend**: `page, layout, component, form, stateStore, apiCall, hook, navigationRouter, guard, modalDialog, themeToken, asset`
- **Structural**: `container`, `boundary`, `note` (visual-only, no hierarchy/validation role — `boundary` is a styled grouping like `container`, distinguished by `props.kind`; `note` is a freeform sticky)

`endpoint.methods: HttpMethod[]` can list several HTTP methods on one node (no more one-endpoint-per-method). `endpoint` itself only keeps what's shared across methods (`headers`, `cacheable`, `isPublic`/`authMethods`); per-method `query`/`params`/`body`/`returns` live on optional `operation` children (`endpoint -> operation` hierarchy, one per method). `validateOperationMethods` (`src/validation/rules.ts`) rejects an operation whose `method` isn't in the parent endpoint's `methods`, or that collides with a sibling operation's method — enforced at write time in the store, not just the diagnostic sweep.

Two kinds of relationship, both stored as `GraphEdge { source, target, edgeType }`:
- `"hierarchy"` — real parent/child (e.g. domain→route→endpoint→middleware→service). Governs `parentId` and drives the tree walk used by markdown export and the scaffold/sync skills.
- `"invalidates"` — the one non-hierarchy edge kind, `endpoint -> (redisKey | endpoint)`, for cache invalidation wiring.

There's a third, separate concept: **ref fields** — plain string/array fields *inside* `props` that point at another node's id by convention (e.g. `subdomain.props.domainId`, `apiCall.props.endpointRef`, `navigationRouter.props.routes[].pageId`). These are NOT edges; they're validated by path-walking `REF_FIELDS` specs, not by graph traversal. Don't confuse the two when adding a new relationship — decide whether it's a structural hierarchy/invalidates edge or a ref field, and wire it into the right table.

For a 1:1-ish ref relationship, put the field on only one side (e.g. `db.ormId`, not also `orm.dbId`) — a reciprocal pair is redundant data and (before the canvas ports rework below) used to draw two overlapping edges for the same relationship. Pick whichever side reads naturally as "the holder."

`containerId` (used via `setContainer`) is a fourth, independent concept: pure visual/canvas grouping (a React Flow subflow) with no validation rule and no effect on hierarchy — never conflate it with `parentId`.

### Validation (`src/validation/rules.ts`)

Single source of truth for what's structurally legal, consumed by both the REST API and the MCP server:
- `HIERARCHY_RULES`: which parent node types may have which child node types (also drives `create_node`'s `parentId` and `connect_nodes`'s hierarchy edges).
- `REF_FIELDS`: per-node-type list of `{ field, targetType, array? }` specs for the ref-field convention above, including array/nested-array path syntax (`"routes[].pageId"`, `"cacheable.invalidatedBy[]"`).
- `REQUIRED_FIELDS`: required `props` keys per node type.
- `SPECIAL_EDGES`: the `invalidates` edge's allowed `from`/`to` types.
- `validateProjectGraph(graph)` runs all four checks (required fields, hierarchy edges, ref fields, special edges) and returns `{ valid, issues[] }`. Note the deliberate split in enforcement strictness: `assertValidNode` in the store hard-rejects only broken/mistyped refs at write time (a bad ref corrupts data); missing required fields are *not* write-blocking — they surface only through `validate_project`/`GET /api/validate`, because the visual editor is expected to create a bare node and fill it in afterward.

### Store (`src/store/project-store.ts`)

`createProjectStore(projectName, opts?)` loads/creates the project graph via a `PersistenceAdapter` (`src/store/persistence-adapter.ts`; defaults to `createJsonFileAdapter`, which reads/writes `<baseDir ?? ~/.project-visualizer/projects>/<projectName>/project.json`) and returns a `ProjectStore` with the CRUD + validation API. `getProject(scope)` filters nodes/edges to `"backend"` or `"frontend"` node-type sets (see `BACKEND_NODE_TYPES`/`FRONTEND_NODE_TYPES`); `"all"` returns the raw graph (not cloned — callers must not mutate it directly).

**Transactions**: every mutating method (`createNode`, `updateNode`, `setPosition`, `setContainer`, `deleteNode`, `connectNodes`, `deleteEdge`, `importGraph`, `updateManifest`) wraps its body in `store.transaction(fn, meta?)` — a single commit point that persists at most once (on success) or rolls back the in-memory graph entirely (on failure, via a `structuredClone` snapshot taken before `fn` runs), never partially. `store.applyBatch(ops, meta?)` runs a whitelisted sequence of those same methods as one transaction — REST's `POST /api/batch` and MCP's `batch_operations` tool are the only way to group several mutations into one commit/rollback unit, since HTTP/MCP calls are otherwise one-shot. `meta?: { source?, author?, description? }` tags the resulting history entry; REST routes pass `source: "api"`, MCP tools pass `source: "mcp"`, `import_graph`/`POST /api/import` pass `source: "import"`.

**History / undo / redo** (`src/history/history.ts`): each committed transaction that actually changed nodes/edges is diffed (`diffGraphs`, by id, not the whole graph) and appended to `.history/history.jsonl` next to `project.json` (append-only; a full rewrite only happens when a fresh edit lands after one or more `undo()`s, dropping the now-invalid "redo" future — linear history, no branching). `store.undo()`/`redo()`/`restoreVersion(entryId)`/`compareVersions(a, b)`/`listHistory(opts?)` operate on this log directly (bypassing `transaction()`, so undo/redo never generate their own history entries).

**Dependency analysis** (`src/analysis/dependencies.ts`): `getDependencies`/`getDependents`/`getAffectedNodes` unify hierarchy edges, `invalidates` edges, and `REF_FIELDS` refs into one queryable view (each result tagged with which relation kind it came from) without merging those concepts. `getDependents` is the reverse direction (what points at a node) — it looks up `buildDependentsIndex(graph)`, a `targetId -> RelatedNode[]` map built in one O(nodes + edges) pass; pass a precomputed index (`getDependents(id, graph, index)` / `getAffectedNodes(id, graph, { index })`) when calling it for many nodes against the same graph (e.g. a health check or summary walking every node) — omitting it is fine for a one-off lookup, where building a throwaway index costs the same as a single inline scan would have.

**Health check** (`src/validation/health.ts`): `checkProjectHealth`/`store.checkHealth()` layers non-write-blocking diagnostics (`ORPHAN_NODE`, `UNUSED_NODE`, `REF_CYCLE` — all `level: "warning"`) on top of `validateProjectGraph`'s hard rules, bucketed into `errors`/`warnings`/`info`. It never changes what `assertValidNode` rejects at write time.

**Impact analysis / change planning** (`src/analysis/change.ts`): `analyzeChange(store, nodeId, "delete" | "modify", opts?)` is read-only — "modify" actually runs the proposed patch inside a `transaction()` that always rolls back (a thrown sentinel forces it), diffing `validateProjectGraph` before/after to report `newIssues`. `planChange(...)` builds a human-readable step list + summary on top of that; neither ever touches code, only the graph.

**Conflict detection** (`src/sync/conflict.ts`): `BaseNode` carries optional `sourcePath`/`sourceHash`/`lastSyncedAt`. `store.recordSync(id, { sourceHash?, sourcePath? })` stamps those (deliberately *not* bumping `updatedAt` — that field must keep meaning "real content edit" for `determineSyncStatus`'s `graphChanged` check to work) and `getSyncStatus`/`getBulkSyncStatus` compare a caller-supplied current hash against it to answer `"unknown" | "in_sync" | "code_changed" | "graph_changed" | "conflict"`. The server never reads the user's source tree itself — an agent doing a sync computes the hash on its own side and passes it in.

Destructive bulk writes — `importGraph` in `"replace"` mode, or a cascade delete removing more than a handful of nodes (`CASCADE_SNAPSHOT_THRESHOLD`, in `persistence-adapter.ts`) — call `adapter.snapshot()`, a best-effort copy of the current file into a `.snapshots/` folder next to it; this is separate from (and much lighter than) the real history log above, with no retention or pruning. A `<project.json>.lock` file (holding the owning process's PID) is acquired via `adapter.acquireLock()` to guard against two processes (e.g. `start` and `mcp` pointed at the same `--project`) opening the same file at once: a stale lock left by a dead process is reclaimed silently, a lock held by a still-live process throws. `PersistenceAdapter` stays JSON-only (`createJsonFileAdapter`) — no SQLite prototype; see `### Performance` for the measured numbers that back that call.

**Repeatable import** (`src/analysis/import.ts`): `importProject(store, nodes, edges, meta?)` matches `ImportCandidateNode[]` against existing nodes by `sourcePath` (same type → `updateNode`; different type on the same `sourcePath` → reported as a `conflicts` entry, existing node left untouched; no match → `createNode`), remapping caller-local `tempId`s to real ids for `parentId`/edge endpoints, and firing `recordSync` when a candidate carries `sourceHash`. Runs inside one `store.transaction`. This is what makes `codebase-import.md`'s re-import path safe — `import_graph(mode:"merge")` upserts by real id and has no way to know ids a prior import generated, so it's for first-import bootstrap only.

**Sync reporting** (`src/analysis/sync-report.ts`): `detectConflicts(store, hashes, scope?)` buckets every node with a `sourcePath` (or an explicit `scope` of ids) by `determineSyncStatus` into `{inSync, codeChanged, graphChanged, conflict, codeDeleted, unknown}` — a `code_deleted` status means the caller passed `currentHash: null` (confirmed gone), not `undefined` (not checked). Wraps `getBulkSyncStatus` without changing it.

**Agent-facing analysis** (`src/analysis/summary.ts`, `search.ts`, `context.ts`): `summarizeProject(graph, topN?)` is a read-only aggregate over data that already exists (counts by type, `checkProjectHealth`/`validateProjectGraph` reused as-is, top-N nodes by `getAffectedNodes(...).length`, nodes with neither `generated` nor `sourcePath` set). `searchGraph(graph, query, opts?)` is a linear case-insensitive substring filter over label/props — no index, deliberately, at the node counts a single project graph holds. `getProjectContext(store, nodeId, opts?)` is the bounded alternative to `get_project("all")` for working on one node: `depth` hard-clamps to 5, `maxNodes` hard-clamps to 200, and `related` entries carry only id/type/label/depth/direction/via (never full props — call `get_node` for detail). `getAffectedNodes`/the new `getTransitiveDependencies` (`src/analysis/dependencies.ts`) both accept `opts.maxDepth` to stop the BFS early instead of walking the whole graph and discarding.

### Two servers, one store (`src/server.ts`, `src/mcp/server.ts`)

Both `createServer` (Express REST API) and `createMcpServer` (MCP tools over stdio) are thin wrappers around the same `ProjectStore`, the same `validation/rules.ts` tables, and the same `src/analysis/*`/`src/sync/*` functions — they expose the same operations (`get_schema`/`GET /api/schema`, `create_node`/`POST /api/nodes`, `validate_project`/`GET /api/validate`, `get_dependents`/`GET /api/nodes/:id/dependents`, `analyze_change`/`POST /api/analyze-change`, `undo`/`POST /api/history/undo`, `record_sync`/`POST /api/nodes/:id/sync`, `get_audit_log`/`GET /api/audit-log`, `export_markdown`/`GET /api/export/markdown`, etc.) through two transports. When adding a new store or analysis operation, wire it into both, keeping the shape of errors consistent (`ValidationError.issues` surfaced as `{ error, issues }` over HTTP and as an `isError: true` text result over MCP) — and keep `src/mcp/server.test.ts`'s `EXPECTED_TOOLS` list in sync. Auth/authorization/audit are REST-only middleware (`src/security/`, `src/audit/`) — MCP has no equivalent transport-level layer (stdio's trust boundary is the spawning process itself); its permission/audit hooks live inside `createMcpServer` instead (`tryWriteResult`, the wrapped `registerTool`), see `### Permissions`/`### Audit log`.

The Express server also statically serves `client/dist` (built React SPA) with a catch-all route, if that directory exists — so the CLI's `start` command doubles as both API and app server.

### Security (`src/security/auth.ts`, `project-name.ts`)

Local mode (default) is unchanged: no `--token`/env var/config file configured means `authMiddleware` is a no-op and every request is treated as `"owner"`. `resolveAuthToken(cliToken?)` precedence: `--token` flag > `PROJECT_VISUALIZER_TOKEN` env var > `~/.project-visualizer/config.json`'s `token` field. When a token *is* configured, `authMiddleware` requires `Authorization: Bearer <token>` (constant-time compared via `node:crypto`'s `timingSafeEqual`) — 401 otherwise. `startServer` refuses to bind to any host other than `127.0.0.1`/`localhost`/`::1` unless a token is configured or `--allow-insecure-lan` is passed explicitly (a hard error, not just the old console warning). `express.json()`'s body limit is `5mb` (overridable via `PROJECT_VISUALIZER_BODY_LIMIT`), up from body-parser's 100kb default — a bulk import of a few hundred nodes could already exceed that, independent of any attacker. `express-rate-limit` (300 req/min) is mounted only when a token is configured or the bind is non-loopback — pure local usage sees no new limiter. MCP has no auth layer of its own (stdio is already inside the process-spawn trust boundary) — its actual guard is `assertValidProjectName` (`src/security/project-name.ts`): a whitelist regex (`^[A-Za-z0-9_-]{1,100}$`) enforced once, at the top of `createProjectStore`, rejecting any `--project` value containing `..`/path separators before it ever reaches `PersistenceAdapter`.

### Permissions (`src/security/permissions.ts`)

A seam, not a system: `Role = "owner" | "admin" | "editor" | "viewer" | "agent"`, `canPerform(role, "read" | "write")` — every role reads, every role but `viewer` writes. No user table, no per-node ACL, no JWT. `TransactionMeta`/`HistoryEntry` both carry an optional `role` alongside `source`/`author`, threaded the same way. Today there's exactly one identity per running process (a single `--token`, not a multi-user token file), so `createServer`/`createMcpServer` take a single fixed `role` option (default `"owner"`, ignored entirely in local mode — no auth configured always means full access, no regression): REST enforces it via `authorizationMiddleware` (`GET`/`HEAD` → read, everything else → write, 403 on failure); MCP enforces it via `tryWriteResult(role, fn)`, the write-gated sibling of `tryResult` used by all 14 mutating tools. `dist/cli.js mcp --project X --role viewer` is the intended use — a read-only analysis agent that structurally cannot mutate the graph.

### Audit log (`src/audit/audit-log.ts`)

Deliberately separate from the history log above: history is replayable (`undo`/`redo`/`restoreVersion` walk it forward/backward) and only records transactions that changed something; an audit log is append-only, records *every* operation including reads and failures, and is never replayed — mixing the two would force the replay code to filter out entries it can't apply, for no real benefit. Lives at `.audit/audit.jsonl` next to `project.json` (sibling of `.history/`, `.snapshots/`). `store.recordAudit(entry)`/`listAuditLog(opts?)` are the only access points. REST logs every request via a `res.on("finish")` middleware (mounted before the routes, so it never adds latency to the response itself); MCP wraps `server.registerTool` itself once (not each of the ~30 call sites) so every tool gets audited automatically. Never logs full node props — only `{nodeId, nodeType}` as `target`. Exposed the same way as history: `GET /api/audit-log` and the `get_audit_log` MCP tool.

### Performance (`src/perf/synth.ts`, `bench.ts`)

`generateSyntheticGraph(n)` builds realistic backend+frontend clusters (domain→route→endpoint→middleware→service→repository wired to db/orm/table/model via real `REF_FIELDS`, plus a page→component→apiCall/form chain) rather than a flat pile of disconnected nodes — `npm run perf` (`node dist/perf/bench.js`, a standalone script, not a Vitest suite: a CI performance threshold is flaky by construction) times `validateProjectGraph`, `checkProjectHealth`, `getDependents`/`getAffectedNodes`, `exportMarkdown`, JSON (de)serialization, and `PersistenceAdapter.save`/`.load` at 100/500/1000/5000/10000 nodes.

`checkProjectHealth` was measurably quadratic (21ms at 1000 nodes → 1.9s at 10k) — confirmed as `findUnusedNodes` and `summarizeProject`'s `topConnected` calling `getDependents`/`getAffectedNodes` once per candidate node, each doing its own full reverse-scan of `REF_FIELDS`. Fixed by `buildDependentsIndex(graph)` (`src/analysis/dependencies.ts`): one O(nodes + edges) pass builds a `targetId -> RelatedNode[]` map up front; `getDependents(id, graph, index)` then looks it up in O(1), and `getAffectedNodes(id, graph, { index })` reuses the same index across every BFS hop. `findUnusedNodes` and `summarizeProject` now build the index once and pass it through instead of calling `getDependents`/`getAffectedNodes` in a loop. Re-measured: `checkProjectHealth` at 10k nodes went from 1.9s to **15ms** — back in line with `validateProjectGraph`'s linear growth. A one-off `getDependents`/`getAffectedNodes` call (no index passed) is unaffected — it builds a throwaway index internally, same cost as the old inline scan.

`exportMarkdown` was also measurably quadratic (6ms → 562ms, 1000 → 10k nodes) — its own `hierarchyChildren(nodeId, edges, nodesById)` helper did an `edges.filter(...)` scan on every call, and the tree walk (`renderDomain`→`renderRoute`→`renderEndpoint`→`renderOperation`, plus `resolveChain`'s middleware-chain walk) called it repeatedly per node, making the whole export O(nodes × edges). Fixed the same way: `buildChildrenIndex(nodes, edges)` builds a `parentId -> AnyGraphNode[]` map once per `exportMarkdown` call; `hierarchyChildren`/`collectDescendants`/`resolveChain`/`renderChain` all take that index instead of re-scanning `edges`. `resolveChain`'s loop also gained a proper `visited` cycle guard (previously bounded by `nodesById.size`, which was really a correctness fix riding along with the perf one). Re-measured: `exportMarkdown` at 10k nodes went from 562ms to **17.3ms**, linear like the rest.

### Markdown export (`src/export/markdown.ts`)

`exportMarkdown(graph, validation?, domainId?)` renders the graph into an LLM-context-friendly markdown document: manifest, then per-domain trees (route nesting, an endpoint's shared headers/access (`isPublic`/`authMethods`) + its own middleware chain if it has no `operation` children, each `operation` child rendered with its own query/params/body/aggregated-returns table via the shared `renderChain` helper, cache config), floating infra sections (models/tables/tools/external APIs/emails), then frontend (navigation, pages with their component/apiCall/form descendants, stores), then validation warnings.

### Agent skills (`skills/*.md`)

Written for an AI agent driving the MCP server, not for humans:
- `codebase-import.md` — bootstrap a graph from an existing codebase (code → graph, one-shot/replace).
- `project-scaffold.md` — generate a real codebase from a graph (graph → code, phase-by-phase: schema → stack → backend by hierarchy walk → frontend by hierarchy walk → mark `generated: true`).
- `project-sync.md` — keep an already-scaffolded codebase and the graph consistent both directions (push via `generated`/`updatedAt` staleness, pull via re-reading source and reconciling).

These encode the intended workflow contract (e.g. "never silently delete nodes to fix broken refs", "don't mark `generated: true` on an import") — read them before changing anything that a scaffold/sync agent would rely on (validation error codes, ref field paths, the `generated` flag's meaning).

### Client (`client/src/`)

- `context/GraphContext.tsx` — the one global state container: fetches `/api/project` + `/api/schema` on mount, exposes `nodes/edges/manifest/schema/connectionRules` plus `refPortRules`/`arrayRefPorts`/`chainTargetTypes` (ports, see below) and `selectedNodeId` to the whole tree. `connectionRules` is derived from the schema's `connections` list via `buildRuleMap` (`components/canvas/edgeValidation.ts`) and used to allow/reject drag-to-connect on the canvas client-side (mirroring, not replacing, server-side validation).
- `api/client.ts` — the only place that talks to the REST API; typed wrappers, one `ApiError` with an optional `issues` array pass-through from the server's validation errors.
- `components/canvas/refEdges.ts` — turns `schema.refFields` into canvas ports, Unity Shader-Graph style, entirely client-side (never persisted as `graph.edges`): a single-value ref field (`table.dbId`) renders as a labeled INPUT port on the holder's left (`buildRefPortRules`/`RefPortRules.inputs`), and the referenced type gets one generic OUTPUT port on its right (`RefPortRules.outputs`, handle id `REF_OUTPUT_HANDLE`) that anything holding a matching field can wire into. An array-shaped `x[].y` ref field (currently only `returns[].chainToId` on `middleware`/`operation`) instead gives the holder one OUTPUT port *per array item* (`buildArrayRefPorts`, handle id via `chainPortHandle`), each optionally wired into a shared generic INPUT port (`CHAIN_INPUT_HANDLE`) on every type in `buildChainTargetTypes` (middleware/service/errorHandler). `synthesizeRefEdges`/`synthesizeChainEdges` derive the actual dashed preview edges from current prop values each render, deduped against real hierarchy edges connecting the same pair. `GraphCanvas.tsx`'s `isValidConnection`/`handleConnect` branch on `connection.targetHandle` to route a drag/quick-add to the right prop write.
- `components/canvas/` — React Flow canvas: `GraphCanvas` (nodes/edges rendering + connect/move handlers + the port wiring above), `GenericNode` (generic per-type node renderer, renders the port rows), `ContainerNode` (the visual-only `containerId` grouping, shared by `container`/`boundary`), `NoteNode` (the `note` sticky).
- `components/properties/` — the node inspector/edit form: `PropertyPanel` (also computes `inheritedReturns` — the middleware-chain + service-errors aggregate for `endpoint`/`operation`, since a middleware can short-circuit or call `next()` and let the endpoint/operation send the final code) → `PropertyForm` (has type-specific field overrides, e.g. filtering an `operation`'s method options to what's still free on the parent endpoint, or swapping a `model`'s freeform `schema` editor for a checklist of its linked `table`'s columns) → `FieldRenderer`/`ArrayField`/`RefSelectField`, driven by `schema/nodeSchemas.ts` (per-type field definitions used to render the right input for each `props` field, including ref-picker fields).
- `components/palette/`, `components/layout/` — node palette (create-node drag source, scoped to current tab's node types) and top-level layout (`Tabs` for backend/frontend/overview, `Toolbar` for validate/export actions).
- The graph data model lives in `packages/shared/src/graph.ts` (npm workspace package `@project-visualizer/shared`), imported by both the server (`src/types/graph.ts` re-exports it) and the client (aliased to the same source file via `client/vite.config.ts` and `client/tsconfig.json` — no build step needed for client dev, `npm run build` in root compiles it for the server). Change the model in one place only.
- **Search/filter/focus/collapse/auto-layout** (`components/canvas/graphSearch.ts`, `hierarchy.ts`, `layout.ts`, `CanvasSearchPanel.tsx`): all view-only state (`searchQuery`, `typeFilter`, `collapsedIds`, `focusSet`) lives local to `GraphCanvas`, never in `GraphContext` — it's ephemeral per-tab UI state, not graph data, and doesn't need to survive a tab switch. Search/filter/focus dim non-matching nodes via CSS `opacity` (a `dimmed` prop threaded through `GenericNode`/`ContainerNode`/`NoteNode`) rather than removing them from the React Flow render — reversible with no layout recalculation. Collapse/expand (`getDescendantIds`, hierarchy-edges-only BFS) is the one case that actually removes nodes/edges from the render, since the user explicitly asked for them to disappear. `computeAutoLayout` (`layout.ts`) is a zero-dependency layered BFS (depth = row, appearance order = column) — no `dagre`/`elkjs`, written after the tips of "cross-minimization would be over-engineering for an occasional tidy-up button". Auto-layout writes positions via `api.batchUpdatePositions` (`POST /api/batch`, one `setPosition` op per node) — a single request, not N sequential `PATCH`es.
- **Testing** (`client/vitest.config.ts`, `src/test/setup.ts`): its own Vitest instance (`environment: "jsdom"`, no `globals: true` — same explicit-import style as the root config), run via `npm run test:client` from the root or `npm test` inside `client/`. `setup.ts` wires `@testing-library/jest-dom`, a `ResizeObserver` stub (jsdom has none; React Flow needs one), and an explicit `afterEach(() => cleanup())` (no `globals: true` means `@testing-library/react`'s own auto-cleanup never self-registers).

## Conventions worth knowing

- Backend source (`src/`) compiles under `NodeNext` module resolution — internal imports use explicit `.js` extensions (e.g. `from "../store/project-store.js"`) even though the source files are `.ts`.
- Tests live next to source as `*.test.ts` (Vitest, `environment: "node"`); there is no separate `test/` directory.
- Some CLI-facing strings (wizard prompts, template labels/descriptions) are in Spanish; code identifiers, types, and comments are in English. Match whichever you're editing.
- Theming (`client/src/styles/global.css`) supports both `prefers-color-scheme: dark` and an explicit `data-theme="dark"|"light"` override via CSS vars. React Flow ships its own light-only stylesheet whose controls/minimap/attribution have a fixed near-white background while their icons inherit `currentColor` from our theme — any new React Flow chrome needs an explicit `--color-*`-based override in `global.css` (see the `.react-flow__controls-button` block) or it goes invisible in dark mode. Edges default to `type: "smoothstep"` (`defaultEdgeOptions` on `<ReactFlow>`) to keep multi-port nodes from turning into a bezier tangle.

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