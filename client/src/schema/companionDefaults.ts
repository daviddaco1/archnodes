import type { AnyGraphNode, NodeType } from "../types/graph";

// Best-effort default props for one-click companion creation from PropertyPanel suggestions.
// Only covers the companion types nodeSchemas actually suggests — this is a UI convenience,
// not a general node factory, so it doesn't try to satisfy every possible required field.
export function defaultCompanionProps(type: NodeType, existingNodes: AnyGraphNode[]): Record<string, unknown> {
  const props: Record<string, unknown> = { name: `Nuevo ${type}` };
  if (type === "orm") {
    const db = existingNodes.find((n) => n.type === "db");
    if (db) props.dbId = db.id;
  }
  if (type === "repository") {
    const orm = existingNodes.find((n) => n.type === "orm");
    if (orm) props.ormId = orm.id;
    const entity = existingNodes.find((n) => n.type === "model" || n.type === "table");
    if (entity) props.entityRef = entity.id;
  }
  if (type === "middleware") props.hasNext = true;
  if (type === "stateStore") props.library = "context";
  return props;
}
