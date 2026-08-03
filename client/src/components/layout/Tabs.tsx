export type TabKey = "backend" | "frontend" | "overview";

interface TabsProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

const TAB_LABELS: Record<TabKey, string> = {
  backend: "Backend",
  frontend: "Frontend",
  overview: "Overview",
};

export function Tabs({ active, onChange }: TabsProps) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "0 12px", borderBottom: "1px solid var(--color-border-soft)", background: "var(--color-canvas)" }}>
      {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className="btn-icon"
          style={{
            padding: "10px 12px",
            borderRadius: 0,
            borderBottom: active === tab ? "2px solid var(--color-text)" : "2px solid transparent",
            color: active === tab ? "var(--color-text)" : "var(--color-text-muted)",
            fontWeight: active === tab ? 600 : 500,
          }}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}
