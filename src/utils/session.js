// ── src/utils/session.js ──────────────────────────────────────────────────────
// Auth & org-session helpers. No React, no component imports — pure utilities.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------
// NOTE: refreshTokenIfNeeded() needs the Supabase client. To avoid a circular
// dep, we accept it as a parameter. Pass `supabase` from wherever you import
// the client (e.g. src/db/client.js).
// -----------------------------------------------------------------------------

export const ORG_SESSION_KEY = "visalens_org_session";

export function getOrgSession() {
  try {
    const raw = sessionStorage.getItem(ORG_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setOrgSession(data) {
  try { sessionStorage.setItem(ORG_SESSION_KEY, JSON.stringify(data)); } catch {}
}

export function clearOrgSession() {
  try { sessionStorage.removeItem(ORG_SESSION_KEY); } catch {}
}

// Returns auth headers for the current JWT session.
export function getAuthHeaders() {
  const session = getOrgSession();
  if (!session?.access_token) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };
}

// Returns true if the JWT expires within the next 5 minutes (300 seconds).
export function isTokenExpiringSoon() {
  const s = getOrgSession();
  if (!s?.access_token) return false;
  try {
    if (s.expires_at) {
      return (s.expires_at - Math.floor(Date.now() / 1000)) < 300;
    }
    // Fallback: decode the JWT exp claim
    const payload = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return (payload.exp - Math.floor(Date.now() / 1000)) < 300;
  } catch { return false; }
}

// Deduplicate concurrent refresh calls
let _refreshPromise = null;

// Proactive token refresh using the Supabase JS client.
// Pass your supabase singleton as the first argument.
export async function refreshTokenIfNeeded(supabase) {
  const s = getOrgSession();
  if (!s?.access_token || !s?.refresh_token) return;
  if (!isTokenExpiringSoon()) return;
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token:  s.access_token,
        refresh_token: s.refresh_token,
      });
      if (error) throw error;
      if (data?.session) {
        setOrgSession({
          ...s,
          access_token:  data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at:    data.session.expires_at,
        });
      }
    } catch (e) {
      console.warn('[VisaLens] Token refresh failed:', e.message);
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

// Drop-in replacement for fetch() throughout the app.
// Always ensures the token is fresh. On a 401 it refreshes once and retries.
// Pass your supabase singleton as the third argument.
export async function authedFetch(url, options = {}, supabase, _isRetry = false) {
  await refreshTokenIfNeeded(supabase);
  const res = await fetch(url, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401 && !_isRetry) {
    const s = getOrgSession();
    if (s?.refresh_token) {
      try {
        const { data } = await supabase.auth.setSession({
          access_token:  s.access_token,
          refresh_token: s.refresh_token,
        });
        if (data?.session) {
          setOrgSession({
            ...s,
            access_token:  data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at:    data.session.expires_at,
          });
        }
      } catch {}
    }
    return authedFetch(url, options, supabase, true); // Retry exactly once
  }
  return res;
}

// Helper: add org_id to every proxy request body.
export function withOrg(body) {
  const session = getOrgSession();
  if (session?.org_id) return { ...body, org_id: session.org_id };
  return body;
}
