#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createProjectStore } from "./store/project-store.js";
import { startServer } from "./server.js";
import { startMcpServer } from "./mcp/server.js";
import { runWizard, applyWizardAnswers } from "./init/wizard.js";
import { applyTemplate, TEMPLATES } from "./init/templates.js";

function printUsage(): void {
  console.error(`project-visualizer <command> [options]

Commands:
  start --project <name> [--port <port>] [--host <host>]   Start the visual editor server
                                            (default host 127.0.0.1; pass --host 0.0.0.0 to expose on the LAN — no auth)
  mcp --project <name>                      Start the MCP stdio server for AI agents
  init --project <name> [--template <id>]   Initialize a new project (interactive or via template)

Templates: ${TEMPLATES.map((t) => t.id).join(", ")}
`);
}

function requireProject(project: string | undefined): string {
  if (!project) {
    printUsage();
    process.exit(1);
  }
  return project;
}

async function runStart(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: "string" }, port: { type: "string" }, host: { type: "string" } },
  });
  const project = requireProject(values.project);
  const store = createProjectStore(project);
  startServer(store, { port: values.port ? Number(values.port) : 4173, host: values.host });
}

async function runMcp(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { project: { type: "string" } } });
  const project = requireProject(values.project);
  const store = createProjectStore(project);
  await startMcpServer(store);
}

async function runInit(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: "string" }, template: { type: "string" } },
  });
  const project = requireProject(values.project);
  const store = createProjectStore(project);

  if (values.template) {
    applyTemplate(store, values.template);
    console.error(`Initialized "${project}" from template "${values.template}"`);
    return;
  }

  if (process.stdin.isTTY) {
    const answers = await runWizard();
    applyWizardAnswers(store, answers);
    console.error(`Initialized "${project}" from wizard answers`);
  } else {
    console.error(`Initialized empty project "${project}"`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "start":
      await runStart(rest);
      break;
    case "mcp":
      await runMcp(rest);
      break;
    case "init":
      await runInit(rest);
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
