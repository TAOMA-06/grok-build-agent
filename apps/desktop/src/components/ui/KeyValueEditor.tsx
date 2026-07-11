import type { McpSecretField, SecretFieldAction } from "../../types";
import { t } from "../../i18n";

export function KeyValueEditor({
  label,
  rows,
  onChange,
  valuePlaceholder,
}: {
  label: string;
  rows: McpSecretField[];
  onChange: (rows: McpSecretField[]) => void;
  valuePlaceholder?: string;
}) {
  function update(i: number, patch: Partial<McpSecretField>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  function add() {
    onChange([...rows, { key: "", value: "", action: "replace" }]);
  }

  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="kv-editor">
      <div className="section-title">{label}</div>
      {rows.map((row, i) => (
        <div key={i} className="kv-row">
          <input
            value={row.key}
            placeholder="KEY"
            onChange={(e) => update(i, { key: e.target.value })}
            aria-label={`${label} key ${i + 1}`}
          />
          <select
            value={row.action}
            onChange={(e) =>
              update(i, { action: e.target.value as SecretFieldAction })
            }
            aria-label={`${label} action ${i + 1}`}
          >
            <option value="replace">{t.secretReplace}</option>
            <option value="keep">{t.secretKeep}</option>
            <option value="delete">{t.secretDelete}</option>
          </select>
          {row.action === "replace" ? (
            <input
              type="password"
              value={row.value ?? ""}
              placeholder={valuePlaceholder ?? t.secretConfigured}
              onChange={(e) => update(i, { value: e.target.value })}
              autoComplete="off"
              aria-label={`${label} value ${i + 1}`}
            />
          ) : (
            <span className="muted kv-placeholder">
              {row.action === "keep" ? t.secretConfigured : t.secretDelete}
            </span>
          )}
          <button type="button" className="ghost" onClick={() => remove(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={add}>
        {t.addField}
      </button>
    </div>
  );
}
