import type { BootstrapState, RuntimeHealth } from "../../types";

export function bootstrapStateFromHealth(health: RuntimeHealth): BootstrapState {
  if (!health.grok.found) return { status: "needs_cli", health };
  if (!health.authenticated) return { status: "needs_auth", health };
  return { status: "ready", health };
}
