import { Sparkles } from "lucide-react";
import { useAppUpdater } from "./updater";

export function UpdatePill() {
  const { phase, info, setDialogOpen } = useAppUpdater();

  if (!info || !info.hasUpdate || phase !== "available") {
    return null;
  }

  return (
    <button
      type="button"
      className="gb-update-pill available"
      onClick={() => setDialogOpen(true)}
      title="发现新版本，查看 GitHub Release"
    >
      <span className="gb-update-pill-dot" />
      <span className="gb-update-pill-text">新版本 v{info.version}</span>
      <Sparkles size={12} className="gb-update-pill-icon" />
    </button>
  );
}
