# Skill: Codebase Import (bootstrap a graph from an existing project)

## When to use
There is a real codebase and no graph yet (or the user wants to rebuild the
graph from what's actually deployed), OR the graph already exists and needs
to be re-scanned to pick up new/changed code without duplicating nodes.

## Hash specification (normative — must match project-sync.md exactly)
Whenever a candidate carries `sourceHash`, compute it as: **sha256 hex digest
of the raw file content, unnormalized** (`node:crypto`:
`createHash("sha256").update(fileBuffer).digest("hex")`, or the equivalent in
whatever language/tool the agent's environment provides). Using a different
algorithm/encoding than project-sync.md makes every cross-check between the
two skills meaningless.

## Steps — first import (empty project)
1. get_schema() once.
2. Inspect the codebase and build an in-memory nodes[]/edges[] list matching
   the schema: one domain per top-level module/service; route/endpoint per
   router/controller method; middleware chain in call order with a service
   at the end; model/table from ORM schema files or migrations; page/
   component/form from the frontend router + component tree, with
   apiCall.endpointRef best-effort matched by path+method to the backend
   endpoint you just created (leave unmatched if unsure — let validate_project
   flag it rather than guessing). Record each node's source file path.
3. Call import_graph(nodes, edges, mode: "replace") only on a fresh/empty
   project.
4. Call validate_project(). Report every BROKEN REF / MISSING FIELD /
   INVALID HIERARCHY warning to the user.
5. Do not mark anything generated: true here — that flag means "code was
   generated FROM the graph"; here the graph was generated FROM the code.

## Steps — re-import (graph already has nodes)
Never use import_graph(mode:"merge") for this — it upserts by node id, and a
fresh static-analysis pass has no way to know the ids a previous import
generated, so it duplicates everything instead of updating it.

1. get_project(scope:"all") to see what's already there (informational only —
   import_project does the actual matching).
2. Build the same nodes[]/edges[] shape as a first import, but as
   ImportCandidateNode/ImportCandidateEdge: give each node a `tempId` (any
   locally-unique string — never persisted), set `sourcePath` to the file it
   came from, and set `sourceHash` (per the spec above) so the node is
   stamped in_sync immediately. Reference other candidates in this same batch
   via their `tempId` in `parentId` / edge `sourceId`/`targetId` — real
   existing ids also work unchanged.
3. Call import_project(nodes, edges). It matches each candidate against
   existing nodes by `sourcePath`: same type -> updates it in place; a
   different type on the same sourcePath -> reported as a conflict, the
   existing node is left untouched; no match -> creates a new node. tempIds
   are remapped to real ids for you, including inside edges.
4. Report the result to the user exactly as returned:
   - `created` / `updated`: counts, informational.
   - `conflicts`: a sourcePath that now disagrees on node type — never
     resolved automatically, ask the user which side is right.
   - `orphaned`: existing nodes whose sourcePath wasn't seen in this batch —
     only trust this as "these files are gone" if the batch was a full
     re-scan of the same root as the original import; a partial scan will
     over-report. Never delete these nodes yourself — report and ask.
5. Call validate_project() and report remaining warnings.
6. Do not mark anything generated: true — same rule as a first import.
