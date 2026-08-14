import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no ResizeObserver — React Flow uses one internally to measure its pane, so any test
// that renders <ReactFlow> needs at least a no-op stand-in.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// No `globals: true` in vitest.config.ts (keeps the explicit-import style the rest of the repo
// uses) — @testing-library/react's own auto-cleanup only self-registers when it finds a global
// afterEach, so it has to be wired up here instead.
afterEach(() => cleanup());
