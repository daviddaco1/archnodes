import type { AnyGraphNode, EdgeType, GraphEdge, NodeType, ProjectGraph } from "@project-visualizer/shared/graph.js";

export interface SchemaConnection {
  from: NodeType;
  to: NodeType;
  kind: "hierarchy" | "invalidates";
}

export interface RefFieldSpec {
  field: string;
  targetType: NodeType | NodeType[];
  array?: boolean;
}

export interface SchemaResponse {
  connections: SchemaConnection[];
  nodeTypes: NodeType[];
  requiredFields: Record<string, string[]>;
  refFields: Partial<Record<NodeType, RefFieldSpec[]>>;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export class ApiError extends Error {
  issues?: ValidationIssue[];
  constructor(message: string, issues?: ValidationIssue[]) {
    super(message);
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? res.statusText, body.issues);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getProject(scope: "backend" | "frontend" | "all" = "all"): Promise<ProjectGraph> {
  return request(`/api/project?scope=${scope}`);
}

export function getSchema(): Promise<SchemaResponse> {
  return request(`/api/schema`);
}

export function createNode(type: NodeType, props: Record<string, unknown>, parentId?: string): Promise<AnyGraphNode> {
  return request(`/api/nodes`, { method: "POST", body: JSON.stringify({ type, props, parentId }) });
}

export function updateNode(id: string, props: Record<string, unknown>): Promise<AnyGraphNode> {
  return request(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ props }) });
}

export function updateNodePosition(id: string, position: { x: number; y: number }): Promise<AnyGraphNode> {
  return request(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ position }) });
}

export function setNodeContainer(id: string, containerId: string | undefined): Promise<AnyGraphNode> {
  return request(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ containerId: containerId ?? "" }) });
}

export function deleteNode(id: string, cascade = false): Promise<{ deletedIds: string[] }> {
  return request(`/api/nodes/${id}?cascade=${cascade}`, { method: "DELETE" });
}

export function createEdge(sourceId: string, targetId: string, edgeType?: EdgeType): Promise<GraphEdge> {
  return request(`/api/edges`, { method: "POST", body: JSON.stringify({ sourceId, targetId, edgeType }) });
}

export function deleteEdge(id: string): Promise<void> {
  return request(`/api/edges/${id}`, { method: "DELETE" });
}

export function validateProject(): Promise<ValidationResult> {
  return request(`/api/validate`);
}

export function exportMarkdownUrl(): string {
  return `/api/export/markdown`;
}

export interface Template {
  id: string;
  label: string;
  description: string;
  language: string;
  framework: string;
  database: string;
  orm?: string;
  frontendFramework?: string;
  architecture: "monolith" | "microservices";
}

export function getTemplates(): Promise<Template[]> {
  return request(`/api/templates`);
}

export function applyTemplate(templateId: string): Promise<ProjectGraph> {
  return request(`/api/templates/apply`, { method: "POST", body: JSON.stringify({ templateId }) });
}

export function getSuggestedLanguages(): Promise<{ languages: string[] }> {
  return request(`/api/suggestions/languages`);
}

export function getSuggestedFrameworks(language: string): Promise<{ frameworks: string[] }> {
  return request(`/api/suggestions/frameworks?language=${encodeURIComponent(language)}`);
}

export function getSuggestedStack(framework: string): Promise<{ orm?: string; database?: string }> {
  return request(`/api/suggestions/stack?framework=${encodeURIComponent(framework)}`);
}

export interface WizardAnswers {
  language: string;
  framework: string;
  database: string;
  architecture: "monolith" | "microservices";
  domains: string[];
}

export function applyWizard(answers: WizardAnswers): Promise<ProjectGraph> {
  return request(`/api/wizard/apply`, { method: "POST", body: JSON.stringify(answers) });
}
