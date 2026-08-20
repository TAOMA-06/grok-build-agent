import {
  Bot,
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
import {
  buildPlanComments,
  parsePlanDocument,
  summarizePlanProgress,
  type PlanDocument,
} from "../../contracts/planSteps";
import { PLANNER_ADAPTER_ID } from "../../contracts";
import type { ChatBlock } from "../../types";
import { t, useTranslation } from "../../i18n";
import { useAppStore } from "../../store";

export type PlanActionPayload = {
  action: "approve" | "revise";
  comments?: string[];
  reviseNote?: string;
};

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

function SubagentActivity({ block }: { block: Extract<ChatBlock, { type: "subtask" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gb-activity gb-subagent gb-status-${block.status}`}>
      <button type="button" className="gb-activity-head" onClick={() => setOpen((value) => !value)}>
        <span className="gb-activity-icon"><Bot size={14} /></span>
        <span>{block.title}</span>
        <span className="gb-activity-status">
          {t.subagent}
          {block.role ? ` · ${block.role}` : ""}
          {block.model ? ` · ${block.model}` : ""}
          {" · "}
          {block.status}
        </span>
        <ChevronRight size={14} className={open ? "open" : ""} />
      </button>
      {open && (
        <pre className="gb-tool-output">
          {block.detail || block.title}
        </pre>
      )}
    </div>
  );
}

function planStatusLabel(status: string): string {
  if (status === "completed") return t.planStepCompleted;
  if (status === "in_progress") return t.planStepInProgress;
  if (status === "cancelled") return t.planStepCancelled;
  return t.planStepPending;
}

function PlanCard({
  text,
  document,
  actionsEnabled,
  onPlanAction,
}: {
  text: string;
  document?: PlanDocument;
  actionsEnabled: boolean;
  onPlanAction: (payload: PlanActionPayload) => void;
}) {
  const plan = useMemo(
    () => document ?? parsePlanDocument(text),
    [document, text],
  );
  const steps = plan.steps;
  const progress = summarizePlanProgress(plan);
  const [stepComments, setStepComments] = useState<Record<string, string>>({});
  const [reviseNote, setReviseNote] = useState("");
  const comments = buildPlanComments({ steps, stepComments, freeNote: reviseNote });

  return (
    <section className="gb-plan-card">
      <div className="gb-plan-title">
        <FileCode2 size={15} /> {t.proposedPlan}
        {steps.length > 0 && (
          <span className="gb-plan-progress">
            {progress.completed}/{progress.total}
            {plan.source === "structured" || plan.source === "mixed"
              ? ` · ${t.planStructured}`
              : ""}
          </span>
        )}
      </div>
      {plan.title && <div className="gb-plan-heading">{plan.title}</div>}
      <div className="gb-markdown"><MarkdownBody>{text}</MarkdownBody></div>
      {actionsEnabled && steps.length > 0 && (
        <div className="gb-plan-steps" aria-label={t.planSteps}>
          <strong>{t.planSteps}</strong>
          <ol>
            {steps.map((step) => (
              <li key={step.id} data-status={step.status}>
                <div className="gb-plan-step-row">
                  <span className={`gb-plan-step-status ${step.status}`}>
                    {planStatusLabel(step.status)}
                  </span>
                  <span>{step.text}</span>
                </div>
                <input
                  className="gb-dialog-input"
                  value={stepComments[step.id] ?? ""}
                  placeholder={t.planStepCommentHint}
                  onChange={(event) => setStepComments((prev) => ({
                    ...prev,
                    [step.id]: event.target.value,
                  }))}
                  aria-label={`${t.planStepComment} ${step.index}`}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
      {actionsEnabled && (
        <label className="gb-plan-revise">
          <span>{t.planReviseNote}</span>
          <textarea
            className="gb-dialog-input"
            rows={2}
            value={reviseNote}
            placeholder={t.planReviseHint}
            onChange={(event) => setReviseNote(event.target.value)}
          />
        </label>
      )}
      <div className="gb-plan-actions">
        <button
          type="button"
          className="gb-button"
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          <Copy size={13} /> {t.copyPlan}
        </button>
        {actionsEnabled && (
          <>
            <button
              type="button"
              className="gb-button primary"
              onClick={() => onPlanAction({ action: "approve", comments })}
            >
              {t.planApproveAndBuild}
            </button>
            <button
              type="button"
              className="gb-button"
              onClick={() => onPlanAction({
                action: "revise",
                comments: comments.length ? comments : [reviseNote.trim() || t.planFeedbackDraft].filter(Boolean),
                reviseNote,
              })}
            >
              {t.planRequestChanges}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function Timeline({
  blocks,
  busy = false,
  onPlanAction,
  planActionsEnabled = false,
  sessionId = null,
  adapterId = null,
}: {
  blocks: ChatBlock[];
  busy?: boolean;
  onPlanAction: (payload: PlanActionPayload) => void;
  planActionsEnabled?: boolean;
  sessionId?: string | null;
  adapterId?: string | null;
}) {
  const setSessionDraft = useAppStore((state) => state.setSessionDraft);
  const removeBlock = useAppStore((state) => state.removeBlock);
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
              <div className="gb-turn-label">
                {t.you}
                {block.delivery === "pending" ? ` · ${t.sending}` : block.delivery === "queued" ? ` · ${t.queued}` : block.delivery === "failed" ? ` · ${t.failed}` : ""}
                <Timestamp at={block.at} />
                {block.delivery === "queued" && sessionId && (
                  <button
                    type="button"
                    className="gb-button ghost"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      setSessionDraft(sessionId, block.text);
                      removeBlock(sessionId, block.id);
                      window.dispatchEvent(new Event("grok:focus-composer"));
                    }}
                  >
                    {t.editQueued}
                  </button>
                )}
              </div>
              <div className="gb-user-prompt">{block.text}</div>
            </section>
          );
        }
        if (block.type === "assistant") {
          return (
            <section key={block.id} className="gb-turn gb-agent-turn">
              <div className="gb-agent-mark"><span>{adapterId === PLANNER_ADAPTER_ID ? "P" : "G"}</span></div><Timestamp at={block.at} />
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
            <div key={block.id}>
              <PlanCard
                text={block.text}
                document={block.document}
                actionsEnabled={planActionsEnabled && blockIndex === latestPlanIndex}
                onPlanAction={onPlanAction}
              />
            </div>
          );
        }
        if (block.type === "subtask") {
          return <SubagentActivity key={block.id} block={block} />;
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
