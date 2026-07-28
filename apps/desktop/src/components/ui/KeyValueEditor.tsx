import { Plus, X } from "lucide-react";
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
    <fieldset className="gb-mcp-kv">
      <legend>{label}</legend>
      {rows.map((row, i) => (
        <div key={i} className="gb-mcp-kv-row">
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
            <span className="gb-mcp-kv-placeholder">
              {row.action === "keep" ? t.secretConfigured : t.secretDelete}
            </span>
          )}
          <button
            type="button"
            className="gb-mcp-icon-button gb-mcp-danger-button"
            onClick={() => remove(i)}
            aria-label={`${t.mcpRemove} ${label} ${i + 1}`}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="gb-mcp-button gb-mcp-button-subtle" onClick={add}>
        <Plus aria-hidden="true" size={14} />
        {t.addField}
      </button>
    </fieldset>
  );
}
