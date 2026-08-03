import type { FieldDef } from "../../schema/fieldTypes";
import { RefSelectField } from "./RefSelectField";
import { ArrayField } from "./ArrayField";

interface FieldRendererProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  switch (field.kind) {
    case "text":
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return <textarea value={(value as string) ?? ""} rows={3} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "refSelect":
    case "refSelectCrossTab":
      return <RefSelectField field={field} value={value as string | undefined} onChange={onChange} />;
    case "multiSelect": {
      const selected = (value as string[]) ?? [];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {field.options?.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className="mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${checked ? "var(--color-text)" : "var(--color-border)"}`,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt))}
                  style={{ width: "auto" }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
    }
    case "arrayOfObjects":
      return (
        <ArrayField
          itemSchema={field.itemSchema ?? []}
          value={(value as Record<string, unknown>[]) ?? []}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}
