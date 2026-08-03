import * as api from "../../api/client";
import { useGraph } from "../../context/GraphContext";
import type { ValidationResult } from "../../api/client";

interface ToolbarProps {
  onValidated: (result: ValidationResult) => void;
}

export function Toolbar({ onValidated }: ToolbarProps) {
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
        gap: 12,
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <strong>{manifest?.projectName ?? "project-visualizer"}</strong>
      {manifest?.framework && <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{manifest.framework}</span>}
      <div style={{ flex: 1 }} />
      <button onClick={() => void handleValidate()}>Validar</button>
      <a href={api.exportMarkdownUrl()} download="project-context.md">
        <button type="button">Exportar Markdown</button>
      </a>
    </div>
  );
}
