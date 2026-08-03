# Skill: Project Sync (Graph <-> Existing Codebase, incremental)

## When to use
The graph and the real codebase already both exist and may have drifted.

## Direction A: Graph -> Code (push)
1. get_project(scope: "all"), validate_project().
2. Find nodes where generated is false/undefined, or updatedAt is newer than
   the last generation you're aware of (track this yourself; the graph has
   no built-in "last synced" flag).
3. Regenerate only the affected code unit per the same per-type rules as
   project-scaffold.
4. Mark synced nodes with update_node(id, { generated: true }).

## Direction B: Code -> Graph (pull)
1. Read the real codebase's routes/services/pages by whatever fits the
   language (static analysis, framework introspection, or reading source).
2. For code with no matching node in get_project(), create_node with the
   right type/props/parentId, then connect_nodes for special edges (invalidates).
3. For nodes whose graph fields disagree with the real code, update_node to
   correct the graph — after a pull, the graph should describe the current code.
4. Finish with validate_project() and report remaining warnings to the user;
   do not silently delete nodes to fix broken refs.

## Conflict handling
If a node changed on both sides since last sync, ask the user which side
wins unless the change is purely additive (new optional field) on both sides.
