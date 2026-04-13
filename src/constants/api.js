// ── API constants ─────────────────────────────────────────────────────────────
// Single source of truth for the backend proxy URL.
// Imported by any component that calls the Anthropic API via the worker.

export const PROXY_URL = "https://visalens-proxy.ijecloud.workers.dev";
