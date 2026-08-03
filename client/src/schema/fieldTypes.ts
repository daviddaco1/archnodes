import type { NodeType } from "../types/graph";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "refSelect" // ref to another node of the SAME tab (e.g. service.props.ormId -> Orm)
  | "refSelectCrossTab" // ref to a node in the OTHER tab (e.g. apiCall.props.endpointRef -> Endpoint)
  | "arrayOfObjects"; // e.g. Table.props.columns[]

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[]; // for 'select'
  refNodeType?: NodeType | NodeType[]; // for refSelect / refSelectCrossTab
  itemSchema?: FieldDef[]; // for arrayOfObjects (recursive)
  placeholder?: string;
}

export interface SuggestedCompanion {
  type: NodeType;
  reason: string;
}

export interface NodeTypeSchema {
  type: NodeType;
  category: "backend" | "frontend" | "structure";
  color: string;
  icon: string;
  summaryFields: string[];
  fields: FieldDef[];
  suggestedCompanions?: SuggestedCompanion[];
}
