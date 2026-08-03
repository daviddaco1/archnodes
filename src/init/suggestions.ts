export const FRAMEWORKS_BY_LANGUAGE: Record<string, string[]> = {
  TypeScript: ["Express", "NestJS", "Fastify"],
  JavaScript: ["Express", "Fastify"],
  Python: ["FastAPI", "Django", "Flask"],
};

export interface StackSuggestion {
  orm: string;
  database: string;
}

export const STACK_BY_FRAMEWORK: Record<string, StackSuggestion> = {
  Express: { orm: "Prisma", database: "PostgreSQL" },
  NestJS: { orm: "TypeORM", database: "PostgreSQL" },
  Fastify: { orm: "Drizzle", database: "PostgreSQL" },
  FastAPI: { orm: "SQLAlchemy", database: "PostgreSQL" },
  Django: { orm: "Django ORM", database: "PostgreSQL" },
  Flask: { orm: "SQLAlchemy", database: "PostgreSQL" },
};

export function suggestFrameworks(language: string): string[] {
  return FRAMEWORKS_BY_LANGUAGE[language] ?? [];
}

export function suggestStack(framework: string): StackSuggestion | undefined {
  return STACK_BY_FRAMEWORK[framework];
}
