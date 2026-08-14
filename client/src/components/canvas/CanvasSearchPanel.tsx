import { nodeSchemasByCategory } from "../../schema/nodeSchemas";
import type { NodeType } from "@project-visualizer/shared/graph.js";

interface CanvasSearchPanelProps {
  category: "backend" | "frontend";
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  selectedTypes: Set<NodeType> | null;
  onToggleType: (type: NodeType) => void;
  onClearTypes: () => void;
  onAutoLayout: () => void;
  focusLabel?: string;
  onClearFocus: () => void;
}

export function CanvasSearchPanel({
  category,
  searchQuery,
  onSearchQueryChange,
  selectedTypes,
  onToggleType,
  onClearTypes,
  onAutoLayout,
  focusLabel,
  onClearFocus,
}: CanvasSearchPanelProps) {
  const items = nodeSchemasByCategory(category);

  return (
    <div className="card" style={{ position: "absolute", top: 16, left: 16, padding: 10, zIndex: 10, width: 220 }} onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Buscar nodos..."
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "4px 6px", fontSize: 12 }}
      />
      <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 8 }}>
        {items.map((schema) => (
          <label key={schema.type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "2px 0" }}>
            <input type="checkbox" checked={!selectedTypes || selectedTypes.has(schema.type)} onChange={() => onToggleType(schema.type)} />
            <span className="mono">{schema.type}</span>
          </label>
        ))}
      </div>
      {selectedTypes && (
        <button type="button" className="btn-secondary" style={{ width: "100%", marginBottom: 8, fontSize: 11 }} onClick={onClearTypes}>
          Limpiar filtro de tipo
        </button>
      )}
      <button type="button" className="btn-secondary" style={{ width: "100%", fontSize: 11 }} onClick={onAutoLayout}>
        Auto layout
      </button>
      {focusLabel && (
        <div style={{ marginTop: 8, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Foco: {focusLabel}</span>
          <button type="button" className="btn-secondary" style={{ fontSize: 10, padding: "2px 6px" }} onClick={onClearFocus}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
