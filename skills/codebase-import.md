# Skill: Codebase Import (bootstrap a graph from an existing project)

## When to use
There is a real codebase and no graph yet (or the user wants to rebuild the
graph from what's actually deployed).

## Steps
1. get_schema() once.
2. Inspect the codebase and build an in-memory nodes[]/edges[] list matching
   the schema: one domain per top-level module/service; route/endpoint per
   router/controller method; middleware chain in call order with a service
   at the end; model/table from ORM schema files or migrations; page/
   component/form from the frontend router + component tree, with
   apiCall.endpointRef best-effort matched by path+method to the backend
   endpoint you just created (leave unmatched if unsure — let validate_project
   flag it rather than guessing).
3. Call import_graph(nodes, edges, mode: "replace") only on a fresh/empty
   project; use "merge" if manually-authored nodes already exist and
   shouldn't be lost.
4. Call validate_project(). Report every BROKEN REF / MISSING FIELD /
   INVALID HIERARCHY warning to the user — these usually mean step 2's
   static analysis guessed wrong and need a manual update_node/connect_nodes
   fix or user input.
5. Do not mark anything generated: true here — that flag means "code was
   generated FROM the graph"; here the graph was generated FROM the code.
   Leave it unset so project-sync treats these nodes as ground truth.
