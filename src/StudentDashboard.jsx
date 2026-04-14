/**
 * VisaLens — Student Dashboard  v7.2
 * ─────────────────────────────────────────────────────────────────────────
 * New in v7.2:
 * • Chat floated out of drawer — FloatingChatPanel lives at dashboard level,
 *   counsellors can chat and interact with the pipeline simultaneously
 * • Morning Brief + overdue tasks — brief now fetches case_tasks and injects
 *   a "You have N overdue tasks" section into the AI summary
 * • Chat tab removed from QuickPeekDrawer (Tasks tab remains)
 *
 * Carried from v7.0:
 * Two-Panel Layout, Sticky Radar, Morning Brief, Cache Invalidation,
 * Smart Next Best Action, Quick-Peek Drawer, Stale/Urgency, Doc Health,
 * Smart Filters, Drag-and-Drop Kanban, Intent-Type Actions.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, Bell, Check,
  ChevronDown, ChevronRight, Clock, Copy, Eye,
  LayoutDashboard, Loader2, RefreshCw, Search, List,
  Target, TrendingUp, User, X, Zap, ExternalLink,
  MapPin, Calendar, Activity, Phone, Mail,
  LayoutGrid, UserCheck, Square, CheckSquare,
  PenLine, BookOpen, GraduationCap, Sparkles, ArrowRight,
  Coffee, MousePointerClick, Users, Award, FileText, Radar,
  MessageSquare, ClipboardList, Send, Reply, Trash2,
} from 'lucide-react';
import CaseTasks  from './CaseTasks';
import CaseFile   from './CaseFile';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, closestCenter,
} from '@dnd-kit/core';
import { createClient } from '@supabase/supabase-js';
import { isDocVal, computeDocScore, viabilityScore } from './docScore';
import RadarMatrix from './RadarMatrix';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://visalens-proxy.ijecloud.workers.dev';

/* ─── Supabase singleton ─────────────────────────────────────────────── */
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
const supabase = window._supabaseInstance;

/* ─── Auth helpers ───────────────────────────────────────────────────── */
function getOrgSession() {
  try { return JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null'); }
  catch { return null; }
}

/* ─── Analytics: Audit Event Logger ─────────────────────────────────────────
   Central helper for all analytics instrumentation. Every counsellor action
   that matters for the Manager Analytics Dashboard flows through here.
   Called fire-and-forget — never blocks the UI action it accompanies.
   action_type must be one of the 11 values in the audit_action_type enum.     */
async function logAuditEvent(caseId, actionType, metadata = {}, quadrant = null) {
  const s = getOrgSession();
  if (!s?.org_id || !caseId) return;
  try {
    await supabase.from('audit_log').insert({
      case_id:         caseId,
      org_id:          s.org_id,
      counsellor_id:   s.member_id  || null,
      counsellor_name: s.name || s.email || 'Unknown',
      action_type:     actionType,
      metadata:        metadata,
      case_quadrant:   quadrant,
    });
  } catch (e) {
    // Audit logging must never crash the app — fail silently
    console.warn('[audit_log] logAuditEvent failed silently:', e?.message);
  }
}

/* ─── Constants ──────────────────────────────────────────────────────── */
const PAGE_SIZE = 50;
const STALE_DAYS = 14;

const LEAD_STATUSES = [
  'None', 'New Lead', 'Follow up', 'Ready to Apply',
  'Application Started', 'Application Paid', 'Application Submitted',
  'Application Accepted', 'Ready for Visa', 'Done',
];

const FUNNEL_STAGES = [
  { key: 'new',      label: 'New Lead',    statuses: ['None', 'New Lead'],                                    color: '#64748B', bg: 'rgba(100,116,139,.1)' },
  { key: 'progress', label: 'In Progress', statuses: ['Follow up', 'Ready to Apply', 'Application Started'], color: '#1D6BE8', bg: 'rgba(29,107,232,.1)'   },
  { key: 'applied',  label: 'Applied',     statuses: ['Application Paid', 'Application Submitted'],          color: '#FC471C', bg: 'rgba(255,216,217,.5)'     },
  { key: 'accepted', label: 'Accepted',    statuses: ['Application Accepted', 'Ready for Visa'],             color: '#059669', bg: 'rgba(5,150,105,.1)'    },
  { key: 'done',     label: 'Done',        statuses: ['Done'],                                                color: '#4C1D95', bg: 'rgba(76,29,149,.1)'    },
];

const COUNTRY_FLAGS = {
  'United Kingdom':'🇬🇧','Canada':'🇨🇦','Australia':'🇦🇺','United States':'🇺🇸',
  'Germany':'🇩🇪','Finland':'🇫🇮','Netherlands':'🇳🇱','Sweden':'🇸🇪','Ireland':'🇮🇪',
  'New Zealand':'🇳🇿','France':'🇫🇷','Italy':'🇮🇹','Spain':'🇪🇸','Denmark':'🇩🇰',
  'Norway':'🇳🇴','Portugal':'🇵🇹','Malaysia':'🇲🇾','Singapore':'🇸🇬',
  'Japan':'🇯🇵','South Korea':'🇰🇷','United Arab Emirates':'🇦🇪',
};
const countryFlag = c => COUNTRY_FLAGS[c] || '🌍';

/* ─── Helpers ────────────────────────────────────────────────────────── */
const scoreBand = s =>
  s >= 70 ? { label:'Strong',   color:'#059669', bg:'rgba(5,150,105,.1)' } :
  s >= 45 ? { label:'Moderate', color:'#FC471C', bg:'rgba(255,216,217,.5)' } :
            { label:'Weak',     color:'#DC2626', bg:'rgba(220,38,38,.1)' };

const isStale = c => {
  if (c.leadStatus === 'Done' || c.leadStatus === 'None') return false;
  if (!c.updatedAt) return false;
  return Math.floor((Date.now() - new Date(c.updatedAt)) / 86400000) >= STALE_DAYS;
};

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;

const fmtDate = d =>
  d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';

const timeAgo = d => {
  if (!d) return '—';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return fmtDate(d);
};

const getIntakeSeason = targets =>
  (targets || []).map(t => t.intake_date || t.intake || '').filter(Boolean)[0] || null;

/* ─── RBAC helpers ───────────────────────────────────────────────────── */
function canManageTeam(orgSession) {
  if (!orgSession?.access_token) return true; // legacy sessions: full access
  return ['org_owner', 'branch_manager'].includes(orgSession?.role);
}

/* ─── Supabase ───────────────────────────────────────────────────────── */
const COLS = 'id,case_serial,created_at,updated_at,status_updated_at,student_name,counsellor_name,overall_score,target_country,lead_status,expiry_date,expiry_doc_type,application_targets,notes,referral_source,payment_status,results,profile_data,doc_list,pending_status_suggestion';
const CONTACT_COLS = 'id,student_email,counsellor_email,profile_data';

function applyScope(q, s) {
  if (s?.role === 'counsellor' || s?.role === 'viewer') {
    // Show cases created by this counsellor OR reassigned to them by name
    const name = s.name || s.full_name || s.email || '';
    if (name) {
      return q.eq('org_id', s.org_id).or(`created_by.eq.${s.member_id},counsellor_name.eq."${name}"`);
    }
    return q.eq('org_id', s.org_id).eq('created_by', s.member_id);
  }
  return q.eq('org_id', s.org_id);
}

const mapRow = r => ({
  id: r.id, caseSerial: r.case_serial||null,
  savedAt: r.created_at, updatedAt: r.updated_at,
  statusUpdatedAt: r.status_updated_at || r.updated_at || r.created_at,
  studentName: r.student_name||'Unnamed', counsellorName: r.counsellor_name||'',
  overallScore: r.overall_score||0, targetCountry: r.target_country||'',
  leadStatus: r.lead_status||'None', expiryDate: r.expiry_date||null,
  expiryDocType: r.expiry_doc_type||null,
  applicationTargets: Array.isArray(r.application_targets) ? r.application_targets : [],
  notes: r.notes||'', phone: '', email: '',
  referralSource: r.referral_source || 'Direct',
  scoreData: r.score_data || null,
  paymentStatus: r.payment_status || 'Unpaid',
  results: r.results || {},
  profileData: r.profile_data || {},
  docList: Array.isArray(r.doc_list) ? r.doc_list : [],
  pendingStatusSuggestion: r.pending_status_suggestion || null,
  _summaryOnly: true,
});

async function fetchAllCases() {
  const s = getOrgSession();
  if (!s?.org_id) return [];
  try {
    let q = supabase.from('cases').select(COLS).order('created_at',{ascending:false}).range(0,PAGE_SIZE-1);
    q = applyScope(q, s);
    const { data, error } = await q;
    if (error) { console.error('[StudentDashboard] load error:', error); return []; }
    return (data||[]).map(mapRow);
  } catch(e) { console.error(e); return []; }
}

async function fetchContactDetails(id) {
  try {
    const { data, error } = await supabase.from('cases').select(CONTACT_COLS).eq('id', id).maybeSingle();
    if (error || !data) return { phone: '', email: '' };
    // phone lives in profile_data JSONB; email is in student_email column
    const pd = data.profile_data || {};
    const phone = pd.phone || pd.phoneNumber || pd.phone_number || pd.mobile || pd.contact || '';
    const email = data.student_email || pd.email || pd.studentEmail || data.counsellor_email || '';
    return { phone, email };
  } catch { return { phone: '', email: '' }; }
}

const LEAD_STATUS_TO_PIPELINE_STAGE = {
  'None':                   'lead',
  'New Lead':               'lead',
  'Follow up':              'docs_pending',
  'Ready to Apply':         'docs_pending',
  'Application Started':    'ready_to_apply',
  'Application Paid':       'applied',
  'Application Submitted':  'applied',
  'Application Accepted':   'conditional_offer',
  'Ready for Visa':         'visa_prep',
  'Done':                   'approved',
};

async function updateLeadStatus(id, newStatus, currentStatus = null) {
  const s = getOrgSession();
  if (!s?.org_id) return false;
  try {
    const newStage = LEAD_STATUS_TO_PIPELINE_STAGE[newStatus] || 'lead';
    const { error } = await supabase.from('cases')
      .update({
        lead_status:       newStatus,
        pipeline_stage:    newStage,
        updated_at:        new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('org_id', s.org_id);
    if (error) return false;
    // Postgres trigger handles funnel_stage_entries automatically.
    // We only log to audit_log here — needs counsellor_id from session.
    logAuditEvent(id, 'STAGE_CHANGED', {
      from:           currentStatus,
      to:             newStatus,
      pipeline_stage: newStage,
    });
    return true;
  } catch { return false; }
}

async function bulkUpdateStatus(ids, newStatus) {
  const s = getOrgSession();
  if (!s?.org_id) return false;
  try {
    const { error } = await supabase.from('cases')
      .update({
        lead_status:       newStatus,
        pipeline_stage:    LEAD_STATUS_TO_PIPELINE_STAGE[newStatus] || 'lead',
        updated_at:        new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
      })
      .in('id', ids).eq('org_id', s.org_id);
    return !error;
  } catch { return false; }
}

async function bulkReassign(ids, counsellorName) {
  const s = getOrgSession();
  if (!s?.org_id) return false;
  try {
    const { error } = await supabase.from('cases')
      .update({ counsellor_name: counsellorName, updated_at: new Date().toISOString() })
      .in('id', ids).eq('org_id', s.org_id);
    if (error) return false;
    // Log one audit event per reassigned case
    const fromCounsellor = s.name || s.email || 'Unknown';
    ids.forEach(caseId => {
      logAuditEvent(caseId, 'CASE_REASSIGNED', {
        from_counsellor: fromCounsellor,
        to_counsellor:   counsellorName,
      });
    });
    return true;
  } catch { return false; }
}

async function appendNoteEntry(id, currentNotes, text) {
  const s = getOrgSession();
  if (!s?.org_id) return null;
  const now   = new Date();
  const stamp = now.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) + ' ' +
                now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const entry = `[${stamp}] ${text.trim()}`;
  const joined = currentNotes ? currentNotes + '\n' + entry : entry;
  try {
    const { error } = await supabase.from('cases')
      .update({ notes: joined, updated_at: now.toISOString() })
      .eq('id', id).eq('org_id', s.org_id);
    if (error) return null;
    // Skip system-generated notes (payment records) to avoid noise in audit log
    if (!text.startsWith('[System]')) {
      logAuditEvent(id, 'NOTE_ADDED', { length_chars: text.trim().length });
    }
    return joined;
  } catch { return null; }
}

/* ─── Next Best Action — session cache + fetch ───────────────────────────── */
const _nbaCache = new Map();

// Gemini insight cache — keyed by case ID, persists across view switches.
// Invalidated explicitly when a case is updated in the DB (same pattern as _nbaCache).
// This prevents re-calling Gemini every time the user toggles to the Radar view.
const _geminiInsightCache = new Map();

function getAuthHeaders() {
  try {
    const s = JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null');
    if (!s) return { 'Content-Type': 'application/json' };
    if (s.access_token) return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.access_token}` };
    return { 'Content-Type': 'application/json', 'X-Org-Id': s.org_id || '' };
  } catch { return { 'Content-Type': 'application/json' }; }
}

async function fetchNextBestAction(caseData) {
  const id = caseData.id;
  if (_nbaCache.has(id)) return _nbaCache.get(id);
  try {
    const res = await fetch(`${PROXY_URL}/api/cases/next-best-action`, {
      method:  'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: 'next-best-action', case_id: id, case_data: caseData }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.action) { _nbaCache.set(id, data); return data; }
  } catch {}
  return null;
}

async function fetchMorningBrief(urgentCases, overdueTasks = []) {
  try {
    const res = await fetch(`${PROXY_URL}/api/cases/next-best-action`, {
      method:  'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        action:       'morning-brief',
        cases:        urgentCases,
        overdueTasks: overdueTasks.slice(0, 15).map(t => ({
          title:        t.title,
          priority:     t.priority,
          daysOverdue:  Math.ceil((new Date() - new Date(t.due_date)) / 86400000),
          assignedTo:   t.assigned_to_name || 'Unassigned',
        })),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.brief || null;
  } catch {}
  return null;
}

const SEASON_MONTH = { January:1, February:2, March:3, April:4, May:5, June:6,
  July:7, August:8, September:9, October:10, November:11, December:12,
  Spring:3, Summer:6, Autumn:9, Fall:9, Winter:1 };

function intakeToDateLocal(season, year) {
  if (!season || !year) return null;
  const monthName = season.split(' ').find(p => SEASON_MONTH[p]);
  const month = monthName ? SEASON_MONTH[monthName] : 9;
  return `${year}-${String(month).padStart(2,'0')}-01`;
}

function getNextMilestone(c, alerts = []) {
  const today  = new Date(); today.setHours(0,0,0,0);
  const events = [];

  if (c.expiryDate) {
    const d = new Date(c.expiryDate); d.setHours(0,0,0,0);
    if (d >= today) events.push({ label: c.expiryDocType ? `${c.expiryDocType} expires` : 'Doc expiry', date: d, kind:'expiry' });
  }
  for (const t of (c.applicationTargets || [])) {
    const ds = intakeToDateLocal(t.intakeSeason, t.intakeYear);
    if (!ds) continue;
    const d = new Date(ds); d.setHours(0,0,0,0);
    if (d >= today) events.push({ label: `${t.intakeSeason || 'Intake'}${t.university ? ` · ${t.university}` : ''}`, date: d, kind:'intake' });
  }
  for (const a of alerts) {
    if (a.case_id !== c.id || !a.due_date) continue;
    const d = new Date(a.due_date); d.setHours(0,0,0,0);
    if (d >= today) events.push({ label: a.summary || a.subject || a.event_type || 'Alert', date: d, kind: a.event_type || 'alert' });
  }
  if (!events.length) return null;
  events.sort((a,b) => a.date - b.date);
  return events[0];
}

/* ─── Parse timestamped log entries from notes ───────────────────────── */
const LOG_RE = /^\[(\d{1,2} \w+ \d{2}:\d{2})\] (.+)$/;
function parseActivityLedger(notes, savedAt) {
  const entries = [];
  if (savedAt) entries.push({ stamp: null, rawDate: new Date(savedAt), text: 'Case opened', kind:'system' });
  if (!notes) return entries;
  for (const line of notes.split('\n')) {
    const m = line.match(LOG_RE);
    if (m) entries.push({ stamp: m[1], rawDate: null, text: m[2], kind:'note' });
  }
  return entries.reverse();
}

const STATUS_STYLE = {
  'None':                  { bg:'var(--s3)',             color:'var(--t3)' },
  'New Lead':              { bg:'var(--soft-slate-bg)',  color:'var(--soft-slate-txt)' },
  'Follow up':             { bg:'rgba(255,216,217,.5)', color:'#FC471C' },
  'Ready to Apply':        { bg:'var(--soft-blue-bg)',   color:'var(--soft-blue-txt)' },
  'Application Started':   { bg:'var(--soft-blue-bg)',   color:'var(--soft-blue-txt)' },
  'Application Paid':      { bg:'var(--soft-blue-bg)',   color:'var(--soft-blue-txt)' },
  'Application Submitted': { bg:'var(--soft-blue-bg)',   color:'var(--soft-blue-txt)' },
  'Application Accepted':  { bg:'var(--soft-green-bg)',  color:'var(--soft-green-txt)' },
  'Ready for Visa':        { bg:'var(--soft-green-bg)',  color:'var(--soft-green-txt)' },
  'Done':                  { bg:'var(--soft-green-bg)',  color:'var(--soft-green-txt)' },
};

/* ─── Atoms ──────────────────────────────────────────────────────────── */
function Avatar({ name, size=32 }) {
  const parts = (name||'?').trim().split(/\s+/).filter(Boolean);
  const ini   = parts.slice(0,2).map(p=>p[0].toUpperCase()).join('');
  const hues  = [220,160,280,30,340,200,60,120];
  const hue   = hues[(name||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)%hues.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', flexShrink:0,
      background:`hsl(${hue},55%,88%)`, color:`hsl(${hue},55%,30%)`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:size*0.36, fontWeight:700, letterSpacing:'-.01em', fontFamily:'var(--fh)',
    }}>{ini}</div>
  );
}

function StatusPill({ status }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE['None'];
  return (
    <span style={{ fontSize:'var(--text-xs)', fontWeight:600, padding:'2px 8px', borderRadius:6,
      background:st.bg, color:st.color, whiteSpace:'nowrap', fontFamily:'var(--fu)', letterSpacing:'.01em',
    }}>{status||'None'}</span>
  );
}

function StaleTag() {
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4,
      background:'rgba(180,83,9,.12)', color:'#B45309', fontFamily:'var(--fu)',
      letterSpacing:'.04em', textTransform:'uppercase', border:'1px solid rgba(180,83,9,.2)',
    }}>Stale</span>
  );
}

function ExpiryBadge({ expiryDate, expiryDocType }) {
  const d = daysUntil(expiryDate);
  if (d===null) return null;
  // Updated colors here:
  const color = d<=14?'#DC2626':d<=30?'#FC471C':'#059669';
  const bg    = d<=14?'rgba(220,38,38,.1)':d<=30?'rgba(255,216,217,.5)':'rgba(5,150,105,.1)';
  
  return (
    <span style={{ fontSize:'var(--text-xs)', fontWeight:600, padding:'2px 8px', borderRadius:6, background:bg, color, fontFamily:'var(--fu)', display:'flex', alignItems:'center', gap:3, whiteSpace:'nowrap' }}>
      <Clock size={9}/>{d<=0?'Expired':`${d}d`}{expiryDocType?` · ${expiryDocType}`:''}
    </span>
  );
}

function DocHealthBar({ expiryDate, expiryDocType }) {
  const d = daysUntil(expiryDate);
  if (d===null) return <span style={{ color:'var(--t3)', fontSize:'var(--text-xs)' }}>—</span>;
  const pct   = d<=0?0:Math.min(100,Math.round((d/365)*100));
  const color = d<=0?'#DC2626':d<=14?'#DC2626':d<=30?'#FC471C':'#059669';
  const label = d<=0?'Expired':d<=30?`${d}d`:fmtDate(expiryDate);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, minWidth:72 }}>
      <span style={{ fontSize:10, color, fontWeight:700, fontFamily:'var(--fu)' }}>{label}</span>
      <div style={{ height:3, background:'var(--s3)', borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:2, transition:'width .4s' }}/>
      </div>
      {expiryDocType && <span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)' }}>{expiryDocType}</span>}
    </div>
  );
}

function StatusSelect({ status, saving, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const st  = STATUS_STYLE[status]||STATUS_STYLE['None'];
  useEffect(() => {
    if (!open) return;
    const h = e => { if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',h);
    return ()=>document.removeEventListener('mousedown',h);
  },[open]);
  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button onClick={()=>setOpen(o=>!o)} disabled={saving}
        style={{ display:'flex', alignItems:'center', gap:5, fontSize:'var(--text-xs)', fontWeight:600, padding:'3px 8px', borderRadius:6, border:'1px solid transparent', background:st.bg, color:st.color, fontFamily:'var(--fu)', cursor:'pointer', opacity:saving?.6:1, transition:'border-color var(--fast)' }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=st.color}
        onMouseLeave={e=>e.currentTarget.style.borderColor='transparent'}
      >
        {saving?<Loader2 size={10} style={{ animation:'spin .7s linear infinite' }}/>:<ChevronDown size={10}/>}
        {status||'None'}
      </button>
      {open&&(
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:400, background:'var(--s1)', border:'1px solid var(--bd)', borderRadius:8, boxShadow:'var(--sh2)', minWidth:190, overflow:'hidden' }}>
          {LEAD_STATUSES.map(s=>{
            const sst=STATUS_STYLE[s]||STATUS_STYLE['None'];
            const cur=s===status;
            return (
              <button key={s} onClick={()=>{onChange(s);setOpen(false);}}
                style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 12px', background:cur?'var(--s2)':'transparent', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'var(--fu)', fontSize:'var(--text-sm)', color:'var(--t1)', transition:'background var(--fast)' }}
                onMouseEnter={e=>{if(!cur)e.currentTarget.style.background='var(--s2)';}}
                onMouseLeave={e=>{if(!cur)e.currentTarget.style.background='transparent';}}
              >
                <span style={{ width:8, height:8, borderRadius:2, background:sst.color, flexShrink:0, display:'inline-block' }}/>
                {s}
                {cur&&<Check size={12} style={{ marginLeft:'auto', color:'var(--p)' }}/>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   KANBAN BOARD 
════════════════════════════════════════════════════════════════════════ */
function DroppableColumn({ stage, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <div ref={setNodeRef} style={{ flexShrink:0, width:230, background: isOver ? stage.bg : 'var(--s2)', border:`1px solid ${isOver ? stage.color : 'var(--bd)'}`, borderRadius:12, overflow:'hidden', transition:'background .15s, border-color .15s' }}>
      {children}
    </div>
  );
}

function DraggableCard({ c, alertCountries, savingId, onStatusChange, onPeek, onOpenChat, isDragging }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: c.id });
  const viabilityScore = c.scoreData?.viability?.score || c.overallScore || 0;
  const sb       = scoreBand(viabilityScore);
  const days     = daysUntil(c.expiryDate);
  const stale    = isStale(c);
  const hasAlert = alertCountries.has((c.targetCountry||'').toLowerCase().trim());

  const stageTs  = c.statusUpdatedAt || c.updatedAt;
  const daysInStage = stageTs ? Math.floor((Date.now() - new Date(stageTs)) / 86400000) : null;

  const style = transform ? {
    transform: `translate3d(${transform.x}px,${transform.y}px,0)`,
    zIndex: 500,
    opacity: 0.85,
    boxShadow: 'var(--sh3)',
  } : {};

  return (
    <div ref={setNodeRef} style={{ ...style, touchAction:'none' }} {...attributes}>
      <div {...listeners} style={{ height:10, background:'var(--s3)', borderRadius:'8px 8px 0 0', cursor: isDragging?'grabbing':'grab', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:28, height:3, borderRadius:2, background:'var(--bd)' }}/>
      </div>
      <div onClick={()=>onPeek(c)}
        style={{ background:'var(--s1)', border:'1px solid var(--bd)', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'10px 11px', cursor:'pointer',
          borderLeft: stale?'3px solid rgba(180,83,9,.5)':days!==null&&days<=14?'3px solid rgba(220,38,38,.5)':'3px solid transparent',
          boxShadow:'var(--sh1)', transition:'box-shadow var(--fast)',
        }}
        onMouseEnter={e=>e.currentTarget.style.boxShadow='var(--sh2)'}
        onMouseLeave={e=>e.currentTarget.style.boxShadow='var(--sh1)'}
      >
        <div style={{ display:'flex', alignItems:'flex-start', gap:7, marginBottom:8 }}>
          <Avatar name={c.studentName} size={26}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:'var(--text-sm)', fontWeight:600, color:'var(--t1)', fontFamily:'var(--fh)', lineHeight:1.3, display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
              {c.studentName}
              {hasAlert&&<span style={{ width:6, height:6, borderRadius:'50%', background:'#FC471C', display:'inline-block' }} title="Policy alert"/>}
            </div>
            {c.counsellorName&&<div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:1 }}>{c.counsellorName}</div>}
          </div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
          {c.targetCountry&&<span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)' }}>{countryFlag(c.targetCountry)} {c.targetCountry}</span>}
          {stale&&<StaleTag/>}
          {days!==null&&days<=30&&<ExpiryBadge expiryDate={c.expiryDate} expiryDocType=""/>}
          <DocHealthChip student={c}/>
          <ViabilityChip student={c}/>
        </div>
        {daysInStage !== null && (
          <div style={{ fontSize:9, color: daysInStage>14?'#B45309':'var(--t3)', fontFamily:'var(--fu)', marginBottom:6, display:'flex', alignItems:'center', gap:3 }}>
            <Clock size={8}/> {daysInStage}d in stage
          </div>
        )}
        <div onClick={e=>e.stopPropagation()}>
          <StatusSelect status={c.leadStatus} saving={savingId===c.id} onChange={ns=>onStatusChange(c.id,ns)}/>
        </div>
        <div onClick={e=>e.stopPropagation()} style={{ marginTop:6 }}>
          <button
            onClick={()=>onOpenChat?.(c.id,c.studentName)}
            style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:5, padding:'4px 0', borderRadius:5, border:'1px solid rgba(29,107,232,.2)', background:'rgba(29,107,232,.06)', color:'#1D6BE8', cursor:'pointer', fontSize:10, fontFamily:'var(--fu)', fontWeight:600, transition:'all var(--fast)' }}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(29,107,232,.14)';}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(29,107,232,.06)';}}
          ><MessageSquare size={9}/> Chat</button>
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({ cases, alertCountries, savingId, onStatusChange, onPeek, onOpenChat }) {
  const [activeDragId,    setActiveDragId]    = useState(null);
  const [complianceToast, setComplianceToast] = useState(null); // { result, studentName, destLabel }
  const [warnToast,       setWarnToast]       = useState(null); // soft warning (card still moved)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const activeDragCase = activeDragId ? cases.find(c => c.id === activeDragId) : null;

  function handleDragStart({ active }) {
    setActiveDragId(active.id);
  }

  function handleDragEnd({ active, over }) {
    setActiveDragId(null);
    if (!over) return;
    const destStage = FUNNEL_STAGES.find(s => s.key === over.id);
    if (!destStage) return;
    const draggedCase = cases.find(c => c.id === active.id);
    if (!draggedCase) return;
    const newStatus = destStage.statuses[0];
    if (newStatus === draggedCase.leadStatus) return;

    // ── Compliance gate ─────────────────────────────────────────────────
    // Only gate stages that have rules defined. Free movement otherwise.
    if (STAGE_GATE_RULES[destStage.key]) {
      const result = runComplianceCheck(draggedCase, destStage.key);
      if (result.hardBlocked) {
        // Card snaps back — do NOT call onStatusChange
        setComplianceToast({ result, studentName: draggedCase.studentName, destLabel: destStage.label });
        return;
      }
      if (result.warnings.length > 0) {
        // Soft warning — move the card but show an amber toast
        setWarnToast({ warnings: result.warnings, studentName: draggedCase.studentName, destLabel: destStage.label });
      }
    }

    onStatusChange(draggedCase.id, newStatus);
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display:'flex', gap:10, overflowX:'auto', padding:'0 0 20px', alignItems:'flex-start' }}>
          {FUNNEL_STAGES.map(stage => {
            const cards = cases.filter(c => stage.statuses.includes(c.leadStatus));
            const hasGate = !!STAGE_GATE_RULES[stage.key];
            return (
              <DroppableColumn key={stage.key} stage={stage}>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--bd)', background:stage.bg, display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:stage.color, display:'inline-block', flexShrink:0 }}/>
                  <span style={{ fontWeight:700, fontSize:'var(--text-sm)', color:stage.color, fontFamily:'var(--fh)', flex:1 }}>{stage.label}</span>
                  {hasGate && <span title="Compliance gate active" style={{ fontSize:9, color:stage.color, opacity:.7 }}>🔒</span>}
                  <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10, background:'var(--s1)', color:'var(--t3)', fontFamily:'var(--fu)' }}>{cards.length}</span>
                </div>
                <div style={{ padding:8, display:'flex', flexDirection:'column', gap:6, maxHeight:'calc(100vh - 320px)', overflowY:'auto' }}>
                  {cards.length === 0
                    ? <div style={{ padding:'18px 8px', textAlign:'center', fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)' }}>Drop here</div>
                    : cards.map(c => (
                      <DraggableCard key={c.id} c={c} alertCountries={alertCountries} savingId={savingId} onStatusChange={onStatusChange} onPeek={onPeek} onOpenChat={onOpenChat} isDragging={activeDragId===c.id}/>
                    ))
                  }
                </div>
              </DroppableColumn>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragCase ? (
            <div style={{ width:230, opacity:.92, transform:'rotate(2deg)', pointerEvents:'none' }}>
              <div style={{ height:10, background:'var(--s3)', borderRadius:'8px 8px 0 0' }}/>
              <div style={{ background:'var(--s1)', border:'1px solid var(--p)', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'10px 11px', boxShadow:'var(--sh3)' }}>
                <div style={{ fontSize:'var(--text-sm)', fontWeight:600, color:'var(--t1)', fontFamily:'var(--fh)' }}>{activeDragCase.studentName}</div>
                <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:2 }}>{activeDragCase.leadStatus}</div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ── Compliance hard-block toast (card snapped back) ── */}
      {complianceToast && (
        <ComplianceToast
          result={complianceToast.result}
          studentName={complianceToast.studentName}
          destLabel={complianceToast.destLabel}
          onDismiss={() => setComplianceToast(null)}
        />
      )}

      {/* ── Soft warning toast (card moved, but heads-up) ── */}
      {warnToast && (
        <div style={{
          position:'fixed', bottom:80, left:'50%', transform:'translateX(-50%)',
          zIndex:600, maxWidth:400, width:'calc(100vw - 40px)',
          background:'#78350F', borderRadius:12, boxShadow:'0 8px 32px rgba(15,30,60,.3)',
          padding:'12px 16px', animation:'sdb-fade-in .2s ease', display:'flex', gap:10, alignItems:'flex-start',
        }}>
          <AlertTriangle size={16} color="#FCD34D" style={{ flexShrink:0, marginTop:1 }}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#FEF3C7', fontFamily:'var(--fh)', marginBottom:3 }}>
              Moved to {warnToast.destLabel} — but check these
            </div>
            <div style={{ fontSize:11, color:'#FDE68A', fontFamily:'var(--fu)' }}>
              {warnToast.warnings.slice(0, 3).join(' · ')}
            </div>
          </div>
          <button onClick={()=>setWarnToast(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,.5)', cursor:'pointer', padding:0 }}><X size={13}/></button>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   BULK ACTION BAR 
════════════════════════════════════════════════════════════════════════ */
function BulkActionBar({ selectedIds, allFiltered, counsellorOptions, onBulkStatus, onBulkReassign, onClear, bulkSaving }) {
  const [statusOpen,   setStatusOpen]   = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const sRef = useRef(null), rRef = useRef(null);
  useEffect(()=>{
    const h = e=>{
      if(sRef.current&&!sRef.current.contains(e.target)) setStatusOpen(false);
      if(rRef.current&&!rRef.current.contains(e.target)) setReassignOpen(false);
    };
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[]);

  const count = selectedIds.size;
  const counsellors = counsellorOptions.filter(n=>n!=='All');

  return (
    <div style={{ position:'fixed', bottom:26, left:'50%', transform:'translateX(-50%)', zIndex:500,
      background:'var(--t1)', borderRadius:12, boxShadow:'0 8px 32px rgba(15,30,60,.3)',
      padding:'10px 16px', display:'flex', alignItems:'center', gap:10,
      animation:'sdb-fade-in .15s ease', minWidth:380,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, flexShrink:0 }}>
        <span style={{ width:24, height:24, borderRadius:6, background:'var(--p)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, fontFamily:'var(--fu)' }}>{count}</span>
        <span style={{ color:'rgba(255,255,255,.65)', fontSize:'var(--text-sm)', fontFamily:'var(--fu)' }}>selected</span>
      </div>

      <div style={{ width:1, height:20, background:'rgba(255,255,255,.15)', flexShrink:0 }}/>

      {count < allFiltered.length && (
        <button onClick={()=>onBulkStatus('__select_all__')}
          style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.65)', cursor:'pointer', fontSize:'var(--text-xs)', fontFamily:'var(--fu)', whiteSpace:'nowrap', padding:0 }}>
          Select all {allFiltered.length}
        </button>
      )}

      <div ref={sRef} style={{ position:'relative' }}>
        <button onClick={()=>{setStatusOpen(o=>!o);setReassignOpen(false);}} disabled={bulkSaving}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, background:'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.2)', color:'#fff', cursor:'pointer', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', whiteSpace:'nowrap', transition:'background var(--fast)' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.22)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'}
        >
          {bulkSaving?<Loader2 size={11} style={{ animation:'spin .7s linear infinite' }}/>:<ChevronDown size={11}/>} Set status
        </button>
        {statusOpen&&(
          <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:0, background:'var(--s1)', border:'1px solid var(--bd)', borderRadius:8, boxShadow:'var(--sh3)', minWidth:200, overflow:'hidden', zIndex:501 }}>
            {LEAD_STATUSES.map(s=>{
              const st=STATUS_STYLE[s]||STATUS_STYLE['None'];
              return (
                <button key={s} onClick={()=>{onBulkStatus(s);setStatusOpen(false);}}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 12px', background:'transparent', border:'none', cursor:'pointer', fontFamily:'var(--fu)', fontSize:'var(--text-sm)', color:'var(--t1)', transition:'background var(--fast)' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                >
                  <span style={{ width:8, height:8, borderRadius:2, background:st.color, display:'inline-block', flexShrink:0 }}/>{s}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {counsellors.length>0&&(
        <div ref={rRef} style={{ position:'relative' }}>
          <button onClick={()=>{setReassignOpen(o=>!o);setStatusOpen(false);}} disabled={bulkSaving}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, background:'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.2)', color:'#fff', cursor:'pointer', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', whiteSpace:'nowrap', transition:'background var(--fast)' }}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.22)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'}
          >
            <UserCheck size={11}/> Reassign
          </button>
          {reassignOpen&&(
            <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:0, background:'var(--s1)', border:'1px solid var(--bd)', borderRadius:8, boxShadow:'var(--sh3)', minWidth:180, overflow:'hidden', zIndex:501 }}>
              {counsellors.map(name=>(
                <button key={name} onClick={()=>{onBulkReassign(name);setReassignOpen(false);}}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 12px', background:'transparent', border:'none', cursor:'pointer', fontFamily:'var(--fu)', fontSize:'var(--text-sm)', color:'var(--t1)', transition:'background var(--fast)' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                >
                  <Avatar name={name} size={20}/>{name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginLeft:'auto' }}>
        <button onClick={onClear}
          style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,.1)', border:'none', color:'rgba(255,255,255,.65)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'background var(--fast)' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.2)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.1)'}
          title="Deselect all"
        ><X size={14}/></button>
      </div>
    </div>
  );
}

function getNextStage(current) {
  const stages = ['New Lead', 'Follow up', 'Ready to Apply', 'Application Started', 'Offer Received'];
  const idx = stages.indexOf(current);
  return idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : 'Visa Filing';
}

function getMissingItems(student) {
  const missing = new Set();
  const r = student.results || {};
  if (Array.isArray(r.missing_requirements)) {
    r.missing_requirements.forEach(m => { if (m != null && String(m).trim()) missing.add(String(m).trim()); });
  }
  if (Array.isArray(r.missing_docs)) {
    r.missing_docs.forEach(m => { if (m != null && String(m).trim()) missing.add(String(m).trim()); });
  }
  if (Array.isArray(student.docList)) {
    student.docList
      .filter(d => d && (d.status === 'missing' || d.status === 'required'))
      .forEach(d => missing.add((d.name || d.type || 'Document').toString()));
  }
  const noteMatches = student.notes?.match(/\[Missing\]:\s*([^,\n.]+)/gi);
  if (noteMatches) {
    noteMatches.forEach(m => missing.add(m.replace(/\[Missing\]:\s*/i, '').trim()));
  }
  return Array.from(missing);
}

/* ════════════════════════════════════════════════════════════════════════
   COMPLIANCE RULES ENGINE
   Deterministic pre-check before any stage transition.
   Rules are defined per destination stage. Two tiers:
     • required  → hard block, card snaps back
     • recommended → soft warning, card moves but toast fires
════════════════════════════════════════════════════════════════════════ */

// Per-stage gate rules. Keys match FUNNEL_STAGES.key values for destination.
// Each rule has: field (dot-path into student), label (human display), tier.
const STAGE_GATE_RULES = {
  // Gate 1: moving to "In Progress" or "Applied" requires basic docs
  applied: {
    required: [
      { field: 'profileData.passportNumber',  label: 'Passport number' },
      { field: 'profileData.passportExpiry',  label: 'Passport expiry date' },
      { field: 'applicationTargets.length',   label: 'At least one university shortlisted' },
    ],
    recommended: [
      { field: 'profileData.ieltsScore',      label: 'IELTS / English test score' },
      { field: 'profileData.financialBalance', label: 'Proof of funds on file' },
    ],
  },
  // Gate 2: moving to "Accepted" — offer letter stage
  accepted: {
    required: [
      { field: 'profileData.passportNumber',  label: 'Passport number' },
      { field: 'profileData.passportExpiry',  label: 'Passport expiry date' },
      { field: 'applicationTargets.length',   label: 'At least one university shortlisted' },
      { field: 'profileData.ieltsScore',      label: 'IELTS / English test score' },
    ],
    recommended: [
      { field: 'profileData.financialBalance', label: 'Proof of funds on file' },
    ],
  },
  // Gate 3: moving to "Done" (visa-ready) — tightest gate
  done: {
    required: [
      { field: 'profileData.passportNumber',  label: 'Passport number' },
      { field: 'profileData.passportExpiry',  label: 'Passport expiry date' },
      { field: 'applicationTargets.length',   label: 'At least one university shortlisted' },
      { field: 'profileData.ieltsScore',      label: 'IELTS / English test score' },
      { field: 'profileData.financialBalance', label: 'Proof of funds' },
      { field: 'expiryDate',                   label: 'CAS / passport expiry on record' },
    ],
    recommended: [
      { field: 'paymentStatus_paid',           label: 'Application fee paid' },
    ],
  },
};

// Country-specific additional requirements layered on top of stage gates.
// Fetched from Supabase visa_rules table at runtime; this is the static fallback.
const COUNTRY_RULES_FALLBACK = {
  'United Kingdom': {
    required: [
      { field: 'profileData.casNumber',        label: 'CAS letter / number' },
      { field: 'profileData.financialBalance',  label: 'Proof of funds (UKVI requirement)' },
    ],
    recommended: [
      { field: 'profileData.tbCertificate',    label: 'TB test certificate' },
      { field: 'profileData.ihsReceipt',        label: 'IHS payment receipt' },
    ],
  },
  'Canada': {
    required: [
      { field: 'profileData.financialBalance',  label: 'Proof of funds' },
      { field: 'profileData.ieltsScore',        label: 'IELTS / language test' },
    ],
    recommended: [],
  },
  'Australia': {
    required: [
      { field: 'profileData.financialBalance',  label: 'Proof of funds (GTE)' },
    ],
    recommended: [
      { field: 'profileData.oshcInsurance',     label: 'OSHC health insurance' },
    ],
  },
};

// Resolve a dot-path string against an object. Handles special cases:
//   "applicationTargets.length" → checks array length > 0
//   "paymentStatus_paid"        → checks paymentStatus === 'Paid'
function resolvePath(obj, path) {
  if (path === 'paymentStatus_paid') return obj.paymentStatus === 'Paid';
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  if (path.endsWith('.length')) return (cur || 0) > 0;
  return cur;
}

function isFilled(val) {
  if (val == null || val === '' || val === false) return false;
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') return val.trim() !== '' && val.trim() !== 'Not found';
  return true;
}

/**
 * runComplianceCheck(student, destStageKey, liveRules?)
 * Returns { isCompliant, hardBlocked, missing: [{label,tier}], warnings: [string] }
 * isCompliant = no hard blocks
 * hardBlocked = at least one required field empty → card must snap back
 * liveRules: optional per-country map from Supabase visa_rules (overrides COUNTRY_RULES_FALLBACK)
 */
function runComplianceCheck(student, destStageKey, liveRules = {}) {
  const stageRules = STAGE_GATE_RULES[destStageKey] || { required: [], recommended: [] };
  const staticCountry = COUNTRY_RULES_FALLBACK[student.targetCountry] || { required: [], recommended: [] };
  const countryRules  = liveRules[student.targetCountry] || staticCountry;

  const missing  = [];
  const warnings = [];

  // Check required rules (hard blocks)
  const allRequired = [...stageRules.required, ...(destStageKey === 'done' ? countryRules.required : [])];
  for (const rule of allRequired) {
    if (!isFilled(resolvePath(student, rule.field))) {
      missing.push({ label: rule.label, tier: 'required' });
    }
  }

  // Check recommended rules (soft warnings)
  const allRecommended = [...stageRules.recommended, ...countryRules.recommended];
  for (const rule of allRecommended) {
    if (!isFilled(resolvePath(student, rule.field))) {
      warnings.push(rule.label);
    }
  }

  // Also surface anything the AI already flagged as missing in its analysis
  // AND anything computeDocScore identifies as missing (same formula as the checklist)
  const aiMissing  = getMissingItems(student);
  const docMissing = computeDocScore(student.profileData || {}, student.results || {}).missing;

  const allDocMissing = new Set([...aiMissing, ...docMissing]);
  for (const item of allDocMissing) {
    if (!missing.some(m => m.label.toLowerCase().includes(item.toLowerCase()))) {
      missing.push({ label: item, tier: 'required' });
    }
  }

  const hardBlocked = missing.some(m => m.tier === 'required');
  return { isCompliant: !hardBlocked, hardBlocked, missing, warnings };
}

/* ─── Toast notification (compliance gate rejection) ─────────────────── */
function ComplianceToast({ result, studentName, destLabel, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 7000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const hard = result.missing.filter(m => m.tier === 'required');
  const soft = result.warnings;

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 600, maxWidth: 420, width: 'calc(100vw - 40px)',
      background: 'var(--t1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(15,30,60,.35)',
      padding: '14px 16px', animation: 'sdb-fade-in .2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          <AlertCircle size={14} color="#fff"/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--fh)', marginBottom: 4 }}>
            Cannot move to <span style={{ color: '#FCA5A5' }}>{destLabel}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', fontFamily: 'var(--fu)', marginBottom: hard.length ? 8 : 0 }}>
            {studentName} · {hard.length} item{hard.length !== 1 ? 's' : ''} blocking progression
          </div>
          {hard.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {hard.slice(0, 4).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#FCA5A5', fontFamily: 'var(--fu)' }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#EF4444', flexShrink: 0 }}/>
                  {m.label}
                </div>
              ))}
              {hard.length > 4 && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontFamily: 'var(--fu)' }}>
                  +{hard.length - 4} more — open the case to view all
                </div>
              )}
            </div>
          )}
          {soft.length > 0 && hard.length === 0 && (
            <div style={{ fontSize: 11, color: '#FDE68A', fontFamily: 'var(--fu)' }}>
              ⚠ Recommended: {soft.slice(0, 2).join(', ')}
            </div>
          )}
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
          <X size={14}/>
        </button>
      </div>
    </div>
  );
}

/* ─── Doc Health Score chip (per kanban card) ────────────────────────── */
function DocHealthChip({ student }) {
  const { score } = computeDocScore(student.profileData || {}, student.results || {});
  if (score === 0 && !student.profileData?.passportNumber) return null;
  const color = score >= 80 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626';
  const bg    = score >= 80 ? 'rgba(5,150,105,.1)' : score >= 50 ? 'rgba(217,119,6,.1)' : 'rgba(220,38,38,.1)';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: bg, color, fontFamily: 'var(--fu)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, flexShrink: 0 }}/>
      {score}/100 docs
    </span>
  );
}

/* ─── Viability Score chip (per kanban card) ─────────────────────────── */
function ViabilityChip({ student }) {
  const { score, confidence } = viabilityScore(student.profileData || {});
  if (confidence < 0.5) return null; // Hide low-confidence scores
  const color = score >= 85 ? '#059669' : score >= 60 ? '#B45309' : '#DC2626';
  const bg    = score >= 85 ? 'rgba(5,150,105,.1)' : score >= 60 ? 'rgba(180,83,9,.1)' : 'rgba(220,38,38,.1)';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: bg, color, fontFamily: 'var(--fu)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Sparkles size={8} style={{ flexShrink: 0 }}/>
      {score}/100 viable
    </span>
  );
}

/* ─── Inline Doc Checklist (for QuickPeekDrawer tab) ────────────────── */
// ─── DOC SCORE ENGINE ────────────────────────────────────────────────────────
// isDocVal + computeDocScore are imported from ./docScore.js (shared with ExpiryCard.jsx).
// All logic and fixes live there — do not duplicate here.

function DocChecklist({ student }) {
  const pd      = student.profileData || {};
  const results = student.results     || {};

  const { score, present, missing, partial, breakdown } = computeDocScore(pd, results);

  const barColor = score >= 80 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626';

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Header + score + progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
          Document Readiness
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: barColor, fontFamily: 'var(--fu)' }}>{score}/100</span>
      </div>
      <div style={{ height: 5, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${score}%`, background: barColor, borderRadius: 3, transition: 'width .4s' }}/>
      </div>

      {/* Checklist rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {Object.entries(breakdown).map(([label, { pts, max, present: isPresent, partial: isPartial }]) => {
          const status = isPresent ? 'present' : isPartial ? 'partial' : 'missing';
          const icon = status === 'present'
            ? <Check size={10}/>
            : status === 'partial'
            ? <AlertTriangle size={10}/>
            : <AlertCircle size={10}/>;
          const color = status === 'present' ? '#059669' : status === 'partial' ? '#D97706' : '#DC2626';
          const bg    = status === 'present' ? 'rgba(5,150,105,.06)' : status === 'partial' ? 'rgba(217,119,6,.06)' : 'rgba(220,38,38,.06)';
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7, background: bg }}>
              <span style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
              <span style={{ fontSize: 12, color: status === 'missing' ? '#DC2626' : 'var(--t1)', fontFamily: 'var(--fu)', flex: 1 }}>
                {label}
                {isPartial && <span style={{ fontSize: 10, color: '#D97706', marginLeft: 4 }}>(partial)</span>}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, color: status === 'present' ? '#059669' : 'var(--t3)', fontFamily: 'var(--fu)', flexShrink: 0 }}>
                {pts}/{max}
              </span>
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 7, background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', fontFamily: 'var(--fu)', marginBottom: 2 }}>
            {missing.length} document{missing.length !== 1 ? 's' : ''} needed before visa filing
          </div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            Upload missing documents in the Analyse tab to clear these flags.
          </div>
        </div>
      )}
      {missing.length === 0 && partial.length === 0 && score >= 75 && (
        <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 7, background: 'rgba(5,150,105,.06)', border: '1px solid rgba(5,150,105,.2)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={12} color="#059669"/>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', fontFamily: 'var(--fu)' }}>Core documents verified — ready for visa stage</span>
        </div>
      )}
    </div>
  );
}

function getScoreRationaleText(student) {
  const r = student.results;
  if (!r || typeof r !== 'object') return '';
  if (typeof r.rationale === 'string' && r.rationale.trim()) return r.rationale.trim();
  if (typeof r.summary === 'string' && r.summary.trim()) return r.summary.trim();
  const elig = r.eligibility;
  if (elig && typeof elig === 'object') {
    const parts = [];
    if (elig.reason) parts.push(String(elig.reason));
    if (Array.isArray(elig.gaps)) elig.gaps.forEach(g => { if (g) parts.push(String(g)); });
    if (parts.length) return parts.join(' · ');
  }
  return '';
}

function parseBudgetNumber(profileData) {
  if (!profileData || typeof profileData !== 'object') return 0;
  const candidates = [profileData.budget, profileData.financialBalance, profileData.fundsAvailable];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = parseInt(String(c).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

function parseTuitionFromTarget(t) {
  if (!t) return 0;
  if (typeof t.tuition === 'number' && !isNaN(t.tuition)) return t.tuition;
  if (typeof t.tuition_fee === 'number' && !isNaN(t.tuition_fee)) return t.tuition_fee;
  const raw = t.tuition_fee ?? t.tuition ?? '';
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/* ════════════════════════════════════════════════════════════════════════
   QUICK-PEEK DRAWER 
════════════════════════════════════════════════════════════════════════ */
/* ─── Auto-detection suggestion banner ──────────────────────────── */
function AutoDetectBanner({ caseObj, onConfirm, onDismiss }) {
  const suggestion = caseObj?.pending_status_suggestion || caseObj?.pendingStatusSuggestion;
  if (!suggestion) return null;

  const sourceLabel = caseObj.profileData?.cas?.detected_from === 'email'
    ? 'CAS email' : caseObj.profileData?.offerLetters?.find(o => o.detected_from === 'email')
    ? 'offer email' : 'email';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      background: 'rgba(29,107,232,.07)',
      border: '1px solid rgba(29,107,232,.2)',
      borderRadius: 10, marginBottom: 12,
    }}>
      <Sparkles size={14} color="#1D6BE8" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--t1)', fontFamily: 'var(--fu)' }}>
        <span style={{ fontWeight: 700 }}>Auto-detected</span> from {sourceLabel}
        {' '}— suggest moving to <span style={{ fontWeight: 700 }}>{suggestion}</span>?
      </div>
      <button
        onClick={() => onConfirm(suggestion)}
        style={{
          padding: '4px 10px', borderRadius: 6, border: 'none',
          background: '#1D6BE8', color: '#fff',
          fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}
      >Confirm</button>
      <button
        onClick={onDismiss}
        style={{
          padding: '4px 8px', borderRadius: 6, border: '1px solid var(--bd)',
          background: 'transparent', color: 'var(--t3)',
          fontSize: 11, cursor: 'pointer', flexShrink: 0,
        }}
      >Dismiss</button>
    </div>
  );
}

function QuickPeekDrawer({ student, onClose, onOpenFull, onOpenMatcher, onStatusChange, onNoteUpdate, onPaymentUpdate, savingId, policyAlerts, inboxAlerts=[], openDocsTab=false, counsellorOptions=[], onOpenChat, onSuggestionConfirm, onSuggestionDismiss, openChatCount=0 }) {
  const [closing, setClosing] = React.useState(false);
  function slideClose(cb) {
    setClosing(true);
    setTimeout(() => { setClosing(false); cb?.(); onClose(); }, 220);
  }
  const [contact,    setContact]    = useState({ phone: '', email: '' });
  const [logText,    setLogText]    = useState('');
  const [logSaving,  setLogSaving]  = useState(false);
  const [localNotes, setLocalNotes] = useState(student?.notes || '');
  const [activeTab,  setActiveTab]  = useState(openDocsTab ? 'docs' : 'info');
  const [nba,        setNba]        = useState(null);   
  const [nbaLoading, setNbaLoading] = useState(false);
  const [unseenTasks,   setUnseenTasks]   = useState(0);
  const [recentEvents,  setRecentEvents]  = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showCaseFile,  setShowCaseFile]  = useState(false);
  const logRef = useRef(null);
  // Payment Popover State
  const [payOpen, setPayOpen] = useState(false);
  const [payType, setPayType] = useState('Application Fee');
  const [payOther, setPayOther] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [localPaymentStatus, setLocalPaymentStatus] = useState(student?.paymentStatus || 'Unpaid');

  useEffect(()=>{
    const h = e=>{ if(e.key==='Escape') onClose(); };
    document.addEventListener('keydown',h);
    return()=>document.removeEventListener('keydown',h);
  },[onClose]);

  // Track targets length so the Saved Programs section re-renders immediately
  // when ProgramMatcher writes new application_targets and Realtime patches the cases array.
  const targetsKey = (student?.applicationTargets || []).length + ':' + (student?.applicationTargets || []).map(t => t.university || '').join(',');

  useEffect(()=>{
    if (!student?.id) return;
    setContact({ phone: '', email: '' });
    setLocalNotes(student.notes || '');
    setLogText('');
    setPayOpen(false);
    setPayOther('');
    setPayAmount('');
    setPayType('Application Fee');
    setPaySaving(false);
    setLocalPaymentStatus(student.paymentStatus || 'Unpaid');
    fetchContactDetails(student.id).then(setContact);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[student?.id, student?.notes, targetsKey]);

  useEffect(()=>{
    if (!student?.id) return;
    if (_nbaCache.has(student.id)) { setNba(_nbaCache.get(student.id)); return; }
    setNba(null);
    setNbaLoading(true);
    fetchNextBestAction(student).then(result => {
      setNba(result);
      setNbaLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[student?.id, student?.leadStatus, student?.notes]);

  // Reset unseen count when case changes
  useEffect(()=>{ setUnseenTasks(0); },[student?.id]);

  // Fetch last 3 timeline events for the Overview strip
  useEffect(()=>{
    if (!student?.id) return;
    const s = getOrgSession();
    if (!s?.org_id) return;
    setRecentEvents([]);
    setEventsLoading(true);
    supabase
      .from('doc_events')
      .select('id,created_at,event_category,source,doc_type,summary,university_name,metadata')
      .eq('case_id', student.id)
      .eq('org_id', s.org_id)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        setRecentEvents(data || []);
        setEventsLoading(false);
      });
  },[student?.id]);

  // Realtime: increment badge when a new task is created for this case
  useEffect(()=>{
    if(!student?.id) return;
    const s = getOrgSession();
    if(!s?.org_id) return;
    const ch = supabase
      .channel(`drawer-tasks-${student.id}`)
      .on('postgres_changes',{
        event:'INSERT', schema:'public', table:'case_tasks',
        filter:`case_id=eq.${student.id}`,
      }, ()=>{
        // Only increment if the tasks tab is not currently active
        setActiveTab(cur => {
          if(cur !== 'tasks') setUnseenTasks(n => n + 1);
          return cur;
        });
      })
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[student?.id]);

  if(!student) return null;

  const stale        = isStale(student);
  const daysSince    = student.updatedAt ? Math.floor((Date.now()-new Date(student.updatedAt))/86400000) : null;
  const alertSet     = new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim())));
  const hasAlert     = alertSet.has((student.targetCountry||'').toLowerCase().trim());
  const intakeSeason = getIntakeSeason(student.applicationTargets);
  const targets      = student.applicationTargets||[];
  const milestone    = getNextMilestone(student, inboxAlerts);
  const ledger       = parseActivityLedger(localNotes, student.savedAt);
  const missingForBlocker = getMissingItems(student);
  const paidOk = localPaymentStatus === 'Paid' || student.paymentStatus === 'Paid';
  const showBlockerSuccess =
    paidOk &&
    missingForBlocker.length === 0 &&
    (student.applicationTargets?.length > 0) &&
    !!student.expiryDate;

  const phone    = contact.phone.replace(/\D/g,'');
  const email    = contact.email||'';
  const waText   = encodeURIComponent(`Hi ${student.studentName}, following up on your application — VisaLens`);
  const mailSub  = encodeURIComponent(`VisaLens Update — ${student.studentName}`);
  const mailBody = encodeURIComponent(`Hi ${student.studentName},\n\nJust following up on your${student.targetCountry?` ${student.targetCountry}`:''} application.\n\nBest regards`);

  async function handleLogSave() {
    if (!logText.trim()) return;
    setLogSaving(true);
    const updated = await appendNoteEntry(student.id, localNotes, logText.trim());
    setLogSaving(false);
    if (updated !== null) {
      setLocalNotes(updated);
      setLogText('');
      onNoteUpdate && onNoteUpdate(student.id, updated);
    }
  }

  async function handleSavePayment() {
    const actualType = payType === 'Other' ? payOther.trim() : payType;
    if (!actualType || !payAmount.trim()) return;

    const s = getOrgSession();
    const ts = new Date().toISOString();
    setPaySaving(true);

    // 1. Persist payment status to DB
    if (s?.org_id) {
      try {
        const { error } = await supabase.from('cases')
          .update({ payment_status: 'Paid', updated_at: ts })
          .eq('id', student.id).eq('org_id', s.org_id);
        if (error) console.error('[StudentDashboard] payment_status update error:', error);
      } catch (e) {
        console.error('[StudentDashboard] payment_status update error:', e);
      }
    }

    // 2. Format and save the system note for the Activity Ledger
    const logStr = `[System] Payment recorded: ${actualType} (${payAmount.trim()})`;
    const updatedNotes = await appendNoteEntry(student.id, localNotes, logStr);

    // 3. Update the local UI state (THIS IS WHERE YOUR NEW CODE GOES)
    if (updatedNotes !== null) {
      setLocalNotes(updatedNotes);
      onNoteUpdate && onNoteUpdate(student.id, updatedNotes);
      
      setLocalPaymentStatus('Paid');
      onPaymentUpdate && onPaymentUpdate(student.id, 'Paid'); // <--- Parent Sync!
    }

    // 4. Reset and close the popover
    setPaySaving(false);
    setPayOpen(false);
    setPayOther('');
    setPayAmount('');
  }

  const MILESTONE_COLORS = { expiry:'#F59E0B', intake:'#8B5CF6', interview:'#F97316', offer_letter:'#22C55E', alert:'#EF4444' };
  const msColor = milestone ? (MILESTONE_COLORS[milestone.kind] || '#1D6BE8') : null;
  const msDays  = milestone ? Math.ceil((milestone.date - new Date()) / 86400000) : null;

  return (
    <>
      <div onClick={() => slideClose()} style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(15,30,60,.25)', backdropFilter:'blur(2px)', animation:'sdb-fade-in .15s ease' }}/>
      <div style={{ position:'fixed', top:0, right:0, bottom:0, width:'min(440px,92vw)', zIndex:301, background:'var(--s1)', borderLeft:'1px solid var(--bd)', boxShadow:'var(--sh3)', display:'flex', flexDirection:'column', animation:closing?'sdb-slide-out-right .2s var(--eout) forwards':'sdb-slide-in-right .2s var(--eout)' }}>

        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid var(--bd)', background:'var(--s2)', display:'flex', alignItems:'flex-start', gap:12, flexShrink:0 }}>
          <Avatar name={student.studentName} size={44}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:'var(--text-md)', fontWeight:700, color:'var(--t1)', fontFamily:'var(--fh)' }}>{student.studentName}</span>
              {stale&&<StaleTag/>}
              {hasAlert&&(
  <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'rgba(255,216,217,.5)', color:'#FC471C', fontFamily:'var(--fu)', letterSpacing:'.04em', textTransform:'uppercase', border:'1px solid rgba(252,71,28,.2)', display:'flex', alignItems:'center', gap:3 }}>
    <Bell size={8}/> Alert
  </span>
)}
            </div>
            {/* THE STATIC STATUS INDICATOR (Header) */}
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, fontFamily: 'var(--fu)',
                background: localPaymentStatus === 'Paid' ? 'rgba(5,150,105,.1)' : 'rgba(255,216,217,.5)',
                color: localPaymentStatus === 'Paid' ? '#059669' : '#FC471C',
                border: `1px solid ${localPaymentStatus === 'Paid' ? 'rgba(5,150,105,.2)' : 'rgba(252,71,28,.2)'}`
              }}>
                {localPaymentStatus === 'Paid' ? '✓ Deposit Paid' : 'Fees Unpaid'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Users size={10}/> Source: {student.referralSource || 'Direct'}
              </span>
            </div>

            {/* Header Action Row */}
            <div style={{ display:'flex', gap:8, marginTop:12 }}>
              <button
                onClick={() => { onOpenMatcher && onOpenMatcher(student.id); onClose(); }}
                style={{
                  flex: 1, display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                  padding:'8px 12px', borderRadius:8, border:'none',
                  background:'linear-gradient(135deg, #4C1D95 0%, #6D28D9 100%)',
                  color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer',
                  boxShadow: '0 2px 8px rgba(76,29,149,0.2)'
                }}
              >
                <Target size={14}/> Run AI Matcher
              </button>
              {/* Chat button — opens floating panel, drawer stays open */}
              <button
                onClick={() => onOpenChat && onOpenChat(student)}
                title="Open case chat — you can keep working while chatting"
                style={{
                  padding:'8px 12px', borderRadius:8,
                  border:'1px solid rgba(29,107,232,.3)',
                  background:'rgba(29,107,232,.08)',
                  color:'#1D6BE8', fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                  transition:'all var(--fast)',
                }}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(29,107,232,.15)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(29,107,232,.08)';}}
              >
                <MessageSquare size={14}/> Chat
              </button>
              <button
                onClick={() => slideClose(() => onOpenFull(student))}
                style={{
                  padding:'8px 12px', borderRadius:8,
                  border:'1px solid var(--bd)', background:'var(--s1)',
                  color:'var(--t2)', fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}
              >
                <ExternalLink size={14}/> Full File
              </button>
            </div>
            {student.caseSerial&&<div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fm)', marginTop:2 }}>{student.caseSerial}</div>}
            {student.counsellorName&&<div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)', marginTop:2, display:'flex', alignItems:'center', gap:4 }}><User size={10}/> {student.counsellorName}</div>}
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--bd)', background:'var(--s1)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--t2)', transition:'background var(--fast)' }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
            onMouseLeave={e=>e.currentTarget.style.background='var(--s1)'}
          ><X size={14}/></button>
        </div>

        {milestone && (
          <div style={{ padding:'8px 20px', background:`${msColor}0d`, borderBottom:`1px solid ${msColor}28`, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
            <Calendar size={12} color={msColor}/>
            <span style={{ fontSize:'var(--text-xs)', fontWeight:600, color:msColor, fontFamily:'var(--fu)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              Next: {milestone.label}
            </span>
            <span style={{ fontSize:'var(--text-xs)', fontWeight:700, color:msColor, fontFamily:'var(--fu)', flexShrink:0 }}>
              {msDays===0?'Today':msDays===1?'Tomorrow':`In ${msDays}d`}
            </span>
          </div>
        )}

        {(nba || nbaLoading) && (() => {
          const NBA_COLORS = {
            urgent: { bg:'rgba(220,38,38,.08)', border:'rgba(220,38,38,.2)', text:'#DC2626', dot:'#DC2626' },
      high:   { bg:'rgba(255,216,217,.5)', border:'rgba(252,71,28,.2)', text:'#FC471C', dot:'#FC471C' },
            normal: { bg:'rgba(29,107,232,.07)', border:'rgba(29,107,232,.18)', text:'#1D6BE8', dot:'#1D6BE8' },
          };
          const nc = NBA_COLORS[nba?.priority || 'normal'];
          const isEmailIntent   = nba?.intent_type === 'email';
          const isStatusIntent  = nba?.intent_type === 'status_change';
          const isNoteIntent    = nba?.intent_type === 'log_note';

          const emailMailto = isEmailIntent && email
            ? `mailto:${email}?subject=${encodeURIComponent(`VisaLens Update — ${student.studentName}`)}&body=${encodeURIComponent(`Hi ${student.studentName},\n\n${nba.action}\n\nBest regards`)}`
            : null;

          const intentIcon = isEmailIntent  ? <Mail size={10} style={{ marginLeft:4 }}/>
                           : isStatusIntent ? <ArrowRight size={10} style={{ marginLeft:4 }}/>
                           : isNoteIntent   ? <PenLine size={10} style={{ marginLeft:4 }}/>
                           : null;

          return (
            <div style={{ padding:'10px 20px', background:nc.bg, borderBottom:`1px solid ${nc.border}`, flexShrink:0,
              ...(isEmailIntent ? { cursor:'pointer' } : {}),
            }}
              onClick={isEmailIntent && emailMailto ? () => {
                window.open(emailMailto, '_self');
                logAuditEvent(student.id, 'ACTION_QUEUE_USED', {
                  action_label: nba?.action?.slice(0, 80) || 'email',
                  intent_type:  nba?.intent_type,
                  priority:     nba?.priority,
                });
              } : undefined}
              onMouseEnter={isEmailIntent ? e=>{e.currentTarget.style.filter='brightness(.96)';} : undefined}
              onMouseLeave={isEmailIntent ? e=>{e.currentTarget.style.filter='none';} : undefined}
              title={isEmailIntent ? 'Click to open email draft' : undefined}
            >
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom: nba ? 4 : 0 }}>
                {nbaLoading
                  ? <Loader2 size={11} color={nc.text} style={{ animation:'spin .7s linear infinite', flexShrink:0 }}/>
                  : <Sparkles size={11} color={nc.text} style={{ flexShrink:0 }}/>
                }
                <span style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'.07em', color:nc.text, fontFamily:'var(--fu)', display:'flex', alignItems:'center', gap:3 }}>
                  {nbaLoading ? 'Thinking…' : `Next Best Action · ${(nba?.priority||'normal').toUpperCase()}`}
                  {!nbaLoading && intentIcon}
                </span>
                {isEmailIntent && !nbaLoading && (
                  <span style={{ marginLeft:'auto', fontSize:9, fontWeight:700, color:nc.text, fontFamily:'var(--fu)', opacity:.7, display:'flex', alignItems:'center', gap:3 }}>
                    <MousePointerClick size={9}/> Click to draft
                  </span>
                )}
              </div>
              {nba && (
                <>
                  <div style={{ fontSize:'var(--text-sm)', fontWeight:600, color:'var(--t1)', fontFamily:'var(--fh)', lineHeight:1.4, paddingLeft:17 }}>
                    {nba.action}
                  </div>
                  {nba.rationale && (
                    <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:3, paddingLeft:17 }}>
                      {nba.rationale}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        <div style={{ display:'flex', borderBottom:'1px solid var(--bd)', background:'var(--s2)', flexShrink:0 }}>
          {[
            {id:'info',  label:'Overview'},
            {id:'docs',  label:'Docs'},
            {id:'log',   label:'Activity'},
            {id:'tasks', label:'Tasks', icon:<ClipboardList size={10}/>},
          ].map(t=>(
            <button key={t.id} onClick={()=>{ setActiveTab(t.id); if(t.id==='tasks') setUnseenTasks(0); }} style={{
              flex:1, padding:'9px 0', border:'none', background:'transparent', cursor:'pointer',
              fontSize:'var(--text-xs)', fontWeight:700, fontFamily:'var(--fu)',
              color:activeTab===t.id?'var(--p)':'var(--t3)',
              borderBottom:activeTab===t.id?'2px solid var(--p)':'2px solid transparent',
              transition:'color var(--fast)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:3, position:'relative',
            }}>
              {t.icon}{t.label}
              {t.id==='tasks' && unseenTasks > 0 && (
                <span style={{
                  minWidth:14, height:14, borderRadius:7, padding:'0 3px',
                  background:'#EF4444', color:'#fff',
                  fontSize:8, fontWeight:700, fontFamily:'var(--fu)',
                  display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1,
                }}>
                  {unseenTasks > 9 ? '9+' : unseenTasks}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ flex:1, overflowY: activeTab === 'tasks' ? 'hidden' : 'auto', padding:'0 0 8px', display: activeTab === 'tasks' ? 'flex' : 'block', flexDirection:'column' }}>
          {activeTab === 'tasks' ? (
            <CaseTasks caseId={student.id} orgCounsellors={counsellorOptions} studentName={student.studentName}/>
          ) : activeTab === 'docs' ? (
            <DocChecklist student={student}/>
          ) : activeTab === 'info' ? (<>
            {/* SCORES & RATIONALE */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', background: 'var(--s2)' }}>
              {/* Calculate scores from profile/results directly */}
              {(() => {
                const pd = student.profileData || {};
                const results = student.results || {};
                const readinessResult = computeDocScore(pd, results);
                const readinessScore = readinessResult.score;
                const viabilityResult = viabilityScore(pd);
                const profileViabilityScore = viabilityResult.score;

                // Generate breakdown tooltip text
                const viabilityBreakdown = [
                  `Academic: ${viabilityResult.breakdown.academic.score}/40`,
                  `Financial: ${viabilityResult.breakdown.financial.score}/35`,
                  `Visa Risk: ${viabilityResult.breakdown.visaRisk.score}/25`
                ].join('\n');

                const readinessBreakdown = Object.entries(readinessResult.breakdown)
                  .map(([label, { pts, max }]) => `${label}: ${pts}/${max}`)
                  .join('\n');

                return (
                  <>
                    {/* Profile Viability */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={14} color="#7C3AED" />
                        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--t2)', fontFamily: 'var(--fu)' }}>Profile Viability</span>
                      </div>
                      <div
                        title={viabilityBreakdown}
                        style={{ fontSize: 24, fontWeight: 800, color: profileViabilityScore > 70 ? '#059669' : profileViabilityScore > 40 ? '#D97706' : '#DC2626', fontFamily: 'var(--fh)', cursor: 'help' }}
                      >
                        {profileViabilityScore}<span style={{ fontSize: 14, color: 'var(--t3)', fontWeight: 400 }}>/100</span>
                      </div>
                    </div>
                    {/* Document Readiness */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={14} color="#059669" />
                        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--t2)', fontFamily: 'var(--fu)' }}>Document Readiness</span>
                      </div>
                      <div
                        title={readinessBreakdown}
                        style={{ fontSize: 24, fontWeight: 800, color: readinessScore > 80 ? '#059669' : readinessScore > 50 ? '#D97706' : '#DC2626', fontFamily: 'var(--fh)', cursor: 'help' }}
                      >
                        {readinessScore}<span style={{ fontSize: 14, color: 'var(--t3)', fontWeight: 400 }}>/100</span>
                      </div>
                    </div>
                  </>
                );
              })()}
              {student.results?.rationale ? (
                <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, padding: '10px', borderRadius: 8, background: 'var(--s1)', border: '1px solid var(--bd)', fontStyle: 'italic' }}>
                  &ldquo;{student.results.rationale}&rdquo;
                </div>
              ) : getScoreRationaleText(student) ? (
                <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, padding: '10px', borderRadius: 8, background: 'var(--s1)', border: '1px solid var(--bd)', fontStyle: 'italic' }}>
                  &ldquo;{getScoreRationaleText(student)}&rdquo;
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'center', padding: '8px', border: '1px dashed var(--bd)', borderRadius: 8 }}>
                  No AI rationale available. Run analysis or Matcher to generate.
                </div>
              )}
            </div>

            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--bd)' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>Lead Status</div>
              <AutoDetectBanner
                caseObj={student}
                onConfirm={onSuggestionConfirm}
                onDismiss={onSuggestionDismiss}
              />
              <div onClick={e=>e.stopPropagation()}>
                <StatusSelect status={student.leadStatus} saving={savingId===student.id} onChange={ns=>onStatusChange(student.id,ns)}/>
              </div>
            </div>

            {/* NEXT STAGE BLOCKER (document-aware) */}
            <div style={{ padding: '0 20px 16px', paddingTop: 16 }}>
              <div style={{ background: '#FFF7ED', border: '1px solid #FFEDD5', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#9A3412', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowRight size={12}/> Next Step: {getNextStage(student.leadStatus)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!paidOk && (
                    <div style={{ fontSize: 12, color: '#7C2D12', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid #FB923C', flexShrink: 0 }} />
                      Record Initial Deposit
                    </div>
                  )}
                  {!student.applicationTargets?.length && (
                    <div style={{ fontSize: 12, color: '#7C2D12', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid #FB923C', flexShrink: 0 }} />
                      Shortlist at least 1 university (Program Matcher)
                    </div>
                  )}
                  {!student.expiryDate && (
                    <div style={{ fontSize: 12, color: '#7C2D12', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={14} color="#FB923C" style={{ flexShrink: 0 }}/>
                      <span><span style={{ fontWeight: 700 }}>Need:</span> Passport expiry / ID on file</span>
                    </div>
                  )}
                  {missingForBlocker.map((doc, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: '#7C2D12', display: 'flex', alignItems: 'start', gap: 8 }}>
                      <AlertCircle size={14} color="#FB923C" style={{ marginTop: 1, flexShrink: 0 }}/>
                      <span><span style={{ fontWeight: 700 }}>Missing:</span> {doc}</span>
                    </div>
                  ))}
                  {showBlockerSuccess && (
                    <div style={{ fontSize: 12, color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={16}/> Profile ready for stage progression
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
              <DrawerInfoRow icon={<MapPin size={13}/>} label="Target Country">
                <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:16 }}>{countryFlag(student.targetCountry)}</span>
                  <span style={{ fontWeight:600, color:'var(--t1)' }}>{student.targetCountry||'—'}</span>
                </span>
              </DrawerInfoRow>
              <DrawerInfoRow icon={<Clock size={13}/>} label="Document Expiry">
                {student.expiryDate
                  ? <DocHealthBar expiryDate={student.expiryDate} expiryDocType={student.expiryDocType}/>
                  : <span style={{ color:'var(--t3)', fontSize:'var(--text-sm)' }}>Not recorded</span>
                }
              </DrawerInfoRow>
              {intakeSeason&&(
                <DrawerInfoRow icon={<Calendar size={13}/>} label="Next Intake">
                  <span style={{ fontWeight:600, color:'var(--t1)', fontSize:'var(--text-sm)' }}>{intakeSeason}</span>
                </DrawerInfoRow>
              )}
              <DrawerInfoRow icon={<Activity size={13}/>} label="Last Updated">
                <span style={{ fontSize:'var(--text-sm)', color:stale?'#B45309':'var(--t2)', fontWeight:stale?600:400 }}>
                  {timeAgo(student.updatedAt)}
                  {stale&&<span style={{ marginLeft:6, fontSize:10, color:'#B45309' }}>· {daysSince}d no movement</span>}
                </span>
              </DrawerInfoRow>
              {hasAlert&&(
  <div style={{ padding:'10px 12px', borderRadius:8, background:'rgba(255,216,217,.5)', border:'1px solid rgba(252,71,28,.2)', display:'flex', gap:8, alignItems:'flex-start' }}>
    <Bell size={13} color="#FC471C" style={{ flexShrink:0, marginTop:1 }}/>
    <div>
      <div style={{ fontSize:'var(--text-xs)', fontWeight:700, color:'#FC471C', marginBottom:2 }}>Policy Alert Active</div>
      <div style={{ fontSize:'var(--text-xs)', color:'var(--t2)', fontFamily:'var(--fu)' }}>
        {policyAlerts.filter(a=>(a.affected_countries||[]).some(ac=>ac.toLowerCase().trim()===(student.targetCountry||'').toLowerCase().trim())).map(a=>a.title||a.description||'Active alert').join(' · ')}
      </div>
    </div>
  </div>
)}
            </div>

            {(phone||email)&&(
              <div style={{ padding:'0 20px 16px' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>Quick Contact</div>
                <div style={{ display:'flex', gap:8 }}>
                  {phone&&(
                    <a href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.3)', color:'#128C7E', textDecoration:'none', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', flex:1, justifyContent:'center', transition:'background var(--fast)' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(37,211,102,.18)'}
                      onMouseLeave={e=>e.currentTarget.style.background='rgba(37,211,102,.1)'}
                    ><Phone size={12}/> WhatsApp</a>
                  )}
                  {email&&(
                    <a href={`mailto:${email}?subject=${mailSub}&body=${mailBody}`} onClick={e=>e.stopPropagation()}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, background:'var(--soft-blue-bg)', border:'1px solid rgba(29,107,232,.2)', color:'var(--soft-blue-txt)', textDecoration:'none', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', flex:1, justifyContent:'center', transition:'background var(--fast)' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(29,107,232,.15)'}
                      onMouseLeave={e=>e.currentTarget.style.background='var(--soft-blue-bg)'}
                    ><Mail size={12}/> Email</a>
                  )}
                </div>
                <div style={{ marginTop:5, display:'flex', gap:12, flexWrap:'wrap' }}>
                  {phone&&<span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fm)' }}>{contact.phone}</span>}
                  {email&&<span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fm)' }}>{email}</span>}
                </div>
              </div>
            )}

            {targets.length > 0 && (
              <div style={{ padding: '0 20px 16px' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', color:'var(--t3)', marginBottom:8, fontFamily:'var(--fu)' }}>Financial Feasibility</div>
                <div style={{ padding:12, borderRadius:10, background:'var(--s2)', border:'1px solid var(--bd)' }}>
                  {(() => {
                    const budget = parseBudgetNumber(student.profileData);
                    return targets.map((t, i) => {
                      const tuition = parseTuitionFromTarget(t);
                      const gap = tuition > 0 && budget > 0 ? tuition - budget : null;
                      const uni = t.university || t.institution || 'Program';
                      return (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: i === targets.length - 1 ? 0 : 8 }}>
                          <span style={{ fontSize:12, color:'var(--t2)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{uni}</span>
                          {gap == null || tuition === 0 || budget === 0 ? (
                            <span style={{ fontSize:10, fontWeight:600, color:'var(--t3)', fontFamily:'var(--fu)' }}>Add tuition & budget</span>
                          ) : gap > 0 ? (
                            <span style={{ fontSize:10, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'2px 6px', borderRadius:4 }}>
                              −£{gap.toLocaleString()} gap
                            </span>
                          ) : (
                            <span style={{ fontSize:10, fontWeight:700, color:'#059669', background:'#F0FDF4', padding:'2px 6px', borderRadius:4 }}>
                              ✓ Within budget
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* FINANCIALS & PAYMENTS SECTION (Body) */}
            <div style={{ padding:'0 20px 16px' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>Financial Ledger</div>

              <div style={{ background: 'var(--s2)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => setPayOpen(!payOpen)}
                  style={{
                    width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                    fontSize: 'var(--text-sm)', color: 'var(--t1)', fontFamily: 'var(--fu)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width:24, height:24, borderRadius:6, background:'rgba(5,150,105,.1)', display:'flex', alignItems:'center', justifyContent:'center', color:'#059669' }}>
                      <CheckSquare size={12}/>
                    </div>
                    <span style={{ fontWeight: 600 }}>Record a Payment</span>
                  </div>
                  <ChevronDown size={14} style={{ transform: payOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--t3)' }}/>
                </button>

                {payOpen && (
                  <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--bd)', background: 'var(--s1)', animation: 'sdb-fade-in .15s ease' }}>
                    <div style={{ marginTop: 12 }}>
                      <select
                        value={payType}
                        onChange={e => setPayType(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--bd)', marginBottom: payType === 'Other' ? 8 : 12, fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)', background: 'var(--s2)', color: 'var(--t1)' }}
                      >
                        <option value="Application Fee">Application Fee</option>
                        <option value="Initial Deposit / CAS Fee">Initial Deposit / CAS Fee</option>
                        <option value="Semester 1 Fee">Semester 1 Fee</option>
                        <option value="Full Annual Fee">Full Annual Fee</option>
                        <option value="IHS Fee">IHS Fee</option>
                        <option value="Visa / Embassy Fee">Visa / Embassy Fee</option>
                        <option value="Other">Other (Specify...)</option>
                      </select>

                      {payType === 'Other' && (
                        <input
                          autoFocus
                          placeholder="e.g. Courier charges"
                          value={payOther}
                          onChange={e => setPayOther(e.target.value)}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--bd)', marginBottom: 12, fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)', background: 'var(--s2)' }}
                        />
                      )}

                      <input
                        placeholder="Amount (e.g. £2,000)"
                        value={payAmount}
                        onChange={e => setPayAmount(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSavePayment(); }}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--bd)', marginBottom: 12, fontSize: 'var(--text-xs)', fontFamily: 'var(--fu)', background: 'var(--s2)' }}
                      />

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setPayOpen(false)} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t2)', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button
                          onClick={handleSavePayment}
                          disabled={paySaving || !payAmount.trim() || (payType === 'Other' && !payOther.trim())}
                          style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: 'var(--p)', color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: (!payAmount.trim() || (payType === 'Other' && !payOther.trim())) ? 0.5 : 1 }}
                        >
                          {paySaving ? <Loader2 size={12} style={{ animation: 'spin .7s linear infinite' }}/> : <Check size={12}/>}
                          Save Payment
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {targets.length > 0 && (
              <div style={{ padding:'0 20px 16px' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:10, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Saved Programs ({targets.length})</span>
                  {targets.some(t => t.status === 'Offer' || t.has_offer || t.offer_letter) && (
                    <span style={{ color: '#059669' }}>Offers Received!</span>
                  )}
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {targets.slice(0, 5).map((t, i) => {
                    const isOffer = t.status === 'Offer' || t.status === 'Accepted' || t.has_offer || t.offer_letter;

                    return (
                      <div key={i} style={{
                        padding:'10px 12px', borderRadius:8,
                        background: isOffer ? 'rgba(5,150,105,.04)' : 'var(--s2)',
                        border: isOffer ? '1px solid rgba(5,150,105,.3)' : '1px solid var(--bd)',
                        position: 'relative', overflow: 'hidden'
                      }}>
                        {isOffer && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#059669', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--fu)' }}>
                            <Award size={12}/> Offer Granted
                          </div>
                        )}

                        <div style={{ fontSize:'var(--text-sm)', fontWeight:600, color: isOffer ? '#059669' : 'var(--t1)', fontFamily:'var(--fh)', marginBottom:2, lineHeight: 1.3 }}>
                          {t.university || t.institution || 'University'}
                        </div>

                        <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)' }}>
                          {[t.program, t.intake_date || t.intake].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    );
                  })}
                  {targets.length > 5 && (
                    <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', textAlign:'center', padding:'6px 0', background: 'var(--s2)', borderRadius: 6 }}>
                      + {targets.length - 5} more programs in full file
                    </div>
                  )}
                </div>
              </div>
            )}

            {localNotes&&(
              <div style={{ padding:'0 20px 16px' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>Notes</div>
                <div style={{ padding:'10px 12px', borderRadius:8, background:'var(--s2)', border:'1px solid var(--bd)', fontSize:'var(--text-sm)', color:'var(--t2)', fontFamily:'var(--fu)', lineHeight:1.6, whiteSpace:'pre-line' }}>{localNotes}</div>
              </div>
            )}

            {/* ── Recent Timeline Events strip ── */}
            <div style={{ padding:'0 20px 20px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', display:'flex', alignItems:'center', gap:5 }}>
                  <Clock size={10}/> Recent Activity
                </div>
                <button onClick={()=>setShowCaseFile(true)} style={{
                  fontSize:10, fontWeight:600, color:'var(--p)', fontFamily:'var(--fu)',
                  background:'none', border:'none', cursor:'pointer', padding:0,
                  display:'flex', alignItems:'center', gap:3,
                }}>
                  Full timeline <ChevronRight size={10}/>
                </button>
              </div>

              {eventsLoading ? (
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 0', color:'var(--t3)' }}>
                  <Loader2 size={11} style={{ animation:'spin .7s linear infinite' }}/> 
                  <span style={{ fontSize:'var(--text-xs)', fontFamily:'var(--fu)' }}>Loading…</span>
                </div>
              ) : recentEvents.length === 0 ? (
                <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)', padding:'8px 0' }}>
                  No events logged yet
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                  {recentEvents.map((ev, i) => {
                    const cat = ev.event_category || ev.source || 'system';
                    const isEmail  = cat === 'email' || cat === 'email_auto';
                    const isStatus = cat === 'status_change';
                    const isTask   = cat === 'task';
                    const isNote   = cat === 'manual' || cat === 'note';
                    const color = isEmail ? '#1D6BE8' : isStatus ? '#059669' : isTask ? '#7C3AED' : isNote ? '#0D9488' : '#64748B';
                    const bg    = isEmail ? 'rgba(29,107,232,.1)' : isStatus ? 'rgba(5,150,105,.1)' : isTask ? 'rgba(124,58,237,.1)' : isNote ? 'rgba(13,148,136,.1)' : 'rgba(100,116,139,.1)';
                    const label = isEmail ? 'Email' : isStatus ? 'Status' : isTask ? 'Task' : isNote ? 'Note' : 'Event';
                    const EvIcon = isEmail ? Mail : isStatus ? TrendingUp : isTask ? CheckSquare : isNote ? PenLine : Activity;
                    const title = ev.doc_type || ev.summary?.slice(0, 55) || label;
                    const isLast = i === recentEvents.length - 1;

                    // relative time
                    const d = new Date(ev.created_at);
                    const diffMs = Date.now() - d;
                    const mins = Math.floor(diffMs/60000), hours = Math.floor(diffMs/3600000), days = Math.floor(diffMs/86400000);
                    const stamp = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : hours < 24 ? `${hours}h ago` : days === 1 ? 'Yesterday' : days < 7 ? `${days}d ago` : d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});

                    return (
                      <div key={ev.id || i} style={{ display:'flex', gap:10, position:'relative', paddingBottom: isLast ? 0 : 12 }}>
                        {!isLast && <div style={{ position:'absolute', left:11, top:24, bottom:0, width:1, background:'var(--bd)' }}/>}
                        <div style={{ width:23, height:23, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:bg, border:`1px solid ${color}22`, zIndex:1 }}>
                          <EvIcon size={10} color={color}/>
                        </div>
                        <div style={{ flex:1, minWidth:0, paddingTop:2 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                            <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color, fontFamily:'var(--fu)', padding:'1px 5px', borderRadius:3, background:bg }}>{label}</span>
                            <span style={{ fontSize:9, color:'var(--t3)', fontFamily:'var(--fu)' }}>{stamp}</span>
                          </div>
                          <div style={{ fontSize:'var(--text-xs)', color:'var(--t1)', fontFamily:'var(--fu)', lineHeight:1.4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {title}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* CTA */}
              <button onClick={()=>setShowCaseFile(true)} style={{
                marginTop:14, width:'100%', padding:'8px 0', borderRadius:7,
                border:'1px solid var(--bd)', background:'var(--s2)',
                color:'var(--t2)', fontSize:'var(--text-xs)', fontWeight:600,
                fontFamily:'var(--fu)', cursor:'pointer', display:'flex',
                alignItems:'center', justifyContent:'center', gap:5,
                transition:'background var(--fast)',
              }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
              onMouseLeave={e=>e.currentTarget.style.background='var(--s2)'}
              >
                <ExternalLink size={11}/> Open Full Case File
              </button>
            </div>
          </>) : (<>

            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                <PenLine size={11}/> Log a note
              </div>
              <textarea
                ref={logRef}
                value={logText}
                onChange={e=>setLogText(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) handleLogSave(); }}
                placeholder="Called student, discussed visa options…"
                rows={3}
                style={{ width:'100%', resize:'vertical', padding:'9px 11px', borderRadius:8, border:'1px solid var(--bd)', background:'var(--s2)', color:'var(--t1)', fontSize:'var(--text-sm)', fontFamily:'var(--fu)', lineHeight:1.5, outline:'none', boxSizing:'border-box', transition:'border-color var(--fast)' }}
                onFocus={e=>e.target.style.borderColor='var(--p)'}
                onBlur={e=>e.target.style.borderColor='var(--bd)'}
              />
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
                <span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)' }}>⌘↵ to save</span>
                <button onClick={handleLogSave} disabled={!logText.trim()||logSaving}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 14px', borderRadius:7, border:'none', background: logText.trim()?'var(--p)':'var(--s3)', color: logText.trim()?'#fff':'var(--t3)', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', cursor: logText.trim()?'pointer':'default', transition:'all var(--fast)' }}>
                  {logSaving?<Loader2 size={11} style={{ animation:'spin .7s linear infinite' }}/>:<Check size={11}/>}
                  Save
                </button>
              </div>
            </div>

            <div style={{ padding:'16px 20px' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:12 }}>Activity</div>
              {ledger.length===0 ? (
                <div style={{ textAlign:'center', padding:'24px 0', color:'var(--t3)', fontSize:'var(--text-xs)', fontFamily:'var(--fu)' }}>No activity yet</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                  {ledger.map((entry, i)=>(
                    <div key={i} style={{ display:'flex', gap:12, position:'relative', paddingBottom: i<ledger.length-1?16:0 }}>
                      {i<ledger.length-1&&<div style={{ position:'absolute', left:11, top:24, bottom:0, width:1, background:'var(--bd)' }}/>}
                      <div style={{ width:23, height:23, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background: entry.kind==='system'?'var(--s3)':'rgba(29,107,232,.1)', border:`1px solid ${entry.kind==='system'?'var(--bd)':'rgba(29,107,232,.25)'}`, zIndex:1 }}>
                        {entry.kind==='system'
                          ? <Activity size={10} color="var(--t3)"/>
                          : <PenLine size={10} color="#1D6BE8"/>
                        }
                      </div>
                      <div style={{ flex:1, minWidth:0, paddingTop:2 }}>
                        <div style={{ fontSize:'var(--text-xs)', color:'var(--t1)', fontFamily:'var(--fu)', lineHeight:1.5 }}>{entry.text}</div>
                        <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:2 }}>
                          {entry.stamp || (entry.rawDate ? fmtDate(entry.rawDate.toISOString()) : '')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>)}
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid var(--bd)', background:'var(--s2)', flexShrink:0, display:'flex', gap:8 }}>
          <button onClick={()=>setShowCaseFile(true)}
            style={{ flex:1, padding:'9px 16px', background:'var(--p)', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontFamily:'var(--fh)', fontSize:'var(--text-sm)', fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'background var(--fast)' }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--pm)'}
            onMouseLeave={e=>e.currentTarget.style.background='var(--p)'}
          ><ExternalLink size={13}/> Open Full Case</button>
          <button onClick={onClose}
            style={{ padding:'9px 14px', background:'var(--s1)', color:'var(--t2)', border:'1px solid var(--bd)', borderRadius:8, cursor:'pointer', fontFamily:'var(--fu)', fontSize:'var(--text-sm)', fontWeight:500, transition:'background var(--fast)' }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
            onMouseLeave={e=>e.currentTarget.style.background='var(--s1)'}
          >Close</button>
        </div>
      </div>

      {/* ── Full Case File overlay (mounts above the drawer) ── */}
      {showCaseFile && (
        <CaseFile
          caseId={student.id}
          caseData={student}
          counsellorOptions={counsellorOptions}
          onClose={()=>setShowCaseFile(false)}
          onOpenFull={(c) => { setShowCaseFile(false); slideClose(() => onOpenFull(c || student)); }}
        />
      )}
    </>
  );
}


/* ════════════════════════════════════════════════════════════════════════
   CHAT THREAD INLINE
   Full chat thread embedded in FloatingChatPanel. Identical logic to
   ChatThread.jsx but lives here so FloatingChatPanel has no external dep.
   (ChatThread.jsx is still used if someone imports it standalone.)
════════════════════════════════════════════════════════════════════════ */
const SENDER_PALETTE_CHAT = [
  { bg:'rgba(29,107,232,.12)',  color:'#1D6BE8' },
  { bg:'rgba(5,150,105,.12)',   color:'#059669' },
  { bg:'rgba(139,92,246,.12)',  color:'#7C3AED' },
  { bg:'rgba(252,71,28,.12)',   color:'#FC471C' },
  { bg:'rgba(245,158,11,.12)',  color:'#D97706' },
  { bg:'rgba(236,72,153,.12)',  color:'#DB2777' },
  { bg:'rgba(20,184,166,.12)',  color:'#0D9488' },
  { bg:'rgba(99,102,241,.12)',  color:'#4F46E5' },
];
function senderColorChat(name=''){
  let h=0;
  for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return SENDER_PALETTE_CHAT[h%SENDER_PALETTE_CHAT.length];
}
function extractTagsChat(text=''){
  return [...new Set((text.match(/#\w+/g)||[]).map(t=>t.toLowerCase()))];
}
function fmtTimestamp(iso){
  if(!iso) return '';
  const d=new Date(iso), now=new Date();
  const diffDays=Math.floor((now-d)/86400000);
  if(diffDays===0) return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  if(diffDays===1) return 'Yesterday '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  if(diffDays<7)   return d.toLocaleDateString('en-GB',{weekday:'short'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
const CHAT_PAGE = 50;

function ChatThreadInline({ caseId, studentName }) {
  const sessionRef = useRef(getOrgSession());
  const session    = sessionRef.current;
  const myId       = session?.member_id || null;
  const myName     = session?.full_name || session?.name || session?.email || 'You';

  const [messages,    setMessages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset,      setOffset]      = useState(0);
  const [draft,       setDraft]       = useState('');
  const [replyTo,     setReplyTo]     = useState(null);
  const [searchText,  setSearchText]  = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [summarizing,  setSummarizing]  = useState(false);
  const [summaryCard,  setSummaryCard]  = useState(null);
  const [summaryOpen,  setSummaryOpen]  = useState(false);
  const [summaryCopied,     setSummaryCopied]     = useState(false);
  const [summaryNoteSaving, setSummaryNoteSaving] = useState(false);
  const [summaryNoteSaved,  setSummaryNoteSaved]  = useState(false);

  // ── @mention state ────────────────────────────────────────────────────
  // orgMembers: [{id, full_name}] fetched once per org, shared via module-level cache
  const [orgMembers,      setOrgMembers]      = useState([]);
  const [mentionQuery,    setMentionQuery]    = useState('');   // text after the trigger '@'
  const [mentionOpen,     setMentionOpen]     = useState(false);
  const [mentionedIds,    setMentionedIds]    = useState([]);   // resolved member UUIDs for this draft
  const mentionPopoverRef = useRef(null);
  // ─────────────────────────────────────────────────────────────────────

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const searchRef = useRef(null);

  // Fetch org members once when the thread mounts (or org changes)
  useEffect(()=>{
    if(!session?.org_id) return;
    supabase.from('profiles')
      .select('id, full_name')
      .eq('org_id', session.org_id)
      .eq('is_active', true)
      .neq('id', myId)          // exclude self — no point @mentioning yourself
      .then(({data})=>{ if(data) setOrgMembers(data); });
  },[session?.org_id, myId]);

  const loadMessages = useCallback(async (fromOffset=0, append=false) => {
    if(!caseId||!session?.org_id) return;
    if(fromOffset===0) setLoading(true); else setLoadingMore(true);
    const {data,error} = await supabase
      .from('chat_messages').select('*')
      .eq('case_id',caseId).eq('org_id',session.org_id)
      .order('created_at',{ascending:false})
      .range(fromOffset,fromOffset+CHAT_PAGE-1);
    if(!error&&data){
      const sorted=[...data].reverse();
      setMessages(prev=>append?[...sorted,...prev]:sorted);
      setHasMore(data.length===CHAT_PAGE);
      setOffset(fromOffset+data.length);
    }
    setLoading(false); setLoadingMore(false);
  },[caseId,session?.org_id]);

  useEffect(()=>{
    setMessages([]); setOffset(0); setHasMore(false);
    setDraft(''); setReplyTo(null); setSearchText('');
    setMentionedIds([]); setMentionOpen(false);
    loadMessages(0,false);
    markChatRead();
  },[caseId,loadMessages]);

  useEffect(()=>{
    if(!searchOpen&&!searchText) bottomRef.current?.scrollIntoView({behavior:'smooth'});
  },[messages.length,searchOpen,searchText]);

  // Realtime
  useEffect(()=>{
    if(!caseId||!session?.org_id) return;
    const ch = supabase.channel(`fchat-${caseId}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:`case_id=eq.${caseId}`},payload=>{
        const msg=payload.new; if(!msg?.id) return;
        setMessages(prev=>prev.some(m=>m.id===msg.id)?prev:[...prev,msg]);
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_messages',filter:`case_id=eq.${caseId}`},payload=>{
        const u=payload.new; if(!u?.id) return;
        setMessages(prev=>prev.map(m=>m.id===u.id?{...m,...u}:m));
      })
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[caseId,session?.org_id]);

  async function markChatRead(){
    if(!caseId||!myId||!session?.org_id) return;
    try{ await supabase.from('chat_reads').upsert({
      case_id:caseId, org_id:session.org_id, member_id:myId,
      member_name:myName, last_read_at:new Date().toISOString(),
    },{onConflict:'case_id,member_id'}); }
    catch{}
  }

  // ── @mention: grant chat_reads access to mentioned members ───────────
  async function grantMentionAccess(ids) {
    if(!ids.length||!caseId||!session?.org_id) return;
    const now = new Date().toISOString();
    const rows = ids.map(memberId => {
      const m = orgMembers.find(om=>om.id===memberId);
      return {
        case_id:      caseId,
        org_id:       session.org_id,
        member_id:    memberId,
        member_name:  m?.full_name || '',
        last_read_at: now,
        granted_access: true,
      };
    });
    try {
      await supabase.from('chat_reads').upsert(rows, { onConflict:'case_id,member_id' });
    } catch {}
  }

  // Parse @Name mentions from the draft text — resolve to member UUIDs
  function resolveMentionIds(text) {
    const matches = [...text.matchAll(/@([\w\s]+?)(?=\s@|\s#|$)/g)].map(m=>m[1].trim().toLowerCase());
    return orgMembers
      .filter(m => matches.some(q => m.full_name?.toLowerCase().startsWith(q)))
      .map(m => m.id);
  }

  async function handleSend(){
    const text=draft.trim();
    if(!text||!caseId||!session?.org_id||sending) return;
    setSending(true); setDraft(''); setReplyTo(null); setMentionOpen(false);
    const tags=extractTagsChat(text);
    // Resolve final mentioned IDs from the message text (covers manual typing too)
    const finalMentionedIds = [...new Set([...mentionedIds, ...resolveMentionIds(text)])];
    await supabase.from('chat_messages').insert({
      case_id:caseId, org_id:session.org_id,
      sender_id:myId, sender_name:myName,
      sender_color:senderColorChat(myName).color,
      content:text, tags,
      reply_to_id:replyTo?.id||null,
      attachments:[], is_deleted:false,
      mentioned_ids: finalMentionedIds.length ? finalMentionedIds : null,
    });
    // Grant chat_reads access to every mentioned member
    if(finalMentionedIds.length) await grantMentionAccess(finalMentionedIds);
    setMentionedIds([]);
    setSending(false);
    markChatRead();
    inputRef.current?.focus();
  }

  async function handleDelete(msgId){
    await supabase.from('chat_messages').update({is_deleted:true}).eq('id',msgId).eq('org_id',session.org_id);
    setMessages(prev=>prev.map(m=>m.id===msgId?{...m,is_deleted:true}:m));
  }

  // ── @mention popover filtering ────────────────────────────────────────
  const mentionSuggestions = useMemo(()=>{
    if(!mentionQuery) return orgMembers.slice(0,8);
    const q = mentionQuery.toLowerCase();
    return orgMembers.filter(m=>m.full_name?.toLowerCase().startsWith(q)).slice(0,8);
  },[orgMembers, mentionQuery]);

  // Detect '@' trigger in draft text and open/close the popover
  function handleDraftChange(e) {
    const val = e.target.value;
    setDraft(val);
    // Find the last '@' in the text that isn't followed by a space yet
    const cursor = e.target.selectionStart;
    const textUpToCursor = val.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf('@');
    if(atIdx !== -1) {
      const fragment = textUpToCursor.slice(atIdx+1);
      // Only open popover if fragment has no spaces (mid-word typing)
      if(!/\s/.test(fragment)) {
        setMentionQuery(fragment);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery('');
  }

  // Insert selected member into the draft at the '@' position
  function selectMention(member) {
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const textUpToCursor = draft.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf('@');
    const before = draft.slice(0, atIdx);
    const after  = draft.slice(cursor);
    const inserted = `@${member.full_name} `;
    setDraft(before + inserted + after);
    setMentionedIds(prev=>[...new Set([...prev, member.id])]);
    setMentionOpen(false);
    setMentionQuery('');
    setTimeout(()=>{
      const newPos = before.length + inserted.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  /* ── AI Summary ─────────────────────────────────────────────────── */
  async function summarizeChat() {
    if (!caseId || !session?.org_id || summarizing) return;
    setSummarizing(true);
    try {
      const { data: chatMsgs, error } = await supabase
        .from('chat_messages')
        .select('sender_name, content, created_at')
        .eq('case_id', caseId)
        .eq('org_id', session.org_id)
        .eq('is_deleted', false)
        .neq('is_system', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      if (!chatMsgs || chatMsgs.length === 0) {
        setSummaryCard({ text: 'No messages to summarize yet.' });
        setSummaryOpen(true);
        return;
      }
      const lines = [...chatMsgs].reverse().map(m => `[${m.sender_name}]: ${m.content}`).join('\n');
      const { data: { session: authSess } } = await supabase.auth.getSession();
      const token = authSess?.access_token || session.access_token || '';
      const resp = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          org_id: session.org_id,
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: 'You are summarizing a visa case team chat. Extract: key decisions made, pending actions, who is responsible for what, any deadlines mentioned. Be concise — max 150 words. Format with short bullet points grouped under bold headings: **Decisions**, **Pending Actions**, **Deadlines**. Omit any heading that has nothing to report.',
          messages: [{ role: 'user', content: `Summarize this team chat:\n\n${lines}` }],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || 'API error');
      const summaryText = data.content?.map(b => b.text || '').join('') || '(no summary)';
      setSummaryCard({ text: summaryText });
      setSummaryOpen(true);
      await supabase.from('chat_messages').insert({
        case_id: caseId, org_id: session.org_id,
        sender_id: myId, sender_name: myName, sender_color: '#6B7280',
        content: `📋 AI Chat Summary\n\n${summaryText}`,
        tags: [], attachments: [], is_deleted: false, is_system: true, type: 'ai_summary',
      });
    } catch (e) {
      setSummaryCard({ text: `⚠️ Could not summarize: ${e.message}` });
      setSummaryOpen(true);
    } finally {
      setSummarizing(false);
    }
  }

  const displayMessages = useMemo(()=>{
    if(!searchText) return messages;
    const lc=searchText.toLowerCase();
    return messages.filter(m=>m.content?.toLowerCase().includes(lc)||m.sender_name?.toLowerCase().includes(lc));
  },[messages,searchText]);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'var(--s1)',position:'relative'}}>
      {/* ── Toolbar ── */}
      <div style={{display:'flex',alignItems:'center',gap:5,padding:'6px 10px',borderBottom:'1px solid var(--bd)',background:'var(--s2)',flexShrink:0}}>
        <span style={{flex:1,fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)'}}>
          {messages.filter(m=>!m.is_deleted).length} messages
        </span>
        <button onClick={()=>{setSearchOpen(o=>!o);setTimeout(()=>searchRef.current?.focus(),50);}}
          style={{width:26,height:26,borderRadius:5,border:'none',background:searchOpen?'var(--p)':'var(--s3)',color:searchOpen?'#fff':'var(--t3)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
          title="Search messages">
          <Search size={12}/>
        </button>
        <button
          onClick={summarizeChat}
          disabled={summarizing}
          title="AI Summary — summarize this team chat"
          style={{
            width:26,height:26,borderRadius:5,border:'none',
            background:summarizing?'var(--s3)':'rgba(124,58,237,.12)',
            color:summarizing?'var(--t3)':'#7C3AED',
            cursor:summarizing?'default':'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',
            transition:'background .15s',flexShrink:0,
          }}
          onMouseEnter={e=>{if(!summarizing) e.currentTarget.style.background='rgba(124,58,237,.22)';}}
          onMouseLeave={e=>{if(!summarizing) e.currentTarget.style.background='rgba(124,58,237,.12)';}}
        >
          {summarizing
            ? <Loader2 size={11} style={{animation:'spin .7s linear infinite'}}/>
            : <Sparkles size={12}/>
          }
        </button>
      </div>

      {/* ── Search bar (conditional) ── */}
      {searchOpen&&(
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',borderBottom:'1px solid var(--bd)',background:'var(--s2)',flexShrink:0}}>
          <Search size={11} color="var(--t3)"/>
          <input ref={searchRef} value={searchText} onChange={e=>setSearchText(e.target.value)}
            placeholder="Search messages…"
            style={{flex:1,border:'none',background:'transparent',fontSize:12,fontFamily:'var(--fu)',color:'var(--t1)',outline:'none'}}/>
          {searchText&&<button onClick={()=>setSearchText('')} style={{border:'none',background:'none',cursor:'pointer',color:'var(--t3)',padding:0}}><X size={11}/></button>}
        </div>
      )}

      {/* ── AI Summary overlay ── */}
      {summaryCard&&summaryOpen&&(
        <div style={{position:'absolute',inset:0,zIndex:400,display:'flex',flexDirection:'column',background:'var(--s1)',animation:'sd-slide-up .18s ease'}}>
          <style>{`@keyframes sd-slide-up{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderBottom:'1px solid var(--bd)',background:'var(--s2)',flexShrink:0}}>
            <div style={{width:28,height:28,borderRadius:7,background:'rgba(124,58,237,.12)',border:'1px solid rgba(124,58,237,.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Sparkles size={14} color="#7C3AED"/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--t1)',fontFamily:'var(--fh)'}}>AI Chat Summary</div>
              <div style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)'}}>{studentName}</div>
            </div>
            <button onClick={()=>setSummaryOpen(false)} style={{width:26,height:26,borderRadius:5,border:'none',background:'var(--s3)',color:'var(--t2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <X size={12}/>
            </button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'14px'}}>
            {summaryCard.text.split('\n').map((line,i)=>{
              if(/^\*\*(.+)\*\*$/.test(line)) return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginTop:i>0?14:0,marginBottom:5}}>
                  <div style={{width:3,height:13,borderRadius:2,background:'#7C3AED',flexShrink:0}}/>
                  <span style={{fontSize:10,fontWeight:800,color:'#7C3AED',fontFamily:'var(--fh)',textTransform:'uppercase',letterSpacing:'.07em'}}>{line.replace(/\*\*/g,'')}</span>
                </div>
              );
              if(line.startsWith('• ')||line.startsWith('- ')) return (
                <div key={i} style={{display:'flex',gap:7,marginTop:5,paddingLeft:9}}>
                  <span style={{color:'#7C3AED',flexShrink:0,fontSize:14,lineHeight:1,marginTop:1}}>·</span>
                  <span style={{fontSize:12,color:'var(--t1)',fontFamily:'var(--fu)',lineHeight:1.6}}>{line.slice(2)}</span>
                </div>
              );
              return line?<div key={i} style={{fontSize:12,color:'var(--t2)',fontFamily:'var(--fu)',lineHeight:1.6,marginTop:3}}>{line}</div>:null;
            })}
          </div>
          <div style={{display:'flex',gap:6,padding:'10px 12px',borderTop:'1px solid var(--bd)',background:'var(--s2)',flexShrink:0}}>
            <button
              onClick={()=>{ navigator.clipboard?.writeText(summaryCard.text).catch(()=>{}); setSummaryCopied(true); setTimeout(()=>setSummaryCopied(false),1800); }}
              style={{display:'flex',alignItems:'center',gap:5,padding:'0 11px',height:30,borderRadius:6,border:'none',background:summaryCopied?'rgba(5,150,105,.12)':'rgba(124,58,237,.1)',color:summaryCopied?'#059669':'#7C3AED',fontSize:10,fontWeight:700,fontFamily:'var(--fu)',cursor:'pointer',transition:'all .15s',whiteSpace:'nowrap'}}
            >
              {summaryCopied ? <Check size={11}/> : <Copy size={11}/>}
              {summaryCopied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={async()=>{
                if(summaryNoteSaved||summaryNoteSaving) return;
                setSummaryNoteSaving(true);
                try{
                  await supabase.from('doc_events').insert({
                    case_id:caseId, org_id:session.org_id,
                    event_category:'note', doc_type:'ai_summary',
                    source:'ai_chat_summary', changed_fields:[],
                    summary:`AI Chat Summary\n\n${summaryCard.text}`,
                    university_name:myName, confidence:1.0,
                    created_at:new Date().toISOString(),
                  });
                  setSummaryNoteSaved(true); setTimeout(()=>setSummaryNoteSaved(false),2500);
                }catch(e){console.error('[summary] save note:',e);}
                finally{setSummaryNoteSaving(false);}
              }}
              style={{display:'flex',alignItems:'center',gap:5,padding:'0 11px',height:30,borderRadius:6,border:'none',background:summaryNoteSaved?'rgba(5,150,105,.12)':'rgba(124,58,237,.1)',color:summaryNoteSaved?'#059669':'#7C3AED',fontSize:10,fontWeight:700,fontFamily:'var(--fu)',cursor:summaryNoteSaving||summaryNoteSaved?'default':'pointer',transition:'all .15s',whiteSpace:'nowrap'}}
            >
              {summaryNoteSaving?<Loader2 size={10} style={{animation:'spin .7s linear infinite'}}/>:summaryNoteSaved?<Check size={11}/>:<FileText size={11}/>}
              {summaryNoteSaved?'Saved to Timeline!':summaryNoteSaving?'Saving…':'Save as Note'}
            </button>
            <button onClick={()=>setSummaryOpen(false)} style={{marginLeft:'auto',padding:'0 10px',height:30,borderRadius:6,border:'1px solid var(--bd)',background:'transparent',color:'var(--t3)',fontSize:10,fontFamily:'var(--fu)',cursor:'pointer'}}>
              Back to chat
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'10px 10px',display:'flex',flexDirection:'column',gap:2}}>
        {hasMore&&!searchText&&(
          <button onClick={()=>loadMessages(offset,true)} disabled={loadingMore}
            style={{alignSelf:'center',display:'flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:5,background:'var(--s2)',border:'1px solid var(--bd)',color:'var(--t3)',fontSize:10,fontFamily:'var(--fu)',cursor:loadingMore?'default':'pointer',marginBottom:6}}>
            {loadingMore?<Loader2 size={10} style={{animation:'spin .7s linear infinite'}}/>:<ChevronDown size={10} style={{transform:'rotate(180deg)'}}/>}
            Load earlier
          </button>
        )}
        {loading?(
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Loader2 size={16} color="var(--t3)" style={{animation:'spin .7s linear infinite'}}/>
          </div>
        ):displayMessages.length===0?(
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'24px 0'}}>
            <MessageSquare size={24} color="var(--s3)"/>
            <span style={{fontSize:12,color:'var(--t3)',fontFamily:'var(--fu)'}}>
              {searchText?'No messages match':'Start the conversation'}
            </span>
          </div>
        ):(
          displayMessages.map((msg,idx)=>{
            const isMe=msg.sender_id===myId;
            const pal=senderColorChat(msg.sender_name||'');
            const prev=displayMessages[idx-1];
            const grouped=prev&&prev.sender_id===msg.sender_id&&(new Date(msg.created_at)-new Date(prev.created_at))<120000;
            const replyPreview=msg.reply_to_id?messages.find(m=>m.id===msg.reply_to_id):null;
            if(msg.is_deleted) return(
              <div key={msg.id} style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)',fontStyle:'italic',padding:'1px 34px',marginTop:grouped?0:6}}>Message deleted</div>
            );
            if(msg.is_system) {
              return (
                <div key={msg.id} style={{
                  display:'flex', alignItems:'center', gap:6,
                  margin:'8px 0', padding:'0 4px',
                }}>
                  <div style={{ flex:1, height:1, background:'var(--bd)' }}/>
                  <div style={{
                    display:'flex', alignItems:'center', gap:5,
                    padding:'3px 9px', borderRadius:20,
                    background:'var(--s2)', border:'1px solid var(--bd)',
                    fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)',
                    whiteSpace:'nowrap',
                  }}>
                    <ClipboardList size={9} color="var(--p)"/>
                    <span>{msg.content}</span>
                  </div>
                  <div style={{ flex:1, height:1, background:'var(--bd)' }}/>
                </div>
              );
            }
            return(
              <InlineMsgRow key={msg.id} msg={msg} isMe={isMe} pal={pal} grouped={grouped}
                replyPreview={replyPreview}
                onReply={()=>setReplyTo({id:msg.id,sender_name:msg.sender_name,content:msg.content})}
                onDelete={msg.sender_id===myId?()=>handleDelete(msg.id):null}
              />
            );
          })
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Reply preview */}
      {replyTo&&(
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'rgba(29,107,232,.06)',borderTop:'1px solid rgba(29,107,232,.15)',flexShrink:0}}>
          <Reply size={11} color="#1D6BE8"/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:9,fontWeight:700,color:'#1D6BE8',fontFamily:'var(--fu)',marginBottom:1}}>Replying to {replyTo.sender_name}</div>
            <div style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{replyTo.content?.slice(0,60)}{replyTo.content?.length>60?'…':''}</div>
          </div>
          <button onClick={()=>setReplyTo(null)} style={{border:'none',background:'none',cursor:'pointer',color:'var(--t3)',padding:2}}><X size={11}/></button>
        </div>
      )}

      {/* Compose — @mention popover anchored above the textarea */}
      <div style={{padding:'8px 10px',borderTop:replyTo?'none':'1px solid var(--bd)',background:'var(--s2)',flexShrink:0,display:'flex',gap:6,alignItems:'flex-end',position:'relative'}}>

        {/* @mention popover */}
        {mentionOpen && mentionSuggestions.length > 0 && (
          <div ref={mentionPopoverRef} style={{
            position:'absolute', bottom:'100%', left:10, right:44,
            background:'var(--s1)', border:'1px solid var(--bd)',
            borderRadius:8, boxShadow:'0 -4px 16px rgba(15,30,60,.18)',
            zIndex:310, marginBottom:4, overflow:'hidden',
          }}>
            <div style={{padding:'5px 10px',fontSize:9,fontWeight:700,color:'var(--t3)',fontFamily:'var(--fu)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--bd)'}}>
              Mention — grants chat access
            </div>
            {mentionSuggestions.map(m=>(
              <button key={m.id} onMouseDown={e=>{e.preventDefault();selectMention(m);}}
                style={{width:'100%',padding:'7px 12px',border:'none',background:'none',color:'var(--t1)',fontFamily:'var(--fu)',fontSize:12,cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:8,transition:'background var(--fast)'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}
              >
                <div style={{width:22,height:22,borderRadius:'50%',background:'rgba(29,107,232,.12)',border:'1.5px solid rgba(29,107,232,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#1D6BE8',fontFamily:'var(--fh)',flexShrink:0}}>
                  {(m.full_name||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
                </div>
                <span>{m.full_name}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={e=>{
            if(e.key==='Escape'){ if(mentionOpen){setMentionOpen(false);return;} if(replyTo) setReplyTo(null); }
            if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}
          }}
          placeholder={`Message about ${studentName}… (type @ to mention)`}
          rows={1}
          style={{flex:1,resize:'none',padding:'7px 10px',borderRadius:7,border:'1px solid var(--bd)',background:'var(--s1)',color:'var(--t1)',fontSize:12,fontFamily:'var(--fu)',lineHeight:1.5,outline:'none',maxHeight:90,overflowY:'auto',transition:'border-color var(--fast)'}}
          onFocus={e=>e.target.style.borderColor='var(--p)'}
          onBlur={e=>e.target.style.borderColor='var(--bd)'}
          onInput={e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,90)+'px';}}
        />
        <button onClick={handleSend} disabled={!draft.trim()||sending}
          style={{width:32,height:32,borderRadius:7,border:'none',background:draft.trim()?'var(--p)':'var(--s3)',color:draft.trim()?'#fff':'var(--t3)',cursor:draft.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all var(--fast)'}}>
          {sending?<Loader2 size={13} style={{animation:'spin .7s linear infinite'}}/>:<Send size={13}/>}
        </button>
      </div>
    </div>
  );
}

function InlineMsgRow({ msg, isMe, pal, grouped, replyPreview, onReply, onDelete }) {
  const [hover,setHover]=useState(false);
  return(
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{display:'flex',gap:6,alignItems:'flex-start',marginTop:grouped?2:8,flexDirection:isMe?'row-reverse':'row'}}>
      <div style={{width:24,flexShrink:0,marginTop:2}}>
        {!grouped&&(
          <div style={{width:24,height:24,borderRadius:'50%',background:pal.bg,color:pal.color,fontWeight:700,fontSize:9,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${pal.color}33`,fontFamily:'var(--fh)'}}>
            {(msg.sender_name||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
          </div>
        )}
      </div>
      <div style={{maxWidth:'75%',minWidth:0,display:'flex',flexDirection:'column',alignItems:isMe?'flex-end':'flex-start'}}>
        {!grouped&&(
          <div style={{display:'flex',alignItems:'baseline',gap:5,marginBottom:2,flexDirection:isMe?'row-reverse':'row'}}>
            <span style={{fontSize:10,fontWeight:700,color:pal.color,fontFamily:'var(--fh)'}}>{isMe?'You':msg.sender_name}</span>
            <span style={{fontSize:9,color:'var(--t3)',fontFamily:'var(--fu)'}}>{fmtTimestamp(msg.created_at)}</span>
          </div>
        )}
        {replyPreview&&(
          <div style={{padding:'3px 7px',borderRadius:'5px 5px 0 0',background:'var(--s3)',borderLeft:`2px solid ${pal.color}`,marginBottom:1,maxWidth:'100%'}}>
            <div style={{fontSize:9,fontWeight:700,color:pal.color,fontFamily:'var(--fu)',marginBottom:1}}>{replyPreview.sender_name}</div>
            <div style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{replyPreview.content?.slice(0,50)}{replyPreview.content?.length>50?'…':''}</div>
          </div>
        )}
        <div style={{padding:'6px 10px',borderRadius:replyPreview?'0 7px 7px 7px':grouped?(isMe?'7px 3px 3px 7px':'3px 7px 7px 3px'):(isMe?'7px 3px 7px 7px':'3px 7px 7px 7px'),background:isMe?'var(--p)':'var(--s2)',border:isMe?'none':'1px solid var(--bd)',color:isMe?'#fff':'var(--t1)',fontSize:12,fontFamily:'var(--fu)',lineHeight:1.5,wordBreak:'break-word',whiteSpace:'pre-wrap'}}>
          {(msg.content||'').split(/(#\w+|@\w+)/g).map((p,i)=>{
            if(/^#\w+/.test(p)) return <span key={i} style={{fontWeight:700,opacity:.85}}>{p}</span>;
            if(/^@/.test(p))    return <span key={i} style={{fontWeight:700,color:isMe?'rgba(255,255,255,.9)':'#1D6BE8',background:isMe?'rgba(255,255,255,.15)':'rgba(29,107,232,.1)',borderRadius:3,padding:'0 2px'}}>{p}</span>;
            return p;
          })}
        </div>
        {(msg.tags||[]).length>0&&(
          <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:2,justifyContent:isMe?'flex-end':'flex-start'}}>
            {(msg.tags||[]).map(tag=><span key={tag} style={{fontSize:8,fontWeight:700,fontFamily:'var(--fu)',padding:'1px 4px',borderRadius:3,background:'rgba(29,107,232,.1)',color:'#1D6BE8'}}>{tag}</span>)}
          </div>
        )}
      </div>
      <div style={{display:'flex',gap:2,alignItems:'center',opacity:hover?1:0,transition:'opacity .15s',flexDirection:isMe?'row':'row-reverse',alignSelf:'center'}}>
        <button onClick={onReply} style={{width:22,height:22,borderRadius:4,border:'none',background:'var(--s3)',color:'var(--t3)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} title="Reply">
          <Reply size={10}/>
        </button>
        {onDelete&&<button onClick={onDelete} style={{width:22,height:22,borderRadius:4,border:'none',background:'var(--s3)',color:'var(--t3)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} title="Delete">
          <Trash2 size={10}/>
        </button>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FLOATING CHAT PANEL
   ─────────────────────────────────────────────────────────────────────
   Renders at dashboard level (z-index 200), NOT inside the QuickPeekDrawer.
   Counsellors can keep it open while browsing the pipeline, dragging cards,
   or opening other students' drawers. Minimise to a compact header bar.
   Resize: fixed 380px wide, full-height on the left side so it doesn't
   obscure the kanban. Escape key closes, title bar drag is intentionally
   omitted — position is predictable (bottom-left corner).
════════════════════════════════════════════════════════════════════════ */
function FloatingChatPanel({ student, onClose }) {
  const [minimised, setMinimised] = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  if (!student) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: 360,
      height: minimised ? 48 : 'min(600px, 80vh)',
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--s1)',
      border: '1px solid var(--bd)',
      borderBottom: 'none',
      borderRadius: '12px 12px 0 0',
      boxShadow: '0 -4px 32px rgba(15,30,60,.18)',
      transition: 'height .2s var(--eout)',
      overflow: 'hidden',
    }}>
      {/* ── Title bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px', height: 48, flexShrink: 0,
        background: 'var(--s2)', borderBottom: minimised ? 'none' : '1px solid var(--bd)',
        cursor: 'pointer', userSelect: 'none',
      }}
        onClick={() => setMinimised(m => !m)}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(29,107,232,.12)', border: '1.5px solid rgba(29,107,232,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: '#1D6BE8', fontFamily: 'var(--fh)',
        }}>
          {(student.studentName || '?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {student.studentName}
          </div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            {minimised ? 'Click to expand chat' : 'Case chat · click to minimise'}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); setMinimised(m => !m); }}
          title={minimised ? 'Expand' : 'Minimise'}
          style={{
            width: 26, height: 26, borderRadius: 6, border: 'none',
            background: 'var(--s3)', color: 'var(--t2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {minimised
            ? <ChevronRight size={13} style={{ transform: 'rotate(-90deg)' }}/>
            : <ChevronDown size={13}/>
          }
        </button>
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          title="Close chat"
          style={{
            width: 26, height: 26, borderRadius: 6, border: 'none',
            background: 'var(--s3)', color: 'var(--t2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <X size={13}/>
        </button>
      </div>

      {/* ── Thread body — only rendered when expanded ── */}
      {!minimised && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatThreadInline caseId={student.id} studentName={student.studentName}/>
        </div>
      )}
    </div>
  );
}

function DrawerInfoRow({ icon, label, children }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
      <div style={{ width:22, height:22, borderRadius:6, background:'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--t3)', marginTop:1 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:3 }}>{label}</div>
        {children}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="sdb-row" style={{ pointerEvents:'none' }}>
      {[16,32,1,80,60,40,72,55].map((w,i)=>(
        <div key={i} style={{ width:w, height:i===1?w:14, borderRadius:i===1?'50%':4, background:'var(--s3)', animation:'sdb-shimmer 1.4s infinite', animationDelay:`${i*0.07}s`, flexShrink:0 }}/>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════ */
export default function StudentDashboard({ onLoad, onOpenMatcher, totalCases: totalCasesProp, lastSaved, orgSession, orgCredits, policyAlerts=[], inboxAlerts=[], callGeminiInsight, onOpenChat, onUpdateStatus, onPaymentUpdate, openChatCount=0, onPeekChange }) {
  const [cases,      setCases]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);
  const [savingId,        setSavingId]        = useState(null);
  const [bulkSaving,      setBulkSaving]      = useState(false);
  const [allCounsellors,  setAllCounsellors]  = useState([]); // [{id, full_name}] from profiles

  const [viewMode,    setViewMode]    = useState('board');   
  const [peekStudent, setPeekStudent] = useState(null);
  const [peekDocsTab, setPeekDocsTab] = useState(false);

  // Notify parent when peek drawer opens/closes so chat tray can shift
  useEffect(() => { onPeekChange?.(!!peekStudent); }, [peekStudent]);

  // Wrapper: close peek drawer before opening the full case view
  function handleOpenFull(c) { setPeekStudent(null); setPeekDocsTab(false); onLoad(c); }
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [nameSearch,       setNameSearch]       = useState('');
  const [stageFilter,      setStageFilter]      = useState('all');
  const [counsellorFilter, setCounsellorFilter] = useState('All');
  const [countryFilter,    setCountryFilter]    = useState('All');
  const [scoreFilter,      setScoreFilter]      = useState('All');
  const [expiryFilter,     setExpiryFilter]     = useState('All');
  const [staleFilter,      setStaleFilter]      = useState(false);
  const [omniResultIds,    setOmniResultIds]    = useState(null); // null = no omni search active; Set = active AI filter
  
  // Default to action queue open for the right sidebar
  const [activePanel,      setActivePanel]      = useState('queue');

  // Morning Brief
  const [briefOpen,        setBriefOpen]        = useState(false);
  const [briefLoading,     setBriefLoading]     = useState(false);
  const [briefText,        setBriefText]        = useState(null);
  const [briefOverdueTasks,setBriefOverdueTasks]= useState([]);

  // Chat is now app-level via onOpenChat prop — persists across tab changes

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await fetchAllCases();
    setCases(rows);
    setLastLoaded(new Date());
    setLoading(false);
    setSelectedIds(new Set());
  }, []);

  // ── Fetch all active counsellors from profiles (not just names on cases) ──
  useEffect(() => {
    const s = getOrgSession();
    if (!s?.org_id) return;
    supabase.from('profiles')
      .select('id, full_name')
      .eq('org_id', s.org_id)
      .eq('is_active', true)
      .then(({ data }) => { if (data) setAllCounsellors(data); });
  }, [orgSession?.org_id]);

  // ── Quadrant movement tracking — persisted per org in localStorage ──────
  const [previousQuadrants, setPreviousQuadrants] = useState(() => {
    try {
      const s = getOrgSession();
      return JSON.parse(localStorage.getItem(`visalens_quadrants_${s?.org_id}`) || '{}');
    } catch { return {}; }
  });

  const handleQuadrantsComputed = useCallback((quadrantMap) => {
    try {
      const s = getOrgSession();
      if (!s?.org_id) return;
      // Save as the new "previous" snapshot for the next session
      localStorage.setItem(`visalens_quadrants_${s.org_id}`, JSON.stringify(quadrantMap));
      // Update state so drift arrows stay live within the same session when cases reload
      setPreviousQuadrants(prev => {
        // Only update state if something actually changed (avoid infinite re-render)
        const hasChange = Object.keys(quadrantMap).some(id => prev[id] !== quadrantMap[id]);
        return hasChange ? { ...prev, ...quadrantMap } : prev;
      });
    } catch { /* localStorage unavailable — silently skip */ }
  }, []);

  const handleRadarReassign = useCallback(async (caseId, counsellorName) => {
    const ts = new Date().toISOString();
    const fromCounsellor = cases.find(c => c.id === caseId)?.counsellorName || null;
    const studentName    = cases.find(c => c.id === caseId)?.studentName    || null;
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, counsellorName, updatedAt: ts } : c));
    _nbaCache.delete(caseId);
    _geminiInsightCache.delete(caseId);
    const s = getOrgSession();
    if (!s?.org_id) return;
    const { error } = await supabase.from('cases')
      .update({ counsellor_name: counsellorName, updated_at: ts })
      .eq('id', caseId).eq('org_id', s.org_id);
    if (!error) {
      logAuditEvent(caseId, 'CASE_REASSIGNED', {
        from_counsellor: fromCounsellor,
        to_counsellor:   counsellorName,
      });

      // ── Notify the newly assigned counsellor ────────────────────────────
      // Resolve counsellor name → profile UUID, then fire-and-forget
      try {
        const { data: recipientProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('org_id', s.org_id)
          .eq('full_name', counsellorName)
          .eq('is_active', true)
          .single();

        if (recipientProfile?.id && recipientProfile.id !== s.member_id) {
          fetch(`${PROXY_URL}/api/notify`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              recipient_ids: [recipientProfile.id],
              sender_id:     s.member_id,
              sender_name:   s.full_name || s.name || null,
              type:          'reassign',
              case_id:       caseId,
              case_name:     studentName,
              message_id:    null,
              body:          `${s.full_name || s.name || 'A colleague'} assigned ${studentName || 'a case'} to you`,
            }),
          }).catch(() => {});
        }
      } catch { /* non-fatal — reassign already succeeded */ }
    }
  }, [cases]);

  // ── Live visa_rules from Supabase — merges over COUNTRY_RULES_FALLBACK ──
  const [liveVisaRules, setLiveVisaRules] = useState({});
  useEffect(() => {
    async function loadVisaRules() {
      try {
        const { data, error } = await supabase
          .from('visa_rules')
          .select('country,required_fields,recommended_fields');
        if (error || !data?.length) return;
        const merged = {};
        for (const row of data) {
          merged[row.country] = {
            required:    (row.required_fields    || []).map(f => typeof f === 'string' ? { field: f, label: f } : f),
            recommended: (row.recommended_fields || []).map(f => typeof f === 'string' ? { field: f, label: f } : f),
          };
        }
        setLiveVisaRules(merged);
      } catch { /* silently fall back to COUNTRY_RULES_FALLBACK */ }
    }
    loadVisaRules();
  }, []);

  useEffect(()=>{ load(); },[totalCasesProp,lastSaved,load]);

  /* ─── Supabase Realtime: patch changed cases into local state ────────────
   *
   * Subscribes to UPDATE events on the `cases` table filtered to the current
   * org. When a row changes (e.g. the analyzer saves a re-assess result, or
   * the matcher writes new application_targets), we merge only the changed
   * fields into the matching case in state — no full re-fetch needed.
   *
   * IMPORTANT: Realtime postgres_changes requires the table to have replication
   * enabled in Supabase (Table Editor → Replication → cases). If you don't see
   * live updates, check that setting first.
   *
   * KNOWN LIMITATION: The `filter` parameter on postgres_changes only supports
   * simple equality comparisons. This means we get events for the whole org,
   * which is correct — but if an org has >500 cases and many counsellors are
   * active simultaneously, event volume could get noisy. Consider debouncing
   * the setCases call if that becomes a problem.
   */
  useEffect(() => {
    const session = getOrgSession();
    if (!session?.org_id) return; // No session — don't subscribe

    const channel = supabase
      .channel('cases-live')
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'cases',
          filter: `org_id=eq.${session.org_id}`,
        },
        payload => {
          const updated = payload.new;
          if (!updated?.id) return; // Malformed event — skip

          setCases(prev => prev.map(c => {
            if (c.id !== updated.id) return c;
            return {
              ...c,
              // Only overwrite fields that are non-null in the payload so a
              // partial update (e.g. only lead_status changed) doesn't clear
              // fields that weren't part of the write.
              overallScore:       updated.overall_score      ?? c.overallScore,
              leadStatus:         updated.lead_status        ?? c.leadStatus,
              notes:              updated.notes              ?? c.notes,
              applicationTargets: updated.application_targets ?? c.applicationTargets,
              expiryDate:         updated.expiry_date        ?? c.expiryDate,
              expiryDocType:      updated.expiry_doc_type    ?? c.expiryDocType,
              results:            updated.results            ?? c.results,
              profileData:        updated.profile_data       ?? c.profileData,
              updatedAt:          updated.updated_at         ?? c.updatedAt,
              statusUpdatedAt:    updated.status_updated_at  ?? c.statusUpdatedAt,
              paymentStatus:      updated.payment_status     ?? c.paymentStatus,
              counsellorName:     updated.counsellor_name    ?? c.counsellorName,
            };
          }));

          // If the Quick Peek drawer is open for the updated case, patch it too
          // so the counsellor sees the new score/status without closing and reopening.
          //
          // IMPORTANT: Supabase postgres_changes payloads are capped at ~1 MB and
          // frequently truncate large JSONB columns (results, profile_data). We
          // cannot rely on payload.new for those fields. Instead we do a targeted
          // single-row re-fetch for any case that is currently open in the peek
          // drawer — this guarantees DocChecklist always reads fresh data after
          // a re-assess or Save to History from the Analyzer.
          setPeekStudent(prev => {
            if (!prev || prev.id !== updated.id) return prev;
            // Apply the lightweight scalar fields immediately (fast)
            const patched = {
              ...prev,
              overallScore:       updated.overall_score      ?? prev.overallScore,
              leadStatus:         updated.lead_status        ?? prev.leadStatus,
              notes:              updated.notes              ?? prev.notes,
              applicationTargets: updated.application_targets ?? prev.applicationTargets,
              expiryDate:         updated.expiry_date        ?? prev.expiryDate,
              expiryDocType:      updated.expiry_doc_type    ?? prev.expiryDocType,
              updatedAt:          updated.updated_at         ?? prev.updatedAt,
              statusUpdatedAt:    updated.status_updated_at  ?? prev.statusUpdatedAt,
              paymentStatus:      updated.payment_status     ?? prev.paymentStatus,
              counsellorName:     updated.counsellor_name    ?? prev.counsellorName,
              // Apply JSONB only if present in payload (small cases); full re-fetch below covers the rest
              results:            updated.results            ?? prev.results,
              profileData:        updated.profile_data       ?? prev.profileData,
            };

            // Async re-fetch the full JSONB columns — bypasses payload size cap.
            // We do this in a fire-and-forget setTimeout so the sync setPeekStudent
            // return above completes first (React batching), then the re-fetch
            // patches again with guaranteed-complete data ~200ms later.
            setTimeout(async () => {
              try {
                const { data } = await supabase
                  .from('cases')
                  .select('id,results,profile_data,overall_score')
                  .eq('id', updated.id)
                  .maybeSingle();
                if (!data) return;
                setPeekStudent(cur => {
                  if (!cur || cur.id !== data.id) return cur;
                  return {
                    ...cur,
                    results:      data.results      ?? cur.results,
                    profileData:  data.profile_data ?? cur.profileData,
                    overallScore: data.overall_score ?? cur.overallScore,
                  };
                });
                // Also patch the cases list so Kanban/List cards reflect the new score
                setCases(prev => prev.map(c =>
                  c.id === data.id
                    ? { ...c,
                        results:      data.results      ?? c.results,
                        profileData:  data.profile_data ?? c.profileData,
                        overallScore: data.overall_score ?? c.overallScore,
                      }
                    : c
                ));
              } catch { /* silently ignore — stale data is better than a crash */ }
            }, 0);

            return patched;
          });

          // Bust the NBA cache for this case — its context may have changed
          _nbaCache.delete(updated.id);
          _geminiInsightCache.delete(updated.id);
        }
      )
      .subscribe(status => {
        // TODO: surface a "live" / "reconnecting" indicator in the UI if this
        // matters for your users. For now we just log.
        if (status === 'SUBSCRIBED') {
          console.info('[StudentDashboard] Realtime channel subscribed — cases-live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Supabase client auto-reconnects; this is just for observability.
          console.warn('[StudentDashboard] Realtime channel status:', status);
        }
      });

    // Unsubscribe when the component unmounts or session changes
    return () => { supabase.removeChannel(channel); };
  // `load` intentionally excluded — this subscription is independent of
  // the manual load trigger and should only re-run on session change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSession?.org_id]);

  const stats = useMemo(()=>{
    const alertSet = new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim())));
    return {
      total:    cases.length,
      vip:      cases.filter(c=>{ const v=viabilityScore(c.profileData)?.score??c.overallScore; const r=computeDocScore(c.profileData,c.results)?.score??0; const rPct=Math.round((r/(computeDocScore(c.profileData,c.results)?.totalPossible||100))*100); return v>=50&&rPct>=50; }).length,
      sales:    cases.filter(c=>{ const v=viabilityScore(c.profileData)?.score??c.overallScore; const r=computeDocScore(c.profileData,c.results)?.score??0; const rPct=Math.round((r/(computeDocScore(c.profileData,c.results)?.totalPossible||100))*100); return v>=50&&rPct<50; }).length,
      weak:     cases.filter(c=>c.overallScore<45).length,
      expiring: cases.filter(c=>{ const d=daysUntil(c.expiryDate); return d!==null&&d<=30&&d>=0; }).length,
      expired:  cases.filter(c=>{ const d=daysUntil(c.expiryDate); return d!==null&&d<0; }).length,
      alerted:  cases.filter(c=>alertSet.has((c.targetCountry||'').toLowerCase().trim())).length,
      stale:    cases.filter(isStale).length,
    };
  },[cases,policyAlerts]);

  const funnelCounts = useMemo(()=>{
    const map={}; FUNNEL_STAGES.forEach(s=>{ map[s.key]=0; });
    cases.forEach(c=>{ const st=FUNNEL_STAGES.find(s=>s.statuses.includes(c.leadStatus)); if(st) map[st.key]++; });
    return map;
  },[cases]);

  // Build counsellor list from profiles (newly-invited counsellors appear even if no cases assigned yet).
  // Merge any legacy counsellor_name text values that lack a matching profile.
  const counsellorOptions = useMemo(() => {
    const fromProfiles = allCounsellors.map(m => m.full_name).filter(Boolean);
    const fromCases    = cases.map(c => c.counsellorName).filter(Boolean);
    const merged       = [...new Set([...fromProfiles, ...fromCases])].sort();
    return ['All', ...merged];
  }, [allCounsellors, cases]);
  const countryOptions    = useMemo(()=>['All',...new Set(cases.map(c=>c.targetCountry).filter(Boolean))],[cases]);

const filtered = useMemo(()=>cases.filter(c=>{
    // 1. AI Omnibar: if an omni search is active, only show matched IDs
    if (omniResultIds !== null && !omniResultIds.has(c.id)) return false;  
    
    // 2. CRITICAL FIX: Only apply the literal string search if the AI didn't handle it
    if (omniResultIds === null && nameSearch.trim()) {
      if (!c.studentName.toLowerCase().includes(nameSearch.trim().toLowerCase())) return false;
    }

    if(stageFilter!=='all'){ const st=FUNNEL_STAGES.find(s=>s.key===stageFilter); if(st&&!st.statuses.includes(c.leadStatus)) return false; }
    if(counsellorFilter!=='All'&&c.counsellorName!==counsellorFilter) return false;
    if(countryFilter!=='All'&&c.targetCountry!==countryFilter) return false;
    if(scoreFilter!=='All'&&scoreBand(c.overallScore).label!==scoreFilter) return false;
    if(expiryFilter!=='All'){ const d=daysUntil(c.expiryDate); if(expiryFilter==='Urgent'&&!(d!==null&&d<=14&&d>=0)) return false; if(expiryFilter==='Soon'&&!(d!==null&&d<=30&&d>=0)) return false; }
    if(staleFilter&&!isStale(c)) return false;
    
    return true;
  }),[cases,omniResultIds,stageFilter,nameSearch,counsellorFilter,countryFilter,scoreFilter,expiryFilter,staleFilter]);

  const filtersActive = omniResultIds!==null||stageFilter!=='all'||nameSearch.trim()||counsellorFilter!=='All'||countryFilter!=='All'||scoreFilter!=='All'||expiryFilter!=='All'||staleFilter;


  function clearFilters() {
    setOmniResultIds(null); setNameSearch('');
    setStageFilter('all'); setCounsellorFilter('All');
    setCountryFilter('All'); setScoreFilter('All'); setExpiryFilter('All');
    setStaleFilter(false); setSelectedIds(new Set());
  }

  const actionQueue = useMemo(()=>cases.map(c=>{
    const d=daysUntil(c.expiryDate);
    return { ...c, urgency: (d!==null&&d<=30?(30-Math.max(d,0))*2:0)+(c.overallScore<45?20:0)+(isStale(c)?25:0)+(c.updatedAt?Math.min(Math.floor((Date.now()-new Date(c.updatedAt))/86400000),30):0)+(c.leadStatus==='Follow up'?15:0) };
  }).filter(c=>c.urgency>0).sort((a,b)=>b.urgency-a.urgency).slice(0,8),[cases]);

  // ── Auto-generate morning brief on first daily login ──
  useEffect(() => {
    if (actionQueue.length === 0) return;

    const today = new Date().toDateString();
    const s = getOrgSession();
    const userId = s?.email || s?.user_id || 'default';
    const briefKey = `lastMorningBriefDate_${userId}`;

    if (localStorage.getItem(briefKey) !== today) {
      // Generate morning brief on first login of the day
      handleMorningBrief();
      localStorage.setItem(briefKey, today);
    }
  }, [actionQueue]);

  const countryBreakdown = useMemo(()=>{
    const map={}; cases.forEach(c=>{ if(!c.targetCountry) return; if(!map[c.targetCountry]) map[c.targetCountry]={count:0,scoreSum:0}; map[c.targetCountry].count++; map[c.targetCountry].scoreSum+=c.overallScore; });
    return Object.entries(map).map(([country,d])=>({ country, count:d.count, avgScore:Math.round(d.scoreSum/d.count) })).sort((a,b)=>b.count-a.count).slice(0,8);
  },[cases]);

  const expiryRadar = useMemo(()=>cases.filter(c=>c.expiryDate).map(c=>({...c,days:daysUntil(c.expiryDate)})).sort((a,b)=>a.days-b.days).slice(0,8),[cases]);

  const scoreDist = useMemo(()=>({ strong:cases.filter(c=>c.overallScore>=70).length, moderate:cases.filter(c=>c.overallScore>=45&&c.overallScore<70).length, weak:cases.filter(c=>c.overallScore<45).length, total:cases.length }),[cases]);

  // ── Counsellor performance: quadrant distribution + movement per counsellor ──
  const counsellorPerf = useMemo(() => {
    const names = counsellorOptions.filter(n => n !== 'All');
    if (names.length < 2) return []; // only meaningful with multiple counsellors
    return names.map(name => {
      const myCases = cases.filter(c => c.counsellorName === name);
      const total   = myCases.length;
      if (total === 0) return { name, total: 0, vip: 0, sales: 0, drainers: 0, dead: 0, movedUp: 0, movedDown: 0, avgScore: 0, score: 0 };
      // Compute quadrant for each case using same logic as RadarMatrix
      const withQ = myCases.map(c => {
        const rawV  = viabilityScore(c.profileData)?.score ?? c.overallScore ?? 0;
        const doc   = computeDocScore(c.profileData, c.results);
        const rPct  = Math.round(((doc?.score ?? 0) / (doc?.totalPossible || 100)) * 100);
        let q = 'dead';
        if (rawV >= 50 && rPct >= 50) q = 'vip';
        else if (rawV >= 50 && rPct < 50) q = 'sales';
        else if (rawV < 50 && rPct >= 50) q = 'drainers';
        const prev = previousQuadrants[c.id];
        const moved = !!prev && prev !== q;
        const dir   = moved ? (['vip','sales'].includes(q) ? 'up' : 'down') : null;
        return { ...c, q, moved, dir };
      });
      const vip      = withQ.filter(c => c.q === 'vip').length;
      const sales    = withQ.filter(c => c.q === 'sales').length;
      const drainers = withQ.filter(c => c.q === 'drainers').length;
      const dead     = withQ.filter(c => c.q === 'dead').length;
      const movedUp  = withQ.filter(c => c.dir === 'up').length;
      const movedDown= withQ.filter(c => c.dir === 'down').length;
      const avgScore = Math.round(myCases.reduce((s, c) => s + (c.overallScore || 0), 0) / total);
      // Performance score: weight VIP heavy, penalise dead/drainers, bonus for upward movement
      const perfScore = Math.round(
        ((vip * 3 + sales * 2) / (total * 3)) * 60 +  // pipeline quality (60%)
        ((movedUp - movedDown) / Math.max(total, 1)) * 20 + // movement delta (20%)
        (avgScore / 100) * 20                              // avg case score (20%)
      );
      return { name, total, vip, sales, drainers, dead, movedUp, movedDown, avgScore, score: Math.max(0, Math.min(100, perfScore)) };
    }).sort((a, b) => b.score - a.score);
  }, [cases, counsellorOptions, previousQuadrants]);

  const alertCountries = useMemo(()=>new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim()))),[policyAlerts]);

  const handleStatusChange = useCallback(async(caseId,newStatus)=>{
    const ts=new Date().toISOString();
    // Capture current status before updating so audit log records the transition
    const currentStatus = cases.find(c=>c.id===caseId)?.leadStatus || null;
    setCases(prev=>prev.map(c=>c.id===caseId?{...c,leadStatus:newStatus,updatedAt:ts,statusUpdatedAt:ts}:c));
    setPeekStudent(prev=>prev?.id===caseId?{...prev,leadStatus:newStatus,updatedAt:ts,statusUpdatedAt:ts}:prev);
    _nbaCache.delete(caseId);
    _geminiInsightCache.delete(caseId);
    setSavingId(caseId);
    await updateLeadStatus(caseId,newStatus,currentStatus);
    setSavingId(null);
  },[cases]);

  const handleNoteUpdate = useCallback((caseId, updatedNotes)=>{
    const ts = new Date().toISOString();
    setCases(prev=>prev.map(c=>c.id===caseId?{...c,notes:updatedNotes,updatedAt:ts}:c));
    setPeekStudent(prev=>prev?.id===caseId?{...prev,notes:updatedNotes,updatedAt:ts}:prev);
    _nbaCache.delete(caseId);
    _geminiInsightCache.delete(caseId);
  },[]);

  const handlePaymentUpdate = useCallback((caseId, newStatus) => {
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, paymentStatus: newStatus } : c));
    setPeekStudent(prev => prev?.id === caseId ? { ...prev, paymentStatus: newStatus } : prev);
  }, []);

  const handleMorningBrief = useCallback(async () => {
    setBriefOpen(true);
    if (briefText) return;
    setBriefLoading(true);

    // 1. Urgent pipeline cases (existing)
    const top = actionQueue.slice(0, 8).map(c => ({
      id: c.id, studentName: c.studentName, targetCountry: c.targetCountry,
      leadStatus: c.leadStatus, overallScore: c.overallScore,
      updatedAt: c.updatedAt, expiryDate: c.expiryDate, expiryDocType: c.expiryDocType,
    }));

    // 2. Overdue tasks — fetch from Supabase, pass counts to brief
    let overdueTasks = [];
    try {
      const s = getOrgSession();
      if (s?.org_id) {
        // Wait for auth session to be ready before querying RLS-protected tables
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (authSession) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: tasks } = await supabase
            .from('case_tasks')
            .select('id, title, due_date, priority, assigned_to_name, case_id')
            .eq('org_id', s.org_id)
            .neq('status', 'done')
            .lt('due_date', today)
            .order('due_date', { ascending: true })
            .limit(20);
          overdueTasks = tasks || [];
        }
      }
    } catch { /* non-critical — brief still generates without tasks */ }

    const result = await fetchMorningBrief(top, overdueTasks);
    setBriefText(result || 'No urgent cases require immediate attention. Your pipeline is in good shape!');
    setBriefOverdueTasks(overdueTasks);
    setBriefLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actionQueue, briefText]);

  // ── AI Omnibar: send cases snapshot to worker, get back matching IDs ──────
  const handleAISearch = useCallback(async (val) => {
    if (!val.trim()) return;

    setLoading(true);
    try {
      // Build a lean snapshot — pre-compute derived fields so the prompt stays small
      const snapshot = cases.map(c => {
        const pd  = c.profileData || {};
        const res = c.results || {};
        const docs = Array.isArray(c.docList) ? c.docList : [];

        // Pre-compute english test presence
        const englishFields = ['ielts','ielts_score','toefl','toefl_score','pte','pte_score',
          'duolingo','duolingo_score','english_test','englishTest','english_score',
          'language_test','languageTest','oet','oet_score'];
        const hasEnglishTest = englishFields.some(f => pd[f] != null && pd[f] !== '' && pd[f] !== false);

        // Pre-compute missing docs list
        const missingDocs = [
          ...(Array.isArray(res.missing_requirements) ? res.missing_requirements : []),
          ...(Array.isArray(res.missing_docs) ? res.missing_docs : []),
          ...docs.filter(d => d?.status === 'missing' || d?.status === 'required')
                 .map(d => d.name || d.type || 'doc'),
        ].filter(Boolean).slice(0, 5); // cap at 5 to keep prompt tight

        // Pre-compute countries from applicationTargets (handles "Not found" targetCountry)
        const countriesInTargets = [...new Set(
          (c.applicationTargets || [])
            .map(t => t.country || t.target_country || t.targetCountry || '')
            .filter(x => x && x !== 'Not found')
        )].slice(0, 5);

        // All countries this student is associated with (deduped, compact)
        const allCountries = [...new Set([
          ...(c.targetCountry && c.targetCountry !== 'Not found' ? [c.targetCountry] : []),
          ...countriesInTargets,
        ])].join(', ') || undefined;  // undefined = omitted from JSON.stringify, avoids 'null' string

        // University names from targets (cap at 4 to stay token-light)
        const universities = (c.applicationTargets || [])
          .map(t => t.university || t.institution || '')
          .filter(Boolean).slice(0, 4);

        return {
          id:            c.id,
          n:             c.studentName,           // shorter key = fewer tokens
          st:            c.leadStatus,
          co:            allCountries,             // replaces targetCountry + applicationTargets
          sc:            c.overallScore,
          pay:           c.paymentStatus,
          adv:           c.counsellorName,
          exp:           c.expiryDate,
          ref:           c.referralSource || undefined,
          nat:           pd.nationality || pd.citizenship || pd.country_of_origin || undefined,
          deg:           pd.degree || pd.qualification || pd.education_level || undefined,
          field:         pd.field_of_study || pd.subject || pd.course || undefined,
          uni:           universities.length ? universities : undefined,
          eng:           hasEnglishTest || undefined,
          miss:          missingDocs.length ? missingDocs : undefined,
          ielts:         pd.ielts || pd.ielts_score || undefined,
          gpa:           pd.gpa   || undefined,
          upd:           c.updatedAt,
        };
      });

      console.log(`[omnibar:dashboard] query="${val}" snapshot_length=${snapshot.length}`);
      setViewMode('board'); // auto-switch to board so results are visible across all stages



      const res = await fetch(`${PROXY_URL}/proxy/omnibar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: val, cases: snapshot }),
      });

      console.log(`[omnibar:dashboard] worker HTTP status=${res.status}`);
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[omnibar:dashboard] worker error body:`, errText);
        throw new Error(`Omnibar HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log(`[omnibar:dashboard] worker response:`, JSON.stringify(data).slice(0, 400));

      // ── Handle BOTH response shapes ──────────────────────────────────────
      // New worker (data-aware): returns { case_ids: [...] }
      // Old/current worker (filter-translation): returns { filters: [...], search_term }
      if (Array.isArray(data.case_ids)) {
        console.log(`[omnibar:dashboard] case_ids path — matched ${data.case_ids.length} cases`);
        setOmniResultIds(new Set(data.case_ids));
        setStageFilter('all');
        setCountryFilter('All');
        setScoreFilter('All');
        setExpiryFilter('All');

      } else if (Array.isArray(data.filters)) {
        console.log(`[omnibar:dashboard] filters path — ${data.filters.length} filters, search_term="${data.search_term}"`);
        // Old approach: apply filters + do client-side matching against snapshot
        // Reset dropdowns
        setStageFilter('all');
        setCountryFilter('All');
        setScoreFilter('All');
        setExpiryFilter('All');
        setNameSearch('');

        // Build filter predicates from the returned filters
        const filterTests = data.filters.map(f => {
          if (f.col === 'target_country') {
            const needle = (f.val || '').toLowerCase();
            return c => {
              // Check top-level targetCountry
              if ((c.targetCountry || '').toLowerCase().includes(needle)) return true;
              // Also check applicationTargets array (country may be in targets but not top-level)
              if (Array.isArray(c.applicationTargets)) {
                return c.applicationTargets.some(t =>
                  (t.country || t.target_country || t.targetCountry || '').toLowerCase().includes(needle)
                );
              }
              return false;
            };
          }
          if (f.col === 'lead_status') {
            const val = (f.val || '').toLowerCase();
            return c => (c.leadStatus || '').toLowerCase().includes(val);
          }
          if (f.col === 'overall_score') {
            if (f.op === 'gt') return c => c.overallScore > f.val;
            if (f.op === 'lt') return c => c.overallScore < f.val;
            return c => c.overallScore === f.val;
          }
          if (f.col === 'payment_status') {
            return c => c.paymentStatus === f.val;
          }
          if (f.col === 'expiry_status') {
            return c => {
              const d = c.expiryDate ? Math.ceil((new Date(c.expiryDate) - new Date()) / 86400000) : null;
              if (f.val === 'Urgent') return d !== null && d <= 14 && d >= 0;
              if (f.val === 'Soon')   return d !== null && d <= 30 && d >= 0;
              return false;
            };
          }
          if (f.col === 'has_missing_docs') return c => c.missingDocs?.length > 0;
          if (f.col === 'has_english_test') return c => c.hasEnglishTest === f.val;
          return () => true;
        });

        // Run all filters against the local snapshot
        const matchedIds = snapshot
          .filter(c => filterTests.every(test => test(c)))
          .map(c => c.id);

        setOmniResultIds(new Set(matchedIds));

        if (data.search_term) setNameSearch(data.search_term);
      }

    } catch (err) {
      console.error('[Omnibar] Error:', err);
      // Graceful fallback: treat the whole query as a plain name search
      setNameSearch(val);
    } finally {
      setLoading(false);
    }
  }, [cases]);
  const toggleSelect = useCallback(id=>{
    setSelectedIds(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  },[]);

  const toggleSelectAll = useCallback(()=>{
    setSelectedIds(prev=>prev.size===filtered.length?new Set():new Set(filtered.map(c=>c.id)));
  },[filtered]);

  const [bulkBlockToast, setBulkBlockToast] = useState(null); // { blocked:[{name,missing[]}], destLabel, passedCount }

  const handleBulkStatus = useCallback(async ns => {
    if (ns === '__select_all__') { setSelectedIds(new Set(filtered.map(c => c.id))); return; }

    // ── Compliance gate ───────────────────────────────────────────────────
    const destStage = FUNNEL_STAGES.find(s => s.statuses.includes(ns));
    if (destStage && STAGE_GATE_RULES[destStage.key]) {
      const selectedCases = cases.filter(c => [...selectedIds].includes(c.id));
      const blocked = [], passIds = [];
      for (const c of selectedCases) {
        const check = runComplianceCheck(c, destStage.key, liveVisaRules);
        if (check.hardBlocked) {
          blocked.push({ name: c.studentName, missing: check.missing.filter(m => m.tier === 'required').map(m => m.label) });
        } else {
          passIds.push(c.id);
        }
      }
      if (blocked.length > 0) {
        setBulkBlockToast({ blocked, destLabel: destStage.label, passedCount: passIds.length });
        if (passIds.length === 0) return; // everyone blocked — nothing to move
        // Partial move: only the compliant students proceed
        setBulkSaving(true);
        const ts = new Date().toISOString();
        setCases(prev => prev.map(c => passIds.includes(c.id) ? { ...c, leadStatus: ns, updatedAt: ts, statusUpdatedAt: ts } : c));
        await bulkUpdateStatus(passIds, ns);
        setBulkSaving(false); setSelectedIds(new Set());
        return;
      }
    }

    setBulkSaving(true);
    const ids = [...selectedIds], ts = new Date().toISOString();
    setCases(prev => prev.map(c => ids.includes(c.id) ? { ...c, leadStatus: ns, updatedAt: ts, statusUpdatedAt: ts } : c));
    await bulkUpdateStatus(ids, ns);
    setBulkSaving(false); setSelectedIds(new Set());
  }, [selectedIds, filtered, cases, liveVisaRules]);

  const handleBulkReassign = useCallback(async name=>{
    setBulkSaving(true);
    const ids=[...selectedIds], ts=new Date().toISOString();
    setCases(prev=>prev.map(c=>ids.includes(c.id)?{...c,counsellorName:name,updatedAt:ts}:c));
    await bulkReassign(ids,name);
    setBulkSaving(false); setSelectedIds(new Set());
  },[selectedIds]);

  if(!loading&&cases.length===0) return (
    <div className="sdb-empty">
      <LayoutDashboard size={40} color="var(--t3)" style={{ margin:'0 auto 14px', display:'block' }}/>
      <div style={{ fontSize:'1.1rem', fontWeight:700, color:'var(--t2)', fontFamily:'var(--fh)', marginBottom:8 }}>No cases yet</div>
      <div style={{ fontSize:'var(--text-sm)', color:'var(--t3)', fontFamily:'var(--fu)' }}>Analyse and save your first student to see the dashboard.</div>
    </div>
  );

  const allSelected  = filtered.length>0&&selectedIds.size===filtered.length;
  const someSelected = selectedIds.size>0;

  return (
    <>
      <style>{`
        @keyframes sdb-fade-in        { from{opacity:0} to{opacity:1} }
        @keyframes sdb-slide-in-right  { from{transform:translateX(100%)} to{transform:translateX(0)} }
        @keyframes sdb-slide-out-right { from{transform:translateX(0)} to{transform:translateX(100%)} }
        @keyframes sdb-shimmer        { 0%,100%{background-color:var(--s3)} 50%{background-color:var(--s2)} }
        /* Optional: Hide scrollbar for cleaner sticky sidebar on webkit */
        .sdb-sticky-sidebar::-webkit-scrollbar { display: none; }
        .sdb-sticky-sidebar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

{peekStudent && (
        <QuickPeekDrawer 
          student={cases.find(c => c.id === peekStudent.id) || peekStudent} 
          onClose={()=>{ setPeekStudent(null); setPeekDocsTab(false); }} 
          onOpenFull={handleOpenFull} 
          onOpenMatcher={onOpenMatcher}
          onStatusChange={handleStatusChange} 
          onNoteUpdate={handleNoteUpdate} 
          onPaymentUpdate={handlePaymentUpdate} 
          savingId={savingId} 
          policyAlerts={policyAlerts} 
          inboxAlerts={inboxAlerts}
          openDocsTab={peekDocsTab}
          counsellorOptions={counsellorOptions}
          openChatCount={openChatCount}
          onOpenChat={(student) => {
            onOpenChat?.(student.id, student.studentName);
          }}
          onSuggestionConfirm={async (newStatus) => {
            const id = peekStudent.id;
            const ts = new Date().toISOString();
            // 1. Patch cases array — the render-site cases.find() picks this up immediately,
            //    so the drawer re-renders with the cleared suggestion without a full re-fetch.
            setCases(prev => prev.map(c =>
              c.id === id
                ? { ...c, leadStatus: newStatus, pendingStatusSuggestion: null, updatedAt: ts, statusUpdatedAt: ts }
                : c
            ));
            // 2. peekStudent is only an identity reference ({ id }); the drawer reads the live
            //    cases entry via cases.find() so no setPeekStudent patch is needed here.
            _nbaCache.delete(id);
            _geminiInsightCache.delete(id);
            await Promise.all([
              updateLeadStatus(id, newStatus),
              supabase.from('cases').update({ pending_status_suggestion: null }).eq('id', id),
            ]);
          }}
          onSuggestionDismiss={async () => {
            const id = peekStudent.id;
            // Patch cases array so the banner disappears instantly.
            setCases(prev => prev.map(c =>
              c.id === id ? { ...c, pendingStatusSuggestion: null } : c
            ));
            // Persist the cleared suggestion to DB.
            await supabase.from('cases').update({ pending_status_suggestion: null }).eq('id', id);
          }}
        />
      )}
      {someSelected&&<BulkActionBar selectedIds={selectedIds} allFiltered={filtered} counsellorOptions={counsellorOptions} onBulkStatus={handleBulkStatus} onBulkReassign={handleBulkReassign} onClear={()=>setSelectedIds(new Set())} bulkSaving={bulkSaving}/>}

      {/* ── Bulk compliance block toast ── */}
      {bulkBlockToast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 600, maxWidth: 460, width: 'calc(100vw - 40px)',
          background: '#78350F', borderRadius: 12, boxShadow: '0 8px 32px rgba(15,30,60,.35)',
          padding: '14px 16px', animation: 'sdb-fade-in .2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#B45309', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <AlertTriangle size={14} color="#FEF3C7"/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#FEF3C7', fontFamily: 'var(--fh)', marginBottom: 4 }}>
                {bulkBlockToast.passedCount > 0
                  ? <>{bulkBlockToast.passedCount} moved · <span style={{ color: '#FCA5A5' }}>{bulkBlockToast.blocked.length} blocked</span> from {bulkBlockToast.destLabel}</>
                  : <>{bulkBlockToast.blocked.length} student{bulkBlockToast.blocked.length !== 1 ? 's' : ''} blocked from <span style={{ color: '#FCA5A5' }}>{bulkBlockToast.destLabel}</span></>
                }
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                {bulkBlockToast.blocked.slice(0, 3).map((b, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#FDE68A', fontFamily: 'var(--fu)' }}>
                    <span style={{ fontWeight: 700 }}>{b.name}:</span> {b.missing.slice(0, 2).join(', ')}{b.missing.length > 2 ? ` +${b.missing.length - 2} more` : ''}
                  </div>
                ))}
                {bulkBlockToast.blocked.length > 3 && (
                  <div style={{ fontSize: 10, color: 'rgba(253,230,138,.6)', fontFamily: 'var(--fu)' }}>
                    +{bulkBlockToast.blocked.length - 3} more blocked — open each case to review
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => setBulkBlockToast(null)} style={{ background: 'none', border: 'none', color: 'rgba(253,230,138,.5)', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
              <X size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* ══ MORNING BRIEF MODAL ════════════════════════════════════════ */}
      {briefOpen && (
        <div onClick={()=>setBriefOpen(false)}
          style={{ position:'fixed', inset:0, zIndex:600, background:'rgba(15,30,60,.45)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24, animation:'sdb-fade-in .15s ease' }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:'var(--s1)', borderRadius:16, padding:28, maxWidth:500, width:'100%', boxShadow:'var(--sh3)', border:'1px solid var(--bd)', animation:'sdb-fade-in .2s ease' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(180,83,9,.1)', border:'1px solid rgba(180,83,9,.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Coffee size={16} color="#B45309"/>
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:'var(--text-md)', fontFamily:'var(--fh)', color:'var(--t1)', lineHeight:1.2 }}>Morning Brief</div>
                <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:2 }}>
                  {briefLoading ? 'Analysing your pipeline…' : `Top ${Math.min(actionQueue.length,8)} urgent cases summarised`}
                </div>
              </div>
              <button onClick={()=>setBriefOpen(false)}
                style={{ marginLeft:'auto', width:28, height:28, borderRadius:6, border:'1px solid var(--bd)', background:'var(--s2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', flexShrink:0, transition:'background var(--fast)' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
                onMouseLeave={e=>e.currentTarget.style.background='var(--s2)'}
              ><X size={13}/></button>
            </div>

            {briefLoading ? (
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'20px 0', color:'var(--t3)', fontSize:'var(--text-sm)', fontFamily:'var(--fu)' }}>
                <Loader2 size={16} color="#B45309" style={{ animation:'spin .7s linear infinite', flexShrink:0 }}/>
                Gemini is reading your pipeline and tasks…
              </div>
            ) : (
              <>
                {/* ── Overdue tasks banner — shown when tasks exist ── */}
                {briefOverdueTasks.length > 0 && (
                  <div style={{
                    padding:'12px 14px', borderRadius:10, marginBottom:12,
                    background:'rgba(220,38,38,.06)', border:'1px solid rgba(220,38,38,.18)',
                    display:'flex', alignItems:'flex-start', gap:10,
                  }}>
                    <ClipboardList size={14} color="#DC2626" style={{ flexShrink:0, marginTop:1 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:'#DC2626', fontFamily:'var(--fu)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }}>
                        {briefOverdueTasks.length} overdue task{briefOverdueTasks.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {briefOverdueTasks.slice(0,4).map((t,i) => {
                          const days = Math.ceil((new Date() - new Date(t.due_date)) / 86400000);
                          const pc = t.priority === 'urgent' ? '#DC2626' : t.priority === 'high' ? '#FC471C' : '#D97706';
                          return (
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:'var(--text-xs)', fontFamily:'var(--fu)' }}>
                              <span style={{ width:6, height:6, borderRadius:'50%', background:pc, flexShrink:0 }}/>
                              <span style={{ color:'var(--t1)', fontWeight:600, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</span>
                              <span style={{ color:'#DC2626', fontWeight:700, flexShrink:0 }}>{days}d overdue</span>
                            </div>
                          );
                        })}
                        {briefOverdueTasks.length > 4 && (
                          <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)' }}>
                            +{briefOverdueTasks.length - 4} more overdue — open a case to review tasks
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── AI pipeline summary ── */}
                <div style={{ padding:'16px', borderRadius:10, background:'var(--s2)', border:'1px solid var(--bd)', marginBottom:16 }}>
                  <p style={{ margin:0, fontSize:'var(--text-sm)', lineHeight:1.75, color:'var(--t1)', fontFamily:'var(--fu)' }}>{briefText}</p>
                </div>

                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>{ setBriefText(null); setBriefOverdueTasks([]); handleMorningBrief(); }}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', borderRadius:7, border:'1px solid var(--bd)', background:'var(--s2)', color:'var(--t2)', cursor:'pointer', fontSize:'var(--text-xs)', fontFamily:'var(--fu)', fontWeight:500, transition:'background var(--fast)' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
                    onMouseLeave={e=>e.currentTarget.style.background='var(--s2)'}
                  ><RefreshCw size={11}/> Refresh</button>
                  <button onClick={()=>{ setActivePanel('queue'); setBriefOpen(false); }}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', borderRadius:7, border:'none', background:'var(--p)', color:'#fff', cursor:'pointer', fontSize:'var(--text-xs)', fontFamily:'var(--fu)', fontWeight:600, marginLeft:'auto', transition:'background var(--fast)' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--pm)'}
                    onMouseLeave={e=>e.currentTarget.style.background='var(--p)'}
                  ><Zap size={11}/> View action queue</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    {/* ══ 2-PANEL LAYOUT WRAPPER ════════════════════════════════════════ */}
      <div className="sdb-root" style={{ padding: '24px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, width: '100%' }}>

          {/* ── LEFT: MAIN WORKSPACE ─────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* AI MORNING BRIEF BANNER (Moved to Left Panel!) */}
            {actionQueue.length > 0 && (
              <button onClick={handleMorningBrief} disabled={briefLoading}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px 16px',
                  borderRadius:10, border:'none',
                  background:'linear-gradient(135deg, #4C1D95 0%, #6D28D9 100%)',
                  color:'#fff', cursor:'pointer', fontSize:'var(--text-sm)',
                  fontWeight:700, fontFamily:'var(--fh)',
                  boxShadow:'0 4px 12px rgba(76,29,149,0.25)',
                  transition:'all var(--fast)',
                  width: '100%',
                  flexShrink: 0
                }}
                onMouseEnter={e=>{
                  e.currentTarget.style.transform='translateY(-2px)';
                  e.currentTarget.style.boxShadow='0 6px 16px rgba(76,29,149,0.35)';
                }}
                onMouseLeave={e=>{
                  e.currentTarget.style.transform='none';
                  e.currentTarget.style.boxShadow='0 4px 12px rgba(76,29,149,0.25)';
                }}
              >
                {briefLoading?<Loader2 size={16} style={{ animation:'spin .7s linear infinite' }}/>:<Sparkles size={16} color="#E9D5FF" />}
                Generate AI Morning Brief
              </button>
            )}
  
      
            {/* Command Bar */}
            <div className="sdb-command-bar">
              <div className="sdb-stats-row">
                <StatCard val={stats.total}  label="Total Cases"     sub={loading?'…':`${cases.length} loaded`}                                color="var(--p)"/>
                <StatCard val={stats.vip}    label="VIP Lane"         sub="High viability · docs ready"                                         color="#059669" onClick={()=>setViewMode('radar')}/>
                <StatCard val={stats.sales}  label="Sales Priority"   sub="High viability · docs missing"                                        color="#1D6BE8" onClick={()=>setViewMode('radar')}/>
                <StatCard val={stats.expiring+stats.expired} label="Expiry Alerts" sub={`${stats.expired} expired · ${stats.expiring} ≤30d`} color={stats.expiring+stats.expired>0?'#DC2626':'var(--t3)'} onClick={()=>{setExpiryFilter('Soon');setActivePanel('expiry');}}/>
                {stats.stale>0&&<StatCard val={stats.stale} label="Stale cases" sub={`No movement >${STALE_DAYS}d`} color="#B45309" onClick={()=>setStaleFilter(true)}/>}

                <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, marginLeft:'auto' }}>
                  <div style={{ display:'flex', border:'1px solid var(--bd)', borderRadius:7, overflow:'hidden', background:'var(--s2)' }}>
                    {[['list','list',<List size={12}/>],['board','board',<LayoutGrid size={12}/>],['radar','radar',<Radar size={12}/>]].map(([mode,label,icon])=>(
                      <button key={mode} onClick={()=>setViewMode(mode)} title={`${label} view`}
                        style={{ padding:'5px 10px', border:'none', cursor:'pointer', background:viewMode===mode?'var(--s1)':'transparent', color:viewMode===mode?'var(--p)':'var(--t3)', display:'flex', alignItems:'center', gap:4, fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', borderRight:mode==='list'||mode==='board'?'1px solid var(--bd)':'none', transition:'all var(--fast)' }}
                      >{icon} {label.charAt(0).toUpperCase()+label.slice(1)}</button>
                    ))}
                  </div>
                  <button className="sdb-refresh-btn" onClick={load} disabled={loading} title="Refresh">
                    <RefreshCw size={13} style={{ animation:loading?'spin .7s linear infinite':'none' }}/>
                    {lastLoaded&&!loading&&<span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fm)' }}>{Math.floor((Date.now()-lastLoaded)/60000)}m ago</span>}
                  </button>
                </div>
              </div>

              {/* Urgency pills */}
              <div className="sdb-urgency-row">
                {stats.expired>0&&<button className="sdb-pill sdb-pill--err"  onClick={()=>{setExpiryFilter('Urgent');setActivePanel('expiry');}}><AlertCircle size={11}/>{stats.expired} expired</button>}
                {stats.expiring>0&&<button className="sdb-pill" style={{ background:'rgba(255,216,217,.5)', color:'#FC471C', border:'1px solid rgba(252,71,28,.2)' }} onClick={()=>{setExpiryFilter('Soon');setActivePanel('expiry');}}><Clock size={11}/>{stats.expiring} expiring ≤30d</button>}
                {stats.weak>0&&<button className="sdb-pill sdb-pill--neu"  onClick={()=>setScoreFilter('Weak')}><AlertTriangle size={11}/>{stats.weak} weak profiles</button>}
                {actionQueue.length>0&&<button className="sdb-pill sdb-pill--blue" onClick={()=>setActivePanel('queue')}><Zap size={11}/>{actionQueue.length} need attention</button>}
                {stats.stale>0&&<button className="sdb-pill sdb-pill--warn" onClick={()=>setStaleFilter(true)} style={{ borderStyle:staleFilter?'solid':undefined }}><Clock size={11}/>{stats.stale} stale</button>}
                {stats.alerted>0&&<button className="sdb-pill" style={{ background:'rgba(255,216,217,.5)', color:'#FC471C', border:'1px solid rgba(252,71,28,.2)' }} onClick={()=>setActivePanel('risk')}><Bell size={11}/>{stats.alerted} policy matches</button>}
              </div>

              {/* Score Legend */}
              <div style={{ display:'flex', gap:16, padding:'8px 4px', borderTop:'1px solid var(--bd)', marginTop:4, flexWrap:'wrap' }}>
                {[
                  { dot:'#059669', term:'Readiness', def:'Document completeness score (0–100). Passport=25pts, English=20pts, Financials=15pts, Academic=15pts, CNIC=10pts, Offer=10pts, CAS=5pts.' },
                  { dot:'#1D6BE8', term:'Viability',  def:'Profile strength score (0–100). Academic=40pts, Financial=35pts, Visa risk factors=25pts (age, marital status, past rejections).' },
                ].map(({dot,term,def})=>(
                  <div key={term} style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--t2)', maxWidth:320 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:dot, marginTop:3, flexShrink:0 }}/>
                    <span><strong style={{ color:'var(--t1)' }}>{term}:</strong> {def}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Funnel */}
            <div className="sdb-funnel">
              <button className={`sdb-funnel-stage${stageFilter==='all'?' active':''}`} style={stageFilter==='all'?{ borderColor:'#4C1D95', background:'rgba(76,29,149,.07)' }:{}} onClick={()=>setStageFilter('all')}>
                <span className="sdb-funnel-count" style={{ color:stageFilter==='all'?'#4C1D95':'var(--t1)' }}>{cases.length}</span>
                <span className="sdb-funnel-label">All cases</span>
              </button>
              {FUNNEL_STAGES.map(stage=>{
                const ia=stageFilter===stage.key;
                return (
                  <React.Fragment key={stage.key}>
                    <ChevronRight size={14} color="var(--t3)" style={{ flexShrink:0 }}/>
                    <button className={`sdb-funnel-stage${ia?' active':''}`} style={ia?{ borderColor:stage.color, background:stage.bg }:{}} onClick={()=>setStageFilter(ia?'all':stage.key)}>
                      <span className="sdb-funnel-count" style={{ color:ia?stage.color:'var(--t1)' }}>{funnelCounts[stage.key]}</span>
                      <span className="sdb-funnel-label">{stage.label}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Filters */}
            <div className="sdb-filters">
              <div className="sdb-search-wrap" style={{ position:'relative', width:300 }}>
                <Sparkles
                  size={12}
                  style={{
                    position:'absolute', left:9, top:'50%', transform:'translateY(-50%)',
                    color: loading ? 'var(--p)' : '#7C3AED',
                    pointerEvents:'none',
                    animation: loading ? 'spin .9s linear infinite' : 'none',
                  }}
                />
                <input
                  className="sdb-search-input"
                  placeholder="Try 'missing docs' or 'unpaid Italy leads'…"
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAISearch(nameSearch);
                  }}
                  title="Type a natural language query and press Enter. E.g. 'follow ups in Pakistan' or 'unpaid leads'"
                />
                {nameSearch && (
                  <button className="sdb-input-clear" onClick={() => { setNameSearch(''); setOmniResultIds(null); setStageFilter('all'); setCountryFilter('All'); setScoreFilter('All'); setExpiryFilter('All'); }}>
                    <X size={10}/>
                  </button>
                )}
              </div>
              {counsellorOptions.length>2&&(
                <select className="sdb-select" value={counsellorFilter} onChange={e=>setCounsellorFilter(e.target.value)}>
                  {counsellorOptions.map(n=><option key={n} value={n}>{n==='All'?'All counsellors':n}</option>)}
                </select>
              )}
              {countryOptions.length>2&&(
                <select className="sdb-select" value={countryFilter} onChange={e=>setCountryFilter(e.target.value)}>
                  {countryOptions.map(n=><option key={n} value={n}>{n==='All'?'All countries':`${countryFlag(n)} ${n}`}</option>)}
                </select>
              )}
              <select className="sdb-select" value={scoreFilter} onChange={e=>setScoreFilter(e.target.value)}>
                <option value="All">All scores</option><option value="Strong">Strong (70+)</option>
                <option value="Moderate">Moderate (45–69)</option><option value="Weak">Weak (&lt;45)</option>
              </select>
              <select className="sdb-select" value={expiryFilter} onChange={e=>setExpiryFilter(e.target.value)}>
                <option value="All">All expiries</option><option value="Urgent">Expiring ≤14d</option><option value="Soon">Expiring ≤30d</option>
              </select>
              <button onClick={()=>setStaleFilter(s=>!s)} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6, border:`1px solid ${staleFilter?'#B45309':'var(--bd)'}`, background:staleFilter?'rgba(180,83,9,.08)':'var(--s1)', color:staleFilter?'#B45309':'var(--t3)', cursor:'pointer', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', whiteSpace:'nowrap', transition:'all var(--fast)' }}>
                <Clock size={11}/> Stale only
              </button>
              {filtersActive&&<button onClick={clearFilters} style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:6, border:'none', background:'#4C1D95', color:'#fff', cursor:'pointer', fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', whiteSpace:'nowrap', transition:'background var(--fast)' }}
  onMouseEnter={e=>e.currentTarget.style.background='#3B1475'}
  onMouseLeave={e=>e.currentTarget.style.background='#4C1D95'}
><X size={12}/> Clear Filters</button>}
              <span style={{ marginLeft:'auto', fontSize:11, color:'var(--t3)', fontFamily:'var(--fm)', whiteSpace:'nowrap' }}>
                {loading?<><Loader2 size={11} style={{ animation:'spin .7s linear infinite', verticalAlign:'middle' }}/> Loading…</>:<>{filtered.length} case{filtered.length!==1?'s':''}</>}
              </span>
            </div>

            {/* Board / List / Radar */}
            {viewMode==='board' ? (
              <KanbanBoard cases={filtered} alertCountries={alertCountries} savingId={savingId} onStatusChange={handleStatusChange} onPeek={setPeekStudent} onOpenChat={onOpenChat} onLoad={handleOpenFull}/>
            ) : viewMode==='radar' ? (
              <RadarMatrix
                cases={filtered}
                onOpenCase={handleOpenFull}
                callGeminiInsight={callGeminiInsight}
                externalInsightCache={_geminiInsightCache}
                previousQuadrants={previousQuadrants}
                onQuadrantsComputed={handleQuadrantsComputed}
                counsellorList={counsellorOptions.filter(n => n !== 'All')}
                onReassign={handleRadarReassign}
                onStatusChange={handleStatusChange}
                orgSession={orgSession}
              />
            ) : (
              <div className="sdb-table">
                <div className="sdb-table-hdr">
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }} onClick={toggleSelectAll}>
                    {allSelected?<CheckSquare size={14} color="var(--p)"/>:someSelected?<CheckSquare size={14} color="var(--t3)" style={{ opacity:.4 }}/>:<Square size={14} color="var(--t3)" style={{ opacity:.4 }}/>}
                  </div>
                  <div className="sdb-col-hdr">Student</div>
                  <div className="sdb-col-hdr">Status</div>
                  <div className="sdb-col-hdr">Country</div>
                  <div className="sdb-col-hdr">Score</div>
                  <div className="sdb-col-hdr">Doc Health</div>
                  <div className="sdb-col-hdr">Updated</div>
                </div>

                {loading&&cases.length===0 ? Array.from({length:6},(_,i)=><SkeletonRow key={i}/>)
                : filtered.length===0 ? (
                  <div className="sdb-table-state">
                    No cases match the current filters.
                    {filtersActive&&<button className="sdb-link-btn" onClick={clearFilters}>Clear filters</button>}
                  </div>
                ) : filtered.map(c=>{
                  const sb       = scoreBand(c.overallScore);
                  const days     = daysUntil(c.expiryDate);
                  const stale    = isStale(c);
                  const hasAlert = alertCountries.has((c.targetCountry||'').toLowerCase().trim());
                  const selected = selectedIds.has(c.id);
                  return (
                    <div key={c.id} className="sdb-row"
                      style={{ borderLeft:stale?'3px solid rgba(180,83,9,.45)':days!==null&&days<=14?'3px solid rgba(220,38,38,.45)':'3px solid transparent', background:selected?'rgba(29,107,232,.04)':undefined, cursor:'pointer' }}
                      onClick={()=>handleOpenFull(c)}
                    >
                      <div onClick={e=>{e.stopPropagation();toggleSelect(c.id);}} style={{ display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                        {selected?<CheckSquare size={14} color="var(--p)"/>:<Square size={14} color="var(--t3)" style={{ opacity:.35 }}/>}
                      </div>
                      <div className="sdb-row-avatar"><Avatar name={c.studentName} size={32}/></div>
                      <div className="sdb-row-main">
                        <div className="sdb-row-name" style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                          {c.studentName}
                          {hasAlert&&<span className="sdb-alert-dot" title="Policy alert"/>}
                          {stale&&<StaleTag/>}
                        </div>
                        {c.caseSerial&&<div className="sdb-row-serial">{c.caseSerial}</div>}
                        {c.counsellorName&&<div className="sdb-row-counsellor">{c.counsellorName}</div>}
                      </div>
                      <div onClick={e=>e.stopPropagation()} style={{ position:'relative' }}>
                        <StatusSelect status={c.leadStatus} saving={savingId===c.id} onChange={ns=>handleStatusChange(c.id,ns)}/>
                      </div>
                      <div className="sdb-row-country">
                        <span>{countryFlag(c.targetCountry)}</span>
                        <span className="sdb-row-country-name">{c.targetCountry||'—'}</span>
                      </div>
                      <div>
                        <span
                          title={getScoreRationaleText(c) || 'No AI reasoning stored yet — open case for full analysis'}
                          style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: sb.bg, color: sb.color, fontFamily: 'var(--fu)', cursor: getScoreRationaleText(c) ? 'help' : 'default' }}
                        >
                          {c.overallScore}/100
                        </span>
                      </div>
                      <div><DocHealthBar expiryDate={c.expiryDate} expiryDocType={c.expiryDocType}/></div>
                      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                        <span className="sdb-row-meta">{timeAgo(c.updatedAt||c.savedAt)}</span>
                        <div style={{ display:'flex', gap:4 }}>
                          <button onClick={e=>{e.stopPropagation();setPeekStudent(c);}}
                            style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 6px', borderRadius:4, border:'1px solid var(--bd)', background:'var(--s2)', color:'var(--t3)', cursor:'pointer', fontSize:10, fontFamily:'var(--fu)', fontWeight:500, transition:'all var(--fast)' }}
                            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--p)';e.currentTarget.style.color='var(--p)';}}
                            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--bd)';e.currentTarget.style.color='var(--t3)';}}
                          ><Eye size={9}/> Peek</button>
                          <button onClick={e=>{e.stopPropagation();onOpenChat?.(c.id,c.studentName);}}
                            title="Open chat"
                            style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 6px', borderRadius:4, border:'1px solid rgba(29,107,232,.25)', background:'rgba(29,107,232,.07)', color:'#1D6BE8', cursor:'pointer', fontSize:10, fontFamily:'var(--fu)', fontWeight:500, transition:'all var(--fast)' }}
                            onMouseEnter={e=>{e.currentTarget.style.background='rgba(29,107,232,.15)';}}
                            onMouseLeave={e=>{e.currentTarget.style.background='rgba(29,107,232,.07)';}}
                          ><MessageSquare size={9}/> Chat</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT: STICKY SIDEBAR (Insights) ─────────────────────────── */}
          <div className="sdb-sticky-sidebar" style={{ width: 330, flexShrink: 0, position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', paddingBottom: 24 }}>
  
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--t3)', fontFamily: 'var(--fu)', padding: '0 4px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <Zap size={13} color="var(--t3)"/> Insights & Radar
      </div>
      
          
            <InsightPanel id="queue" active={activePanel==='queue'} onToggle={id=>setActivePanel(activePanel===id?null:id)} icon={<Zap size={14}/>} title="Action queue" badge={actionQueue.length>0?{label:actionQueue.length,urgent:true}:null} accent="#4C1D95">
              {actionQueue.length===0?<div className="sdb-panel-empty">No urgent cases right now.</div>:actionQueue.map(c=>(
                <div key={c.id} className="sdb-panel-row" onClick={()=>setPeekStudent(c)}>
                  <Avatar name={c.studentName} size={28}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="sdb-panel-row-name">{c.studentName} {isStale(c)&&<StaleTag/>}</div>
                    <div className="sdb-panel-row-sub">{c.targetCountry||'—'} · <StatusPill status={c.leadStatus}/></div>
                  </div>
                  <UrgencyBar score={c.urgency}/>
                </div>
              ))}
            </InsightPanel>

            <InsightPanel id="expiry" active={activePanel==='expiry'} onToggle={id=>setActivePanel(activePanel===id?null:id)} icon={<Clock size={14}/>} title="Expiry radar"
  badge={expiryRadar.filter(c=>c.days!==null&&c.days<=30).length>0?{label:expiryRadar.filter(c=>c.days!==null&&c.days<=30).length, bg:'rgba(255,216,217,.5)', color:'#FC471C'}:null} accent="#FC471C">
              {expiryRadar.length===0?<div className="sdb-panel-empty">No expiry dates recorded.</div>:expiryRadar.map(c=>(
                <div key={c.id} className="sdb-panel-row" onClick={()=>setPeekStudent(c)}>
                  <Avatar name={c.studentName} size={28}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="sdb-panel-row-name">{c.studentName}</div>
                    <div className="sdb-panel-row-sub">{c.expiryDocType||'Document'} · {fmtDate(c.expiryDate)}</div>
                  </div>
                  <ExpiryBadge expiryDate={c.expiryDate} expiryDocType=""/>
                </div>
              ))}
            </InsightPanel>

            <InsightPanel id="country" active={activePanel==='country'} onToggle={id=>setActivePanel(activePanel===id?null:id)} icon={<Target size={14}/>} title="Country breakdown" accent="#1D6BE8">
              {countryBreakdown.length===0?<div className="sdb-panel-empty">No country data yet.</div>:countryBreakdown.map(row=>{
                const pct=cases.length>0?Math.round((row.count/cases.length)*100):0;
                const alert=policyAlerts.some(a=>(a.affected_countries||[]).some(ac=>ac.toLowerCase().trim()===row.country.toLowerCase().trim()));
                return (
                  <div key={row.country} className="sdb-panel-country-row" onClick={()=>{setCountryFilter(row.country);setActivePanel(null);}}>
                    <span className="sdb-panel-country-flag">{countryFlag(row.country)}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span className="sdb-panel-row-name">{row.country}</span>
                        {alert&&<Bell size={10} color="#B45309"/>}
                      </div>
                      <div className="sdb-country-bar-track"><div className="sdb-country-bar-fill" style={{ width:`${pct}%`, background:'#1D6BE8' }}/></div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:'var(--text-sm)', fontWeight:600, color:'var(--t1)', fontFamily:'var(--fu)' }}>{row.count}</div>
                      <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)' }}>avg {row.avgScore}</div>
                    </div>
                  </div>
                );
              })}
            </InsightPanel>

            <InsightPanel id="scores" active={activePanel==='scores'} onToggle={id=>setActivePanel(activePanel===id?null:id)} icon={<TrendingUp size={14}/>} title="Portfolio health" accent="#059669">
              <ScoreDistBar label="Strong (70+)"     count={scoreDist.strong}   total={scoreDist.total} color="#059669" onClick={()=>setScoreFilter('Strong')}/>
              <ScoreDistBar label="Moderate (45–69)" count={scoreDist.moderate} total={scoreDist.total} color="#B45309" onClick={()=>setScoreFilter('Moderate')}/>
              <ScoreDistBar label="Weak (<45)"        count={scoreDist.weak}     total={scoreDist.total} color="#DC2626" onClick={()=>setScoreFilter('Weak')}/>
              {counsellorOptions.length>2&&(
                <>
                  <div style={{ fontSize:'var(--text-xs)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', margin:'14px 0 8px', fontFamily:'var(--fu)' }}>By counsellor</div>
                  {counsellorOptions.filter(n=>n!=='All').map(name=>{
                    const cnt=cases.filter(c=>c.counsellorName===name).length;
                    const avg=cnt>0?Math.round(cases.filter(c=>c.counsellorName===name).reduce((s,c)=>s+c.overallScore,0)/cnt):0;
                    return (
                      <div key={name} className="sdb-counsellor-row" onClick={()=>setCounsellorFilter(name)}>
                        <Avatar name={name} size={24}/>
                        <span style={{ flex:1, fontSize:'var(--text-sm)', fontFamily:'var(--fu)', color:'var(--t1)' }}>{name}</span>
                        <span style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)' }}>{cnt} · avg {avg}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </InsightPanel>

            {canManageTeam(orgSession) && counsellorPerf.length > 0 && (
              <InsightPanel id="counselperf" active={activePanel==='counselperf'} onToggle={id=>setActivePanel(activePanel===id?null:id)} icon={<Award size={14}/>} title="Counsellor performance" accent="#4C1D95">
                <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:10, lineHeight:1.5 }}>
                  Performance score weights pipeline quality (VIP/Sales cases), quadrant movement since last session, and avg case score.
                </div>
                {counsellorPerf.map((cp, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                  const barColor = cp.score >= 70 ? '#059669' : cp.score >= 40 ? '#1D6BE8' : '#B45309';
                  return (
                    <div key={cp.name} style={{ marginBottom: 12, cursor:'pointer' }} onClick={()=>setCounsellorFilter(cp.name)}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                        <Avatar name={cp.name} size={26}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            {medal && <span style={{ fontSize:11 }}>{medal}</span>}
                            <span style={{ fontSize:'var(--text-sm)', fontWeight:700, color:'var(--t1)', fontFamily:'var(--fh)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cp.name}</span>
                          </div>
                          <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', marginTop:1 }}>
                            {cp.total} case{cp.total!==1?'s':''} · avg {cp.avgScore}
                            {(cp.movedUp > 0 || cp.movedDown > 0) && (
                              <span style={{ marginLeft:5 }}>
                                {cp.movedUp > 0 && <span style={{ color:'#059669' }}>↑{cp.movedUp}</span>}
                                {cp.movedUp > 0 && cp.movedDown > 0 && ' '}
                                {cp.movedDown > 0 && <span style={{ color:'#DC2626' }}>↓{cp.movedDown}</span>}
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize:12, fontWeight:800, color:barColor, fontFamily:'var(--fu)', flexShrink:0 }}>{cp.score}</span>
                      </div>
                      {/* Performance bar */}
                      <div style={{ height:4, background:'var(--s3)', borderRadius:2, overflow:'hidden', marginBottom:5 }}>
                        <div style={{ height:'100%', width:`${cp.score}%`, background:barColor, borderRadius:2, transition:'width .4s' }}/>
                      </div>
                      {/* Quadrant breakdown mini-pills */}
                      {cp.total > 0 && (
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          {cp.vip > 0 && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(2,160,109,.1)', color:'#02a06d', fontFamily:'var(--fu)' }}>VIP {cp.vip}</span>}
                          {cp.sales > 0 && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(13,95,224,.1)', color:'#0d5fe0', fontFamily:'var(--fu)' }}>Sales {cp.sales}</span>}
                          {cp.drainers > 0 && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(224,123,0,.1)', color:'#e07b00', fontFamily:'var(--fu)' }}>Drain {cp.drainers}</span>}
                          {cp.dead > 0 && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(107,114,128,.1)', color:'#6b7280', fontFamily:'var(--fu)' }}>Dead {cp.dead}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)', borderTop:'1px solid var(--bd)', paddingTop:8, marginTop:4, lineHeight:1.5 }}>
                  Click any counsellor to filter the main view. Switch to Radar view to see their quadrant map.
                </div>
              </InsightPanel>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

/* ─── Pure sub-components ────────────────────────────────────────────── */
function StatCard({ val, label, sub, color, onClick }) {
  return (
    <div className={`sdb-stat-card${onClick?' sdb-stat-card--clickable':''}`} onClick={onClick}>
      <div className="sdb-stat-val" style={{ color }}>{val}</div>
      <div className="sdb-stat-label">{label}</div>
      {sub&&<div className="sdb-stat-sub">{sub}</div>}
    </div>
  );
}

function InsightPanel({ id, active, onToggle, icon, title, badge, accent, children }) {
  return (
    <div className={`sdb-insight-panel${active?' sdb-insight-panel--open':''}`}>
      <button className="sdb-insight-hdr" onClick={()=>onToggle(id)}>
        <span style={{ color:accent }}>{icon}</span>
        <span className="sdb-insight-title">{title}</span>
        {badge&&<span className="sdb-insight-badge" style={{ background: badge.bg || (badge.urgent?'rgba(220,38,38,.1)':'rgba(29,107,232,.1)'), color: badge.color || (badge.urgent?'#DC2626':'#1D6BE8') }}>{badge.label}</span>}
        <ChevronDown size={13} style={{ marginLeft:'auto', color:'var(--t3)', transform:active?'rotate(180deg)':'none', transition:'transform .2s' }}/>
      </button>
      {active&&<div className="sdb-insight-body">{children}</div>}
    </div>
  );
}

function UrgencyBar({ score }) {
  const pct   = Math.min(100,Math.round((score/80)*100));
  const color = pct>60?'#DC2626':pct>30?'#B45309':'#1D6BE8';
  return (
    <div style={{ width:48, flexShrink:0 }}>
      <div style={{ height:4, background:'var(--s3)', borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:2 }}/>
      </div>
      <div style={{ fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)', textAlign:'right', marginTop:2 }}>{score}pt</div>
    </div>
  );
}

function ScoreDistBar({ label, count, total, color, onClick }) {
  const pct = total>0?Math.round((count/total)*100):0;
  return (
    <div className="sdb-dist-row" onClick={onClick} style={{ cursor:'pointer' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ fontSize:'var(--text-sm)', color:'var(--t2)', fontFamily:'var(--fu)' }}>{label}</span>
        <span style={{ fontSize:'var(--text-sm)', fontWeight:600, color, fontFamily:'var(--fu)' }}>{count}</span>
      </div>
      <div style={{ height:4, background:'var(--s3)', borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:2, transition:'width .4s' }}/>
      </div>
    </div>
  );
}