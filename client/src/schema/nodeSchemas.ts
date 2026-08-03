import type { NodeType } from "../types/graph";
import type { NodeTypeSchema } from "./fieldTypes";

// Declarative UI metadata for every node type: this is presentation (color/icon/form layout),
// not a business rule the backend validates — that's why it lives here as static client data
// instead of coming from GET /api/schema (which only ever describes connection rules).
export const nodeSchemas: Record<NodeType, NodeTypeSchema> = {
  // ---- Backend ----
  domain: {
    type: "domain",
    category: "backend",
    color: "#2c5282",
    icon: "D",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "ipPort", label: "IP:Puerto", kind: "text", placeholder: "0.0.0.0:3000" },
      { key: "description", label: "Descripción", kind: "textarea" },
    ],
  },
  subdomain: {
    type: "subdomain",
    category: "backend",
    color: "#2b6cb0",
    icon: "Sd",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "domainId", label: "Domain", kind: "refSelect", refNodeType: "domain" },
      { key: "description", label: "Descripción", kind: "textarea" },
    ],
  },
  route: {
    type: "route",
    category: "backend",
    color: "#3182ce",
    icon: "R",
    summaryFields: ["path"],
    fields: [
      { key: "path", label: "Path", kind: "text", placeholder: "/users" },
      { key: "description", label: "Descripción", kind: "textarea" },
    ],
  },
  endpoint: {
    type: "endpoint",
    category: "backend",
    color: "#2b6cb0",
    icon: "E",
    summaryFields: ["method", "name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "method", label: "Método", kind: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { key: "description", label: "Descripción", kind: "textarea" },
    ],
    suggestedCompanions: [{ type: "middleware", reason: "Los endpoints suelen tener al menos un middleware de validación." }],
  },
  middleware: {
    type: "middleware",
    category: "backend",
    color: "#4299e1",
    icon: "Mw",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "description", label: "Descripción", kind: "textarea" },
      { key: "hasNext", label: "Llama a next()", kind: "boolean" },
    ],
  },
  service: {
    type: "service",
    category: "backend",
    color: "#2f855a",
    icon: "S",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "description", label: "Descripción", kind: "textarea" },
      { key: "ormId", label: "ORM", kind: "refSelect", refNodeType: "orm" },
    ],
    suggestedCompanions: [
      { type: "repository", reason: "Un Service que persiste datos suele apoyarse en un Repository." },
      { type: "orm", reason: "El Repository necesita un ORM para hablar con la base de datos." },
    ],
  },
  model: {
    type: "model",
    category: "backend",
    color: "#805ad5",
    icon: "Mo",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      {
        key: "schema",
        label: "Campos",
        kind: "arrayOfObjects",
        itemSchema: [
          { key: "name", label: "Nombre", kind: "text" },
          { key: "type", label: "Tipo", kind: "select", options: ["string", "number", "boolean", "date", "object"] },
          { key: "required", label: "Requerido", kind: "boolean" },
        ],
      },
    ],
  },
  table: {
    type: "table",
    category: "backend",
    color: "#805ad5",
    icon: "T",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      {
        key: "columns",
        label: "Columnas",
        kind: "arrayOfObjects",
        itemSchema: [
          { key: "name", label: "Nombre", kind: "text" },
          { key: "type", label: "Tipo", kind: "select", options: ["string", "number", "boolean", "date", "json"] },
          { key: "nullable", label: "Nullable", kind: "boolean" },
        ],
      },
    ],
  },
  db: {
    type: "db",
    category: "backend",
    color: "#6b46c1",
    icon: "Db",
    summaryFields: ["engine"],
    fields: [
      { key: "engine", label: "Motor", kind: "select", options: ["PostgreSQL", "MySQL", "MongoDB", "SQLite"] },
      { key: "connectionType", label: "Tipo de conexión", kind: "select", options: ["native", "orm"] },
      { key: "connectionString", label: "Connection string", kind: "text" },
    ],
  },
  orm: {
    type: "orm",
    category: "backend",
    color: "#6b46c1",
    icon: "Or",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "select", options: ["prisma", "typeorm", "sequelize", "mongoose", "drizzle"] },
      { key: "dbId", label: "DB", kind: "refSelect", refNodeType: "db" },
    ],
  },
  repository: {
    type: "repository",
    category: "backend",
    color: "#553c9a",
    icon: "Rp",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "entityRef", label: "Entidad", kind: "refSelect", refNodeType: ["model", "table"] },
      { key: "ormId", label: "ORM", kind: "refSelect", refNodeType: "orm" },
    ],
  },
  tool: {
    type: "tool",
    category: "backend",
    color: "#c05621",
    icon: "Tl",
    summaryFields: ["name"],
    fields: [{ key: "name", label: "Nombre", kind: "select", options: ["redis", "bullmq", "kafka", "rabbitmq"] }],
  },
  queue: {
    type: "queue",
    category: "backend",
    color: "#c05621",
    icon: "Q",
    summaryFields: ["topicOrJobName"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "topicOrJobName", label: "Topic / Job name", kind: "text" },
      { key: "toolId", label: "Tool", kind: "refSelect", refNodeType: "tool" },
      { key: "consumerServiceId", label: "Servicio consumidor", kind: "refSelect", refNodeType: "service" },
    ],
  },
  externalApi: {
    type: "externalApi",
    category: "backend",
    color: "#b7791f",
    icon: "Ex",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "baseUrl", label: "Base URL", kind: "text" },
      { key: "authType", label: "Auth", kind: "select", options: ["none", "apiKey", "oauth2", "basic"] },
    ],
  },
  scheduler: {
    type: "scheduler",
    category: "backend",
    color: "#975a16",
    icon: "Sc",
    summaryFields: ["cronExpression"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "cronExpression", label: "Cron expression", kind: "text", placeholder: "0 * * * *" },
      { key: "triggersServiceId", label: "Servicio disparado", kind: "refSelect", refNodeType: "service" },
    ],
  },
  errorHandler: {
    type: "errorHandler",
    category: "backend",
    color: "#9b2c2c",
    icon: "Eh",
    summaryFields: ["scope"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "scope", label: "Alcance", kind: "select", options: ["global", "domain"] },
    ],
  },
  envConfig: {
    type: "envConfig",
    category: "backend",
    color: "#4a5568",
    icon: "Cf",
    summaryFields: ["domainId"],
    fields: [
      { key: "domainId", label: "Domain", kind: "refSelect", refNodeType: "domain" },
      {
        key: "variables",
        label: "Variables",
        kind: "arrayOfObjects",
        itemSchema: [{ key: "name", label: "Nombre", kind: "text" }],
      },
    ],
  },
  websocket: {
    type: "websocket",
    category: "backend",
    color: "#2c7a7b",
    icon: "Ws",
    summaryFields: ["event"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "event", label: "Evento", kind: "text" },
    ],
  },
  email: {
    type: "email",
    category: "backend",
    color: "#b83280",
    icon: "Ml",
    summaryFields: ["trigger"],
    fields: [
      { key: "trigger", label: "Trigger", kind: "text" },
      { key: "template", label: "Template", kind: "text" },
      { key: "async", label: "Asíncrono", kind: "boolean" },
      { key: "providerId", label: "Provider (tool)", kind: "refSelect", refNodeType: "tool" },
      { key: "queueId", label: "Queue", kind: "refSelect", refNodeType: "queue" },
    ],
  },
  redisKey: {
    type: "redisKey",
    category: "backend",
    color: "#c53030",
    icon: "Rk",
    summaryFields: ["keyPattern", "operation"],
    fields: [
      { key: "keyPattern", label: "Key pattern", kind: "text", placeholder: "session:*" },
      { key: "operation", label: "Operación", kind: "select", options: ["GET", "SET", "DELETE", "UPDATE", "EXPIRE"] },
      { key: "ttl", label: "TTL (s)", kind: "number" },
      { key: "toolId", label: "Tool", kind: "refSelect", refNodeType: "tool" },
    ],
  },

  // ---- Frontend ----
  page: {
    type: "page",
    category: "frontend",
    color: "#2c5282",
    icon: "Pg",
    summaryFields: ["path"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "path", label: "Path", kind: "text", placeholder: "/login" },
      { key: "description", label: "Descripción", kind: "textarea" },
      { key: "requiresAuth", label: "Requiere auth", kind: "boolean" },
      { key: "guardId", label: "Guard", kind: "refSelect", refNodeType: "guard" },
      { key: "layoutId", label: "Layout", kind: "refSelect", refNodeType: "layout" },
    ],
  },
  layout: {
    type: "layout",
    category: "frontend",
    color: "#3182ce",
    icon: "Ly",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      {
        key: "slots",
        label: "Slots",
        kind: "arrayOfObjects",
        itemSchema: [{ key: "name", label: "Nombre", kind: "select", options: ["header", "sidebar", "footer", "main"] }],
      },
    ],
  },
  component: {
    type: "component",
    category: "frontend",
    color: "#4299e1",
    icon: "Cp",
    summaryFields: ["name", "kind"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "kind", label: "Tipo", kind: "select", options: ["presentational", "container"] },
    ],
  },
  form: {
    type: "form",
    category: "frontend",
    color: "#38a169",
    icon: "Fm",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      {
        key: "fields",
        label: "Campos",
        kind: "arrayOfObjects",
        itemSchema: [
          { key: "name", label: "Nombre", kind: "text" },
          { key: "type", label: "Tipo", kind: "select", options: ["text", "number", "email", "password", "checkbox"] },
          { key: "required", label: "Requerido", kind: "boolean" },
        ],
      },
      { key: "modelRef", label: "Model (backend)", kind: "refSelectCrossTab", refNodeType: "model" },
      { key: "apiCallId", label: "Api Call", kind: "refSelect", refNodeType: "apiCall" },
    ],
    suggestedCompanions: [{ type: "apiCall", reason: "Un Form suele enviar sus datos vía un Api Call." }],
  },
  stateStore: {
    type: "stateStore",
    category: "frontend",
    color: "#805ad5",
    icon: "St",
    summaryFields: ["name", "library"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "library", label: "Librería", kind: "select", options: ["redux", "zustand", "context", "pinia"] },
    ],
  },
  apiCall: {
    type: "apiCall",
    category: "frontend",
    color: "#dd6b20",
    icon: "Ac",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "endpointRef", label: "Endpoint (backend)", kind: "refSelectCrossTab", refNodeType: "endpoint" },
      { key: "storeId", label: "Store", kind: "refSelect", refNodeType: "stateStore" },
      { key: "loadingState", label: "Loading state", kind: "text" },
      { key: "errorHandling", label: "Manejo de errores", kind: "textarea" },
    ],
    suggestedCompanions: [{ type: "stateStore", reason: "Guardar el resultado en un Store evita refetch innecesario." }],
  },
  hook: {
    type: "hook",
    category: "frontend",
    color: "#3182ce",
    icon: "Hk",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "returns", label: "Retorna", kind: "text" },
    ],
  },
  navigationRouter: {
    type: "navigationRouter",
    category: "frontend",
    color: "#2c5282",
    icon: "Nv",
    summaryFields: ["library"],
    fields: [
      { key: "library", label: "Librería", kind: "text", placeholder: "react-router" },
      {
        key: "routes",
        label: "Rutas",
        kind: "arrayOfObjects",
        itemSchema: [
          { key: "pageId", label: "Page", kind: "refSelect", refNodeType: "page" },
          { key: "path", label: "Path", kind: "text" },
        ],
      },
    ],
  },
  guard: {
    type: "guard",
    category: "frontend",
    color: "#975a16",
    icon: "Gd",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "condition", label: "Condición", kind: "text" },
      { key: "redirectTo", label: "Redirect to", kind: "refSelect", refNodeType: "page" },
    ],
  },
  modalDialog: {
    type: "modalDialog",
    category: "frontend",
    color: "#6b46c1",
    icon: "Md",
    summaryFields: ["name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "trigger", label: "Trigger", kind: "text" },
      { key: "contentComponentId", label: "Componente de contenido", kind: "refSelect", refNodeType: "component" },
    ],
  },
  themeToken: {
    type: "themeToken",
    category: "frontend",
    color: "#718096",
    icon: "Th",
    summaryFields: [],
    fields: [],
  },
  asset: {
    type: "asset",
    category: "frontend",
    color: "#718096",
    icon: "As",
    summaryFields: ["kind", "name"],
    fields: [
      { key: "name", label: "Nombre", kind: "text" },
      { key: "kind", label: "Tipo", kind: "select", options: ["image", "icon", "font"] },
      { key: "path", label: "Path", kind: "text" },
    ],
  },

  // ---- Structural ----
  container: {
    type: "container",
    category: "structure",
    color: "transparent",
    icon: "",
    summaryFields: [],
    fields: [{ key: "label", label: "Nombre del contenedor", kind: "text" }],
  },
};

export function nodeSchemasByCategory(category: "backend" | "frontend" | "structure"): NodeTypeSchema[] {
  return Object.values(nodeSchemas).filter((s) => s.category === category);
}
