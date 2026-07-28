import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import "./dialog.css";

export function Dialog({
  open,
  title,
  children,
  onClose,
  wide,
  closeLabel = "Close",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="gb-ui-dialog-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={`gb-ui-dialog-content${wide ? " gb-ui-dialog-content-wide" : ""}`}
        >
          <header className="gb-ui-dialog-header">
            <DialogPrimitive.Title className="gb-ui-dialog-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="gb-ui-dialog-close"
                aria-label={closeLabel}
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="gb-ui-dialog-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
