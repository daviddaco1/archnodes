# Skill: Project Scaffold (Backend + Frontend from Graph)

## When to use
The user has built (or wants help building) a visual architecture graph in
project-visualizer and wants a real, running codebase generated from it.

## Required tools
get_schema, get_project, validate_project, list_nodes, get_node, update_node.

## Phase 0 — Understand the graph
1. Call get_schema() once per session (hierarchy rules + required fields + ref fields).
2. Call get_project(scope: "all").
3. Call validate_project(). If there are error-level issues, tell the user and
   ask whether to fix the graph first (via create_node/update_node/connect_nodes)
   or proceed anyway. Never silently generate code around broken refs.

## Phase 1 — Decide the stack
Read manifest.language / manifest.framework / manifest.architecture /
manifest.databases. If missing, ask the user or infer from existing db/orm/tool
nodes before writing any file.

## Phase 2 — Walk backend by dependency order
For each top-level domain node (no parentId):
  1. Generate the domain's folder/module skeleton per the chosen framework.
  2. For each subdomain/route child (routes can nest under routes), generate the router file.
  3. For each endpoint under a route:
     - Walk the middleware chain (endpoint's hierarchy children, then their
       children, in nesting order) and generate wiring in that exact order.
     - Generate the service(s) at the end of the chain. For every ref the
       service points to (ormId, or children like repository/model/table/
       tool/queue/externalApi/email/redisKey), resolve with
       get_node(id, resolveRefs: true) and generate the matching code.
     - If props.cacheable.enabled, generate cache read-through logic from
       keyPattern/ttl, and wire invalidation for any "invalidates" edges
       targeting this endpoint's keys.
  4. Generate model/table definitions once each (dedupe across endpoints).
  5. Generate floating infra nodes (tool, queue, scheduler, errorHandler,
     envConfig, websocket, email) only for what step 3 actually referenced.

## Phase 3 — Walk frontend
For each navigationRouter: generate router config from props.routes.
For each page: generate the page file, wire layoutId/guardId, recurse into
component/form/modalDialog children.
For each apiCall: resolve props.endpointRef via get_node and generate a typed
client call matching that endpoint's method/input/output.
For each form: resolve props.modelRef for field types, props.apiCallId for submit.
Generate stateStore nodes referenced by any apiCall.storeId or component.

## Phase 4 — Mark progress
After generating code for a node, call update_node(id, { generated: true })
so re-runs (or project-sync) skip already-generated nodes unless asked to
fully regenerate.

## Guardrails
- Never invent a relationship get_schema() doesn't allow. If you need one
  that doesn't exist, use connect_nodes (or ask the user) instead of guessing.
- Re-run validate_project() after any create_node/connect_nodes/import_graph
  call you make during this skill.
