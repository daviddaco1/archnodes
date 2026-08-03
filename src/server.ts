import express, { type Request, type Response, type NextFunction } from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { ProjectStore } from "./store/project-store.js";
import { ValidationError } from "./validation/rules.js";
import type { EdgeType, NodeType } from "./types/graph.js";
import { buildSchemaResponse } from "./schema.js";
import { exportMarkdown } from "./export/markdown.js";
import { TEMPLATES, applyTemplate } from "./init/templates.js";
import { FRAMEWORKS_BY_LANGUAGE, suggestFrameworks, suggestStack } from "./init/suggestions.js";
import { applyWizardAnswers, type WizardAnswers } from "./init/wizard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(store: ProjectStore): express.Express {
  const app = express();
  app.use(express.json());

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
    const node = store.createNode(type as NodeType, props, parentId);
    res.status(201).json(node);
  });

  app.patch("/api/nodes/:id", (req: Request, res: Response) => {
    const body = req.body ?? {};
    let node = store.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (body.position !== undefined) node = store.setPosition(req.params.id, body.position);
    if (body.containerId !== undefined) node = store.setContainer(req.params.id, body.containerId || undefined);
    if (body.props !== undefined || (body.position === undefined && body.containerId === undefined)) {
      node = store.updateNode(req.params.id, body.props ?? body);
    }
    res.json(node);
  });

  app.delete("/api/nodes/:id", (req: Request, res: Response) => {
    const cascade = req.query.cascade === "true";
    const result = store.deleteNode(req.params.id, cascade);
    res.json(result);
  });

  app.post("/api/edges", (req: Request, res: Response) => {
    const { sourceId, targetId, edgeType } = req.body ?? {};
    const edge = store.connectNodes(sourceId, targetId, edgeType as EdgeType | undefined);
    res.status(201).json(edge);
  });

  app.delete("/api/edges/:id", (req: Request, res: Response) => {
    store.deleteEdge(req.params.id);
    res.status(204).end();
  });

  app.get("/api/validate", (_req: Request, res: Response) => {
    res.json(store.validateProject());
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
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

export function startServer(store: ProjectStore, opts: { port: number }): Server {
  const app = createServer(store);
  const server = createHttpServer(app);
  server.listen(opts.port, "0.0.0.0", () => {
    const nets = networkInterfaces();
    const lan = Object.values(nets)
      .flat()
      .find((net) => net && net.family === "IPv4" && !net.internal)?.address;
    console.error(`project-visualizer listening on http://localhost:${opts.port}`);
    if (lan) console.error(`  also available on http://${lan}:${opts.port}`);
  });
  return server;
}
