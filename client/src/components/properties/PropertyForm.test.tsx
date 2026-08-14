import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyForm } from "./PropertyForm";
import { GraphProvider } from "../../context/GraphContext";
import * as api from "../../api/client";
import type { AnyGraphNode } from "@project-visualizer/shared/graph.js";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof api>("../../api/client");
  return { ...actual, getProject: vi.fn(), getSchema: vi.fn(), updateNode: vi.fn() };
});

const TS = "2024-01-01T00:00:00.000Z";
const emptySchema = { connections: [], nodeTypes: [], requiredFields: {}, refFields: {} };

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown, overrides: Partial<AnyGraphNode> = {}): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, props, createdAt: TS, updatedAt: TS, ...overrides } as AnyGraphNode;
}

function mockProject(nodes: AnyGraphNode[]) {
  vi.mocked(api.getProject).mockResolvedValue({ manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes, edges: [] } as never);
}

beforeEach(() => {
  vi.mocked(api.getSchema).mockResolvedValue(emptySchema as never);
});

describe("PropertyForm", () => {
  it("commits the edited draft via updateNode on blur", async () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    mockProject([domain]);
    vi.mocked(api.updateNode).mockResolvedValue(domain);
    const onSaved = vi.fn();

    render(
      <GraphProvider>
        <PropertyForm node={domain} onSaved={onSaved} />
      </GraphProvider>,
    );

    const input = await screen.findByDisplayValue("Auth");
    fireEvent.change(input, { target: { value: "AuthRenamed" } });
    fireEvent.blur(input);

    await waitFor(() => expect(api.updateNode).toHaveBeenCalledWith("d1", expect.objectContaining({ name: "AuthRenamed" })));
    expect(onSaved).toHaveBeenCalled();
  });

  it("narrows an operation's method options to what's not already used by a sibling operation", async () => {
    const endpoint = mkNode("e1", "endpoint", { name: "x", methods: ["GET", "POST"] });
    const opA = mkNode("opA", "operation", { method: "GET" }, { parentId: "e1" });
    const opB = mkNode("opB", "operation", {}, { parentId: "e1" });
    mockProject([endpoint, opA, opB]);

    render(
      <GraphProvider>
        <PropertyForm node={opB} onSaved={vi.fn()} />
      </GraphProvider>,
    );

    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toContain("POST");
    expect(optionValues).not.toContain("GET");
  });

  it("hides authMethods once an endpoint is marked public", async () => {
    const endpoint = mkNode("e1", "endpoint", { name: "x", methods: ["GET"], isPublic: true, authMethods: ["jwt"] });
    mockProject([endpoint]);

    render(
      <GraphProvider>
        <PropertyForm node={endpoint} onSaved={vi.fn()} />
      </GraphProvider>,
    );

    await screen.findByDisplayValue("x");
    expect(screen.queryByText("authMethods", { exact: false })).not.toBeInTheDocument();
  });
});
