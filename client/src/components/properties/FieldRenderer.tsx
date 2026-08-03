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
