# ArchNodes (project-visualizer)

**Language:** English | [Español](README.es.md)

A visual architecture editor for backend and frontend systems, paired with an MCP server so AI agents can read and edit the same project graph. Design your domains, routes, endpoints, services, models, pages, and components as a typed node graph on a canvas — then let an AI agent (or the built-in skills) generate real code from it, keep code and graph in sync, or reverse-engineer a graph from an existing codebase.

## Why

Most "architecture diagrams" are static pictures that drift from the code the moment they're drawn. ArchNodes models the architecture as structured data (a typed graph with validation rules), exposes it over both a REST API (for the visual editor) and an MCP server (for AI agents), and ships with agent skills that describe exactly how to turn that graph into code and back.

## Features

- **Visual canvas** (React Flow) to place, connect, and organize nodes into containers/boundaries, with a property panel, node palette, validation panel, and project overview tab. Ref-field relationships (e.g. `table.dbId`) render as dedicated, labeled ports — Unity Shader-Graph style — instead of a single generic connector, so a node with several relationships doesn't turn into one tangled dot.
- **Typed node schema** covering both backend (`domain`, `subdomain`, `route`, `endpoint`, `operation`, `middleware`, `service`, `model`, `table`, `db`, `orm`, `repository`, `tool`, `queue`, `externalApi`, `scheduler`, `errorHandler`, `envConfig`, `websocket`, `websocketEvent`, `websocketEmit`, `email`, `redisKey`) and frontend (`page`, `layout`, `component`, `form`, `stateStore`, `apiCall`, `hook`, `navigationRouter`, `guard`, `modalDialog`, `themeToken`, `asset`) concerns, plus structural `container`/`boundary`/`note` nodes.
- **Multi-method endpoints**: one `endpoint` node lists every HTTP method it supports and holds what's shared (headers, cache config, public/auth requirements); an optional `operation` child per method holds that method's own query/params/body and outputs, so GET/POST/etc. on the same route don't need separate endpoint nodes.
- **Validation rules**: hierarchy constraints, required fields, ref-field integrity, per-operation method consistency (must be one of the endpoint's declared methods, no duplicates among siblings), and special edges (e.g. cache `invalidates` relationships).
- **MCP server** (stdio) exposing tools for AI agents: `get_schema`, `get_project`, `list_nodes`, `get_node`, `validate_project`, `create_node`, `update_node`, `delete_node`, `connect_nodes`, `import_graph`, `export_markdown`.
- **REST API + static file server** for the visual editor, with the same CRUD/validate/export surface as the MCP tools.
- **Markdown export** of the project graph as a context document (optionally scoped to backend/frontend or a single domain).
- **CLI** with `start`, `mcp`, and `init` (interactive wizard or stack templates) commands.
- **Stack templates**: Express+PostgreSQL(Prisma)+React, NestJS+PostgreSQL(TypeORM)+Angular, Express+MongoDB(Mongoose)+React, FastAPI+PostgreSQL(SQLAlchemy)+React, Fastify+PostgreSQL(Drizzle)+Vue, and a microservices starter.
- **Agent skills** (`skills/`) documenting three workflows for AI agents: `project-scaffold` (graph → generated code), `project-sync` (keep graph and code in sync in either direction), `codebase-import` (existing code → graph).

## Project structure

```
src/                  Server, CLI, MCP server, validation rules, project store, markdown export
  cli.ts              Entry point: start | mcp | init
  server.ts           Express REST API + static client host
  mcp/server.ts        MCP stdio server (tools for AI agents)
  store/               In-memory/persisted project graph store
  validation/          Hierarchy, required-field, and ref-field rules
  init/                Interactive wizard + stack templates
  export/              Markdown export of the graph
  types/graph.ts       Node/edge/manifest type definitions
client/               React + Vite + React Flow visual editor (served by src/server.ts in production)
skills/               Markdown "skills" describing agent workflows over the MCP tools
```

## Requirements

- Node.js >= 18.3.0

## Installation

```bash
npm install
npm run build          # compiles src/ -> dist/
cd client && npm install && npm run build   # builds the visual editor (client/dist)
```

## Usage

### Start the visual editor

```bash
node dist/cli.js start --project my-project [--port 4173]
```

Opens the REST API and serves the built client at `http://localhost:<port>` (default `4173`), also reachable from your LAN.

### Start the MCP server (for AI agents)

```bash
node dist/cli.js mcp --project my-project
```

Speaks MCP over stdio. Point your MCP-compatible AI client/agent at this command to give it read/write access to the project graph (see the tool list under Features, and `skills/` for recommended workflows).

### Initialize a project

```bash
# Interactive wizard (language, framework, database, architecture, domains)
node dist/cli.js init --project my-project

# Or from a predefined stack template
node dist/cli.js init --project my-project --template node-express-postgres-react
```

Run `node dist/cli.js` with no arguments to see the full usage help and the list of available templates.

## Development

```bash
npm run dev        # tsc -w, watch-compile the server/CLI/MCP code
npm test           # vitest run
npm run test:watch # vitest, watch mode

cd client
npm run dev        # Vite dev server for the visual editor
```

## Agent skills

The `skills/` folder contains three Markdown playbooks intended to be loaded by an AI agent connected to the MCP server:

- **`project-scaffold.md`** — generate a real codebase from a validated graph, walking domains → routes → endpoints → middleware chains → services → data layer, then frontend routers → pages → components/forms → API calls.
- **`project-sync.md`** — keep the graph and an existing codebase in sync in either direction (graph → code or code → graph), with conflict-handling guidance.
- **`codebase-import.md`** — bootstrap a graph from an existing codebase by statically analyzing it and importing the result via `import_graph`.

## License

Not specified.
