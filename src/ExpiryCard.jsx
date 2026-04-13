import { useState, useEffect, useRef } from 'react';
import {
  Clock, ChevronDown, AlertTriangle, CheckCircle, X, Sparkles, UserCheck,
  ShieldCheck, FileText, BookOpen, Globe, BadgeCheck, Fingerprint,
  Languages, FileBadge, FileWarning, Microscope
} from 'lucide-react';

// ─── DOC TYPE REGISTRY ────────────────────────────────────────────────────────
const DOC_TYPES = [
  {
    key: "passport",
    label: "Passport",
    icon: Globe,
    color: "#1D6BE8",
    extractFn: (p) => parseToISO(p?.passportExpiry),
  },
  {
    key: "cnic",
    label: "CNIC / National ID",
    icon: Fingerprint,
    color: "#7C3AED",
    extractFn: (p) => parseToISO(p?.cnicExpiry),
  },
  {
    key: "ielts",
    label: "IELTS",
    icon: Languages,
    color: "#0891B2",
    extractFn: (p) => {
      const test = (p?.englishTests || []).find(t =>
        t.type && t.type.toLowerCase().includes("ielts") && t.testDate
      );
      return test ? addYears(parseToISO(test.testDate), 2) : null;
    },
  },
  {
    key: "toefl",
    label: "TOEFL / PTE / Duolingo",
    icon: BookOpen,
    color: "#0891B2",
    extractFn: (p) => {
      const test = (p?.englishTests || []).find(t =>
        t.type && (
          t.type.toLowerCase().includes("toefl") ||
          t.type.toLowerCase().includes("pte") ||
          t.type.toLowerCase().includes("duolingo")
        ) && t.testDate
      );
      return test ? addYears(parseToISO(test.testDate), 2) : null;
    },
  },
  {
    key: "offerLetter",
    label: "Offer Letter",
    icon: FileBadge,
    color: "#059669",
    extractFn: (_p) => null,
  },
  {
    key: "cas",
    label: "CAS",
    icon: BadgeCheck,
    color: "#D97706",
    extractFn: (p) => {
      const doc = (p?.casDocuments || []).find(d =>
        d.type && d.type.toUpperCase().includes("CAS") &&
        !d.type.toUpperCase().includes("PRE") &&
        d.expiryDate
      );
      return doc ? parseToISO(doc.expiryDate) : null;
    },
  },
  {
    key: "preCas",
    label: "Pre-CAS",
    icon: FileWarning,
    color: "#D97706",
    extractFn: (p) => {
      const doc = (p?.casDocuments || []).find(d =>
        d.type && d.type.toUpperCase().includes("PRE") && d.expiryDate
      );
      return doc ? parseToISO(doc.expiryDate) : null;
    },
  },
  {
    key: "policeClearance",
    label: "Police Clearance",
    icon: ShieldCheck,
    color: "#4A5D7E",
    extractFn: (p) => {
      const doc = (p?.detectedDocs || []).find(d =>
        d.type && d.type.toLowerCase().includes("police") && d.expiry
      );
      return doc ? parseToISO(doc.expiry) : null;
    },
  },
  {
    key: "medicalTb",
    label: "TB / Medical Test",
    icon: Microscope,
    color: "#BE185D",
    extractFn: (p) => {
      const doc = (p?.detectedDocs || []).find(d =>
        d.type && (
          d.type.toLowerCase().includes("tb") ||
          d.type.toLowerCase().includes("medical") ||
          d.type.toLowerCase().includes("ihs")
        ) && d.expiry
      );
      return doc ? parseToISO(doc.expiry) : null;
    },
  },
];

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function parseToISO(str) {
  if (!str || str === "Not found" || str.trim() === "") return null;
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const m = months[dmy[2].toLowerCase().slice(0,3)];
    if (m) return `${dmy[3]}-${String(m).padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  }
  const dotSlash = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dotSlash) {
    return `${dotSlash[3]}-${dotSlash[2].padStart(2,"0")}-${dotSlash[1].padStart(2,"0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function addYears(isoStr, years) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function urgencyStyle(days) {
  if (days === null) return { color: "var(--t3)", bg: "transparent", bd: "transparent" };
  if (days < 0)      return { color: "#DC2626", bg: "rgba(220,38,38,.08)",  bd: "rgba(220,38,38,.25)"  };
  if (days <= 7)     return { color: "#EA580C", bg: "rgba(234,88,12,.08)",  bd: "rgba(234,88,12,.25)"  };
  if (days <= 30)    return { color: "#D97706", bg: "rgba(217,119,6,.08)",  bd: "rgba(217,119,6,.25)"  };
  return               { color: "#059669", bg: "rgba(5,150,105,.08)", bd: "rgba(5,150,105,.25)" };
}

function daysLabel(days) {
  if (days === null) return "";
  if (days < 0)      return `Expired ${Math.abs(days)}d ago`;
  if (days === 0)    return "Expires today";
  if (days === 1)    return "1 day left";
  return `${days} days left`;
}

// ─── STAT CARD THEMES ─────────────────────────────────────────────────────────
const STAT_THEMES = [
  { bg: "#F97316" }, // orange  — expired
  { bg: "#EC4899" }, // pink    — critical (≤7d)
  { bg: "#6366F1" }, // indigo  — soon (≤30d)
  { bg: "#06B6D4" }, // cyan    — all tracked
];

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ theme, icon: Icon, label, value, sub }) {
  return (
    <div className="expiry-stat-card" style={{ background: theme.bg }}>
      <div className="expiry-stat-card__top">
        <span className="expiry-stat-card__label">{label}</span>
        <div className="expiry-stat-card__icon">
          <Icon size={17} color="#fff" strokeWidth={2.2} />
        </div>
      </div>
      <div className="expiry-stat-card__value">{value}</div>
      <div className="expiry-stat-card__sub">{sub}</div>
    </div>
  );
}

// ─── EXPORTED HELPERS ─────────────────────────────────────────────────────────
export function extractAiDates(profileData) {
  const result = {};
  for (const { key, extractFn } of DOC_TYPES) {
    const d = extractFn(profileData);
    if (d) result[key] = d;
  }
  return result;
}

export function computeSoonestExpiry(expiryDates, profileData) {
  const aiDates = profileData ? extractAiDates(profileData) : {};
  let soonest = null;
  let soonestType = null;
  for (const { key, label } of DOC_TYPES) {
    const d = expiryDates?.[key] || aiDates[key];
    if (!d) continue;
    const date = new Date(d);
    if (isNaN(date.getTime())) continue;
    if (!soonest || date < soonest) { soonest = date; soonestType = label; }
  }
  return {
    expiry_date:     soonest ? soonest.toISOString().split("T")[0] : null,
    expiry_doc_type: soonestType,
  };
}

// ─── UNIFIED DOCUMENT SCORE ───────────────────────────────────────────────────
// Shared with StudentDashboard.jsx — single source of truth in ./docScore.js
export { computeDocScore } from './docScore';

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ExpiryCard({ profileData, expiryDates, setExpiryDates, onDirty }) {
  const [collapsed, setCollapsed] = useState(false);
  const [aiDates, setAiDates] = useState({});
  const prevProfileRef = useRef(null);

  useEffect(() => {
    if (profileData === prevProfileRef.current) return;
    prevProfileRef.current = profileData;
    const extracted = {};
    for (const { key, extractFn } of DOC_TYPES) {
      const d = extractFn(profileData);
      if (d) extracted[key] = d;
    }
    setAiDates(extracted);
  }, [profileData]);

  const overrides = expiryDates || {};

  function effectiveDate(key) { return overrides[key] || aiDates[key] || ""; }
  function sourceOf(key) {
    if (overrides[key]) return "override";
    if (aiDates[key])   return "ai";
    return "none";
  }
  function handleChange(key, value) {
    const updated = { ...overrides };
    if (value) { updated[key] = value; } else { delete updated[key]; }
    setExpiryDates(updated);
    onDirty?.();
  }
  function clearOverride(key) {
    const updated = { ...overrides };
    delete updated[key];
    setExpiryDates(updated);
    onDirty?.();
  }

  // ── Stats ──
  const allDays = DOC_TYPES.map(({ key }) => daysUntil(effectiveDate(key)));
  const expired  = allDays.filter(d => d !== null && d < 0).length;
  const critical = allDays.filter(d => d !== null && d >= 0 && d <= 7).length;
  const soon     = allDays.filter(d => d !== null && d > 7 && d <= 30).length;
  const tracked  = allDays.filter(d => d !== null).length;
  const urgents  = expired + critical;

  const headerBadge = urgents > 0
    ? { text: `${urgents} expiring`, urgent: true }
    : tracked > 0
    ? { text: `${tracked} tracked`, urgent: false }
    : null;

  return (
    <div className="rc rc-expiry" style={{ marginTop: 12 }}>

      {/* ── Header ── */}
      <button
        className={`rc-hdr--btn rc-hdr--orange${collapsed ? " collapsed" : ""}`}
        onClick={() => setCollapsed(c => !c)}
        style={{ borderRadius: collapsed ? "var(--r2)" : "var(--r2) var(--r2) 0 0" }}
      >
        <div className="rc-ico"><Clock size={14} color="#fff" /></div>
        <span className="rc-ttl">Document Expiry Radar</span>
        {headerBadge && (
          <span className={`expiry-header-badge ${headerBadge.urgent ? "expiry-header-badge--urgent" : "expiry-header-badge--tracked"}`}>
            {headerBadge.text}
          </span>
        )}
        <ChevronDown size={14} color="rgba(255,255,255,0.7)"
          style={{ marginLeft: "auto", transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform .2s" }} />
      </button>

      {!collapsed && (
        <div className="rc-body" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── STAT CARDS ── */}
          <div className="expiry-stat-row">
            <StatCard
              theme={STAT_THEMES[0]}
              icon={AlertTriangle}
              label="Expired"
              value={expired}
              sub={expired === 0 ? "None expired" : `${expired} past due`}
            />
            <StatCard
              theme={STAT_THEMES[1]}
              icon={Clock}
              label="Critical"
              value={critical}
              sub={critical === 0 ? "None critical" : "Within 7 days"}
            />
            <StatCard
              theme={STAT_THEMES[2]}
              icon={FileText}
              label="Due Soon"
              value={soon}
              sub={soon === 0 ? "All clear" : "Within 30 days"}
            />
            <StatCard
              theme={STAT_THEMES[3]}
              icon={CheckCircle}
              label="Tracked"
              value={tracked}
              sub={`of ${DOC_TYPES.length} documents`}
            />
          </div>

          {/* ── Helper text ── */}
          <p className="expiry-hint">
            Dates auto-filled from extracted documents.{" "}
            <span className="expiry-hint__ai">AI</span> = extracted automatically ·{" "}
            <span className="expiry-hint__override">Override</span> = counsellor-set · edit any field to override.
          </p>

          {/* ── DOC ROWS ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {DOC_TYPES.map(({ key, label, icon: DocIcon, color }) => {
              const val    = effectiveDate(key);
              const source = sourceOf(key);
              const days   = daysUntil(val);
              const style  = urgencyStyle(days);
              const hasVal = !!val;

              return (
                <div key={key} className="expiry-doc-row" style={{
                  background: hasVal ? style.bg : "var(--s2)",
                  border: `1px solid ${hasVal ? style.bd : "var(--bd)"}`,
                }}>
                  {/* Icon + label + badge */}
                  <div className="expiry-doc-row__left">
                    <div className="expiry-doc-row__icon" style={{
                      background: hasVal ? `${style.color}1A` : "var(--s3)",
                      border: `1px solid ${hasVal ? `${style.color}40` : "var(--bd)"}`,
                    }}>
                      <DocIcon size={12} color={hasVal ? style.color : color} strokeWidth={2.2} />
                    </div>
                    <span className="expiry-doc-row__label" style={{ color: hasVal ? style.color : "var(--t1)" }}>
                      {label}
                    </span>
                    {source === "ai" && (
                      <span className="expiry-source-badge expiry-source-badge--ai" title="Auto-filled from extracted document">
                        <Sparkles size={7} />AI
                      </span>
                    )}
                    {source === "override" && (
                      <span className="expiry-source-badge expiry-source-badge--override" title="Counsellor override — manually set">
                        <UserCheck size={7} />Override
                      </span>
                    )}
                  </div>

                  {/* Date input */}
                  <input
                    type="date"
                    value={val}
                    onChange={e => handleChange(key, e.target.value)}
                    title={
                      source === "ai"       ? "Auto-filled. Edit to override." :
                      source === "override" ? "Override. Clear (×) to revert to AI date." :
                                              "Enter expiry date"
                    }
                    className="expiry-date-input"
                  />

                  {/* Status + clear */}
                  <div className="expiry-doc-row__status">
                    {hasVal ? (
                      <>
                        <span className="expiry-status-txt" style={{ color: style.color }}>
                          {daysLabel(days)}
                        </span>
                        {source === "override" && (
                          <button
                            onClick={() => clearOverride(key)}
                            title={aiDates[key] ? "Remove override — revert to AI date" : "Clear date"}
                            className="expiry-clear-btn"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="expiry-not-set">Not set</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Footer summary ── */}
          {tracked > 0 && (
            <div className={`expiry-footer ${urgents > 0 ? "expiry-footer--warn" : "expiry-footer--ok"}`}>
              {urgents > 0
                ? <><AlertTriangle size={12} style={{ flexShrink: 0 }} />{urgents} document{urgents !== 1 ? "s" : ""} expiring soon — save to trigger alerts</>
                : <><CheckCircle size={12} style={{ flexShrink: 0 }} />{tracked} document{tracked !== 1 ? "s" : ""} tracked · all clear</>
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}