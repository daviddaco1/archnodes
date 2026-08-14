import express, { type Request, type Response, type NextFunction } from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import rateLimit from "express-rate-limit";
import type { BatchOp, ProjectStore } from "./store/project-store.js";
import { authMiddleware } from "./security/auth.js";
import { canPerform, type PermissionAction, type Role } from "./security/permissions.js";
import type { AuditEntry } from "./audit/audit-log.js";
import { ValidationError } from "./validation/rules.js";
import type { EdgeType, NodeType } from "./types/graph.js";
import { buildSchemaResponse } from "./schema.js";
import { exportMarkdown } from "./export/markdown.js";
import { TEMPLATES, applyTemplate } from "./init/templates.js";
import { FRAMEWORKS_BY_LANGUAGE, suggestFrameworks, suggestStack } from "./init/suggestions.js";
import { applyWizardAnswers, type WizardAnswers } from "./init/wizard.js";
import { getAffectedNodes, getDependencies, getDependents } from "./analysis/dependencies.js";
import { analyzeChange, planChange, type ChangeType } from "./analysis/change.js";
import { importProject, type ImportCandidateEdge, type ImportCandidateNode } from "./analysis/import.js";
import { detectConflicts } from "./analysis/sync-report.js";
import { summarizeProject } from "./analysis/summary.js";
import { searchGraph } from "./analysis/search.js";
import { getProjectContext } from "./analysis/context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// store.undo()/redo()/restoreVersion()/compareVersions() throw plain Errors (not ValidationError,
// since there's no graph-validation issue involved) for "nothing to undo/redo" and "entry not
// found" — map those to the right 4xx status instead of falling through to the generic 500 handler.
function withHistoryErrors(res: Response, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error && /nothing to (undo|redo)/i.test(err.message)) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof Error && /not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
    } else {
      throw err;
    }
  }
}

export interface CreateServerOptions {
  /** Undefined means local mode (today's default): no auth required. */
  authToken?: string;
  /** Mounted only when explicitly requested — local, loopback-only usage sees no behavior change. */
  enableRateLimit?: boolean;
  /**
   * Fixed role for every request this server instance accepts — this is a seam for Fase 16
   * (`src/security/permissions.ts`), not a multi-user system: today's CLI has a single `--token`,
   * so there's exactly one identity per running server, not a per-token table yet.
   * Ignored (always "owner") when no authToken is set — local mode keeps full access, no regression.
   */
  role?: Role;
}

// Logs every request (reads included, not just mutations) — mounted before the routes so
// res.on("finish") always has a chance to fire regardless of which handler ends up running.
// Records after the response is sent, so it never adds latency to the request itself.
function auditMiddleware(store: ProjectStore, identity: { role?: Role } | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on("finish", () => {
      const result: AuditEntry["result"] = res.statusCode === 409 ? "CONFLICT" : res.statusCode < 400 ? "SUCCESS" : "FAILURE";
      const nodeId = req.params.id;
      const target = nodeId ? { nodeId, nodeType: store.getNode(nodeId)?.type } : undefined;
      store.recordAudit({
        transport: "http",
        operation: `${req.method} ${req.route?.path ?? req.path}`,
        identity,
        target,
        result,
        durationMs: Date.now() - start,
      });
    });
    next();
  };
}

function authorizationMiddleware(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const action: PermissionAction = req.method === "GET" || req.method === "HEAD" ? "read" : "write";
    if (!canPerform(role, action)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

export function createServer(store: ProjectStore, opts: CreateServerOptions = {}): express.Express {
  const app = express();
  const effectiveRole = opts.authToken ? (opts.role ?? "owner") : "owner";
  app.use(authMiddleware(opts.authToken));
  app.use(authorizationMiddleware(effectiveRole));
  app.use(auditMiddleware(store, opts.authToken ? { role: effectiveRole } : undefined));
  if (opts.enableRateLimit) {
    app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  }
  // Bumped from body-parser's 100kb default — a bulk import/batch of a few hundred nodes can
  // exceed that on its own, well before anything resembling an attack payload.
  app.use(express.json({ limit: process.env.PROJECT_VISUALIZER_BODY_LIMIT ?? "5mb" }));

  app.get("/api/project", (req: Request, res: Response) => {
    const scope = (req.query.scope as "backend" | "frontend" | "all") ?? "all";
    res.json(store.getProject(scope));
  });

  app.get("/api/schema", (_req: Request, res: Response) => {
    res.json(buildSchemaResponse());
  });

  app.get("/api/nodes", (req: Request, res: Response) => {
    const type = req.query.type as NodeType | undefined;
    let filters: Record<string, unknown> | undefined;
    if (typeof req.query.filters === "string") {
      try {
        filters = JSON.parse(req.query.filters) as Record<string, unknown>;
      } catch {
        return res.status(400).json({ error: "filters must be a JSON-encoded object" });
      }
    }
    res.json(store.listNodes(type, filters));
  });

  app.get("/api/nodes/:id", (req: Request, res: Response) => {
    const node = store.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    res.json(node);
  });

  app.post("/api/nodes", (req: Request, res: Response) => {
    const { type, props, parentId } = req.body ?? {};
    if (typeof type !== "string" || typeof props !== "object" || props === null) {
      return res.status(400).json({ error: "type (string) and props (object) are required" });
    }
    const node = store.createNode(type as NodeType, props, parentId, { source: "api" });
    res.status(201).json(node);
  });

  app.patch("/api/nodes/:id", (req: Request, res: Response) => {
    const body = req.body ?? {};
    let node = store.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (body.position !== undefined) node = store.setPosition(req.params.id, body.position, { source: "api" });
    if (body.containerId !== undefined) node = store.setContainer(req.params.id, body.containerId || undefined, { source: "api" });
    // Props can arrive wrapped ({props: {...}}) or as flat extra keys alongside position/containerId —
    // either way, any leftover data key must still reach updateNode, not just when position/containerId are absent.
    const { position: _position, containerId: _containerId, props, ...rest } = body;
    const propsPatch = props !== undefined ? props : rest;
    if (Object.keys(propsPatch).length > 0) {
      node = store.updateNode(req.params.id, propsPatch, { source: "api" });
    }
    res.json(node);
  });

  app.delete("/api/nodes/:id", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    const cascade = req.query.cascade === "true";
    const result = store.deleteNode(req.params.id, cascade, { source: "api" });
    res.json(result);
  });

  app.get("/api/nodes/:id/dependencies", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    res.json(getDependencies(req.params.id, store.getProject("all")));
  });

  app.get("/api/nodes/:id/dependents", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    res.json(getDependents(req.params.id, store.getProject("all")));
  });

  app.get("/api/nodes/:id/affected", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    res.json(getAffectedNodes(req.params.id, store.getProject("all")));
  });

  app.get("/api/nodes/:id/context", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    const depth = typeof req.query.depth === "string" ? Number(req.query.depth) : undefined;
    const maxNodes = typeof req.query.maxNodes === "string" ? Number(req.query.maxNodes) : undefined;
    const direction = req.query.direction as "dependencies" | "dependents" | "both" | undefined;
    res.json(getProjectContext(store, req.params.id, { depth, direction, maxNodes }));
  });

  app.post("/api/edges", (req: Request, res: Response) => {
    const { sourceId, targetId, edgeType } = req.body ?? {};
    if (typeof sourceId !== "string" || !store.getNode(sourceId)) {
      return res.status(404).json({ error: "source node not found" });
    }
    if (typeof targetId !== "string" || !store.getNode(targetId)) {
      return res.status(404).json({ error: "target node not found" });
    }
    const edge = store.connectNodes(sourceId, targetId, edgeType as EdgeType | undefined, { source: "api" });
    res.status(201).json(edge);
  });

  app.delete("/api/edges/:id", (req: Request, res: Response) => {
    store.deleteEdge(req.params.id, { source: "api" });
    res.status(204).end();
  });

  app.post("/api/import", (req: Request, res: Response) => {
    const { nodes, edges, mode } = req.body ?? {};
    if (mode !== "merge" && mode !== "replace") {
      return res.status(400).json({ error: 'mode must be "merge" or "replace"' });
    }
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: "nodes and edges must be arrays" });
    }
    store.importGraph(nodes, edges, mode, { source: "import" });
    res.json({ imported: true });
  });

  app.post("/api/import-project", (req: Request, res: Response) => {
    const { nodes, edges } = req.body ?? {};
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: "nodes and edges must be arrays" });
    }
    const result = importProject(store, nodes as ImportCandidateNode[], (edges as ImportCandidateEdge[]) ?? [], { source: "import" });
    res.json(result);
  });

  app.post("/api/batch", (req: Request, res: Response) => {
    const { operations } = req.body ?? {};
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: "operations must be an array" });
    }
    const results = store.applyBatch(operations as BatchOp[], { source: "api" });
    res.json({ results });
  });

  app.get("/api/validate", (_req: Request, res: Response) => {
    res.json(store.validateProject());
  });

  app.post("/api/analyze-change", (req: Request, res: Response) => {
    const { nodeId, changeType, propsPatch } = req.body ?? {};
    if (typeof nodeId !== "string" || (changeType !== "delete" && changeType !== "modify")) {
      return res.status(400).json({ error: 'nodeId (string) and changeType ("delete"|"modify") are required' });
    }
    if (!store.getNode(nodeId)) return res.status(404).json({ error: "not found" });
    res.json(analyzeChange(store, nodeId, changeType as ChangeType, { propsPatch }));
  });

  app.post("/api/plan-change", (req: Request, res: Response) => {
    const { nodeId, changeType, propsPatch } = req.body ?? {};
    if (typeof nodeId !== "string" || (changeType !== "delete" && changeType !== "modify")) {
      return res.status(400).json({ error: 'nodeId (string) and changeType ("delete"|"modify") are required' });
    }
    if (!store.getNode(nodeId)) return res.status(404).json({ error: "not found" });
    res.json(planChange(store, nodeId, changeType as ChangeType, { propsPatch }));
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json(store.checkHealth());
  });

  app.get("/api/analyze", (req: Request, res: Response) => {
    const topN = typeof req.query.topN === "string" ? Number(req.query.topN) : undefined;
    res.json(summarizeProject(store.getProject("all"), topN));
  });

  app.get("/api/search", (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const types = typeof req.query.types === "string" ? (req.query.types.split(",") as NodeType[]) : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(searchGraph(store.getProject("all"), q, { types, limit }));
  });

  app.post("/api/nodes/:id/sync", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    const { sourceHash, sourcePath } = req.body ?? {};
    res.json(store.recordSync(req.params.id, { sourceHash, sourcePath }, { source: "sync" }));
  });

  app.get("/api/nodes/:id/sync-status", (req: Request, res: Response) => {
    if (!store.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    // Query params can't carry a JSON null — the literal string "null" is the documented sentinel
    // for "checked, the file is gone" (vs. omitting ?hash entirely, meaning "not checked").
    const hash = req.query.hash === "null" ? null : typeof req.query.hash === "string" ? req.query.hash : undefined;
    res.json({ status: store.getSyncStatus(req.params.id, hash) });
  });

  app.post("/api/sync-status", (req: Request, res: Response) => {
    const { hashes } = req.body ?? {};
    if (typeof hashes !== "object" || hashes === null) {
      return res.status(400).json({ error: "hashes (object of nodeId -> hash) is required" });
    }
    res.json(store.getBulkSyncStatus(hashes as Record<string, string | null>));
  });

  app.post("/api/detect-conflicts", (req: Request, res: Response) => {
    const { hashes, scope } = req.body ?? {};
    if (typeof hashes !== "object" || hashes === null) {
      return res.status(400).json({ error: "hashes (object of nodeId -> hash|null) is required" });
    }
    res.json(detectConflicts(store, hashes as Record<string, string | null>, scope));
  });

  app.get("/api/audit-log", (req: Request, res: Response) => {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    res.json(store.listAuditLog({ limit, before }));
  });

  app.get("/api/history", (req: Request, res: Response) => {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    res.json(store.listHistory({ limit, before }));
  });

  app.post("/api/history/undo", (_req: Request, res: Response) => {
    withHistoryErrors(res, () => res.json(store.undo()));
  });

  app.post("/api/history/redo", (_req: Request, res: Response) => {
    withHistoryErrors(res, () => res.json(store.redo()));
  });

  app.post("/api/history/:id/restore", (req: Request, res: Response) => {
    withHistoryErrors(res, () => res.json(store.restoreVersion(req.params.id)));
  });

  app.get("/api/history/compare", (req: Request, res: Response) => {
    const { a, b } = req.query;
    if (typeof a !== "string" || typeof b !== "string") {
      return res.status(400).json({ error: "query params a and b (history entry ids) are required" });
    }
    withHistoryErrors(res, () => res.json(store.compareVersions(a, b)));
  });

  app.get("/api/export/markdown", (req: Request, res: Response) => {
    const graph = store.getProject((req.query.scope as "backend" | "frontend" | "all") ?? "all");
    const domainId = typeof req.query.domainId === "string" ? req.query.domainId : undefined;
    const markdown = exportMarkdown(graph, store.validateProject(), domainId);
    res.setHeader("Content-Type", "text/markdown");
    res.send(markdown);
  });

  app.get("/api/templates", (_req: Request, res: Response) => {
    res.json(TEMPLATES);
  });

  app.post("/api/templates/apply", (req: Request, res: Response) => {
    const { templateId } = req.body ?? {};
    try {
      applyTemplate(store, templateId);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message, issues: err.issues });
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    res.json(store.getProject("all"));
  });

  app.get("/api/suggestions/languages", (_req: Request, res: Response) => {
    res.json({ languages: Object.keys(FRAMEWORKS_BY_LANGUAGE) });
  });

  app.get("/api/suggestions/frameworks", (req: Request, res: Response) => {
    const language = typeof req.query.language === "string" ? req.query.language : "";
    res.json({ frameworks: suggestFrameworks(language) });
  });

  app.get("/api/suggestions/stack", (req: Request, res: Response) => {
    const framework = typeof req.query.framework === "string" ? req.query.framework : "";
    res.json(suggestStack(framework) ?? {});
  });

  app.post("/api/wizard/apply", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<WizardAnswers>;
    const answers: WizardAnswers = {
      language: body.language ?? "",
      framework: body.framework ?? "",
      database: body.database ?? "",
      architecture: body.architecture === "microservices" ? "microservices" : "monolith",
      domains: Array.isArray(body.domains) ? body.domains : [],
    };
    applyWizardAnswers(store, answers);
    res.json(store.getProject("all"));
  });

  const clientDist = join(__dirname, "..", "client", "dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req: Request, res: Response) => res.sendFile(join(clientDist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message, issues: err.issues });
    }
    // body-parser (express.json()) reports malformed JSON / oversized payloads as errors carrying
    // their own 4xx status (e.g. PayloadTooLargeError.status === 413) — surface that instead of 500.
    const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status ?? (err as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).json({ error: err instanceof Error ? err.message : "bad request" });
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface StartServerOptions {
  port: number;
  host?: string;
  authToken?: string;
  /** Required to bind beyond loopback without an auth token — an explicit "I know what I'm doing". */
  allowInsecureLan?: boolean;
  role?: Role;
}

export function startServer(store: ProjectStore, opts: StartServerOptions): Server {
  const host = opts.host ?? "127.0.0.1";
  const isLoopback = LOOPBACK_HOSTS.has(host);
  if (!isLoopback && !opts.authToken && !opts.allowInsecureLan) {
    throw new Error(
      `Refusing to bind to ${host} without authentication: this would expose the API (no auth) beyond ` +
        `localhost. Pass --token <token> to require authentication, or --allow-insecure-lan to bind anyway at your own risk.`,
    );
  }
  const enableRateLimit = Boolean(opts.authToken) || !isLoopback;
  const app = createServer(store, { authToken: opts.authToken, enableRateLimit, role: opts.role });
  const server = createHttpServer(app);
  server.listen(opts.port, host, () => {
    console.error(`project-visualizer listening on http://localhost:${opts.port}`);
    if (!isLoopback) {
      // Only look up (and advertise) the LAN address when the caller explicitly opted into
      // exposing the server beyond localhost.
      const nets = networkInterfaces();
      const lan = Object.values(nets)
        .flat()
        .find((net) => net && net.family === "IPv4" && !net.internal)?.address;
      if (lan) {
        console.error(
          `  also available on http://${lan}:${opts.port}` +
            (opts.authToken ? " (token required)" : " (no auth — only expose on trusted networks)"),
        );
      }
    }
  });
  return server;
}
