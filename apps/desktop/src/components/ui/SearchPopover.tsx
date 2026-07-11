import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = {
  id: string;
  label: string;
  description?: string | null;
  meta?: string | null;
};

export function SearchPopover({
  open,
  options,
  value,
  onSelect,
  onClose,
  placeholder,
  emptyLabel,
}: {
  open: boolean;
  options: SearchOption[];
  value?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.description ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  if (!open) return null;

  return (
    <div className="search-popover" ref={ref} role="listbox">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="search-popover-list">
        {filtered.length === 0 && (
          <div className="muted empty">{emptyLabel ?? "—"}</div>
        )}
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={o.id === value}
            className={o.id === value ? "list-item active" : "list-item"}
            onClick={() => {
              onSelect(o.id);
              onClose();
            }}
          >
            <strong>{o.label}</strong>
            {o.description ? <span className="meta">{o.description}</span> : null}
            {o.meta ? <span className="meta">{o.meta}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
