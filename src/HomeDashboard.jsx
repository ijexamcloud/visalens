import React, { useState, useEffect } from 'react';
import {
  ArrowUpRight, Bell, BookOpen, CheckCircle, Clock,
  CreditCard, FileText, Globe, Plus, ShieldCheck,
  TrendingUp, Users, Zap, ChevronRight, Activity, User,
  Target, Award, AlertTriangle, BarChart3, Sparkles,
  Calendar, ArrowDown, ArrowUp, MoreHorizontal
} from 'lucide-react';

export default function HomeDashboard({
  orgSession = {},
  orgCredits,
  cases = [],
  totalCases = 0,
  expiryAlerts: expiryAlertsProp,
  onNewCase,
  onOpenCase,
  onNavigate,
}) {
  const [greeting, setGreeting] = useState('');
  const [now, setNow]           = useState(new Date());

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // ── RBAC & Restrictions ──
  const userRole = orgSession.role || 'viewer';
  const isManager = ['org_owner', 'branch_manager', 'senior_counsellor'].includes(userRole);
  const hasPersonalQuota = orgSession.credit_quota !== null && orgSession.credit_quota !== undefined;
  const restrictedTabs = orgSession.restricted_tabs || [];

  // ── Credits Logic ──
  let creditsLeft, creditsTotal, creditsUsed, creditsPct, creditsLow, creditsWarn, creditTitle;

  if (hasPersonalQuota) {
    creditTitle  = "Personal Limit";
    creditsTotal = orgSession.credit_quota;
    creditsLeft  = creditsTotal;
    creditsUsed  = 0;
    creditsPct   = creditsTotal > 0 ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100)) : 0;
    creditsLow   = creditsLeft <= 5;
    creditsWarn  = false;
  } else {
    creditTitle  = "Agency Credits";
    creditsLeft  = orgCredits ?? orgSession.analyses_remaining ?? 0;
    creditsTotal = orgSession.analyses_total ?? 0;
    creditsUsed  = Math.max(0, creditsTotal - creditsLeft);
    creditsPct   = creditsTotal > 0 ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100)) : 0;
    creditsLow   = creditsLeft <= 10;
    creditsWarn  = creditsLeft <= 50 && creditsLeft > 10;
  }

  const creditBarColor = creditsLow ? 'var(--err)' : creditsWarn ? 'var(--warn)' : 'var(--p)';

  // ── Stats & Analytics ──
  const displayTotal = totalCases || cases.length;
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

  const casesThisMonth = cases.filter(c => {
    const d = new Date(c.savedAt || c.created_at || 0);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  const casesLastMonth = cases.filter(c => {
    const d = new Date(c.savedAt || c.created_at || 0);
    return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
  }).length;

  const monthlyGrowth = casesLastMonth > 0
    ? Math.round(((casesThisMonth - casesLastMonth) / casesLastMonth) * 100)
    : casesThisMonth > 0 ? 100 : 0;

  const scoredCases = cases.filter(c => {
    const score = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
    return !isNaN(score) && score > 0;
  });
  const successRate = scoredCases.length > 0
    ? Math.round((scoredCases.filter(c => {
        const score = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
        return score >= 70;
      }).length / scoredCases.length) * 100)
    : 0;

  const avgScore = scoredCases.length > 0
    ? Math.round(scoredCases.reduce((sum, c) => {
        const score = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
        return sum + (isNaN(score) ? 0 : score);
      }, 0) / scoredCases.length)
    : 0;

  const _expirySource = expiryAlertsProp ?? cases;
  const expiryAlerts = _expirySource.filter(c => {
    if (!c.expiryDate) return false;
    const diff = (new Date(c.expiryDate) - now) / 86400000;
    return diff >= 0 && diff <= 30;
  });
  const urgentExpiry = _expirySource.filter(c => {
    if (!c.expiryDate) return false;
    const diff = (new Date(c.expiryDate) - now) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const recentCases = cases.slice(0, 5);

  const counsellorMap = {};
  cases.forEach(c => {
    // counsellor_name is the single source of truth for the assignee display name.
    // assigned_to (uuid) is kept in sync separately for filtering.
    const key = c.counsellorName || c.counsellor_name || 'Unassigned';
    counsellorMap[key] = (counsellorMap[key] || 0) + 1;
  });
  const counsellorList = Object.entries(counsellorMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const countryMap = {};
  cases.forEach(c => {
    const country = c.targetCountry || c.target_country || '—';
    if (country !== '—') countryMap[country] = (countryMap[country] || 0) + 1;
  });
  const topCountries = Object.entries(countryMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const actionItems = cases.filter(c => {
    const score = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
    return !isNaN(score) && score < 50;
  }).slice(0, 3);

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // ── Quick Actions ──
  const quickActions = [];
  if (!restrictedTabs.includes('analyze'))
    quickActions.push({ icon: <Plus size={18}/>, label: 'New Analysis', sub: 'Upload & analyse', color: 'blue', fn: onNewCase });
  if (!restrictedTabs.includes('expiry'))
    quickActions.push({ icon: <Clock size={18}/>, label: 'Expiry Radar', sub: 'Check deadlines', color: 'orange', fn: () => onNavigate?.('expiry') });
  if (!restrictedTabs.includes('policy'))
    quickActions.push({ icon: <Bell size={18}/>, label: 'Policy Alerts', sub: 'Rule changes', color: 'purple', fn: () => onNavigate?.('policy') });
  if (!restrictedTabs.includes('sop_resume'))
    quickActions.push({ icon: <BookOpen size={18}/>, label: 'SOP Builder', sub: 'Generate SOPs', color: 'indigo', fn: () => onNavigate?.('sop_resume') });
  if (isManager)
    quickActions.push({ icon: <Users size={18}/>, label: 'Agency Panel', sub: 'Team & credits', color: 'green', fn: () => onNavigate?.('agency') });

  const canViewExpiry  = !restrictedTabs.includes('expiry');
  const canViewHistory = !restrictedTabs.includes('history');

  return (
    <div className="home-dash">

      {/* ══ ZONE 1: WELCOME HEADER ══ */}
      <div className="home-welcome">
        <div className="home-welcome-left">
          <div className="home-welcome-greeting">{greeting}, {orgSession.full_name?.split(' ')[0] || 'there'} 👋</div>
          <h1 className="home-welcome-title">
            {orgSession.org_name || 'Your Agency'} <em>Dashboard</em>
          </h1>
          <p className="home-welcome-date">{dateStr}</p>
        </div>
        {!restrictedTabs.includes("analyze") && (
          <button className="home-cta-btn" onClick={onNewCase}>
            <Plus size={16} />
            New Analysis
          </button>
        )}
      </div>

      {/* ══ ZONE 2: STAT ROW (Bento — compact, top-aligned) ══ */}
      <div className="hd-stat-row">

        {/* Stat 1 — Total Cases */}
        <div className="hd-stat hd-stat--accent">
          <div className="hd-stat-hdr">
            <div className="hd-stat-icon hb-ring--blue"><FileText size={13} color="#1D6BE8" /></div>
            <span className="hd-stat-label">{isManager ? 'Total Cases' : 'My Cases'}</span>
            <span className={`hd-trend ${monthlyGrowth >= 0 ? 'hd-trend--up' : 'hd-trend--down'}`}>
              {monthlyGrowth >= 0 ? <ArrowUp size={9}/> : <ArrowDown size={9}/>}
              {Math.abs(monthlyGrowth)}%
            </span>
          </div>
          <div className="hd-stat-num">{displayTotal}</div>
          <div className="hd-stat-sub">{casesThisMonth} this month · {casesLastMonth} last</div>
        </div>

        {/* Stat 2 — Credits */}
        <div className="hd-stat">
          <div className="hd-stat-hdr">
            <div className="hd-stat-icon hb-ring--amber"><CreditCard size={13} color="#B45309" /></div>
            <span className="hd-stat-label">{creditTitle}</span>
            {creditsLow  && <span className="hb-badge hb-badge--err">Low</span>}
            {creditsWarn && !creditsLow && <span className="hb-badge hb-badge--warn">Low</span>}
          </div>
          {(!isManager && !hasPersonalQuota) ? (
            <div className="hd-unlimited">
              <ShieldCheck size={16} color="var(--ok)" />
              <span>Unlimited</span>
            </div>
          ) : (
            <>
              <div className="hd-stat-num hd-stat-num--sm">{creditsLeft.toLocaleString()} <span>left</span></div>
              <div className="hd-credits-track">
                <div className="hd-credits-fill" style={{ width: `${creditsPct}%`, background: creditBarColor }} />
              </div>
              <div className="hd-stat-sub">{hasPersonalQuota ? `Limit: ${creditsTotal}` : `${creditsUsed} / ${creditsTotal} used`}</div>
            </>
          )}
        </div>

        {/* Stat 3 — Success Rate */}
        <div className="hd-stat">
          <div className="hd-stat-hdr">
            <div className="hd-stat-icon hb-ring--green"><Award size={13} color="#059669" /></div>
            <span className="hd-stat-label">Success Rate</span>
          </div>
          <div className="hd-stat-num" style={{ color: successRate >= 70 ? 'var(--ok)' : successRate >= 50 ? 'var(--warn)' : 'var(--err)' }}>
            {successRate}%
          </div>
          <div className="hd-stat-sub">{scoredCases.length} cases scored · avg {avgScore}%</div>
        </div>

        {/* Stat 4 — Expiry Alerts */}
        <div
          className={`hd-stat ${urgentExpiry.length ? 'hd-stat--alert' : ''} ${canViewExpiry ? 'hd-stat--clickable' : ''}`}
          onClick={() => canViewExpiry && onNavigate?.('expiry')}
          role={canViewExpiry ? 'button' : 'region'}
          tabIndex={canViewExpiry ? 0 : undefined}
        >
          <div className="hd-stat-hdr">
            <div className="hd-stat-icon hb-ring--orange"><Clock size={13} color="#F97316" /></div>
            <span className="hd-stat-label">Expiry Alerts</span>
            {canViewExpiry && <ChevronRight size={12} className="hb-chevron" />}
          </div>
          <div className="hd-stat-num" style={{ color: urgentExpiry.length ? 'var(--err)' : 'var(--t1)' }}>
            {urgentExpiry.length}
          </div>
          <div className="hd-stat-sub">urgent · {expiryAlerts.length} within 30 days</div>
        </div>

        {/* Stat 5 — Insights pill (replaces insights bar) */}
        <div className="hd-stat hd-stat--insights">
          <div className="hd-insight-row">
            <TrendingUp size={12} color="var(--ok)" />
            <span className="hd-insight-label">Growth</span>
            <span className="hd-insight-val" style={{ color: monthlyGrowth >= 0 ? 'var(--ok)' : 'var(--err)' }}>
              {monthlyGrowth > 0 ? '+' : ''}{monthlyGrowth}%
            </span>
          </div>
          <div className="hd-insight-row">
            <Target size={12} color="#7C3AED" />
            <span className="hd-insight-label">Avg Score</span>
            <span className="hd-insight-val">{avgScore}%</span>
          </div>
          <div className="hd-insight-row">
            <AlertTriangle size={12} color="var(--warn)" />
            <span className="hd-insight-label">Attention</span>
            <span className="hd-insight-val" style={{ color: actionItems.length > 0 ? 'var(--warn)' : 'var(--t2)' }}>
              {actionItems.length}
            </span>
          </div>
        </div>

      </div>

      {/* ══ ZONE 3: COMMAND STRIP (full-width quick actions) ══ */}
      {quickActions.length > 0 && (
        <div className="hd-command-strip">
          <div className="hd-command-label">
            <Zap size={13} />
            Quick Actions
          </div>
          <div className="hd-command-pills">
            {quickActions.map((a, i) => (
              <button key={i} className={`hd-pill hd-pill--${a.color}`} onClick={a.fn}>
                <div className={`hd-pill-ico hd-pill-ico--${a.color}`}>{a.icon}</div>
                <div className="hd-pill-text">
                  <span className="hd-pill-label">{a.label}</span>
                  <span className="hd-pill-sub">{a.sub}</span>
                </div>
                <ArrowUpRight size={13} className="hd-pill-arrow" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ ZONE 4: THREE-COLUMN CONTENT AREA ══ */}
      <div className="hd-content-area">

        {/* ── COL A: Main Feed (Recent Cases) ── */}
        <div className="hd-col hd-col--main">
          <div className="hd-section-hdr">
            <div className="hd-section-icon hb-ring--blue"><BookOpen size={13} color="#1D6BE8" /></div>
            <span className="hd-section-title">Recent Cases</span>
            {canViewHistory && (
              <button className="hb-link-btn" onClick={() => onNavigate?.('history')}>
                View all <ArrowUpRight size={11} />
              </button>
            )}
          </div>

          {recentCases.length === 0 ? (
            <div className="hb-empty">
              <FileText size={28} className="hb-empty-ico" />
              <div className="hb-empty-txt">No cases yet</div>
              <div className="hb-empty-sub">Start your first analysis</div>
              {!restrictedTabs.includes("analyze") && (
                <button className="hb-empty-btn" onClick={onNewCase}><Plus size={13} /> New Analysis</button>
              )}
            </div>
          ) : (
            <div className="hd-feed">
              {recentCases.map((c, i) => {
                const name      = c.studentName || c.student_name || 'Unnamed Student';
                const country   = c.targetCountry || c.target_country || '—';
                const scoreNum  = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
                const scoreCol  = scoreNum >= 70 ? 'var(--ok)' : scoreNum >= 40 ? 'var(--warn)' : 'var(--err)';
                const d         = new Date(c.savedAt || c.created_at || 0);
                const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const counsellor = c.counsellorName || c.counsellor_name || '';
                const accentCol = ['#1D6BE8','#059669','#F97316','#7C3AED','#EC4899'][i % 5];

                return (
                  <button key={c.id || i} className="hd-feed-row" onClick={() => onOpenCase?.(c)}>
                    {/* Timeline spine */}
                    <div className="hd-feed-spine">
                      <div className="hd-feed-dot" style={{ background: accentCol }} />
                      {i < recentCases.length - 1 && <div className="hd-feed-line" />}
                    </div>
                    <div className="hd-feed-body">
                      <div className="hd-feed-avatar" style={{ background: accentCol + '18', color: accentCol, border: `1px solid ${accentCol}33` }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="hd-feed-info">
                        <div className="hd-feed-name">{name}</div>
                        <div className="hd-feed-meta">
                          <Globe size={10}/> {country}
                          {counsellor && isManager && (
                            <><span className="hb-dot">·</span><User size={10}/>{counsellor}</>
                          )}
                        </div>
                      </div>
                      <div className="hd-feed-right">
                        {!isNaN(scoreNum) && scoreNum > 0 && (
                          <div className="hd-feed-score" style={{ color: scoreCol, borderColor: scoreCol + '44' }}>
                            {scoreNum}%
                          </div>
                        )}
                        <div className="hd-feed-date">{dateLabel}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── COL B: Mid Panel (Destinations + Action Items) ── */}
        <div className="hd-col hd-col--mid">

          {/* Top Destinations */}
          <div className="hd-panel">
            <div className="hd-section-hdr">
              <div className="hd-section-icon hb-ring--purple"><Globe size={13} color="#7C3AED" /></div>
              <span className="hd-section-title">Top Destinations</span>
            </div>
            {topCountries.length === 0 ? (
              <div className="hb-empty hb-empty--sm">
                <Globe size={18} className="hb-empty-ico" />
                <div className="hb-empty-txt">No data yet</div>
              </div>
            ) : (
              <div className="hb-dest-list">
                {topCountries.map(([country, count], i) => {
                  const pct = Math.round((count / Math.max(cases.length, 1)) * 100);
                  const destColors = ['#1D6BE8','#7C3AED','#059669'];
                  return (
                    <div key={country} className="hb-dest-row">
                      <div className="hd-dest-rank" style={{ color: destColors[i] }}>{i + 1}</div>
                      <div className="hb-dest-info">
                        <div className="hb-dest-name">{country}</div>
                        <div className="hb-dest-track">
                          <div className="hb-dest-fill" style={{ width: `${pct}%`, background: destColors[i] }} />
                        </div>
                      </div>
                      <div className="hb-dest-count">{count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Items */}
          {actionItems.length > 0 && (
            <div className="hd-panel hd-panel--alert">
              <div className="hd-section-hdr">
                <div className="hd-section-icon hb-ring--orange"><AlertTriangle size={13} color="#F97316" /></div>
                <span className="hd-section-title">Needs Attention</span>
              </div>
              <div className="hb-action-list">
                {actionItems.map((c, i) => {
                  const name  = c.studentName || c.student_name || 'Unnamed';
                  const score = typeof c.overallScore === 'number' ? c.overallScore : parseInt(c.overallScore ?? c.overall_score ?? '');
                  return (
                    <button key={c.id || i} className="hb-action-item" onClick={() => onOpenCase?.(c)}>
                      <div className="hb-action-item-left">
                        <div className="hb-action-item-name">{name}</div>
                        <div className="hb-action-item-score" style={{ color: 'var(--err)' }}>Score: {score}%</div>
                      </div>
                      <ChevronRight size={14} className="hb-action-item-arrow" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── COL C: Sidebar Panel (Team Activity — managers only) ── */}
        {isManager && (
          <div className="hd-col hd-col--side">
            <div className="hd-sidebar-panel">
              <div className="hd-section-hdr">
                <div className="hd-section-icon hb-ring--green"><Users size={13} color="#059669" /></div>
                <span className="hd-section-title">Team Activity</span>
                <button className="hb-link-btn" onClick={() => onNavigate?.('agency')}>
                  Manage <ArrowUpRight size={11} />
                </button>
              </div>
              {counsellorList.length === 0 ? (
                <div className="hb-empty hb-empty--sm">
                  <Users size={22} className="hb-empty-ico" />
                  <div className="hb-empty-txt">No team data</div>
                </div>
              ) : (
                <div className="hb-team-list">
                  {counsellorList.map(([name, count], i) => {
                    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                    const pct      = Math.round((count / Math.max(cases.length, 1)) * 100);
                    const colors   = ['#1D6BE8','#059669','#F97316','#7C3AED'];
                    const col      = colors[i % colors.length];
                    return (
                      <div key={name} className="hb-team-row">
                        <div className="hb-team-avatar" style={{ background: col + '18', color: col, border: `1px solid ${col}33` }}>
                          {initials}
                        </div>
                        <div className="hb-team-info">
                          <div className="hb-team-name">{name}</div>
                          <div className="hb-team-track">
                            <div className="hb-team-fill" style={{ width: `${pct}%`, background: col }} />
                          </div>
                        </div>
                        <div className="hb-team-count">{count}</div>
                      </div>
                    );
                  })}
                  <div className="hb-team-total">
                    <Activity size={11} /> {displayTotal} total cases across team
                  </div>
                </div>
              )}

              {/* Mini scorecard inside sidebar */}
              <div className="hd-sidebar-scorecard">
                <div className="hd-sc-row">
                  <span className="hd-sc-label">Success Rate</span>
                  <span className="hd-sc-val" style={{ color: successRate >= 70 ? 'var(--ok)' : 'var(--warn)' }}>{successRate}%</span>
                </div>
                <div className="hd-sc-row">
                  <span className="hd-sc-label">Avg Score</span>
                  <span className="hd-sc-val">{avgScore}%</span>
                </div>
                <div className="hd-sc-row">
                  <span className="hd-sc-label">This Month</span>
                  <span className="hd-sc-val">{casesThisMonth} cases</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
