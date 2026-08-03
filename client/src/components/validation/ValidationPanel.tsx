import type { ValidationResult } from "../../api/client";

interface ValidationPanelProps {
  result: ValidationResult | null;
  onClose: () => void;
}

export function ValidationPanel({ result, onClose }: ValidationPanelProps) {
  if (!result) return null;

  return (
    <div
      className="card"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 380,
        maxHeight: "60vh",
        overflowY: "auto",
        padding: 16,
        zIndex: 20,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ color: result.valid ? "var(--color-accent)" : "var(--color-danger)" }}>
          {result.valid ? "✓ Grafo válido" : `${result.issues.length} problema(s)`}
        </strong>
        <button className="btn-icon" onClick={onClose}>
          ×
        </button>
      </div>
      {result.issues.map((issue, i) => (
        <div
          key={i}
          style={{
            marginBottom: 6,
            paddingBottom: 6,
            borderBottom: i < result.issues.length - 1 ? "1px solid var(--color-border-soft)" : "none",
            color: issue.level === "error" ? "var(--color-danger)" : "var(--color-text-muted)",
          }}
        >
          <span className="mono" style={{ fontSize: 11, marginRight: 6 }}>
            [{issue.code}]
          </span>
          {issue.message}
        </div>
      ))}
    </div>
  );
}
