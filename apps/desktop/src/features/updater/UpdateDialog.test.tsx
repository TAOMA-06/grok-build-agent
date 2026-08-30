import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UpdateDialog } from "./UpdateDialog";
import { useAppUpdater } from "./updater";

const release = {
  version: "1.2.0",
  currentVersion: "1.1.1",
  hasUpdate: true,
  title: "Grok Build Desktop 1.2.0",
  body: "A focused release.",
  publishedAt: "2026-08-30T00:00:00Z",
  downloadUrl: "https://github.com/TAOMA-06/grok-build-agent/releases/download/v1.2.0/Grok.Build.Desktop_1.2.0_universal.dmg",
  assetName: "Grok.Build.Desktop_1.2.0_universal.dmg",
  sizeBytes: 45_000_000,
  isPrerelease: false,
  htmlUrl: "https://github.com/TAOMA-06/grok-build-agent/releases/tag/v1.2.0",
};

describe("UpdateDialog", () => {
  beforeEach(() => {
    useAppUpdater.setState({
      phase: "available",
      info: release,
      error: null,
      dialogOpen: true,
      lastChecked: Date.now(),
    });
  });

  it("describes the real manual-update boundary without simulated installation", () => {
    render(<UpdateDialog />);

    expect(screen.getByText(/当前版本只负责检查 GitHub Release/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看 GitHub Release/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /手动下载 DMG/ })).toBeInTheDocument();
    expect(screen.queryByText(/一键自动更新|校验完成|立即重启生效/)).not.toBeInTheDocument();
  });
});
