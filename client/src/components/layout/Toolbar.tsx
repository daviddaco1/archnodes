import * as api from "../../api/client";
import { useGraph } from "../../context/GraphContext";
import type { ValidationResult } from "../../api/client";

interface ToolbarProps {
  onValidated: (result: ValidationResult) => void;
  onOpenSetup: () => void;
}

export function Toolbar({ onValidated, onOpenSetup }: ToolbarProps) {
  const { manifest } = useGraph();

  const handleValidate = async () => {
    const result = await api.validateProject();
    onValidated(result);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 56,
        padding: "0 16px",
        borderBottom: "1px solid var(--color-border-soft)",
        background: "var(--color-canvas)",
      }}
    >
      <strong style={{ fontSize: 14, letterSpacing: "-0.01em" }}>{manifest?.projectName ?? "project-visualizer"}</strong>
      {manifest?.framework && <span className="badge">{manifest.framework}</span>}
      <div style={{ flex: 1 }} />
      <button className="btn-secondary" onClick={onOpenSetup}>
        Setup
      </button>
      <button className="btn-secondary" onClick={() => void handleValidate()}>
        Validar
      </button>
      <a href={api.exportMarkdownUrl()} download="project-context.md">
        <button type="button" className="btn-primary">
          Exportar Markdown
        </button>
      </a>
    </div>
  );
}
