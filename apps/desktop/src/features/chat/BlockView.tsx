import { t } from "../../i18n";
import type { ChatBlock } from "../../types";

export function safeJson(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    return s.length > 4000 ? s.slice(0, 4000) + "\n…" : s;
  } catch {
    return String(v);
  }
}

export function BlockView({
  block,
  onSelectTool,
}: {
  block: ChatBlock;
  onSelectTool?: (id: string) => void;
}) {
  switch (block.type) {
    case "user":
      return (
        <div className="block user">
          <div className="label">{t.you}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="block assistant">
          <div className="label">{t.grok}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "thought":
      return (
        <details className="block thought">
          <summary>{t.thinking}</summary>
          <div className="body pre muted">{block.text}</div>
        </details>
      );
    case "tool": {
      const large =
        safeJson(block.tool.output).length > 800 ||
        safeJson(block.tool.input).length > 800;
      return (
        <button
          type="button"
          className={`block tool status-${block.tool.status}`}
          style={{ width: "100%", textAlign: "left" }}
          onClick={() => onSelectTool?.(block.tool.id)}
        >
          <div className="label">
            {t.tool} · {block.tool.title}
            <span className="pill">{block.tool.status}</span>
          </div>
          {block.tool.input != null && (
            <pre className={`code ${large ? "tool-collapsed" : ""}`}>
              {safeJson(block.tool.input)}
            </pre>
          )}
          {block.tool.output != null && (
            <pre className={`code out ${large ? "tool-collapsed" : ""}`}>
              {safeJson(block.tool.output)}
            </pre>
          )}
        </button>
      );
    }
    case "plan":
      return (
        <div className="block plan">
          <div className="label">{t.plan}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "system":
      return (
        <div className={`block system ${block.level ?? "info"}`}>
          <div className="body">{block.text}</div>
        </div>
      );
    case "subtask":
      return (
        <div className="block tool">
          <div className="label">
            {t.subtask} · {block.title}
            <span className="pill">{block.status}</span>
          </div>
        </div>
      );
  }
}
