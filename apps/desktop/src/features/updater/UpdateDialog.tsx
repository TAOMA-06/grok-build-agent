import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, ExternalLink, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GbButton } from "../../components/ui/GbButton";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppUpdater } from "./updater";

export function UpdateDialog() {
  const {
    info,
    error,
    dialogOpen,
    setDialogOpen,
  } = useAppUpdater();

  if (!info) return null;

  const formattedSize = (info.sizeBytes / (1024 * 1024)).toFixed(1);

  const formattedDate = info.publishedAt
    ? new Date(info.publishedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  async function handleOpenReleasePage() {
    if (info?.htmlUrl) {
      try {
        await openUrl(info.htmlUrl);
      } catch {
        window.open(info.htmlUrl, "_blank");
      }
    }
  }

  async function handleOpenDownload() {
    const target = info?.downloadUrl || info?.htmlUrl;
    if (!target) return;
    try {
      await openUrl(target);
    } catch {
      window.open(target, "_blank");
    }
  }

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="gb-dialog-overlay" />
        <Dialog.Content
          className="gb-update-dialog"
          aria-describedby="update-dialog-description"
        >
          {/* Header */}
          <div className="gb-update-header">
            <div className="gb-update-title-wrap">
              <div className="gb-update-badge">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Dialog.Title className="gb-update-title">
                    发现 Grok Build Desktop 新版本
                  </Dialog.Title>
                  <span className="gb-update-tag">v{info.version}</span>
                </div>
                <p id="update-dialog-description" className="gb-update-meta">
                  当前版本: <span className="mono">v{info.currentVersion}</span>
                  {formattedDate ? ` · 发布于 ${formattedDate}` : ""} · 大小 {formattedSize} MB
                </p>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="gb-icon-button"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Changelog Box */}
          <div className="gb-update-body">
            <div className="gb-update-changelog-header">
              <span>更新内容与更新日志 (Release Notes)</span>
              <button
                type="button"
                className="gb-link-btn"
                onClick={handleOpenReleasePage}
                title="在 GitHub 上查看完整发布说明"
              >
                <span>GitHub Releases</span>
                <ExternalLink size={12} />
              </button>
            </div>

            <div className="gb-update-changelog-scroll">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {info.body || "本次版本包含常规性能优化与问题修复。"}
              </ReactMarkdown>
            </div>
          </div>

          <div className="gb-update-boundary-banner">
            当前版本只负责检查 GitHub Release。下载、签名验证、替换应用和重启尚未接入，请在 GitHub 下载 DMG 后手动安装。
          </div>

          {/* Error Banner */}
          {error && (
            <div className="gb-update-error-banner">
              <span>下载更新失败: {error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="gb-update-footer">
            <button
              type="button"
              className="gb-link-btn"
              onClick={handleOpenDownload}
            >
              <span>手动下载 DMG</span>
              <ArrowUpRight size={13} />
            </button>

            <div className="flex items-center gap-2">
              <GbButton
                variant="ghost"
                onClick={() => setDialogOpen(false)}
              >
                稍后提醒
              </GbButton>
              <GbButton variant="primary" onClick={() => void handleOpenReleasePage()}>
                <ExternalLink size={14} />
                查看 GitHub Release
              </GbButton>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
