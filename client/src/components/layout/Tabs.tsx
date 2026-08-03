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
    <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            padding: "8px 16px",
            border: "none",
            background: "transparent",
            borderBottom: active === tab ? "2px solid var(--color-accent)" : "2px solid transparent",
            fontWeight: active === tab ? 600 : 400,
          }}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}
