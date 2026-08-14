import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./client";
import { ApiError } from "./client";

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "error",
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request() error handling", () => {
  it("throws an ApiError carrying issues on a non-ok response", async () => {
    mockFetchOnce(400, { error: "bad request", issues: [{ level: "error", code: "MISSING_FIELD", message: "x" }] });
    await expect(api.validateProject()).rejects.toBeInstanceOf(ApiError);
    try {
      await api.validateProject();
    } catch (err) {
      expect((err as ApiError).issues).toHaveLength(1);
    }
  });

  it("resolves undefined for a 204 response", async () => {
    mockFetchOnce(204, undefined);
    await expect(api.deleteEdge("e1")).resolves.toBeUndefined();
  });
});

describe("API wrappers hit the right endpoint/method/body", () => {
  it("createNode POSTs to /api/nodes with the given payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: "n1" }) });
    vi.stubGlobal("fetch", fetchMock);
    await api.createNode("domain", { name: "Auth" }, "parent-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/nodes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ type: "domain", props: { name: "Auth" }, parentId: "parent-1" });
  });

  it("getNodeDependencies/Dependents/Affected hit their respective endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });
    vi.stubGlobal("fetch", fetchMock);
    await api.getNodeDependencies("n1");
    await api.getNodeDependents("n1");
    await api.getNodeAffected("n1");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/nodes/n1/dependencies",
      "/api/nodes/n1/dependents",
      "/api/nodes/n1/affected",
    ]);
  });

  it("batchUpdatePositions posts a single /api/batch request with one setPosition op per node", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ results: [1, 2] }) });
    vi.stubGlobal("fetch", fetchMock);
    const results = await api.batchUpdatePositions([
      { id: "a", x: 10, y: 20 },
      { id: "b", x: 30, y: 40 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/batch");
    expect(JSON.parse(init.body)).toEqual({
      operations: [
        { method: "setPosition", args: ["a", { x: 10, y: 20 }] },
        { method: "setPosition", args: ["b", { x: 30, y: 40 }] },
      ],
    });
    expect(results).toEqual([1, 2]);
  });
});
