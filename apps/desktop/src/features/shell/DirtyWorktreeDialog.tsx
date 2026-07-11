import * as Dialog from "@radix-ui/react-dialog";
import { Copy, GitBranch, Sparkles } from "lucide-react";
import type { DirtyPolicy } from "./useDesktopController";
import { t } from "../../i18n";

export function DirtyWorktreeDialog({
  open,
  onChoose,
}: {
  open: boolean;
  onChoose: (policy: DirtyPolicy) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onChoose("clean_head"); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="gb-dialog-overlay" />
        <Dialog.Content className="gb-decision-dialog">
          <Dialog.Title>{t.dirtyTitle}</Dialog.Title>
          <Dialog.Description>{t.dirtyDescription}</Dialog.Description>
          <button type="button" className="gb-decision-option recommended" onClick={() => onChoose("clean_head")}>
            <GitBranch size={18} /><span><strong>{t.cleanHead} <em>{t.recommended}</em></strong><small>{t.cleanHeadHint}</small></span>
          </button>
          <button type="button" className="gb-decision-option" onClick={() => onChoose("copy_dirty")}>
            <Copy size={18} /><span><strong>{t.includeChanges}</strong><small>{t.includeChangesHint}</small></span>
          </button>
          <div className="gb-decision-note"><Sparkles size={14} /> {t.dirtyChoiceNote}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
