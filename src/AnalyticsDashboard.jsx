// VisaLens — AnalyticsDashboard.jsx
// Route: /analytics
// Access: org_owner and branch_manager only (enforced in App.jsx router)
// Data sources: case_snapshots, funnel_stage_entries, daily_counselor_stats, organizations

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell
} from 'recharts';
import {
  AlertTriangle, ArrowUpRight, BarChart3, ChevronRight, Clock,
  LogOut, RefreshCw, ShieldCheck, TrendingUp, TrendingDown,
  Users, Zap, Activity, Target, AlertCircle, CheckCircle2,
  Minus
} from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Quadrant colours — consistent with RadarMatrix ────────────────────────────
const Q_COLOR = {
  vip:      '#02a06d',
  sales:    '#1D6BE8',
  drainers: '#e07b00',
  dead:     '#6b7280',
};

const Q_LABEL = { vip: 'VIP', sales: 'Sales Priority', drainers: 'Time Drainers', dead: 'Dead Zone' };

// ── Confidence threshold — cases below this are "Unverified VIP" ──────────────
const CONFIDENCE_THRESHOLD = 0.40;

// ─────────────────────────────────────────────────────────────────────────────
// DATA HOOKS
// ─────────────────────────────────────────────────────────────────────────────

function useAnalyticsData(orgId) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      const [snapshotsRes, staleRes, statsRes, orgRes] = await Promise.all([
        // Last 30 days of snapshots for trend + scorecard
        supabase.from('case_snapshots')
          .select('case_id, counsellor_name, quadrant, doc_score, viability_score, viability_confidence, snapshot_date, funnel_stage, student_metadata')
          .eq('org_id', orgId)
          .gte('snapshot_date', thirtyDaysAgoStr)
          .order('snapshot_date', { ascending: true }),

        // Open funnel stage entries — for aging table and stale alerts
        supabase.from('funnel_stage_entries')
          .select('id, case_id, funnel_stage, entered_stage_at, days_in_stage, sla_breached, counsellor_name')
          .eq('org_id', orgId)
          .is('exited_stage_at', null)
          .order('entered_stage_at', { ascending: true }),

        // Last 30 days of daily counsellor stats
        supabase.from('daily_counselor_stats')
          .select('*')
          .eq('org_id', orgId)
          .gte('stat_date', thirtyDaysAgoStr)
          .order('stat_date', { ascending: true }),

        // Org SLA settings
        supabase.from('organizations')
          .select('sla_lead, sla_docs_pending, sla_ready_to_apply, sla_applied, sla_visa_prep, viability_confidence_threshold')
          .eq('id', orgId)
          .single(),
      ]);

      setData({
        snapshots:   snapshotsRes.data  || [],
        openEntries: staleRes.data      || [],
        stats:       statsRes.data      || [],
        sla:         orgRes.data        || {},
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, refresh: load };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Stale Alert Banner ────────────────────────────────────────────────────────
function StaleAlertBanner({ openEntries, onDrillDown }) {
  const breached = openEntries.filter(e => e.sla_breached);
  if (breached.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 20px', borderRadius: 10,
      background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.25)',
      marginBottom: 20, cursor: 'pointer',
    }} onClick={onDrillDown}>
      <AlertTriangle size={16} color="#DC2626" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', fontFamily: 'var(--fh)' }}>
          {breached.length} case{breached.length !== 1 ? 's' : ''} past SLA threshold
        </span>
        <span style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--fu)', marginLeft: 8 }}>
          Click to review
        </span>
      </div>
      <ChevronRight size={14} color="#DC2626" />
    </div>
  );
}

// ── Pipeline Aging Table ──────────────────────────────────────────────────────
function PipelineAgingTable({ openEntries, sla }) {
  const [sortBy, setSortBy] = useState('days');
  const [filterBreached, setFilterBreached] = useState(false);

  const SLA_MAP = {
    lead:           sla.sla_lead           || 3,
    docs_pending:   sla.sla_docs_pending   || 14,
    ready_to_apply: sla.sla_ready_to_apply || 7,
    applied:        sla.sla_applied        || 21,
    visa_prep:      sla.sla_visa_prep      || 10,
  };

  const rows = useMemo(() => {
    let entries = [...openEntries];
    if (filterBreached) entries = entries.filter(e => e.sla_breached);

    // Compute live days for entries where days_in_stage might be null
    entries = entries.map(e => ({
      ...e,
      liveDays: e.days_in_stage ?? Math.floor((Date.now() - new Date(e.entered_stage_at)) / 86400000),
      slaThreshold: SLA_MAP[e.funnel_stage] ?? null,
    }));

    if (sortBy === 'days') entries.sort((a, b) => b.liveDays - a.liveDays);
    if (sortBy === 'stage') entries.sort((a, b) => (a.funnel_stage || '').localeCompare(b.funnel_stage || ''));
    if (sortBy === 'counsellor') entries.sort((a, b) => (a.counsellor_name || '').localeCompare(b.counsellor_name || ''));

    return entries;
  }, [openEntries, sortBy, filterBreached]);

  const thStyle = (col) => ({
    padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--t3)',
    fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em',
    cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--bd)',
    background: sortBy === col ? 'var(--s2)' : 'transparent',
    userSelect: 'none',
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setFilterBreached(f => !f)} style={{
          padding: '5px 12px', borderRadius: 6, border: '1px solid var(--bd)',
          background: filterBreached ? 'rgba(220,38,38,.1)' : 'var(--s2)',
          color: filterBreached ? '#DC2626' : 'var(--t2)',
          fontSize: 11, fontWeight: 600, fontFamily: 'var(--fu)', cursor: 'pointer',
        }}>
          {filterBreached ? '✕ Clear filter' : '⚠ SLA breached only'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
          {rows.length} open cases
        </span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--bd)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle('counsellor')} onClick={() => setSortBy('counsellor')}>Counsellor</th>
              <th style={thStyle('stage')} onClick={() => setSortBy('stage')}>Stage</th>
              <th style={thStyle('days')} onClick={() => setSortBy('days')}>Days in Stage ↕</th>
              <th style={{ ...thStyle('sla'), cursor: 'default' }}>SLA</th>
              <th style={{ ...thStyle('status'), cursor: 'default' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--t3)', fontSize: 13, fontFamily: 'var(--fu)' }}>
                  No open cases match the current filter.
                </td>
              </tr>
            ) : rows.map((e, i) => {
              const breached = e.sla_breached;
              const pct = e.slaThreshold ? Math.min((e.liveDays / e.slaThreshold) * 100, 100) : null;
              return (
                <tr key={e.id} style={{ background: breached ? 'rgba(220,38,38,.04)' : i % 2 === 0 ? 'var(--s1)' : 'transparent' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>
                    {e.counsellor_name || '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--fu)' }}>
                    {(e.funnel_stage || '—').replace(/_/g, ' ')}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: breached ? '#DC2626' : 'var(--t1)', fontFamily: 'var(--fu)', minWidth: 28 }}>
                        {e.liveDays}d
                      </span>
                      {pct !== null && (
                        <div style={{ flex: 1, height: 4, background: 'var(--s3)', borderRadius: 2, overflow: 'hidden', maxWidth: 80 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: breached ? '#DC2626' : pct > 75 ? '#e07b00' : '#02a06d', borderRadius: 2, transition: 'width .3s' }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
                    {e.slaThreshold ? `${e.slaThreshold}d` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {breached
                      ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: 'rgba(220,38,38,.1)', color: '#DC2626', fontFamily: 'var(--fu)' }}>BREACHED</span>
                      : <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'rgba(2,160,109,.1)', color: '#02a06d', fontFamily: 'var(--fu)' }}>On track</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Counsellor Scorecards ─────────────────────────────────────────────────────
function CounsellorScorecards({ snapshots, confidenceThreshold }) {
  const threshold = confidenceThreshold || CONFIDENCE_THRESHOLD;

  const scorecards = useMemo(() => {
    // Get the most recent snapshot date
    const dates = [...new Set(snapshots.map(s => s.snapshot_date))].sort();
    const latestDate = dates[dates.length - 1];
    const prevDate   = dates[dates.length - 2] || null;

    const latestSnaps = snapshots.filter(s => s.snapshot_date === latestDate);
    const prevSnaps   = prevDate ? snapshots.filter(s => s.snapshot_date === prevDate) : [];

    // Group by counsellor
    const byName = {};
    for (const s of latestSnaps) {
      if (!s.counsellor_name) continue;
      if (!byName[s.counsellor_name]) byName[s.counsellor_name] = { name: s.counsellor_name, cases: [] };
      byName[s.counsellor_name].cases.push(s);
    }

    return Object.values(byName).map(({ name, cases }) => {
      const vip      = cases.filter(c => c.quadrant === 'vip' && (c.viability_confidence ?? 1) >= threshold);
      const unverified = cases.filter(c => c.quadrant === 'vip' && (c.viability_confidence ?? 1) < threshold);
      const sales    = cases.filter(c => c.quadrant === 'sales');
      const drainers = cases.filter(c => c.quadrant === 'drainers');
      const dead     = cases.filter(c => c.quadrant === 'dead');

      // Previous snapshot delta
      const prevCases = prevSnaps.filter(s => s.counsellor_name === name);
      const prevVip   = prevCases.filter(c => c.quadrant === 'vip').length;
      const vipDelta  = vip.length - prevVip;

      const avgViability = cases.length ? Math.round(cases.reduce((a, c) => a + (c.viability_score || 0), 0) / cases.length) : 0;

      return { name, total: cases.length, vip: vip.length, unverified: unverified.length, sales: sales.length, drainers: drainers.length, dead: dead.length, vipDelta, avgViability };
    }).sort((a, b) => b.vip - a.vip || b.total - a.total);
  }, [snapshots, threshold]);

  if (scorecards.length === 0) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13, fontFamily: 'var(--fu)' }}>
      No snapshot data yet. The cron will populate this after midnight.
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {scorecards.map(c => (
        <div key={c.name} style={{ padding: 16, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--s1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: 'var(--p)', opacity: .9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'var(--fh)', flexShrink: 0,
            }}>
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>{c.name}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{c.total} active cases</div>
            </div>
            {c.vipDelta !== 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--fu)',
                color: c.vipDelta > 0 ? '#02a06d' : '#DC2626' }}>
                {c.vipDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {c.vipDelta > 0 ? '+' : ''}{c.vipDelta} VIP
              </div>
            )}
          </div>

          {/* Quadrant breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
            {[['VIP', c.vip, Q_COLOR.vip], ['Sales', c.sales, Q_COLOR.sales], ['Drain', c.drainers, Q_COLOR.drainers], ['Dead', c.dead, Q_COLOR.dead]].map(([label, count, color]) => (
              <div key={label} style={{ textAlign: 'center', padding: '7px 4px', borderRadius: 7, background: color + '14', border: `1px solid ${color}28` }}>
                <div style={{ fontSize: 17, fontWeight: 800, color, fontFamily: 'var(--fu)', lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Unverified VIP warning */}
          {c.unverified > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6,
              background: 'rgba(224,123,0,.08)', border: '1px solid rgba(224,123,0,.2)', marginBottom: 10 }}>
              <AlertCircle size={11} color="#e07b00" />
              <span style={{ fontSize: 11, color: '#e07b00', fontFamily: 'var(--fu)', fontWeight: 600 }}>
                {c.unverified} Unverified VIP — low confidence
              </span>
            </div>
          )}

          {/* Avg viability */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            <span>Avg viability score</span>
            <span style={{ fontWeight: 700, color: c.avgViability >= 50 ? '#02a06d' : c.avgViability >= 30 ? '#e07b00' : '#DC2626' }}>
              {c.avgViability}/100
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Quadrant Transition Chart ─────────────────────────────────────────────────
function QuadrantTransitionChart({ snapshots }) {
  const chartData = useMemo(() => {
    const byDate = {};
    for (const s of snapshots) {
      if (!byDate[s.snapshot_date]) byDate[s.snapshot_date] = { date: s.snapshot_date, vip: 0, sales: 0, drainers: 0, dead: 0 };
      if (s.quadrant) byDate[s.snapshot_date][s.quadrant]++;
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      ...d,
      date: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    }));
  }, [snapshots]);

  if (chartData.length < 2) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13, fontFamily: 'var(--fu)' }}>
      Need at least 2 days of snapshot data to show trends. Check back tomorrow.
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--t3)', fontFamily: 'var(--fu)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--t3)', fontFamily: 'var(--fu)' }} />
        <Tooltip
          contentStyle={{ background: 'var(--s2)', border: '1px solid var(--bd)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--fu)' }}
          labelStyle={{ fontWeight: 700, color: 'var(--t1)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--fu)' }} />
        <Line type="monotone" dataKey="vip"      stroke={Q_COLOR.vip}      strokeWidth={2} dot={false} name="VIP" />
        <Line type="monotone" dataKey="sales"    stroke={Q_COLOR.sales}    strokeWidth={2} dot={false} name="Sales" />
        <Line type="monotone" dataKey="drainers" stroke={Q_COLOR.drainers} strokeWidth={2} dot={false} name="Drainers" />
        <Line type="monotone" dataKey="dead"     stroke={Q_COLOR.dead}     strokeWidth={2} dot={false} name="Dead" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Effort Allocation Heatmap ─────────────────────────────────────────────────
function EffortAllocationHeatmap({ stats }) {
  const counsellorTotals = useMemo(() => {
    const byName = {};
    for (const row of stats) {
      if (!row.counsellor_name) continue;
      if (!byName[row.counsellor_name]) {
        byName[row.counsellor_name] = { name: row.counsellor_name, vip: 0, sales: 0, drainers: 0, dead: 0, total: 0 };
      }
      const c = byName[row.counsellor_name];
      c.vip      += row.actions_vip      || 0;
      c.sales    += row.actions_sales    || 0;
      c.drainers += row.actions_drainers || 0;
      c.dead     += row.actions_dead     || 0;
      c.total    += row.actions_total    || 0;
    }
    return Object.values(byName).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  }, [stats]);

  if (counsellorTotals.length === 0) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13, fontFamily: 'var(--fu)' }}>
      No activity data yet. This populates after the first full day of counsellor actions.
    </div>
  );

  const chartData = counsellorTotals.map(c => ({
    name: c.name.split(' ')[0], // first name only for brevity
    VIP:      c.total ? Math.round((c.vip / c.total) * 100) : 0,
    Sales:    c.total ? Math.round((c.sales / c.total) * 100) : 0,
    Drainers: c.total ? Math.round((c.drainers / c.total) * 100) : 0,
    Dead:     c.total ? Math.round((c.dead / c.total) * 100) : 0,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--t3)', fontFamily: 'var(--fu)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--t3)', fontFamily: 'var(--fu)' }} unit="%" />
          <Tooltip
            contentStyle={{ background: 'var(--s2)', border: '1px solid var(--bd)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--fu)' }}
            formatter={(v) => `${v}%`}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--fu)' }} />
          <Bar dataKey="VIP"      stackId="a" fill={Q_COLOR.vip}      radius={[0,0,0,0]} />
          <Bar dataKey="Sales"    stackId="a" fill={Q_COLOR.sales}    />
          <Bar dataKey="Drainers" stackId="a" fill={Q_COLOR.drainers} />
          <Bar dataKey="Dead"     stackId="a" fill={Q_COLOR.dead}     radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 8, textAlign: 'center' }}>
        % of logged actions per quadrant per counsellor (last 30 days)
      </div>
    </div>
  );
}

// ── Summary stat cards ────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div style={{ padding: '16px 18px', borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--s1)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} color={color || 'var(--p)'} />}
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--t1)', fontFamily: 'var(--fh)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',   label: 'Overview',    icon: BarChart3   },
  { id: 'pipeline',   label: 'Pipeline',    icon: Activity    },
  { id: 'counsellors',label: 'Counsellors', icon: Users       },
  { id: 'trends',     label: 'Trends',      icon: TrendingUp  },
  { id: 'effort',     label: 'Effort',      icon: Target      },
];

export default function AnalyticsDashboard({ orgSession, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { data, loading, error, refresh } = useAnalyticsData(orgSession?.org_id);

  // ── Summary stats derived from latest snapshots ───────────────────────────
  const summary = useMemo(() => {
    if (!data?.snapshots?.length) return null;
    const dates = [...new Set(data.snapshots.map(s => s.snapshot_date))].sort();
    const latest = data.snapshots.filter(s => s.snapshot_date === dates[dates.length - 1]);
    return {
      total:    latest.length,
      vip:      latest.filter(s => s.quadrant === 'vip').length,
      sales:    latest.filter(s => s.quadrant === 'sales').length,
      drainers: latest.filter(s => s.quadrant === 'drainers').length,
      dead:     latest.filter(s => s.quadrant === 'dead').length,
      breached: data.openEntries.filter(e => e.sla_breached).length,
    };
  }, [data]);

  const panelStyle = {
    padding: '20px 24px', borderRadius: 12, border: '1px solid var(--bd)',
    background: 'var(--s1)', marginBottom: 20,
  };

  const panelTitle = (title, sub) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--s1)', color: 'var(--t1)' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 28px', borderBottom: '1px solid var(--bd)', background: 'var(--s2)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} color="var(--p)" />
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>VisaLens</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'var(--p)', color: '#fff', fontFamily: 'var(--fu)', marginLeft: 2 }}>Analytics</span>
        </div>

        <div style={{ display: 'flex', gap: 2, marginLeft: 24, flex: 1 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: activeTab === t.id ? 'var(--s3)' : 'transparent',
              color: activeTab === t.id ? 'var(--t1)' : 'var(--t3)',
              fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
              fontFamily: 'var(--fu)', cursor: 'pointer', transition: 'all .15s',
            }}>
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={refresh} disabled={loading} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
            borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--s2)',
            color: 'var(--t2)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .6 : 1,
          }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin .7s linear infinite' : 'none' }} />
            Refresh
          </button>
          <span style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{orgSession?.name || orgSession?.email}</span>
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)', fontSize: 12, fontFamily: 'var(--fu)', cursor: 'pointer' }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px' }}>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 12, color: 'var(--t3)', fontFamily: 'var(--fu)', fontSize: 13 }}>
            <RefreshCw size={16} style={{ animation: 'spin .7s linear infinite' }} />
            Loading analytics data…
          </div>
        )}

        {error && (
          <div style={{ padding: 20, borderRadius: 10, background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)', color: '#DC2626', fontSize: 13, fontFamily: 'var(--fu)' }}>
            Failed to load data: {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Stale alert banner — always visible regardless of tab */}
            <StaleAlertBanner
              openEntries={data.openEntries}
              onDrillDown={() => setActiveTab('pipeline')}
            />

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <>
                {summary && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <StatCard label="Total active" value={summary.total} icon={Users} color="var(--p)" sub="cases in pipeline" />
                    <StatCard label="VIP lane"     value={summary.vip}   icon={Zap}   color={Q_COLOR.vip}      sub="high viability + docs" />
                    <StatCard label="Sales priority" value={summary.sales} icon={Target} color={Q_COLOR.sales}  sub="strong profile, docs needed" />
                    <StatCard label="Time drainers" value={summary.drainers} icon={Clock} color={Q_COLOR.drainers} sub="docs ok, viability low" />
                    <StatCard label="Dead zone"   value={summary.dead}    icon={Minus}  color={Q_COLOR.dead}    sub="low scores both axes" />
                    <StatCard label="SLA breached" value={summary.breached} icon={AlertTriangle} color="#DC2626" sub="past stage deadline" />
                  </div>
                )}

                <div style={panelStyle}>
                  {panelTitle('Pipeline quadrant trend', 'Case distribution across quadrants over time')}
                  <QuadrantTransitionChart snapshots={data.snapshots} />
                </div>
              </>
            )}

            {/* ── PIPELINE TAB ── */}
            {activeTab === 'pipeline' && (
              <div style={panelStyle}>
                {panelTitle('Pipeline aging', 'All open cases — sorted by time in current stage')}
                <PipelineAgingTable openEntries={data.openEntries} sla={data.sla} />
              </div>
            )}

            {/* ── COUNSELLORS TAB ── */}
            {activeTab === 'counsellors' && (
              <div style={panelStyle}>
                {panelTitle('Counsellor scorecards', `Latest snapshot · Cases with viability confidence < ${Math.round((data.sla?.viability_confidence_threshold || CONFIDENCE_THRESHOLD) * 100)}% flagged as Unverified VIP`)}
                <CounsellorScorecards
                  snapshots={data.snapshots}
                  confidenceThreshold={data.sla?.viability_confidence_threshold}
                />
              </div>
            )}

            {/* ── TRENDS TAB ── */}
            {activeTab === 'trends' && (
              <div style={panelStyle}>
                {panelTitle('Quadrant transition chart', 'Week-by-week pipeline composition — is your VIP count growing?')}
                <QuadrantTransitionChart snapshots={data.snapshots} />
              </div>
            )}

            {/* ── EFFORT TAB ── */}
            {activeTab === 'effort' && (
              <div style={panelStyle}>
                {panelTitle('Effort allocation', 'Where is each counsellor spending their actions? (from daily_counselor_stats — reads after first full cron day)')}
                <EffortAllocationHeatmap stats={data.stats} />
              </div>
            )}

            {/* Data freshness note */}
            <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', textAlign: 'right', marginTop: 8 }}>
              Snapshot data updates nightly at midnight UTC · {data.snapshots.length} total snapshot rows loaded
            </div>
          </>
        )}
      </div>
    </div>
  );
}
