// Standalone script, not a vitest suite — a performance threshold in CI is flaky by construction
// (depends on the machine running it). Run manually with `npm run perf`, read the numbers, decide
// whether anything here (see CLAUDE.md's performance notes once they exist) needs attention.
import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSyntheticGraph } from "./synth.js";
import { validateProjectGraph } from "../validation/rules.js";
import { checkProjectHealth } from "../validation/health.js";
import { getAffectedNodes, getDependents } from "../analysis/dependencies.js";
import { exportMarkdown } from "../export/markdown.js";
import { createJsonFileAdapter } from "../store/persistence-adapter.js";

const SIZES = [100, 500, 1000, 5000, 10000];

function time(n: number, label: string, fn: () => void): void {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`${n}\t${label}\t${ms.toFixed(2)}ms`);
}

async function main(): Promise<void> {
  console.log("N\toperation\tms");
  for (const n of SIZES) {
    const graph = generateSyntheticGraph(n);
    const sampleNode = graph.nodes[Math.floor(graph.nodes.length / 2)];

    time(n, "validateProjectGraph", () => {
      validateProjectGraph(graph);
    });
    time(n, "checkProjectHealth", () => {
      checkProjectHealth(graph);
    });
    // The reverse-scan of REF_FIELDS in getDependents (no maintained index — see
    // src/analysis/dependencies.ts) is the one already flagged as a suspect in the audit; measure
    // it explicitly rather than folding it into a generic "analysis" bucket.
    time(n, "getDependents", () => {
      getDependents(sampleNode.id, graph);
    });
    time(n, "getAffectedNodes", () => {
      getAffectedNodes(sampleNode.id, graph);
    });
    time(n, "exportMarkdown", () => {
      exportMarkdown(graph);
    });

    let serialized = "";
    time(n, "JSON.stringify", () => {
      serialized = JSON.stringify(graph);
    });
    time(n, "JSON.parse", () => {
      JSON.parse(serialized);
    });

    // Real I/O, not just CPU — also feeds the Fase 17 "is JSON persistence a bottleneck" question.
    const dir = mkdtempSync(join(tmpdir(), "pv-bench-"));
    const adapter = createJsonFileAdapter(`bench-${n}`, dir);
    adapter.acquireLock();
    time(n, "adapter.save", () => {
      adapter.save(graph);
    });
    time(n, "adapter.load", () => {
      adapter.load();
    });
    adapter.releaseLock();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
