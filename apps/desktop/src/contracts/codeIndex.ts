/**
 * Host-owned symbol index contracts (W1-B / references / call-graph MVP).
 */

export type SymbolHit = {
  path: string;
  name: string;
  /** definition kinds, or call | reference | import for usages */
  kind: string;
  line: number;
  score: number;
  snippet: string;
};

/** Lightweight text call-graph slice (defs + callers), not a typed AST. */
export type CallGraphSlice = {
  symbol: string;
  definitions: SymbolHit[];
  callers: SymbolHit[];
};
