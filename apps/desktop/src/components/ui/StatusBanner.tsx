export function StatusBanner({
  kind = "info",
  children,
  action,
}: {
  kind?: "info" | "warn" | "error" | "ok";
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={`status-banner status-${kind}`} role="status">
      <div className="status-banner-body">{children}</div>
      {action ? <div className="status-banner-action">{action}</div> : null}
    </div>
  );
}
