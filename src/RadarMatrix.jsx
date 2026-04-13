import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { computeDocScore, viabilityScore } from './docScore';
import {
  Zap, Target, Mail, CheckCircle2, ArrowRight,
  MousePointerClick, Sparkles, Eye, EyeOff, Info,
  Loader2, X, ExternalLink, UserCheck, Clock, Calendar,
  ChevronDown, Archive, Send, AlertTriangle, TrendingUp,
  TrendingDown,
} from 'lucide-react';

/* ─── SMART ROI RADAR MATRIX v3 ───────────────────────────────────────────────
 * v3 changes:
 *   [1] Saturated quadrant colors (+10%)
 *   [2] Quadrant labels 50% bigger + more opaque
 *   [3] Full score-range legend with band definitions
 *   [4] Movement tracking — drift pill above dot shows previous quadrant label
 *   [5] Click → Detail Side Panel (replaces full-profile navigation):
 *         • Created / Updated timestamps + stale indicator + pipeline days
 *         • AI Insight (Gemini)
 *         • Quadrant-aware smart actions
 *         • Reassign dropdown
 *   [6] onQuadrantsComputed callback for parent to persist snapshot
 */

/* ─── Quadrant config (colors saturated +10% vs v2) ─────────────────── */
const QUADRANTS = {
  vip: {
    id: 'vip',
    label: 'VIP Lane',
    description: 'High viability + docs ready — immediate processing',
    color: '#02a06d',
    bg: 'rgba(2,160,109,.13)',
    border: 'rgba(2,160,109,.25)',
    condition: (r, v) => v >= 50 && r >= 50,
    actionText: 'Process & Submit',
    actionIcon: CheckCircle2,
  },
  sales: {
    id: 'sales',
    label: 'Sales Priority',
    description: 'High viability blocked by missing documents',
    color: '#0d5fe0',
    bg: 'rgba(13,95,224,.13)',
    border: 'rgba(13,95,224,.25)',
    condition: (r, v) => v >= 50 && r < 50,
    actionText: 'Nudge Missing Docs',
    actionIcon: Mail,
  },
  drainers: {
    id: 'drainers',
    label: 'Time Drainers',
    description: 'Docs complete but low viability — review carefully',
    color: '#e07b00',
    bg: 'rgba(224,123,0,.13)',
    border: 'rgba(224,123,0,.25)',
    condition: (r, v) => v < 50 && r >= 50,
    actionText: 'Suggest Alternatives',
    actionIcon: Target,
  },
  dead: {
    id: 'dead',
    label: 'Dead Zone',
    description: 'Low viability + low readiness — de-prioritize',
    color: '#6b7280',
    bg: 'rgba(107,114,128,.13)',
    border: 'rgba(107,114,128,.2)',
    condition: (r, v) => v < 50 && r < 50,
    actionText: 'Archive / Hold',
    actionIcon: Archive,
  },
};

/* ─── Score band definitions ─────────────────────────────────────────── */
const READINESS_BANDS = [
  { min: 75, max: 100, label: 'Ready',      color: '#02a06d', bg: 'rgba(2,160,109,.1)',  desc: 'All core docs present' },
  { min: 50, max: 74,  label: 'Partial',    color: '#e07b00', bg: 'rgba(224,123,0,.1)',  desc: '1–2 key docs missing' },
  { min: 30, max: 49,  label: 'Incomplete', color: '#FC471C', bg: 'rgba(252,71,28,.1)',  desc: '3+ docs missing' },
  { min: 0,  max: 29,  label: 'Critical',   color: '#DC2626', bg: 'rgba(220,38,38,.1)',  desc: 'Most docs absent' },
];
const VIABILITY_BANDS = [
  { min: 75, max: 100, label: 'Strong',   color: '#02a06d', bg: 'rgba(2,160,109,.1)',  desc: 'Strong academics + funds' },
  { min: 50, max: 74,  label: 'Moderate', color: '#0d5fe0', bg: 'rgba(13,95,224,.1)',  desc: 'Decent profile, minor gaps' },
  { min: 30, max: 49,  label: 'Low',      color: '#FC471C', bg: 'rgba(252,71,28,.1)',  desc: 'Gaps in academics or funds' },
  { min: 0,  max: 29,  label: 'Weak',     color: '#DC2626', bg: 'rgba(220,38,38,.1)',  desc: 'Significant risk factors' },
];

const STALE_DAYS = 14;

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function daysUntilExpiry(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / 86400000);
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d)) / 86400000);
}
function fmtRelative(d) {
  const n = daysAgo(d);
  if (n === null) return '—';
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 30) return `${n}d ago`;
  if (n < 365) return `${Math.floor(n / 30)}mo ago`;
  return `${Math.floor(n / 365)}y ago`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─── ScoreBandRow ───────────────────────────────────────────────────── */
function ScoreBandRow({ band, value }) {
  const active = value >= band.min && value <= band.max;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
      borderRadius: 6,
      background: active ? band.bg : 'transparent',
      border: active ? `1px solid ${band.color}40` : '1px solid transparent',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: band.color, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: active ? band.color : 'var(--t2)', fontFamily: 'var(--fu)' }}>
          {band.label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginLeft: 5 }}>
          {band.min}–{band.max} · {band.desc}
        </span>
      </div>
    </div>
  );
}

/* ─── MiniBar ────────────────────────────────────────────────────────── */
function MiniBar({ value, color, label }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--fu)' }}>{value}</span>
      </div>
      <div style={{ height: 5, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, background: color, borderRadius: 3, transition: 'width .4s' }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   CONFIRM DIALOG — lightweight inline modal for action safety
════════════════════════════════════════════════════════════════════════ */
function ConfirmDialog({ title, body, confirmLabel, confirmColor, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,30,60,.45)', backdropFilter: 'blur(3px)', animation: 'radarFadeInOut2 .15s ease forwards' }}>
      <div style={{ background: 'var(--s1)', border: '1px solid var(--bd)', borderRadius: 14, padding: '22px 24px', maxWidth: 340, width: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--fu)', lineHeight: 1.55 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t2)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: confirmColor || 'var(--p)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'var(--fu)', cursor: 'pointer' }}>
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DETAIL SIDE PANEL
════════════════════════════════════════════════════════════════════════ */
function DetailPanel({ caseData, aiInsight, onClose, onOpenCase, onReassign, onStatusChange, counsellorList, isManager = false }) {
  const [reassignOpen,  setReassignOpen]  = useState(false);
  const [reassigning,   setReassigning]   = useState(false);
  const [statusSaving,  setStatusSaving]  = useState(false);
  // Confirmation dialog state: null | { title, body, confirmLabel, confirmColor, onConfirm }
  const [confirmPending, setConfirmPending] = useState(null);
  const reassignRef = useRef(null);

  useEffect(() => {
    const h = e => { if (reassignRef.current && !reassignRef.current.contains(e.target)) setReassignOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const quad        = QUADRANTS[caseData.quadrant];
  const createdDays = daysAgo(caseData.savedAt);
  const updatedDays = daysAgo(caseData.updatedAt || caseData.savedAt);
  const isStale     = updatedDays !== null && updatedDays >= STALE_DAYS
    && caseData.leadStatus !== 'Done' && caseData.leadStatus !== 'None';
  const pipelineDays = createdDays ?? 0;

  const rBand = READINESS_BANDS.find(b => caseData.rScore >= b.min && caseData.rScore <= b.max) || READINESS_BANDS[3];
  const vBand = VIABILITY_BANDS.find(b => caseData.vScore >= b.min && caseData.vScore <= b.max) || VIABILITY_BANDS[3];

  // Helper: wrap an action in a confirmation gate
  function withConfirm({ title, body, confirmLabel, confirmColor, action }) {
    setConfirmPending({ title, body, confirmLabel, confirmColor, action });
  }

  // Quadrant-aware smart actions — all routed through confirmation
  const smartActions = [];
  if (caseData.quadrant === 'vip') {
    smartActions.push({ label: 'Mark as Submitted', color: '#02a06d', icon: CheckCircle2,
      onClick: () => withConfirm({ title: 'Mark as Submitted?', body: `This will move ${caseData.name} to "Application Submitted". Make sure the application has actually been sent.`, confirmLabel: 'Mark Submitted', confirmColor: '#02a06d',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Application Submitted'); setStatusSaving(false); } }) });
    smartActions.push({ label: 'Move to Ready for Visa', color: '#02a06d', icon: ArrowRight,
      onClick: () => withConfirm({ title: 'Move to Ready for Visa?', body: `This will update ${caseData.name}'s status to "Ready for Visa". Confirm all offer conditions are met.`, confirmLabel: 'Move Status', confirmColor: '#02a06d',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Ready for Visa'); setStatusSaving(false); } }) });
  }
  if (caseData.quadrant === 'sales') {
    smartActions.push({ label: 'Mark Docs Received', color: '#0d5fe0', icon: CheckCircle2,
      onClick: () => withConfirm({ title: 'Mark Docs Received?', body: `This moves ${caseData.name} to "Ready to Apply". Only confirm if all required documents have been physically received.`, confirmLabel: 'Confirm Docs', confirmColor: '#0d5fe0',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Ready to Apply'); setStatusSaving(false); } }) });
    smartActions.push({ label: 'Flag for Follow Up', color: '#FC471C', icon: Send,
      onClick: () => withConfirm({ title: 'Flag for Follow Up?', body: `${caseData.name} will be moved to "Follow up" status so the team knows to chase missing documents.`, confirmLabel: 'Flag Case', confirmColor: '#FC471C',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Follow up'); setStatusSaving(false); } }) });
  }
  if (caseData.quadrant === 'drainers') {
    smartActions.push({ label: 'Flag for Follow Up', color: '#FC471C', icon: Send,
      onClick: () => withConfirm({ title: 'Flag for Follow Up?', body: `${caseData.name} will be moved to "Follow up". This is appropriate when you want to schedule a viability review call.`, confirmLabel: 'Flag Case', confirmColor: '#FC471C',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Follow up'); setStatusSaving(false); } }) });
    smartActions.push({ label: 'Archive / Hold', color: '#6b7280', icon: Archive,
      onClick: () => withConfirm({ title: 'Archive this case?', body: `${caseData.name} will be set to "None" and removed from the active pipeline. You can re-activate later.`, confirmLabel: 'Archive', confirmColor: '#6b7280',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'None'); setStatusSaving(false); } }) });
  }
  if (caseData.quadrant === 'dead') {
    smartActions.push({ label: 'Move to Follow Up', color: '#FC471C', icon: Send,
      onClick: () => withConfirm({ title: 'Move to Follow Up?', body: `This will re-activate ${caseData.name} and flag them for follow up. Use this if you believe there is still a viable pathway.`, confirmLabel: 'Re-activate', confirmColor: '#FC471C',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'Follow up'); setStatusSaving(false); } }) });
    smartActions.push({ label: 'Archive / Hold', color: '#6b7280', icon: Archive,
      onClick: () => withConfirm({ title: 'Archive this case?', body: `${caseData.name} will be set to "None" and deprioritised. Only do this if you are certain there is no current opportunity.`, confirmLabel: 'Archive', confirmColor: '#6b7280',
        action: async () => { setStatusSaving(true); await onStatusChange?.(caseData.id, 'None'); setStatusSaving(false); } }) });
  }

  return (
    <>
      {/* Confirmation dialog — rendered in a portal above everything */}
      {confirmPending && (
        <ConfirmDialog
          title={confirmPending.title}
          body={confirmPending.body}
          confirmLabel={confirmPending.confirmLabel}
          confirmColor={confirmPending.confirmColor}
          onCancel={() => setConfirmPending(null)}
          onConfirm={async () => {
            setConfirmPending(null);
            await confirmPending.action();
          }}
        />
      )}

    <div style={{
      width: 300, flexShrink: 0,
      background: 'var(--s1)', border: '1px solid var(--bd)',
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', animation: 'radarSlideIn .18s ease',
      maxHeight: 620, overflowY: 'auto',
      scrollbarWidth: 'none',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--bd)', background: quad.bg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {caseData.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: quad.color + '20', color: quad.color, fontFamily: 'var(--fu)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                {quad.label}
              </div>
              {isStale && <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(180,83,9,.12)', color: '#B45309', fontFamily: 'var(--fu)' }}>Stale</div>}
              {caseData.isUrgent && <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,.1)', color: '#DC2626', fontFamily: 'var(--fu)' }}>⚠ {caseData.daysLeft}d</div>}
              {caseData.drifted && (
                <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: caseData.driftDir === 'up' ? 'rgba(2,160,109,.12)' : 'rgba(220,38,38,.1)', color: caseData.driftDir === 'up' ? '#02a06d' : '#DC2626', fontFamily: 'var(--fu)' }}>
                  {caseData.driftDir === 'up' ? '↑' : '↓'} from {QUADRANTS[caseData.driftFrom]?.label}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--s2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', flexShrink: 0, transition: 'all .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--s3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--s2)'}
          ><X size={12} /></button>
        </div>
      </div>

      {/* Scores */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MiniBar value={caseData.rScore} color={rBand.color} label={`Readiness — ${rBand.label}`} />
        <MiniBar value={caseData.vScore} color={vBand.color} label={`Viability — ${vBand.label}`} />
      </div>

      {/* Timestamps */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 2 }}>Timeline</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={11} color="var(--t3)" />
          <span style={{ fontSize: 11, color: 'var(--t2)', fontFamily: 'var(--fu)', flex: 1 }}>
            Created <strong style={{ color: 'var(--t1)' }}>{fmtDate(caseData.savedAt)}</strong>
          </span>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{fmtRelative(caseData.savedAt)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={11} color={isStale ? '#B45309' : 'var(--t3)'} />
          <span style={{ fontSize: 11, color: 'var(--t2)', fontFamily: 'var(--fu)', flex: 1 }}>
            Updated <strong style={{ color: isStale ? '#B45309' : 'var(--t1)' }}>{fmtDate(caseData.updatedAt || caseData.savedAt)}</strong>
          </span>
          <span style={{ fontSize: 10, color: isStale ? '#B45309' : 'var(--t3)', fontFamily: 'var(--fu)' }}>{fmtRelative(caseData.updatedAt || caseData.savedAt)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={11} color="var(--t3)" />
          <span style={{ fontSize: 11, color: 'var(--t2)', fontFamily: 'var(--fu)' }}>
            In pipeline <strong style={{ color: 'var(--t1)' }}>{pipelineDays} day{pipelineDays !== 1 ? 's' : ''}</strong>
          </span>
        </div>
        {caseData.counsellorName && (
          <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            Assigned to <strong style={{ color: 'var(--t1)' }}>{caseData.counsellorName}</strong>
          </div>
        )}
      </div>

      {/* AI Insight */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Sparkles size={10} color={quad.color} /> AI Insight
        </div>
        <div style={{ background: 'var(--s2)', padding: '9px 10px', borderRadius: 7, borderLeft: `3px solid ${quad.color}` }}>
          {aiInsight?.loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              <Loader2 size={11} style={{ animation: 'radarSpin 1s linear infinite' }} /> Analysing profile…
            </div>
          ) : aiInsight?.text ? (
            <div style={{ fontSize: 11, color: 'var(--t1)', lineHeight: 1.55, fontFamily: 'var(--fu)' }}>{aiInsight.text}</div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, fontFamily: 'var(--fu)' }}>
              <Zap size={10} style={{ marginRight: 3 }} />{caseData.nextStep}
            </div>
          )}
        </div>
      </div>

      {/* Missing docs (sales quadrant) */}
      {caseData.quadrant === 'sales' && caseData.missingDocs?.length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd)', background: 'rgba(13,95,224,.04)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#0d5fe0', fontFamily: 'var(--fu)', marginBottom: 6 }}>Missing Docs</div>
          {caseData.missingDocs.slice(0, 4).map((doc, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--t2)', fontFamily: 'var(--fu)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#0d5fe0', flexShrink: 0 }} /> {doc}
            </div>
          ))}
          {caseData.missingDocs.length > 4 && <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>+{caseData.missingDocs.length - 4} more</div>}
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 2 }}>Actions</div>

        <button onClick={() => { onClose(); onOpenCase?.(caseData); }}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 8, border: 'none', background: 'var(--p)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)', width: '100%', transition: 'background .15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--pm)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--p)'}
        ><ExternalLink size={13} /> Open Full Profile</button>

        {smartActions.map((a, i) => {
          const Icon = a.icon;
          return (
            <button key={i} onClick={a.onClick} disabled={statusSaving}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8, border: `1px solid ${a.color}40`, background: a.color + '12', color: a.color, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)', width: '100%', transition: 'all .15s', opacity: statusSaving ? .5 : 1 }}
              onMouseEnter={e => { if (!statusSaving) e.currentTarget.style.background = a.color + '22'; }}
              onMouseLeave={e => { if (!statusSaving) e.currentTarget.style.background = a.color + '12'; }}
            >
              {statusSaving ? <Loader2 size={12} style={{ animation: 'radarSpin 1s linear infinite' }} /> : <Icon size={12} />}
              {a.label}
            </button>
          );
        })}

        {isManager && counsellorList?.length > 0 && (
          <div ref={reassignRef} style={{ position: 'relative' }}>
            <button onClick={() => setReassignOpen(o => !o)} disabled={reassigning}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t2)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)', width: '100%', transition: 'background .15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--s3)'}
              onMouseLeave={e => { if (!reassignOpen) e.currentTarget.style.background = 'var(--s2)'; }}
            >
              {reassigning ? <Loader2 size={12} style={{ animation: 'radarSpin 1s linear infinite' }} /> : <UserCheck size={12} />}
              Reassign Case
              <ChevronDown size={11} style={{ marginLeft: 'auto', transform: reassignOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {reassignOpen && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--s1)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', zIndex: 30, boxShadow: '0 8px 24px rgba(0,0,0,.15)' }}>
                {counsellorList.map(name => {
                  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
                  return (
                    <button key={name}
                      onClick={() => {
                        setReassignOpen(false);
                        withConfirm({
                          title: `Reassign to ${name}?`,
                          body: `${caseData.name}'s case will be transferred to ${name}. The previous counsellor will no longer see it in their personal view.`,
                          confirmLabel: 'Reassign',
                          confirmColor: 'var(--p)',
                          action: async () => { setReassigning(true); await onReassign?.(caseData.id, name); setReassigning(false); },
                        });
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: name === caseData.counsellorName ? 'var(--s2)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--t1)', fontFamily: 'var(--fu)', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = name === caseData.counsellorName ? 'var(--s2)' : 'transparent'}
                    >
                      <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: `hsl(${hue},55%,88%)`, color: `hsl(${hue},55%,30%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                        {name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                      </div>
                      {name}
                      {name === caseData.counsellorName && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>current</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   QUADRANT STUDENT LISTS — collapsible accordion below the matrix
════════════════════════════════════════════════════════════════════════ */
function QuadrantStudentLists({ plotData, onSelectCase, selectedCaseId }) {
  // Each quadrant independently collapsible; all start collapsed
  const [open, setOpen] = useState({});
  const toggle = id => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
      {Object.values(QUADRANTS).map(quad => {
        const students  = plotData.filter(c => c.quadrant === quad.id);
        const count     = students.length;
        const urgent    = students.filter(c => c.isUrgent).length;
        const moved     = students.filter(c => c.drifted).length;
        const isOpen    = !!open[quad.id];

        return (
          <div key={quad.id} style={{ borderRadius: 10, border: `1px solid ${quad.border}`, background: quad.bg, overflow: 'hidden' }}>
            {/* Clickable header row */}
            <button
              onClick={() => toggle(quad.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: quad.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: quad.color, flex: 1, fontFamily: 'var(--fu)' }}>
                {quad.label}
              </span>
              {urgent > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', background: '#EF444415', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--fu)' }}>
                  ⚠ {urgent}
                </span>
              )}
              {moved > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: quad.color, background: quad.color + '18', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--fu)' }}>
                  {moved} moved
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: 'rgba(0,0,0,.07)', color: quad.color, fontFamily: 'var(--fu)', flexShrink: 0 }}>
                {count}
              </span>
              <ChevronDown size={13} color={quad.color} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }} />
            </button>

            {/* Collapsible student list */}
            {isOpen && (
              <div style={{ borderTop: `1px solid ${quad.border}`, maxHeight: 180, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                {count === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>No students in this quadrant.</div>
                ) : students.map(c => {
                  const isSelected = c.id === selectedCaseId;
                  return (
                    <button key={c.id} onClick={() => onSelectCase(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: isSelected ? quad.color + '18' : 'transparent', border: 'none', borderBottom: `1px solid ${quad.border}`, cursor: 'pointer', textAlign: 'left', transition: 'background .12s' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = quad.color + '10'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {/* Initials avatar */}
                      <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: quad.color + '22', color: quad.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, fontFamily: 'var(--fu)' }}>
                        {c.name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: isSelected ? 700 : 500, color: isSelected ? quad.color : 'var(--t1)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      {c.isUrgent && <span style={{ fontSize: 9, color: '#EF4444', fontWeight: 700, fontFamily: 'var(--fu)', flexShrink: 0 }}>⚠ {c.daysLeft}d</span>}
                      {c.drifted && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: c.driftDir === 'up' ? '#02a06d' : '#EF4444', fontFamily: 'var(--fu)', flexShrink: 0 }}>
                          {c.driftDir === 'up' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── RBAC helpers ───────────────────────────────────────────────────── */
function canManageTeam(orgSession) {
  if (!orgSession?.access_token) return true; // legacy access-code sessions: full access
  return ['org_owner', 'branch_manager'].includes(orgSession?.role);
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN EXPORT
════════════════════════════════════════════════════════════════════════ */
export default function RadarMatrix({
  cases = [],
  onStudentClick,
  onOpenCase,
  onBulkAction,
  callGeminiInsight,
  previousQuadrants = {},
  externalInsightCache,
  onQuadrantsComputed,
  counsellorList = [],
  onReassign,
  onStatusChange,
  orgSession = null,   // ← new: used for RBAC gating
}) {
  const handleOpen = onOpenCase || onStudentClick;
  const isManager  = canManageTeam(orgSession);

  const [hoveredCase,  setHoveredCase]  = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showDeadZone, setShowDeadZone] = useState(true);
  const [toastMsg,     setToastMsg]     = useState(null);
  const [aiInsight,    setAiInsight]    = useState(null);
  const insightCache = useRef({});
  const hoverTimer   = useRef(null);

  const triggerFeedback = msg => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000); };

  /* ── 1. Compute plot data ───────────────────────────────────────────── */
  const plotData = useMemo(() => cases.map(c => {
    const studentName = c.studentName || c.student_name || c.profile?.fullName || c.name || 'Unnamed';
    const rawV   = viabilityScore ? viabilityScore(c.profileData) : { score: 0 };
    const vScore = Math.round(rawV?.score ?? rawV ?? 0);
    const docHealth = computeDocScore
      ? computeDocScore(c.profileData, c.results)
      : { score: 0, totalPossible: 100, missing: [] };
    const rScore = Math.round((docHealth.score / (docHealth.totalPossible || 100)) * 100);

    let quadId = 'dead';
    for (const key in QUADRANTS) {
      if (QUADRANTS[key].condition(rScore, vScore)) { quadId = key; break; }
    }

    const missing = docHealth.missing || [];
    let nextStep = 'Review profile and identify quick wins';
    if (quadId === 'vip')      nextStep = 'Finalise application and submit immediately';
    if (quadId === 'sales')    nextStep = `Chase: ${missing.slice(0, 2).join(', ') || 'missing docs'}`;
    if (quadId === 'drainers') nextStep = 'Explore alternative institutions or pathways';
    if (quadId === 'dead')     nextStep = 'Archive or schedule a reassessment call';

    const daysLeft = daysUntilExpiry(c.expiry_date || c.expiryDate);
    const isUrgent = daysLeft !== null && daysLeft <= 30 && daysLeft >= 0;
    const prevQuad  = previousQuadrants[c.id];
    const drifted   = !!prevQuad && prevQuad !== quadId;
    const driftDir  = drifted ? (['vip', 'sales'].includes(quadId) ? 'up' : 'down') : null;
    const driftFrom = drifted ? prevQuad : null;

    return { ...c, name: studentName, vScore, rScore, quadrant: quadId, nextStep, missingDocs: missing, isUrgent, daysLeft, drifted, driftDir, driftFrom };
  }), [cases, previousQuadrants]);

  /* ── Notify parent of quadrant map for persistence ─────────────────── */
  const quadrantSignature = plotData.map(c => `${c.id}:${c.quadrant}`).join(',');
  useEffect(() => {
    if (!onQuadrantsComputed || plotData.length === 0) return;
    const map = {};
    plotData.forEach(c => { map[c.id] = c.quadrant; });
    onQuadrantsComputed(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadrantSignature]);

  const visiblePlotData = useMemo(
    () => showDeadZone ? plotData : plotData.filter(c => c.quadrant !== 'dead'),
    [plotData, showDeadZone]
  );

  /* ── 2. Matrix insight ─────────────────────────────────────────────── */
  const matrixInsight = useMemo(() => {
    const counts = plotData.reduce((acc, c) => { acc[c.quadrant] = (acc[c.quadrant] || 0) + 1; return acc; }, {});
    const urgentCount = plotData.filter(c => c.isUrgent).length;
    const movedUp     = plotData.filter(c => c.driftDir === 'up').length;
    const movedDown   = plotData.filter(c => c.driftDir === 'down').length;

    if (urgentCount > 0)
      return { text: `⚠️ ${urgentCount} student${urgentCount > 1 ? 's have' : ' has'} documents expiring within 30 days. Act immediately.`, urgency: 'critical' };
    if (movedUp > 0 || movedDown > 0) {
      const parts = [];
      if (movedUp > 0)   parts.push(`${movedUp} case${movedUp > 1 ? 's' : ''} improved ↑`);
      if (movedDown > 0) parts.push(`${movedDown} declined ↓`);
      return { text: `Movement since last session: ${parts.join(' · ')}.`, urgency: movedUp >= movedDown ? 'high' : 'medium' };
    }
    if (counts.vip > 0)
      return { text: `${counts.vip} VIP case${counts.vip > 1 ? 's are' : ' is'} ready to submit. Focus here first.`, urgency: 'high' };
    if (counts.sales > 0)
      return { text: `${counts.sales} high-viability case${counts.sales > 1 ? 's are' : ' is'} blocked by missing docs. Nudge them now.`, urgency: 'medium' };
    return { text: 'Pipeline looks quiet. Focus on moving cases out of the Dead Zone.', urgency: 'low' };
  }, [plotData]);

  const movedUp   = plotData.filter(c => c.driftDir === 'up').length;
  const movedDown = plotData.filter(c => c.driftDir === 'down').length;

  /* ── 3. AI insight ─────────────────────────────────────────────────── */
  const getCached = id => externalInsightCache ? externalInsightCache.get(id) : insightCache.current[id];
  const setCached = (id, text) => {
    if (externalInsightCache) externalInsightCache.set(id, text);
    else insightCache.current[id] = text;
  };

  const fetchAiInsight = useCallback(async c => {
    const cached = getCached(c.id);
    if (cached) { setAiInsight({ text: cached, loading: false }); return; }
    setAiInsight({ text: null, loading: true });
    if (!callGeminiInsight) { setAiInsight({ text: c.nextStep, loading: false }); return; }
    const prompt = [
      `Student: ${c.name}`,
      `Quadrant: ${QUADRANTS[c.quadrant].label}`,
      `Readiness: ${c.rScore}%  Viability: ${c.vScore}/100`,
      `Missing docs: ${c.missingDocs.join(', ') || 'none'}`,
      c.isUrgent ? `⚠️ Expiry in ${c.daysLeft} days` : '',
      `Country: ${c.targetCountry || c.target_country || 'unknown'}`,
      `Days in pipeline: ${daysAgo(c.savedAt) ?? 0}  Last updated: ${fmtRelative(c.updatedAt || c.savedAt)}`,
      '',
      'In 2 short sentences: explain WHY this student is in this quadrant and the single most impactful next action. Be specific.',
    ].filter(Boolean).join('\n');
    try {
      const text = await callGeminiInsight(prompt, c.id);
      setCached(c.id, text);
      setAiInsight({ text, loading: false });
    } catch {
      setAiInsight({ text: c.nextStep, loading: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callGeminiInsight, externalInsightCache]);

  const handleDotHover = useCallback(c => {
    setHoveredCase(c);
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => fetchAiInsight(c), 600);
  }, [fetchAiInsight]);

  const handleDotLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHoveredCase(null);
    setAiInsight(null);
  }, []);

  // When panel opens for a new case, fetch AI insight for it
  useEffect(() => {
    if (!selectedCase) return;
    setAiInsight(null);
    fetchAiInsight(selectedCase);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCase?.id]);

  const handleDotClick = useCallback((e, c) => {
    e.stopPropagation();
    clearTimeout(hoverTimer.current);
    setHoveredCase(null);
    setSelectedCase(prev => prev?.id === c.id ? null : c);
  }, []);

  const handleBulkAction = quadId => {
    triggerFeedback(`Executing '${QUADRANTS[quadId].actionText}' for all ${QUADRANTS[quadId].label} cases.`);
    if (onBulkAction) onBulkAction(quadId, plotData.filter(c => c.quadrant === quadId));
  };

  const urgencyColor = { critical: '#EF4444', high: '#02a06d', medium: '#0d5fe0', low: '#9CA3AF' };

  return (
    <div style={{ position: 'relative', background: 'var(--s1)', borderRadius: 12, border: '1px solid var(--s3)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1D6BE8', color: '#fff', padding: '8px 16px', borderRadius: 24, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(29,107,232,0.3)', zIndex: 100, animation: 'radarFadeInOut 3s ease-in-out forwards', whiteSpace: 'nowrap' }}>
          <Info size={14} /> {toastMsg}
        </div>
      )}

      {/* AI Synthesis Banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: `${urgencyColor[matrixInsight.urgency]}14`, borderRadius: 8, border: `1px solid ${urgencyColor[matrixInsight.urgency]}30` }}>
        <Sparkles size={20} color={urgencyColor[matrixInsight.urgency]} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: urgencyColor[matrixInsight.urgency], textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--fu)' }}>Smart Matrix Insight</div>
          <div style={{ fontSize: 14, color: 'var(--t1)', marginTop: 2, fontFamily: 'var(--fu)' }}>{matrixInsight.text}</div>
        </div>
        {(movedUp > 0 || movedDown > 0) && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {movedUp > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: 'rgba(2,160,109,.12)', color: '#02a06d', fontSize: 11, fontWeight: 700, fontFamily: 'var(--fu)' }}><TrendingUp size={11} /> {movedUp} ↑</div>}
            {movedDown > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: 'rgba(220,38,38,.12)', color: '#DC2626', fontSize: 11, fontWeight: 700, fontFamily: 'var(--fu)' }}><TrendingDown size={11} /> {movedDown} ↓</div>}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setShowDeadZone(s => !s)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, fontFamily: 'var(--fu)', background: showDeadZone ? 'var(--s2)' : 'rgba(107,114,128,.1)', border: '1px solid var(--s3)', color: showDeadZone ? 'var(--t1)' : 'var(--t2)', padding: '6px 12px', borderRadius: 20, cursor: 'pointer', transition: 'all .2s' }}
        >
          {showDeadZone ? <Eye size={14} /> : <EyeOff size={14} />}
          {showDeadZone ? 'Hide Dead Zone' : 'Show Dead Zone'}
        </button>
      </div>

      {/* Matrix + optional side panel — flex row */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* Matrix Plot */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: selectedCase ? '100%' : '85%', margin: '0 auto', aspectRatio: '1.4', background: 'var(--s2)', borderRadius: 8, overflow: 'visible', border: '1px solid var(--s3)', transition: 'width .2s' }}>

              {/* Quadrant backgrounds */}
              <div style={{ position: 'absolute', top: 0, left: '50%', right: 0, bottom: '50%', background: QUADRANTS.vip.bg, borderBottom: '1px dashed var(--s3)', borderLeft: '1px dashed var(--s3)', borderTopRightRadius: 8 }} />
              <div style={{ position: 'absolute', top: 0, left: 0, right: '50%', bottom: '50%', background: QUADRANTS.sales.bg, borderBottom: '1px dashed var(--s3)', borderTopLeftRadius: 8 }} />
              <div style={{ position: 'absolute', top: '50%', left: '50%', right: 0, bottom: 0, background: QUADRANTS.drainers.bg, borderLeft: '1px dashed var(--s3)', borderBottomRightRadius: 8 }} />
              <div style={{ position: 'absolute', top: '50%', left: 0, right: '50%', bottom: 0, background: QUADRANTS.dead.bg, borderBottomLeftRadius: 8 }} />

              {/* Quadrant labels — 13px (50% bigger than original 9px) */}
              {[
                { q: 'vip',      top: '10px',   right: '12px' },
                { q: 'sales',    top: '10px',   left: '12px'  },
                { q: 'drainers', bottom: '10px', right: '12px' },
                { q: 'dead',     bottom: '10px', left: '12px'  },
              ].map(({ q, ...pos }) => (
                <div key={q} style={{ position: 'absolute', ...pos, fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', color: QUADRANTS[q].color, opacity: 0.8, textTransform: 'uppercase', fontFamily: 'var(--fu)', pointerEvents: 'none' }}>
                  {QUADRANTS[q].label}
                </div>
              ))}

              {/* Axis labels */}
              <div style={{ position: 'absolute', bottom: -26, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--t3)', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'var(--fu)' }}>
                ← Low Readiness — High Readiness →
              </div>
              <div style={{ position: 'absolute', top: '50%', left: -32, transform: 'translateY(-50%) rotate(-90deg)', fontSize: 11, color: 'var(--t3)', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'var(--fu)' }}>
                ← Low Viability — High Viability →
              </div>

              {/* Plot dots */}
              {visiblePlotData.map(c => {
                const left       = `${Math.max(3, Math.min(97, c.rScore))}%`;
                const bottom     = `${Math.max(3, Math.min(97, c.vScore))}%`;
                const quad       = QUADRANTS[c.quadrant];
                const isHovered  = hoveredCase?.id === c.id;
                const isSelected = selectedCase?.id === c.id;
                const dotSize    = c.isUrgent ? 18 : 13;

                return (
                  <div key={c.id}
                    onMouseEnter={() => { if (!selectedCase) handleDotHover(c); }}
                    onMouseLeave={() => { if (!selectedCase) handleDotLeave(); }}
                    onClick={e => handleDotClick(e, c)}
                    style={{ position: 'absolute', left, bottom, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translate(-50%, 50%)', cursor: 'pointer', zIndex: isSelected ? 15 : isHovered ? 10 : 1 }}
                  >
                    {c.isUrgent && (
                      <div style={{ position: 'absolute', width: dotSize + 12, height: dotSize + 12, borderRadius: '50%', background: '#EF444430', animation: 'radarPulse 1.5s ease-in-out infinite' }} />
                    )}
                    {isSelected && (
                      <div style={{ position: 'absolute', width: dotSize + 10, height: dotSize + 10, borderRadius: '50%', border: `2px solid ${quad.color}`, boxShadow: `0 0 0 3px ${quad.color}30` }} />
                    )}
                    <div style={{ width: dotSize, height: dotSize, background: quad.color, borderRadius: '50%', border: `2px solid ${isHovered || isSelected ? '#fff' : 'rgba(255,255,255,0.7)'}`, boxShadow: isHovered || isSelected ? `0 0 0 4px ${quad.color}40` : '0 2px 4px rgba(0,0,0,0.15)', transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)' }} />
                    {/* Drift pill above dot */}
                    {c.drifted && (
                      <div style={{ position: 'absolute', top: -20, display: 'flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 10, background: c.driftDir === 'up' ? '#02a06d' : '#EF4444', color: '#fff', fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap', fontFamily: 'var(--fu)', boxShadow: '0 1px 4px rgba(0,0,0,.2)', pointerEvents: 'none' }}>
                        {c.driftDir === 'up' ? '↑' : '↓'} {QUADRANTS[c.driftFrom]?.label}
                      </div>
                    )}
                    {/* Always-visible name label — shown when panel is open so dots stay identifiable */}
                    {selectedCase && !isSelected && (
                      <div style={{
                        position: 'absolute', bottom: dotSize + 4, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(15,30,60,.82)', color: '#fff', fontSize: 8, fontWeight: 600,
                        padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap', fontFamily: 'var(--fu)',
                        pointerEvents: 'none', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis',
                        opacity: 0.85,
                      }}>
                        {c.name.split(' ')[0]}
                      </div>
                    )}
                    {/* Selected dot label */}
                    {isSelected && (
                      <div style={{
                        position: 'absolute', bottom: dotSize + 6, left: '50%', transform: 'translateX(-50%)',
                        background: quad.color, color: '#fff', fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap', fontFamily: 'var(--fu)',
                        pointerEvents: 'none', boxShadow: `0 2px 6px ${quad.color}60`,
                      }}>
                        {c.name.split(' ')[0]}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Hover tooltip — only when no panel open */}
              {hoveredCase && !selectedCase && (() => {
                const cl = Math.max(15, Math.min(72, hoveredCase.rScore));
                return (
                  <div style={{ position: 'absolute', left: `${cl}%`, bottom: `calc(${Math.min(85, hoveredCase.vScore)}% + 28px)`, transform: 'translateX(-50%)', background: 'var(--s1)', border: '1px solid var(--s3)', borderRadius: 10, padding: 12, width: 220, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', zIndex: 20, pointerEvents: 'none', fontFamily: 'var(--fu)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t1)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hoveredCase.name}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: QUADRANTS[hoveredCase.quadrant].color + '20', color: QUADRANTS[hoveredCase.quadrant].color, whiteSpace: 'nowrap' }}>{QUADRANTS[hoveredCase.quadrant].label}</div>
                    </div>
                    {hoveredCase.isUrgent && <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, marginBottom: 6 }}>⚠️ Doc expiring in {hoveredCase.daysLeft}d</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                      <div><div style={{ fontSize: 10, color: 'var(--t3)' }}>Readiness</div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{hoveredCase.rScore}%</div></div>
                      <div><div style={{ fontSize: 10, color: 'var(--t3)' }}>Viability</div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{hoveredCase.vScore}</div></div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MousePointerClick size={10} /> Click for details &amp; actions
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Detail Side Panel */}
        {selectedCase && (
          <DetailPanel
            caseData={selectedCase}
            aiInsight={aiInsight}
            onClose={() => { setSelectedCase(null); setAiInsight(null); }}
            onOpenCase={handleOpen}
            onReassign={onReassign}
            onStatusChange={onStatusChange}
            counsellorList={counsellorList}
            isManager={isManager}
          />
        )}
      </div>

      {/* ══ BOTTOM LEGEND ════════════════════════════════════════════════ */}

      {/* Section A: Quadrant collapsible student lists — shown only in radar view */}
      <QuadrantStudentLists plotData={plotData} onSelectCase={c => { setHoveredCase(null); setSelectedCase(c); }} selectedCaseId={selectedCase?.id} />

      {/* Section B: Score Range Reference Legend */}
      <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 8px', background: 'var(--s2)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={13} color="var(--t3)" />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)' }}>Score Range Reference</span>
          {selectedCase && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>— highlighted band = {selectedCase.name}'s current position</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {/* Readiness */}
          <div style={{ padding: '12px 14px', borderRight: '1px solid var(--bd)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#02a06d', fontFamily: 'var(--fu)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#02a06d' }} /> Readiness Score
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 8, lineHeight: 1.5 }}>
              Document completeness. Passport 25 · English 20 · Financials 15 · Academic 15 · CNIC 10 · Offer 10 · CAS 5.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {READINESS_BANDS.map(b => <ScoreBandRow key={b.label} band={b} value={selectedCase?.rScore ?? -1} />)}
            </div>
          </div>
          {/* Viability */}
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0d5fe0', fontFamily: 'var(--fu)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0d5fe0' }} /> Viability Score
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginBottom: 8, lineHeight: 1.5 }}>
              Profile strength. Academic 40 · Financial capacity 35 · Risk factors 25 (age, marital status, prior rejections).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {VIABILITY_BANDS.map(b => <ScoreBandRow key={b.label} band={b} value={selectedCase?.vScore ?? -1} />)}
            </div>
          </div>
        </div>
        {/* Threshold note + movement summary */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--bd)', background: 'var(--s2)', fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--t2)' }}>Quadrant thresholds:</strong> Both ≥ 50 → VIP Lane · Viability ≥ 50 only → Sales Priority · Readiness ≥ 50 only → Time Drainer · Both &lt; 50 → Dead Zone.
          {(movedUp > 0 || movedDown > 0) && (
            <span style={{ marginLeft: 8 }}>
              <strong style={{ color: 'var(--t2)' }}>vs last session:</strong>
              {movedUp > 0 && <span style={{ color: '#02a06d', marginLeft: 4 }}>{movedUp} improved ↑</span>}
              {movedUp > 0 && movedDown > 0 && <span style={{ margin: '0 4px' }}>·</span>}
              {movedDown > 0 && <span style={{ color: '#EF4444' }}>{movedDown} declined ↓</span>}
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes radarFadeInOut {
          0%   { opacity:0; transform:translate(-50%,-10px); }
          10%  { opacity:1; transform:translate(-50%,0); }
          90%  { opacity:1; transform:translate(-50%,0); }
          100% { opacity:0; transform:translate(-50%,-10px); }
        }
        @keyframes radarFadeInOut2 {
          from { opacity:0; }
          to   { opacity:1; }
        }
        @keyframes radarSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes radarPulse {
          0%,100% { transform:scale(1); opacity:0.6; }
          50%     { transform:scale(1.6); opacity:0; }
        }
        @keyframes radarSlideIn {
          from { opacity:0; transform:translateX(14px); }
          to   { opacity:1; transform:translateX(0); }
        }
      `}</style>
    </div>
  );
}
