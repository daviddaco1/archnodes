import type { FieldDef } from "../../schema/fieldTypes";
import { FieldRenderer } from "./FieldRenderer";

interface ArrayFieldProps {
  itemSchema: FieldDef[];
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
}

export function ArrayField({ itemSchema, value, onChange }: ArrayFieldProps) {
  const updateItem = (index: number, key: string, itemValue: unknown) => {
    const next = value.map((item, i) => (i === index ? { ...item, [key]: itemValue } : item));
    onChange(next);
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...value, {}]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((item, index) => (
        <div
          key={index}
          style={{ border: "1px solid var(--color-border-soft)", borderRadius: "var(--radius-md)", padding: 8, background: "var(--color-canvas-soft)" }}
        >
          {itemSchema.map((field) => (
            <div key={field.key} style={{ marginBottom: 6 }}>
              <label style={{ display: "block", marginBottom: 2 }}>{field.label}</label>
              <FieldRenderer field={field} value={item[field.key]} onChange={(v) => updateItem(index, field.key, v)} />
            </div>
          ))}
          <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => removeItem(index)}>
            Quitar
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={addItem}>
        + Agregar
      </button>
    </div>
  );
}
