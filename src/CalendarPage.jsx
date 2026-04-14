/**
 * VisaLens — Calendar Page
 * ─────────────────────────────────────────────────────────────────
 * Split-pane calendar. Left: month grid with event dots.
 * Right: day detail panel showing all events for selected day.
 *
 * Event sources:
 *   • Inbox alerts with due_date (deadlines, interviews, CAS, offers)
 *   • Case document expiries (passport, visa)
 *   • Application intake targets (intakeYear + intakeSeason)
 *
 * Props:
 *   cases      – loaded + scoped case summaries from App.jsx
 *   orgSession – session object
 *   onOpenCase – (caseObj) => void
 * ─────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Calendar, Clock, GraduationCap,
  FileText, ShieldAlert, AlertTriangle, Award, CalendarClock,
  Info, Mail, Loader2, ExternalLink, BookOpen, User, Inbox,
  Plus, X, Archive, ChevronDown, Bell, Check, Sparkles,
  ClipboardList, MessageSquare,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { chatBridge } from './App';

/* ─── Supabase singleton (reuse App's instance if available) ─────── */
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
const supabase = window._supabaseInstance;

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "https://visalens-proxy.ijecloud.workers.dev";

/* ─── session helpers ────────────────────────────────────────────── */
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

/* ─── event type config ──────────────────────────────────────────── */
const EVENT_CONFIG = {
  offer_letter:  { label: "Offer Letter",   icon: GraduationCap, color: "#22C55E", bg: "rgba(34,197,94,.12)",   border: "rgba(34,197,94,.3)"   },
  cas:           { label: "CAS",            icon: FileText,      color: "#3B82F6", bg: "rgba(59,130,246,.12)",  border: "rgba(59,130,246,.3)"  },
  interview:     { label: "Interview",      icon: CalendarClock, color: "#F97316", bg: "rgba(249,115,22,.12)",  border: "rgba(249,115,22,.3)"  },
  scholarship:   { label: "Scholarship",    icon: Award,         color: "#A855F7", bg: "rgba(168,85,247,.12)",  border: "rgba(168,85,247,.3)"  },
  missing_docs:  { label: "Missing Docs",   icon: AlertTriangle, color: "#EF4444", bg: "rgba(239,68,68,.12)",   border: "rgba(239,68,68,.3)"   },
  deadline:      { label: "Deadline",       icon: Clock,         color: "#EF4444", bg: "rgba(239,68,68,.12)",   border: "rgba(239,68,68,.3)"   },
  visa_decision: { label: "Visa Decision",  icon: ShieldAlert,   color: "#06B6D4", bg: "rgba(6,182,212,.12)",   border: "rgba(6,182,212,.3)"   },
  other:         { label: "Other",          icon: Info,          color: "#64748B", bg: "rgba(100,116,139,.08)", border: "rgba(100,116,139,.2)" },
  expiry:        { label: "Doc Expiry",     icon: AlertTriangle, color: "#F59E0B", bg: "rgba(245,158,11,.12)",  border: "rgba(245,158,11,.3)"  },
  intake:        { label: "Intake",         icon: GraduationCap, color: "#8B5CF6", bg: "rgba(139,92,246,.12)",  border: "rgba(139,92,246,.3)"  },
  pre_cas:       { label: "Pre-CAS",        icon: FileText,      color: "#8B5CF6", bg: "rgba(139,92,246,.12)",  border: "rgba(139,92,246,.3)"  },
  task:          { label: "Task Due",       icon: ClipboardList, color: "#0D9488", bg: "rgba(13,148,136,.12)",  border: "rgba(13,148,136,.3)"  },
};
function eventCfg(type) { return EVENT_CONFIG[type] || EVENT_CONFIG.other; }

/* ─── date helpers ───────────────────────────────────────────────── */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function toYMD(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
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

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year, month) {
  // Returns 0=Mon..6=Sun
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

/* ─── intake season → approximate date ──────────────────────────── */
const SEASON_MONTH = { "January": 1, "February": 2, "March": 3, "April": 4,
  "May": 5, "June": 6, "July": 7, "August": 8, "September": 9,
  "October": 10, "November": 11, "December": 12,
  "Spring": 3, "Summer": 6, "Autumn": 9, "Fall": 9, "Winter": 1 };

function intakeToDate(season, year) {
  if (!season || !year) return null;
  const parts = season.split(" ");
  const monthName = parts.find(p => SEASON_MONTH[p]);
  const month = monthName ? SEASON_MONTH[monthName] : 9; // default Sept
  return `${year}-${String(month).padStart(2,"0")}-01`;
}

/* ─── build unified event list ───────────────────────────────────── */
function buildEvents(alerts, cases) {
  const events = [];

  // 1. Inbox alerts with due_date
  for (const a of alerts) {
    if (!a.due_date) continue;
    if (a.event_type === "other") continue;
    const studentName = a.cases?.student_name || "Unknown Student";
    events.push({
      id:          `alert-${a.id}`,
      date:        toYMD(a.due_date),
      type:        a.event_type,
      label:       eventCfg(a.event_type).label,
      studentName,
      detail:      a.summary || a.subject || "",
      university:  a.university_name || "",
      isUrgent:    a.is_urgent,
      isRead:      a.is_read,
      caseId:      a.case_id,
      source:      "inbox",
      raw:         a,
    });
  }

  // 2. Document expiries from cases
  for (const c of cases) {
    if (!c.expiryDate) continue;
    events.push({
      id:          `expiry-${c.id}`,
      date:        toYMD(c.expiryDate),
      type:        "expiry",
      label:       "Doc Expiry",
      studentName: c.studentName || c.student_name || "Unknown",
      detail:      c.expiryDocType ? `${c.expiryDocType} expires` : "Document expiry",
      university:  "",
      isUrgent:    (() => { const d = Math.ceil((new Date(c.expiryDate) - new Date()) / 86400000); return d <= 30; })(),
      isRead:      false,
      caseId:      c.id,
      source:      "expiry",
      raw:         c,
    });
  }

  // 3. Application intake targets
  for (const c of cases) {
    const targets = Array.isArray(c.applicationTargets) ? c.applicationTargets : [];
    for (const t of targets) {
      const year   = t.intakeYear;
      const season = t.intakeSeason;
      const date   = intakeToDate(season, year);
      if (!date) continue;
      const country = t.country === "Other" ? (t.countryOther || "Other") : t.country;
      events.push({
        id:          `intake-${c.id}-${season}-${year}`,
        date:        toYMD(date),
        type:        "intake",
        label:       "Intake",
        studentName: c.studentName || c.student_name || "Unknown",
        detail:      `${season} intake${country ? ` · ${country}` : ""}${t.university ? ` · ${t.university}` : ""}`,
        university:  t.university || "",
        isUrgent:    false,
        isRead:      false,
        caseId:      c.id,
        source:      "intake",
        raw:         c,
      });
    }
  }

  return events;
}

/* ─── fetch & build task due-date events from Supabase ──────────── */
async function fetchTaskEvents() {
  try {
    const s = JSON.parse(sessionStorage.getItem("visalens_org_session") || "null");
    if (!s?.org_id) return [];
    const { data, error } = await supabase
      .from("case_tasks")
      .select("id, case_id, title, due_date, priority, status, assigned_to_name")
      .eq("org_id", s.org_id)
      .neq("status", "done")
      .not("due_date", "is", null)
      .order("due_date", { ascending: true });
    if (error || !data) return [];
    return data.map(t => ({
      id:          `task-${t.id}`,
      date:        toYMD(t.due_date),
      type:        "task",
      label:       "Task Due",
      studentName: t.assigned_to_name || "Unassigned",
      detail:      t.title,
      university:  "",
      isUrgent:    t.priority === "urgent" || t.priority === "high",
      isRead:      false,
      caseId:      t.case_id,
      source:      "task",
      taskPriority: t.priority,
      raw:         t,
    }));
  } catch { return []; }
}

/* ─── event pill (on calendar grid) ─────────────────────────────── */
function EventPill({ event, onClick }) {
  const cfg = eventCfg(event.type);
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(event); }}
      title={`${event.studentName} — ${event.label}`}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "1px 6px", borderRadius: 4, marginBottom: 2,
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        color: cfg.color, fontSize: 10, fontWeight: 600,
        cursor: "pointer", overflow: "hidden",
        whiteSpace: "nowrap", textOverflow: "ellipsis",
        transition: "opacity .1s",
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = ".8"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: cfg.color, flexShrink: 0,
      }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {event.studentName.split(" ")[0]}
      </span>
    </div>
  );
}

/* ─── day detail panel ───────────────────────────────────────────── */
function DayPanel({ date, events, archivedEvents = [], caseMap, onOpenCase, onOpenCaseFile, onAddEvent, onArchive, onUnarchive }) {
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (!date) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: "var(--t3)", padding: 40, gap: 14,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: "var(--s2)", border: "1px solid var(--bd)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Calendar size={22} color="var(--t3)" />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t2)", marginBottom: 4 }}>Select a day</div>
          <div style={{ fontSize: 12, color: "var(--t3)" }}>Click any day to see events</div>
        </div>
      </div>
    );
  }

  const d       = new Date(date + "T00:00:00");
  const isToday = toYMD(new Date()) === date;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Day header */}
      <div style={{
        padding: "16px 20px 12px",
        borderBottom: "1px solid var(--bd)",
        background: "var(--s1)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: isToday ? "var(--p)" : "var(--s2)",
            border: `1px solid ${isToday ? "var(--p)" : "var(--bd)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
            color: isToday ? "#fff" : "var(--t1)",
          }}>
            {d.getDate()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)" }}>
              {d.toLocaleDateString("en-GB", { weekday: "long", month: "long", year: "numeric" })}
            </div>
            <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
              {events.length === 0 ? "No events" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
              {archivedEvents.length > 0 && ` · ${archivedEvents.length} archived`}
            </div>
          </div>
          <button
            onClick={onAddEvent}
            title="Add reminder for this day"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 7,
              border: "none", background: "var(--p)", color: "#fff",
              fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0,
              transition: "background .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--pm,#1558c0)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--p)"}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Events list — scrollable */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* Active events */}
        <div style={{ flex: 1 }}>
          {events.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <Inbox size={26} color="var(--t3)" style={{ margin: "0 auto 10px", display: "block" }} />
              <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 12 }}>No events on this day</div>
              <button
                onClick={onAddEvent}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "7px 16px", borderRadius: 8,
                  border: "1px dashed var(--bd)", background: "transparent",
                  color: "var(--t3)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  transition: "all .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--p)"; e.currentTarget.style.color = "var(--p)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bd)"; e.currentTarget.style.color = "var(--t3)"; }}
              >
                <Plus size={12} /> Add reminder
              </button>
            </div>
          ) : (
            events.map(ev => <DayEventCard key={ev.id} ev={ev} caseMap={caseMap} onOpenCase={onOpenCase} onOpenCaseFile={onOpenCaseFile} onArchive={onArchive} />)
          )}
        </div>

        {/* ── Archived section — sticky header at bottom ── */}
        {archivedEvents.length > 0 && (
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--bd)" }}>
            {/* Sticky toggle header */}
            <button
              onClick={() => setArchiveOpen(o => !o)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "9px 20px", border: "none", cursor: "pointer",
                background: "var(--s2)", color: "var(--t3)",
                fontSize: 11, fontWeight: 700,
                position: "sticky", bottom: 0, zIndex: 2,
                transition: "background .12s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--s3)"}
              onMouseLeave={e => e.currentTarget.style.background = "var(--s2)"}
            >
              <Archive size={12} />
              <span style={{ flex: 1, textAlign: "left", textTransform: "uppercase", letterSpacing: ".06em" }}>
                Archived · {archivedEvents.length}
              </span>
              <ChevronDown
                size={13}
                style={{ transform: archiveOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}
              />
            </button>

            {/* Collapsed archived list */}
            {archiveOpen && (
              <div style={{ background: "var(--s2)" }}>
                {archivedEvents.map(ev => (
                  <DayEventCard
                    key={ev.id} ev={ev} caseMap={caseMap}
                    onOpenCase={onOpenCase}
                    onOpenCaseFile={onOpenCaseFile}
                    archived
                    onUnarchive={onUnarchive}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── single event card used in DayPanel ────────────────────────── */
function DayEventCard({ ev, caseMap, onOpenCase, onOpenCaseFile, onArchive, onUnarchive, archived = false }) {
  const cfg      = eventCfg(ev.type);
  const Icon     = cfg.icon;
  const caseObj  = caseMap[ev.caseId];
  const daysAway = Math.ceil((new Date(ev.date) - new Date()) / 86400000);
  const isPast   = daysAway < 0;
  const isToday2 = daysAway === 0;
  const isSoon   = daysAway > 0 && daysAway <= 7;

  return (
    <div style={{
      padding: "13px 20px",
      borderBottom: "1px solid rgba(42,63,111,.08)",
      transition: "background .12s",
      opacity: archived ? 0.65 : 1,
    }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--s2)"}
      onMouseLeave={e => e.currentTarget.style.background = ""}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: archived ? "var(--s3)" : cfg.bg,
          border: `1px solid ${archived ? "var(--bd)" : cfg.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {archived ? <Archive size={14} color="var(--t3)" /> : <Icon size={15} color={cfg.color} />}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
              background: archived ? "var(--s3)" : cfg.bg,
              color: archived ? "var(--t3)" : cfg.color,
              border: `1px solid ${archived ? "var(--bd)" : cfg.border}`,
              textTransform: "uppercase", letterSpacing: ".06em",
            }}>
              {cfg.label}
            </span>
            {ev.custom && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                background: "rgba(29,107,232,.08)", color: "#1D6BE8",
                border: "1px solid rgba(29,107,232,.18)",
                textTransform: "uppercase", letterSpacing: ".06em",
              }}>Reminder</span>
            )}
            {ev.isUrgent && !archived && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                background: "rgba(239,68,68,.12)", color: "#EF4444",
                border: "1px solid rgba(239,68,68,.3)",
                textTransform: "uppercase", letterSpacing: ".06em",
              }}>URGENT</span>
            )}
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: archived ? "var(--t3)" : "var(--t1)", marginBottom: 2 }}>
            {ev.customTitle || ev.studentName}
          </div>
          {ev.detail && ev.detail !== ev.customTitle && (
            <div style={{ fontSize: 11, color: "var(--t2)", marginBottom: 4, lineHeight: 1.5 }}>
              {ev.detail}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {ev.university && (
              <span style={{ fontSize: 11, color: "var(--t3)", display: "flex", alignItems: "center", gap: 3 }}>
                <BookOpen size={9} /> {ev.university}
              </span>
            )}
            <span style={{
              fontSize: 11, fontWeight: isPast || isToday2 || isSoon ? 700 : 400,
              color: archived ? "var(--t3)" : isPast ? "var(--err,#EF4444)" : isToday2 || isSoon ? "#F97316" : "var(--t3)",
              display: "flex", alignItems: "center", gap: 3,
            }}>
              <Clock size={9} />
              {isPast ? `${Math.abs(daysAway)}d ago` : isToday2 ? "Today" : isSoon ? `In ${daysAway}d` : fmtDate(ev.date)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
          {caseObj && !archived && (
            <button
              onClick={() => onOpenCase?.(caseObj)}
              title="Open case"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid var(--bd)", background: "transparent",
                color: "var(--t2)", cursor: "pointer",
              }}
            >
              <ExternalLink size={10} /> Open
            </button>
          )}
          {caseObj && !archived && onOpenCaseFile && (
            <button
              onClick={() => onOpenCaseFile(caseObj)}
              title="Open case file (timeline)"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid rgba(13,148,136,.3)", background: "rgba(13,148,136,.07)",
                color: "#0D9488", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,148,136,.15)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,148,136,.07)"; }}
            >
              <ClipboardList size={10} /> Case File
            </button>
          )}
          {caseObj && !archived && (
            <button
              onClick={() => chatBridge.open(ev.caseId, ev.studentName)}
              title="Open chat"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid rgba(29,107,232,.25)", background: "rgba(29,107,232,.07)",
                color: "#1D6BE8", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(29,107,232,.15)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(29,107,232,.07)"; }}
            >
              <MessageSquare size={10} /> Chat
            </button>
          )}
          {!archived && onArchive && (
            <button
              onClick={() => onArchive(ev)}
              title="Archive this event"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid var(--bd)", background: "transparent",
                color: "var(--t3)", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#F59E0B"; e.currentTarget.style.color = "#B45309"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bd)"; e.currentTarget.style.color = "var(--t3)"; }}
            >
              <Archive size={10} /> Archive
            </button>
          )}
          {archived && onUnarchive && (
            <button
              onClick={() => onUnarchive(ev)}
              title="Restore event"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid var(--bd)", background: "transparent",
                color: "var(--t3)", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--p)"; e.currentTarget.style.color = "var(--p)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bd)"; e.currentTarget.style.color = "var(--t3)"; }}
            >
              <Bell size={10} /> Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Local custom events (localStorage) ────────────────────────── */
const CUSTOM_KEY  = "visalens_custom_events";
const ARCHIVE_KEY = "visalens_archived_events";

function loadCustomEvents()     { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)  || "[]"); } catch { return []; } }
function saveCustomEvents(ev)   { localStorage.setItem(CUSTOM_KEY,  JSON.stringify(ev)); }
function loadArchivedEvents()   { try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); } catch { return []; } }
function saveArchivedEvents(ev) { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ev)); }

/* ─── Add Event Modal ────────────────────────────────────────────── */
const EVENT_TYPE_OPTIONS = [
  { value: "deadline",      label: "Deadline",      icon: Clock,         color: "#EF4444" },
  { value: "interview",     label: "Interview",     icon: CalendarClock, color: "#F97316" },
  { value: "cas",           label: "CAS",           icon: FileText,      color: "#3B82F6" },
  { value: "offer_letter",  label: "Offer Letter",  icon: GraduationCap, color: "#22C55E" },
  { value: "pre_cas",       label: "Pre-CAS",       icon: FileText,      color: "#8B5CF6" },
  { value: "visa_decision", label: "Visa Decision", icon: ShieldAlert,   color: "#06B6D4" },
  { value: "scholarship",   label: "Scholarship",   icon: Award,         color: "#A855F7" },
  { value: "missing_docs",  label: "Missing Docs",  icon: AlertTriangle, color: "#EF4444" },
  { value: "other",         label: "Other",         icon: Info,          color: "#64748B" },
];

function AddEventModal({ defaultDate, cases, onSave, onClose }) {
  const today = toYMD(new Date());
  const [date,      setDate]      = useState(defaultDate || today);
  const [eventType, setEventType] = useState("deadline");
  const [title,     setTitle]     = useState("");
  const [note,      setNote]      = useState("");
  const [caseId,    setCaseId]    = useState("");
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const selectedCase = cases.find(c => c.id === caseId);
  const cfg = eventCfg(eventType);

  async function handleSave() {
    if (!date || !title.trim()) return;
    setSaving(true);
    const ev = {
      id:          "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2,7),
      date,
      type:        eventType,
      label:       (EVENT_TYPE_OPTIONS.find(o => o.value === eventType) || {}).label || "Event",
      studentName: (selectedCase && selectedCase.studentName) || "—",
      detail:      note.trim() || title.trim(),
      customTitle: title.trim(),
      university:  (selectedCase && selectedCase.applicationTargets && selectedCase.applicationTargets[0] && selectedCase.applicationTargets[0].university) || "",
      isUrgent:    false,
      isRead:      false,
      caseId:      caseId || null,
      source:      "custom",
      custom:      true,
    };
    const existing = loadCustomEvents();
    saveCustomEvents([...existing, ev]);
    setSaving(false);
    onSave(ev);
    onClose();
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 800,
          background: "rgba(10,20,50,.45)", backdropFilter: "blur(4px)",
          animation: "cal-fade .15s ease",
        }}
      />
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 801, width: "min(480px, 94vw)",
        background: "var(--s1)", borderRadius: 16,
        border: "1px solid var(--bd)", boxShadow: "0 24px 64px rgba(10,20,50,.22)",
        animation: "cal-pop .2s cubic-bezier(.34,1.56,.64,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px", borderBottom: "1px solid var(--bd)",
          background: "var(--s2)", display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: cfg.bg, border: "1px solid " + cfg.border,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Plus size={17} color={cfg.color} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--fh)" }}>Add Event Reminder</div>
            <div style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--fu)", marginTop: 1 }}>Pinned to your calendar view</div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 7, border: "1px solid var(--bd)",
            background: "var(--s1)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t2)",
          }}><X size={13} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Event type pills */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--t3)", fontFamily: "var(--fu)", marginBottom: 8 }}>Event Type</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EVENT_TYPE_OPTIONS.map(function(opt) {
                var Icon = opt.icon;
                var sel  = eventType === opt.value;
                var ocfg = eventCfg(opt.value);
                return (
                  <button key={opt.value} onClick={() => setEventType(opt.value)} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 10px", borderRadius: 7,
                    border: sel ? ("1.5px solid " + opt.color) : "1px solid var(--bd)",
                    background: sel ? ocfg.bg : "transparent",
                    color: sel ? opt.color : "var(--t2)",
                    fontSize: 11, fontWeight: sel ? 700 : 500,
                    cursor: "pointer", transition: "all .12s",
                  }}>
                    <Icon size={11} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--t3)", fontFamily: "var(--fu)", display: "block", marginBottom: 6 }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
              width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8,
              border: "1px solid var(--bd)", background: "var(--s2)",
              color: "var(--t1)", fontSize: 13, fontFamily: "var(--fu)", outline: "none",
            }} />
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--t3)", fontFamily: "var(--fu)", display: "block", marginBottom: 6 }}>
              Title <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Chase CAS letter from UCL"
              style={{
                width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--bd)", background: "var(--s2)",
                color: "var(--t1)", fontSize: 13, fontFamily: "var(--fu)", outline: "none",
              }}
            />
          </div>

          {/* Link to student */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--t3)", fontFamily: "var(--fu)", display: "block", marginBottom: 6 }}>Link to Student (optional)</label>
            <div style={{ position: "relative" }}>
              <select value={caseId} onChange={e => setCaseId(e.target.value)} style={{
                width: "100%", boxSizing: "border-box", padding: "9px 32px 9px 12px", borderRadius: 8,
                border: "1px solid var(--bd)", background: "var(--s2)",
                color: caseId ? "var(--t1)" : "var(--t3)", fontSize: 13,
                fontFamily: "var(--fu)", appearance: "none", outline: "none", cursor: "pointer",
              }}>
                <option value="">{"—"} No student linked {"—"}</option>
                {cases.map(c => (
                  <option key={c.id} value={c.id}>{c.studentName}{c.targetCountry ? " · " + c.targetCountry : ""}</option>
                ))}
              </select>
              <ChevronDown size={13} color="var(--t3)" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            </div>
            {selectedCase && (
              <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(29,107,232,.06)", border: "1px solid rgba(29,107,232,.15)", fontSize: 11, color: "#1D6BE8", fontFamily: "var(--fu)", display: "flex", alignItems: "center", gap: 6 }}>
                <User size={10} /> {selectedCase.studentName} {"·"} {selectedCase.leadStatus} {"·"} {selectedCase.targetCountry}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--t3)", fontFamily: "var(--fu)", display: "block", marginBottom: 6 }}>Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder={"Any extra context for this reminder…"} rows={2}
              style={{
                width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--bd)", background: "var(--s2)",
                color: "var(--t1)", fontSize: 13, fontFamily: "var(--fu)", resize: "vertical", outline: "none",
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px", borderTop: "1px solid var(--bd)", background: "var(--s2)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: 8, border: "1px solid var(--bd)", background: "transparent",
            color: "var(--t2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={!date || !title.trim() || saving} style={{
            padding: "8px 22px", borderRadius: 8, border: "none",
            background: (!date || !title.trim()) ? "var(--s3)" : "var(--p)",
            color: (!date || !title.trim()) ? "var(--t3)" : "#fff",
            fontSize: 13, fontWeight: 700, cursor: (!date || !title.trim()) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 6, transition: "background .15s",
          }}>
            {saving ? <Loader2 size={13} style={{ animation: "spin .7s linear infinite" }} /> : <Check size={13} />}
            Save Reminder
          </button>
        </div>
      </div>
      <style>{"@keyframes cal-fade{from{opacity:0}to{opacity:1}}@keyframes cal-pop{from{opacity:0;transform:translate(-50%,-50%) scale(.94)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}"}</style>
    </>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────── */
export default function CalendarPage({ cases = [], onOpenCase, onOpenCaseFile, initialDate }) {
  const today      = new Date();
  const initDate   = initialDate ? new Date(initialDate + "T00:00:00") : today;
  const [year,     setYear]     = useState(initDate.getFullYear());
  const [month,    setMonth]    = useState(initDate.getMonth());
  const [selected, setSelected] = useState(initialDate || toYMD(today));
  const [alerts,        setAlerts]        = useState([]);
  const [taskEvents,    setTaskEvents]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [view,          setView]          = useState("month"); // "month" | "agenda"
  const [customEvents,  setCustomEvents]  = useState(() => loadCustomEvents());
  const [archivedEvIds, setArchivedEvIds] = useState(() => new Set(loadArchivedEvents()));
  const [modalDate,     setModalDate]     = useState(null); // null = closed

  /* ── load alerts with due dates ── */
  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${PROXY_URL}/api/inbox/alerts?limit=500`, { headers: getAuthHeaders() });
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  /* ── load task due dates from Supabase ── */
  useEffect(() => {
    fetchTaskEvents().then(setTaskEvents);
  }, []);

  /* ── realtime: refresh tasks when any task is inserted/updated/deleted ── */
  useEffect(() => {
    const s = getOrgSession();
    if (!s?.org_id) return;
    const channel = supabase
      .channel('calendar-tasks')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'case_tasks',
        filter: `org_id=eq.${s.org_id}`,
      }, () => {
        fetchTaskEvents().then(setTaskEvents);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ── build unified events (inbox + tasks + custom), filter archived ── */
  const events = useMemo(() => {
    const base    = buildEvents(alerts, cases);
    const all     = [...base, ...taskEvents, ...customEvents];
    return all.filter(ev => !archivedEvIds.has(ev.id));
  }, [alerts, cases, taskEvents, customEvents, archivedEvIds]);

  const archivedEvents = useMemo(() => {
    const base = buildEvents(alerts, cases);
    const all  = [...base, ...taskEvents, ...customEvents];
    return all.filter(ev => archivedEvIds.has(ev.id));
  }, [alerts, cases, taskEvents, customEvents, archivedEvIds]);

  function handleAddEvent(ev) {
    setCustomEvents(prev => [...prev, ev]);
  }

  function handleArchiveEvent(ev) {
    setArchivedEvIds(prev => {
      const next = new Set(prev);
      next.add(ev.id);
      saveArchivedEvents([...next]);
      return next;
    });
  }

  function handleUnarchiveEvent(ev) {
    setArchivedEvIds(prev => {
      const next = new Set(prev);
      next.delete(ev.id);
      saveArchivedEvents([...next]);
      return next;
    });
  }

  /* ── index events by date ── */
  const eventsByDate = useMemo(() => {
    const m = {};
    for (const ev of events) {
      if (!m[ev.date]) m[ev.date] = [];
      m[ev.date].push(ev);
    }
    return m;
  }, [events]);

  /* ── case map for "Open Case" button ── */
  const caseMap = useMemo(() => {
    const m = {};
    cases.forEach(c => { m[c.id] = c; });
    return m;
  }, [cases]);

  /* ── navigation ── */
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelected(toYMD(today));
  }

  /* ── calendar grid ── */
  const totalDays   = daysInMonth(year, month);
  const startOffset = firstDayOfMonth(year, month);
  const todayYMD    = toYMD(today);

  // Agenda: next 90 days of events sorted by date
  const agendaEvents = useMemo(() => {
    return events
      .filter(ev => ev.date >= todayYMD)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 100);
  }, [events, todayYMD]);

  const agendaByDate = useMemo(() => {
    const m = {};
    for (const ev of agendaEvents) {
      if (!m[ev.date]) m[ev.date] = [];
      m[ev.date].push(ev);
    }
    return m;
  }, [agendaEvents]);

  const selectedEvents = eventsByDate[selected] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxHeight: "calc(100vh - 80px)" }}>

      {/* ── TOP BAR ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 0 16px 0", flexShrink: 0, flexWrap: "wrap", gap: 10,
      }}>
        <div>
          <h1 className="pg-title" style={{ marginBottom: 3 }}>Student <em>Calendar</em></h1>
          <div style={{ fontSize: 12, color: "var(--t3)" }}>
            {events.length} upcoming event{events.length !== 1 ? "s" : ""} across all cases
          </div>
        </div>

        {/* View toggle */}
        <div style={{
          display: "flex", gap: 0,
          background: "var(--s2)", borderRadius: 8, padding: 3,
          border: "1px solid var(--bd)",
        }}>
          {[{ id: "month", label: "Month" }, { id: "agenda", label: "Agenda" }].map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: view === v.id ? "var(--p)" : "transparent",
              color: view === v.id ? "#fff" : "var(--t2)",
              transition: "all .15s",
            }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SPLIT PANE ── */}
      <div style={{
        flex: 1, display: "flex", gap: 0, minHeight: 0,
        border: "1px solid var(--bd)", borderRadius: 12, overflow: "hidden",
        background: "var(--s1)",
      }}>

        {/* ── LEFT: Calendar / Agenda ── */}
        <div style={{
          width: view === "month" ? 620 : "100%",
          flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: view === "month" ? "1px solid var(--bd)" : "none",
        }}>

          {view === "month" ? (
            <>
              {/* Month nav */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "16px 20px", borderBottom: "1px solid var(--bd)",
                background: "var(--s1)", flexShrink: 0,
              }}>
                <button onClick={goToday} style={{
                  padding: "5px 12px", borderRadius: 7, border: "1px solid var(--bd)",
                  background: "transparent", color: "var(--t2)", fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                }}>
                  Today
                </button>
                <button onClick={prevMonth} style={{
                  width: 30, height: 30, borderRadius: 7, border: "1px solid var(--bd)",
                  background: "transparent", color: "var(--t2)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <ChevronLeft size={14} />
                </button>
                <button onClick={nextMonth} style={{
                  width: 30, height: 30, borderRadius: 7, border: "1px solid var(--bd)",
                  background: "transparent", color: "var(--t2)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <ChevronRight size={14} />
                </button>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--t1)", flex: 1 }}>
                  {MONTHS[month]} {year}
                </span>
                {loading && <Loader2 size={14} color="var(--t3)" style={{ animation: "spin .7s linear infinite" }} />}
                <button
                  onClick={e => { e.stopPropagation(); setModalDate(selected || todayYMD); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 14px", borderRadius: 7,
                    border: "none", background: "var(--p)", color: "#fff",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    transition: "background .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--pm,#1558c0)"}
                  onMouseLeave={e => e.currentTarget.style.background = "var(--p)"}
                >
                  <Plus size={13} /> Event
                </button>
              </div>

              {/* Day-of-week headers */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
                borderBottom: "1px solid var(--bd)", flexShrink: 0,
              }}>
                {DAYS.map(d => (
                  <div key={d} style={{
                    padding: "8px 0", textAlign: "center",
                    fontSize: 11, fontWeight: 700, color: "var(--t3)",
                    textTransform: "uppercase", letterSpacing: ".07em",
                  }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Grid */}
              <div style={{
                flex: 1, display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gridAutoRows: "1fr",
                overflowY: "auto",
              }}>
                {/* Empty cells before month start */}
                {Array.from({ length: startOffset }).map((_, i) => (
                  <div key={`empty-${i}`} style={{
                    borderRight: "1px solid rgba(42,63,111,.08)",
                    borderBottom: "1px solid rgba(42,63,111,.08)",
                    background: "rgba(42,63,111,.02)",
                    minHeight: 90,
                  }} />
                ))}

                {/* Day cells */}
                {Array.from({ length: totalDays }).map((_, i) => {
                  const day    = i + 1;
                  const ymd    = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                  const isToday2  = ymd === todayYMD;
                  const isSel  = ymd === selected;
                  const dayEvs = eventsByDate[ymd] || [];
                  const hasUrgent = dayEvs.some(e => e.isUrgent);

                  return (
                    <div
                      key={day}
                      className="cal-day-cell"
                      onClick={() => setSelected(ymd)}
                      style={{
                        borderRight: "1px solid rgba(42,63,111,.08)",
                        borderBottom: "1px solid rgba(42,63,111,.08)",
                        padding: "6px 6px 4px",
                        cursor: "pointer", minHeight: 90,
                        background: isSel ? "rgba(59,130,246,.07)" : "transparent",
                        transition: "background .1s",
                        position: "relative",
                      }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--s2)"; }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Day number + quick-add button */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: isToday2 ? 800 : 500,
                          background: isToday2 ? "var(--p)" : "transparent",
                          color: isToday2 ? "#fff" : isSel ? "var(--p)" : "var(--t1)",
                          border: isSel && !isToday2 ? "1.5px solid var(--p)" : "none",
                          flexShrink: 0,
                        }}>
                          {day}
                        </div>
                        <button
                          className="cal-add-btn"
                          onClick={e => { e.stopPropagation(); setModalDate(ymd); }}
                          title="Add reminder"
                          style={{
                            width: 18, height: 18, borderRadius: 4, border: "none",
                            background: "var(--p)", color: "#fff", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: 0, transition: "opacity .12s", flexShrink: 0, padding: 0,
                          }}
                        >
                          <Plus size={11} />
                        </button>
                      </div>

                      {/* Event pills — max 3, then "+N more" */}
                      {dayEvs.slice(0, 3).map(ev => (
                        <EventPill key={ev.id} event={ev} onClick={() => setSelected(ymd)} />
                      ))}
                      {dayEvs.length > 3 && (
                        <div style={{ fontSize: 9, color: "var(--t3)", fontWeight: 600, paddingLeft: 2 }}>
                          +{dayEvs.length - 3} more
                        </div>
                      )}

                      {/* Urgent dot */}
                      {hasUrgent && (
                        <div style={{
                          position: "absolute", top: 5, right: 5,
                          width: 6, height: 6, borderRadius: "50%",
                          background: "#EF4444",
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* ── AGENDA VIEW ── */
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{
                padding: "14px 20px 10px", borderBottom: "1px solid var(--bd)",
                fontSize: 13, fontWeight: 700, color: "var(--t1)",
                display: "flex", alignItems: "center", gap: 8,
                position: "sticky", top: 0, background: "var(--s1)", zIndex: 1,
              }}>
                <Calendar size={14} color="var(--p)" />
                Upcoming events
                {loading && <Loader2 size={13} color="var(--t3)" style={{ animation: "spin .7s linear infinite", marginLeft: 4 }} />}
              </div>

              {agendaEvents.length === 0 && !loading ? (
                <div style={{ padding: "48px 24px", textAlign: "center" }}>
                  <Calendar size={26} color="var(--t3)" style={{ margin: "0 auto 10px", display: "block" }} />
                  <div style={{ fontSize: 13, color: "var(--t3)" }}>No upcoming events</div>
                </div>
              ) : (
                Object.entries(agendaByDate).map(([date, dayEvs]) => {
                  const d = new Date(date + "T00:00:00");
                  const isToday2 = date === todayYMD;
                  const daysAway = Math.ceil((new Date(date) - new Date()) / 86400000);

                  return (
                    <div key={date}>
                      {/* Date header */}
                      <div style={{
                        padding: "10px 20px 6px",
                        display: "flex", alignItems: "center", gap: 10,
                        borderBottom: "1px solid rgba(42,63,111,.08)",
                        background: isToday2 ? "rgba(59,130,246,.04)" : "var(--s2)",
                        position: "sticky", top: 45, zIndex: 1,
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: isToday2 ? "var(--p)" : "var(--s1)",
                          border: `1px solid ${isToday2 ? "var(--p)" : "var(--bd)"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 800,
                          color: isToday2 ? "#fff" : "var(--t1)",
                        }}>
                          {d.getDate()}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t1)" }}>
                            {d.toLocaleDateString("en-GB", { weekday: "long", month: "long", year: "numeric" })}
                          </div>
                          <div style={{ fontSize: 10, color: isToday2 ? "var(--p)" : "var(--t3)", fontWeight: 600 }}>
                            {isToday2 ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
                            {" · "}{dayEvs.length} event{dayEvs.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </div>

                      {/* Events for this day */}
                      {dayEvs.map(ev => {
                        const cfg     = eventCfg(ev.type);
                        const Icon    = cfg.icon;
                        const caseObj = caseMap[ev.caseId];
                        return (
                          <div key={ev.id} style={{
                            padding: "12px 20px 12px 56px",
                            borderBottom: "1px solid rgba(42,63,111,.06)",
                            display: "flex", alignItems: "flex-start", gap: 12,
                            transition: "background .1s",
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = "var(--s2)"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}
                          >
                            <div style={{
                              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                              background: cfg.bg, border: `1px solid ${cfg.border}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <Icon size={13} color={cfg.color} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                <span style={{
                                  fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 3,
                                  background: cfg.bg, color: cfg.color,
                                  border: `1px solid ${cfg.border}`,
                                  textTransform: "uppercase", letterSpacing: ".05em",
                                }}>{cfg.label}</span>
                                {ev.isUrgent && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 3,
                                    background: "rgba(239,68,68,.12)", color: "#EF4444",
                                    border: "1px solid rgba(239,68,68,.3)",
                                    textTransform: "uppercase", letterSpacing: ".05em",
                                  }}>URGENT</span>
                                )}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>{ev.studentName}</div>
                              {ev.detail && <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 2 }}>{ev.detail}</div>}
                            </div>
                            {caseObj && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                                <button onClick={() => onOpenCase?.(caseObj)} style={{
                                  display: "flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                  border: "1px solid var(--bd)", background: "transparent",
                                  color: "var(--t2)", cursor: "pointer",
                                }}>
                                  <ExternalLink size={10} /> Open
                                </button>
                                {onOpenCaseFile && (
                                  <button onClick={() => onOpenCaseFile(caseObj)} style={{
                                    display: "flex", alignItems: "center", gap: 4,
                                    padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    border: "1px solid rgba(13,148,136,.3)", background: "rgba(13,148,136,.07)",
                                    color: "#0D9488", cursor: "pointer", transition: "all .12s",
                                  }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,148,136,.15)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,148,136,.07)"; }}
                                  >
                                    <ClipboardList size={10} /> Case File
                                  </button>
                                )}
                                <button onClick={() => chatBridge.open(ev.caseId, ev.studentName)} style={{
                                  display: "flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                  border: "1px solid rgba(29,107,232,.25)", background: "rgba(29,107,232,.07)",
                                  color: "#1D6BE8", cursor: "pointer",
                                }}>
                                  <MessageSquare size={10} /> Chat
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Day detail (month view only) ── */}
        {view === "month" && (
          <DayPanel
            date={selected}
            events={selectedEvents}
            archivedEvents={archivedEvents.filter(ev => ev.date === selected)}
            caseMap={caseMap}
            onOpenCase={onOpenCase}
            onOpenCaseFile={onOpenCaseFile}
            onAddEvent={() => setModalDate(selected)}
            onArchive={handleArchiveEvent}
            onUnarchive={handleUnarchiveEvent}
          />
        )}
      </div>

      {modalDate && (
        <AddEventModal
          defaultDate={modalDate}
          cases={cases}
          onSave={handleAddEvent}
          onClose={() => setModalDate(null)}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .cal-day-cell:hover .cal-add-btn { opacity: 1 !important; }
        div[style*="minHeight: 90"]:hover .cal-add-btn { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
