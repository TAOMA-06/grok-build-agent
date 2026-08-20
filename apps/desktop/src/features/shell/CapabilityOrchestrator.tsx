import { useMemo, useState } from "react";
import {
  buildHookOrchestrationEntries,
  buildSkillOrchestrationEntries,
  composeOrchestrationDraft,
  groupCapabilitiesBySource,
  type OrchestrationEntry,
} from "../../contracts/capabilityOrchestration";
import type { CapabilityItem } from "../../types";
import { t } from "../../i18n";

/**
 * Turns inspect Skills/Hooks into actionable composer drafts — not a directory dump.
 */
export function CapabilityOrchestrator({
  skills,
  hooks,
  onInsertDraft,
}: {
  skills: CapabilityItem[];
  hooks: CapabilityItem[];
  onInsertDraft: (draft: string) => void;
}) {
  const [queue, setQueue] = useState<OrchestrationEntry[]>([]);
  const [filter, setFilter] = useState("");
  const skillEntries = useMemo(() => buildSkillOrchestrationEntries(skills), [skills]);
  const hookEntries = useMemo(() => buildHookOrchestrationEntries(hooks), [hooks]);
  const skillGroups = useMemo(
    () => groupCapabilitiesBySource(skillEntries.map((entry) => entry.item)),
    [skillEntries],
  );

  const matches = (item: CapabilityItem) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [item.name, item.id, item.description, item.source]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  };

  function toggleQueue(entry: OrchestrationEntry) {
    setQueue((prev) => {
      const key = `${entry.kind}:${entry.item.id}`;
      if (prev.some((item) => `${item.kind}:${item.item.id}` === key)) {
        return prev.filter((item) => `${item.kind}:${item.item.id}` !== key);
      }
      return [...prev, entry];
    });
  }

  function queued(entry: OrchestrationEntry) {
    return queue.some((item) => item.kind === entry.kind && item.item.id === entry.item.id);
  }

  return (
    <section className="gb-capability-orchestrator" aria-label={t.capabilityOrchestrator}>
      <header className="gb-settings-section-head">
        <h3>{t.capabilityOrchestrator}</h3>
        <span className="gb-orchestrator-count">
          {skillEntries.length} {t.skills} · {hookEntries.length} {t.hooks}
        </span>
      </header>
      <p className="gb-settings-copy">{t.capabilityOrchestratorHint}</p>
      <input
        className="gb-dialog-input"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t.capabilityOrchestratorFilter}
        aria-label={t.capabilityOrchestratorFilter}
      />

      <div className="gb-orchestrator-columns">
        <div>
          <strong>{t.skills}</strong>
          {skillGroups.map((group) => {
            const visible = group.items.filter(matches);
            if (visible.length === 0) return null;
            return (
              <div key={group.source} className="gb-orchestrator-group">
                <small>{group.source}</small>
                {visible.map((item) => {
                  const entry = skillEntries.find((row) => row.item.id === item.id);
                  if (!entry) return null;
                  return (
                    <div className="gb-orchestrator-row" key={item.id}>
                      <div>
                        <b>{item.name}</b>
                        <small>{item.description || entry.draft}</small>
                      </div>
                      <div>
                        <button type="button" className="gb-review-button" onClick={() => onInsertDraft(entry.draft)}>
                          {t.capabilityInsert}
                        </button>
                        <button
                          type="button"
                          className={`gb-icon-button${queued(entry) ? " active" : ""}`}
                          title={t.capabilityQueue}
                          aria-label={t.capabilityQueue}
                          onClick={() => toggleQueue(entry)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {skillEntries.filter((entry) => matches(entry.item)).length === 0 && (
            <p className="gb-settings-copy">{t.noneReported}</p>
          )}
        </div>

        <div>
          <strong>{t.hooks}</strong>
          {hookEntries.filter((entry) => matches(entry.item)).map((entry) => (
            <div className="gb-orchestrator-row" key={entry.item.id}>
              <div>
                <b>{entry.item.name}</b>
                <small>{entry.item.description || entry.hint}</small>
              </div>
              <div>
                <button type="button" className="gb-review-button" onClick={() => onInsertDraft(entry.draft)}>
                  {t.capabilityInsert}
                </button>
                <button
                  type="button"
                  className={`gb-icon-button${queued(entry) ? " active" : ""}`}
                  title={t.capabilityQueue}
                  aria-label={t.capabilityQueue}
                  onClick={() => toggleQueue(entry)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          {hookEntries.filter((entry) => matches(entry.item)).length === 0 && (
            <p className="gb-settings-copy">{t.noneReported}</p>
          )}
        </div>
      </div>

      {queue.length > 0 && (
        <div className="gb-orchestrator-queue">
          <strong>{t.capabilityQueue} ({queue.length})</strong>
          <ol>
            {queue.map((entry) => (
              <li key={`${entry.kind}:${entry.item.id}`}>
                {entry.kind}: {entry.item.name}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="gb-review-button"
            onClick={() => {
              onInsertDraft(composeOrchestrationDraft(queue));
              setQueue([]);
            }}
          >
            {t.capabilityInsertQueue}
          </button>
        </div>
      )}
    </section>
  );
}
