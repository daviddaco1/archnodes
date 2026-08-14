import { randomUUID } from "node:crypto";
import type { AnyGraphNode, GraphEdge, NodeType, ProjectGraph } from "../types/graph.js";

const TS = new Date(0).toISOString();
const CLUSTER_SIZE = 15;

function mkNode(type: NodeType, props: Record<string, unknown>, parentId?: string): AnyGraphNode {
  return {
    id: randomUUID(),
    type,
    label: (props.name as string) ?? type,
    position: { x: 0, y: 0 },
    parentId,
    props,
    createdAt: TS,
    updatedAt: TS,
  } as AnyGraphNode;
}

// Realistic-shaped synthetic graph for performance measurement (Fase 19): each "cluster" wires a
// full backend chain (domain->route->endpoint->middleware->service->repository, plus db/orm/
// table/model tied in via REF_FIELDS, not left as disconnected nodes) and a frontend chain
// (page->component->apiCall, page->form, plus an unused stateStore) — close enough to a real
// project's shape to actually exercise the reverse-REF_FIELDS scan in getDependents/health checks,
// unlike a flat pile of unconnected nodes. `n` is approximate: built in whole clusters, so the
// result may run slightly over.
export function generateSyntheticGraph(n: number): ProjectGraph {
  const nodes: AnyGraphNode[] = [];
  const edges: GraphEdge[] = [];
  const link = (parent: AnyGraphNode, child: AnyGraphNode) => edges.push({ id: randomUUID(), source: parent.id, target: child.id, edgeType: "hierarchy" });

  const clusters = Math.max(1, Math.ceil(n / CLUSTER_SIZE));
  for (let i = 0; i < clusters; i++) {
    const db = mkNode("db", { engine: "postgres", connectionType: "native" });
    const orm = mkNode("orm", { name: "prisma" });
    const domain = mkNode("domain", { name: `Domain${i}` });
    const route = mkNode("route", { path: `/r${i}` }, domain.id);
    const endpoint = mkNode("endpoint", { name: `e${i}`, methods: ["GET"] }, route.id);
    const middleware = mkNode("middleware", { name: `mw${i}` }, endpoint.id);
    const service = mkNode("service", { name: `svc${i}`, ormId: orm.id }, middleware.id);
    const table = mkNode("table", { name: `tbl${i}`, columns: [{ name: "id", type: "uuid" }], dbId: db.id });
    const model = mkNode("model", { name: `Model${i}`, schema: [{ name: "id", type: "string" }], tableId: table.id });
    const repository = mkNode("repository", { name: `repo${i}`, entityRef: model.id, ormId: orm.id }, service.id);

    const page = mkNode("page", { name: `Page${i}`, path: `/p${i}` });
    const component = mkNode("component", { name: `Comp${i}`, kind: "presentational" }, page.id);
    const apiCall = mkNode("apiCall", { name: `call${i}`, endpointRef: endpoint.id }, component.id);
    const form = mkNode("form", { name: `Form${i}`, fields: [{ name: "x", type: "string" }] }, page.id);
    const stateStore = mkNode("stateStore", { name: `Store${i}`, library: "zustand" });

    nodes.push(db, orm, domain, route, endpoint, middleware, service, table, model, repository, page, component, apiCall, form, stateStore);
    link(domain, route);
    link(route, endpoint);
    link(endpoint, middleware);
    link(middleware, service);
    link(service, repository);
    link(page, component);
    link(component, apiCall);
    link(page, form);
  }

  return {
    manifest: { projectName: "synthetic", createdAt: TS, updatedAt: TS },
    nodes,
    edges,
  };
}
