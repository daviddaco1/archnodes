import { useEffect } from "react";

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div
      role="alert"
      className="card"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: 480,
        padding: "10px 14px",
        zIndex: 50,
        fontSize: 13,
        color: "var(--color-danger)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span>{message}</span>
      <button className="btn-icon" onClick={onDismiss} aria-label="Cerrar">
        ×
      </button>
    </div>
  );
}
