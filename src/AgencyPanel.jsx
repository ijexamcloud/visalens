/**
 * VisaLens — Agency Panel
 * ─────────────────────────────────────────────────────────────────
 * Per-agency management panel. Each agency sees ONLY their own data:
 * credit balance, counsellor list, plan info.
 *
 * HOW IT INTEGRATES:
 * • Rendered via App.jsx at /agency route (see bottom of App.jsx)
 * • Auth: uses the org's JWT token (from orgSession) — NOT the
 * ADMIN_SECRET_TOKEN. Workers routes are protected by verifyJWT.
 * • The agency admin logs in with their normal access code, then
 * navigates to /agency. Their JWT must have role = 'admin'.
 *
 * WORKER ROUTES NEEDED (add to your admin worker):
 * GET  /api/agency/me            → org info + credits for this JWT's org
 * GET  /api/agency/counsellors   → counsellors for this JWT's org only
 * POST /api/agency/invite        → invite counsellor to this JWT's org
 * POST /api/agency/remove        → delete counsellor from this JWT's org
 * POST /api/agency/counsellor-status → activate/deactivate
 *
 * VITE ENV VARS (same as App.jsx, no extras needed):
 * VITE_PROXY_URL — your worker URL
 *
 * ─────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, UserPlus, UserX, UserCheck, Mail, ShieldCheck,
  CreditCard, RefreshCw, AlertCircle, CheckCircle, Loader2,
  Search, X, Send, ArrowLeft, Zap, Clock,
  Trash2, Activity, ChevronDown,
  Bell, BellPlus, Globe, FileText, AlertTriangle, Edit2,
  Archive, Plus, Calendar, ExternalLink, ChevronUp, Building2,
  Eye, EyeOff
} from 'lucide-react';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "https://visalens-proxy.ijecloud.workers.dev";

/* ─── THEME — Linked to App.css variables ──────────────────────────── */
const T = {
  bg:    "var(--bg)",   // Dynamic background
  s1:    "var(--s1)",   // Surfaces
  s2:    "var(--s2)",   // Secondary surfaces
  s3:    "var(--s3)",   // Tertiary surfaces
  bd:    "var(--bd)",   // Borders
  bdem:  "var(--bdem)", // Emphasized borders
  t1:    "var(--t1)",   // Primary text
  t2:    "var(--t2)",   // Secondary text
  t3:    "var(--t3)",   // Muted text
  acc:   "var(--p)",    // Primary accent (Blue)
  accH:  "var(--pm)",   // Accent Hover
  green: "var(--ok)",   // Success
  red:   "var(--err)",  // Error
  amber: "var(--warn)", // Warning
  purple:"#A855F7",     // Keep static or add to App.css
};

/* ─── STYLES ─────────────────────────────────────────────────── */
const S = {
  wrap: {
    minHeight: "100vh",
    background: T.bg,
    color: T.t1,
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
  },
  header: {
    background: T.s1,
    borderBottom: `1px solid ${T.bd}`,
    padding: "14px 28px",
    display: "flex", alignItems: "center", gap: 12,
    position: "sticky", top: 0, zIndex: 100,
  },
  logoMark: {
    width: 32, height: 32, borderRadius: 8,
    background: "linear-gradient(135deg, #3B82F6, #1D4ED8)",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  badge: (color = T.acc) => ({
    background: `${color}22`, color,
    fontSize: 10, fontWeight: 700, padding: "2px 7px",
    borderRadius: 4, letterSpacing: "0.08em", flexShrink: 0,
  }),
  main: {
    maxWidth: 1080,
    margin: "0 auto",
    padding: "28px 24px",
  },
  card: {
    background: T.s1,
    border: `1px solid ${T.bd}`,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardHead: {
    padding: "14px 20px",
    borderBottom: `1px solid ${T.bd}`,
    background: T.s2,
    display: "flex", alignItems: "center", gap: 10,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    background: T.s1,
    border: `1px solid ${T.bd}`,
    borderRadius: 12,
    padding: "18px 20px",
  },
  btn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 16px", borderRadius: 8, border: "none",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    transition: "all .15s", flexShrink: 0,
  },
  btnPrimary:  { background: T.acc, color: "#fff" },
  btnGhost:    { background: "transparent", color: T.t2, border: `1px solid ${T.bd}` },
  btnDanger:   { background: "rgba(239,68,68,.1)", color: T.red, border: "1px solid rgba(239,68,68,.25)" },
  btnSuccess:  { background: "rgba(34,197,94,.1)", color: T.green, border: "1px solid rgba(34,197,94,.25)" },
  input: {
    background: T.bg, border: `1px solid ${T.bd}`,
    borderRadius: 8, padding: "9px 12px",
    color: T.t1, fontSize: 13, outline: "none",
    width: "100%", boxSizing: "border-box",
  },
  label: { fontSize: 12, fontWeight: 600, color: T.t2, marginBottom: 5, display: "block" },
  th: {
    padding: "10px 16px", textAlign: "left",
    fontSize: 11, fontWeight: 600, color: T.t3,
    borderBottom: `1px solid ${T.bd}`,
    textTransform: "uppercase", letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "13px 16px", fontSize: 13, color: T.t1,
    borderBottom: `1px solid rgba(42,63,111,.4)`,
    verticalAlign: "middle",
  },
  pill: (c) => ({
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 9px", borderRadius: 99,
    fontSize: 11, fontWeight: 600,
    background: c === "green"  ? "rgba(34,197,94,.12)"
              : c === "red"    ? "rgba(239,68,68,.12)"
              : c === "blue"   ? "rgba(59,130,246,.12)"
              : c === "amber"  ? "rgba(245,158,11,.12)"
              : "rgba(148,163,184,.08)",
    color: c === "green"  ? T.green
         : c === "red"    ? T.red
         : c === "blue"   ? "#93C5FD"
         : c === "amber"  ? T.amber
         : T.t2,
  }),
  alertBox: (t) => ({
    display: "flex", alignItems: "flex-start", gap: 8,
    padding: "10px 14px", borderRadius: 8, fontSize: 13,
    marginBottom: 14,
    background: t === "error"   ? "rgba(239,68,68,.1)"
              : t === "success" ? "rgba(34,197,94,.1)"
              : "rgba(59,130,246,.1)",
    color: t === "error"   ? "#FCA5A5"
         : t === "success" ? "#86EFAC" : "#93C5FD",
    border: `1px solid ${
      t === "error"   ? "rgba(239,68,68,.25)"
    : t === "success" ? "rgba(34,197,94,.25)"
    : "rgba(59,130,246,.25)"}`,
  }),
};

/* ─── JWT helper — get token from orgSession ─────────────────── */
function getJwt() {
  try {
    const raw = sessionStorage.getItem("visalens_org_session");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.jwt || null;
  } catch { return null; }
}

/* ─── Session + API helpers ──────────────────────────────────────────── */
function getOrgSession() {
  try {
    const raw = sessionStorage.getItem("visalens_org_session");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function getAuthHeaders() {
  const session = getOrgSession();
  if (!session) return { "Content-Type": "application/json" };
  if (session.access_token) {
    return { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` };
  }
  return { "Content-Type": "application/json", "X-Org-Id": session.org_id || "" };
}

async function agencyGet(path) {
  const res = await fetch(`${PROXY_URL}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `API Error: ${res.status}`); }
  return res.json();
}

async function agencyPost(path, body) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `API Error: ${res.status}`); }
  return res.json();
}

async function agencyPatch(path, body) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `API Error: ${res.status}`); }
  return res.json();
}

async function agencyDelete(path, body) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "DELETE", headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `API Error: ${res.status}`); }
  return res.json();
}

/* ─── SMALL UTILS ────────────────────────────────────────────── */
function Spinner({ size = 15 }) {
  return <Loader2 size={size} style={{ animation: "spin .7s linear infinite", flexShrink: 0 }} />;
}

function AlertBox({ type, children, onDismiss }) {
  const Icon = type === "success" ? CheckCircle : AlertCircle;
  return (
    <div style={S.alertBox(type)}>
      <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", opacity: .7 }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function fmt(date) {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ─── CREDIT BAR ─────────────────────────────────────────────── */
function CreditBar({ remaining, total }) {
  const pct   = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;
  const color = pct > 40 ? T.green : pct > 15 ? T.amber : T.red;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 6, borderRadius: 99, background: T.s3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: T.t3 }}>
        <span style={{ color }}>{remaining} remaining</span>
        <span>{pct}% of {total}</span>
      </div>
    </div>
  );
}

/* ─── CONFIRM DIALOG ─────────────────────────────────────────── */
function ConfirmDialog({ message, onConfirm, onCancel, danger }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: T.s1, border: `1px solid ${T.bd}`,
        borderRadius: 14, padding: 28, maxWidth: 380, width: "100%",
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Are you sure?</div>
        <div style={{ fontSize: 13, color: T.t2, marginBottom: 22, lineHeight: 1.6 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...S.btn, ...(danger ? S.btnDanger : S.btnPrimary) }}
            onClick={onConfirm}
          >
            {danger ? <><Trash2 size={13} /> Remove</> : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── TAB DEFINITIONS (must match App.jsx tab ids) ──────────── */
const ALL_TABS = [
  { id: "analyze",      label: "Analyse",            group: "Workspace" },
  { id: "chat",         label: "AI Chat",            group: "Workspace" },
  { id: "resume",       label: "CV / Resume Builder",group: "Workspace" },
  { id: "sop",          label: "SOP Builder",        group: "Workspace" },
  { id: "dashboard",    label: "Student Dashboard",  group: "Tools"     },
  { id: "match",        label: "Program Match",      group: "Tools"     },
  { id: "inbox",        label: "Inbox Scanner",      group: "Tools"     },
  { id: "calendar",     label: "Calendar",           group: "Tools"     },
  { id: "expiry",       label: "Expiry Radar",       group: "Tools"     },
  { id: "policy",       label: "Policy Alerts",      group: "Tools"     },
  { id: "history",       label: "Case History",           group: "Tools"     },
  { id: "requirements",  label: "University Data",         group: "Tools"     },
  { id: "mock_interview", label: "AI Interview Assistant", group: "Tools"     },
];
const TAB_GROUPS = ["Workspace", "Tools"];

/* ─── EDIT RESTRICTIONS MODAL ────────────────────────────────── */
function EditRestrictionsModal({ counsellor, onClose, onSaved }) {
  const [quota, setQuota] = useState(
    counsellor.credit_quota !== null && counsellor.credit_quota !== undefined
      ? String(counsellor.credit_quota) : ""
  );
  const [restrictedTabs, setRestrictedTabs] = useState(
    Array.isArray(counsellor.restricted_tabs) ? [...counsellor.restricted_tabs] : []
  );
  const [loading, setLoading] = useState(false);
  const [alert,   setAlert]   = useState(null);

  function toggleTab(id) {
    setRestrictedTabs(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }

  async function save() {
    setLoading(true); setAlert(null);
    const parsedQuota = quota.trim() === "" ? null : parseInt(quota, 10);
    if (quota.trim() !== "" && (isNaN(parsedQuota) || parsedQuota < 0)) {
      setAlert({ type: "error", msg: "Credit quota must be a positive number or left blank for unlimited." });
      setLoading(false); return;
    }
    try {
      await agencyPatch("/api/agency/member-restrictions", {
        user_id:         counsellor.id,
        credit_quota:    parsedQuota,
        restricted_tabs: restrictedTabs,
      });
      setAlert({ type: "success", msg: "Restrictions saved." });
      setTimeout(() => { onSaved?.(); onClose(); }, 1000);
    } catch (e) {
      setAlert({ type: "error", msg: e.message });
    } finally { setLoading(false); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      overflowY: "auto",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.s1, border: `1px solid ${T.bd}`,
        borderRadius: 16, padding: 28, maxWidth: 500, width: "100%",
        position: "relative", margin: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: `${T.acc}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck size={16} color={T.acc} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Edit Restrictions</div>
            <div style={{ fontSize: 12, color: T.t2 }}>{counsellor.full_name || counsellor.email}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.t3, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {alert && <AlertBox type={alert.type}>{alert.msg}</AlertBox>}

        {/* Credit quota */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>
            Individual Credit Quota
            <span style={{ fontWeight: 400, color: T.t3, marginLeft: 6 }}>— leave blank for unlimited</span>
          </label>
          <div style={{ position: "relative" }}>
            <CreditCard size={13} color={T.t3} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input
              style={{ ...S.input, paddingLeft: 32 }}
              type="number" min={0} placeholder="e.g. 50"
              value={quota}
              onChange={e => setQuota(e.target.value)}
            />
          </div>
          <div style={{ fontSize: 11, color: T.t3, marginTop: 5 }}>
            When this user reaches their quota, AI analyses will be blocked until a manager raises the limit.
          </div>
        </div>

        {/* Tab restrictions */}
        <div style={{ marginBottom: 22 }}>
          <label style={S.label}>
            Hidden Navigation Tabs
            <span style={{ fontWeight: 400, color: T.t3, marginLeft: 6 }}>— selected tabs are hidden for this user</span>
          </label>
          {TAB_GROUPS.map(group => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                {group}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_TABS.filter(t => t.group === group).map(t => {
                  const isRestricted = restrictedTabs.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTab(t.id)}
                      style={{
                        padding: "5px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", transition: "all .12s",
                        border: `1px solid ${isRestricted ? T.red : T.bd}`,
                        background: isRestricted ? "rgba(239,68,68,.1)" : T.s2,
                        color: isRestricted ? T.red : T.t2,
                      }}
                    >
                      {isRestricted && <span style={{ marginRight: 4 }}>✕</span>}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {restrictedTabs.length > 0 && (
            <div style={{ fontSize: 11, color: T.amber, marginTop: 4 }}>
              {restrictedTabs.length} tab{restrictedTabs.length !== 1 ? "s" : ""} will be hidden for this user.
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose}>Cancel</button>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: loading ? .6 : 1 }}
            onClick={save}
            disabled={loading}
          >
            {loading ? <><Spinner size={13} /> Saving…</> : <><ShieldCheck size={13} /> Save Restrictions</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── INVITE MODAL ───────────────────────────────────────────── */
function InviteModal({ orgId, orgName, onClose, onSuccess, branches = [], callerRole }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role,     setRole]     = useState("counsellor");
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [loading,  setLoading]  = useState(false);
  const [showPw,   setShowPw]   = useState(false);
  const [alert,    setAlert]    = useState(null);

  const assignableRoles = callerRole === "org_owner"
    ? [
        { value: "org_owner",         label: "Org Owner" },
        { value: "branch_manager",    label: "Branch Manager" },
        { value: "senior_counsellor", label: "Senior Counsellor" },
        { value: "counsellor",        label: "Counsellor" },
        { value: "viewer",            label: "Viewer (read-only)" },
      ]
    : [
        { value: "senior_counsellor", label: "Senior Counsellor" },
        { value: "counsellor",        label: "Counsellor" },
        { value: "viewer",            label: "Viewer (read-only)" },
      ];

  async function send() {
    if (!email.trim()) return;
    if (!password || password.length < 8) { setAlert({ type: "error", msg: "Password must be at least 8 characters." }); return; }
    setLoading(true); setAlert(null);
    try {
      await agencyPost("/api/agency/create-member", {
        email:     email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
        role,
        branch_id: branchId || undefined,
      });
      setAlert({ type: "success", msg: `Account created for ${email}` });
      setTimeout(() => { onSuccess?.(); onClose(); }, 1400);
    } catch (e) {
      setAlert({ type: "error", msg: e.message });
    } finally { setLoading(false); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,.65)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.s1, border: `1px solid ${T.bd}`,
        borderRadius: 16, padding: 28, maxWidth: 440, width: "100%", position: "relative",
      }}>
        <button onClick={onClose} style={{ ...S.btn, position: "absolute", top: 14, right: 14, padding: "4px 8px" }}>
          <X size={15} color={T.t2} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div style={{ ...S.logoMark, background: "linear-gradient(135deg, #22C55E, #15803D)" }}>
            <UserPlus size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Add Member</div>
            <div style={{ fontSize: 12, color: T.t2 }}>{orgName}</div>
          </div>
        </div>

        {alert && <AlertBox type={alert.type}>{alert.msg}</AlertBox>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={S.label}>Email address</label>
            <div style={{ position: "relative" }}>
              <Mail size={13} color={T.t3} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input style={{ ...S.input, paddingLeft: 32 }} type="email" placeholder="name@agency.com"
                value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()} autoFocus />
            </div>
          </div>
          <div>
            <label style={S.label}>Full Name</label>
            <input style={S.input} type="text" placeholder="Ahmed Khan"
              value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div style={{ position: "relative" }}>
            <label style={S.label}>Password</label>
            <input style={{ ...S.input, paddingRight: 36 }} type={showPw ? "text" : "password"} placeholder="Min. 8 characters"
              value={password} onChange={e => { setPassword(e.target.value); setAlert(null); }} />
            <button onClick={() => setShowPw(p => !p)}
              style={{ position: "absolute", right: 10, bottom: 10, background: "none", border: "none", cursor: "pointer", color: T.t3, padding: 0 }}>
              {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
          <div>
            <label style={S.label}>Role</label>
            <select style={{ ...S.input, appearance: "none", cursor: "pointer" }}
              value={role} onChange={e => setRole(e.target.value)}>
              {assignableRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {branches.length > 0 && callerRole === "org_owner" && (
            <div style={{ gridColumn: "1/-1" }}>
              <label style={S.label}>Branch</label>
              <select style={{ ...S.input, appearance: "none", cursor: "pointer" }}
                value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">— No branch (org-wide) —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ""}</option>)}
              </select>
            </div>
          )}
        </div>

        <button style={{ ...S.btn, ...S.btnPrimary, width: "100%", justifyContent: "center", padding: "10px 16px" }}
          onClick={send} disabled={!email.trim() || !password || loading}>
          {loading ? <><Spinner /> Creating…</> : <><UserPlus size={14} /> Create Account</>}
        </button>
        <div style={{ fontSize: 11, color: T.t3, marginTop: 10, textAlign: "center" }}>
          They can log in immediately with these credentials.
        </div>
      </div>
    </div>
  );
}

/* ─── BRANCHES SECTION ──────────────────────────────────────── */
function BranchesSection({ orgId, callerRole, onBranchesLoaded }) {
  const [branches,    setBranches]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [showAdd,     setShowAdd]     = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newCity,     setNewCity]     = useState("");
  const [adding,      setAdding]      = useState(false);
  const [alert,       setAlert]       = useState(null);
  const [allocating,  setAllocating]  = useState(null);
  const [allocAmt,    setAllocAmt]    = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await agencyGet("/api/agency/branches");
      setBranches(d.branches || []);
      onBranchesLoaded?.(d.branches || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(type, msg) { setAlert({ type, msg }); setTimeout(() => setAlert(null), 3500); }

  async function addBranch() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await agencyPost("/api/agency/branches", { name: newName.trim(), city: newCity.trim() || undefined });
      flash("success", `Branch "${newName}" created`);
      setNewName(""); setNewCity(""); setShowAdd(false);
      await load();
    } catch (e) { flash("error", e.message); }
    finally { setAdding(false); }
  }

  async function allocateCredits(branch) {
    const amt = parseInt(allocAmt, 10);
    if (isNaN(amt) || amt < 0) { flash("error", "Enter a valid number of credits."); return; }
    try {
      await agencyPost("/api/agency/allocate-credits", { target_type: "branch", target_id: branch.id, amount: amt });
      flash("success", `${amt} credits allocated to ${branch.name}`);
      setAllocating(null); setAllocAmt("");
      await load();
    } catch (e) { flash("error", e.message); }
  }

  const canManage = callerRole === "org_owner";

  return (
    <>
      {alert && <AlertBox type={alert.type} onDismiss={() => setAlert(null)}>{alert.msg}</AlertBox>}
      <div style={S.card}>
        <div style={{ ...S.cardHead, justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={15} color={T.acc} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Branches
              <span style={{ color: T.t3, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>({branches.length})</span>
            </span>
          </div>
          {canManage && (
            <button style={{ ...S.btn, ...S.btnPrimary, padding: "6px 14px" }} onClick={() => setShowAdd(v => !v)}>
              <Plus size={13} /> {showAdd ? "Cancel" : "Add Branch"}
            </button>
          )}
        </div>

        {showAdd && canManage && (
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.bd}`, background: T.s2 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
              <div>
                <label style={S.label}>Branch Name</label>
                <input style={S.input} placeholder="e.g. Lahore HQ" value={newName}
                  onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addBranch()} autoFocus />
              </div>
              <div>
                <label style={S.label}>City (optional)</label>
                <input style={S.input} placeholder="e.g. Lahore" value={newCity}
                  onChange={e => setNewCity(e.target.value)} onKeyDown={e => e.key === "Enter" && addBranch()} />
              </div>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={addBranch} disabled={!newName.trim() || adding}>
                {adding ? <Spinner size={13} /> : <><Plus size={13} /> Create</>}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner size={20} /></div>
        ) : error ? (
          <div style={{ padding: 20 }}><AlertBox type="error">{error}</AlertBox></div>
        ) : branches.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: T.t2, fontSize: 13 }}>
            No branches yet. {canManage ? "Create one to organise your team." : ""}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Branch", "City", "Members", "Credits Allocated", ...(canManage ? ["Actions"] : [])].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches.map(b => (
                  <tr key={b.id}
                    onMouseEnter={e => e.currentTarget.style.background = T.s2}
                    onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600 }}>{b.name}</div>
                    </td>
                    <td style={{ ...S.td, color: T.t2 }}>{b.city || "—"}</td>
                    <td style={S.td}><span style={S.pill("blue")}>{b.member_count ?? 0}</span></td>
                    <td style={S.td}>
                      {allocating === b.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input style={{ ...S.input, width: 80, padding: "5px 8px" }} type="number" min={0}
                            placeholder="0" value={allocAmt} onChange={e => setAllocAmt(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && allocateCredits(b)} autoFocus />
                          <button style={{ ...S.btn, ...S.btnPrimary, padding: "5px 10px", fontSize: 12 }}
                            onClick={() => allocateCredits(b)}>Save</button>
                          <button style={{ ...S.btn, ...S.btnGhost, padding: "5px 8px" }}
                            onClick={() => { setAllocating(null); setAllocAmt(""); }}>✕</button>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 600, color: T.t1 }}>{b.allocated_credits ?? 0}</span>
                      )}
                    </td>
                    {canManage && (
                      <td style={S.td}>
                        {allocating !== b.id && (
                          <button style={{ ...S.btn, ...S.btnGhost, padding: "5px 11px", fontSize: 12 }}
                            onClick={() => { setAllocating(b.id); setAllocAmt(String(b.allocated_credits ?? 0)); }}>
                            <CreditCard size={12} /> Allocate Credits
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── COUNSELLORS SECTION ────────────────────────────────────── */
function CounsellorsSection({ orgId, orgName, branches = [], callerRole }) {
  const [counsellors, setCounsellors] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [showInvite,  setShowInvite]  = useState(false);
  const [search,      setSearch]      = useState("");
  const [busy,        setBusy]        = useState(null);
  const [alert,       setAlert]       = useState(null);
  const [confirm,     setConfirm]     = useState(null);
  const [editRestrict,setEditRestrict]= useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await agencyGet("/api/agency/counsellors");
      setCounsellors(d.counsellors || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(type, msg) {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 3500);
  }

  async function toggleStatus(c) {
    setBusy(c.id);
    try {
      await agencyPost("/api/agency/member-status", { user_id: c.id, is_active: !c.is_active, status: !c.is_active ? "active" : "suspended" });
      flash("success", `${c.full_name || c.email} ${!c.is_active ? "activated" : "deactivated"}`);
      await load();
    } catch (e) { flash("error", e.message); }
    finally { setBusy(null); }
  }

  async function removeCounsellor(c) {
    setConfirm(null);
    setBusy(c.id);
    try {
      await agencyPost("/api/agency/remove", { user_id: c.id });
      flash("success", `${c.full_name || c.email} removed`);
      await load();
    } catch (e) { flash("error", e.message); }
    finally { setBusy(null); }
  }

  const filtered = counsellors.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.email || "").toLowerCase().includes(q) || (c.full_name || "").toLowerCase().includes(q);
  });

  return (
    <>
      {alert && (
        <AlertBox type={alert.type} onDismiss={() => setAlert(null)}>
          {alert.msg}
        </AlertBox>
      )}

      <div style={S.card}>
        <div style={{ ...S.cardHead, justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={15} color={T.acc} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Counsellors
              <span style={{ color: T.t3, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                ({counsellors.length})
              </span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} color={T.t3} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                style={{ ...S.input, width: 190, padding: "6px 10px 6px 28px" }}
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", padding: 0, color: T.t3 }}>
                  <X size={12} />
                </button>
              )}
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary, padding: "6px 14px" }} onClick={() => setShowInvite(true)}>
              <UserPlus size={13} /> Invite
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 50, display: "flex", justifyContent: "center" }}>
            <Spinner size={20} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}><AlertBox type="error">{error}</AlertBox></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 50, textAlign: "center", color: T.t2, fontSize: 13 }}>
            {counsellors.length === 0
              ? <><UserPlus size={28} color={T.t3} style={{ display: "block", margin: "0 auto 10px" }} />No counsellors yet — invite the first one.</>
              : `No matches for "${search}"`
            }
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name / Email", "Role", "Branch", "Quota", "Access", "Status", "Last login", "Actions"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    style={{ transition: "background .12s" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.s2}
                    onMouseLeave={e => e.currentTarget.style.background = ""}
                  >
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.full_name || "—"}</div>
                      <div style={{ fontSize: 11, color: T.t2, marginTop: 1 }}>{c.email}</div>
                    </td>
                    <td style={S.td}>
                      <span style={S.pill(
                        c.role === "org_owner" ? "amber" :
                        c.role === "branch_manager" ? "blue" :
                        c.role === "senior_counsellor" ? "blue" : ""
                      )}>
                        {(c.role || "counsellor").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: T.t2, fontSize: 12 }}>
                      {branches.find(b => b.id === c.branch_id)?.name || <span style={{ color: T.t3 }}>—</span>}
                    </td>
                    
                    {/* QUOTA COLUMN */}
                    <td style={S.td}>
                      {c.credit_quota !== null && c.credit_quota !== undefined ? (
                        <span style={S.pill("blue")} title="Individual credit quota">
                          <CreditCard size={10} /> {c.credit_quota}
                        </span>
                      ) : (
                        <span style={{ color: T.t3, fontSize: 12 }}>Unlimited</span>
                      )}
                    </td>

                    {/* NEW ACCESS/RESTRICTIONS COLUMN */}
                    <td style={S.td}>
                      {c.restricted_tabs?.length > 0 ? (
                        <span 
                          style={S.pill("amber")} 
                          title={`Hidden: ${c.restricted_tabs.map(id => ALL_TABS.find(t=>t.id===id)?.label || id).join(', ')}`}
                        >
                          {c.restricted_tabs.length} Hidden
                        </span>
                      ) : (
                        <span style={{ color: T.t3, fontSize: 12 }}>Full Access</span>
                      )}
                    </td>

                    <td style={S.td}>
                      <span style={S.pill(c.is_active ? "green" : "red")}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: T.t2, fontSize: 12 }}>
                      {fmt(c.last_sign_in_at)}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          style={{ ...S.btn, ...S.btnGhost, padding: "5px 10px", fontSize: 12 }}
                          onClick={() => setEditRestrict(c)}
                          disabled={busy === c.id}
                          title="Edit credit quota and feature restrictions"
                        >
                          <Edit2 size={12} /> Edit
                        </button>
                        <button
                          style={{ ...S.btn, ...(c.is_active ? S.btnDanger : S.btnSuccess), padding: "5px 11px", fontSize: 12 }}
                          onClick={() => toggleStatus(c)}
                          disabled={busy === c.id}
                          title={c.is_active ? "Deactivate access" : "Re-activate access"}
                        >
                          {busy === c.id ? <Spinner size={12} />
                            : c.is_active ? <><UserX size={12} /> Deactivate</>
                            : <><UserCheck size={12} /> Activate</>}
                        </button>
                        <button
                          style={{ ...S.btn, background: "transparent", color: T.t3, border: `1px solid transparent`, padding: "5px 8px" }}
                          onClick={() => setConfirm({ c, action: "remove" })}
                          disabled={busy === c.id}
                          title="Remove counsellor permanently"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal
          orgId={orgId}
          orgName={orgName}
          branches={branches}
          callerRole={callerRole}
          onClose={() => setShowInvite(false)}
          onSuccess={load}
        />
      )}

      {editRestrict && (
        <EditRestrictionsModal
          counsellor={editRestrict}
          onClose={() => setEditRestrict(null)}
          onSaved={load}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={`This will permanently remove ${confirm.c.full_name || confirm.c.email} from your agency. They will lose access immediately.`}
          danger
          onConfirm={() => removeCounsellor(confirm.c)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/* ─── SUPABASE CLIENT (reuse from window if available) ───────── */
function getSupabase() {
  return window._supabaseInstance || null;
}

/* ─── SEVERITY CONFIG ────────────────────────────────────────── */
const SEV = {
  high:   { label: "High",   color: "#DC2626", bg: "rgba(220,38,38,.1)",  bd: "rgba(220,38,38,.3)"  },
  medium: { label: "Medium", color: "#D97706", bg: "rgba(217,119,6,.1)",  bd: "rgba(217,119,6,.3)"  },
  low:    { label: "Low",    color: "#059669", bg: "rgba(5,150,105,.1)",  bd: "rgba(5,150,105,.3)"  },
};

/* ─── ALERT FORM MODAL ───────────────────────────────────────── */
function AlertFormModal({ orgId, existingAlert, availableCountries, onClose, onSaved }) {
  const isEdit = !!existingAlert;
  const [title,     setTitle]     = useState(existingAlert?.title     || "");
  const [detail,    setDetail]    = useState(existingAlert?.detail    || "");
  const [severity,  setSeverity]  = useState(existingAlert?.severity  || "medium");
  const [countries, setCountries] = useState(existingAlert?.affected_countries || []);
  const [sourceUrl, setSourceUrl] = useState(existingAlert?.source_url || "");
  const [expiresAt, setExpiresAt] = useState(
    existingAlert?.expires_at ? existingAlert.expires_at.split("T")[0] : ""
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  function toggleCountry(c) {
    setCountries(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  }

  async function save() {
    if (!title.trim())          return setError("Title is required.");
    if (!detail.trim())         return setError("Description is required.");
    if (countries.length === 0) return setError("Select at least one affected country.");
    setSaving(true); setError(null);

    const session = getOrgSession();

    const payload = {
      title:               title.trim(),
      detail:              detail.trim(),
      severity,
      affected_countries:  countries,
      source_url:          sourceUrl.trim() || null,
      expires_at:          expiresAt || null,
      created_by:          session?.counsellor_name || session?.org_name || "Admin",
      is_active:           true,
      status:              "active",
      source:              "manual",
    };

    try {
      if (isEdit) {
        await agencyPatch("/api/agency/alerts", { id: existingAlert.id, ...payload });
      } else {
        await agencyPost("/api/agency/alerts", payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      overflowY: "auto",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.s1, border: `1px solid ${T.bd}`,
        borderRadius: 16, padding: 28, maxWidth: 540, width: "100%",
        position: "relative", margin: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(249,115,22,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BellPlus size={16} color="#F97316" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{isEdit ? "Edit Alert" : "New Policy Alert"}</div>
            <div style={{ fontSize: 12, color: T.t2 }}>Visible to all counsellors in your agency</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.t3, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {error && <AlertBox type="error">{error}</AlertBox>}

        {/* Title */}
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Alert title *</label>
          <input
            style={S.input}
            placeholder="e.g. IHS surcharge increase for UK students"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* Detail */}
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Description *</label>
          <textarea
            style={{ ...S.input, minHeight: 90, resize: "vertical", lineHeight: 1.5 }}
            placeholder="What happened, what counsellors should do, deadlines…"
            value={detail}
            onChange={e => setDetail(e.target.value)}
          />
        </div>

        {/* Severity + Expiry row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={S.label}>Severity *</label>
            <select style={{ ...S.input, cursor: "pointer" }} value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="high">🔴 High — urgent action needed</option>
              <option value="medium">🟡 Medium — review soon</option>
              <option value="low">🟢 Low — for awareness</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Expires on (optional)</label>
            <input
              type="date"
              style={{ ...S.input, colorScheme: "dark", cursor: "pointer" }}
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        {/* Source URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Source URL (optional)</label>
          <input
            style={S.input}
            placeholder="https://gov.uk/..."
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
          />
        </div>

        {/* Country selector */}
        <div style={{ marginBottom: 22 }}>
          <label style={S.label}>
            Affected countries * — only countries in your caseload shown
          </label>
          {availableCountries.length === 0 ? (
            <div style={{ fontSize: 12, color: T.t3, padding: "10px 0" }}>
              No countries found in your cases yet.
            </div>
          ) : (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6,
              padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${T.bd}`, background: T.bg,
              maxHeight: 160, overflowY: "auto",
            }}>
              {availableCountries.map(c => {
                const selected = countries.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleCountry(c)}
                    style={{
                      padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", transition: "all .12s",
                      border: `1px solid ${selected ? "#1D6BE8" : T.bd}`,
                      background: selected ? "rgba(29,107,232,.12)" : T.s2,
                      color: selected ? "#1D6BE8" : T.t2,
                    }}
                  >
                    {selected && <span style={{ marginRight: 4 }}>✓</span>}{c}
                  </button>
                );
              })}
            </div>
          )}
          {countries.length > 0 && (
            <div style={{ fontSize: 11, color: T.t3, marginTop: 5 }}>
              {countries.length} country{countries.length !== 1 ? "ies" : ""} selected
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose}>Cancel</button>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: saving ? .6 : 1 }}
            onClick={save}
            disabled={saving}
          >
            {saving ? <><Spinner size={13} /> Saving…</> : <><Bell size={13} /> {isEdit ? "Save changes" : "Publish alert"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ALERTS SECTION ─────────────────────────────────────────── */
function AlertsSection({ orgId, availableCountries = [] }) {
  const [alerts,            setAlerts]            = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [showForm,          setShowForm]          = useState(false);
  const [editAlert,         setEditAlert]         = useState(null);
  const [flash,             setFlash]             = useState(null);
  const [confirmArchive,    setConfirmArchive]    = useState(null);
  const [filter,            setFilter]            = useState("active");

  function showFlash(type, msg) {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }

  async function load() {
    setLoading(true);
    try {
      const { alerts: alertData } = await agencyGet("/api/agency/alerts");
      setAlerts(alertData || []);
    } catch (e) {
      showFlash("error", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orgId]);

  async function archiveAlert(alert) {
    setConfirmArchive(null);
    try {
      await agencyPatch("/api/agency/alerts", { id: alert.id, is_active: false, status: "archived" });
      showFlash("success", "Alert archived");
      load();
    } catch (e) { showFlash("error", e.message); }
  }

  async function restoreAlert(alert) {
    try {
      await agencyPatch("/api/agency/alerts", { id: alert.id, is_active: true, status: "active" });
      showFlash("success", "Alert restored");
      load();
    } catch (e) { showFlash("error", e.message); }
  }

  async function deleteAlert(alert) {
    setConfirmArchive(null);
    try {
      await agencyDelete("/api/agency/alerts", { id: alert.id });
      showFlash("success", "Alert deleted");
      load();
    } catch (e) { showFlash("error", e.message); }
  }

  const filtered = alerts.filter(a => {
    if (filter === "active")   return a.is_active !== false && a.status !== "archived";
    if (filter === "archived") return !a.is_active || a.status === "archived";
    return true;
  });

  const activeCount   = alerts.filter(a => a.is_active !== false && a.status !== "archived").length;
  const archivedCount = alerts.filter(a => !a.is_active || a.status === "archived").length;

  return (
    <>
      {flash && <AlertBox type={flash.type} onDismiss={() => setFlash(null)}>{flash.msg}</AlertBox>}

      <div style={S.card}>
        <div style={{ ...S.cardHead, justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={15} color="#F97316" />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Policy Alerts
              {activeCount > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 7px",
                  background: "rgba(220,38,38,.12)", color: "#DC2626",
                  border: "1px solid rgba(220,38,38,.25)", borderRadius: 99,
                }}>
                  {activeCount} active
                </span>
              )}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[
              { id: "active",   label: "Active",   count: activeCount   },
              { id: "archived", label: "Archived", count: archivedCount },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                style={{
                  ...S.btn, padding: "5px 12px", fontSize: 12,
                  background: filter === tab.id ? "rgba(29,107,232,.1)" : "transparent",
                  color: filter === tab.id ? T.acc : T.t2,
                  border: `1px solid ${filter === tab.id ? T.acc : T.bd}`,
                }}
              >
                {tab.label}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 99,
                  background: filter === tab.id ? T.acc : T.s3,
                  color: filter === tab.id ? "#fff" : T.t3,
                }}>{tab.count}</span>
              </button>
            ))}
            <button
              style={{ ...S.btn, ...S.btnPrimary, padding: "6px 14px" }}
              onClick={() => { setEditAlert(null); setShowForm(true); }}
            >
              <BellPlus size={13} /> New Alert
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 50, display: "flex", justifyContent: "center" }}><Spinner size={20} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 50, textAlign: "center", color: T.t2, fontSize: 13 }}>
            <Bell size={28} color={T.t3} style={{ display: "block", margin: "0 auto 10px" }} />
            {filter === "active"
              ? "No active alerts. Create one to notify counsellors about policy changes."
              : "No archived alerts."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filtered.map((alert, i) => {
              const sev    = SEV[alert.severity] || SEV.medium;
              const isLast = i === filtered.length - 1;
              const isExpired = alert.expires_at && new Date(alert.expires_at) < new Date();

              return (
                <div
                  key={alert.id}
                  style={{
                    padding: "16px 20px",
                    borderBottom: isLast ? "none" : `1px solid ${T.bd}`,
                    display: "flex", gap: 14, alignItems: "flex-start",
                    opacity: (!alert.is_active || alert.status === "archived") ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    marginTop: 3, width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                    background: sev.color,
                    boxShadow: alert.is_active && alert.severity === "high" ? `0 0 0 3px ${sev.bg}` : "none",
                  }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: T.t1 }}>{alert.title}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                        background: sev.bg, color: sev.color, border: `1px solid ${sev.bd}`,
                        textTransform: "uppercase", letterSpacing: ".05em",
                      }}>{sev.label}</span>
                      {isExpired && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                          background: "rgba(148,163,184,.12)", color: T.t3, border: `1px solid ${T.bd}`,
                        }}>Expired</span>
                      )}
                    </div>

                    <div style={{ fontSize: 13, color: T.t2, lineHeight: 1.55, marginBottom: 8 }}>
                      {alert.detail}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                      {alert.affected_countries?.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {alert.affected_countries.map(c => (
                            <span key={c} style={{
                              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                              background: "rgba(29,107,232,.08)", color: "#1D6BE8",
                              border: "1px solid rgba(29,107,232,.2)",
                            }}>
                              <Globe size={9} style={{ marginRight: 3, verticalAlign: "middle" }} />{c}
                            </span>
                          ))}
                        </div>
                      )}
                      <span style={{ fontSize: 11, color: T.t3 }}>
                        By {alert.created_by || "Admin"} · {fmt(alert.created_at)}
                      </span>
                      {alert.expires_at && (
                        <span style={{ fontSize: 11, color: isExpired ? T.red : T.t3 }}>
                          <Calendar size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />
                          Expires {fmt(alert.expires_at)}
                        </span>
                      )}
                      {alert.source_url && (
                        <a
                          href={alert.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: T.acc, display: "inline-flex", alignItems: "center", gap: 3 }}
                        >
                          <ExternalLink size={10} /> Source
                        </a>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {alert.is_active && alert.status !== "archived" ? (
                      <>
                        <button
                          title="Edit alert"
                          style={{ ...S.btn, ...S.btnGhost, padding: "5px 9px" }}
                          onClick={() => { setEditAlert(alert); setShowForm(true); }}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          title="Archive alert"
                          style={{ ...S.btn, ...S.btnGhost, padding: "5px 9px" }}
                          onClick={() => setConfirmArchive({ alert, action: "archive" })}
                        >
                          <Archive size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          title="Restore alert"
                          style={{ ...S.btn, ...S.btnSuccess, padding: "5px 9px", fontSize: 12 }}
                          onClick={() => restoreAlert(alert)}
                        >
                          Restore
                        </button>
                        <button
                          title="Delete permanently"
                          style={{ ...S.btn, ...S.btnDanger, padding: "5px 9px" }}
                          onClick={() => setConfirmArchive({ alert, action: "delete" })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <AlertFormModal
          orgId={orgId}
          existingAlert={editAlert}
          availableCountries={availableCountries}
          onClose={() => { setShowForm(false); setEditAlert(null); }}
          onSaved={() => { load(); showFlash("success", editAlert ? "Alert updated" : "Alert published"); }}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          message={
            confirmArchive.action === "delete"
              ? `Permanently delete "${confirmArchive.alert.title}"? This cannot be undone.`
              : `Archive "${confirmArchive.alert.title}"? Counsellors will no longer see it.`
          }
          danger={confirmArchive.action === "delete"}
          onConfirm={() =>
            confirmArchive.action === "delete"
              ? deleteAlert(confirmArchive.alert)
              : archiveAlert(confirmArchive.alert)
          }
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </>
  );
}

/* ─── MAIN AGENCY PANEL ──────────────────────────────────────── */
export default function AgencyPanel({ onBack, availableCountries = [] }) {
  const [org,       setOrg]       = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [branches,  setBranches]  = useState([]);
  const [activeTab, setActiveTab] = useState("overview");

  const session    = getOrgSession();
  const callerRole = session?.role || "org_owner";

  const loadOrg = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await agencyGet("/api/agency/me");
      setOrg(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOrg(); }, [loadOrg]);

  const planColor = org?.plan === "pro" ? T.purple
    : org?.plan === "enterprise" ? T.amber
    : T.acc;

  return (
    <div style={S.wrap} className="agency-panel-wrap">
    
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoMark}><ShieldCheck size={15} color="#fff" /></div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {session?.org_name || org?.name || "Agency"}
        </div>
        <div style={S.badge(planColor)}>
          {(org?.plan || session?.plan || "standard").toUpperCase()}
        </div>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...S.btn, ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}
          onClick={loadOrg}
          disabled={loading}
        >
          <RefreshCw size={12} style={loading ? { animation: "spin .7s linear infinite" } : {}} />
          Refresh
        </button>
        {onBack && (
          <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={onBack}>
            <ArrowLeft size={12} /> Back to app
          </button>
        )}
      </div>

      {/* ── TAB NAV ── */}
      <div style={{
        background: T.s1, borderBottom: `1px solid ${T.bd}`,
        padding: "0 28px", display: "flex", gap: 0,
      }}>
        {[
          { id: "overview",  label: "Overview",      icon: Activity  },
          { id: "branches",  label: "Branches",       icon: Building2 },
          { id: "alerts",    label: "Policy Alerts",  icon: Bell      },
        ].filter(t => t.id !== "branches" || ["org_owner","branch_manager"].includes(callerRole))
         .map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "12px 18px", fontSize: 13, fontWeight: 600,
              background: "transparent", border: "none", cursor: "pointer",
              color: activeTab === id ? T.acc : T.t2,
              borderBottom: `2px solid ${activeTab === id ? T.acc : "transparent"}`,
              transition: "all .15s",
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div style={S.main}>
        {error && <AlertBox type="error">{error} — ensure your session is active.</AlertBox>}

        {activeTab === "alerts" && (
          <AlertsSection orgId={org?.id || session?.org_id} availableCountries={availableCountries} />
        )}

        {activeTab === "branches" && (
          <BranchesSection
            orgId={org?.id || session?.org_id}
            callerRole={callerRole}
            onBranchesLoaded={setBranches}
          />
        )}

        {activeTab === "overview" && (<>
          <div style={S.statGrid}>
            {/* Credits */}
            <div style={{ ...S.statCard, gridColumn: "span 2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: `${T.amber}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CreditCard size={14} color={T.amber} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.t2 }}>Analysis Credits</span>
              </div>
              {loading ? <Spinner /> : (
                <>
                  <div style={{ fontSize: 32, fontWeight: 800, color: T.t1, lineHeight: 1 }}>
                    {org?.analyses_remaining ?? session?.analyses_remaining ?? "—"}
                  </div>
                  <CreditBar
                    remaining={org?.analyses_remaining ?? session?.analyses_remaining ?? 0}
                    total={org?.analyses_total ?? 0}
                  />
                </>
              )}
            </div>

            {/* Plan */}
            <div style={S.statCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: `${planColor}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Zap size={14} color={planColor} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.t2 }}>Plan</span>
              </div>
              {loading ? <Spinner /> : (
                <div style={{ fontSize: 20, fontWeight: 700, textTransform: "capitalize" }}>
                  {org?.plan || session?.plan || "Standard"}
                </div>
              )}
            </div>

            {/* Status */}
            <div style={S.statCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(34,197,94,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Activity size={14} color={T.green} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.t2 }}>Status</span>
              </div>
              {loading ? <Spinner /> : (
                <span style={S.pill(org?.is_active !== false ? "green" : "red")}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                  {org?.is_active !== false ? "Active" : "Suspended"}
                </span>
              )}
            </div>

            {/* Last active */}
            <div style={S.statCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(148,163,184,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Clock size={14} color={T.t2} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.t2 }}>Last active</span>
              </div>
              {loading ? <Spinner /> : (
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {fmt(org?.last_used_at)}
                </div>
              )}
            </div>
          </div>

          {!loading && org && (
            <CounsellorsSection
              orgId={org.id || session?.org_id}
              orgName={org.name || session?.org_name}
              branches={branches}
              callerRole={callerRole}
            />
          )}

          {loading && !org && (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
              <Spinner size={24} />
            </div>
          )}
        </>)}
      </div>

      <style>{`
  @keyframes spin { to { transform: rotate(360deg); } }
  * { box-sizing: border-box; }
  
  select option { 
    background: var(--s1); 
    color: var(--t1); 
  }

  .agency-panel-wrap {
    color: var(--t1) !important;
    font-family: var(--fu) !important;
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--bd); border-radius: 3px; }
      `}</style>
    </div>
  );
}