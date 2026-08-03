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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {value.map((item, index) => (
        <div key={index} style={{ border: "1px solid var(--color-border)", borderRadius: 4, padding: 6 }}>
          {itemSchema.map((field) => (
            <div key={field.key} style={{ marginBottom: 4 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)" }}>{field.label}</label>
              <FieldRenderer field={field} value={item[field.key]} onChange={(v) => updateItem(index, field.key, v)} />
            </div>
          ))}
          <button type="button" onClick={() => removeItem(index)}>
            Quitar
          </button>
        </div>
      ))}
      <button type="button" onClick={addItem}>
        + Agregar
      </button>
    </div>
  );
}
