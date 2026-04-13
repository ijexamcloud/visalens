/**
 * VisaLens — Admin Panel
 * ─────────────────────────────────────────────────────────────────
 * Drop this file into your src/ folder and render <AdminPanel /> 
 * behind a route like /admin (protected by ADMIN_SECRET_TOKEN check).
 *
 * Required env vars (same .env as main app):
 *   VITE_SUPABASE_URL          — your Supabase project URL
 *   VITE_SUPABASE_ANON_KEY     — anon/public key (for Supabase Auth invites)
 *   VITE_ADMIN_TOKEN           — matches ADMIN_SECRET_TOKEN in your worker
 *   VITE_PROXY_URL             — your worker URL (same as PROXY_URL in App.jsx)
 *
 * Worker routes this panel calls:
 *   GET  /api/admin/dashboard          → { orgs, usage }
 *   GET  /api/admin/counsellors?org_id → { counsellors }
 *   POST /api/admin/invite             → { success }
 *   POST /api/admin/counsellor-status  → { success }   (activate/deactivate)
 *
 * ── NEW WORKER ROUTES YOU NEED TO ADD ────────────────────────────
 * Paste the block at the bottom of this file into your worker.js
 * inside the `/api/admin/` route handler.
 * ─────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Users, UserPlus, UserCheck, UserX, Mail, ShieldCheck,
  BarChart3, RefreshCw, AlertCircle, CheckCircle, Loader2,
  ChevronDown, ChevronRight, Activity, CreditCard, Clock,
  Search, X, Eye, EyeOff, Building2, ToggleLeft, ToggleRight,
  Send, ArrowLeft, LogOut, TrendingUp, Zap
} from 'lucide-react';

/* ─── CONFIG ─────────────────────────────────────────────────── */
const PROXY_URL   = import.meta.env.VITE_PROXY_URL   || "https://visalens-proxy.ijecloud.workers.dev";
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || "";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/* ─── THEME — mirrors App.jsx dark vars ──────────────────────── */
const T = {
  bg:    "#0F1E3C",
  s1:    "#162444",
  s2:    "#1C2E52",
  s3:    "#223460",
  bd:    "#2A3F6F",
  bdem:  "#3A5080",
  t1:    "#E8EEF8",
  t2:    "#94A3B8",
  t3:    "#4A5D7E",
  acc:   "#3B82F6",
  accH:  "#2563EB",
  green: "#22C55E",
  red:   "#EF4444",
  amber: "#F59E0B",
};

/* ─── SHARED STYLES ──────────────────────────────────────────── */
const css = {
  wrap: {
    minHeight: "100vh",
    background: T.bg,
    color: T.t1,
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    padding: "0",
  },
  header: {
    background: T.s1,
    borderBottom: `1px solid ${T.bd}`,
    padding: "16px 28px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logo: {
    display: "flex", alignItems: "center", gap: "8px",
    fontSize: "18px", fontWeight: 700, color: T.t1,
  },
  logoMark: {
    width: 32, height: 32, borderRadius: 8,
    background: "linear-gradient(135deg, #3B82F6, #1D4ED8)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  badge: {
    background: "#1D4ED8", color: "#93C5FD",
    fontSize: 10, fontWeight: 700, padding: "2px 6px",
    borderRadius: 4, letterSpacing: "0.08em",
  },
  main: {
    maxWidth: 1160,
    margin: "0 auto",
    padding: "28px 24px",
  },
  section: {
    background: T.s1,
    border: `1px solid ${T.bd}`,
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
  },
  sectionHead: {
    padding: "16px 20px",
    borderBottom: `1px solid ${T.bd}`,
    display: "flex", alignItems: "center", gap: "10px",
    background: T.s2,
  },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: T.t1 },
  card: {
    background: T.s2,
    border: `1px solid ${T.bd}`,
    borderRadius: 10,
    padding: "16px 18px",
  },
  statCard: {
    background: T.s2,
    border: `1px solid ${T.bd}`,
    borderRadius: 10,
    padding: "18px",
    flex: 1,
  },
  statVal: { fontSize: 28, fontWeight: 700, color: T.t1, lineHeight: 1 },
  statLbl: { fontSize: 12, color: T.t2, marginTop: 4 },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  btn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 16px", borderRadius: 8, border: "none",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    transition: "all .15s",
  },
  btnPrimary: {
    background: T.acc, color: "#fff",
  },
  btnGhost: {
    background: "transparent", color: T.t2,
    border: `1px solid ${T.bd}`,
  },
  btnDanger: {
    background: "rgba(239,68,68,.12)", color: T.red,
    border: `1px solid rgba(239,68,68,.25)`,
  },
  btnSuccess: {
    background: "rgba(34,197,94,.12)", color: T.green,
    border: `1px solid rgba(34,197,94,.25)`,
  },
  input: {
    width: "100%", boxSizing: "border-box",
    background: T.bg, border: `1px solid ${T.bd}`,
    borderRadius: 8, padding: "9px 12px",
    color: T.t1, fontSize: 13,
    outline: "none",
  },
  label: { fontSize: 12, fontWeight: 600, color: T.t2, marginBottom: 4, display: "block" },
  pill: (color) => ({
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 9px", borderRadius: 99,
    fontSize: 11, fontWeight: 600,
    background: color === "green" ? "rgba(34,197,94,.12)"
              : color === "red"   ? "rgba(239,68,68,.12)"
              : color === "blue"  ? "rgba(59,130,246,.12)"
              : "rgba(148,163,184,.08)",
    color: color === "green" ? T.green
         : color === "red"   ? T.red
         : color === "blue"  ? "#93C5FD"
         : T.t2,
  }),
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    padding: "10px 14px", textAlign: "left",
    fontSize: 11, fontWeight: 600, color: T.t3,
    borderBottom: `1px solid ${T.bd}`,
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
  td: {
    padding: "12px 14px", fontSize: 13, color: T.t1,
    borderBottom: `1px solid rgba(42,63,111,.5)`,
    verticalAlign: "middle",
  },
  alert: (type) => ({
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 14px", borderRadius: 8, fontSize: 13,
    marginBottom: 14,
    background: type === "error"   ? "rgba(239,68,68,.1)"
              : type === "success" ? "rgba(34,197,94,.1)"
              : "rgba(59,130,246,.1)",
    color: type === "error"   ? "#FCA5A5"
         : type === "success" ? "#86EFAC"
         : "#93C5FD",
    border: `1px solid ${
      type === "error"   ? "rgba(239,68,68,.25)"
    : type === "success" ? "rgba(34,197,94,.25)"
    : "rgba(59,130,246,.25)"}`,
  }),
};

/* ─── API HELPERS ────────────────────────────────────────────── */
async function adminGet(path) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    headers: { "X-Admin-Token": ADMIN_TOKEN },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function adminPost(path, body) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* ─── SMALL COMPONENTS ───────────────────────────────────────── */
function Spinner({ size = 16 }) {
  return (
    <Loader2
      size={size}
      style={{ animation: "spin .7s linear infinite", flexShrink: 0 }}
    />
  );
}

function Alert({ type, children }) {
  const Icon = type === "error" ? AlertCircle : type === "success" ? CheckCircle : AlertCircle;
  return (
    <div style={css.alert(type)}>
      <Icon size={14} style={{ flexShrink: 0 }} />
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, value, label, accent }) {
  return (
    <div style={css.statCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: accent ? `${accent}22` : `${T.acc}22`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={15} color={accent || T.acc} />
        </div>
      </div>
      <div style={css.statVal}>{value}</div>
      <div style={css.statLbl}>{label}</div>
    </div>
  );
}

/* ─── INVITE MODAL ───────────────────────────────────────────── */
function InviteModal({ org, onClose, onSuccess }) {
  const [email, setEmail]       = useState("");
  const [role, setRole]         = useState("counsellor");
  const [loading, setLoading]   = useState(false);
  const [alert, setAlert]       = useState(null);

  async function handleInvite() {
    if (!email.trim()) return;
    setLoading(true);
    setAlert(null);
    try {
      await adminPost("/api/admin/invite", {
        email: email.trim().toLowerCase(),
        org_id: org.id,
        role,
      });
      setAlert({ type: "success", msg: `Invite sent to ${email}` });
      setEmail("");
      setTimeout(() => { onSuccess?.(); }, 1200);
    } catch (e) {
      setAlert({ type: "error", msg: e.message });
    } finally {
      setLoading(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,.65)", backdropFilter: "blur(4px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24,
  };
  const modal = {
    background: T.s1, border: `1px solid ${T.bd}`,
    borderRadius: 14, width: "100%", maxWidth: 420,
    padding: 28, position: "relative",
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <button
          onClick={onClose}
          style={{ ...css.btn, position: "absolute", top: 14, right: 14, padding: "4px 8px" }}
        >
          <X size={15} color={T.t2} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ ...css.logoMark, width: 36, height: 36 }}>
            <UserPlus size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Invite Counsellor</div>
            <div style={{ fontSize: 12, color: T.t2 }}>{org?.name}</div>
          </div>
        </div>

        {alert && <Alert type={alert.type}>{alert.msg}</Alert>}

        <div style={{ marginBottom: 14 }}>
          <label style={css.label}>Email address</label>
          <div style={{ position: "relative" }}>
            <Mail size={14} color={T.t3} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              style={{ ...css.input, paddingLeft: 32 }}
              type="email"
              placeholder="counsellor@agency.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleInvite()}
              autoFocus
            />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={css.label}>Role</label>
          <select
            style={{ ...css.input, appearance: "none" }}
            value={role}
            onChange={e => setRole(e.target.value)}
          >
            <option value="counsellor">Counsellor</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button
          style={{ ...css.btn, ...css.btnPrimary, width: "100%", justifyContent: "center", padding: "10px 16px" }}
          onClick={handleInvite}
          disabled={!email.trim() || loading}
        >
          {loading ? <><Spinner /> Sending invite…</> : <><Send size={14} /> Send Invite Email</>}
        </button>

        <div style={{ fontSize: 11, color: T.t3, marginTop: 12, textAlign: "center" }}>
          Supabase will send a magic-link email. The counsellor sets their own password.
        </div>
      </div>
    </div>
  );
}

/* ─── COUNSELLORS TABLE ──────────────────────────────────────── */
function CounsellorsPanel({ org, onBack }) {
  const [counsellors, setCounsellors] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [showInvite, setShowInvite]   = useState(false);
  const [toggling, setToggling]       = useState(null);
  const [alert, setAlert]             = useState(null);
  const [search, setSearch]           = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await adminGet(`/api/admin/counsellors?org_id=${org.id}`);
      setCounsellors(d.counsellors || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

  async function toggleStatus(c) {
    setToggling(c.id);
    setAlert(null);
    try {
      await adminPost("/api/admin/counsellor-status", {
        user_id: c.id,
        is_active: !c.is_active,
      });
      setAlert({ type: "success", msg: `${c.full_name || c.email} ${!c.is_active ? "activated" : "deactivated"}` });
      await load();
    } catch (e) {
      setAlert({ type: "error", msg: e.message });
    } finally {
      setToggling(null);
    }
  }

  const filtered = counsellors.filter(c =>
    !search || (c.email || "").includes(search.toLowerCase()) || (c.full_name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button style={{ ...css.btn, ...css.btnGhost }} onClick={onBack}>
          <ArrowLeft size={14} /> Orgs
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{org.name}</div>
          <div style={{ fontSize: 12, color: T.t2 }}>Counsellor accounts</div>
        </div>
        <button
          style={{ ...css.btn, ...css.btnPrimary }}
          onClick={() => setShowInvite(true)}
        >
          <UserPlus size={14} /> Invite Counsellor
        </button>
      </div>

      {alert && <Alert type={alert.type}>{alert.msg}</Alert>}

      <div style={css.section}>
        <div style={{ ...css.sectionHead, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={15} color={T.acc} />
            <span style={css.sectionTitle}>
              {counsellors.length} counsellor{counsellors.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div style={{ position: "relative" }}>
            <Search size={13} color={T.t3} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }} />
            <input
              style={{ ...css.input, width: 200, paddingLeft: 28, padding: "6px 10px 6px 28px" }}
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <Spinner size={20} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}><Alert type="error">{error}</Alert></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: T.t2, fontSize: 13 }}>
            {counsellors.length === 0 ? "No counsellors yet — invite the first one." : "No matches."}
          </div>
        ) : (
          <table style={css.table}>
            <thead>
              <tr>
                {["Name / Email", "Role", "Status", "Last login", "Actions"].map(h => (
                  <th key={h} style={css.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ transition: "background .1s" }}>
                  <td style={css.td}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.full_name || "—"}</div>
                    <div style={{ fontSize: 11, color: T.t2 }}>{c.email}</div>
                  </td>
                  <td style={css.td}>
                    <span style={css.pill(c.role === "admin" ? "blue" : "")}>
                      {c.role}
                    </span>
                  </td>
                  <td style={css.td}>
                    <span style={css.pill(c.is_active ? "green" : "red")}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ ...css.td, color: T.t2, fontSize: 12 }}>
                    {c.last_sign_in_at
                      ? new Date(c.last_sign_in_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "Never"}
                  </td>
                  <td style={css.td}>
                    <button
                      style={{ ...css.btn, ...(c.is_active ? css.btnDanger : css.btnSuccess), padding: "5px 11px", fontSize: 12 }}
                      onClick={() => toggleStatus(c)}
                      disabled={toggling === c.id}
                    >
                      {toggling === c.id ? <Spinner size={12} /> : c.is_active
                        ? <><UserX size={12} /> Deactivate</>
                        : <><UserCheck size={12} /> Activate</>
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && (
        <InviteModal
          org={org}
          onClose={() => setShowInvite(false)}
          onSuccess={() => { setShowInvite(false); load(); }}
        />
      )}
    </div>
  );
}

/* ─── ORG LIST ───────────────────────────────────────────────── */
function OrgList({ orgs, onSelect }) {
  const [search, setSearch] = useState("");
  const filtered = orgs.filter(o =>
    !search || o.name?.toLowerCase().includes(search.toLowerCase()) ||
    o.access_code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          All Agencies <span style={{ color: T.t3, fontWeight: 400, fontSize: 13 }}>({orgs.length})</span>
        </div>
        <div style={{ position: "relative" }}>
          <Search size={13} color={T.t3} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }} />
          <input
            style={{ ...css.input, width: 220, paddingLeft: 28, padding: "7px 10px 7px 28px" }}
            placeholder="Search agencies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={css.section}>
        <table style={css.table}>
          <thead>
            <tr>
              {["Agency", "Plan", "Credits left", "Total credits", "Status", "Last active", ""].map(h => (
                <th key={h} style={css.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => {
              const pct = o.analyses_total > 0
                ? Math.round((o.analyses_remaining / o.analyses_total) * 100)
                : 0;
              const pctColor = pct > 40 ? T.green : pct > 15 ? T.amber : T.red;

              return (
                <tr
                  key={o.id}
                  style={{ cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.s2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  onClick={() => onSelect(o)}
                >
                  <td style={css.td}>
                    <div style={{ fontWeight: 600 }}>{o.name}</div>
                    <div style={{ fontSize: 11, color: T.t3, fontFamily: "monospace" }}>{o.access_code}</div>
                  </td>
                  <td style={css.td}>
                    <span style={css.pill("blue")}>{o.plan || "standard"}</span>
                  </td>
                  <td style={css.td}>
                    <div style={{ fontWeight: 700, color: pctColor }}>{o.analyses_remaining ?? "—"}</div>
                    <div style={{ fontSize: 11, color: T.t3 }}>{pct}% remaining</div>
                  </td>
                  <td style={{ ...css.td, color: T.t2 }}>{o.analyses_total ?? "—"}</td>
                  <td style={css.td}>
                    <span style={css.pill(o.is_active ? "green" : "red")}>
                      {o.is_active ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td style={{ ...css.td, color: T.t2, fontSize: 12 }}>
                    {o.last_used_at
                      ? new Date(o.last_used_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                      : "Never"}
                  </td>
                  <td style={css.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, color: T.t3, fontSize: 12 }}>
                      <Users size={13} /> Manage <ChevronRight size={13} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: T.t2, fontSize: 13 }}>
            No agencies match "{search}"
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── MAIN ADMIN PANEL ───────────────────────────────────────── */
export default function AdminPanel() {
  const [pin, setPin]           = useState(() => sessionStorage.getItem("vl_admin_pin") === "ok");
  const [pinInput, setPinInput] = useState("");
  const [pinErr, setPinErr]     = useState(false);

  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);

  /* quick client-side PIN gate (ADMIN_TOKEN never shown) */
  function attemptPin() {
    if (pinInput.trim() === ADMIN_TOKEN || pinInput.trim() === import.meta.env.VITE_ADMIN_PIN) {
      sessionStorage.setItem("vl_admin_pin", "ok");
      setPin(true);
    } else {
      setPinErr(true);
      setTimeout(() => setPinErr(false), 600);
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await adminGet("/api/admin/dashboard");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (pin) load(); }, [pin, load]);

  /* ── stats ── */
  const stats = data ? {
    totalOrgs:    data.orgs?.length ?? 0,
    activeOrgs:   data.orgs?.filter(o => o.is_active)?.length ?? 0,
    totalCredits: data.orgs?.reduce((s, o) => s + (o.analyses_remaining || 0), 0) ?? 0,
    calls30d:     data.usage?.length ?? 0,
  } : null;

  /* ── PIN gate ── */
  if (!pin) {
    return (
      <div style={{ ...css.wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...css.card, width: 340, background: T.s1, border: `1px solid ${T.bd}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div style={css.logoMark}><ShieldCheck size={16} color="#fff" /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>VisaLens Admin</div>
              <div style={{ fontSize: 11, color: T.t2 }}>Restricted access</div>
            </div>
          </div>
          <label style={css.label}>Admin token</label>
          <input
            style={{ ...css.input, marginBottom: 12, ...(pinErr ? { borderColor: T.red } : {}) }}
            type="password"
            placeholder="Enter ADMIN_SECRET_TOKEN"
            value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && attemptPin()}
            autoFocus
          />
          <button
            style={{ ...css.btn, ...css.btnPrimary, width: "100%", justifyContent: "center", padding: "10px" }}
            onClick={attemptPin}
          >
            <ShieldCheck size={14} /> Unlock Admin Panel
          </button>
          {pinErr && <div style={{ color: T.red, fontSize: 12, marginTop: 8, textAlign: "center" }}>Invalid token</div>}
        </div>
      </div>
    );
  }

  /* ── main UI ── */
  return (
    <div style={css.wrap}>
      {/* Header */}
      <div style={css.header}>
        <div style={css.logoMark}><ShieldCheck size={15} color="#fff" /></div>
        <div style={css.logo}>VisaLens <span style={{ color: T.t3, fontWeight: 400 }}>Admin</span></div>
        <div style={css.badge}>ADMIN</div>
        <div style={{ flex: 1 }} />
        <button style={{ ...css.btn, ...css.btnGhost, padding: "6px 12px" }} onClick={load} disabled={loading}>
          <RefreshCw size={13} style={loading ? { animation: "spin .7s linear infinite" } : {}} />
          Refresh
        </button>
        <button
          style={{ ...css.btn, ...css.btnGhost, padding: "6px 12px" }}
          onClick={() => { sessionStorage.removeItem("vl_admin_pin"); setPin(false); }}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>

      <div style={css.main}>
        {/* Error */}
        {error && <Alert type="error">{error} — check ADMIN_TOKEN and worker routes.</Alert>}

        {/* Stats row */}
        {stats && (
          <div style={{ ...css.row, marginBottom: 20 }}>
            <StatCard icon={Building2}  value={stats.totalOrgs}    label="Total agencies" />
            <StatCard icon={Activity}   value={stats.activeOrgs}   label="Active agencies"   accent={T.green} />
            <StatCard icon={CreditCard} value={stats.totalCredits} label="Credits remaining" accent={T.amber} />
            <StatCard icon={Zap}        value={stats.calls30d}     label="AI calls (30d)"    accent="#A855F7" />
          </div>
        )}

        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <Spinner size={24} />
          </div>
        )}

        {/* Counsellors drill-down */}
        {selectedOrg ? (
          <CounsellorsPanel
            org={selectedOrg}
            onBack={() => setSelectedOrg(null)}
          />
        ) : data?.orgs ? (
          <OrgList orgs={data.orgs} onSelect={setSelectedOrg} />
        ) : null}
      </div>

      {/* Keyframe for spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        select option { background: #162444; color: #E8EEF8; }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WORKER ROUTES — paste these inside your /api/admin/ handler
   in worker.js, alongside the existing /dashboard route.
   ═══════════════════════════════════════════════════════════════

// ── ROUTE: list counsellors for an org ──────────────────────────
if (url.pathname === '/api/admin/counsellors') {
  const orgId = url.searchParams.get('org_id');
  if (!orgId) return err(400, 'org_id required');

  // Fetch profiles for the org
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (profileErr) throw profileErr;

  // Enrich with auth.users data (email, last_sign_in_at) via admin API
  const enriched = await Promise.all((profiles || []).map(async (p) => {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(p.id);
      return {
        ...p,
        email: user?.email || null,
        last_sign_in_at: user?.last_sign_in_at || null,
      };
    } catch { return { ...p, email: null, last_sign_in_at: null }; }
  }));

  return ok({ counsellors: enriched });
}

// ── ROUTE: invite a counsellor (POST) ───────────────────────────
if (url.pathname === '/api/admin/invite' && request.method === 'POST') {
  const body = await request.json();
  const { email, org_id, role = 'counsellor' } = body;
  if (!email || !org_id) return err(400, 'email and org_id required');

  const { data, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { org_id, role },
  });
  if (inviteErr) return err(400, inviteErr.message);

  // Pre-create the profile row so resolveAuth works on first sign-in
  await supabase.from('profiles').upsert({
    id:    data.user.id,
    org_id,
    role,
    is_active: true,
  }, { onConflict: 'id' });

  return ok({ success: true, user_id: data.user.id });
}

// ── ROUTE: activate / deactivate a counsellor (POST) ────────────
if (url.pathname === '/api/admin/counsellor-status' && request.method === 'POST') {
  const body = await request.json();
  const { user_id, is_active } = body;
  if (!user_id || is_active === undefined) return err(400, 'user_id and is_active required');

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ is_active })
    .eq('id', user_id);

  if (updateErr) throw updateErr;
  return ok({ success: true });
}

   ═══════════════════════════════════════════════════════════════
   Also update the /api/admin/ method guard in worker.js:
   Change: if (request.method !== 'GET') return err(405, ...)
   To:     if (!['GET','POST'].includes(request.method)) return err(405, ...)
   ═══════════════════════════════════════════════════════════════
*/
