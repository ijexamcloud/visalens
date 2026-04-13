/**
 * CaseFile.jsx — Full Case View  v1.0
 * ─────────────────────────────────────────────────────────────────────────
 * Dedicated case management surface. Opened from QuickPeekDrawer → "Open Full Case".
 * Completely separate from the Analyzer/Matcher — this is for case history, not scoring.
 *
 * Tabs:
 *   Timeline  — Chronological event log (emails, status changes, tasks, calendar, notes)
 *   Tasks     — CaseTasks component (reused)
 *   Docs      — Document checklist + upload status
 *   Notes     — Counsellor notes log
 *
 * Timeline events pulled from doc_events (event_category column).
 * Falls back gracefully if event_category doesn't exist yet — shows whatever is there.
 *
 * Usage:
 *   <CaseFile caseId={id} onClose={() => …} />
 *   Or as a route: /case/:id  (pass caseId from params)
 */

import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import {
  X, ArrowLeft, ExternalLink, Clock, CheckSquare, FileText,
  PenLine, Mail, TrendingUp, Calendar, AlertCircle, Activity,
  Loader2, Search, ChevronDown, Filter, RefreshCw, Check,
  GraduationCap, User, MapPin, Phone, Clipboard,
  ChevronRight, Download,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import CaseTasks from './CaseTasks';

/* ─── Supabase singleton ─────────────────────────────────────────────── */
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}
const supabase = window._supabaseInstance;

/* ─── Session ────────────────────────────────────────────────────────── */
function getOrgSession() {
  try { return JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null'); }
  catch { return null; }
}

/* ─── Date helpers ───────────────────────────────────────────────────── */
function timeAgoShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateGroup(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ─── Event config ───────────────────────────────────────────────────── */
const EVENT_CFG = {
  email:         { icon: Mail,          color: '#1D6BE8', bg: 'rgba(29,107,232,.1)',   label: 'Email'   },
  status_change: { icon: TrendingUp,    color: '#059669', bg: 'rgba(5,150,105,.1)',    label: 'Status'  },
  task:          { icon: CheckSquare,   color: '#7C3AED', bg: 'rgba(124,58,237,.1)',   label: 'Task'    },
  calendar:      { icon: Calendar,      color: '#D97706', bg: 'rgba(217,119,6,.1)',    label: 'Calendar'},
  document:      { icon: FileText,      color: '#4F46E5', bg: 'rgba(79,70,229,.1)',    label: 'Document'},
  note:          { icon: PenLine,       color: '#0D9488', bg: 'rgba(13,148,136,.1)',   label: 'Note'    },
  system:        { icon: Activity,      color: '#64748B', bg: 'rgba(100,116,139,.1)',  label: 'System'  },
};

function getEventCfg(event) {
  const cat = event.event_category || event.source || 'system';
  if (cat === 'email_auto' || cat === 'email') return EVENT_CFG.email;
  if (cat === 'status_change') return EVENT_CFG.status_change;
  if (cat === 'task')          return EVENT_CFG.task;
  if (cat === 'calendar')      return EVENT_CFG.calendar;
  if (cat === 'document')      return EVENT_CFG.document;
  if (cat === 'manual' || cat === 'note') return EVENT_CFG.note;
  return EVENT_CFG.system;
}

/* ─── Lead statuses (for colour lookup) ─────────────────────────────── */
const STATUS_COLORS = {
  'None':                   { color: '#64748B', bg: 'rgba(100,116,139,.1)' },
  'New Lead':               { color: '#1D6BE8', bg: 'rgba(29,107,232,.1)' },
  'Follow up':              { color: '#D97706', bg: 'rgba(217,119,6,.1)' },
  'Ready to Apply':         { color: '#7C3AED', bg: 'rgba(124,58,237,.1)' },
  'Application Started':    { color: '#FC471C', bg: 'rgba(252,71,28,.1)' },
  'Application Paid':       { color: '#F59E0B', bg: 'rgba(245,158,11,.1)' },
  'Application Submitted':  { color: '#3B82F6', bg: 'rgba(59,130,246,.1)' },
  'Application Accepted':   { color: '#059669', bg: 'rgba(5,150,105,.1)' },
  'Ready for Visa':         { color: '#0D9488', bg: 'rgba(13,148,136,.1)' },
  'Done':                   { color: '#4C1D95', bg: 'rgba(76,29,149,.1)' },
};

/* ════════════════════════════════════════════════════════════════════════
   TIMELINE EVENT CARD
════════════════════════════════════════════════════════════════════════ */
function TimelineEventCard({ event, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getEventCfg(event);
  const Icon = cfg.icon;

  // Derive display title & body from whatever columns exist
  const title = event.title || event.doc_type || event.summary?.slice(0, 60) || 'Event';
  const body  = event.description || event.summary || event.ai_summary || '';
  const actor = event.actor_name || event.university_name || null;
  const isLong = body.length > 180;

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
      {/* Connecting line */}
      {!isLast && (
        <div style={{
          position: 'absolute', left: 15, top: 32, bottom: 0,
          width: 1, background: 'var(--bd)',
        }} />
      )}

      {/* Node */}
      <div style={{
        width: 31, height: 31, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: cfg.bg, border: `1.5px solid ${cfg.color}22`,
        zIndex: 1,
      }}>
        <Icon size={13} color={cfg.color} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        {/* Category badge + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em',
            color: cfg.color, fontFamily: 'var(--fu)',
            padding: '1px 6px', borderRadius: 4, background: cfg.bg,
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            {timeAgoShort(event.created_at)}
          </span>
        </div>

        {/* Title */}
        <div style={{
          fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--t1)',
          fontFamily: 'var(--fh)', lineHeight: 1.35, marginBottom: body ? 5 : 0,
        }}>
          {title}
        </div>

        {/* Body */}
        {body && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t2)', fontFamily: 'var(--fu)', lineHeight: 1.55 }}>
            {isLong && !expanded ? `${body.slice(0, 180)}…` : body}
            {isLong && (
              <button onClick={() => setExpanded(e => !e)} style={{
                marginLeft: 6, fontSize: 10, color: 'var(--p)', fontFamily: 'var(--fu)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
              }}>
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </div>
        )}

        {/* Actor */}
        {actor && (
          <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 4 }}>
            by {actor}
          </div>
        )}

        {/* Status change pill */}
        {event.event_category === 'status_change' && event.metadata && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            {event.metadata.old_status && (
              <>
                <span style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 4,
                  background: STATUS_COLORS[event.metadata.old_status]?.bg || 'var(--s3)',
                  color: STATUS_COLORS[event.metadata.old_status]?.color || 'var(--t3)',
                  fontFamily: 'var(--fu)', fontWeight: 600,
                }}>
                  {event.metadata.old_status}
                </span>
                <ChevronRight size={11} color="var(--t3)" />
              </>
            )}
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              background: STATUS_COLORS[event.metadata.new_status]?.bg || 'var(--s3)',
              color: STATUS_COLORS[event.metadata.new_status]?.color || 'var(--t3)',
              fontFamily: 'var(--fu)', fontWeight: 600,
            }}>
              {event.metadata.new_status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TIMELINE TAB
════════════════════════════════════════════════════════════════════════ */
const ALL_CATS = ['email', 'status_change', 'task', 'calendar', 'document', 'note', 'system'];

function TimelineTab({ caseId }) {
  const session = getOrgSession();
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const PAGE = 40;
  const [page,     setPage]     = useState(0);
  const [hasMore,  setHasMore]  = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pageNum = 0, replace = true) => {
    if (!caseId || !session?.org_id) return;
    if (pageNum === 0) setLoading(true);
    else setLoadingMore(true);

    const { data, error } = await supabase
      .from('doc_events')
      .select('*')
      .eq('case_id', caseId)
      .eq('org_id', session.org_id)
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE, (pageNum + 1) * PAGE - 1);

    if (!error && data) {
      setEvents(prev => replace ? data : [...prev, ...data]);
      setHasMore(data.length === PAGE);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [caseId, session?.org_id]);

  useEffect(() => {
    setEvents([]); setPage(0); setHasMore(true);
    load(0, true);
  }, [caseId, load]);

  const filtered = useMemo(() => {
    let ev = events;
    if (filter !== 'all') {
      ev = ev.filter(e => {
        const cat = e.event_category || e.source || 'system';
        if (filter === 'email')  return cat === 'email' || cat === 'email_auto';
        if (filter === 'note')   return cat === 'manual' || cat === 'note';
        return cat === filter;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      ev = ev.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.summary || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.doc_type || '').toLowerCase().includes(q)
      );
    }
    return ev;
  }, [events, filter, search]);

  // Group by date
  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(ev => {
      const key = fmtDateGroup(ev.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });
    return Object.entries(groups);
  }, [filtered]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--bd)',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        background: 'var(--s2)',
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} color="var(--t3)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search timeline…"
            style={{
              width: '100%', paddingLeft: 28, paddingRight: 10, paddingTop: 7, paddingBottom: 7,
              borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--s1)',
              color: 'var(--t1)', fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter dropdown */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setFilterOpen(o => !o)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px',
            borderRadius: 7, border: '1px solid var(--bd)', background: filter !== 'all' ? 'var(--p)' : 'var(--s1)',
            color: filter !== 'all' ? '#fff' : 'var(--t2)', fontSize: 'var(--text-xs)',
            fontFamily: 'var(--fu)', cursor: 'pointer', fontWeight: 600,
          }}>
            <Filter size={11} />
            {filter === 'all' ? 'All' : EVENT_CFG[filter]?.label || filter}
            <ChevronDown size={10} />
          </button>
          {filterOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50,
              background: 'var(--s1)', border: '1px solid var(--bd)', borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,.12)', minWidth: 140, overflow: 'hidden',
            }}>
              {['all', ...ALL_CATS].map(cat => {
                const cfg = cat === 'all' ? null : EVENT_CFG[cat];
                return (
                  <button key={cat} onClick={() => { setFilter(cat); setFilterOpen(false); }} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', border: 'none', background: filter === cat ? 'var(--s2)' : 'transparent',
                    color: 'var(--t1)', fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)',
                    cursor: 'pointer', textAlign: 'left', fontWeight: filter === cat ? 600 : 400,
                  }}>
                    {cfg ? <cfg.icon size={11} color={cfg.color} /> : <Activity size={11} color="var(--t3)" />}
                    {cat === 'all' ? 'All events' : cfg?.label || cat}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={() => load(0, true)} title="Refresh" style={{
          padding: '7px', borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--s1)',
          color: 'var(--t3)', cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8, color: 'var(--t3)' }}>
            <Loader2 size={16} style={{ animation: 'spin .7s linear infinite' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--fu)' }}>Loading timeline…</span>
          </div>
        ) : grouped.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--t3)' }}>
            <Clock size={28} style={{ marginBottom: 12, opacity: .4 }} />
            <div style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--fu)' }}>
              {search || filter !== 'all' ? 'No matching events' : 'No timeline events yet'}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              Events are logged automatically as emails, tasks, and status changes occur.
            </div>
          </div>
        ) : (
          <>
            {grouped.map(([dateLabel, evs]) => (
              <div key={dateLabel} style={{ marginBottom: 28 }}>
                {/* Date group header */}
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.08em', color: 'var(--t3)', fontFamily: 'var(--fu)',
                  marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  {dateLabel}
                  <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    {evs.length} event{evs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {evs.map((ev, i) => (
                  <TimelineEventCard key={ev.id} event={ev} isLast={i === evs.length - 1} />
                ))}
              </div>
            ))}

            {/* Load more */}
            {hasMore && !search && filter === 'all' && (
              <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 16 }}>
                <button
                  onClick={() => { const next = page + 1; setPage(next); load(next, false); }}
                  disabled={loadingMore}
                  style={{
                    padding: '7px 18px', borderRadius: 7, border: '1px solid var(--bd)',
                    background: 'var(--s2)', color: 'var(--t2)', fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--fu)', cursor: 'pointer', fontWeight: 500,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {loadingMore ? <Loader2 size={11} style={{ animation: 'spin .7s linear infinite' }} /> : null}
                  Load older events
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   NOTES TAB
════════════════════════════════════════════════════════════════════════ */
function NotesTab({ caseId }) {
  const session = getOrgSession();
  const myName  = session?.full_name || session?.name || session?.email || 'You';
  const [notes,   setNotes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [text,    setText]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const textRef = useRef();

  const loadNotes = useCallback(async () => {
    if (!caseId || !session?.org_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('doc_events')
      .select('*')
      .eq('case_id', caseId)
      .eq('org_id', session.org_id)
      .in('source', ['manual', 'note'])
      .order('created_at', { ascending: false });
    setNotes(data || []);
    setLoading(false);
  }, [caseId, session?.org_id]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  async function handleSave() {
    if (!text.trim() || saving) return;
    setSaving(true);
    const { error } = await supabase.from('doc_events').insert({
      case_id: caseId,
      org_id: session.org_id,
      event_category: 'note',
      doc_type: 'counsellor_note',
      source: 'manual',
      summary: text.trim(),
      university_name: myName,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    });
    if (!error) {
      setText('');
      await loadNotes();
    }
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Compose area */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', flexShrink: 0, background: 'var(--s2)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <PenLine size={11} /> Add Note
        </div>
        <textarea
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); }}
          placeholder="Called student, discussed visa timeline…"
          rows={3}
          style={{
            width: '100%', resize: 'vertical', padding: '9px 11px', borderRadius: 8,
            border: '1px solid var(--bd)', background: 'var(--s1)',
            color: 'var(--t1)', fontSize: 'var(--text-sm)', fontFamily: 'var(--fu)',
            lineHeight: 1.5, outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--p)'}
          onBlur={e => e.target.style.borderColor = 'var(--bd)'}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>⌘↵ to save</span>
          <button onClick={handleSave} disabled={!text.trim() || saving} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px',
            borderRadius: 7, border: 'none',
            background: text.trim() ? 'var(--p)' : 'var(--s3)',
            color: text.trim() ? '#fff' : 'var(--t3)',
            fontSize: 'var(--text-xs)', fontWeight: 600, fontFamily: 'var(--fu)',
            cursor: text.trim() ? 'pointer' : 'default', transition: 'all .15s',
          }}>
            {saving ? <Loader2 size={11} style={{ animation: 'spin .7s linear infinite' }} /> : <Check size={11} />}
            Save Note
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40, color: 'var(--t3)' }}>
            <Loader2 size={16} style={{ animation: 'spin .7s linear infinite' }} />
          </div>
        ) : notes.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--t3)', fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)' }}>
            No notes yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {notes.map((n, i) => (
              <div key={n.id || i} style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--s2)', border: '1px solid var(--bd)',
              }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t1)', fontFamily: 'var(--fu)', lineHeight: 1.55, marginBottom: 6 }}>
                  {n.summary}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
                  <span>{n.university_name || 'Unknown'}</span>
                  <span>{timeAgoShort(n.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   OVERVIEW PANEL (left sidebar)
════════════════════════════════════════════════════════════════════════ */
function CaseOverview({ caseData }) {
  const pd = caseData?.profileData || {};
  const targets = caseData?.applicationTargets || [];
  const statusCfg = STATUS_COLORS[caseData?.leadStatus] || STATUS_COLORS['None'];

  const fields = [
    { label: 'Counsellor',  value: caseData?.counsellorName, icon: User },
    { label: 'Country',     value: caseData?.targetCountry,  icon: MapPin },
    { label: 'Phone',       value: pd.phone || pd.phoneNumber || pd.mobile || caseData?.phone, icon: Phone },
    { label: 'Email',       value: pd.email || caseData?.email, icon: Mail },
    { label: 'IELTS',       value: pd.ielts || pd.ieltsScore, icon: GraduationCap },
    { label: 'CGPA',        value: pd.cgpa, icon: GraduationCap },
    { label: 'Source',      value: caseData?.referralSource, icon: Clipboard },
  ].filter(f => f.value);

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Student header */}
      <div>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', marginBottom: 12,
          background: 'var(--p)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: 'var(--fh)',
        }}>
          {(caseData?.studentName || '?')[0].toUpperCase()}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', lineHeight: 1.2, marginBottom: 4 }}>
          {caseData?.studentName || 'Unknown Student'}
        </div>
        {caseData?.caseSerial && (
          <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 8 }}>
            #{caseData.caseSerial}
          </div>
        )}
        <span style={{
          display: 'inline-block', fontSize: 11, fontWeight: 700,
          padding: '3px 10px', borderRadius: 6,
          background: statusCfg.bg, color: statusCfg.color,
          fontFamily: 'var(--fu)',
        }}>
          {caseData?.leadStatus || 'None'}
        </span>
      </div>

      {/* Key fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 2 }}>
          Profile
        </div>
        {fields.map(({ label, value, icon: Icon }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Icon size={12} color="var(--t3)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t1)', fontFamily: 'var(--fu)', fontWeight: 500 }}>{String(value)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Targets */}
      {targets.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 8 }}>
            Programs ({targets.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {targets.slice(0, 6).map((t, i) => {
              const isOffer = t.status === 'Offer' || t.status === 'Accepted' || t.has_offer || t.offer_letter;
              return (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: 7,
                  background: isOffer ? 'rgba(5,150,105,.04)' : 'var(--s2)',
                  border: isOffer ? '1px solid rgba(5,150,105,.25)' : '1px solid var(--bd)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isOffer ? '#059669' : 'var(--t1)', fontFamily: 'var(--fh)', lineHeight: 1.3 }}>
                    {t.university || t.institution || 'University'}
                  </div>
                  {(t.program || t.intake_date) && (
                    <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 2 }}>
                      {[t.program, t.intake_date || t.intake].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dates */}
      <div style={{ padding: '12px', borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--fu)' }}>
            <span style={{ color: 'var(--t3)' }}>Case opened</span>
            <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{fmtDate(caseData?.savedAt)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--fu)' }}>
            <span style={{ color: 'var(--t3)' }}>Last updated</span>
            <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{fmtDate(caseData?.updatedAt)}</span>
          </div>
          {caseData?.expiryDate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--fu)' }}>
              <span style={{ color: 'var(--t3)' }}>{caseData.expiryDocType || 'Expiry'}</span>
              <span style={{ color: '#DC2626', fontWeight: 600 }}>{fmtDate(caseData.expiryDate)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════ */
export default function CaseFile({
  caseId,
  caseData: caseDataProp = null,   // pass pre-loaded data from dashboard if available
  onClose,                          // () => void  — back button / close
  counsellorOptions = [],
}) {
  const session = getOrgSession();

  /* ─── Load case data if not passed in ─────────────────────────────── */
  const [caseData, setCaseData] = useState(caseDataProp);
  const [caseLoading, setCaseLoading] = useState(!caseDataProp);

  useEffect(() => {
    if (caseDataProp) { setCaseData(caseDataProp); return; }
    if (!caseId || !session?.org_id) return;
    setCaseLoading(true);
    supabase
      .from('cases')
      .select('id,case_serial,created_at,updated_at,status_updated_at,student_name,counsellor_name,overall_score,target_country,lead_status,expiry_date,expiry_doc_type,application_targets,notes,referral_source,payment_status,results,profile_data,doc_list')
      .eq('id', caseId)
      .eq('org_id', session.org_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setCaseData({
            id: data.id, caseSerial: data.case_serial || null,
            savedAt: data.created_at, updatedAt: data.updated_at,
            studentName: data.student_name || 'Unnamed',
            counsellorName: data.counsellor_name || '',
            overallScore: data.overall_score || 0,
            targetCountry: data.target_country || '',
            leadStatus: data.lead_status || 'None',
            expiryDate: data.expiry_date || null,
            expiryDocType: data.expiry_doc_type || null,
            applicationTargets: Array.isArray(data.application_targets) ? data.application_targets : [],
            notes: data.notes || '',
            referralSource: data.referral_source || 'Direct',
            paymentStatus: data.payment_status || 'Unpaid',
            results: data.results || {},
            profileData: data.profile_data || {},
            docList: Array.isArray(data.doc_list) ? data.doc_list : [],
          });
        }
        setCaseLoading(false);
      });
  }, [caseId, caseDataProp, session?.org_id]);

  /* ─── Active tab ───────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState('timeline');

  const TABS = [
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'tasks',    label: 'Tasks',    icon: CheckSquare },
    { id: 'notes',    label: 'Notes',    icon: PenLine },
  ];

  const resolvedId = caseId || caseData?.id;

  /* ─── Render ───────────────────────────────────────────────────────── */
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'var(--s1)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--fu)',
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', height: 56, flexShrink: 0,
        borderBottom: '1px solid var(--bd)', background: 'var(--s2)',
      }}>
        <button onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 10px', borderRadius: 7,
          border: '1px solid var(--bd)', background: 'var(--s1)',
          color: 'var(--t2)', cursor: 'pointer', fontSize: 'var(--text-xs)',
          fontFamily: 'var(--fu)', fontWeight: 500,
        }}>
          <ArrowLeft size={13} /> Back
        </button>

        <div style={{ flex: 1 }}>
          {caseLoading ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--t3)', fontFamily: 'var(--fu)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', lineHeight: 1.2 }}>
                {caseData?.studentName || 'Case File'}
              </div>
              {caseData?.caseSerial && (
                <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>#{caseData.caseSerial}</div>
              )}
            </>
          )}
        </div>

        {/* Status badge in header */}
        {caseData?.leadStatus && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
            background: STATUS_COLORS[caseData.leadStatus]?.bg || 'var(--s3)',
            color: STATUS_COLORS[caseData.leadStatus]?.color || 'var(--t3)',
            fontFamily: 'var(--fu)',
          }}>
            {caseData.leadStatus}
          </span>
        )}
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left sidebar — overview */}
        <div style={{
          width: 240, flexShrink: 0,
          borderRight: '1px solid var(--bd)',
          overflowY: 'auto', background: 'var(--s2)',
        }}>
          {caseLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
              <Loader2 size={16} color="var(--t3)" style={{ animation: 'spin .7s linear infinite' }} />
            </div>
          ) : (
            <CaseOverview caseData={caseData} />
          )}
        </div>

        {/* Right main — tabs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tab bar */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--bd)',
            background: 'var(--s2)', flexShrink: 0,
            padding: '0 20px',
          }}>
            {TABS.map(t => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '12px 16px', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 700,
                  fontFamily: 'var(--fu)',
                  color: active ? 'var(--p)' : 'var(--t3)',
                  borderBottom: active ? '2px solid var(--p)' : '2px solid transparent',
                  marginBottom: -1, transition: 'color .15s',
                }}>
                  <Icon size={12} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'timeline' && resolvedId && (
              <TimelineTab caseId={resolvedId} />
            )}
            {activeTab === 'tasks' && resolvedId && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <CaseTasks caseId={resolvedId} orgCounsellors={counsellorOptions} />
              </div>
            )}
            {activeTab === 'notes' && resolvedId && (
              <NotesTab caseId={resolvedId} />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
