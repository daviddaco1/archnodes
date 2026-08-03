import { createInterface } from "node:readline/promises";
import type { ProjectStore } from "../store/project-store.js";
import { suggestFrameworks, suggestStack } from "./suggestions.js";

export interface WizardAnswers {
  language: string;
  framework: string;
  database: string;
  architecture: "monolith" | "microservices";
  domains: string[];
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback || "";
}

export async function runWizard(): Promise<WizardAnswers> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const language = await ask(rl, "Lenguaje (TypeScript/JavaScript/Python)", "TypeScript");

    const frameworkChoices = suggestFrameworks(language);
    const frameworkHint = frameworkChoices.length > 0 ? ` (recomendados: ${frameworkChoices.join(", ")})` : "";
    const framework = await ask(rl, `Framework${frameworkHint}`, frameworkChoices[0]);

    const suggestedStack = suggestStack(framework);
    const database = await ask(rl, "Base de datos", suggestedStack?.database);

    const archInput = await ask(rl, "Arquitectura (monolith/microservices)", "monolith");
    const architecture: WizardAnswers["architecture"] = archInput === "microservices" ? "microservices" : "monolith";

    const domainsInput = await ask(rl, "Dominios (separados por coma)", "");
    const domains = domainsInput
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    return { language, framework, database, architecture, domains };
  } finally {
    rl.close();
  }
}

export function applyWizardAnswers(store: ProjectStore, answers: WizardAnswers): void {
  store.updateManifest({
    language: answers.language,
    framework: answers.framework,
    architecture: answers.architecture,
    databases: answers.database ? [answers.database] : [],
  });

  for (const name of answers.domains) {
    store.createNode("domain", { name });
  }

  if (answers.database) {
    store.createNode("db", { engine: answers.database, connectionType: "native" });
  }
}
