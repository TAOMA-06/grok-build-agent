import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      {label}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
