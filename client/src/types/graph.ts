// Copia manual de src/types/graph.ts (backend). Mantener sincronizado a mano.
// No hay paquete/workspace compartido: el backend y este cliente viven en repos/procesos separados
// y este archivo es solo ~350 lineas, asi que la duplicacion es mas simple que montar infra de monorepo.

export type BackendNodeType =
  | "domain" | "subdomain" | "route" | "endpoint" | "middleware" | "service"
  | "model" | "table" | "db" | "orm" | "repository" | "tool" | "queue"
  | "externalApi" | "scheduler" | "errorHandler" | "envConfig" | "websocket"
  | "email" | "redisKey";

export type FrontendNodeType =
  | "page" | "layout" | "component" | "form" | "stateStore" | "apiCall"
  | "hook" | "navigationRouter" | "guard" | "modalDialog" | "themeToken" | "asset";

export type StructuralNodeType = "container";

export type NodeType = BackendNodeType | FrontendNodeType | StructuralNodeType;

export const BACKEND_NODE_TYPES: BackendNodeType[] = [
  "domain", "subdomain", "route", "endpoint", "middleware", "service",
  "model", "table", "db", "orm", "repository", "tool", "queue",
  "externalApi", "scheduler", "errorHandler", "envConfig", "websocket",
  "email", "redisKey",
];

export const FRONTEND_NODE_TYPES: FrontendNodeType[] = [
  "page", "layout", "component", "form", "stateStore", "apiCall",
  "hook", "navigationRouter", "guard", "modalDialog", "themeToken", "asset",
];

export interface Position {
  x: number;
  y: number;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  label: string;
  position: Position;
  parentId?: string;
  containerId?: string;
  generated?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Backend props ----

export interface DomainProps {
  name: string;
  ipPort?: string;
  description?: string;
}

export interface SubdomainProps {
  name: string;
  domainId: string;
  description?: string;
}

export interface RouteProps {
  path?: string;
  description?: string;
}

export interface EndpointIO {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  statusCode?: number;
}

export interface ReturnSpec {
  status: number | string;
  description?: string;
}

export interface CacheConfig {
  enabled: boolean;
  keyPattern?: string;
  ttl?: number;
  invalidation?: string;
  invalidatedBy?: string[];
}

export interface EndpointProps {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  description?: string;
  input?: EndpointIO;
  output?: EndpointIO;
  returns?: ReturnSpec[];
  cacheable?: CacheConfig;
}

export interface MiddlewareProps {
  name: string;
  description?: string;
  returns?: ReturnSpec[];
  hasNext?: boolean;
}

export interface ServiceProps {
  name: string;
  description?: string;
  input?: unknown;
  output?: unknown;
  errors?: ReturnSpec[];
  ormId?: string;
}

export interface ModelField {
  name: string;
  type: string;
  required?: boolean;
}

export interface ModelProps {
  name: string;
  schema: ModelField[];
}

export interface TableColumn {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface TableRelation {
  targetTableId: string;
  kind?: "one-to-one" | "one-to-many" | "many-to-many";
}

export interface TableProps {
  name: string;
  columns: TableColumn[];
  relations?: TableRelation[];
}

export interface DbProps {
  engine: string;
  connectionType: "native" | "orm";
  ormId?: string;
  connectionString?: string;
}

export interface OrmProps {
  name: "prisma" | "typeorm" | "sequelize" | "mongoose" | "drizzle" | string;
  dbId: string;
}

export interface RepositoryProps {
  name: string;
  entityRef: string;
  ormId: string;
  operations?: string[];
}

export interface ToolProps {
  name: string;
  config?: Record<string, unknown>;
}

export interface QueueProps {
  name: string;
  topicOrJobName: string;
  payload?: unknown;
  consumerServiceId?: string;
  toolId: string;
}

export interface ExternalApiProps {
  name: string;
  baseUrl: string;
  authType?: string;
  endpoints?: string[];
}

export interface SchedulerProps {
  name: string;
  cronExpression: string;
  triggersServiceId: string;
}

export interface ErrorHandlerProps {
  name: string;
  scope: "global" | "domain";
  handledErrors?: string[];
}

export interface EnvConfigProps {
  domainId: string;
  variables: string[];
}

export interface WebSocketProps {
  name: string;
  event: string;
  input?: unknown;
  output?: unknown;
}

export interface EmailProps {
  trigger: string;
  providerId?: string;
  template?: string;
  variables?: string[];
  async?: boolean;
  queueId?: string;
  errors?: ReturnSpec[];
}

export interface RedisKeyProps {
  keyPattern: string;
  operation: "GET" | "SET" | "DELETE" | "UPDATE" | "EXPIRE";
  ttl?: number;
  value?: unknown;
  fallback?: unknown;
  toolId: string;
}

// ---- Frontend props ----

export interface PageProps {
  name: string;
  path: string;
  description?: string;
  requiresAuth?: boolean;
  guardId?: string;
  layoutId?: string;
}

export interface LayoutSlot {
  name: "header" | "sidebar" | "footer" | "main" | string;
  componentId?: string;
}

export interface LayoutProps {
  name: string;
  slots: LayoutSlot[];
}

export interface ComponentProps {
  name: string;
  kind: "presentational" | "container";
  props_?: string[];
}

export interface FormField {
  name: string;
  type: string;
  required?: boolean;
}

export interface FormProps {
  name: string;
  fields: FormField[];
  modelRef?: string;
  method?: string;
  apiCallId?: string;
}

export interface StateStoreProps {
  name: string;
  library: "redux" | "zustand" | "context" | "pinia" | string;
  stateShape?: unknown;
  actions?: string[];
}

export interface ApiCallProps {
  name: string;
  endpointRef: string;
  storeId?: string;
  loadingState?: string;
  errorHandling?: string;
}

export interface HookProps {
  name: string;
  returns?: string;
  dependsOn?: string[];
}

export interface NavigationRoute {
  pageId: string;
  path?: string;
  params?: string[];
}

export interface NavigationRouterProps {
  library: string;
  routes: NavigationRoute[];
}

export interface GuardProps {
  name: string;
  condition: string;
  redirectTo?: string;
}

export interface ModalDialogProps {
  name: string;
  trigger?: string;
  contentComponentId?: string;
}

export interface ThemeTokenProps {
  colors?: Record<string, string>;
  typography?: Record<string, string>;
  spacing?: Record<string, string>;
}

export interface AssetProps {
  name: string;
  kind: "image" | "icon" | "font";
  path: string;
}

// ---- Structural props ----

export interface ContainerProps {
  label: string;
}

export interface NodePropsMap {
  domain: DomainProps;
  subdomain: SubdomainProps;
  route: RouteProps;
  endpoint: EndpointProps;
  middleware: MiddlewareProps;
  service: ServiceProps;
  model: ModelProps;
  table: TableProps;
  db: DbProps;
  orm: OrmProps;
  repository: RepositoryProps;
  tool: ToolProps;
  queue: QueueProps;
  externalApi: ExternalApiProps;
  scheduler: SchedulerProps;
  errorHandler: ErrorHandlerProps;
  envConfig: EnvConfigProps;
  websocket: WebSocketProps;
  email: EmailProps;
  redisKey: RedisKeyProps;
  page: PageProps;
  layout: LayoutProps;
  component: ComponentProps;
  form: FormProps;
  stateStore: StateStoreProps;
  apiCall: ApiCallProps;
  hook: HookProps;
  navigationRouter: NavigationRouterProps;
  guard: GuardProps;
  modalDialog: ModalDialogProps;
  themeToken: ThemeTokenProps;
  asset: AssetProps;
  container: ContainerProps;
}

export type GraphNode<T extends NodeType = NodeType> = BaseNode & {
  type: T;
  props: NodePropsMap[T];
};

export type AnyGraphNode = { [K in NodeType]: GraphNode<K> }[NodeType];

export type EdgeType = "hierarchy" | "invalidates";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: EdgeType;
}

export interface ProjectManifest {
  projectName: string;
  language?: string;
  framework?: string;
  architecture?: "monolith" | "microservices";
  databases?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGraph {
  manifest: ProjectManifest;
  nodes: AnyGraphNode[];
  edges: GraphEdge[];
}

export type ProjectScope = "backend" | "frontend" | "all";
