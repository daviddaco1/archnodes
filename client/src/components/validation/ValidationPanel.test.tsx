import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidationPanel } from "./ValidationPanel";
import type { ValidationResult } from "../../api/client";

describe("ValidationPanel", () => {
  it("renders nothing when there is no result yet", () => {
    const { container } = render(<ValidationPanel result={null} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a valid state with no issues", () => {
    render(<ValidationPanel result={{ valid: true, issues: [] }} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText("✓ Grafo válido")).toBeInTheDocument();
  });

  it("clicking a navigable issue (has nodeId) calls onNavigate with that issue", () => {
    const onNavigate = vi.fn();
    const issue = { level: "error" as const, code: "MISSING_FIELD", nodeId: "n1", message: "missing name" };
    render(<ValidationPanel result={{ valid: false, issues: [issue] }} onClose={vi.fn()} onNavigate={onNavigate} />);
    screen.getByText("missing name", { exact: false }).click();
    expect(onNavigate).toHaveBeenCalledWith(issue);
  });

  it("clicking a non-navigable issue (no nodeId/edgeId) does not call onNavigate", () => {
    const onNavigate = vi.fn();
    const issue = { level: "warning" as const, code: "SOME_CODE", message: "generic warning" };
    render(<ValidationPanel result={{ valid: false, issues: [issue] } as ValidationResult} onClose={vi.fn()} onNavigate={onNavigate} />);
    screen.getByText("generic warning", { exact: false }).click();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ValidationPanel result={{ valid: true, issues: [] }} onClose={onClose} onNavigate={vi.fn()} />);
    screen.getByText("×").click();
    expect(onClose).toHaveBeenCalled();
  });
});
