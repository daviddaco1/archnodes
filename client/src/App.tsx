import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { GraphProvider, useGraph } from "./context/GraphContext";
import { Tabs, type TabKey } from "./components/layout/Tabs";
import { Toolbar } from "./components/layout/Toolbar";
import { NodePalette } from "./components/palette/NodePalette";
import { GraphCanvas } from "./components/canvas/GraphCanvas";
import { PropertyPanel } from "./components/properties/PropertyPanel";
import { OverviewTab } from "./components/overview/OverviewTab";
import { ValidationPanel } from "./components/validation/ValidationPanel";
import type { ValidationResult } from "./api/client";

function AppShell() {
  const { loading, error } = useGraph();
  const [tab, setTab] = useState<TabKey>("backend");
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  if (loading) return <div style={{ padding: 24 }}>Cargando proyecto...</div>;
  if (error) return <div style={{ padding: 24, color: "var(--color-danger)" }}>Error: {error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar onValidated={setValidation} />
      <Tabs active={tab} onChange={setTab} />
      <div style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
        {tab === "overview" ? (
          <OverviewTab />
        ) : (
          <ReactFlowProvider>
            <NodePalette category={tab} />
            <div style={{ flex: 1, position: "relative" }}>
              <GraphCanvas category={tab} />
            </div>
            <PropertyPanel />
          </ReactFlowProvider>
        )}
        <ValidationPanel result={validation} onClose={() => setValidation(null)} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <GraphProvider>
      <AppShell />
    </GraphProvider>
  );
}
