export type BackendNodeType =
  | "domain" | "subdomain" | "route" | "endpoint" | "operation" | "middleware" | "service"
  | "model" | "table" | "db" | "orm" | "repository" | "tool" | "queue"
  | "externalApi" | "scheduler" | "errorHandler" | "envConfig" | "websocket"
  | "websocketEvent" | "websocketEmit" | "email" | "redisKey";

export type FrontendNodeType =
  | "page" | "layout" | "component" | "form" | "stateStore" | "apiCall"
  | "hook" | "navigationRouter" | "guard" | "modalDialog" | "themeToken" | "asset";

export type StructuralNodeType = "container" | "boundary" | "note";

export type NodeType = BackendNodeType | FrontendNodeType | StructuralNodeType;

export const BACKEND_NODE_TYPES: BackendNodeType[] = [
  "domain", "subdomain", "route", "endpoint", "operation", "middleware", "service",
  "model", "table", "db", "orm", "repository", "tool", "queue",
  "externalApi", "scheduler", "errorHandler", "envConfig", "websocket",
  "websocketEvent", "websocketEmit", "email", "redisKey",
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
  // Conflict detection (see src/sync/conflict.ts): which source file this node corresponds to,
  // and the hash of that file's content the last time an agent synced it. The server never reads
  // the user's filesystem itself — the syncing agent computes and sends the hash.
  sourcePath?: string;
  sourceHash?: string;
  lastSyncedAt?: string;
}

// ---- Backend props ----

export interface DomainProps {
  name: string;
  domain?: string;
  ipPort?: string;
  description?: string;
}

export interface SubdomainProps {
  name: string;
  subdomain?: string;
  domainId: string;
  description?: string;
}

export interface RouteProps {
  path?: string;
  description?: string;
}

export interface ReturnSpec {
  status: number | string;
  description?: string;
  // A specific output (e.g. a particular error code) can hand off to another node —
  // another middleware, a service, or an error handler — instead of just ending the request.
  chainToId?: string;
}

export interface CacheConfig {
  enabled: boolean;
  keyPattern?: string;
  ttl?: number;
  invalidation?: string;
  invalidatedBy?: string[];
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface EndpointProps {
  name: string;
  methods: HttpMethod[];
  description?: string;
  // Shared across every method/operation below (e.g. an auth header) — per-method query/path/body/
  // returns live on the operation child instead, so they can differ between GET/POST/etc.
  headers?: ModelField[];
  cacheable?: CacheConfig;
  isPublic?: boolean;
  // Only meaningful when isPublic is false — which security mechanism(s) gate this endpoint.
  authMethods?: string[];
}

// One method's own contract + chain: query/params/body/returns, since those are what actually
// differ between GET/POST/etc. Headers stay on the endpoint (shared across every method).
export interface OperationProps {
  method: HttpMethod;
  description?: string;
  query?: ModelField[];
  params?: ModelField[];
  body?: ModelField[];
  returns?: ReturnSpec[];
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
  // Which table this shape maps to — a table can have several models (one per endpoint's needs).
  tableId?: string;
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
  dbId?: string;
}

export interface DbProps {
  engine: string;
  connectionType: "native" | "orm";
  ormId?: string;
  connectionString?: string;
}

export interface OrmProps {
  name: "prisma" | "typeorm" | "sequelize" | "mongoose" | "drizzle" | string;
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
  domainId?: string;
  handledErrors?: string[];
}

export interface EnvConfigProps {
  domainId: string;
  variables: string[];
}

export interface WebSocketProps {
  name: string;
  namespace?: string;
  description?: string;
}

export interface WebSocketEventProps {
  event: string;
  description?: string;
  payload?: ModelField[];
}

export interface WebSocketEmitProps {
  event: string;
  payload?: ModelField[];
  target: "sender" | "broadcast" | "room";
  roomParam?: string;
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

export interface BoundaryProps {
  label: string;
  kind?: "microservice" | "network-zone" | "module" | "bounded-context" | string;
}

export interface NoteProps {
  text: string;
  color?: "yellow" | "blue" | "pink" | "green";
}

export interface NodePropsMap {
  domain: DomainProps;
  subdomain: SubdomainProps;
  route: RouteProps;
  endpoint: EndpointProps;
  operation: OperationProps;
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
  websocketEvent: WebSocketEventProps;
  websocketEmit: WebSocketEmitProps;
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
  boundary: BoundaryProps;
  note: NoteProps;
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
