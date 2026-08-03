import type { ProjectStore } from "../store/project-store.js";

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

export const TEMPLATES: Template[] = [
  {
    id: "node-express-postgres-react",
    label: "Node/Express + PostgreSQL (Prisma) + React",
    description: "Stack clásico full-stack JS, el más usado en la comunidad.",
    language: "TypeScript",
    framework: "Express",
    database: "PostgreSQL",
    orm: "Prisma",
    frontendFramework: "React",
    architecture: "monolith",
  },
  {
    id: "node-nest-postgres-angular",
    label: "NestJS + PostgreSQL (TypeORM) + Angular",
    description: "Stack empresarial, opinado, con arquitectura modular tipo Angular en el backend.",
    language: "TypeScript",
    framework: "NestJS",
    database: "PostgreSQL",
    orm: "TypeORM",
    frontendFramework: "Angular",
    architecture: "monolith",
  },
  {
    id: "node-express-mongo-react",
    label: "Node/Express + MongoDB (Mongoose) + React",
    description: "Stack tipo MERN, popular para prototipos y proyectos pequeños/medianos.",
    language: "TypeScript",
    framework: "Express",
    database: "MongoDB",
    orm: "Mongoose",
    frontendFramework: "React",
    architecture: "monolith",
  },
  {
    id: "python-fastapi-postgres-react",
    label: "FastAPI + PostgreSQL (SQLAlchemy) + React",
    description: "Backend Python moderno de alto rendimiento, muy recomendado para APIs.",
    language: "Python",
    framework: "FastAPI",
    database: "PostgreSQL",
    orm: "SQLAlchemy",
    frontendFramework: "React",
    architecture: "monolith",
  },
  {
    id: "node-fastify-postgres-vue",
    label: "Fastify + PostgreSQL (Drizzle) + Vue",
    description: "Stack liviano y moderno, buen desempeño, adopción creciente en la comunidad.",
    language: "TypeScript",
    framework: "Fastify",
    database: "PostgreSQL",
    orm: "Drizzle",
    frontendFramework: "Vue",
    architecture: "monolith",
  },
  {
    id: "node-microservices-postgres-react",
    label: "Node/Express (microservicios) + PostgreSQL + React",
    description: "Punto de partida para arquitectura de microservicios en vez de monolito.",
    language: "TypeScript",
    framework: "Express",
    database: "PostgreSQL",
    orm: "Prisma",
    frontendFramework: "React",
    architecture: "microservices",
  },
];

export function applyTemplate(store: ProjectStore, templateId: string): void {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Unknown template "${templateId}". Available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
  }
  store.updateManifest({
    language: template.language,
    framework: template.framework,
    architecture: template.architecture,
    databases: [template.database],
  });

  const db = store.createNode("db", { engine: template.database, connectionType: "orm" });
  if (template.orm) {
    // orm -> db is a ref field (orm.props.dbId), not a hierarchy edge, so no connectNodes call needed.
    store.createNode("orm", { name: template.orm, dbId: db.id });
  }
}
