/**
 * VisaLens — Inbox Dashboard v3 (Modern Soft-Fill UI)
 * ─────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Mail, RefreshCw, CheckCircle, Clock, AlertTriangle, AlertCircle,
  GraduationCap, FileText, Search, X, Inbox,
  ExternalLink, Loader2, Wifi, WifiOff,
  Award, CalendarClock, BookOpen, ShieldAlert, Info, User,
  Zap, Bell, Filter, ChevronRight, MailOpen, Sparkles,
  EyeOff, Eye, Archive, ArchiveRestore, MoreVertical,
} from 'lucide-react';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "https://visalens-proxy.ijecloud.workers.dev";

/* ─── session helpers ────────────────────────────────────────────── */
// Token refresh is handled in App.jsx via the Supabase JS client (which knows
// the correct URL/anon-key). InboxDashboard receives authedFetch as a prop so
// it never needs to manage tokens itself.
function getOrgSession() {
  try { return JSON.parse(sessionStorage.getItem("visalens_org_session") || "null"); }
  catch { return null; }
}
function getAuthHeaders() {
  const s = getOrgSession();
  if (!s) return { "Content-Type": "application/json" };
  if (s.access_token) return { "Content-Type": "application/json", "Authorization": `Bearer ${s.access_token}` };
  return { "Content-Type": "application/json", "X-Org-Id": s.org_id || "" };
}
// Bare fallback used only when the prop is not supplied (e.g. unit tests)
async function _defaultFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...getAuthHeaders(), ...(options.headers || {}) } });
}

/* ─── event type config (MODERN THEMES) ──────────────────────────── */
const EVENT_CONFIG = {
  offer_letter:  { label: "Offer Letter",  short: "Offer",    icon: GraduationCap, theme: "purple" },
  cas:           { label: "CAS",           short: "CAS",      icon: FileText,      theme: "purple" },
  interview:     { label: "Interview",     short: "Interview",icon: CalendarClock, theme: "purple" },
  scholarship:   { label: "Scholarship",   short: "Scholar",  icon: Award,         theme: "purple" },
  missing_docs:  { label: "Missing Docs",  short: "Docs",     icon: AlertTriangle, theme: "purple" },
  deadline:      { label: "Deadline",      short: "Deadline", icon: Clock,         theme: "purple" },
  visa_decision: { label: "Visa Decision", short: "Visa",     icon: ShieldAlert,   theme: "purple" },
  other:         { label: "Other",         short: "Other",    icon: Info,          theme: "purple" },
};
function eventCfg(type) { return EVENT_CONFIG[type] || EVENT_CONFIG.other; }

/* ─── smart search token parser ──────────────────────────────────── */
const TYPE_ALIASES = {
  offer: "offer_letter", "offer letter": "offer_letter", cas: "cas", interview: "interview",
  scholarship: "scholarship", docs: "missing_docs", missing: "missing_docs", deadline: "deadline",
  visa: "visa_decision", urgent: "__urgent__", unread: "__unread__", read: "__read__",
};

function parseSearchTokens(raw) {
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result = { types: [], flags: [], text: [] };
  for (const t of tokens) {
    if (TYPE_ALIASES[t]) {
      const val = TYPE_ALIASES[t];
      if (val.startsWith("__")) result.flags.push(val.replace(/__/g, ""));
      else result.types.push(val);
    } else result.text.push(t);
  }
  return result;
}

/* ─── date helpers ───────────────────────────────────────────────── */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtRelative(dateStr) {
  if (!dateStr) return "";
  const diff = Math.round((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 1)    return "just now";
  if (diff < 60)   return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

/* ─── avatar ─────────────────────────────────────────────────────── */
function Avatar({ name, size = 40, urgent = false }) {
  const initials = (name || "?").split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  let hue = 0;
  for (let i = 0; i < (name || "").length; i++) hue = (hue * 31 + (name || "").charCodeAt(i)) % 360;
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: "50%", background: `hsl(${hue},48%,44%)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.36, fontWeight: 700, color: "#fff", letterSpacing: "-.5px",
        userSelect: "none", border: urgent ? "2px solid #EF4444" : "2px solid transparent",
      }}>
        {initials || <User size={size * 0.5} />}
      </div>
      {urgent && <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: "50%", background: "#EF4444", border: "2px solid var(--s1)" }} />}
    </div>
  );
}

/* ─── mega filter & xml generator ────────────────────────────────── */
function generateMegaFilter(universityDomains = []) {
  const baseDomains = [
    '*.edu', '*.gov', '*state.gov', '*uscis.gov', '*.ac.uk', '*.gov.uk',
    '*.edu.au', '*.gov.au', '*homeaffairs.gov.au', '*.ac.nz', '*.govt.nz', '*immigration.govt.nz',
    '*.gc.ca', '*canada.ca', '*.edu.ie', '*irishimmigration.ie', '*inis.gov.ie',
    '*migri.fi', '*auswaertiges-amt.de', '*diplo.de', '*ind.nl', '*migrationsverket.se', '*universityadmissions.se',
    '*vfsglobal.com', '*tlscontact.com', '*vfshelpline.com', '*blsinternational.com'
  ];
  const formattedUniDomains = (universityDomains || []).map(domain => {
    if (!domain) return '';
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return `*${cleanDomain}`;
  }).filter(Boolean);
  const allDomains = Array.from(new Set([...baseDomains, ...formattedUniDomains]));
  const fromString = `from:(${allDomains.join(' OR ')})`;
  const smartTags = ['offer', 'CAS', 'visa', 'interview', 'appointment', 'scholarship', 'deferment', 'I-20', 'admissions', 'application', 'decision'];
  const subjectString = `subject:("${smartTags.join('" OR "')}")`;
  return `${fromString} OR ${subjectString}`;
}

function downloadGmailXML(filterString, forwardingAddress) {
  const xml = `<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'><title>Mail Filters</title><entry><category term='filter'></category><title>VisaLens Smart Tracking Filter</title><apps:property name='hasTheWord' value='${filterString.replace(/'/g, "&apos;")}'/><apps:property name='forwardTo' value='${forwardingAddress}'/></entry></feed>`;
  const blob = new Blob([xml], { type: 'text/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `visalens-filter-${forwardingAddress.split('@')[0]}.xml`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ─── event type chip (MODERN) ─────────────────────────────────────── */
function TypeChip({ type, count, small }) {
  const cfg = eventCfg(type);
  const Icon = cfg.icon;
  return (
    <span className={`soft-chip ${cfg.theme} ${small ? 'micro' : ''}`}>
      <Icon size={small ? 10 : 12} />
      {count && count > 1 ? `${count}× ` : ""}{cfg.short}
    </span>
  );
}

/* ─── FORWARDING ADDRESS PANEL (MODERN WIZARD) ──────────────────── */
function ForwardingAddressPanel({ caseId, onConnected, targetUniversities = [], fetcher = _defaultFetch }) {
  const [address, setAddress]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedFilter, setCopiedFilter]   = useState(false);
  const [error, setError]       = useState(null);

  const megaFilter = useMemo(() => generateMegaFilter(targetUniversities), [targetUniversities]);

  async function loadAddress() {
    setLoading(true); setError(null);
    try {
      const res  = await fetcher(`${PROXY_URL}/api/inbox/forwarding-address?case_id=${caseId}`);
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Could not generate address."); }
      else { setAddress(data.forward_address); onConnected?.(caseId); }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000);
    });
  }

  function copyFilter() {
    navigator.clipboard.writeText(megaFilter).then(() => {
      setCopiedFilter(true); setTimeout(() => setCopiedFilter(false), 2000);
    });
  }

  if (!address && !loading && !error) {
    return (
      <button onClick={loadAddress} className="btn-p" style={{ maxWidth: 220, padding: "0 16px", height: 38 }}>
        <Mail size={16} /> Set Up Email Tracking
      </button>
    );
  }

  if (loading) return <div className="text-body-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={14} className="spin" /> Generating secure tracking address…</div>;
  if (error) return <div className="text-body-sub" style={{ color: "var(--err)" }}>{error}</div>;

  return (
    <div className="panel-modern" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <div className="panel-modern-header">
        <div className="text-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={18} color="var(--p)" /> Smart Email Tracker Setup
        </div>
        <div className="text-body-sub" style={{ marginTop: 4 }}>Complete this one-time setup to automatically catch all university and visa emails.</div>
      </div>
      
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Step 1 */}
        <div>
          <div className="text-body-main" style={{ fontWeight: 600, marginBottom: 8 }}>1. Copy your unique tracking address</div>
          <div className="text-body-sub" style={{ marginBottom: 12 }}>Add this address to your Gmail's <strong>Forwarding and POP/IMAP</strong> settings.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ flex: 1, padding: "10px 14px", background: "var(--s2)", border: "1px solid var(--bd)", borderRadius: 8, color: "var(--p)", fontSize: "var(--text-base)", fontWeight: 600, wordBreak: "break-all" }}>
              {address}
            </code>
            <button onClick={copyAddress} className={`btn-s ${copiedAddress ? 'btn-green' : ''}`} style={{ height: 42 }}>
              {copiedAddress ? "✓ Copied" : "Copy Address"}
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div>
          <div className="text-body-main" style={{ fontWeight: 600, marginBottom: 8 }}>2. Apply the AI Master Rule</div>
          <div className="text-body-sub" style={{ marginBottom: 12 }}>You can either download the automatic setup file, or copy the rule manually into a new Gmail filter.</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Option A: XML */}
            <div style={{ padding: 16, background: "var(--s2)", borderRadius: 12, border: "1px solid var(--bd)" }}>
              <div className="text-body-main" style={{ fontWeight: 600, marginBottom: 4 }}>Option A: Import File</div>
              <div className="text-body-sub" style={{ fontSize: "var(--text-xs)", marginBottom: 12 }}>Download this file, go to Gmail Filters, click "Import Filters", and upload.</div>
              <button onClick={() => downloadGmailXML(megaFilter, address)} className="btn-o" style={{ width: "100%", justifyContent: "center" }}>
                ↓ Download .xml
              </button>
            </div>
            
            {/* Option B: Manual */}
            <div style={{ padding: 16, background: "var(--s2)", borderRadius: 12, border: "1px solid var(--bd)" }}>
              <div className="text-body-main" style={{ fontWeight: 600, marginBottom: 4 }}>Option B: Copy & Paste</div>
              <div className="text-body-sub" style={{ fontSize: "var(--text-xs)", marginBottom: 12 }}>Paste this string into the "Includes the words" field of a new filter.</div>
              <button onClick={copyFilter} className={`btn-s ${copiedFilter ? 'btn-green' : ''}`} style={{ width: "100%", justifyContent: "center" }}>
                {copiedFilter ? "✓ Rule Copied" : "Copy Filter Rule"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── LEFT PANEL: student row card ──────────────────────────────── */
function StudentRow({ studentName, caseAlerts, hasInbox, selected, onClick, urgentCount, unreadCount, onHide, onArchive, onRemove }) {
  const allAlerts = caseAlerts || [];
  const latestAlert = allAlerts[0];
  const totalUpdates = allAlerts.length;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
        background: selected ? "var(--soft-blue-bg)" : "transparent",
        borderLeft: selected ? "4px solid var(--p)" : "4px solid transparent",
        borderBottom: "1px solid var(--bd)", cursor: "pointer", transition: "background var(--fast)",
        position: "relative",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "var(--s2)"; e.currentTarget.querySelector(".row-actions").style.opacity = "1"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; e.currentTarget.querySelector(".row-actions").style.opacity = "0"; }}
    >
      <Avatar name={studentName} size={40} urgent={urgentCount > 0} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span className="text-body-main" style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)" }}>
            {studentName}
          </span>
          {urgentCount > 0 && <span className="soft-chip red micro">⚠ {urgentCount}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--fu)" }}>
          <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 500 }}>
            {!hasInbox
              ? "No tracking"
              : totalUpdates === 0
              ? "No updates"
              : `${totalUpdates} update${totalUpdates !== 1 ? "s" : ""}`}
          </span>
          {latestAlert && (
            <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: "auto", fontWeight: 500 }}>
              {fmtRelative(latestAlert.created_at)}
            </span>
          )}
        </div>
      </div>
      <div className="row-actions" style={{
        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
        display: "flex", gap: 4, opacity: 0, transition: "opacity var(--fast)",
        background: selected ? "var(--s1)" : "var(--s2)", borderRadius: 8, padding: 4, boxShadow: "var(--sh1)",
      }} onClick={e => e.stopPropagation()}>
        {onHide && <button onClick={onHide} className="btn-ico" title="Hide"><EyeOff size={14} /></button>}
        {onArchive && <button onClick={onArchive} className="btn-ico d" title="Archive"><Archive size={14} /></button>}
        {onRemove && <button onClick={onRemove} className="btn-ico d" title="Remove from tracking" style={{ color: "var(--err)" }}><X size={14} /></button>}
      </div>
    </div>
  );
}

/* ─── RIGHT PANEL: single alert item ────────────────────────────── */
function AlertDetail({ alert, onMarkRead, onOpenCase, caseObj, onClick }) {
  const cfg = eventCfg(alert.event_type);
  const Icon = cfg.icon;
  const days = daysUntil(alert.due_date);
  const isOverdue = days !== null && days < 0;
  const isToday   = days !== null && days === 0;
  const isSoon    = days !== null && days > 0 && days <= 7;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "20px 24px", borderBottom: "1px solid var(--bd)",
        background: alert.is_read ? "var(--soft-blue-bg)" : "var(--s1)",
        opacity: alert.is_read ? 0.82 : 1, transition: "background var(--fast)", cursor: "pointer",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--s2)"}
      onMouseLeave={e => e.currentTarget.style.background = alert.is_read ? "var(--soft-blue-bg)" : "var(--s1)"}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        {/* Soft Icon Ring */}
        <div className={`soft-chip ${cfg.theme}`} style={{ width: 44, height: 44, borderRadius: 12, padding: 0, justifyContent: "center", flexShrink: 0 }}>
          <Icon size={20} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <TypeChip type={alert.event_type} />
            {alert.is_urgent && <span className="soft-chip red micro">URGENT</span>}
            {!alert.is_read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--p)", flexShrink: 0 }} />}
          </div>
          
          <div className="text-body-main" style={{ fontWeight: 600, fontSize: "var(--text-md)", marginBottom: 8, color: "var(--t1)" }}>
            {alert.summary || alert.subject}
          </div>
          
          {/* UPDATED: Removed text-meta, changed to DM Sans, darker color, heavier weight */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontFamily: "var(--fu)", fontSize: "var(--text-xs)", color: "var(--t2)", fontWeight: 500 }}>
            {alert.university_name && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><BookOpen size={14} /> {alert.university_name}</span>}
            {alert.due_date && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: isOverdue ? "var(--err)" : isToday || isSoon ? "var(--warn)" : "inherit", fontWeight: isOverdue || isSoon ? 700 : 500 }}>
                <Clock size={14} /> {isOverdue ? `Overdue ${Math.abs(days)}d` : isToday ? "Due today" : isSoon ? `Due in ${days}d` : fmtDate(alert.due_date)}
              </span>
            )}
            <span>{fmtRelative(alert.created_at)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={(e) => { e.stopPropagation(); onClick?.(); }} className="btn-s"><MailOpen size={14} /> View</button>
          {!alert.is_read && <button onClick={(e) => { e.stopPropagation(); onMarkRead?.(alert.id); }} className="btn-ico" title="Mark as read"><CheckCircle size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

/* ─── ALERT DETAIL MODAL ─────────────────────────────────────────── */
function AlertModal({ alert, caseObj, onClose, onMarkRead, onOpenCase, onOpenCalendar }) {
  const cfg  = eventCfg(alert.event_type);
  const Icon = cfg.icon;
  const days = daysUntil(alert.due_date);
  const emailUrl = alert.sender_email ? `mailto:${alert.sender_email}` : null;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} className="overlay">
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-hdr">
          <div className={`soft-chip ${cfg.theme}`} style={{ width: 40, height: 40, borderRadius: 10, padding: 0, justifyContent: "center" }}><Icon size={18} /></div>
          <div className="modal-title">{alert.subject || alert.summary}</div>
          <button onClick={onClose} className="btn-ico"><X size={18} /></button>
        </div>
        
        <div className="modal-body" style={{ flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
            <TypeChip type={alert.event_type} />
            {alert.is_urgent && <span className="soft-chip red micro">URGENT</span>}
            {alert.sender_email && <span className="soft-chip slate"><Mail size={14} /> {alert.sender_email}</span>}
            {alert.university_name && <span className="soft-chip slate"><BookOpen size={14} /> {alert.university_name}</span>}
            {alert.due_date && <span className={`soft-chip ${days !== null && days <= 7 ? 'orange' : 'slate'}`}><Clock size={14} /> {fmtDate(alert.due_date)}</span>}
          </div>

          {/* AI Summary */}
        {alert.summary && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ 
              fontSize: 10, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase", 
              letterSpacing: ".07em", marginBottom: 6, 
              fontFamily: "var(--fu)" /* <--- ADD THIS */
            }}>AI Summary</div>
              <div className={`soft-chip ${cfg.theme}`} style={{ width: "100%", padding: 16, fontSize: "var(--text-base)", fontWeight: 500, lineHeight: 1.6, display: "block" }}>
                {alert.summary}
              </div>
            </div>
          )}

          {/* Email body */}
        {alert.inbox_events?.body_snippet && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ 
              fontSize: 10, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase", 
              letterSpacing: ".07em", marginBottom: 6, 
              fontFamily: "var(--fu)" /* <--- ADD THIS */
            }}>Original Email</div>
              <div className="text-body-sub" style={{ padding: 16, background: "var(--s1)", border: "1px solid var(--bd)", borderRadius: 12, fontFamily: "var(--fm)", whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto" }}>
                {alert.inbox_events.body_snippet}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, width: "100%", marginTop: 8 }}>
            {alert.due_date && onOpenCalendar && <button onClick={() => { onOpenCalendar(alert.due_date); onClose(); }} className="btn-s"><CalendarClock size={14} /> Add to Calendar</button>}
            {emailUrl && <a href={emailUrl} target="_blank" rel="noopener noreferrer" className="btn-o" style={{ textDecoration: "none" }}><ExternalLink size={14} /> Reply</a>}
            {caseObj && <button onClick={() => { onOpenCase?.(caseObj); onClose(); }} className="btn-s"><ExternalLink size={14} /> View Case</button>}
            {!alert.is_read && <button onClick={() => { onMarkRead?.(alert.id); onClose(); }} className="btn-p" style={{ width: "auto", marginLeft: "auto", padding: "0 20px" }}><CheckCircle size={16} /> Mark as read</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── RIGHT PANEL: full student detail view ──────────────────────── */
const PAGE_SIZE = 10;

function StudentDetailPanel({ studentData, caseMap, inboxMap, onMarkRead, onMarkAllRead, onOpenCase, onOpenCalendar, onConnected, onDisconnect, fetcher = _defaultFetch }) {
  const [activeAlert, setActiveAlert] = useState(null);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [page, setPage] = useState(1);

  // Reset page when student changes
  const prevCaseId = useRef(null);
  useEffect(() => {
    if (studentData?.caseId !== prevCaseId.current) {
      setPage(1);
      prevCaseId.current = studentData?.caseId;
    }
  }, [studentData?.caseId]);

  if (!studentData) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--s2)", border: "1px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Mail size={28} color="var(--t3)" />
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="text-card-title" style={{ marginBottom: 4 }}>Select a student</div>
          <div className="text-body-sub">Pick a student from the list to view their tracking timeline.</div>
        </div>
      </div>
    );
  }

  const { caseId, studentName, caseAlerts } = studentData;
  const caseObj    = caseMap[caseId];
  const inbox      = inboxMap[caseId];
  const hasInbox   = !!inbox;
  const unread     = caseAlerts.filter(a => !a.is_read);
  const urgent     = caseAlerts.filter(a => a.is_urgent && !a.is_read);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "24px", borderBottom: "1px solid var(--bd)", background: "var(--s1)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Avatar name={studentName} size={56} urgent={urgent.length > 0} />
            <div>
              <div className="text-card-title" style={{ fontSize: "var(--text-lg)", marginBottom: 4 }}>{studentName}</div>
              <div className="text-meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: hasInbox ? "var(--ok)" : "var(--t3)" }} />
                {hasInbox ? `Tracking active · ${inbox.forward_address}` : "Tracking not set up"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {caseObj && <button onClick={() => onOpenCase?.(caseObj)} className="btn-s"><ExternalLink size={14} /> Open Case</button>}
            {hasInbox && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowDisconnect(!showDisconnect)} className="btn-ico"><MoreVertical size={16} /></button>
                {showDisconnect && (
                  <div className="alerts-dropdown" style={{ width: 240, padding: 8, right: 0, top: 40 }}>
                    <button onClick={() => { onDisconnect?.(caseId); setShowDisconnect(false); }} className="btn-danger" style={{ width: "100%", justifyContent: "flex-start" }}><WifiOff size={14} /> Stop Tracking</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Actions & Filters */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {urgent.length > 0 && <span className="soft-chip red">⚠ {urgent.length} urgent</span>}
            <span className="soft-chip slate">{caseAlerts.length} total events</span>
          </div>
          {unread.length > 0 && <button onClick={() => onMarkAllRead(caseId)} className="btn-o" style={{ height: 32 }}><MailOpen size={14} /> Mark all read</button>}
        </div>
      </div>

      {/* Alert List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {caseAlerts.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Inbox size={40} color="var(--t3)" style={{ margin: "0 auto 16px", display: "block" }} />
            <div className="text-card-title" style={{ marginBottom: 12 }}>{!hasInbox ? "Tracking not set up" : "No alerts yet"}</div>
            {!hasInbox && caseObj ? (
              <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
                <ForwardingAddressPanel caseId={caseObj.id} onConnected={onConnected} fetcher={fetcher} />
              </div>
            ) : (
              <div className="text-body-sub">Emails forwarded to your secure address will appear here instantly.</div>
            )}
          </div>
        ) : (() => {
          const totalPages = Math.ceil(caseAlerts.length / PAGE_SIZE);
          const pageAlerts = caseAlerts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          return (
            <>
              {pageAlerts.map(alert => <AlertDetail key={alert.id} alert={alert} caseObj={caseObj} onMarkRead={onMarkRead} onOpenCase={onOpenCase} onClick={() => setActiveAlert(alert)} />)}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderTop: "1px solid var(--bd)", background: "var(--s1)", flexShrink: 0 }}>
                  <span className="text-body-sub" style={{ fontFamily: "var(--fu)", fontSize: "var(--text-xs)" }}>
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, caseAlerts.length)} of {caseAlerts.length} emails
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-s" style={{ height: 32, padding: "0 12px", opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setPage(p)} className={p === page ? "btn-p" : "btn-s"} style={{ height: 32, width: 32, padding: 0, fontSize: "var(--text-xs)" }}>{p}</button>
                    ))}
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-s" style={{ height: 32, padding: "0 12px", opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {activeAlert && <AlertModal alert={activeAlert} caseObj={caseObj} onClose={() => setActiveAlert(null)} onMarkRead={(id) => { onMarkRead(id); setActiveAlert(a => a?.id === id ? { ...a, is_read: true } : a); }} onOpenCase={onOpenCase} onOpenCalendar={onOpenCalendar} />}
    </div>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────── */
export default function InboxDashboard({ orgSession, cases = [], onOpenCase, onOpenCalendar, onUnreadChange, authedFetch: _fetch = _defaultFetch }) {
  const [alerts, setAlerts] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [pendingInboxCaseIds, setPendingInboxCaseIds] = useState(new Set());
  const [hiddenCaseIds, setHiddenCaseIds] = useState(() => {
    try { const s = localStorage.getItem("visalens_hidden_cases"); return s ? new Set(JSON.parse(s)) : new Set(); }
    catch { return new Set(); }
  });
  const [archivedCaseIds, setArchivedCaseIds] = useState(() => {
    try { const s = localStorage.getItem("visalens_archived_cases"); return s ? new Set(JSON.parse(s)) : new Set(); }
    catch { return new Set(); }
  });
  const searchRef = useRef(null);
  const [trackingCollapsed, setTrackingCollapsed] = useState(false);
  const [needsSetupCollapsed, setNeedsSetupCollapsed] = useState(false);
  const [hiddenCollapsed, setHiddenCollapsed] = useState(true);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [overflowOpen, setOverflowOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("visalens_hidden_cases", JSON.stringify([...hiddenCaseIds])); } catch {} }, [hiddenCaseIds]);
  useEffect(() => { try { localStorage.setItem("visalens_archived_cases", JSON.stringify([...archivedCaseIds])); } catch {} }, [archivedCaseIds]);
  useEffect(() => {
    // Badge = number of actively tracked students (inboxes connected)
    // When no one is tracked this correctly emits 0
    onUnreadChange?.(inboxes.length);
  }, [inboxes, onUnreadChange]);

  // Proactively keep the session alive while on this page.
  // Fires every 4 minutes — well within the 5-minute warning window in App.jsx.
  // The actual refresh is a no-op if the token still has plenty of time left.
  useEffect(() => {
    // Trigger one fetch immediately so App.jsx's authedFetch can refresh if needed
    _fetch(`${PROXY_URL}/api/inbox/status`).catch(() => {});
    const interval = setInterval(() => {
      _fetch(`${PROXY_URL}/api/inbox/status`).catch(() => {});
    }, 4 * 60 * 1000); // 4 minutes
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const caseMap = useMemo(() => { const m = {}; cases.forEach(c => { m[c.id] = c; }); return m; }, [cases]);
  const inboxMap = useMemo(() => { const m = {}; inboxes.forEach(i => { if (!pendingInboxCaseIds.has(i.case_id)) m[i.case_id] = i; }); return m; }, [inboxes, pendingInboxCaseIds]);

  const loadAlerts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [alertsRes, inboxesRes] = await Promise.all([
        _fetch(`${PROXY_URL}/api/inbox/alerts?limit=500`),
        _fetch(`${PROXY_URL}/api/inbox/status`),
      ]);
      const alertsData = await alertsRes.json();
      const inboxesData = await inboxesRes.json();
      if (!alertsRes.ok) throw new Error(alertsData.error || "Failed to load alerts");
      setAlerts(alertsData.alerts || []); setInboxes(inboxesData.inboxes || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [_fetch]); // Add _fetch to dependencies

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  async function triggerScan() {
    setScanning(true); setPendingInboxCaseIds(new Set());
    try { await loadAlerts(); } catch (e) { setError(e.message); } finally { setScanning(false); }
  }

  async function markRead(alertId) {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true } : a));
    await _fetch(`${PROXY_URL}/api/inbox/mark-read`, { method: "POST", body: JSON.stringify({ alert_ids: [alertId] }) });
  }

  async function markAllReadForCase(caseId) {
    const ids = alerts.filter(a => a.case_id === caseId && !a.is_read).map(a => a.id);
    if (!ids.length) return;
    setAlerts(prev => prev.map(a => ids.includes(a.id) ? { ...a, is_read: true } : a));
    await _fetch(`${PROXY_URL}/api/inbox/mark-read`, { method: "POST", body: JSON.stringify({ alert_ids: ids }) });
  }

  async function disconnectInbox(caseId) {
    try {
      await _fetch(`${PROXY_URL}/api/inbox/disconnect`, { method: "POST", body: JSON.stringify({ case_id: caseId }) });
      setInboxes(prev => prev.filter(i => i.case_id !== caseId));
      setPendingInboxCaseIds(prev => { const s = new Set(prev); s.delete(caseId); return s; });
    } catch (e) { setError(e.message); }
  }

  // Remove inbox from tracking (disconnect but keep case visible in "Needs Setup")
  async function removeCaseFromTracking(caseId) {
    try {
      // If it has an inbox, disconnect it
      if (inboxMap[caseId]) {
        await _fetch(`${PROXY_URL}/api/inbox/disconnect`, { method: "POST", body: JSON.stringify({ case_id: caseId }) });
        setInboxes(prev => prev.filter(i => i.case_id !== caseId));
      }
      // Remove alerts for this case so it drops out of studentGroups and into "Needs Setup"
      setAlerts(prev => prev.filter(a => a.case_id !== caseId));
      // Remove from pending tracking
      setPendingInboxCaseIds(prev => { const s = new Set(prev); s.delete(caseId); return s; });
      // Deselect if this was the selected case
      if (selectedCaseId === caseId) setSelectedCaseId(null);
    } catch (e) { setError(e.message); }
  }

  const tokens = useMemo(() => parseSearchTokens(search), [search]);
  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      if (priorityFilter === "urgent" && !(a.is_urgent && !a.is_read)) return false;
      if (priorityFilter === "unread" && a.is_read) return false;
      if (priorityFilter === "this_week") { const days = daysUntil(a.due_date); if (a.is_read || days === null || days < 0 || days > 7) return false; }
      if (search.trim()) {
        const studentName = (a.cases?.student_name || caseMap[a.case_id]?.studentName || caseMap[a.case_id]?.student_name || "").toLowerCase();
        if (tokens.types.length > 0 && !tokens.types.includes(a.event_type)) return false;
        if (tokens.flags.includes("urgent") && !a.is_urgent) return false;
        if (tokens.flags.includes("unread") && a.is_read) return false;
        if (tokens.text.length > 0) {
          const haystack = [studentName, (a.university_name || "").toLowerCase(), (a.subject || "").toLowerCase(), (a.summary || "").toLowerCase()].join(" ");
          if (!tokens.text.every(t => haystack.includes(t))) return false;
        }
      }
      return true;
    });
  }, [alerts, search, tokens, priorityFilter, caseMap]);

  const studentGroups = useMemo(() => {
    const groupedMap = {};
    for (const a of filteredAlerts) { if (!groupedMap[a.case_id]) groupedMap[a.case_id] = []; groupedMap[a.case_id].push(a); }
    // Only show cases that have an active inbox connection — no inbox = Needs Setup section
    const activeCaseIds = new Set(Object.keys(inboxMap));
    return [...activeCaseIds].filter(caseId => !hiddenCaseIds.has(caseId) && !archivedCaseIds.has(caseId)).map(caseId => {
      const caseAlerts = groupedMap[caseId] || [];
      const studentName = caseAlerts[0]?.cases?.student_name || caseMap[caseId]?.studentName || caseMap[caseId]?.student_name || "Unknown Student";
      return { caseId, caseAlerts, studentName, urgentCount: caseAlerts.filter(a => a.is_urgent && !a.is_read).length, unreadCount: caseAlerts.filter(a => !a.is_read).length, hasInbox: true };
    }).sort((a, b) => {
      if (b.urgentCount !== a.urgentCount) return b.urgentCount - a.urgentCount;
      if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
      return a.studentName.localeCompare(b.studentName);
    });
  }, [filteredAlerts, inboxMap, caseMap, hiddenCaseIds, archivedCaseIds]);

  const connectedCaseIds = useMemo(() => new Set(Object.keys(inboxMap)), [inboxMap]);
  // Unconnected = all cases not in active inboxMap (includes previously disconnected ones with historical alerts)
  const unconnectedCases = useMemo(() => cases.filter(c => !connectedCaseIds.has(c.id) && !hiddenCaseIds.has(c.id) && !archivedCaseIds.has(c.id)), [cases, connectedCaseIds, hiddenCaseIds, archivedCaseIds]);
  const selectedData = useMemo(() => {
    if (!selectedCaseId) return null;
    const fromGroups = studentGroups.find(g => g.caseId === selectedCaseId);
    if (fromGroups) return fromGroups;
    const unconnected = unconnectedCases.find(c => c.id === selectedCaseId);
    if (unconnected) return { caseId: unconnected.id, studentName: unconnected.studentName || unconnected.student_name || "Unknown Student", caseAlerts: [], urgentCount: 0, unreadCount: 0, hasInbox: false };
    return null;
  }, [selectedCaseId, studentGroups, unconnectedCases]);

  useEffect(() => { if (!selectedCaseId && studentGroups.length > 0) setSelectedCaseId(studentGroups[0].caseId); }, [studentGroups, selectedCaseId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxHeight: "calc(100vh - 80px)" }}>
      {/* Top Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 24, flexShrink: 0 }}>
        <div>
          <h1 className="text-page-title" style={{ marginBottom: 4 }}>Inbox Scanner</h1>
          <div className="text-body-sub">Automated university update tracking</div>
        </div>
        <button onClick={triggerScan} disabled={scanning || loading} className="btn-p" style={{ width: "auto", padding: "0 20px" }}>
          <RefreshCw size={16} className={scanning ? "spin" : ""} /> {scanning ? "Syncing..." : "Sync Inbox"}
        </button>
      </div>

      {error && <div className="err-banner"><AlertCircle size={16} />{error}<button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}><X size={14} /></button></div>}

      {/* Split Pane */}
      <div className="panel-modern" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* LEFT PANE */}
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--bd)", background: "var(--s2)" }}>
          {/* Search */}
          <div style={{ padding: 16, borderBottom: "1px solid var(--bd)", background: "var(--s1)" }}>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <Search size={14} color="var(--t3)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students, uni..." style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 8, border: "1px solid var(--bd)", fontSize: "var(--text-base)", outline: "none" }} />
            </div>
            {/* Priority Rail moved inside left pane */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[ { id: "all", label: "All" }, { id: "urgent", label: "Urgent" }, { id: "this_week", label: "Soon" }, { id: "unread", label: "Unread" } ].map(f => (
                <button key={f.id} onClick={() => setPriorityFilter(f.id)} style={{
                  justifyContent: "center", padding: "8px", borderRadius: 8,
                  border: priorityFilter === f.id ? "none" : "1px solid var(--bd)",
                  background: priorityFilter === f.id ? "var(--soft-purple-bg)" : "var(--s1)",
                  color: priorityFilter === f.id ? "var(--soft-purple-txt)" : "var(--t2)",
                  fontWeight: priorityFilter === f.id ? 700 : 500,
                  fontSize: "var(--text-xs)", cursor: "pointer", fontFamily: "var(--fu)",
                  display: "flex", alignItems: "center",
                }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>



          {/* List — primary scroll: Inbox Tracking + Needs Setup with sticky headers */}
          <div style={{ flex: 1, overflowY: "auto", background: "var(--s1)", position: "relative" }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center" }}><Loader2 size={24} className="spin" style={{ color: "var(--t3)", margin: "0 auto" }} /></div>
            ) : (
              <>
                {studentGroups.length === 0 && hiddenCaseIds.size === 0 && archivedCaseIds.size === 0 && unconnectedCases.length === 0 && (
                  <div style={{ padding: 40, textAlign: "center" }}><Filter size={24} color="var(--t3)" style={{ margin: "0 auto 12px" }} /><div className="text-body-sub">No students found</div></div>
                )}

                {/* ── INBOX TRACKING — sticky header ── */}
                {studentGroups.length > 0 && (
                  <div
                    onClick={() => setTrackingCollapsed(p => !p)}
                    style={{ position: "sticky", top: 0, zIndex: 10, padding: "10px 16px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", background: "#5A23B9", color: "#fff", borderBottom: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "var(--text-xs)", fontFamily: "var(--fu)" }}
                  >
                    <span>Inbox Tracking ({studentGroups.length})</span>
                    <ChevronRight size={14} style={{ transform: trackingCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.2s", color: "rgba(255,255,255,0.8)", flexShrink: 0 }} />
                  </div>
                )}
                {!trackingCollapsed && studentGroups.map(g => <StudentRow
                  key={g.caseId}
                  {...g}
                  selected={selectedCaseId === g.caseId}
                  onClick={() => setSelectedCaseId(g.caseId)}
                  onHide={() => setHiddenCaseIds(prev => new Set([...prev, g.caseId]))}
                  onArchive={() => setArchivedCaseIds(prev => new Set([...prev, g.caseId]))}
                  onRemove={g.hasInbox ? () => removeCaseFromTracking(g.caseId) : undefined}
                />)}

                {/* ── NEEDS SETUP — sticky header ── */}
                {unconnectedCases.length > 0 && (
                  <>
                    <div
                      onClick={() => setNeedsSetupCollapsed(p => !p)}
                      style={{ position: "sticky", top: 0, zIndex: 10, padding: "10px 16px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", background: "#5A23B9", color: "#fff", borderTop: studentGroups.length > 0 ? "1px solid rgba(255,255,255,0.15)" : "none", borderBottom: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "var(--text-xs)", fontFamily: "var(--fu)" }}
                    >
                      <span>Needs Setup ({unconnectedCases.length})</span>
                      <ChevronRight size={14} style={{ transform: needsSetupCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.2s", color: "rgba(255,255,255,0.8)", flexShrink: 0 }} />
                    </div>
                    {!needsSetupCollapsed && unconnectedCases.map(c => <StudentRow key={c.id} caseId={c.id} studentName={c.studentName || c.student_name || "Unknown"} caseAlerts={[]} hasInbox={false} selected={selectedCaseId === c.id} onClick={() => setSelectedCaseId(c.id)} urgentCount={0} unreadCount={0} />)}
                  </>
                )}
              </>
            )}
          </div>

          {/* ── OVERFLOW FOOTER: Hidden + Archived ── */}
          {(hiddenCaseIds.size > 0 || archivedCaseIds.size > 0) && !search && priorityFilter === "all" && (
            <div style={{ borderTop: "1px solid var(--bd)", flexShrink: 0 }}>
              <button
                onClick={() => setOverflowOpen(p => !p)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#5A23B9", border: "none", cursor: "pointer", fontFamily: "var(--fu)", fontSize: "var(--text-xs)", fontWeight: 600, color: "#fff" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <MoreVertical size={13} />
                  {[hiddenCaseIds.size > 0 && `${hiddenCaseIds.size} hidden`, archivedCaseIds.size > 0 && `${archivedCaseIds.size} archived`].filter(Boolean).join(" · ")}
                </span>
                <ChevronRight size={13} style={{ transform: overflowOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", color: "rgba(255,255,255,0.8)" }} />
              </button>

              {overflowOpen && (
                <div style={{ maxHeight: 260, overflowY: "auto", background: "var(--s1)" }}>
                  {hiddenCaseIds.size > 0 && (
                    <>
                      <div style={{ padding: "8px 16px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)", fontFamily: "var(--fu)", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--bd)" }}>
                        <EyeOff size={11} /> Hidden ({hiddenCaseIds.size})
                      </div>
                      {[...hiddenCaseIds].map(id => (
                        <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--bd)", background: "var(--s2)" }}>
                          <Avatar name={caseMap[id]?.studentName || caseMap[id]?.student_name || "Student"} size={32} />
                          <span className="text-body-main" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{caseMap[id]?.studentName || caseMap[id]?.student_name || "Hidden Student"}</span>
                          <button onClick={() => setHiddenCaseIds(prev => { const s = new Set(prev); s.delete(id); return s; })} className="btn-s" style={{ height: 24, padding: "0 8px", fontSize: 10, flexShrink: 0 }}>Show</button>
                        </div>
                      ))}
                    </>
                  )}
                  {archivedCaseIds.size > 0 && (
                    <>
                      <div style={{ padding: "8px 16px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)", fontFamily: "var(--fu)", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--bd)", borderTop: hiddenCaseIds.size > 0 ? "1px solid var(--bd)" : "none" }}>
                        <Archive size={11} /> Archived ({archivedCaseIds.size})
                      </div>
                      {[...archivedCaseIds].map(id => (
                        <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--bd)", background: "var(--s2)", opacity: 0.7 }}>
                          <Avatar name={caseMap[id]?.studentName || caseMap[id]?.student_name || "Student"} size={32} />
                          <span className="text-body-main" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{caseMap[id]?.studentName || caseMap[id]?.student_name || "Archived Student"}</span>
                          <button onClick={() => setArchivedCaseIds(prev => { const s = new Set(prev); s.delete(id); return s; })} className="btn-s" style={{ height: 24, padding: "0 8px", fontSize: 10, flexShrink: 0 }}>Restore</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANE */}
        <StudentDetailPanel studentData={selectedData} caseMap={caseMap} inboxMap={inboxMap} onMarkRead={markRead} onMarkAllRead={markAllReadForCase} onOpenCase={onOpenCase} onOpenCalendar={onOpenCalendar} onConnected={(id) => setPendingInboxCaseIds(prev => new Set([...prev, id]))} onDisconnect={disconnectInbox} fetcher={_fetch} />
      </div>
    </div>
  );
}
