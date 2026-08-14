import type { RefFieldSpec, SchemaResponse } from "../../api/client";
import type { AnyGraphNode, NodeType } from "../../types/graph";

// Single-value ref fields (props.dbId, props.ormId, etc.) are a real relationship — the backend
// already validates them (REF_FIELDS) — but until now they were only visible/editable as a
// dropdown buried in the property panel, or a single generic top/bottom dot indistinguishable from
// every other relationship on the node. This models each one as a dedicated, labeled port, Unity
// Shader-Graph style: the holder node gets one INPUT port per own field on its LEFT (it needs a
// value), and the referenced type gets a single generic OUTPUT port on its RIGHT (anyone can wire
// into it). The holder always keeps the field — this only changes which side of the canvas the dot
// lives on.
// Array-valued ref fields where the array holds unrelated free-form items (table.relations[],
// navigationRouter.routes[], layout.slots[]) don't get ports — a single edge can't represent "one
// of many" cleanly. The one shape that DOES get ports is an array item's "chainToId" field
// (returns[].chainToId on operation/middleware, errors[].chainToId on service/email): each such
// item is already its own named thing (a status code), so each one becomes its own OUTPUT port
// (choosing where a given outcome routes to), and the chain target (middleware/service/
// errorHandler) gets one generic INPUT port any of them can land on — mirrors Sample Texture 2D's
// per-channel outputs in the Unity reference.

export interface RefInputPort {
  field: string;
  targetTypes: NodeType[];
}

export interface RefOutputOption {
  holderType: NodeType;
  field: string;
}

export const REF_OUTPUT_HANDLE = "ref-out";

export interface RefPortRules {
  inputs: Map<NodeType, RefInputPort[]>; // holder type -> its own ports (left side)
  outputs: Map<NodeType, RefOutputOption[]>; // referenced type -> who can point at it (right side)
}

export function buildRefPortRules(refFields: SchemaResponse["refFields"] | undefined): RefPortRules {
  const inputs: RefPortRules["inputs"] = new Map();
  const outputs: RefPortRules["outputs"] = new Map();
  if (!refFields) return { inputs, outputs };
  for (const [holderType, specs] of Object.entries(refFields) as [NodeType, RefFieldSpec[]][]) {
    for (const spec of specs) {
      if (spec.array) continue;
      const targetTypes = Array.isArray(spec.targetType) ? spec.targetType : [spec.targetType];
      const inList = inputs.get(holderType) ?? [];
      inList.push({ field: spec.field, targetTypes });
      inputs.set(holderType, inList);
      for (const targetType of targetTypes) {
        const outList = outputs.get(targetType) ?? [];
        outList.push({ holderType, field: spec.field });
        outputs.set(targetType, outList);
      }
    }
  }
  return { inputs, outputs };
}

export function refInputPort(rules: RefPortRules, holderType: NodeType, field: string): RefInputPort | undefined {
  return rules.inputs.get(holderType)?.find((p) => p.field === field);
}

export interface ArrayRefSpec {
  arrayField: string;
  itemField: string;
  targetTypes: NodeType[];
}

export const CHAIN_INPUT_HANDLE = "chain-in";

function parseArraySpec(spec: RefFieldSpec): ArrayRefSpec | undefined {
  if (!spec.array || !spec.field.includes("[].")) return undefined;
  const [arrayField, itemField] = spec.field.split("[].");
  // Only a chainToId item field gets chain ports — table.relations[].targetTableId,
  // navigationRouter.routes[].pageId, and layout.slots[].componentId are plain array refs, not
  // outcome-routing chains, and their items don't have the status/description shape chain port
  // labels read.
  if (itemField !== "chainToId") return undefined;
  const targetTypes = Array.isArray(spec.targetType) ? spec.targetType : [spec.targetType];
  return { arrayField, itemField, targetTypes };
}

// holder type -> its own array-item ports (right side, one row per array entry)
export function buildArrayRefPorts(refFields: SchemaResponse["refFields"] | undefined): Map<NodeType, ArrayRefSpec[]> {
  const map = new Map<NodeType, ArrayRefSpec[]>();
  if (!refFields) return map;
  for (const [holderType, specs] of Object.entries(refFields) as [NodeType, RefFieldSpec[]][]) {
    for (const spec of specs) {
      const parsed = parseArraySpec(spec);
      if (!parsed) continue;
      const list = map.get(holderType) ?? [];
      list.push(parsed);
      map.set(holderType, list);
    }
  }
  return map;
}

// Every type any array-item port can chain into — they all share one generic input port (left).
export function buildChainTargetTypes(refFields: SchemaResponse["refFields"] | undefined): Set<NodeType> {
  const set = new Set<NodeType>();
  if (!refFields) return set;
  for (const specs of Object.values(refFields) as RefFieldSpec[][]) {
    for (const spec of specs) {
      const parsed = parseArraySpec(spec);
      parsed?.targetTypes.forEach((t) => set.add(t));
    }
  }
  return set;
}

export function chainPortHandle(arrayField: string, index: number): string {
  return `chain__${arrayField}__${index}`;
}

export interface SyntheticChainEdge {
  id: string;
  source: string; // the node choosing where this outcome routes to
  target: string; // the chain-in receiver
  sourceHandle: string;
}

// Synthesizes one edge per array item that currently has its chain target set — same "derived,
// never stored" spirit as synthesizeRefEdges, just indexed into an array instead of a plain field.
export function synthesizeChainEdges(nodes: AnyGraphNode[], refFields: SchemaResponse["refFields"] | undefined): SyntheticChainEdge[] {
  if (!refFields) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: SyntheticChainEdge[] = [];
  for (const node of nodes) {
    const specs = (refFields[node.type as NodeType] ?? []).map(parseArraySpec).filter((s): s is ArrayRefSpec => Boolean(s));
    for (const spec of specs) {
      const items = (node.props as Record<string, unknown>)[spec.arrayField];
      if (!Array.isArray(items)) continue;
      items.forEach((item, index) => {
        const value = (item as Record<string, unknown> | null)?.[spec.itemField];
        if (typeof value === "string" && value && nodeIds.has(value)) {
          edges.push({ id: `${refEdgeId(node.id, spec.arrayField)}__${index}`, source: node.id, target: value, sourceHandle: chainPortHandle(spec.arrayField, index) });
        }
      });
    }
  }
  return edges;
}

const REF_EDGE_PREFIX = "ref__";

export function refEdgeId(nodeId: string, field: string): string {
  return `${REF_EDGE_PREFIX}${nodeId}__${field}`;
}

export type ParsedRefEdgeId =
  | { kind: "simple"; nodeId: string; field: string }
  | { kind: "chain"; nodeId: string; arrayField: string; index: number };

// A simple ref edge id is `ref__{nodeId}__{field}` (2 segments); a chain edge id (built in
// synthesizeChainEdges above) is `ref__{nodeId}__{arrayField}__{index}` (3 segments) — the index
// must round-trip or a "delete connection" click on a chain edge would wipe the whole array
// instead of clearing just that item's chainToId.
export function parseRefEdgeId(id: string): ParsedRefEdgeId | undefined {
  if (!id.startsWith(REF_EDGE_PREFIX)) return undefined;
  const parts = id.slice(REF_EDGE_PREFIX.length).split("__");
  if (parts.length === 3) {
    const [nodeId, arrayField, indexStr] = parts;
    const index = Number(indexStr);
    if (!nodeId || !arrayField || Number.isNaN(index)) return undefined;
    return { kind: "chain", nodeId, arrayField, index };
  }
  const [nodeId, field] = parts;
  if (!nodeId || !field) return undefined;
  return { kind: "simple", nodeId, field };
}

// Clears only item[index]'s chainToId, leaving the rest of the array (and the item itself) intact.
// Returns undefined if the array/index no longer matches what the canvas rendered (e.g. the item
// was removed between render and click) — the caller should then skip the update entirely.
export function clearChainEdgeItem(node: AnyGraphNode, arrayField: string, index: number): Record<string, unknown> | undefined {
  const items = (node.props as Record<string, unknown>)[arrayField];
  if (!Array.isArray(items) || !items[index]) return undefined;
  const next = [...items];
  next[index] = { ...next[index], chainToId: undefined };
  return { [arrayField]: next };
}

export interface SyntheticRefEdge {
  id: string;
  source: string; // the referenced node — has the output port
  target: string; // the node holding the field — has the input port
  field: string;
}

// Synthesizes one edge per single-value ref field that currently points at an existing node in
// this same tab — purely derived from current prop values, never stored in graph.edges itself.
export function synthesizeRefEdges(nodes: AnyGraphNode[], refFields: SchemaResponse["refFields"] | undefined): SyntheticRefEdge[] {
  if (!refFields) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: SyntheticRefEdge[] = [];
  for (const node of nodes) {
    const specs = refFields[node.type as NodeType];
    if (!specs) continue;
    const props = node.props as Record<string, unknown>;
    for (const spec of specs) {
      if (spec.array) continue;
      const value = props[spec.field];
      if (typeof value === "string" && value && nodeIds.has(value)) {
        edges.push({ id: refEdgeId(node.id, spec.field), source: value, target: node.id, field: spec.field });
      }
    }
  }
  return edges;
}
