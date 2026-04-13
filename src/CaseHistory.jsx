import React, { useState, useEffect } from 'react';
import {
  Search, X, Loader2, FolderOpen, User, ChevronDown,
  GraduationCap, ArrowUpRight, Trash2, Users, Settings,
  LayoutGrid, Table as TableIcon, Filter, MoreVertical, CheckSquare, Square
} from 'lucide-react';
import { COUNTRY_META } from './utils/visaUtils';
import CounsellorManager from './CounsellorManager';
import './CaseHistory.css';

// These functions are imported from App.jsx to avoid duplication
// They are shared between App.jsx and CaseHistory.jsx
/* global loadCasesFromSupabase, loadMoreCases, loadFullCase, searchCases, deleteCaseFromSupabase, countCasesInSupabase, CASE_PAGE_SIZE, scoreBadge, COUNTRY_FLAGS */

/* ─── CONSTANTS ──────────────────────────────────────────────────────────── */
const CASE_PAGE_SIZE = 10;

/* ─── SCORE DISPLAY HELPERS ──────────────────────────────────────────────── */
function scoreBadge(s) { return s >= 70 ? "b-ok" : s >= 45 ? "b-warn" : "b-err"; }

/* ─── COUNTRY FLAGS ──────────────────────────────────────────────────────── */
const COUNTRY_FLAGS = Object.fromEntries(
  Object.entries(COUNTRY_META).map(([k, v]) => [k, v.flag || "🌍"])
);

/* ─── CASE HISTORY COMPONENT ───────────────────────────────────────────── */
export default function CaseHistory({ 
  onLoad, 
  onDelete, 
  onRenameCounsellor, 
  onMergeCounsellors,
  onExpandCase, 
  refreshKey,
  orgSession,
  // Helper functions passed from App.jsx to avoid duplication
  loadCasesFromSupabase,
  loadMoreCases,
  loadFullCase,
  searchCases,
  deleteCaseFromSupabase,
  countCasesInSupabase
}) {
  const [view, setView] = useState('cases'); // 'cases' | 'counsellors'
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [exp, setExp] = useState(null);
  const [expandedData, setExpandedData] = useState({});
  const [histCases, setHistCases] = useState([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage, setHistPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [searchTimer, setSearchTimer] = useState(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [counsellorFilter, setCounsellorFilter] = useState("All");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [selectedCases, setSelectedCases] = useState(new Set());

  // Role-based access control
  const userRole = orgSession?.role || 'viewer';
  const canManageCounsellors = userRole === 'org_owner' || userRole === 'branch_manager';
  const isCounsellor = userRole === 'counsellor';

  const totalPages = Math.max(1, Math.ceil(histTotal / pageSize));

  async function loadPage(page) {
    setLoadingHist(true);
    setExp(null);
    let rows;
    if (page === 0) {
      rows = await loadCasesFromSupabase();
    } else {
      const { cases: r } = await loadMoreCases(page);
      rows = r;
    }
    setHistCases(rows);
    setHistPage(page);
    setLoadingHist(false);
  }

  useEffect(() => {
    (async () => {
      setLoadingHist(true);
      const rows = await loadCasesFromSupabase();
      const total = await countCasesInSupabase();
      setHistCases(rows);
      setHistTotal(total);
      setHistPage(0);
      setSearch("");
      setLoadingHist(false);
    })();
  }, [refreshKey, loadCasesFromSupabase, countCasesInSupabase]);

  const counsellorOptions = ["All", ...new Set(histCases.map(c => c.counsellorName).filter(Boolean))];

  async function handleRename() {
    if (!renameVal.trim() || counsellorFilter === "All") return;
    await onRenameCounsellor(counsellorFilter, renameVal.trim());
    setCounsellorFilter("All");
    setRenaming(false);
    setRenameVal("");
    const rows = await loadCasesFromSupabase();
    setHistCases(rows);
  }

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => runSearch(val), 400));
  }

  async function runSearch(term) {
    setLoadingHist(true);
    setCounsellorFilter("All");
    if (!term.trim()) {
      const rows = await loadCasesFromSupabase();
      const total = await countCasesInSupabase();
      setHistCases(rows);
      setHistTotal(total);
      setHistPage(0);
    } else {
      const found = await searchCases(term);
      setHistCases(found);
      setHistTotal(found.length);
      setHistPage(0);
    }
    setLoadingHist(false);
  }

  async function handleClearSearch() {
    setSearch("");
    setCounsellorFilter("All");
    setLoadingHist(true);
    const rows = await loadCasesFromSupabase();
    const total = await countCasesInSupabase();
    setHistCases(rows);
    setHistTotal(total);
    setHistPage(0);
    setLoadingHist(false);
  }

  async function handleDelete(id) {
    await onDelete(id);
    const newTotal = await countCasesInSupabase();
    setHistTotal(newTotal);
    const newTotalPages = Math.max(1, Math.ceil(newTotal / CASE_PAGE_SIZE));
    const targetPage = histPage >= newTotalPages ? Math.max(0, newTotalPages - 1) : histPage;
    await loadPage(targetPage);
  }

  const filtered = histCases.filter(c => {
    if (counsellorFilter === "All") return true;
    return c.counsellorName === counsellorFilter;
  });

  return (
    <div className="case-history" style={{width:"100%"}}>
      {/* Modern Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button
            className={`btn-s${view === 'cases' ? ' on' : ''}`}
            onClick={() => setView('cases')}
            style={{display:"flex",alignItems:"center",gap:6}}
          >
            <FolderOpen size={14}/> Cases
          </button>
          {canManageCounsellors && (
            <button
              className={`btn-s${view === 'counsellors' ? ' on' : ''}`}
              onClick={() => setView('counsellors')}
              style={{display:"flex",alignItems:"center",gap:6}}
            >
              <Users size={14}/> Counsellors
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          {view === 'cases' && (
            <div className="view-mode-toggle">
              <button
                className={`view-mode-btn${viewMode === 'cards' ? ' active' : ''}`}
                onClick={() => setViewMode('cards')}
                title="Card view"
              >
                <LayoutGrid size={16}/>
              </button>
              <button
                className={`view-mode-btn${viewMode === 'table' ? ' active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
              >
                <TableIcon size={16}/>
              </button>
            </div>
          )}
          <div className="role-indicator">
            {userRole.replace('_', ' ')}
          </div>
        </div>
      </div>

      {view === 'counsellors' ? (
        <CounsellorManager
          onClose={() => setView('cases')}
          onRename={async (oldName, newName) => {
            await onRenameCounsellor(oldName, newName);
            const rows = await loadCasesFromSupabase();
            setHistCases(rows);
          }}
          onMerge={onMergeCounsellors}
          orgSession={orgSession}
        />
      ) : (
        <>
          <div className="rc rc-profile" style={{marginBottom:16,padding:"14px 16px"}}>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              {!isCounsellor && (
                <div style={{flex:1,minWidth:180}}>
                  <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Filter by Counsellor</div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <select
                      className="notes-input"
                      style={{flex:1,fontSize:13}}
                      value={counsellorFilter}
                      onChange={e => { setCounsellorFilter(e.target.value); setRenaming(false); setRenameVal(""); }}
                    >
                      {counsellorOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    {counsellorFilter !== "All" && !renaming && (
                      <button className="btn-s" style={{whiteSpace:"nowrap"}} onClick={() => { setRenaming(true); setRenameVal(counsellorFilter); }}>
                        ✏️ Rename
                      </button>
                    )}
                  </div>
                  {renaming && (
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <input
                        className="notes-input"
                        style={{flex:1,fontSize:13}}
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        placeholder="New name…"
                      />
                      <button className="btn-s" onClick={handleRename}>✓</button>
                      <button className="btn-s" onClick={() => { setRenaming(false); setRenameVal(""); }}>✕</button>
                    </div>
                  )}
                </div>
              )}
              <div style={{flex:isCounsellor ? 1 : 2,minWidth:200}}>
                <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Search Cases</div>
                <div style={{position:"relative",display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{position:"relative",flex:1}}>
                    <Search size={13} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--t3)",pointerEvents:"none"}}/>
                    <input
                      className="notes-input"
                      style={{width:"100%",fontSize:13,paddingLeft:30,paddingRight:search?28:10}}
                      placeholder="Search by name, case ID, counsellor…"
                      value={search}
                      onChange={handleSearchChange}
                    />
                    {search && (
                      <button
                        onClick={handleClearSearch}
                        title="Clear search"
                        style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--t3)",display:"flex",alignItems:"center",padding:0,lineHeight:1}}
                      ><X size={13}/></button>
                    )}
                  </div>
                  {search && (
                    <button className="btn-s" onClick={handleClearSearch} style={{whiteSpace:"nowrap",flexShrink:0}}>
                      Clear
                    </button>
                  )}
                </div>
                {loadingHist && <div style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Loader2 size={10} style={{animation:"spin .7s linear infinite"}}/>Searching…</div>}
              </div>
            </div>
          </div>

          {loadingHist && histCases.length === 0 ? (
            viewMode === 'table' ? (
              <div className="cases-table-container">
                <table className="cases-table">
                  <thead>
                    <tr>
                      <th style={{width:40}}><button className="table-checkbox"><Square size={16}/></button></th>
                      <th>Student</th>
                      <th>Case ID</th>
                      <th>Counsellor</th>
                      <th>Score</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th style={{width:80}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1,2,3,4,5].map(i => (
                      <tr key={i}>
                        <td><button className="table-checkbox"><Square size={16}/></button></td>
                        <td><div className="skeleton-cell"/></td>
                        <td><div className="skeleton-cell skeleton-mono"/></td>
                        <td><div className="skeleton-cell"/></td>
                        <td><div className="skeleton-badge"/></td>
                        <td><div className="skeleton-badge"/></td>
                        <td><div className="skeleton-cell"/></td>
                        <td><div className="skeleton-btn"/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="history">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="case-card skeleton-card">
                    <div className="case-hdr">
                      <div className="case-av skeleton-avatar"/>
                      <div className="case-info">
                        <div className="skeleton-line skeleton-title"/>
                        <div className="skeleton-line skeleton-subtitle"/>
                      </div>
                      <div className="case-r">
                        <div className="skeleton-badge"/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : !filtered.length ? (
            <div className="empty-state-modern">
              <div className="empty-state-icon">
                <FolderOpen size={48} color="#94A3B8"/>
              </div>
              <h3 className="empty-state-title">
                {histCases.length ? "No cases match your search" : "No cases saved yet"}
              </h3>
              <p className="empty-state-desc">
                {histCases.length ? "Try adjusting your filters or search terms" : "Start by analysing documents and saving them to history"}
              </p>
              {!histCases.length && (
                <button className="btn-o" onClick={() => {/* Navigate to analyzer */}}>
                  <ArrowUpRight size={14}/> Go to Analyzer
                </button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <>
              {selectedCases.size > 0 && (
                <div className="bulk-actions-bar">
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>
                      {selectedCases.size} case{selectedCases.size !== 1 ? 's' : ''} selected
                    </span>
                    <button 
                      className="btn-s"
                      onClick={() => setSelectedCases(new Set())}
                      style={{padding:"4px 8px",fontSize:12}}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button 
                      className="btn-danger"
                      onClick={async () => {
                        for (const id of selectedCases) {
                          await onDelete(id);
                        }
                        setSelectedCases(new Set());
                        const newTotal = await countCasesInSupabase();
                        setHistTotal(newTotal);
                        const rows = await loadCasesFromSupabase();
                        setHistCases(rows);
                      }}
                      style={{padding:"4px 8px",fontSize:12}}
                    >
                      <Trash2 size={12}/> Delete
                    </button>
                  </div>
                </div>
              )}
              <div className="cases-table-container">
                <table className="cases-table">
                <thead>
                  <tr>
                    <th style={{width:40}}>
                      <button 
                        className="table-checkbox"
                        onClick={() => {
                          if (selectedCases.size === filtered.length) {
                            setSelectedCases(new Set());
                          } else {
                            setSelectedCases(new Set(filtered.map(c => c.id)));
                          }
                        }}
                      >
                        {selectedCases.size === filtered.length ? <CheckSquare size={16}/> : <Square size={16}/>}
                      </button>
                    </th>
                    <th>Student</th>
                    <th>Case ID</th>
                    <th>Counsellor</th>
                    <th>Readiness</th>
                    <th>Viability</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{width:80}}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                  const profile = c.profile || c.results?.studentProfile || {};
                  // Read from score_data if available, otherwise fallback to legacy fields
                  const readinessScore = c.score_data?.readiness?.score || 0;
                  const viabilityScore = c.score_data?.viability?.score || c.overallScore || c.results?.eligibility?.overallScore || 0;
                  const displayName = profile.fullName || c.studentName || c.student_name || 'Unknown Student';
                  return (
                      <tr key={c.id} className={selectedCases.has(c.id) ? 'selected' : ''}>
                        <td>
                          <button 
                            className="table-checkbox"
                            onClick={() => {
                              const newSelected = new Set(selectedCases);
                              if (newSelected.has(c.id)) {
                                newSelected.delete(c.id);
                              } else {
                                newSelected.add(c.id);
                              }
                              setSelectedCases(newSelected);
                            }}
                          >
                            {selectedCases.has(c.id) ? <CheckSquare size={16}/> : <Square size={16}/>}
                          </button>
                        </td>
                        <td>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div className="table-avatar">
                              <User size={14}/>
                            </div>
                            <span style={{fontWeight:500}}>{displayName}</span>
                          </div>
                        </td>
                        <td>
                          <span className="table-mono">{c.caseSerial || '—'}</span>
                        </td>
                        <td>{c.counsellorName || '—'}</td>
                        <td>
                          <span className={`badge ${scoreBadge(readinessScore)}`}>{readinessScore}/100</span>
                        </td>
                        <td>
                          <span className={`badge ${scoreBadge(viabilityScore)}`}>{viabilityScore}/100</span>
                        </td>
                        <td>
                          <span className="status-badge status-badge--{c.leadStatus?.toLowerCase() || 'none'}">
                            {c.leadStatus || 'None'}
                          </span>
                        </td>
                        <td style={{color:"var(--t3)",fontFamily:"var(--fm)",fontSize:12}}>
                          {new Date(c.savedAt).toLocaleDateString()}
                        </td>
                        <td>
                          <button 
                            className="btn-s"
                            onClick={() => onLoad(c)}
                            style={{padding:"4px 8px"}}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <>
              <div className="history">
                {filtered.map(c => {
                  const profile = c.profile || c.results?.studentProfile || {};
                  // Read from score_data if available, otherwise fallback to legacy fields
                  const readinessScore = c.score_data?.readiness?.score || 0;
                  const viabilityScore = c.score_data?.viability?.score || c.overallScore || c.results?.eligibility?.overallScore || 0;
                  const flags = c.results?.redFlags?.length || 0;
                  const country = c.targetCountry || profile.targetCountry || '—';
                  const offers = Array.isArray(profile.offerLetters) ? profile.offerLetters : [];
                  const offerCountry = offers[0]?.country || country;
                  const displayName = profile.fullName || c.studentName || c.student_name || 'Unknown Student';
                  return (
                    <div key={c.id} className="case-card">
                      <div className="case-hdr" onClick={async () => { const next = exp === c.id ? null : c.id; setExp(next); if (next && c._summaryOnly && !expandedData[c.id] && onExpandCase) { const full = await onExpandCase(c.id); if (full) setExpandedData(prev => ({...prev, [c.id]: full})); } }} role="button" tabIndex={0} onKeyDown={async e => { if (e.key === "Enter") { const next = exp === c.id ? null : c.id; setExp(next); if (next && c._summaryOnly && !expandedData[c.id] && onExpandCase) { const full = await onExpandCase(c.id); if (full) setExpandedData(prev => ({...prev, [c.id]: full})); } } }}>
                        <div className="case-av"><User size={18}/></div>
                        <div className="case-info">
                          <div className="case-name" style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                            {displayName}
                            {c.caseSerial && (
                              <span style={{
                                fontSize:"0.68rem",fontFamily:"var(--fm)",
                                background:"var(--bd)",color:"var(--t2)",
                                padding:"1px 6px",borderRadius:4,letterSpacing:"0.04em",
                                fontWeight:500,flexShrink:0,
                              }}>{c.caseSerial}</span>
                            )}
                          </div>
                          <div className="case-meta">
                            {offerCountry} · {new Date(c.savedAt).toLocaleDateString()}
                            {c.counsellorName && <span style={{opacity:.6}}> · {c.counsellorName}</span>}
                          </div>
                          {Array.isArray(c.applicationTargets) && c.applicationTargets.length > 0 && (
                            <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3,flexWrap:"wrap"}}>
                              {c.applicationTargets.slice(0, 3).map((t, ti) => {
                                const resolvedCountry = t.country === "Other" ? t.countryOther : t.country;
                                const flag = resolvedCountry ? (COUNTRY_FLAGS[resolvedCountry] || "🌍") : null;
                                const seasonShort = t.intakeSeason ? t.intakeSeason.split(" ")[0] : null;
                                const label = [flag, seasonShort, t.intakeYear].filter(Boolean).join(" ");
                                if (!label.trim()) return null;
                                return (
                                  <span key={ti} style={{
                                    display:"inline-flex",alignItems:"center",gap:4,
                                    fontSize:10,fontWeight:600,fontFamily:"var(--fm)",
                                    background: ti === 0 ? "rgba(29,107,232,0.12)" : "rgba(100,116,139,0.10)",
                                    color: ti === 0 ? "var(--p)" : "var(--t2)",
                                    border:`1px solid ${ti === 0 ? "rgba(29,107,232,0.25)" : "rgba(100,116,139,0.2)"}`,
                                    padding:"2px 7px",borderRadius:4,letterSpacing:".03em",
                                  }}>
                                    <GraduationCap size={10}/>{label}
                                    {t.deferred && <span style={{color:"var(--warn)",marginLeft:2}}>·D</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="case-r">
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span className={`badge ${scoreBadge(readinessScore)}`}>{readinessScore}/100</span>
                            <span className={`badge ${scoreBadge(viabilityScore)}`}>{viabilityScore}/100</span>
                          </div>
                          <ChevronDown size={14} className={`chev${exp === c.id ? " open" : ""}`}/>
                        </div>
                      </div>
                      {exp === c.id && (() => {
                        const fullC = expandedData[c.id] || c;
                        const ep = fullC.profile || fullC.results?.studentProfile || profile;
                        const eFlags = fullC.results?.redFlags?.length || 0;
                        const loading = c._summaryOnly && !expandedData[c.id];
                        return (
                        <div className="case-body">
                          {loading && <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}><Loader2 size={11} style={{animation:"spin .7s linear infinite"}}/>Loading details…</div>}
                          
                          {/* Student Profile Summary */}
                          <div style={{marginBottom:16}}>
                            <div style={{fontSize:12,fontWeight:600,color:"var(--t2)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                              <User size={14}/> Student Profile
                            </div>
                            <div className="mini-grid">
                              {[
                                {l:"Case ID",    v:c.caseSerial},
                                {l:"CNIC",       v:ep.cnicNumber},
                                {l:"CNIC Expiry",v:ep.cnicExpiry},
                                {l:"Passport",   v:ep.passportNumber},
                                {l:"P. Expiry",  v:ep.passportExpiry},
                                {l:"IELTS",      v:ep.ieltsScore},
                                {l:"Balance",    v:ep.financialBalance},
                                {l:"Programme",  v:ep.program},
                                {l:"Flags",      v:loading ? "—" : `${eFlags} issue${eFlags !== 1 ? "s" : ""}`},
                              ].map(f => (
                                <div key={f.l} className="mini-f">
                                  <div className="mini-l">{f.l}</div>
                                  <div className={`mini-v${!f.v || f.v === "Not found" ? " e" : ""}${f.l==="Case ID"?" mono":""}`}
                                    style={f.l==="Case ID"?{fontFamily:"var(--fm)",fontSize:"0.75rem",letterSpacing:"0.03em"}:{}}>
                                    {f.v || "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Application Status */}
                          <div style={{marginBottom:16}}>
                            <div style={{fontSize:12,fontWeight:600,color:"var(--t2)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                              <GraduationCap size={14}/> Application Status
                            </div>
                            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                              <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                                <span style={{fontWeight:500,color:"var(--t2)"}}>Lead Status:</span> {c.leadStatus || 'None'}
                              </div>
                              <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                                <span style={{fontWeight:500,color:"var(--t2)"}}>Referral:</span> {c.referralSource || 'Direct'}
                              </div>
                              <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                                <span style={{fontWeight:500,color:"var(--t2)"}}>Payment:</span> {c.paymentStatus || 'Unpaid'}
                              </div>
                              {c.expiryDate && (
                                <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                                  <span style={{fontWeight:500,color:"var(--t2)"}}>Doc Expiry:</span> {new Date(c.expiryDate).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Timeline */}
                          <div style={{marginBottom:16}}>
                            <div style={{fontSize:12,fontWeight:600,color:"var(--t2)",marginBottom:8}}>Timeline</div>
                            <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",display:"flex",gap:16,flexWrap:"wrap"}}>
                              <div>
                                <span style={{fontWeight:500,color:"var(--t2)"}}>Created:</span> {new Date(c.savedAt).toLocaleDateString()}
                              </div>
                              <div>
                                <span style={{fontWeight:500,color:"var(--t2)"}}>Updated:</span> {new Date(c.updatedAt).toLocaleDateString()}
                              </div>
                              {c.statusUpdatedAt && (
                                <div>
                                  <span style={{fontWeight:500,color:"var(--t2)"}}>Status Updated:</span> {new Date(c.statusUpdatedAt).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Counsellor Notes */}
                          <div className="sec-lbl">Counsellor Notes</div>
                          {loading
                            ? <div className="case-no-notes">Open full analysis to view notes.</div>
                            : fullC.notes
                              ? <div className="case-notes-txt">{fullC.notes}</div>
                              : <div className="case-no-notes">No notes recorded.</div>
                          }
                          
                          <div className="case-acts">
                            <button className="btn-s" onClick={() => onLoad(c)}><ArrowUpRight size={13}/>Open Full Analysis</button>
                            <button className="btn-danger" onClick={() => handleDelete(c.id)}><Trash2 size={13}/>Delete</button>
                          </div>
                        </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && !search.trim() && (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,padding:"18px 0 6px",flexWrap:"wrap"}}>
                  <button
                    className="btn-s"
                    onClick={() => loadPage(histPage - 1)}
                    disabled={histPage === 0 || loadingHist}
                    style={{minWidth:90,justifyContent:"center"}}
                  >
                    ← Previous
                  </button>
                  <span style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)",whiteSpace:"nowrap"}}>
                    {loadingHist
                      ? <><Loader2 size={11} style={{animation:"spin .7s linear infinite",verticalAlign:"middle",marginRight:4}}/>Loading…</>
                      : <>Page {histPage + 1} of {totalPages}</>
                    }
                  </span>
                  <button
                    className="btn-s"
                    onClick={() => loadPage(histPage + 1)}
                    disabled={histPage >= totalPages - 1 || loadingHist}
                    style={{minWidth:90,justifyContent:"center"}}
                  >
                    Next →
                  </button>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:16}}>
                    <span style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)"}}>Rows per page:</span>
                    <select
                      className="notes-input"
                      style={{fontSize:12,padding:"4px 8px",minWidth:60}}
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(parseInt(e.target.value));
                        setHistPage(0);
                        loadPage(0);
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
