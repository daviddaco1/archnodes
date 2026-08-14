import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphProvider, useGraph } from "./GraphContext";
import * as api from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof api>("../api/client");
  return { ...actual, getProject: vi.fn(), getSchema: vi.fn() };
});

const mockGraph = { manifest: { projectName: "p", createdAt: "t", updatedAt: "t" }, nodes: [], edges: [] };
const mockSchema = { connections: [], nodeTypes: [], requiredFields: {}, refFields: {} };

beforeEach(() => {
  vi.mocked(api.getProject).mockResolvedValue(mockGraph as never);
  vi.mocked(api.getSchema).mockResolvedValue(mockSchema as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GraphProvider / useGraph", () => {
  it("loads the graph and schema on mount", async () => {
    const { result } = renderHook(() => useGraph(), { wrapper: GraphProvider });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an initial load failure as a blocking error, not a dismissible notice", async () => {
    vi.mocked(api.getProject).mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useGraph(), { wrapper: GraphProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.notice).toBeNull();
  });

  it("surfaces a post-load refetch failure as a dismissible notice, not a blocking error", async () => {
    const { result } = renderHook(() => useGraph(), { wrapper: GraphProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(api.getProject).mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.notice).toBe("save failed");
    expect(result.current.error).toBeNull();
  });

  it("discards a stale refetch that resolves after a newer one", async () => {
    const { result } = renderHook(() => useGraph(), { wrapper: GraphProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveFirst!: (v: typeof mockGraph) => void;
    vi.mocked(api.getProject).mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    const staleManifest = { ...mockGraph, manifest: { ...mockGraph.manifest, projectName: "stale" } };
    const freshManifest = { ...mockGraph, manifest: { ...mockGraph.manifest, projectName: "fresh" } };

    const firstCall = result.current.refetch(); // in-flight, deliberately not awaited yet
    vi.mocked(api.getProject).mockResolvedValueOnce(freshManifest as never);
    await act(async () => {
      await result.current.refetch(); // second, newer call resolves first
    });
    resolveFirst(staleManifest as never); // stale call resolves after — must be discarded
    await act(async () => {
      await firstCall;
    });

    expect(result.current.manifest?.projectName).toBe("fresh");
  });
});
