import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCode2,
  LoaderCircle,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatBlock } from "../../types";
import { t, useTranslation } from "../../i18n";
import { useAppStore } from "../../store";

function Timestamp({ at }: { at?: string }) {
  const { locale } = useTranslation();
  const visible = useAppStore((state) => state.settings.showTimestamps);
  if (!visible || !at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return <time className="gb-timestamp" dateTime={at}>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}</time>;
}

function MarkdownBody({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children: codeChildren, ...props }) {
          const inline = !className;
          if (inline) return <code className="gb-inline-code" {...props}>{codeChildren}</code>;
          return (
            <div className="gb-code-wrap">
              <button
                type="button"
                className="gb-code-copy"
                aria-label={t.copyCode}
                onClick={() => void navigator.clipboard.writeText(String(codeChildren))}
              >
                <Copy size={13} />
              </button>
              <code className={className} {...props}>{codeChildren}</code>
            </div>
          );
        },
        a({ children: linkChildren, ...props }) {
          return <a {...props} target="_blank" rel="noreferrer">{linkChildren}</a>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function statusIcon(status: string) {
  if (["completed", "success", "done"].includes(status)) return <Check size={14} />;
  if (["failed", "error"].includes(status)) return <CircleAlert size={14} />;
  return <LoaderCircle size={14} className="gb-spin" />;
}

function ToolActivity({ block }: { block: Extract<ChatBlock, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const payload = block.tool.output ?? block.tool.input;
  return (
    <div className={`gb-activity gb-status-${block.tool.status}`}>
      <button type="button" className="gb-activity-head" onClick={() => setOpen((value) => !value)}>
        <span className="gb-activity-icon">{statusIcon(block.tool.status)}</span>
        <span>{block.tool.title}</span>
        <span className="gb-activity-status">{block.tool.status}</span>
        <ChevronRight size={14} className={open ? "open" : ""} />
      </button>
      {open && payload != null && (
        <pre className="gb-tool-output">{typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)}</pre>
      )}
    </div>
  );
}

export function Timeline({
  blocks,
  busy = false,
  onPlanAction,
  planActionsEnabled = false,
}: {
  blocks: ChatBlock[];
  busy?: boolean;
  onPlanAction: (action: "approve" | "revise") => void;
  planActionsEnabled?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(2_000);
  useEffect(() => setVisibleCount(2_000), [blocks.length === 0 ? "empty" : blocks[blocks.length - 1]?.id]);
  const visibleBlocks = useMemo(
    () => blocks.slice(Math.max(0, blocks.length - visibleCount)),
    [blocks, visibleCount],
  );
  const latestPlanIndex = visibleBlocks.reduce(
    (lastIndex, block, index) => block.type === "plan" ? index : lastIndex,
    -1,
  );
  const latestThoughtId = useMemo(() => {
    for (let index = visibleBlocks.length - 1; index >= 0; index -= 1) {
      const block = visibleBlocks[index];
      if (block?.type === "thought") return block.id;
    }
    return null;
  }, [visibleBlocks]);
  return (
    <div className="gb-timeline">
      {visibleCount < blocks.length && <button type="button" className="gb-button" onClick={() => setVisibleCount((count) => Math.min(blocks.length, count + 2_000))}>Load 2,000 earlier events</button>}
      {visibleBlocks.map((block, blockIndex) => {
        if (block.type === "user") {
          return (
            <section key={block.id} className={`gb-turn gb-user-turn ${block.delivery ?? "sent"}`}>
              <div className="gb-turn-label">{t.you}{block.delivery === "pending" ? ` · ${t.sending}` : block.delivery === "failed" ? ` · ${t.failed}` : ""}<Timestamp at={block.at} /></div>
              <div className="gb-user-prompt">{block.text}</div>
            </section>
          );
        }
        if (block.type === "assistant") {
          return (
            <section key={block.id} className="gb-turn gb-agent-turn">
              <div className="gb-agent-mark"><span>G</span></div><Timestamp at={block.at} />
              <div className="gb-markdown"><MarkdownBody>{block.text}</MarkdownBody></div>
            </section>
          );
        }
        if (block.type === "thought") {
          const openWhileStreaming = busy && block.id === latestThoughtId;
          return (
            <details key={block.id} className="gb-reasoning" open={openWhileStreaming || undefined}>
              <summary><LoaderCircle size={13} className={openWhileStreaming ? "gb-spin" : undefined} /> {t.reasoning}<Timestamp at={block.at} /></summary>
              <div>{block.text}</div>
            </details>
          );
        }
        if (block.type === "tool") return <ToolActivity key={block.id} block={block} />;
        if (block.type === "plan") {
          return (
            <section key={block.id} className="gb-plan-card">
              <div className="gb-plan-title"><FileCode2 size={15} /> {t.proposedPlan}<Timestamp at={block.at} /></div>
              <div className="gb-markdown"><MarkdownBody>{block.text}</MarkdownBody></div>
              {planActionsEnabled && blockIndex === latestPlanIndex && (
                <div className="gb-plan-actions">
                  <button type="button" className="gb-button primary" onClick={() => onPlanAction("approve")}>{t.planApproveAndBuild}</button>
                  <button type="button" className="gb-button" onClick={() => onPlanAction("revise")}>{t.planRequestChanges}</button>
                </div>
              )}
            </section>
          );
        }
        if (block.type === "subtask") {
          return (
            <div key={block.id} className="gb-activity">
              <span className="gb-activity-icon">{statusIcon(block.status)}</span>
              <span>{block.title}</span>
              <span className="gb-activity-status">{t.subagent} · {block.status}</span><Timestamp at={block.at} />
            </div>
          );
        }
        return (
          <div key={block.id} className={`gb-system-message ${block.level ?? "info"}`}>
            {block.level === "error" ? <CircleAlert size={14} /> : <TerminalSquare size={14} />}
            <span>{block.text}</span><Timestamp at={block.at} />
          </div>
        );
      })}
    </div>
  );
}
