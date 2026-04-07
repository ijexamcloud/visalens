/**
 * VisaLens — Student Dashboard  v7.0 (Two-Panel SaaS Layout)
 * ─────────────────────────────────────────────────────────────────────────
 * New in v7:
 * • Two-Panel Layout      — Left: Operational Workspace (Funnel, Kanban/List)
 * Right: Sticky Insights Sidebar (Action Queue, Expiry)
 * • Sticky Radar          — Sidebar stays in view during vertical scrolling.
 * • Default Accordion     — Action queue opens by default on load.
 *
 * Carried from v6:
 * Intent-Type Actions, Drag-and-Drop Kanban, Time in Stage,
 * Morning Brief, Cache Invalidation, Smart Next Best Action,
 * Quick-Peek Drawer, Stale/Urgency, Doc Health, Smart Filters.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, Bell, Check,
  ChevronDown, ChevronRight, Clock, Eye,
  LayoutDashboard, Loader2, RefreshCw, Search, List,
  Target, TrendingUp, User, X, Zap, ExternalLink,
  MapPin, Calendar, Activity, Phone, Mail,
  LayoutGrid, UserCheck, Square, CheckSquare,
  PenLine, BookOpen, GraduationCap, Sparkles, ArrowRight,
  Coffee, MousePointerClick, Users, Award,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, closestCenter,
} from '@dnd-kit/core';
import { createClient } from '@supabase/supabase-js';

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

/* ─── Supabase ───────────────────────────────────────────────────────── */
const COLS = 'id,case_serial,created_at,updated_at,status_updated_at,student_name,counsellor_name,overall_score,target_country,lead_status,expiry_date,expiry_doc_type,application_targets,notes,referral_source,payment_status';const CONTACT_COLS = 'id,phone,email';

function applyScope(q, s) {
  return (s?.role === 'counsellor' || s?.role === 'viewer')
    ? q.eq('created_by', s.member_id)
    : q.eq('org_id', s.org_id);
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
  notes: r.notes||'', phone: r.phone||'', email: r.email||'',
  referralSource: r.referral_source || 'Direct',
  paymentStatus: r.payment_status || 'Unpaid',
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
    return { phone: data.phone || '', email: data.email || '' };
  } catch { return { phone: '', email: '' }; }
}

async function updateLeadStatus(id, newStatus) {
  const s = getOrgSession();
  if (!s?.org_id) return false;
  try {
    const { error } = await supabase.from('cases')
      .update({
        lead_status: newStatus,
        updated_at: new Date().toISOString(),
        status_updated_at: new Date().toISOString(), 
      })
      .eq('id', id).eq('org_id', s.org_id);
    return !error;
  } catch { return false; }
}

async function bulkUpdateStatus(ids, newStatus) {
  const s = getOrgSession();
  if (!s?.org_id) return false;
  try {
    const { error } = await supabase.from('cases')
      .update({
        lead_status: newStatus,
        updated_at: new Date().toISOString(),
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
    return !error;
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
    return joined;
  } catch { return null; }
}

/* ─── Next Best Action — session cache + fetch ───────────────────────────── */
const _nbaCache = new Map();

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

async function fetchMorningBrief(urgentCases) {
  try {
    const res = await fetch(`${PROXY_URL}/api/cases/next-best-action`, {
      method:  'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: 'morning-brief', cases: urgentCases }),
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

function DraggableCard({ c, alertCountries, savingId, onStatusChange, onPeek, isDragging }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: c.id });
  const sb       = scoreBand(c.overallScore);
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
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: sb.bg, color: sb.color, fontFamily: 'var(--fu)' }}>
  {c.overallScore}/100
</span>
          {c.targetCountry&&<span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--fu)' }}>{countryFlag(c.targetCountry)} {c.targetCountry}</span>}
          {stale&&<StaleTag/>}
          {days!==null&&days<=30&&<ExpiryBadge expiryDate={c.expiryDate} expiryDocType=""/>}
        </div>
        {daysInStage !== null && (
          <div style={{ fontSize:9, color: daysInStage>14?'#B45309':'var(--t3)', fontFamily:'var(--fu)', marginBottom:6, display:'flex', alignItems:'center', gap:3 }}>
            <Clock size={8}/> {daysInStage}d in stage
          </div>
        )}
        <div onClick={e=>e.stopPropagation()}>
          <StatusSelect status={c.leadStatus} saving={savingId===c.id} onChange={ns=>onStatusChange(c.id,ns)}/>
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({ cases, alertCountries, savingId, onStatusChange, onPeek }) {
  const [activeDragId, setActiveDragId] = useState(null);
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
    if (newStatus !== draggedCase.leadStatus) {
      onStatusChange(draggedCase.id, newStatus);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display:'flex', gap:10, overflowX:'auto', padding:'0 0 20px', alignItems:'flex-start' }}>
        {FUNNEL_STAGES.map(stage => {
          const cards = cases.filter(c => stage.statuses.includes(c.leadStatus));
          return (
            <DroppableColumn key={stage.key} stage={stage}>
              <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--bd)', background:stage.bg, display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:stage.color, display:'inline-block', flexShrink:0 }}/>
                <span style={{ fontWeight:700, fontSize:'var(--text-sm)', color:stage.color, fontFamily:'var(--fh)', flex:1 }}>{stage.label}</span>
                <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10, background:'var(--s1)', color:'var(--t3)', fontFamily:'var(--fu)' }}>{cards.length}</span>
              </div>
              <div style={{ padding:8, display:'flex', flexDirection:'column', gap:6, maxHeight:'calc(100vh - 320px)', overflowY:'auto' }}>
                {cards.length === 0
                  ? <div style={{ padding:'18px 8px', textAlign:'center', fontSize:'var(--text-xs)', color:'var(--t3)', fontFamily:'var(--fu)' }}>Drop here</div>
                  : cards.map(c => (
                    <DraggableCard key={c.id} c={c} alertCountries={alertCountries} savingId={savingId} onStatusChange={onStatusChange} onPeek={onPeek} isDragging={activeDragId===c.id}/>
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

/* ════════════════════════════════════════════════════════════════════════
   QUICK-PEEK DRAWER 
════════════════════════════════════════════════════════════════════════ */
function QuickPeekDrawer({ student, onClose, onOpenFull, onStatusChange, onNoteUpdate, savingId, policyAlerts, inboxAlerts=[] }) {
  const [contact,    setContact]    = useState({ phone: '', email: '' });
  const [logText,    setLogText]    = useState('');
  const [logSaving,  setLogSaving]  = useState(false);
  const [localNotes, setLocalNotes] = useState(student?.notes || '');
  const [activeTab,  setActiveTab]  = useState('info'); 
  const [nba,        setNba]        = useState(null);   
  const [nbaLoading, setNbaLoading] = useState(false);
  const logRef = useRef(null);

  useEffect(()=>{
    const h = e=>{ if(e.key==='Escape') onClose(); };
    document.addEventListener('keydown',h);
    return()=>document.removeEventListener('keydown',h);
  },[onClose]);

  useEffect(()=>{
    if (!student?.id) return;
    setContact({ phone: '', email: '' });
    setLocalNotes(student.notes || '');
    setLogText('');
    fetchContactDetails(student.id).then(setContact);
  },[student?.id]);

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

  if(!student) return null;

  const sb           = scoreBand(student.overallScore);
  const stale        = isStale(student);
  const daysSince    = student.updatedAt ? Math.floor((Date.now()-new Date(student.updatedAt))/86400000) : null;
  const alertSet     = new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim())));
  const hasAlert     = alertSet.has((student.targetCountry||'').toLowerCase().trim());
  const intakeSeason = getIntakeSeason(student.applicationTargets);
  const targets      = student.applicationTargets||[];
  const milestone    = getNextMilestone(student, inboxAlerts);
  const ledger       = parseActivityLedger(localNotes, student.savedAt);

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

  const MILESTONE_COLORS = { expiry:'#F59E0B', intake:'#8B5CF6', interview:'#F97316', offer_letter:'#22C55E', alert:'#EF4444' };
  const msColor = milestone ? (MILESTONE_COLORS[milestone.kind] || '#1D6BE8') : null;
  const msDays  = milestone ? Math.ceil((milestone.date - new Date()) / 86400000) : null;

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(15,30,60,.25)', backdropFilter:'blur(2px)', animation:'sdb-fade-in .15s ease' }}/>
      <div style={{ position:'fixed', top:0, right:0, bottom:0, width:'min(440px,92vw)', zIndex:301, background:'var(--s1)', borderLeft:'1px solid var(--bd)', boxShadow:'var(--sh3)', display:'flex', flexDirection:'column', animation:'sdb-slide-in-right .2s var(--eout)' }}>

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
            {/* Payment + referral badges */}
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, fontFamily: 'var(--fu)',
                background: student.paymentStatus === 'Paid' ? 'rgba(5,150,105,.1)' : 'rgba(255,216,217,.5)',
                color: student.paymentStatus === 'Paid' ? '#059669' : '#FC471C',
                border: `1px solid ${student.paymentStatus === 'Paid' ? 'rgba(5,150,105,.2)' : 'rgba(252,71,28,.2)'}`
              }}>
                {student.paymentStatus === 'Paid' ? '✓ Deposit Paid' : 'Fees Unpaid'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Users size={10}/> Source: {student.referralSource || '—'}
              </span>
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
              onClick={isEmailIntent && emailMailto ? ()=>window.open(emailMailto,'_self') : undefined}
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
          {[{id:'info',label:'Overview'},{id:'log',label:'Activity'}].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              flex:1, padding:'9px 0', border:'none', background:'transparent', cursor:'pointer',
              fontSize:'var(--text-xs)', fontWeight:700, fontFamily:'var(--fu)',
              color:activeTab===t.id?'var(--p)':'var(--t3)',
              borderBottom:activeTab===t.id?'2px solid var(--p)':'2px solid transparent',
              transition:'color var(--fast)',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'0 0 8px' }}>
          {activeTab === 'info' ? (<>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', borderBottom:'1px solid var(--bd)' }}>
              <div style={{ padding:'14px 20px', borderRight:'1px solid var(--bd)' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>Lead Status</div>
                <div onClick={e=>e.stopPropagation()}>
                  <StatusSelect status={student.leadStatus} saving={savingId===student.id} onChange={ns=>onStatusChange(student.id,ns)}/>
                </div>
              </div>
              <div style={{ padding:'14px 20px' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--t3)', fontFamily:'var(--fu)', marginBottom:8 }}>AI Score</div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:22, fontWeight:800, color:sb.color, fontFamily:'var(--fh)', lineHeight:1 }}>{student.overallScore}</span>
                  <span style={{ fontSize:'var(--text-xs)', color:'var(--t3)' }}>/100</span>
<span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: sb.bg, color: sb.color, fontFamily: 'var(--fu)', marginLeft: 'auto' }}>
  {sb.label}
</span>
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
          <button onClick={()=>{onOpenFull(student);onClose();}}
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
    </>
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
export default function StudentDashboard({ onLoad, totalCases: totalCasesProp, lastSaved, orgSession, orgCredits, policyAlerts=[], inboxAlerts=[] }) {
  const [cases,      setCases]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);
  const [savingId,   setSavingId]   = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [viewMode,    setViewMode]    = useState('board');   
  const [peekStudent, setPeekStudent] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [nameSearch,       setNameSearch]       = useState('');
  const [stageFilter,      setStageFilter]      = useState('all');
  const [counsellorFilter, setCounsellorFilter] = useState('All');
  const [countryFilter,    setCountryFilter]    = useState('All');
  const [scoreFilter,      setScoreFilter]      = useState('All');
  const [expiryFilter,     setExpiryFilter]     = useState('All');
  const [staleFilter,      setStaleFilter]      = useState(false);
  
  // Default to action queue open for the right sidebar
  const [activePanel,      setActivePanel]      = useState('queue');

  // Morning Brief
  const [briefOpen,    setBriefOpen]    = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefText,    setBriefText]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await fetchAllCases();
    setCases(rows);
    setLastLoaded(new Date());
    setLoading(false);
    setSelectedIds(new Set());
  }, []);

  useEffect(()=>{ load(); },[totalCasesProp,lastSaved,load]);

  const stats = useMemo(()=>{
    const alertSet = new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim())));
    return {
      total:    cases.length,
      strong:   cases.filter(c=>c.overallScore>=70).length,
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

  const counsellorOptions = useMemo(()=>['All',...new Set(cases.map(c=>c.counsellorName).filter(Boolean))],[cases]);
  const countryOptions    = useMemo(()=>['All',...new Set(cases.map(c=>c.targetCountry).filter(Boolean))],[cases]);

  const filtered = useMemo(()=>cases.filter(c=>{
    if(stageFilter!=='all'){ const st=FUNNEL_STAGES.find(s=>s.key===stageFilter); if(st&&!st.statuses.includes(c.leadStatus)) return false; }
    if(nameSearch.trim()&&!c.studentName.toLowerCase().includes(nameSearch.trim().toLowerCase())) return false;
    if(counsellorFilter!=='All'&&c.counsellorName!==counsellorFilter) return false;
    if(countryFilter!=='All'&&c.targetCountry!==countryFilter) return false;
    if(scoreFilter!=='All'&&scoreBand(c.overallScore).label!==scoreFilter) return false;
    if(expiryFilter!=='All'){ const d=daysUntil(c.expiryDate); if(expiryFilter==='Urgent'&&!(d!==null&&d<=14&&d>=0)) return false; if(expiryFilter==='Soon'&&!(d!==null&&d<=30&&d>=0)) return false; }
    if(staleFilter&&!isStale(c)) return false;
    return true;
  }),[cases,stageFilter,nameSearch,counsellorFilter,countryFilter,scoreFilter,expiryFilter,staleFilter]);

  const filtersActive = stageFilter!=='all'||nameSearch.trim()||counsellorFilter!=='All'||countryFilter!=='All'||scoreFilter!=='All'||expiryFilter!=='All'||staleFilter;

  function clearFilters() {
    setStageFilter('all'); setNameSearch(''); setCounsellorFilter('All');
    setCountryFilter('All'); setScoreFilter('All'); setExpiryFilter('All');
    setStaleFilter(false); setSelectedIds(new Set());
  }

  const actionQueue = useMemo(()=>cases.map(c=>{
    const d=daysUntil(c.expiryDate);
    return { ...c, urgency: (d!==null&&d<=30?(30-Math.max(d,0))*2:0)+(c.overallScore<45?20:0)+(isStale(c)?25:0)+(c.updatedAt?Math.min(Math.floor((Date.now()-new Date(c.updatedAt))/86400000),30):0)+(c.leadStatus==='Follow up'?15:0) };
  }).filter(c=>c.urgency>0).sort((a,b)=>b.urgency-a.urgency).slice(0,8),[cases]);

  const countryBreakdown = useMemo(()=>{
    const map={}; cases.forEach(c=>{ if(!c.targetCountry) return; if(!map[c.targetCountry]) map[c.targetCountry]={count:0,scoreSum:0}; map[c.targetCountry].count++; map[c.targetCountry].scoreSum+=c.overallScore; });
    return Object.entries(map).map(([country,d])=>({ country, count:d.count, avgScore:Math.round(d.scoreSum/d.count) })).sort((a,b)=>b.count-a.count).slice(0,8);
  },[cases]);

  const expiryRadar = useMemo(()=>cases.filter(c=>c.expiryDate).map(c=>({...c,days:daysUntil(c.expiryDate)})).sort((a,b)=>a.days-b.days).slice(0,8),[cases]);

  const scoreDist = useMemo(()=>({ strong:cases.filter(c=>c.overallScore>=70).length, moderate:cases.filter(c=>c.overallScore>=45&&c.overallScore<70).length, weak:cases.filter(c=>c.overallScore<45).length, total:cases.length }),[cases]);

  const alertCountries = useMemo(()=>new Set(policyAlerts.flatMap(a=>(a.affected_countries||[]).map(x=>x.toLowerCase().trim()))),[policyAlerts]);

  const handleStatusChange = useCallback(async(caseId,newStatus)=>{
    const ts=new Date().toISOString();
    setCases(prev=>prev.map(c=>c.id===caseId?{...c,leadStatus:newStatus,updatedAt:ts,statusUpdatedAt:ts}:c));
    setPeekStudent(prev=>prev?.id===caseId?{...prev,leadStatus:newStatus,updatedAt:ts,statusUpdatedAt:ts}:prev);
    _nbaCache.delete(caseId);
    setSavingId(caseId);
    await updateLeadStatus(caseId,newStatus);
    setSavingId(null);
  },[]);

  const handleNoteUpdate = useCallback((caseId, updatedNotes)=>{
    const ts = new Date().toISOString();
    setCases(prev=>prev.map(c=>c.id===caseId?{...c,notes:updatedNotes,updatedAt:ts}:c));
    setPeekStudent(prev=>prev?.id===caseId?{...prev,notes:updatedNotes,updatedAt:ts}:prev);
    _nbaCache.delete(caseId);
  },[]);

  const handleMorningBrief = useCallback(async () => {
    setBriefOpen(true);
    if (briefText) return; 
    setBriefLoading(true);
    const top = actionQueue.slice(0, 8).map(c => ({
      id: c.id, studentName: c.studentName, targetCountry: c.targetCountry,
      leadStatus: c.leadStatus, overallScore: c.overallScore,
      updatedAt: c.updatedAt, expiryDate: c.expiryDate, expiryDocType: c.expiryDocType,
    }));
    const result = await fetchMorningBrief(top);
    setBriefText(result || 'No urgent cases require immediate attention. Your pipeline is in good shape!');
    setBriefLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actionQueue, briefText]);

  const toggleSelect = useCallback(id=>{
    setSelectedIds(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  },[]);

  const toggleSelectAll = useCallback(()=>{
    setSelectedIds(prev=>prev.size===filtered.length?new Set():new Set(filtered.map(c=>c.id)));
  },[filtered]);

  const handleBulkStatus = useCallback(async ns=>{
    if(ns==='__select_all__'){ setSelectedIds(new Set(filtered.map(c=>c.id))); return; }
    setBulkSaving(true);
    const ids=[...selectedIds], ts=new Date().toISOString();
    setCases(prev=>prev.map(c=>ids.includes(c.id)?{...c,leadStatus:ns,updatedAt:ts,statusUpdatedAt:ts}:c));
    await bulkUpdateStatus(ids,ns);
    setBulkSaving(false); setSelectedIds(new Set());
  },[selectedIds,filtered]);

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
        @keyframes sdb-slide-in-right { from{transform:translateX(100%)} to{transform:translateX(0)} }
        @keyframes sdb-shimmer        { 0%,100%{background-color:var(--s3)} 50%{background-color:var(--s2)} }
        /* Optional: Hide scrollbar for cleaner sticky sidebar on webkit */
        .sdb-sticky-sidebar::-webkit-scrollbar { display: none; }
        .sdb-sticky-sidebar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {peekStudent&&<QuickPeekDrawer student={peekStudent} onClose={()=>setPeekStudent(null)} onOpenFull={onLoad} onStatusChange={handleStatusChange} onNoteUpdate={handleNoteUpdate} savingId={savingId} policyAlerts={policyAlerts} inboxAlerts={inboxAlerts}/>}
      {someSelected&&<BulkActionBar selectedIds={selectedIds} allFiltered={filtered} counsellorOptions={counsellorOptions} onBulkStatus={handleBulkStatus} onBulkReassign={handleBulkReassign} onClear={()=>setSelectedIds(new Set())} bulkSaving={bulkSaving}/>}

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
                Gemini is reading your urgent cases…
              </div>
            ) : (
              <>
                <div style={{ padding:'16px', borderRadius:10, background:'var(--s2)', border:'1px solid var(--bd)', marginBottom:16 }}>
                  <p style={{ margin:0, fontSize:'var(--text-sm)', lineHeight:1.75, color:'var(--t1)', fontFamily:'var(--fu)' }}>{briefText}</p>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>{ setBriefText(null); handleMorningBrief(); }}
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
                <StatCard val={stats.total}  label="Total cases"       sub={loading?'…':`${cases.length} loaded`}           color="var(--p)"/>
                <StatCard val={stats.strong} label="Strong eligibility" sub="Score ≥ 70"                                      color="#059669" onClick={()=>{setScoreFilter('Strong');setActivePanel(null);}}/>
                <StatCard val={stats.expiring+stats.expired} label="Expiry alerts" sub={`${stats.expired} expired · ${stats.expiring} ≤30d`} color={stats.expiring+stats.expired>0?'#DC2626':'var(--t3)'} onClick={()=>{setExpiryFilter('Soon');setActivePanel('expiry');}}/>
                <StatCard val={stats.alerted} label="Policy matches"   sub={`${policyAlerts.length} active alert${policyAlerts.length!==1?'s':''}`} color={stats.alerted>0?'#FC471C':'var(--t3)'} onClick={()=>setActivePanel('risk')}/>
                {stats.stale>0&&<StatCard val={stats.stale} label="Stale cases" sub={`No movement >${STALE_DAYS}d`} color="#B45309" onClick={()=>setStaleFilter(true)}/>}

                <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, marginLeft:'auto' }}>
                  
                    <div style={{ display:'flex', border:'1px solid var(--bd)', borderRadius:7, overflow:'hidden', background:'var(--s2)' }}>
                    {[['list','list',<List size={12}/>],['board','board',<LayoutGrid size={12}/>]].map(([mode,label,icon])=>(
                      <button key={mode} onClick={()=>setViewMode(mode)} title={`${label} view`}
                        style={{ padding:'5px 10px', border:'none', cursor:'pointer', background:viewMode===mode?'var(--s1)':'transparent', color:viewMode===mode?'var(--p)':'var(--t3)', display:'flex', alignItems:'center', gap:4, fontSize:'var(--text-xs)', fontWeight:600, fontFamily:'var(--fu)', borderRight:mode==='list'?'1px solid var(--bd)':'none', transition:'all var(--fast)' }}
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
				{stats.expiring>0&&<button className="sdb-pill" style={{ background:'rgba(255,216,217,.5)', color:'#FC471C', border:'1px solid rgba(252,71,28,.2)' }} onClick={()=>{setExpiryFilter('Soon');setActivePanel('expiry');}}><Clock size={11}/>{stats.expiring} expiring ≤30d</button>}                {stats.weak>0&&<button className="sdb-pill sdb-pill--neu"  onClick={()=>setScoreFilter('Weak')}><AlertTriangle size={11}/>{stats.weak} weak profiles</button>}
                {actionQueue.length>0&&<button className="sdb-pill sdb-pill--blue" onClick={()=>setActivePanel('queue')}><Zap size={11}/>{actionQueue.length} need attention</button>}
                {stats.stale>0&&<button className="sdb-pill sdb-pill--warn" onClick={()=>setStaleFilter(true)} style={{ borderStyle:staleFilter?'solid':undefined }}><Clock size={11}/>{stats.stale} stale</button>}
				{stats.alerted>0&&<button className="sdb-pill" style={{ background:'rgba(255,216,217,.5)', color:'#FC471C', border:'1px solid rgba(252,71,28,.2)' }} onClick={()=>setActivePanel('risk')}><Bell size={11}/>{stats.alerted} policy matches</button>}              </div>
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
              <div className="sdb-search-wrap">
                <Search size={12} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--t3)', pointerEvents:'none' }}/>
                <input className="sdb-search-input" placeholder="Search student name…" value={nameSearch} onChange={e=>setNameSearch(e.target.value)}/>
                {nameSearch&&<button className="sdb-input-clear" onClick={()=>setNameSearch('')}><X size={10}/></button>}
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

            {/* Board / List */}
            {viewMode==='board' ? (
              <KanbanBoard cases={filtered} alertCountries={alertCountries} savingId={savingId} onStatusChange={handleStatusChange} onPeek={setPeekStudent} onLoad={onLoad}/>
            ) : (
              <div className="sdb-table">
                <div className="sdb-table-hdr">
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }} onClick={toggleSelectAll}>
                    {allSelected?<CheckSquare size={14} color="var(--p)"/>:someSelected?<CheckSquare size={14} color="var(--t3)" style={{ opacity:.4 }}/>:<Square size={14} color="var(--t3)" style={{ opacity:.4 }}/>}
                  </div>
                  <div className="sdb-col-hdr" style={{ gridColumn:'span 2' }}>Student</div>
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
                      onClick={()=>onLoad(c)}
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
                      <div><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: sb.bg, color: sb.color, fontFamily: 'var(--fu)' }}>
					{c.overallScore}/100
					</span></div>
                      <div><DocHealthBar expiryDate={c.expiryDate} expiryDocType={c.expiryDocType}/></div>
                      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                        <span className="sdb-row-meta">{timeAgo(c.updatedAt||c.savedAt)}</span>
                        <button onClick={e=>{e.stopPropagation();setPeekStudent(c);}}
                          style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 6px', borderRadius:4, border:'1px solid var(--bd)', background:'var(--s2)', color:'var(--t3)', cursor:'pointer', fontSize:10, fontFamily:'var(--fu)', fontWeight:500, transition:'all var(--fast)' }}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--p)';e.currentTarget.style.color='var(--p)';}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--bd)';e.currentTarget.style.color='var(--t3)';}}
                        ><Eye size={9}/> Peek</button>
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