/**
 * AlertsPage — Counsellor-facing policy alerts view
 * ─────────────────────────────────────────────────
 * Fetches active policy_alerts for this org from Supabase,
 * then cross-references each alert's affected_countries against
 * the cases table to show which students are impacted.
 *
 * Props:
 *   onOpenCase(caseObj) — called when counsellor clicks a student row
 */

import { useState, useEffect, useRef } from 'react';
import {
  Bell, AlertTriangle, CheckCircle, Globe, ChevronDown,
  ChevronUp, ExternalLink, User, Clock, Info, X, RefreshCw,
  ShieldAlert, Loader2
} from 'lucide-react';

/* ─── SEVERITY CONFIG ────────────────────────────────────────── */
const SEV = {
  high:   { label: "High",   color: "#DC2626", bg: "var(--s1)", bd: "rgba(220,38,38,.22)",  icon: AlertTriangle },
  medium: { label: "Medium", color: "#D97706", bg: "var(--s1)", bd: "var(--bd)",             icon: Info          },
  low:    { label: "Low",    color: "#059669", bg: "var(--s1)", bd: "var(--bd)",             icon: CheckCircle   },
};

function fmt(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

/* ─── AFFECTED CASES PANEL ───────────────────────────────────── */
function AffectedCases({ alert, allCases, onOpenCase }) {
  const affected = allCases.filter(c => {
    if (!c.target_country) return false;
    return alert.affected_countries?.some(
      ac => ac.toLowerCase().trim() === c.target_country.toLowerCase().trim()
    );
  });

  if (affected.length === 0) {
    return (
      <div style={{
        padding: "12px 16px", fontSize: 12, color: "var(--t3)",
        borderTop: "1px solid var(--bd)", background: "var(--s2)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <User size={12} />
        No cases currently targeting {alert.affected_countries?.join(", ") || "these countries"}.
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--bd)", background: "var(--s2)" }}>
      <div style={{
        padding: "8px 16px", fontSize: 11, fontWeight: 700,
        color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <User size={11} />
        {affected.length} affected student{affected.length !== 1 ? "s" : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {affected.map((c, i) => {
          const days = daysUntilExpiry(c.expiry_date);
          const isLast = i === affected.length - 1;
          return (
            <div
              key={c.id}
              onClick={() => onOpenCase(c)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                borderBottom: isLast ? "none" : "1px solid var(--bd)",
                cursor: "pointer",
                transition: "background .12s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--s3)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}
            >
              {/* Student info */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--t1)" }}>
                  {c.student_name || "Unnamed"}
                  {c.case_serial && (
                    <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 7, fontWeight: 400 }}>
                      {c.case_serial}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span>
                    <Globe size={9} style={{ marginRight: 3, verticalAlign: "middle" }} />
                    {c.target_country}
                  </span>
                  {c.counsellor_name && <span>· {c.counsellor_name}</span>}
                </div>
              </div>

              {/* Expiry badge if set */}
              {c.expiry_date && (
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    color: days !== null && days < 0 ? "#DC2626"
                         : days !== null && days <= 30 ? "#D97706"
                         : "var(--t2)",
                  }}>
                    {days !== null && days < 0  ? `Expired ${Math.abs(days)}d ago`
                   : days !== null && days === 0 ? "Expires today"
                   : days !== null               ? `${days}d left`
                   : ""}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--t3)" }}>
                    {c.expiry_doc_type || "Soonest doc"}
                  </div>
                </div>
              )}

              {/* Open arrow */}
              <div style={{
                fontSize: 10, fontWeight: 700, padding: "3px 9px",
                borderRadius: 5, background: "var(--pg)", color: "var(--p)",
                border: "1px solid rgba(29,107,232,.2)", whiteSpace: "nowrap",
              }}>
                Open →
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── ALERT CARD ─────────────────────────────────────────────── */
function AlertCard({ alert, allCases, onOpenCase }) {
  const [expanded, setExpanded] = useState(alert.severity === "high");
  const sev = SEV[alert.severity] || SEV.medium;
  const SevIcon = sev.icon;

  const affectedCount = allCases.filter(c =>
    c.target_country && alert.affected_countries?.some(
      ac => ac.toLowerCase().trim() === c.target_country.toLowerCase().trim()
    )
  ).length;

  const isExpired = alert.expires_at && new Date(alert.expires_at) < new Date();

  return (
    <div style={{
      background: "var(--s1)",
      border: `1px solid ${sev.bd}`,
      borderLeft: `4px solid ${sev.color}`,
      borderRadius: "var(--r2)",
      overflow: "hidden",
      boxShadow: "var(--sh1)",
      animation: "fadeUp var(--slow) var(--eout) both",
    }}>
      {/* Card header — clickable to expand */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: "14px 16px",
          background: "var(--s2)",
          cursor: "pointer",
          display: "flex", alignItems: "flex-start", gap: 12,
          transition: "background .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.filter = "brightness(.97)"}
        onMouseLeave={e => e.currentTarget.style.filter = ""}
      >
        {/* Icon */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: `${sev.color}18`,
          border: `1px solid ${sev.color}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <SevIcon size={15} color={sev.color} />
        </div>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--t1)" }}>{alert.title}</span>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 99,
              background: sev.bg, color: sev.color,
              border: `1px solid ${sev.bd}`,
              textTransform: "uppercase", letterSpacing: ".06em",
            }}>{sev.label}</span>
            {isExpired && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                background: "var(--s3)", color: "var(--t3)", border: "1px solid var(--bd)",
              }}>Expired</span>
            )}
          </div>

          {/* Countries + case count */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {alert.affected_countries?.map(c => (
              <span key={c} style={{
                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                background: "rgba(29,107,232,.08)", color: "#1D6BE8",
                border: "1px solid rgba(29,107,232,.2)",
              }}>
                <Globe size={9} style={{ marginRight: 3, verticalAlign: "middle" }} />{c}
              </span>
            ))}
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
              background: affectedCount > 0 ? "rgba(220,38,38,.1)" : "var(--s3)",
              color: affectedCount > 0 ? "#DC2626" : "var(--t3)",
              border: `1px solid ${affectedCount > 0 ? "rgba(220,38,38,.25)" : "var(--bd)"}`,
            }}>
              {affectedCount} student{affectedCount !== 1 ? "s" : ""} affected
            </span>
            <span style={{ fontSize: 11, color: "var(--t3)", marginLeft: 2 }}>
              · {fmt(alert.created_at)}
              {alert.created_by ? ` · ${alert.created_by}` : ""}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <div style={{ color: "var(--t3)", flexShrink: 0, marginTop: 6 }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <>
          {/* Description */}
          <div style={{ padding: "14px 16px 10px", borderTop: `1px solid ${sev.bd}` }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--t2)", lineHeight: 1.6 }}>
              {alert.detail}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              {alert.expires_at && (
                <span style={{ fontSize: 11, color: isExpired ? "#DC2626" : "var(--t3)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} />
                  {isExpired ? "Expired" : "Expires"} {fmt(alert.expires_at)}
                </span>
              )}
              {alert.source_url && (
                <a
                  href={alert.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: "var(--p)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                >
                  <ExternalLink size={11} /> View source
                </a>
              )}
            </div>
          </div>

          {/* Affected cases */}
          <AffectedCases alert={alert} allCases={allCases} onOpenCase={onOpenCase} />
        </>
      )}
    </div>
  );
}

/* ─── MAIN ALERTS PAGE ───────────────────────────────────────── */
export default function AlertsPage({ onOpenCase }) {
  const [alerts,   setAlerts]   = useState([]);
  const [cases,    setCases]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("all"); // "all" | "high" | "medium" | "low"
  const [error,    setError]    = useState(null);

  const sb = window._supabaseInstance;

  function getOrgSession() {
    try {
      const raw = sessionStorage.getItem("visalens_org_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function load() {
    setLoading(true); setError(null);
    const session = getOrgSession();
    if (!session?.org_id || !sb) { setLoading(false); return; }

    try {
      // Fetch active alerts for this org
      const { data: alertData, error: ae } = await sb
        .from("policy_alerts")
        .select("*")
        .eq("org_id", session.org_id)
        .eq("is_active", true)
        .neq("status", "archived")
        .order("severity", { ascending: true }) // high first (alphabetically h < l < m — use custom sort below)
        .order("created_at", { ascending: false });

      if (ae) throw ae;

      // Sort: high → medium → low
      const sevOrder = { high: 0, medium: 1, low: 2 };
      const sorted = (alertData || []).filter(a => {
        // Filter out expired alerts that have an expiry date
        if (a.expires_at && new Date(a.expires_at) < new Date()) return false;
        return true;
      }).sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));

      setAlerts(sorted);

      // Fetch all cases for this org (just the fields we need for matching)
      const { data: caseData, error: ce } = await sb
        .from("cases")
        .select("id, case_serial, student_name, counsellor_name, target_country, expiry_date, expiry_doc_type, profile_data")
        .eq("org_id", session.org_id);

      if (ce) throw ce;
      setCases(caseData || []);
    } catch (e) {
      setError(e.message || "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = filter === "all"
    ? alerts
    : alerts.filter(a => a.severity === filter);

  const counts = {
    high:   alerts.filter(a => a.severity === "high").length,
    medium: alerts.filter(a => a.severity === "medium").length,
    low:    alerts.filter(a => a.severity === "low").length,
  };

  // Total uniquely affected cases across all alerts
  const totalAffectedIds = new Set(
    alerts.flatMap(alert =>
      cases
        .filter(c => c.target_country && alert.affected_countries?.some(
          ac => ac.toLowerCase().trim() === c.target_country.toLowerCase().trim()
        ))
        .map(c => c.id)
    )
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: "1.4rem", fontWeight: 800,
            letterSpacing: "-.02em", color: "var(--t1)",
            fontFamily: "var(--fh)",
          }}>
            Policy <em style={{ color: "var(--p)", fontStyle: "normal" }}>Alerts</em>
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--t3)" }}>
            Live policy changes from your agency admin — check which students are affected.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 13px", borderRadius: "var(--r1)",
            background: "var(--s2)", border: "1px solid var(--bd)",
            color: "var(--t2)", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          <RefreshCw size={12} style={loading ? { animation: "spin .7s linear infinite" } : {}} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--r1)",
          background: "var(--errg)", border: "1px solid rgba(220,38,38,.25)",
          color: "var(--err)", fontSize: 13, display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertTriangle size={14} />{error}
        </div>
      )}

      {loading ? (
        <div style={{
          padding: "40px 20px", textAlign: "center",
          background: "var(--s2)", borderRadius: "var(--r2)",
          border: "1px solid var(--bd)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          color: "var(--t2)", fontSize: 13,
        }}>
          <Loader2 size={16} style={{ animation: "spin .7s linear infinite" }} />
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div style={{
          padding: "50px 20px", textAlign: "center",
          background: "var(--s2)", borderRadius: "var(--r2)", border: "1px solid var(--bd)",
        }}>
          <Bell size={32} color="var(--t3)" style={{ display: "block", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t2)" }}>No active alerts</div>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>
            Your agency admin hasn't published any policy alerts yet.
          </div>
        </div>
      ) : (
        <>
          {/* ── Summary stat cards ── */}
          <div className="expiry-stat-row">
            {[
              { bg: "#DC2626", label: "High Priority", value: counts.high,   sub: counts.high === 0   ? "None" : "Urgent action needed"  },
              { bg: "#D97706", label: "Medium",         value: counts.medium, sub: counts.medium === 0 ? "None" : "Review soon"           },
              { bg: "#059669", label: "Low / Info",     value: counts.low,    sub: counts.low === 0    ? "None" : "For awareness"         },
              { bg: "#6366F1", label: "Cases Affected", value: totalAffectedIds.size, sub: `across ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}` },
            ].map(({ bg, label, value, sub }) => (
              <div key={label} className="expiry-stat-card" style={{ background: bg }}>
                <div className="expiry-stat-card__top">
                  <span className="expiry-stat-card__label">{label}</span>
                  <div className="expiry-stat-card__icon">
                    <ShieldAlert size={17} color="#fff" strokeWidth={2.2} />
                  </div>
                </div>
                <div className="expiry-stat-card__value">{value}</div>
                <div className="expiry-stat-card__sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Filter pills ── */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { id: "all",    label: "All alerts",  count: alerts.length,  color: "var(--p)"  },
              { id: "high",   label: "High",        count: counts.high,    color: "#DC2626"   },
              { id: "medium", label: "Medium",      count: counts.medium,  color: "#D97706"   },
              { id: "low",    label: "Low",         count: counts.low,     color: "#059669"   },
            ].map(({ id, label, count, color }) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", transition: "all .15s",
                  border: `1px solid ${filter === id ? color : "var(--bd)"}`,
                  background: filter === id ? `${color}20` : "var(--s2)",
                  color: filter === id ? color : "var(--t2)",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {label}
                <span style={{
                  background: filter === id ? color : "var(--s3)",
                  color: filter === id ? "#fff" : "var(--t3)",
                  borderRadius: 99, padding: "1px 6px", fontSize: 10, fontWeight: 800,
                }}>{count}</span>
              </button>
            ))}
          </div>

          {/* ── Alert cards ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: "30px 20px", textAlign: "center", color: "var(--t3)",
                background: "var(--s2)", borderRadius: "var(--r2)", border: "1px solid var(--bd)", fontSize: 13,
              }}>
                No {filter} alerts.
              </div>
            ) : filtered.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                allCases={cases}
                onOpenCase={onOpenCase}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
