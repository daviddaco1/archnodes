# Skill: Project Sync (Graph <-> Existing Codebase, incremental)

## When to use
The graph and the real codebase already both exist and may have drifted.

## Hash specification (normative — must match codebase-import.md exactly)
For each node with `sourcePath`, compute **sha256 hex digest of the raw file
content, unnormalized** (`node:crypto`: `createHash("sha256").update(fileBuffer)
.digest("hex")`, or the language/tool-equivalent). A different algorithm or
encoding than codebase-import.md makes every comparison meaningless.

## Step 1 — Collect hashes
For every node with `sourcePath` (via `get_project(scope:"all")`), read the
file and hash it per the spec above. If the file no longer exists, use `null`
explicitly for that node id — **do not omit the key**: omitting means "not
checked", `null` means "confirmed gone".

## Step 2 — detect_conflicts(hashes)
Call `detect_conflicts` once with the full hash map. Act per bucket:

- **inSync**: nothing to do.
- **graphChanged** (graph edited since last sync, code unchanged): push —
  regenerate the code unit per project-scaffold.md's rules, then
  `record_sync(id, { sourceHash: <new hash> })`.
- **codeChanged** (code edited since last sync, graph unchanged): pull —
  update the node from the real code (`update_node`), then `record_sync`.
- **conflict** (both sides changed): stop and ask the user which side wins,
  unless the change is purely additive (a new optional field) on both sides.
- **codeDeleted**: report to the user. Never delete the node automatically —
  ask whether to remove it or whether the file was supposed to still exist.
- **unknown** (never synced, or no hash was available): first sync for this
  node — decide direction (push if `generated:true`, pull otherwise), then
  `record_sync`.

## Step 3 — New code with no matching node (Added)
Walk the real codebase for units that have no corresponding `sourcePath` in
the graph. Before creating a node for one, call `list_history()` and check
for a recent `deleteNode` entry whose diff touched that `sourcePath` — if one
exists, tell the user ("this file had a node deleted on `<date>` via
`<source>` — recreate it, or was that intentional?") instead of silently
recreating it. If nothing suggests an intentional delete, `create_node` +
`connect_nodes` (for special edges) + `record_sync`.

## SYNC REPORT
Always present a summary, with labels/sourcePaths per bucket, not just counts:

```
Added: <N>
Modified (code_changed): <N>
Graph-ahead (graph_changed): <N>
Removed (code_deleted): <N>
Conflicts: <N>
Unresolved (unknown): <N>
```
