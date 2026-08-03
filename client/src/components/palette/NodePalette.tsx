import { nodeSchemasByCategory } from "../../schema/nodeSchemas";
import styles from "./NodePalette.module.css";

interface NodePaletteProps {
  category: "backend" | "frontend";
}

export function NodePalette({ category }: NodePaletteProps) {
  const items = nodeSchemasByCategory(category);
  const structural = nodeSchemasByCategory("structure");

  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData("application/pv-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className={styles.palette}>
      <div className={styles.group}>
        <p className={styles.groupTitle}>{category === "backend" ? "Backend" : "Frontend"}</p>
        {items.map((schema) => (
          <div key={schema.type} className={styles.item} draggable onDragStart={(e) => onDragStart(e, schema.type)}>
            <span className={styles.swatch} style={{ background: schema.color }} />
            <span className="mono">{schema.type}</span>
          </div>
        ))}
      </div>
      <div className={styles.group}>
        <p className={styles.groupTitle}>Estructura</p>
        {structural.map((schema) => (
          <div key={schema.type} className={styles.item} draggable onDragStart={(e) => onDragStart(e, schema.type)}>
            <span className={styles.swatch} style={{ background: schema.color }} />
            <span className="mono">{schema.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
