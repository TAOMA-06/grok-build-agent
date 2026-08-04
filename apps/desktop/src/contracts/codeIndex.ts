/**
 * Host-owned symbol index contracts (W1-B).
 */

export type SymbolHit = {
  path: string;
  name: string;
  kind: string;
  line: number;
  score: number;
  snippet: string;
};
