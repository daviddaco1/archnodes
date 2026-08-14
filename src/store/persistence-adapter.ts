import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectGraph } from "../types/graph.js";
import { assertValidProjectName } from "../security/project-name.js";

// Everything project-store.ts needs to persist/load/lock/snapshot the graph, extracted behind an
// interface so a future backend (SQLite, etc.) can implement the same contract without touching
// the store's mutation logic. The only implementation today is the JSON file adapter below —
// nothing here migrates automatically, this just moves the seam to where it'll be needed.
export interface PersistenceAdapter {
  load(): ProjectGraph;
  save(graph: ProjectGraph): void;
  acquireLock(): void;
  releaseLock(): void;
  snapshot(): void;
}

// Below this many nodes, a cascade delete is cheap to redo by hand; above it, snapshot first.
export const CASCADE_SNAPSHOT_THRESHOLD = 5;

function now(): string {
  return new Date().toISOString();
}

export function projectPath(projectName: string, baseDir?: string): string {
  // Defense in depth: createProjectStore() already validates this before ever reaching the
  // adapter, but any future direct caller of the adapter gets the same guarantee for free.
  assertValidProjectName(projectName);
  const root = baseDir ?? join(homedir(), ".project-visualizer", "projects");
  return join(root, projectName, "project.json");
}

function loadOrInit(projectName: string, path: string): ProjectGraph {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf-8")) as ProjectGraph;
  }
  const timestamp = now();
  return {
    manifest: { projectName, createdAt: timestamp, updatedAt: timestamp },
    nodes: [],
    edges: [],
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by someone else — still counts as alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// One process-level exit hook releases every lock this process holds, instead of one
// `process.once` listener per store — createProjectStore can be called many times per process
// (e.g. across a test suite) without tripping Node's max-listeners warning.
const activeLocks = new Set<string>();
let exitHandlersRegistered = false;

function releaseAllLocks(): void {
  for (const lockPath of activeLocks) {
    try {
      if (readFileSync(lockPath, "utf-8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      // already gone — nothing to release
    }
  }
  activeLocks.clear();
}

function registerExitHandlersOnce(): void {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;
  process.once("exit", releaseAllLocks);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      releaseAllLocks();
      process.exit(0);
    });
  }
}

// Guards against the exact failure mode two servers sharing one project.json are prone to:
// each process holds its own in-memory copy, and whichever persists last silently wins. A stale
// lock (owner process no longer alive) is reclaimed rather than treated as a conflict.
function acquireLockFile(lockPath: string): void {
  if (existsSync(lockPath)) {
    const ownerPid = Number(readFileSync(lockPath, "utf-8").trim());
    if (Number.isFinite(ownerPid) && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
      throw new Error(
        `Project is already open in another process (pid ${ownerPid}). Close it before starting a new one — ` +
          `running two at once against the same project.json silently overwrites whichever one saves last.`,
      );
    }
  }
  writeFileSync(lockPath, String(process.pid));
  activeLocks.add(lockPath);
  registerExitHandlersOnce();
}

function releaseLockFile(lockPath: string): void {
  activeLocks.delete(lockPath);
  try {
    if (existsSync(lockPath) && readFileSync(lockPath, "utf-8").trim() === String(process.pid)) unlinkSync(lockPath);
  } catch {
    // already gone — nothing to release
  }
}

// Lightweight safety net for destructive bulk writes (import replace, large cascade deletes) —
// a single best-effort copy of the current file, not a history/versioning feature (see
// src/history/history.ts for the real thing). No retention or pruning.
function snapshotIfExists(filePath: string): void {
  if (!existsSync(filePath)) return;
  const snapshotDir = join(dirname(filePath), ".snapshots");
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(join(snapshotDir, `project.${Date.now()}.json`), readFileSync(filePath));
}

export function createJsonFileAdapter(projectName: string, baseDir?: string): PersistenceAdapter {
  const filePath = projectPath(projectName, baseDir);

  return {
    load() {
      mkdirSync(join(filePath, ".."), { recursive: true });
      return loadOrInit(projectName, filePath);
    },
    save(graph: ProjectGraph) {
      const tmpPath = `${filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(graph, null, 2));
      renameSync(tmpPath, filePath);
    },
    acquireLock() {
      mkdirSync(join(filePath, ".."), { recursive: true });
      acquireLockFile(`${filePath}.lock`);
    },
    releaseLock() {
      releaseLockFile(`${filePath}.lock`);
    },
    snapshot() {
      snapshotIfExists(filePath);
    },
  };
}
