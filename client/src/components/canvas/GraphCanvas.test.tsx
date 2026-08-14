import { ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "./GraphCanvas";
import { GraphProvider, useGraph } from "../../context/GraphContext";
import * as api from "../../api/client";
import type { AnyGraphNode } from "@project-visualizer/shared/graph.js";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof api>("../../api/client");
  return {
    ...actual,
    getProject: vi.fn(),
    getSchema: vi.fn(),
    createNode: vi.fn(),
    updateNodePosition: vi.fn(),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    createEdge: vi.fn(),
    setNodeContainer: vi.fn(),
  };
});

const TS = "2024-01-01T00:00:00.000Z";
const emptySchema = { connections: [], nodeTypes: [], requiredFields: {}, refFields: {} };

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown, parentId?: string): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, parentId, props, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

function Harness() {
  const { selectedNodeId } = useGraph();
  return (
    <>
      <div data-testid="selected">{selectedNodeId ?? "none"}</div>
      <GraphCanvas category="backend" />
    </>
  );
}

function renderCanvas() {
  return render(
    <GraphProvider>
      <ReactFlowProvider>
        <Harness />
      </ReactFlowProvider>
    </GraphProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getSchema).mockResolvedValue(emptySchema as never);
  vi.mocked(api.updateNodePosition).mockResolvedValue({} as never);
});

describe("GraphCanvas", () => {
  it("clicking a node selects it", async () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    vi.mocked(api.getProject).mockResolvedValue({ manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes: [domain], edges: [] } as never);

    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector('[data-testid="rf__node-d1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-testid="rf__node-d1"]') as Element);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("d1"));
  });

  it("delete confirmation card calls api.deleteNode and clears selection", async () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    vi.mocked(api.getProject).mockResolvedValue({ manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes: [domain], edges: [] } as never);
    vi.mocked(api.deleteNode).mockResolvedValue({ deletedIds: ["d1"] });

    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector('[data-testid="rf__node-d1"]')).toBeTruthy());

    const nodeEl = container.querySelector('[data-testid="rf__node-d1"]') as Element;
    fireEvent.contextMenu(nodeEl);
    fireEvent.click(screen.getByText("Eliminar nodo"));
    fireEvent.click(screen.getByText("¿Eliminar este nodo?").parentElement!.querySelector(".btn-danger")!);

    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith("d1", false));
  });

  it("duplicating a node creates a copy via createNode + updateNodePosition", async () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    vi.mocked(api.getProject).mockResolvedValue({ manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes: [domain], edges: [] } as never);
    vi.mocked(api.createNode).mockResolvedValue(mkNode("d2", "domain", { name: "Auth" }));

    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector('[data-testid="rf__node-d1"]')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('[data-testid="rf__node-d1"]') as Element);
    fireEvent.click(screen.getByText("Duplicar nodo"));

    await waitFor(() => expect(api.createNode).toHaveBeenCalledWith("domain", { name: "Auth" }));
    expect(api.updateNodePosition).toHaveBeenCalled();
  });
});
