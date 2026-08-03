import type { ValidationResult } from "../../api/client";

interface ValidationPanelProps {
  result: ValidationResult | null;
  onClose: () => void;
}

export function ValidationPanel({ result, onClose }: ValidationPanelProps) {
  if (!result) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        right: 12,
        width: 360,
        maxHeight: "60vh",
        overflowY: "auto",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: 12,
        zIndex: 20,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{result.valid ? "✓ Grafo válido" : `${result.issues.length} problema(s)`}</strong>
        <button onClick={onClose}>×</button>
      </div>
      {result.issues.map((issue, i) => (
        <div key={i} style={{ marginBottom: 6, color: issue.level === "error" ? "var(--color-danger)" : "var(--color-text-muted)" }}>
          [{issue.code}] {issue.message}
        </div>
      ))}
    </div>
  );
}
