import { useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { GraphProvider, useGraph } from "./context/GraphContext";
import { Tabs, type TabKey } from "./components/layout/Tabs";
import { Toolbar } from "./components/layout/Toolbar";
import { NodePalette } from "./components/palette/NodePalette";
import { GraphCanvas } from "./components/canvas/GraphCanvas";
import { PropertyPanel } from "./components/properties/PropertyPanel";
import { OverviewTab } from "./components/overview/OverviewTab";
import { ValidationPanel } from "./components/validation/ValidationPanel";
import { SetupWizardModal } from "./components/setup/SetupWizardModal";
import { ErrorToast } from "./components/common/ErrorToast";
import { nodeSchemas } from "./schema/nodeSchemas";
import type { ValidationIssue, ValidationResult } from "./api/client";

function AppShell() {
  const { loading, error, notice, dismissNotice, nodes, edges, manifest, refetch, setSelectedNodeId, setFocusField } = useGraph();
  const [tab, setTab] = useState<TabKey>("backend");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const autoShown = useRef(false);

  useEffect(() => {
    if (loading || autoShown.current) return;
    if (nodes.length === 0 && !manifest?.language) {
      setSetupOpen(true);
      autoShown.current = true;
    }
  }, [loading, nodes.length, manifest?.language]);

  const handleNavigateToIssue = (issue: ValidationIssue) => {
    let nodeId = issue.nodeId;
    if (!nodeId && issue.edgeId) {
      const edge = edges.find((e) => e.id === issue.edgeId);
      nodeId = edge?.target ?? edge?.source;
    }
    if (!nodeId) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const category = nodeSchemas[node.type].category;
    if (category === "backend" || category === "frontend") setTab(category);
    setSelectedNodeId(nodeId);
    setFocusField(issue.field ?? null);
    setValidation(null);
  };

  if (loading)
    return (
      <div style={{ padding: 24, color: "var(--color-text-muted)", fontSize: 14 }}>Cargando proyecto...</div>
    );
  if (error)
    return (
      <div style={{ padding: 24, color: "var(--color-danger)", fontSize: 14 }}>Error: {error}</div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar onValidated={setValidation} onOpenSetup={() => setSetupOpen(true)} />
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
        <ValidationPanel result={validation} onClose={() => setValidation(null)} onNavigate={handleNavigateToIssue} />
      </div>
      {notice && <ErrorToast message={notice} onDismiss={dismissNotice} />}
      {setupOpen && (
        <SetupWizardModal
          onClose={() => setSetupOpen(false)}
          onApplied={() => {
            setSetupOpen(false);
            void refetch();
          }}
        />
      )}
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
