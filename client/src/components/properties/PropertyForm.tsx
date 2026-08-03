import { useEffect, useRef, useState } from "react";
import { nodeSchemas } from "../../schema/nodeSchemas";
import type { AnyGraphNode } from "../../types/graph";
import { FieldRenderer } from "./FieldRenderer";
import * as api from "../../api/client";

interface PropertyFormProps {
  node: AnyGraphNode;
  onSaved: () => void;
}

export function PropertyForm({ node, onSaved }: PropertyFormProps) {
  const schema = nodeSchemas[node.type];
  const [draft, setDraft] = useState<Record<string, unknown>>(node.props as Record<string, unknown>);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(node.props as Record<string, unknown>);
  }, [node.id, node.props]);

  const handleChange = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const commit = () => {
    void api.updateNode(node.id, draftRef.current).then(onSaved).catch((err) => console.error(err));
  };

  if (schema.fields.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Este tipo de nodo no tiene propiedades editables.</p>;
  }

  return (
    <form onBlur={commit} onSubmit={(e) => e.preventDefault()}>
      {schema.fields.map((field) => (
        <div key={field.key} style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>{field.label}</label>
          <FieldRenderer field={field} value={draft[field.key]} onChange={(v) => handleChange(field.key, v)} />
        </div>
      ))}
    </form>
  );
}
