import type { ReactNode } from "react";

export function Dialog({
  open,
  title,
  children,
  onClose,
  wide,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="permission-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`permission-card ${wide ? "dialog-wide" : ""}`}>
        <div className="row-actions" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
