import { useEffect, useRef, useState } from "react";
import { nodeSchemas } from "../../schema/nodeSchemas";
import type { AnyGraphNode, ModelField, TableColumn } from "../../types/graph";
import { FieldRenderer } from "./FieldRenderer";
import { useGraph } from "../../context/GraphContext";
import * as api from "../../api/client";
import { ApiError } from "../../api/client";

interface PropertyFormProps {
  node: AnyGraphNode;
  onSaved: () => void;
}

export function PropertyForm({ node, onSaved }: PropertyFormProps) {
  const schema = nodeSchemas[node.type];
  const [draft, setDraft] = useState<Record<string, unknown>>(node.props as Record<string, unknown>);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { nodes, focusField, setFocusField } = useGraph();
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // An operation's method must stay inside the parent endpoint's declared methods and can't
  // collide with a sibling operation's method — narrow the select's options accordingly.
  let fields =
    node.type === "operation"
      ? schema.fields.map((field) => {
          if (field.key !== "method") return field;
          const endpoint = nodes.find((n) => n.id === node.parentId);
          const allowed =
            endpoint?.type === "endpoint" ? (endpoint.props as { methods?: string[] }).methods : undefined;
          const usedBySiblings = new Set(
            nodes
              .filter((n) => n.type === "operation" && n.id !== node.id && n.parentId === node.parentId)
              .map((n) => (n.props as { method?: string }).method)
              .filter((m): m is string => Boolean(m)),
          );
          const options = (allowed ?? field.options ?? []).filter((m) => !usedBySiblings.has(m));
          return { ...field, options };
        })
      : schema.fields;

  // authMethods only makes sense while the endpoint isn't marked public — matches the checkbox:
  // unchecked (false/unset) reads as "not public yet", checked hides the security fields.
  if (node.type === "endpoint" && draft.isPublic === true) {
    fields = fields.filter((field) => field.key !== "authMethods");
  }

  // A model's fields are a subset of its linked table's columns, not freeform text — once a table
  // is picked, "schema" becomes a checklist of that table's columns instead of the generic editor.
  let tableColumns: TableColumn[] | undefined;
  if (node.type === "model") {
    const table = nodes.find((n) => n.id === (draft as { tableId?: string }).tableId);
    if (table?.type === "table") tableColumns = (table.props as { columns?: TableColumn[] }).columns ?? [];
  }

  useEffect(() => {
    setDraft(node.props as Record<string, unknown>);
  }, [node.id, node.props]);

  useEffect(() => {
    if (!focusField) return;
    const el = fieldRefs.current[focusField];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => setFocusField(null), 1600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField, node.id]);

  const handleChange = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const commit = () => {
    void api
      .updateNode(node.id, draftRef.current)
      .then(() => {
        setSaveError(null);
        onSaved();
      })
      .catch((err) => {
        setDraft(node.props as Record<string, unknown>);
        const message =
          err instanceof ApiError && err.issues?.length
            ? err.issues.map((i) => i.message).join("; ")
            : err instanceof Error
              ? err.message
              : String(err);
        setSaveError(message);
      });
  };

  if (schema.fields.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Este tipo de nodo no tiene propiedades editables.</p>;
  }

  return (
    <form onBlur={commit} onSubmit={(e) => e.preventDefault()}>
      {saveError && (
        <p style={{ fontSize: 12, color: "var(--color-danger, #e53e3e)", marginBottom: 10 }}>{saveError}</p>
      )}
      {fields.map((field) => {
        const rowProps = {
          ref: (el: HTMLDivElement | null) => {
            fieldRefs.current[field.key] = el;
          },
          className: focusField === field.key ? "field-flash" : undefined,
          style: { marginBottom: 10 },
        };

        if (field.key === "schema" && tableColumns !== undefined) {
          const currentSchema = (draft.schema as ModelField[]) ?? [];
          const toggleColumn = (column: TableColumn) => {
            const checked = currentSchema.some((f) => f.name === column.name);
            const next = checked
              ? currentSchema.filter((f) => f.name !== column.name)
              : [...currentSchema, { name: column.name, type: column.type, required: !column.nullable }];
            handleChange("schema", next);
          };
          return (
            <div key={field.key} {...rowProps}>
              <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>{field.label} (de la tabla vinculada)</label>
              {tableColumns.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>La tabla vinculada todavía no tiene columnas.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {tableColumns.map((column) => (
                    <label key={column.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={currentSchema.some((f) => f.name === column.name)}
                        onChange={() => toggleColumn(column)}
                      />
                      <span className="mono">{column.name}</span>
                      <span style={{ color: "var(--color-text-muted)" }}>
                        ({column.type}
                        {column.nullable ? ", nullable" : ""})
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (field.key === "schema" && node.type === "model") {
          return (
            <div key={field.key} {...rowProps}>
              <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>{field.label}</label>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Vinculá una tabla para elegir sus columnas.</p>
            </div>
          );
        }

        return (
          <div key={field.key} {...rowProps}>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>{field.label}</label>
            <FieldRenderer field={field} value={draft[field.key]} onChange={(v) => handleChange(field.key, v)} />
          </div>
        );
      })}
    </form>
  );
}
