import React, { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react';

// ── Global chat context — lets any component call openChat() without prop drilling ──
export const ChatContext = createContext(null);
export function useChat() { return useContext(ChatContext); }

// ── chatBridge: module-level singleton so any imported component can open a chat
//    panel without prop drilling. VisaLensApp registers openChat here on mount.
//    Usage anywhere: import { chatBridge } from './App'; chatBridge.open(caseId, name)
export const chatBridge = { open: () => {} };
import './App.css';
import JSZip from 'jszip';
import mammoth from 'mammoth'; // ← ADD HERE, after JSZip
import AdminPanel from './AdminPanel';
import AgencyPanel from './AgencyPanel';
import ProgramMatcher from './ProgramMatcher';
import ExpiryCard, { computeSoonestExpiry, computeDocScore } from './ExpiryCard';
import { viabilityScore } from './docScore';
import AlertsPage from './AlertsPage';
import HomeDashboard from './HomeDashboard';
import './HomeDashboard.css';
import InboxDashboard from './InboxDashboard';
import CalendarPage from './CalendarPage';
import StudentDashboard from './StudentDashboard';
import RadarMatrix from './RadarMatrix';
import { computeDocScore as _computeDocScoreForRadar, viabilityScore as _viabilityScoreForRadar } from './docScore';
import CaseHistory from './CaseHistory';
import AnalyticsDashboard from './AnalyticsDashboard';
import { MockInterview } from './mockinterview'; // ✅ named importmo
import PublicInterview from './PublicInterview';
import LoginPage from './LoginPage';
import NotificationBell from './NotificationBell';
import ReactDOM from 'react-dom';

import {
  AlertCircle, AlertTriangle, ArrowUpRight, BarChart3, Bell, BookOpen, Building2, Calendar, Check, CheckCircle,
  ChevronDown, Clock, ClipboardList, Copy, CreditCard, DollarSign, Download, Edit3, Eye, EyeOff,
  File, FileSpreadsheet, FileText, Flag, FolderDown, FolderOpen, Globe, GraduationCap,
  Info, Languages, LayoutDashboard, ListChecks, Loader2, Mail, MessageSquare, Mic,
  Moon, Pencil, Plus, Printer, RefreshCw, Reply, Save, Search, Send, ShieldCheck, Star, Sun,
  Target, Trash2, TriangleAlert, Upload, User, Users, X, XCircle, ZoomIn, Dot
} from 'lucide-react';

import { createClient } from '@supabase/supabase-js';

// ── Imports from extracted utility files (Phase 1) ─────────────────────────
import {
  getOrgSession, setOrgSession, clearOrgSession, getAuthHeaders,
  isTokenExpiringSoon, refreshTokenIfNeeded, authedFetch, withOrg
} from './utils/session';
import {
  _slugify, _initials, _isoDate, daysUntilExpiry,
  scoreCol, scoreBadge, scoreLabel
} from './utils/format';
import {
  parseGPA, parseIELTS, parseFinancial, parseCurrencyAmount,
  estimateTokens, tokenTierClient, estimateTokensIfConverted,
  parseCSV, normaliseRow, csvToRequirements, downloadCSV,
  resolveOffer, migrateOfferLetter, lookupFundsRequired
} from './utils/parsers';
import {
  mrzCharValue, mrzComputeCheckDigit, validatePassportNumber
} from './utils/mrz';
import {
  DOC_TYPES, getDT, TRANSCRIPT_LEVELS, guessType,
  ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, UNSUPPORTED_BUT_COMMON
} from './utils/docMeta';
import {
  loadGoogleScript, preloadDriveScripts,
  getAccessToken, clearDriveToken, hasDriveToken,
  openDrivePicker, downloadDriveFile,
  getDriveRootFolderId, createDriveSubfolder, uploadFileToDrive,
  DRIVE_TOKEN_KEY
} from './utils/googleDrive';
import {
  COUNTRY_META, COUNTRY_ISO2, COUNTRY_CURRENCY, getCountryMeta,
  VISA_DOC_TYPES, GENERIC_VISA_DOCS, UNIVERSITY_DATA, TEMPLATE_CSV
} from './constants/countries';

// ── Imports from extracted UI components (Phase 2) ──────────────────────────
import PreviewModal from './components/PreviewModal';
import ThumbImg from './components/ThumbImg';
import ScoreBar from './components/ScoreBar';
import ExpiryAlerts from './components/ExpiryAlerts';
import CopyBtn from './components/CopyBtn';
import FundsSufficiencyBanner from './components/FundsSufficiencyBanner';
import OfferLettersSection from './components/OfferLettersSection';
import CasDocumentsSection from './components/CasDocumentsSection';
import {
  caseMatchesAlert, resolveProfileCountry,
  normaliseCountry, parseIntakeYear,
  PolicyAlertBanner, QualityCard,
  AlertsHub, AlertsButton,
} from './components/AlertsPanel';
// ─────────────────────────────────────────────────────────────────────────────

const PROXY_URL = "https://visalens-proxy.ijecloud.workers.dev";

// Singleton to avoid "Multiple GoTrueClient instances" warning during HMR
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
const supabase = window._supabaseInstance;

const DARK_VARS = {
  "--bg":   "#0F1E3C",
  "--s1":   "#162444",
  "--s2":   "#1C2E52",
  "--s3":   "#223460",
  "--bd":   "#2A3F6F",
  "--bdem": "#3A5080",
  "--t1":   "#E8EEF8",
  "--t2":   "#94A3B8",
  "--t3":   "#4A5D7E",
};




/* ─── PROFILE CARD ───────────────────────────────────────────────── */
function ProfileCard({ data, setData, preferredOfferIndex, setPreferredOfferIndex, requirementsData }) {
  // Track which fields were originally "Not found" so we can restore that value if cleared
  const originalNotFoundRef = React.useRef(null);
  if (originalNotFoundRef.current === null) {
    // Capture on first render — keys whose initial extracted value was "Not found"
    originalNotFoundRef.current = new Set(
      Object.entries(data)
        .filter(([, v]) => v === "Not found")
        .map(([k]) => k)
    );
  }

  // Auto-populate fundsRequired from university data when preferred offer changes
  useEffect(() => {
    if (!requirementsData) return;
    // Only auto-populate if counsellor hasn't manually set it
    if (data.fundsRequiredSource === "manual" && data.fundsRequired) return;
    const lookup = lookupFundsRequired(data, preferredOfferIndex, requirementsData);
    if (lookup) {
      setData(p => ({ ...p, fundsRequired: lookup.value, fundsRequiredSource: "auto", fundsRequiredLabel: lookup.label, fundsRequiredDataSource: lookup.source }));
    } else {
      // Clear auto value if offer changes to one with no data
      if (data.fundsRequiredSource === "auto") {
        setData(p => ({ ...p, fundsRequired: "", fundsRequiredSource: null, fundsRequiredLabel: "", fundsRequiredDataSource: null }));
      }
    }
  }, [preferredOfferIndex, requirementsData]);

  const autoLookup   = requirementsData ? lookupFundsRequired(data, preferredOfferIndex, requirementsData) : null;
  const showFundsReq = !!(data.fundsRequired && data.fundsRequired.trim()) || !!autoLookup;
  const [profileCollapsed, setProfileCollapsed] = useState(false);
  const [profileTab, setProfileTab] = useState("personal");

  const rows = [
    { group: "Personal Information", fields: [
      {k:"fullName",       l:"Full Name",        w:true},
      {k:"dob",            l:"Date of Birth"},
      {k:"nationality",    l:"Nationality"},
      {k:"passportNumber",   l:"Passport No.",    w:true},
      {k:"passportIssueDate", l:"Passport Issued"},
      {k:"passportExpiry",   l:"Passport Expiry"},
      {k:"cnicNumber",              l:"CNIC Number"},
    {k:"cnicExpiry",              l:"CNIC Expiry"},
    {k:"cnicAddressRomanUrdu",    l:"CNIC Address (Roman Urdu)", w:true, multiline:true, placeholder:"Upload both sides of CNIC to extract"},
      {k:"gender",        l:"Gender"},
      {k:"city",          l:"City"},
      {k:"mobileNumber",  l:"Mobile Number"},
      {k:"email",         l:"Email"},
    ]},
    { group: "Academic Background", fields: [
      {k:"program",        l:"Highest Qualification", w:true},
      {k:"yearOfPassing",  l:"Year of Passing"},
      {k:"university",     l:"University"},
      {k:"academicResult", l:"Academic Result / GPA",  w:true, multiline:true},
    ]},
    { group: "English Qualifications", fields: [
      {k:"ieltsScore",        l:"IELTS Overall Score"},
      {k:"toeflScore",        l:"TOEFL Overall Score"},
      {k:"pteScore",          l:"PTE Overall Score"},
      {k:"otherEnglishTest",  l:"Other English Test / Certificate", w:true, multiline:true, placeholder:"No test/certification found"},
      {k:"mediumOfInstruction", l:"Medium of Instruction", w:true, multiline:true, placeholder:"e.g. English — University of Punjab"},
    ], showEnglishTests: true },
    { group: "Financial", fields: [
      {k:"financialHolder",  l:"Account Holder"},
      {k:"financialBalance", l:"Funds Available (from documents)"},
    ]},
  ];

  // Tab → row group mapping
  const TAB_GROUP = {
    personal:  "Personal Information",
    academic:  "Academic Background",
    english:   "English Qualifications",
    financial: "Financial",
    offers:    "__offers__",
  };

  // Build initials for avatar
  const initials = (() => {
    const n = data.fullName && data.fullName !== "Not found" ? data.fullName : "";
    return n.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("") || "?";
  })();

  const offerCount = Array.isArray(data.offerLetters) ? data.offerLetters.filter(o => o.university || o.country).length : 0;

  return (
    <div className="rc rc-purple vl-profile-card">
      {/* ── Identity header ── */}
      <div className="vl-profile-identity">
        <div className="vl-profile-avatar">{initials}</div>
        <div className="vl-profile-namewrap">
          <div className="vl-profile-name">
            {data.fullName && data.fullName !== "Not found" ? data.fullName : "Unknown Student"}
          </div>
          <div className="vl-profile-sub">
            {[
              data.passportNumber && data.passportNumber !== "Not found" ? `Passport ${data.passportNumber}` : null,
              data.nationality    && data.nationality    !== "Not found" ? data.nationality : null,
            ].filter(Boolean).join(" · ") || "No profile data yet"}
          </div>
        </div>
        <div className="vl-profile-badges">
          <span className="badge b-ok" style={{fontSize:9}}><CheckCircle size={9}/>Extracted</span>
          {data.studyGap && data.studyGap !== "Not found" && data.studyGap !== "" && (
            <span className="badge b-warn" style={{fontSize:9}}><Clock size={9}/>Gap</span>
          )}
          {Array.isArray(data.nameMismatches) && data.nameMismatches.length > 0 && (
            <span className="badge b-err" style={{fontSize:9}}><AlertCircle size={9}/>Mismatch</span>
          )}
        </div>
        <button
          className="vl-profile-collapse-btn"
          onClick={()=>setProfileCollapsed(c=>!c)}
          title={profileCollapsed ? "Expand" : "Collapse"}
          style={{background:"none",border:"none",cursor:"pointer",padding:4,color:"var(--t3)",display:"flex",alignItems:"center"}}
        >
          <ChevronDown size={14} style={{transition:"transform 200ms",transform:profileCollapsed?"none":"rotate(180deg)"}}/>
        </button>
      </div>

      {!profileCollapsed && <div className="vl-profile-body">
        {/* ── Alerts strip ── */}
        <div style={{padding:"0 16px"}}>
          <ExpiryAlerts profile={data}/>
          {data.studyGap && data.studyGap !== "Not found" && data.studyGap !== "" && (
            <div className="study-gap-alert">
              <Clock size={14} style={{flexShrink:0,marginTop:1}}/>
              <div>
                <div className="study-gap-title">Study Gap Detected</div>
                <div className="study-gap-detail">{data.studyGap}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Tab strip ── */}
        <div className="vl-profile-tabs">
          {[
            {id:"personal",  label:"Personal"},
            {id:"academic",  label:"Academic"},
            {id:"english",   label:"English"},
            {id:"financial", label:"Financial"},
            {id:"offers",    label:"Offers", count: offerCount},
          ].map(t => (
            <button key={t.id} className={`vl-ptab${profileTab===t.id?" on":""}`} onClick={()=>setProfileTab(t.id)}>
              {t.label}
              {t.count > 0 && <span className="vl-ptab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        <div style={{padding:"4px 16px 2px",borderBottom:"1px solid var(--bd)"}}>
          <div className="edit-bar" style={{marginBottom:0}}><Edit3 size={12} color="#1D6BE8"/><span className="edit-hint">Click any field to edit</span></div>
        </div>

        {/* ── Tab content: field groups ── */}
        {rows.map(row => (
          <div key={row.group} style={{display: TAB_GROUP[profileTab] === row.group ? "block" : "none"}}>
            <div className="rc-body" style={{paddingTop:12}}>
            <div className="pgroup">
            <div className="pgroup-label">{row.group}</div>
            <div className="pgrid">
              {row.fields.map(f => (
                <div key={f.k} className={`pfield${f.w?" s2":""}`}>
                  <div className="plbl" style={{display:"flex",alignItems:"center"}}>
                    {f.l}<CopyBtn value={data[f.k]}/>
                  </div>
                  {(() => {
                    const wasNotFound = originalNotFoundRef.current?.has(f.k);
                    const isNotFound  = data[f.k] === "Not found";
                    const fieldStyle  = isNotFound ? {color:"var(--err)"} : {};
                    function handleChange(e) {
                      const val = e.target.value;
                      // While typing, clear "Not found" so user can type freely
                      setData(p => ({...p, [f.k]: val === "Not found" ? "" : val}));
                    }
                    function handleBlur(e) {
                      // If field was originally "Not found" and user left it blank, restore it
                      if (wasNotFound && e.target.value.trim() === "") {
                        setData(p => ({...p, [f.k]: "Not found"}));
                      }
                    }
                    return f.multiline
                      ? <textarea className="pval-textarea" value={data[f.k]||""} onChange={handleChange} onBlur={handleBlur} placeholder={f.placeholder||"Not found — click to add"} aria-label={f.l} rows={3} style={fieldStyle}/>
                      : <input   className="pval-input"    value={data[f.k]||""} onChange={handleChange} onBlur={handleBlur} placeholder={f.placeholder||"Not found — click to add"} aria-label={f.l} style={fieldStyle}/>;
                  })()}
                  {f.k === "passportNumber" && (() => {
                    const v = validatePassportNumber(data.passportNumber);
                    if (v === "empty") return null;
                    if (v === "format_error") return (
                      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,fontSize:10,color:"var(--err)",fontFamily:"var(--fm)"}}>
                        <XCircle size={11} style={{flexShrink:0}}/>
                        Invalid format — expected 2 letters + 7 digits (e.g. AB1234567)
                      </div>
                    );
                    if (v === "suspicious") return (
                      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,fontSize:10,color:"var(--warn)",fontFamily:"var(--fm)"}}>
                        <TriangleAlert size={11} style={{flexShrink:0}}/>
                        Suspicious number — verify against original passport
                      </div>
                    );
                    if (v?.status === "valid") return (
                      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,fontSize:10,color:"var(--ok)",fontFamily:"var(--fm)"}}>
                        <CheckCircle size={11} style={{flexShrink:0}}/>
                        Format valid · MRZ check digit: <strong>{v.checkDigit}</strong>
                      </div>
                    );
                    return null;
                  })()}
                </div>
              ))}
            </div>

            {/* ── English Tests — detailed cards with sub-scores and URN ── */}
            {row.showEnglishTests && Array.isArray(data.englishTests) && data.englishTests.length > 0 && (
              <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                {data.englishTests.map((test, idx) => {
                  const hasSubs = test.subScores && Object.values(test.subScores).some(v => v && v !== "");
                  const hasUrn  = test.urn && test.urn !== "Not found" && test.urn !== "";
                  const hasDate = test.testDate && test.testDate !== "Not found" && test.testDate !== "";
                  const subKeys = ["listening","reading","writing","speaking"];
                  function updateTest(field, val) {
                    setData(p => {
                      const next = [...(p.englishTests||[])];
                      next[idx] = {...next[idx], [field]: val};
                      return {...p, englishTests: next};
                    });
                  }
                  function updateSub(sub, val) {
                    setData(p => {
                      const next = [...(p.englishTests||[])];
                      next[idx] = {...next[idx], subScores: {...(next[idx].subScores||{}), [sub]: val}};
                      return {...p, englishTests: next};
                    });
                  }
                  const typeColor = test.type?.includes("UKVI") ? "#059669" : test.type?.includes("IELTS") ? "#1D6BE8" : test.type?.includes("PTE") ? "#7C3AED" : test.type?.includes("TOEFL") ? "#B45309" : "#0284C7";
                  const typeBg   = test.type?.includes("UKVI") ? "rgba(5,150,105,.08)" : test.type?.includes("IELTS") ? "rgba(29,107,232,.08)" : test.type?.includes("PTE") ? "rgba(124,58,237,.08)" : test.type?.includes("TOEFL") ? "rgba(180,83,9,.08)" : "rgba(2,132,199,.08)";
                  return (
                    <div key={idx} style={{background:"var(--s2)",border:`1.5px solid ${typeColor}40`,borderRadius:"var(--r2)",overflow:"hidden"}}>
                      {/* Header */}
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:typeBg,borderBottom:`1px solid ${typeColor}20`}}>
                        <span style={{fontSize:11,fontWeight:700,color:typeColor,letterSpacing:".04em"}}>{test.type||"English Test"}</span>
                        {test.overallScore && test.overallScore !== "Not found" && (
                          <span style={{fontSize:13,fontWeight:800,color:typeColor,marginLeft:2}}>{test.overallScore}</span>
                        )}
                        {hasDate && <span style={{fontSize:10,fontFamily:"var(--fm)",color:"var(--t3)",marginLeft:"auto"}}>{test.testDate}</span>}
                        <button
                          style={{width:20,height:20,borderRadius:"var(--r1)",background:"transparent",border:"1px solid var(--bd)",color:"var(--t3)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 150ms"}}
                          onClick={() => setData(p => ({...p, englishTests: (p.englishTests||[]).filter((_,j)=>j!==idx)}))}
                          title="Remove this test"
                        ><X size={10}/></button>
                      </div>
                      {/* Fields */}
                      <div style={{padding:"8px 10px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                        <div>
                          <div className="plbl" style={{display:"flex",alignItems:"center"}}>Overall Score<CopyBtn value={test.overallScore}/></div>
                          <input className="pval-input" value={test.overallScore||""} onChange={e=>updateTest("overallScore",e.target.value)} placeholder="e.g. 6.5"/>
                        </div>
                        <div>
                          <div className="plbl" style={{display:"flex",alignItems:"center"}}>Test Date<CopyBtn value={test.testDate}/></div>
                          <input className="pval-input" value={test.testDate||""} onChange={e=>updateTest("testDate",e.target.value)} placeholder="e.g. 25 Jun 2024"/>
                        </div>
                        {/* URN / Reference */}
                        <div style={{gridColumn:"1/-1"}}>
                          <div className="plbl" style={{display:"flex",alignItems:"center",gap:5}}>
                            URN / Reference Number
                            {hasUrn && <span style={{fontSize:9,fontWeight:600,background:"rgba(2,132,199,.1)",color:"#0284C7",border:"1px solid rgba(2,132,199,.2)",borderRadius:4,padding:"1px 5px",fontFamily:"var(--fm)"}}>Found</span>}
                            <CopyBtn value={test.urn}/>
                          </div>
                          <input className="pval-input" style={{fontFamily:"var(--fm)",fontSize:11}} value={test.urn||""} onChange={e=>updateTest("urn",e.target.value)} placeholder="e.g. PEL/240625/83908/PTE004074785 or TRF number"/>
                        </div>
                        {/* Sub-scores */}
                        {subKeys.map(sub => (
                          <div key={sub}>
                            <div className="plbl" style={{display:"flex",alignItems:"center",textTransform:"capitalize"}}>{sub}<CopyBtn value={test.subScores?.[sub]}/></div>
                            <input className="pval-input" value={test.subScores?.[sub]||""} onChange={e=>updateSub(sub,e.target.value)} placeholder="—"/>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {/* Add test button */}
                <button
                  style={{fontSize:11,fontWeight:600,color:"var(--p)",background:"var(--pg)",border:"1px solid rgba(29,107,232,.2)",borderRadius:"var(--r1)",padding:"4px 12px",cursor:"pointer",alignSelf:"flex-start",transition:"all 150ms"}}
                  onClick={() => setData(p => ({...p, englishTests: [...(p.englishTests||[]), {type:"IELTS",overallScore:"",testDate:"",urn:"",subScores:{listening:"",reading:"",writing:"",speaking:""}}]}))}
                >+ Add Test</button>
              </div>
            )}
            {/* Show add button even when no tests exist */}
            {row.showEnglishTests && (!data.englishTests || data.englishTests.length === 0) && (
              <div style={{marginTop:8}}>
                <div style={{fontSize:11,fontFamily:"var(--fm)",color:"var(--t3)",marginBottom:6,fontStyle:"italic"}}>No English test certificates detected — add manually or re-analyse with test result documents.</div>
                <button
                  style={{fontSize:11,fontWeight:600,color:"var(--p)",background:"var(--pg)",border:"1px solid rgba(29,107,232,.2)",borderRadius:"var(--r1)",padding:"4px 12px",cursor:"pointer",transition:"all 150ms"}}
                  onClick={() => setData(p => ({...p, englishTests: [{type:"IELTS",overallScore:"",testDate:"",urn:"",subScores:{listening:"",reading:"",writing:"",speaking:""}}]}))}
                >+ Add English Test</button>
              </div>
            )}

            {/* ── Funds Required — only shown when auto-populated or counsellor has entered a value ── */}
            {row.group === "Financial" && showFundsReq && (
              <div className="funds-req-wrap">
                <div className="funds-req-lbl-row">
                  <span className="plbl" style={{marginBottom:0}}>Funds Required</span>
                  <CopyBtn value={data.fundsRequired}/>
                  {data.fundsRequiredSource === "auto" && data.fundsRequiredLabel && (
                    <span className="funds-req-badge funds-req-badge-auto">
                      {data.fundsRequiredDataSource === "csv" ? <FileSpreadsheet size={9}/> : <Info size={9}/>}
                      Auto · {data.fundsRequiredLabel}
                    </span>
                  )}
                  {data.fundsRequiredSource === "manual" && (
                    <span className="funds-req-badge funds-req-badge-manual"><Pencil size={9}/>Edited</span>
                  )}
                </div>
                <input
                  className="pval-input"
                  value={data.fundsRequired||""}
                  onChange={e => setData(p => ({
                    ...p,
                    fundsRequired: e.target.value,
                    fundsRequiredSource: e.target.value.trim() ? "manual" : (autoLookup ? "auto" : null),
                    fundsRequiredLabel:  e.target.value.trim() ? p.fundsRequiredLabel : (autoLookup?.label || ""),
                  }))}
                  placeholder="e.g. GBP 18,000"
                  aria-label="Funds Required"
                />
                {data.fundsRequiredSource === "auto" && (
                  <div className="funds-req-disclaimer">
                    From university data — verify this includes visa maintenance requirements before submission.
                  </div>
                )}
              </div>
            )}

            {row.group === "Financial" && (
              <div style={{marginTop:10}}>
                <FundsSufficiencyBanner balance={data.financialBalance} required={data.fundsRequired}/>
              </div>
            )}
            </div>{/* close pgroup */}
            </div>{/* close rc-body */}
          </div>
        ))}

        {/* ── Offers tab ── */}
        {profileTab === "offers" && (
          <div className="rc-body" style={{paddingTop:12}}>
            <OfferLettersSection data={data} setData={setData} preferredIdx={preferredOfferIndex} setPreferredIdx={setPreferredOfferIndex}/>
            <CasDocumentsSection data={data} setData={setData}/>
          </div>
        )}

        {/* Keep OfferLettersSection + CasDocumentsSection still rendered (hidden) so state is preserved */}
        {profileTab !== "offers" && (
          <div style={{display:"none"}}>
            <OfferLettersSection data={data} setData={setData} preferredIdx={preferredOfferIndex} setPreferredIdx={setPreferredOfferIndex}/>
            <CasDocumentsSection data={data} setData={setData}/>
          </div>
        )}

   {/* Detected Special Documents */}
        {/* Detected docs + name mismatches — always shown in Personal tab */}
        {profileTab === "personal" && (<div className="rc-body" style={{paddingTop:4}}>
{Array.isArray(data.detectedDocs) && data.detectedDocs.length > 0 && (
  <div className="pgroup">
    <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
      Detected Special Documents
      <span className="badge b-info" style={{fontSize:9}}>{data.detectedDocs.length} found</span>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {data.detectedDocs.map((doc, i) => (
        <div key={i} style={{background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:"10px 12px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--p)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
            {doc.type}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {doc.from        && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Signed By<CopyBtn value={doc.from}/></div><div style={{fontSize:14,fontWeight:600,color:doc.from&&doc.from!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.from||<span style={{color:"var(--err)",fontStyle:"italic",fontSize:13}}>Not found</span>}</div></div>}
            {doc.role        && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Signatory Title<CopyBtn value={doc.role}/></div><div style={{fontSize:14,color:doc.role&&doc.role!=="Not found"?"var(--t2)":"var(--err)",fontFamily:"var(--fu)"}}>{doc.role||<span style={{color:"var(--err)",fontStyle:"italic",fontSize:13}}>Not found</span>}</div></div>}
            {doc.employeeRole&& <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Employee Role<CopyBtn value={doc.employeeRole}/></div><div style={{fontSize:14,fontWeight:600,color:doc.employeeRole&&doc.employeeRole!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.employeeRole}</div></div>}
            {doc.duration    && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Duration<CopyBtn value={doc.duration}/></div><div style={{fontSize:14,color:doc.duration&&doc.duration!=="Not found"?"var(--t2)":"var(--err)",fontFamily:"var(--fu)"}}>{doc.duration}</div></div>}
            {doc.reference   && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Reference<CopyBtn value={doc.reference}/></div><div style={{fontSize:14,fontWeight:600,color:doc.reference&&doc.reference!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.reference}</div></div>}
            {doc.amount      && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Amount<CopyBtn value={doc.amount}/></div><div style={{fontSize:14,fontWeight:600,color:doc.amount&&doc.amount!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.amount}</div></div>}
            {doc.date        && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Date<CopyBtn value={doc.date}/></div><div style={{fontSize:14,fontWeight:600,color:doc.date&&doc.date!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.date}</div></div>}
            {doc.expiry      && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Expiry<CopyBtn value={doc.expiry}/></div><div style={{fontSize:14,fontWeight:600,color:doc.expiry&&doc.expiry!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.expiry}</div></div>}
            {doc.result      && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Result<CopyBtn value={doc.result}/></div><div style={{fontSize:14,fontWeight:600,color:doc.result==="Clear"?"var(--ok)":doc.result&&doc.result!=="Not found"?"var(--err)":"var(--err)"}}>{doc.result}</div></div>}
            {doc.institution && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Institution<CopyBtn value={doc.institution}/></div><div style={{fontSize:14,fontWeight:600,color:doc.institution&&doc.institution!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.institution}</div></div>}
            {/* FRC-specific: member count */}
            {doc.type === "FRC" && (doc.memberCount || (Array.isArray(doc.members) && doc.members.length > 0)) && (
              <div style={{gridColumn:"1/-1"}}>
                <div className="plbl" style={{display:"flex",alignItems:"center",gap:6}}>
                  Family Members
                  <span style={{fontSize:9,fontWeight:700,background:"rgba(29,107,232,.1)",color:"var(--p)",border:"1px solid rgba(29,107,232,.2)",borderRadius:4,padding:"1px 6px",fontFamily:"var(--fm)"}}>
                    {doc.memberCount || (Array.isArray(doc.members) ? doc.members.length : 0)} listed
                  </span>
                </div>
                {Array.isArray(doc.members) && doc.members.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:4}}>
                    {doc.members.map((m, mi) => (
                      <div key={mi} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",fontSize:11}}>
                        <span style={{fontWeight:600,color:"var(--t1)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name || "Unknown"}</span>
                        {m.relation && <span style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",flexShrink:0}}>{m.relation}</span>}
                        {m.cnic    && <span style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",flexShrink:0}}>{m.cnic}</span>}
                        {m.dob     && <span style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",flexShrink:0}}>{m.dob}</span>}
                        <CopyBtn value={[m.name, m.relation, m.cnic, m.dob].filter(Boolean).join(" · ")}/>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* MRC-specific: husband/wife names */}
            {doc.type === "MRC" && doc.husbandName && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Husband Name<CopyBtn value={doc.husbandName}/></div><div style={{fontSize:14,fontWeight:600,color:doc.husbandName&&doc.husbandName!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.husbandName}</div></div>}
            {doc.type === "MRC" && doc.wifeName    && <div><div className="plbl" style={{display:"flex",alignItems:"center"}}>Wife Name<CopyBtn value={doc.wifeName}/></div><div style={{fontSize:14,fontWeight:600,color:doc.wifeName&&doc.wifeName!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.wifeName}</div></div>}
            {doc.type === "MRC" && doc.registrationNo && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Registration No.<CopyBtn value={doc.registrationNo}/></div><div style={{fontSize:14,fontWeight:600,color:doc.registrationNo&&doc.registrationNo!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.registrationNo}</div></div>}
            {doc.notes       && <div style={{gridColumn:"1/-1"}}><div className="plbl" style={{display:"flex",alignItems:"center"}}>Notes<CopyBtn value={doc.notes}/></div><div style={{fontSize:13,color:doc.notes&&doc.notes!=="Not found"?"var(--t2)":"var(--err)",fontFamily:"var(--fu)",lineHeight:1.55}}>{doc.notes}</div></div>}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
  {/* Name Mismatches */}
{Array.isArray(data.nameMismatches) && data.nameMismatches.length > 0 && (
  <div className="pgroup">
    <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
      Name Mismatches Detected
      <span className="badge b-err" style={{fontSize:9}}>{data.nameMismatches.length} mismatch{data.nameMismatches.length!==1?"es":""}</span>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {data.nameMismatches.map((m, i) => (
        <div key={i} style={{background:"rgba(220,38,38,.05)",border:"1px solid rgba(220,38,38,.2)",borderRadius:"var(--r1)",padding:"9px 12px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--err)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>
            {m.documentName || m.doc || "Unknown Document"}
          </div>
          <div style={{fontSize:12,color:"var(--t1)",fontWeight:600,marginBottom:2}}>Found: "{m.nameFound}"</div>
          <div style={{fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)"}}>{m.issue}</div>
        </div>
      ))}
      <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:"var(--warng)",border:"1px solid rgba(180,83,9,.2)",borderRadius:"var(--r1)",fontSize:11,color:"var(--warn)",fontFamily:"var(--fm)",lineHeight:1.5}}>
        <span style={{flexShrink:0,marginTop:1}}>⚠️</span>
        <span>Name mismatches must be resolved before visa submission. A statutory declaration or affidavit may be required.</span>
      </div>
      </div>
  </div>
      )} {/* end nameMismatches */}
        </div>)} {/* end personal tab rc-body */}
      </div>}{/* end !profileCollapsed */}
    </div>
  );
}

/* ─── SIDEBAR DOC CHECKLIST (hybrid: auto-detection from classifications + manual override) ── */
function SidebarDocChecklist({ profile, preferredOfferIndex, docs, docTypes }) {
  const [open, setOpen]         = useState(false);
  const [manualTicked, setManualTicked] = useState({});

  const resolved = resolveOffer(profile, preferredOfferIndex);
  const country  = resolved.country;

  const reqList = (() => {
    if (country) {
      for (const key of Object.keys(VISA_DOC_TYPES)) {
        if (country.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(country.toLowerCase()))
          return VISA_DOC_TYPES[key];
      }
    }
    return GENERIC_VISA_DOCS;
  })();

  // Many-to-one map: checklist docType → all uploaded docTypes that satisfy it
  const CHECKLIST_ACCEPTS = {
    "passport":          ["passport"],
    "offer_letter":      ["offer_letter"],
    "bank_statement":    ["bank_statement", "financial_proof", "fee_receipt"],
    "transcript":        ["transcript", "degree_certificate"],
    "language_test":     ["language_test"],
    "financial_proof":   ["financial_proof", "bank_statement", "fee_receipt"],
    "recommendation":    ["recommendation"],
    "family_reg_cert":   ["family_reg_cert"],
    "marriage_reg_cert": ["marriage_reg_cert", "marriage_certificate"],
  };

  // Auto-detect: a checklist item is present if any uploaded doc maps to it
  function isAutoPresent(docType) {
    if (!docs || !docs.length) return false;
    const accepts = CHECKLIST_ACCEPTS[docType] || [docType];
    return docs.some(d => accepts.includes(docTypes[d.id] || d.type || "other"));
  }

  // An item is "ticked" if auto-detected OR manually ticked
  function isTicked(docType) {
    return isAutoPresent(docType) || !!manualTicked[docType];
  }

  const meta     = country ? getCountryMeta(country) : { flag:"🌍", visaType:"Visa Application" };
  const required = reqList.filter(r => r.required);
  const tickedCount = required.filter(r => isTicked(r.docType)).length;
  const allDone  = tickedCount === required.length && required.length > 0;

  return (
    <div className="sb-panel">
      <button className="sb-panel-hdr" onClick={() => setOpen(o => !o)}>
        <div className="rc-ico" style={{width:24,height:24,flexShrink:0}}><ListChecks size={12} color="#4A5D7E"/></div>
        <span className="sb-panel-ttl">Document Checklist</span>
        {allDone
          ? <span className="badge b-ok" style={{fontSize:9}}><CheckCircle size={9}/>Done</span>
          : <span className="badge b-neu" style={{fontSize:9}}>{tickedCount}/{required.length}</span>
        }
        <ChevronDown size={13} color="var(--t3)" style={{transition:"transform 200ms",transform:open?"rotate(180deg)":"none",flexShrink:0}}/>
      </button>
      {open && (
        <div className="sb-panel-body">
          <div className="sb-checklist-info">
            <Info size={11} style={{flexShrink:0,marginTop:1}}/>
            <span>Green ticks auto-update from document classifications. Tick manually for any doc classified as "Other".</span>
          </div>
          {country
            ? <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:8}}>{meta.flag} {country}</div>
            : <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:8}}>🌍 Generic — country will be determined after analysis</div>
          }
          <div className="sb-check-list">
            {reqList.map((r, i) => {
              const auto   = isAutoPresent(r.docType);
              const manual = !!manualTicked[r.docType];
              const ticked = auto || manual;
              return (
                <label key={i} className={`sb-check-item${ticked?" ticked":""}`}>
                  <input
                    type="checkbox"
                    className="sb-checkbox"
                    checked={ticked}
                    onChange={() => {
                      // If auto-present, manual toggle has no effect (auto wins)
                      if (!auto) setManualTicked(p=>({...p,[r.docType]:!p[r.docType]}));
                    }}
                  />
                  <span className="sb-check-name">{r.item}</span>
                  {auto && (
                    <span className="badge b-ok" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Auto</span>
                  )}
                  {!auto && !r.required && (
                    <span className="badge b-neu" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Optional</span>
                  )}
                </label>
              );
            })}
          </div>
          {Object.values(manualTicked).some(Boolean) && (
            <button className="sb-reset-btn" onClick={() => setManualTicked({})}>Reset manual ticks</button>
          )}
        </div>
      )}
    </div>
  );
}
/* ─── UNIVERSITY CHECKER (v6: accepts requirementsData prop, fixes IELTS) ── */
function UniversityChecker({ profile, requirementsData, compact, preferredOfferIndex }) {
  const resolved    = resolveOffer(profile, preferredOfferIndex);
  const seedCountry = resolved.country   || "";
  const seedUni     = resolved.university || "";

  const [country, setCountry]   = useState(seedCountry);
  const [uniName, setUniName]   = useState(seedUni);
  const [progName, setProgName] = useState("");

  // Re-seed whenever the preferred offer changes
  useEffect(() => {
    const r = resolveOffer(profile, preferredOfferIndex);
    setCountry(r.country || "");
    setUniName(r.university || "");
    setProgName("");
  }, [preferredOfferIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const countries   = Object.keys(requirementsData);
  const countryData = country ? requirementsData[country] : null;
  const unis        = countryData ? Object.keys(countryData.universities) : [];
  const uniData     = (countryData && uniName) ? countryData.universities[uniName] : null;
  const progs       = uniData ? uniData.programs : [];
  const prog        = (progName && progs.length) ? progs.find(p => p.name === progName) || null : null;

  function handleCountryChange(val) { setCountry(val); setUniName(""); setProgName(""); }
  function handleUniChange(val)     { setUniName(val); setProgName(""); }
  function handleProgChange(val)    { setProgName(progs.find(p => p.name === val) ? val : ""); }
  function handleReset() { setCountry(""); setUniName(""); setProgName(""); }
  
  // PTE Academic → IELTS band equivalent (standard conversion table)
  function pteToIelts(pte) {
    if (pte >= 79) return 9.0;
    if (pte >= 73) return 8.5;
    if (pte >= 65) return 7.5; // covers 7.0–7.5
    if (pte >= 59) return 7.0;
    if (pte >= 50) return 6.5;
    if (pte >= 43) return 6.0;
    if (pte >= 36) return 5.5;
    return 5.0;
  }
  // Best English score across IELTS, TOEFL (÷10 approximation), PTE (converted)
  function bestIeltsEquiv(profile) {
    const scores = [];
    // Legacy flat fields
    const i = parseIELTS(profile.ieltsScore); if (i !== null) scores.push(i);
    const t = parseFloat(profile.toeflScore);  if (!isNaN(t))  scores.push(t / 14.5);
    const p = parseFloat(profile.pteScore);    if (!isNaN(p))  scores.push(pteToIelts(p));
    // New englishTests array
    for (const et of (profile.englishTests || [])) {
      const score = parseFloat(et.overallScore);
      if (isNaN(score)) continue;
      const tn = (et.type || "").toLowerCase();
      if (tn.includes("ielts"))  scores.push(score);
      else if (tn.includes("toefl")) scores.push(score / 14.5);
      else if (tn.includes("pte"))   scores.push(pteToIelts(score));
    }
    return scores.length ? Math.max(...scores) : null;
  }

  function checkReq(val, req, type, profile) {
    if (type === "ielts") {
      const best = bestIeltsEquiv(profile || {});
      if (best !== null) return best >= req ? "pass" : "fail";
      // No IELTS/TOEFL/PTE — check if other English evidence exists
      const hasOther = (profile?.otherEnglishTest && profile.otherEnglishTest !== "Not found") ||
                       (profile?.mediumOfInstruction && profile.mediumOfInstruction !== "Not found");
      return hasOther ? "unknown" : "unknown"; // still unknown but label differs — handled in render
    }
    if (!val || val === "Not found" || req == null) return "unknown";
    if (type === "gpa")       { const v = parseGPA(val);       return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    if (type === "financial") { const v = parseFinancial(val); return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    return "unknown";
  }

  // Build a label showing which English score(s) the student has
  function englishScoreLabel(profile) {
    const parts = [];
    // Prefer new englishTests array if populated
    if (Array.isArray(profile.englishTests) && profile.englishTests.length > 0) {
      for (const et of profile.englishTests) {
        if (et.overallScore && et.overallScore !== "Not found" && et.overallScore !== "") {
          parts.push(`${et.type||"Test"} ${et.overallScore}`);
        }
      }
    }
    // Fall back to legacy flat fields if array empty
    if (parts.length === 0) {
      if (profile.ieltsScore && profile.ieltsScore !== "Not found") parts.push(`IELTS ${profile.ieltsScore}`);
      if (profile.toeflScore && profile.toeflScore !== "Not found") parts.push(`TOEFL ${profile.toeflScore}`);
      if (profile.pteScore   && profile.pteScore   !== "Not found") parts.push(`PTE ${profile.pteScore}`);
      if (profile.otherEnglishTest && profile.otherEnglishTest !== "Not found") parts.push(profile.otherEnglishTest);
      if (profile.mediumOfInstruction && profile.mediumOfInstruction !== "Not found") parts.push(`MOI: ${profile.mediumOfInstruction}`);
    }
    return parts.length ? parts.join(" / ") : "Not found";
  }

  let verdict = "unknown", verdictText = "Select a university and programme to check eligibility";
  if (prog) {
    const gpaStatus = checkReq(profile.academicResult, prog.gpa, "gpa");
    const finStatus = checkReq(profile.financialBalance, prog.financial, "financial");
    const engStatus = checkReq(null, prog.ielts, "ielts", profile);
    const statuses  = [gpaStatus, finStatus, engStatus];
    if (statuses.every(s => s === "pass"))         { verdict = "eligible";   verdictText = "✓ Student appears eligible for this programme"; }
    else if (statuses.every(s => s === "unknown")) { verdict = "unknown";    verdictText = "Profile incomplete — run analysis first to check eligibility"; }
    else if (statuses.some(s => s === "fail"))     { verdict = "ineligible"; verdictText = "✗ Student does not meet one or more requirements"; }
    else                                           { verdict = "partial";    verdictText = "⚠️ Some requirements met — profile may be incomplete"; }
  }

  // Detect if this country's data came from a custom CSV
  const BUILTIN_COUNTRIES = Object.keys(UNIVERSITY_DATA);
  const isCustomCountry = country && !BUILTIN_COUNTRIES.includes(country);

  return (
    <div className={compact ? "uni-sidebar-card" : "rc rc-blue vl-uni-card"}>
      {/* ── Header ── */}
      <div className={compact ? "uni-sidebar-hdr" : "rc-hdr rc-hdr--blue"}>
        <div className="rc-ico"><Building2 size={14} color="#fff"/></div>
        <span className={compact ? "uni-sidebar-ttl" : "rc-ttl"}>University Checker</span>
        {country && (
          <span className={`uni-src-badge ${isCustomCountry ? "custom" : "builtin"}`} style={{margin:0}}>
            {isCustomCountry
              ? <><FileSpreadsheet size={10} color="#fff"/>CSV</>
              : <><Info size={10} color="#fff"/>Built-in</>
            }
          </span>
        )}
        {(country||uniName||progName) && (
          <button onClick={handleReset} title="Reset university checker"
            style={{marginLeft:"auto",fontSize:11,fontWeight:600,color:"#fff",background:"transparent",border:"1px solid rgba(255,255,255,.3)",borderRadius:"var(--r1)",padding:"2px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <RefreshCw size={10}/>Reset
          </button>
        )}
      </div>

      <div className={compact ? "uni-sidebar-body" : "rc-body"}>

        {/* ── Selects: horizontal on full-width, stacked in compact ── */}
        <div className={compact ? "uni-selects-stack" : "vl-uni-selects-row"}>
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">Country</label>
            <select className="uni-select" value={country} onChange={e => handleCountryChange(e.target.value)}>
              <option value="">Select country…</option>
              {countries.map(c => <option key={c} value={c}>{requirementsData[c].flag} {c}</option>)}
            </select>
          </div>
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">University</label>
            <select className="uni-select" value={uniName} onChange={e => handleUniChange(e.target.value)} disabled={!country}>
              <option value="">Select university…</option>
              {unis.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">Programme</label>
            <select className="uni-select" value={progName} onChange={e => handleProgChange(e.target.value)} disabled={!uniName||!progs.length}>
              <option value="">Select programme…</option>
              {progs.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {uniName && uniData && !prog && (
          <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)",padding:"8px 0"}}>{uniData.ranking} · Select a programme to check requirements</div>
        )}

        {prog && countryData && uniData && (
          <div className="uni-result">
            {/* ── Verdict bar ── */}
            <div className={`vl-uni-verdict-bar ${verdict}`} style={{marginBottom:10}}>
              <span style={{fontSize:13}}>{verdict==="eligible"?"✓":verdict==="ineligible"?"✗":"⚠️"}</span>
              <span style={{flex:1}}>{verdictText}</span>
              <span className="badge b-neu" style={{flexShrink:0}}>{uniData.ranking}</span>
            </div>

            {/* ── Inline requirement rows ── */}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
              {[
                {label:"Min GPA",            req:prog.gpa,       val:profile.academicResult,   type:"gpa",       fmt:v=>`GPA ${v}`},
                {label:"English Proficiency", req:prog.ielts,     val:englishScoreLabel(profile), type:"ielts",     fmt:v=>`IELTS ${v}+`},
                {label:"Financial Req.",      req:prog.financial, val:profile.financialBalance,   type:"financial", fmt:v=>`${v.toLocaleString()}`},
              ].map(r => {
                const status = r.type === "ielts"
                  ? checkReq(null, r.req, "ielts", profile)
                  : checkReq(r.val, r.req, r.type);
                const icon = status==="pass" ? "✓" : status==="fail" ? "✗" : "?";
                return (
                  <div key={r.label} className={`vl-uni-req-row ${status}`}>
                    <div className={`vl-uni-req-icon ${status}`}>{icon}</div>
                    <div className="vl-uni-req-label">{r.label}</div>
                    <div className="vl-uni-req-threshold">{r.fmt(r.req)}</div>
                    <div className={`vl-uni-req-student ${status}`}>{r.val||"Not found"}</div>
                  </div>
                );
              })}
            </div>

            {/* ── Programme info grid ── */}
            <div className="uni-info-grid">
              <div className="uni-info-item"><div className="uni-info-lbl">Level</div><div className="uni-info-val">{prog.level}</div></div>
              <div className="uni-info-item"><div className="uni-info-lbl">Duration</div><div className="uni-info-val">{prog.duration}</div></div>
              <div className="uni-info-item"><div className="uni-info-lbl">Tuition/yr</div><div className="uni-info-val">{prog.tuition === 0 ? "Free" : `${prog.tuition.toLocaleString()}`}</div></div>
              <div className="uni-info-item"><div className="uni-info-lbl">Ranking</div><div className="uni-info-val">{uniData.ranking}</div></div>
            </div>
            {prog.note && <div className="uni-note"><Info size={13} style={{flexShrink:0,marginTop:1}}/><span>{prog.note}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SIDEBAR VISA CHECKLIST (collapsible reference) ───────────────── */
function SidebarVisaChecklist({ profile, preferredOfferIndex }) {
  const [open, setOpen] = useState(false);

  const resolved = resolveOffer(profile, preferredOfferIndex);
  const hasOffer = resolved.hasOffer || !!resolved.country;
  const country  = resolved.country;
  if (!hasOffer && !country) return null;

  const entry = country ? Object.entries(UNIVERSITY_DATA).find(([k]) => k.toLowerCase().includes(country.toLowerCase())) : null;
  if (!entry) return null;
  const [, countryData] = entry;

  return (
    <div className="sb-panel">
      <button className="sb-panel-hdr" onClick={() => setOpen(o => !o)}>
        <div className="rc-ico" style={{width:24,height:24,flexShrink:0}}><CheckCircle size={12} color="#4A5D7E"/></div>
        <span className="sb-panel-ttl">{countryData.flag} Visa Steps</span>
        <span className="badge b-neu" style={{fontSize:9}}>{countryData.visaChecklist.length} items</span>
        <ChevronDown size={13} color="var(--t3)" style={{transition:"transform 200ms",transform:open?"rotate(180deg)":"none",flexShrink:0}}/>
      </button>
      {open && (
        <div className="sb-panel-body">
          <div style={{fontSize:11,fontFamily:"var(--fm)",color:"var(--t3)",marginBottom:10}}>{countryData.visaType}</div>
          <div className="vc-list">
            {countryData.visaChecklist.map((item, i) => (
              <div key={i} className="vc-item" style={{padding:"7px 10px"}}>
                <div className={`vc-icon ${item.required?"pending":"ok"}`}>
                  {item.required ? <Clock size={13} color="var(--t3)"/> : <CheckCircle size={13} color="var(--ok)"/>}
                </div>
                <div>
                  <div className="vc-doc" style={{fontSize:12}}>
                    {item.item}
                    {item.required
                      ? <span className="badge b-err" style={{marginLeft:4,fontSize:9}}>Required</span>
                      : <span className="badge b-neu" style={{marginLeft:4,fontSize:9}}>Optional</span>}
                  </div>
                  <div className="vc-note" style={{fontSize:11}}>{item.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
/* ─── REQUIREMENTS MANAGER (v6 new) ────────────────────────────────── */
function RequirementsManager({ customRequirements, onLoad, onClear, csvText }) {
  const [dragOver,      setDragOver]      = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const fileRef = useRef();

  const ADMIN_PIN = "2026";

  function requireAdmin(action) {
    if (adminUnlocked) { action(); return; }
    const pin = window.prompt("Enter Admin PIN to modify university requirements:");
    if (pin === null) return;
    if (pin === ADMIN_PIN) { setAdminUnlocked(true); action(); }
    else alert("Incorrect PIN. Only agency admins can modify requirements.");
  }

  const isCustom = !!customRequirements;
  const totalPrograms = isCustom
    ? Object.values(customRequirements).reduce((s, cd) => s + Object.values(cd.universities).reduce((ss, u) => ss + u.programs.length, 0), 0)
    : 0;
  const totalCountries = isCustom ? Object.keys(customRequirements).length : 0;

  // Build flat rows for preview table
  const previewRows = [];
  if (isCustom) {
    for (const [country, cd] of Object.entries(customRequirements)) {
      for (const [uni, ud] of Object.entries(cd.universities)) {
        for (const p of ud.programs) {
          previewRows.push({ country, uni, ranking: ud.ranking, program: p.name, level: p.level, ielts: p.ielts, gpa: p.gpa, financial: p.financial, tuition: p.tuition });
          if (previewRows.length >= 30) break;
        }
        if (previewRows.length >= 30) break;
      }
      if (previewRows.length >= 30) break;
    }
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        if (!rows.length) { alert("CSV appears empty or could not be parsed."); return; }
        const reqs = csvToRequirements(rows);
        onLoad(reqs, text);
      } catch(err) { alert("Failed to parse CSV: " + err.message); }
    };
    reader.readAsText(file);
  }

  const columns = [
    {name:"Country",      desc:"Country name (must match exactly)"},
    {name:"University",   desc:"Full university name"},
    {name:"Ranking",      desc:'e.g. "QS #113"'},
    {name:"Program",      desc:"Programme name"},
    {name:"Level",        desc:"Postgraduate / Undergraduate"},
    {name:"Min_IELTS",    desc:"e.g. 6.5"},
    {name:"Min_GPA",      desc:"e.g. 3.3"},
    {name:"Min_Financial",desc:"Annual amount (e.g. 20000)"},
    {name:"Duration",     desc:'e.g. "1 year"'},
    {name:"Tuition",      desc:"Annual tuition (0 = free)"},
    {name:"Notes",        desc:"Optional — any extra info"},
  ];

  return (
    <div className="req-page">
      <div className={`req-status-bar ${isCustom?"custom":"builtin"}`}>
        {isCustom
          ? <><FileSpreadsheet size={16}/><strong>{totalPrograms} programmes</strong> across {totalCountries} {totalCountries===1?"country":"countries"} loaded from your CSV — University Checker is using this data.</>
          : <><Info size={16}/>Using built-in data. Upload your own universities data to get the perfect analysis.</>
        }
      </div>

      <div className="req-acts">
        <button className="btn-p" style={{width:"auto",height:38,paddingLeft:16,paddingRight:16,fontSize:13}}
          onClick={() => requireAdmin(() => fileRef.current?.click())}>
          <Upload size={14}/>{isCustom ? "Replace CSV" : "Upload Requirements CSV"}
          {!adminUnlocked && <span style={{fontSize:10,opacity:.6,marginLeft:4}}>🔒</span>}
        </button>
        <button className="btn-s" onClick={() => downloadCSV(TEMPLATE_CSV, "visalens_requirements_template.csv")}>
          <Download size={14}/>Download Template
        </button>
        {isCustom && <button className="btn-danger" onClick={() => requireAdmin(onClear)}>
          <Trash2 size={14}/>Clear CSV / Use Built-in
          {!adminUnlocked && <span style={{fontSize:10,opacity:.6,marginLeft:4}}>🔒</span>}
        </button>}
        {csvText && <button className="btn-s" onClick={() => downloadCSV(csvText, "visalens_requirements_loaded.csv")}>
          <Download size={14}/>Export Current CSV
        </button>}
        {adminUnlocked && (
          <span style={{fontSize:11,color:"var(--ok)",display:"flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
            <ShieldCheck size={12}/>Admin unlocked
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" style={{display:"none"}}
        onChange={e => { handleFile(e.target.files[0]); e.target.value=""; }}/>

      {/* Drag + drop zone when nothing loaded */}
      {!isCustom && (
        <div
          className={`req-upload-zone${dragOver?" over":""}`}
          onClick={() => requireAdmin(() => fileRef.current?.click())}
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);requireAdmin(()=>handleFile(e.dataTransfer.files[0]))}}
          role="button" tabIndex={0} onKeyDown={e=>e.key==="Enter"&&requireAdmin(()=>fileRef.current?.click())}
        >
          <div className="dz-ico" style={{margin:"0 auto 12px"}}><FileSpreadsheet size={20}/></div>
          <div className="dz-h">Drop your requirements CSV here</div>
          <div className="dz-s">or <span className="dz-link">browse files</span> · CSV format only · <strong>Admin PIN required</strong></div>
        </div>
      )}

      {/* Column format guide */}
      <div className="req-format-box">
        <div className="req-format-ttl">Accepted CSV Column Formats</div>
        <p style={{fontSize:12,color:"var(--text-muted)",margin:"0 0 10px"}}>
          VisaLens auto-detects your column names — both formats below are accepted.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"var(--primary)",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Standard / Template format</div>
            <div className="req-col-list" style={{margin:0}}>
              {[
                {name:"Country",       desc:"Country name"},
                {name:"University",    desc:"Full university name"},
                {name:"Program",       desc:"Programme name"},
                {name:"Level",         desc:"Postgraduate / Undergraduate"},
                {name:"Min_IELTS",     desc:"e.g. 6.5"},
                {name:"Min_GPA",       desc:"e.g. 3.3"},
                {name:"Min_Financial", desc:"Annual amount"},
                {name:"Tuition",       desc:"Annual tuition"},
                {name:"Duration",      desc:"e.g. 1 year"},
                {name:"Notes",         desc:"Optional extra info"},
              ].map(c => (
                <div key={c.name} className="req-col-item" style={{padding:"5px 8px"}}>
                  <div className="req-col-name">{c.name}</div>
                  <div className="req-col-desc">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Your spreadsheet format</div>
            <div className="req-col-list" style={{margin:0}}>
              {[
                {name:"Country",               desc:"Country name"},
                {name:"University Name",        desc:"Full university name"},
                {name:"Courses",               desc:"Programme name"},
                {name:"Admission Requirements",desc:"6.5 IELTS / 3.0 GPA"},
                {name:"Tution Fees",           desc:"e.g. £16500"},
                {name:"Living Cost",           desc:"e.g. £1023/month"},
                {name:"Intake",                desc:"e.g. Jan / Sep"},
              ].map(c => (
                <div key={c.name} className="req-col-item" style={{padding:"5px 8px"}}>
                  <div className="req-col-name" style={{color:"var(--accent)"}}>{c.name}</div>
                  <div className="req-col-desc">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Preview table */}
      {isCustom && previewRows.length > 0 && (
        <div className="req-preview-wrap">
          <div className="req-preview-hdr">
            <span className="req-preview-ttl">Loaded Data Preview</span>
            <span className="badge b-ok"><CheckCircle size={10}/>{totalPrograms} programmes</span>
          </div>
          <div className="req-scroll">
            <table className="req-table">
              <thead>
                <tr><th>Country</th><th>University</th><th>Ranking</th><th>Programme</th><th>Level</th><th>IELTS</th><th>GPA</th><th>Financial</th><th>Tuition</th></tr>
              </thead>
              <tbody>
                {previewRows.map((r,i) => (
                  <tr key={i}>
                    <td><span className="req-country-pill">{getCountryMeta(r.country).flag} {r.country}</span></td>
                    <td style={{maxWidth:180,overflow:"hidden",textOverflow:"ellipsis"}}>{r.uni}</td>
                    <td>{r.ranking}</td>
                    <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis"}}>{r.program}</td>
                    <td>{r.level}</td>
                    <td style={{color:"var(--p)",fontWeight:600}}>{r.ielts}</td>
                    <td style={{color:"var(--p)",fontWeight:600}}>{r.gpa}</td>
                    <td>{r.financial.toLocaleString()}</td>
                    <td>{r.tuition === 0 ? "Free" : r.tuition.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPrograms > 30 && (
            <div className="req-more">Showing 30 of {totalPrograms} programmes. All data is loaded and available in the University Checker.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── REPORT MODAL ───────────────────────────────────────────────── */
function ReportModal({ profile, results, onClose }) {
  const [mode,      setMode]      = useState("whatsapp");
  const [copied,    setCopied]    = useState(false);
  const [phone,     setPhone]     = useState("");
  const [emailAddr, setEmailAddr] = useState("");
  const wa = profile && results ? `🎓 *VisaLens Student Report*
━━━━━━━━━━━━━━━━━━
👤 *Student:* ${profile.fullName||"N/A"}
🌍 *Nationality:* ${profile.nationality||"N/A"}
📅 *DOB:* ${profile.dob||"N/A"}
🛂 *Passport:* ${profile.passportNumber||"N/A"} (Exp: ${profile.passportExpiry||"N/A"})${(()=>{const offers=Array.isArray(profile.offerLetters)?profile.offerLetters:[];return offers.length?"\n📄 *Offer Letter"+(offers.length>1?"s":"")+"*: "+offers.map((o,i)=>`${i===0?"★ ":""}${o.status||""}${o.university?` — ${o.university}`:""}${o.country?`, ${o.country}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}`).join(" | "):"";})()}

🎓 *Academic Background*
• Highest Qualification: ${profile.program||"N/A"}${profile.yearOfPassing&&profile.yearOfPassing!=="Not found"?` (${profile.yearOfPassing})`:""}
• University: ${profile.university||"N/A"}
• Result/GPA: ${profile.academicResult||"N/A"}
${(()=>{
  const tests = Array.isArray(profile.englishTests) && profile.englishTests.length > 0 ? profile.englishTests : [];
  if (tests.length > 0) {
    return tests.map(et => {
      const subs = et.subScores ? Object.entries(et.subScores).filter(([,v])=>v&&v!=="").map(([k,v])=>`${k.charAt(0).toUpperCase()+k.slice(1)}:${v}`).join(" ") : "";
      const urn  = et.urn && et.urn !== "Not found" && et.urn !== "" ? ` | URN: ${et.urn}` : "";
      const date = et.testDate && et.testDate !== "Not found" ? ` (${et.testDate})` : "";
      return `• ${et.type||"English Test"}: ${et.overallScore||"N/A"}${date}${subs?` | ${subs}`:""}${urn}`;
    }).join("\n");
  }
  const parts = [];
  if (profile.ieltsScore && profile.ieltsScore !== "Not found") parts.push(`• IELTS: ${profile.ieltsScore}`);
  if (profile.toeflScore && profile.toeflScore !== "Not found") parts.push(`• TOEFL: ${profile.toeflScore}`);
  if (profile.pteScore   && profile.pteScore   !== "Not found") parts.push(`• PTE: ${profile.pteScore}`);
  return parts.join("\n") || "• English Tests: N/A";
})()}${profile.otherEnglishTest&&profile.otherEnglishTest!=="Not found"?`\n• Other English: ${profile.otherEnglishTest}`:""}${profile.mediumOfInstruction&&profile.mediumOfInstruction!=="Not found"?`\n• Medium of Instruction: ${profile.mediumOfInstruction}`:""}${profile.studyGap&&profile.studyGap!=="Not found"?`\n⚠️ Study Gap: ${profile.studyGap}`:""}

💰 *Financial*
• Account Holder: ${profile.financialHolder||"N/A"}
• Funds Available: ${profile.financialBalance||"N/A"}${profile.fundsRequired?`\n• Required: ${profile.fundsRequired}`:""}${(()=>{if(!profile.fundsRequired||!profile.financialBalance)return"";const a=parseCurrencyAmount(profile.financialBalance),r=parseCurrencyAmount(profile.fundsRequired);if(a.amount===null||r.amount===null)return"\n• Sufficiency: Cannot parse — verify manually";if(a.currency!==r.currency)return"\n• Sufficiency: ⚠️ Currencies differ — verify manually";const d=a.amount-r.amount;return d>=0?`\n• Sufficiency: ✓ Sufficient (+${a.currency} ${d.toLocaleString()})`:`\n• Sufficiency: ✗ Shortfall of ${a.currency} ${Math.abs(d).toLocaleString()}`;})()}

📊 *Eligibility Scores*
• Overall: ${results.eligibility.overallScore}/100 (${scoreLabel(results.eligibility.overallScore)})
• Financial: ${results.eligibility.financialScore}/100
• Academic: ${results.eligibility.academicScore}/100
• Documents: ${results.eligibility.documentScore}/100

📋 *Summary*
${results.eligibility.summary||"N/A"}

⚠️ *Gaps &amp; Concerns:* ${results.missingDocuments?.length||0}
${results.missingDocuments?.map(d=>`• ${d.document}`).join("\n")||"Nothing flagged"}

🚩 *Risk Flags:* ${results.redFlags?.length||0}
${results.redFlags?.map(f=>`• [${f.severity.toUpperCase()}] ${f.flag}`).join("\n")||"None"}
${results.rejections?.length?`\n❌ *Rejections / Deferments:* ${results.rejections.length}\n${results.rejections.map(r=>`• ${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.university?`, ${r.university}`:""}${r.date?` (${r.date})`:""}${r.reason?`\n  ${r.reason}`:""}`).join("\n")}`:""}

━━━━━━━━━━━━━━━━━━
Generated by VisaLens — ${new Date().toLocaleDateString()}` : "No data available";

  const email = profile && results ? `Subject: Student Visa Assessment — ${profile.fullName||"Student"}

Dear [Counselor/Student Name],

Please find below the visa readiness assessment for:

STUDENT INFORMATION
—————————————————
Name: ${profile.fullName||"N/A"}
Date of Birth: ${profile.dob||"N/A"}
Nationality: ${profile.nationality||"N/A"}
Passport No.: ${profile.passportNumber||"N/A"}
Passport Expiry: ${profile.passportExpiry||"N/A"}${(()=>{const offers=Array.isArray(profile.offerLetters)?profile.offerLetters:[];return offers.length?"\nOffer Letter"+(offers.length>1?"s":"")+":\n"+offers.map((o,i)=>`  ${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` | Intake: ${o.intakeSeason}`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join("\n"):"";})()}

ACADEMIC BACKGROUND
—————————————————
Highest Qualification: ${profile.program||"N/A"}${profile.yearOfPassing&&profile.yearOfPassing!=="Not found"?` (${profile.yearOfPassing})`:""}
University: ${profile.university||"N/A"}
Academic Result/GPA: ${profile.academicResult||"N/A"}
${(()=>{
  const tests = Array.isArray(profile.englishTests) && profile.englishTests.length > 0 ? profile.englishTests : [];
  if (tests.length > 0) {
    return tests.map(et => {
      const subs = et.subScores ? Object.entries(et.subScores).filter(([,v])=>v&&v!=="").map(([k,v])=>`${k.charAt(0).toUpperCase()+k.slice(1)}: ${v}`).join(" | ") : "";
      const urn  = et.urn && et.urn !== "Not found" && et.urn !== "" ? `\n  URN/Reference: ${et.urn}` : "";
      const date = et.testDate && et.testDate !== "Not found" ? ` — Test Date: ${et.testDate}` : "";
      return `${et.type||"English Test"}: ${et.overallScore||"N/A"}${date}${subs?`\n  Sub-scores: ${subs}`:""}${urn}`;
    }).join("\n");
  }
  const parts = [];
  if (profile.ieltsScore && profile.ieltsScore !== "Not found") parts.push(`IELTS Score: ${profile.ieltsScore}`);
  if (profile.toeflScore && profile.toeflScore !== "Not found") parts.push(`TOEFL Score: ${profile.toeflScore}`);
  if (profile.pteScore   && profile.pteScore   !== "Not found") parts.push(`PTE Score: ${profile.pteScore}`);
  return parts.join("\n") || "English Tests: N/A";
})()}${profile.otherEnglishTest&&profile.otherEnglishTest!=="Not found"?`\nOther English Test/Cert: ${profile.otherEnglishTest}`:""}${profile.mediumOfInstruction&&profile.mediumOfInstruction!=="Not found"?`\nMedium of Instruction: ${profile.mediumOfInstruction}`:""}${profile.studyGap&&profile.studyGap!=="Not found"?`\nStudy Gap: ${profile.studyGap}`:""}

FINANCIAL STATUS
—————————————————
Account Holder: ${profile.financialHolder||"N/A"}
Balance: ${profile.financialBalance||"N/A"}${profile.fundsRequired?`\nRequired: ${profile.fundsRequired}`:""}${(()=>{if(!profile.fundsRequired||!profile.financialBalance)return"";const a=parseCurrencyAmount(profile.financialBalance),r=parseCurrencyAmount(profile.fundsRequired);if(a.amount===null||r.amount===null)return"\nSufficiency: Cannot parse amounts — verify manually";if(a.currency!==r.currency)return"\nSufficiency: Currencies differ — manual conversion required";const d=a.amount-r.amount;return d>=0?`\nSufficiency: Sufficient — ${a.currency} ${a.amount.toLocaleString()} available vs ${r.amount.toLocaleString()} required`:`\nSufficiency: Shortfall — ${a.currency} ${Math.abs(d).toLocaleString()} below requirement`;})()}

ELIGIBILITY ASSESSMENT
—————————————————
Overall Score: ${results.eligibility.overallScore}/100 — ${scoreLabel(results.eligibility.overallScore)}
Financial Strength: ${results.eligibility.financialScore}/100
Academic Standing: ${results.eligibility.academicScore}/100
Document Completeness: ${results.eligibility.documentScore}/100

Summary: ${results.eligibility.summary||"N/A"}

GAPS & CONCERNS (${results.missingDocuments?.length||0})
—————————————————
${results.missingDocuments?.map(d=>`• ${d.document}: ${d.reason}`).join("\n")||"Nothing flagged"}

RISK FLAGS (${results.redFlags?.length||0})
—————————————————
${results.redFlags?.map(f=>`• [${f.severity.toUpperCase()}] ${f.flag}\n  ${f.detail}`).join("\n\n")||"No significant risk flags"}
${results.rejections?.length?`\nREJECTIONS / DEFERMENTS (${results.rejections.length})\n—————————————————\n${results.rejections.map(r=>`• ${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.university?`, ${r.university}`:""}${r.program?`, ${r.program}`:""}${r.date?` (${r.date})`:""}${r.reason?`\n  Reason: ${r.reason}`:""}`).join("\n")}`:""}

—————————————————
This report was generated by VisaLens on ${new Date().toLocaleDateString()}.
Please verify all information before submission.` : "No data available";

  // Condensed WA summary — always fits in a wa.me URL (~800 chars)
  const waShort = profile && results ? [
    `🎓 *VisaLens Report — ${profile.fullName||"Student"}*`,
    `🌍 ${profile.nationality||"N/A"} | 📅 DOB: ${profile.dob||"N/A"}`,
    `🛂 Passport: ${profile.passportNumber||"N/A"} (Exp: ${profile.passportExpiry||"N/A"})`,
    (()=>{ const o = Array.isArray(profile.offerLetters)&&profile.offerLetters[0]; return o ? `📄 Offer: ${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}` : ""; })(),
    `🎓 ${profile.program||"N/A"} | Result: ${profile.academicResult||"N/A"}`,
    (()=>{ const t = Array.isArray(profile.englishTests)&&profile.englishTests[0]; return t ? `📝 ${t.type||"English"}: ${t.overallScore||"N/A"}` : profile.ieltsScore&&profile.ieltsScore!=="Not found" ? `📝 IELTS: ${profile.ieltsScore}` : ""; })(),
    `💰 Funds: ${profile.financialBalance||"N/A"}`,
    `📊 Score: ${results.eligibility.overallScore}/100 — ${scoreLabel(results.eligibility.overallScore)}`,
    results.redFlags?.length ? `🚩 Flags: ${results.redFlags.slice(0,3).map(f=>`[${f.severity.toUpperCase()}] ${f.flag}`).join(" | ")}` : "✅ No major flags",
    `━━━━━━\nGenerated by VisaLens — ${new Date().toLocaleDateString()}`,
  ].filter(Boolean).join("\n") : "No data available";

  // Email subject line
  const emailSubject = `Student Visa Assessment — ${profile?.fullName||"Student"}`;

  function copy() { navigator.clipboard.writeText(mode==="whatsapp"?wa:email); setCopied(true); setTimeout(()=>setCopied(false),2000); }

  function openWhatsApp() {
    const num = phone.replace(/\D/g, "");
    if (!num) { alert("Please enter a WhatsApp number with country code (e.g. 447911123456)"); return; }
    const url = `https://wa.me/${num}?text=${encodeURIComponent(waShort)}`;
    window.open(url, "_blank");
  }

  function openEmail() {
    if (!emailAddr.trim()) { alert("Please enter an email address"); return; }
    const url = `mailto:${emailAddr.trim()}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(email)}`;
    window.location.href = url;
  }

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="report-modal" role="dialog">
        <div className="modal-hdr"><div className="rc-ico"><Send size={14}/></div><span className="modal-title">Share Report</span><button className="btn-ico" onClick={onClose}><X size={14}/></button></div>
        <div className="report-body">
          <div className="report-tabs">
            <button className={`report-tab${mode==="whatsapp"?" on":""}`} onClick={()=>setMode("whatsapp")}><MessageSquare size={13}/>WhatsApp</button>
            <button className={`report-tab${mode==="email"?" on":""}`}    onClick={()=>setMode("email")}><Mail size={13}/>Email</button>
          </div>
          <div className="report-text">{mode==="whatsapp"?wa:email}</div>

          {/* ── Action row ── */}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>

            {/* Copy button — always shown */}
            <button className={`copy-btn ${mode}`} onClick={copy}>
              {copied?<><Check size={15}/>Copied!</>:<><Copy size={15}/>Copy {mode==="whatsapp"?"for WhatsApp":"for Email"}</>}
            </button>

            {/* WhatsApp send row */}
            {mode==="whatsapp" && (
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input
                  type="tel"
                  value={phone}
                  onChange={e=>setPhone(e.target.value)}
                  placeholder="Phone with country code e.g. 447911123456"
                  style={{flex:1,padding:"8px 12px",borderRadius:"var(--r1)",border:"1px solid var(--bd)",background:"var(--s2)",color:"var(--t1)",fontSize:13,outline:"none"}}
                />
                <button className="btn-p" style={{whiteSpace:"nowrap",height:36,paddingLeft:14,paddingRight:14,fontSize:13}} onClick={openWhatsApp}>
                  <MessageSquare size={14}/>Open in WhatsApp
                </button>
              </div>
            )}

            {/* Email send row */}
            {mode==="email" && (
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input
                  type="email"
                  value={emailAddr}
                  onChange={e=>setEmailAddr(e.target.value)}
                  placeholder="recipient@email.com"
                  style={{flex:1,padding:"8px 12px",borderRadius:"var(--r1)",border:"1px solid var(--bd)",background:"var(--s2)",color:"var(--t1)",fontSize:13,outline:"none"}}
                />
                <button className="btn-p" style={{whiteSpace:"nowrap",height:36,paddingLeft:14,paddingRight:14,fontSize:13}} onClick={openEmail}>
                  <Mail size={14}/>Open in Mail
                </button>
              </div>
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}

/* ─── REJECTIONS CARD ────────────────────────────────────────────── */
function RejectionsCard({ items }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items || items.length === 0) return null;
  const typeLabel = t => {
    if (t === "visa")       return {label:"Visa Rejection",   cls:"high"};
    if (t === "admission")  return {label:"Admission Rejection",cls:"medium"};
    if (t === "deferment")  return {label:"Deferment",          cls:"low"};
    return                         {label:"Rejection",          cls:"medium"};
  };
  return (
    <div className="rc rc-flags">
      <button className={`rc-hdr--btn${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><XCircle size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Rejections &amp; Deferments</span>
        <span className="badge b-err"><AlertCircle size={10}/>{items.length} Record{items.length!==1?"s":""}</span>
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":" open"}`}/>
      </button>
      {!collapsed && <div className="rc-body">
        <div className="rej-list">
          {items.map((it, i) => {
            const {label, cls} = typeLabel(it.type);
            return (
              <div key={i} className={`rej-item ${cls}`}>
                <div className="rej-top">
                  <span className={`fsev ${cls}`}>{label}</span>
                  {it.date && <span className="rej-date">{it.date}</span>}
                </div>
                <div className="rej-grid">
                  {it.country    && <div className="rej-f"><div className="rej-l">Country</div><div className="rej-v">{it.country}</div></div>}
                  {it.university && <div className="rej-f"><div className="rej-l">University</div><div className="rej-v">{it.university}</div></div>}
                  {it.program    && <div className="rej-f"><div className="rej-l">Programme</div><div className="rej-v">{it.program}</div></div>}
                  {it.reason     && <div className="rej-f rej-full"><div className="rej-l">Reason / Notes</div><div className="rej-v">{it.reason}</div></div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

/* ─── MISSING / ELIG / FLAGS / NOTES CARDS ───────────────────────── */
function MissingCard({ items }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rc rc-orange">
      <button className={`rc-hdr--btn rc-hdr--orange${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><AlertCircle size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Gaps &amp; Concerns</span>
        {items.length===0?<span className="badge b-ok"><CheckCircle size={10}/>Nothing flagged</span>:<span className="badge b-warn"><AlertCircle size={10}/>{items.length} Item{items.length!==1?"s":""}</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":" open"}`}/>
      </button>
      {!collapsed && <div className="rc-body">
        {items.length===0
          ? <div className="all-clear"><CheckCircle size={16}/>No document gaps, financial concerns, or missing evidence identified.</div>
          : <div className="miss-list">{items.map((it,i)=><div key={i} className="miss-item"><div className="miss-ico"><AlertCircle size={14}/></div><div><div className="miss-n">{it.document}</div><div className="miss-w">{it.reason}</div></div></div>)}</div>
        }
      </div>}
    </div>
  );
}
// ── EligSummaryCards: parses ALL-CAPS labels in summary into verdict cards ──
// Zone 1: strict structured cards — each label maps to a fixed category
function EligSummaryCards({ text }) {
  if (!text) return null;

  const LABEL_META = {
    // Financial — only about bank balance / financial evidence
    "STRONG FINANCIAL POSITION":  { icon: "💰", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "GOOD FINANCIAL POSITION":    { icon: "💰", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "WEAK FINANCIAL POSITION":    { icon: "💸", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    // Academic — only about qualifications and grades
    "EXCELLENT ACADEMIC RECORD":  { icon: "🎓", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "GOOD ACADEMIC RECORD":       { icon: "🎓", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "WEAK ACADEMIC RECORD":       { icon: "📉", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    // English — only about IELTS/PTE/TOEFL/language test results
    "ENGLISH PROFICIENCY":        { icon: "🗣️", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "ENGLISH PROFICIENCY ABSENT": { icon: "🗣️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    // Identity — only passport + CNIC status
    "IDENTITY VERIFIED":          { icon: "✅", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "IDENTITY INCOMPLETE":        { icon: "🪪", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    // Document package — full visa doc set verdict (never mixed with MISSING DOCUMENTS)
    "DOCUMENTS COMPLETE":         { icon: "📄", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "MISSING DOCUMENTS":          { icon: "📋", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    // Gaps / concerns
    "CRITICAL GAPS":              { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "GAPS IDENTIFIED":            { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "MODERATE CONCERNS":          { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    // Blockers — only when visa assessment is actively blocked
    "MAJOR BLOCKER":              { icon: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "CRITICAL BLOCKER":           { icon: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "HIGH RISK":                  { icon: "🔴", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "VISA REFUSAL RISK":          { icon: "🔴", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    // Profile / summary
    "STRONG PROFILE":             { icon: "⭐", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "OVERALL ASSESSMENT":         { icon: "📊", color: "#1D6BE8", bg: "rgba(29,107,232,.07)", bd: "rgba(29,107,232,.2)"  },
    "RECOMMENDATION":             { icon: "💡", color: "#1D6BE8", bg: "rgba(29,107,232,.07)", bd: "rgba(29,107,232,.2)"  },
  };

  // Build a regex that matches any known label (longest first to avoid partial matches)
  const labels = Object.keys(LABEL_META).sort((a,b) => b.length - a.length);
  const pattern = new RegExp(`(${labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`, 'g');

  // Split text into segments: [{label, detail}, ...]
  const segments = [];
  let remaining = text;
  let match;
  const re = new RegExp(`(${labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`, 'g');
  let lastIndex = 0;
  let found = false;

  // Find all label positions
  const matches = [];
  let m;
  const re2 = new RegExp(re.source, 'g');
  while ((m = re2.exec(text)) !== null) {
    matches.push({ label: m[1], index: m.index });
    found = true;
  }

  if (!found) {
    // No labels found — render as plain paragraph
    return <p className="elig-sum" style={{marginBottom:0}}>{text}</p>;
  }

  // Build segments from matches
  for (let i = 0; i < matches.length; i++) {
    const { label, index } = matches[i];
    const detailStart = index + label.length;
    const detailEnd   = i + 1 < matches.length ? matches[i + 1].index : text.length;
    // Strip leading colon/dash/space from detail
    const detail = text.slice(detailStart, detailEnd).replace(/^[:\s\-–—]+/, '').trim();
    segments.push({ label, detail });
  }

  // If there's text before the first label, prepend as an intro segment
  if (matches[0].index > 0) {
    const intro = text.slice(0, matches[0].index).trim();
    if (intro) segments.unshift({ label: null, detail: intro });
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:4}}>
      {segments.map((seg, i) => {
        if (!seg.label) {
          // Plain intro text
          return <p key={i} className="elig-sum" style={{margin:0,paddingBottom:4}}>{seg.detail}</p>;
        }
        const meta = LABEL_META[seg.label] || { icon:"ℹ️", color:"#64748B", bg:"rgba(100,116,139,.07)", bd:"rgba(100,116,139,.2)" };
        return (
          <div key={i} style={{
            display:"flex",gap:10,padding:"9px 12px",
            background:meta.bg,border:`1px solid ${meta.bd}`,
            borderRadius:"var(--r2)",alignItems:"flex-start"
          }}>
            <span style={{fontSize:16,lineHeight:1,flexShrink:0,marginTop:1}}>{meta.icon}</span>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:meta.color,letterSpacing:".06em",textTransform:"uppercase",marginBottom:3}}>
                {seg.label}
              </div>
              <div style={{fontSize:12,color:"var(--t1)",lineHeight:1.5,fontFamily:"var(--fu)"}}>
                {seg.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── EligFindings: Zone 2 — free-form notable discoveries the AI flagged ──
function EligFindings({ findings }) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return (
    <div style={{marginBottom:8}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".07em",textTransform:"uppercase",marginBottom:6,paddingBottom:5,borderBottom:"1px solid var(--bd)"}}>
        🔍 Notable Findings
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {findings.map((f, i) => (
          <div key={i} style={{
            display:"flex",gap:10,padding:"9px 12px",
            background:"rgba(29,107,232,.05)",border:"1px solid rgba(29,107,232,.15)",
            borderRadius:"var(--r2)",alignItems:"flex-start"
          }}>
            <span style={{fontSize:15,lineHeight:1,flexShrink:0,marginTop:1}}>🔍</span>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#1D6BE8",letterSpacing:".05em",textTransform:"uppercase",marginBottom:3,fontFamily:"var(--fh)"}}>
                {f.title || "Notable Finding"}
              </div>
              <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",lineHeight:1.55,fontFamily:"var(--fu)"}}>
                {f.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EligCard({ data, summary, findings: findingsProp, profile, isLive }) {
  const hasSufficiency = profile?.fundsRequired && profile.fundsRequired.trim() !== "";
  const [collapsed, setCollapsed] = useState(false);

  function scoreColor(s) {
    if (!s && s !== 0) return "var(--t3)";
    if (s >= 75) return "#059669";
    if (s >= 50) return "#B45309";
    return "#DC2626";
  }
  function scoreClass(s) {
    if (!s && s !== 0) return "slate";
    if (s >= 75) return "green";
    if (s >= 50) return "amber";
    return "red";
  }

  return (
    <div className="rc rc-elig vl-elig-card">
      {/* ── Header ── */}
      <button className={`rc-hdr--btn rc-hdr--green${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><Globe size={14} color="#fff"/></div>
        <span className="rc-ttl">Visa Eligibility</span>
        <span className={`badge ${scoreBadge(data.overallScore)}`}><ShieldCheck size={10}/>{scoreLabel(data.overallScore)}</span>
        {isLive&&<span className="badge b-p" style={{fontSize:9,marginLeft:4}}><RefreshCw size={9}/>Live</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":" open"}`}/>
      </button>

      {!collapsed && <div className="rc-body" style={{paddingTop:14}}>
        {isLive&&<div className="elig-live-note" style={{marginBottom:10}}><Edit3 size={11}/>Scores updated from profile edits · click Re-assess for full narrative update</div>}

        {/* ── Score metric strip — scannable at a glance ── */}
        <div className="vl-score-strip">
          {[
            {label:"Overall",   score:data.overallScore},
            {label:"Financial", score:hasSufficiency ? null : data.financialScore, override: hasSufficiency},
            {label:"Academic",  score:data.academicScore},
            {label:"Documents", score:data.documentScore},
          ].map(({label, score, override}) => (
            <div key={label} className="vl-score-cell">
              <div className={`vl-score-num vl-score-${scoreClass(score)}`}>
                {override ? "—" : (score != null ? score : "—")}
              </div>
              <div className="vl-score-lbl">{label}</div>
              <div className="vl-score-bar-track">
                <div className="vl-score-bar-fill" style={{
                  width: override ? "100%" : `${Math.max(0, Math.min(100, score||0))}%`,
                  background: override ? "rgba(2,132,199,.4)" : scoreColor(score),
                }}/>
              </div>
            </div>
          ))}
        </div>

        {hasSufficiency && (
          <div className="elig-fin-override" style={{marginBottom:10}}>
            <DollarSign size={12} style={{flexShrink:0,marginTop:1}}/>
            <span>Financial score overridden by sufficiency calculator — see Profile card for result.</span>
          </div>
        )}

        {/* ── Narrative summary + findings below scores ── */}
        <div className="vl-elig-narrative">
          <EligSummaryCards text={summary || data.summary} />
          <EligFindings findings={findingsProp || data.findings} />
        </div>

        {data.notes?.length>0&&<div className="elig-notes">{data.notes.map((n,i)=><div key={i} className="en"><div className="en-dot"/><span>{n}</span></div>)}</div>}
      </div>}
    </div>
  );
}
function FlagsCard({ flags }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rc rc-flags">
      <button className={`rc-hdr--btn rc-hdr--red${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><Flag size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Risk Flags</span>
        {flags.length===0?<span className="badge b-ok"><CheckCircle size={10}/>No Issues</span>:<span className="badge b-err"><XCircle size={10}/>{flags.length} Flag{flags.length!==1?"s":""}</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":" open"}`}/>
      </button>
      {!collapsed && <div className="rc-body">
        {flags.length===0
          ? <div className="all-clear"><CheckCircle size={16}/>No significant risk factors identified.</div>
          : <div className="flag-list">{flags.map((f,i)=><div key={i} className={`fi ${f.severity}`}><span className={`fsev ${f.severity}`}>{f.severity}</span><div><div className="fttl">{f.flag}</div><div className="fdet">{f.detail}</div></div></div>)}</div>
        }
      </div>}
    </div>
  );
}

/* ─── MERGED RISKS CARD — two-column: Notable Findings | Risk Flags ── */
function RisksCard({ flags, missingItems, rejections }) {
  const allFlags  = flags || [];
  const allMiss   = missingItems || [];
  const allRej    = rejections || [];
  const allClear  = allFlags.length === 0 && allMiss.length === 0 && allRej.length === 0;

  const highFlags = allFlags.filter(f => f.severity === "high");
  const medFlags  = allFlags.filter(f => f.severity !== "high");

  const rejTypeLabel = t => {
    if (t === "visa")      return { label:"Visa Rejection",     cls:"high"   };
    if (t === "admission") return { label:"Admission Rejection", cls:"medium" };
    if (t === "deferment") return { label:"Deferment",           cls:"low"    };
    return                        { label:"Rejection",           cls:"medium" };
  };

  if (allClear) {
    return (
      <div className="all-clear" style={{marginTop:8}}>
        <CheckCircle size={16}/>No gaps, risk flags, or rejections identified.
      </div>
    );
  }

  return (
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, alignItems:"start"}}>

      {/* ── LEFT: Notable Findings (missing docs) ── */}
      <div>
        <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8,paddingBottom:5,borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:5,fontFamily:"var(--fh)"}}>
          <AlertCircle size={10}/>Notable Findings
          {allMiss.length > 0 && <span style={{marginLeft:"auto",background:"rgba(100,116,139,.1)",color:"#64748B",borderRadius:3,fontSize:9,fontWeight:700,padding:"1px 5px"}}>{allMiss.length}</span>}
        </div>
        {allMiss.length === 0 ? (
          <div style={{fontSize:13,color:"var(--t3)",fontFamily:"var(--fu)",fontWeight:500}}>No notable findings.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {allMiss.map((it,i)=>(
              <div key={i} style={{background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",padding:"8px 10px"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2,fontFamily:"var(--fu)"}}>{it.document}</div>
                <div style={{fontSize:13,color:"var(--t2)",fontFamily:"var(--fu)",fontWeight:500,lineHeight:1.55}}>{it.reason}</div>
              </div>
            ))}
          </div>
        )}

        {/* Rejections live in Notable Findings column */}
        {allRej.length > 0 && (
          <div style={{marginTop:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6,paddingBottom:5,borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:5,fontFamily:"var(--fu)"}}>
              <XCircle size={10}/>Rejections
              <span style={{marginLeft:"auto",background:"rgba(220,38,38,.1)",color:"#DC2626",borderRadius:3,fontSize:9,fontWeight:700,padding:"1px 5px"}}>{allRej.length}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {allRej.map((it,i)=>{
                const {label,cls} = rejTypeLabel(it.type);
                return (
                  <div key={i} className={`rej-item ${cls}`}>
                    <div className="rej-top">
                      <span className={`fsev ${cls}`}>{label}</span>
                      {it.date && <span className="rej-date">{it.date}</span>}
                    </div>
                    <div className="rej-grid">
                      {it.country    && <div className="rej-f"><div className="rej-l">Country</div><div className="rej-v">{it.country}</div></div>}
                      {it.university && <div className="rej-f"><div className="rej-l">University</div><div className="rej-v">{it.university}</div></div>}
                      {it.program    && <div className="rej-f"><div className="rej-l">Programme</div><div className="rej-v">{it.program}</div></div>}
                      {it.reason     && <div className="rej-f rej-full"><div className="rej-l">Reason</div><div className="rej-v">{it.reason}</div></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Risk Flags ── */}
      <div>
        <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8,paddingBottom:5,borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:5,fontFamily:"var(--fu)"}}>
          <Flag size={10}/>Risk Flags
          {allFlags.length > 0 && (
            <span style={{marginLeft:"auto",background: highFlags.length > 0 ? "rgba(220,38,38,.1)" : "rgba(245,158,11,.1)",color: highFlags.length > 0 ? "#DC2626" : "#B45309",borderRadius:3,fontSize:9,fontWeight:700,padding:"1px 5px"}}>
              {allFlags.length}
            </span>
          )}
        </div>
        {allFlags.length === 0 ? (
          <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fu)",fontWeight:500}}>No risk flags.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {highFlags.map((f,i)=>(
              <div key={`h${i}`} className="fi high">
                <span className="fsev high">{f.severity}</span>
                <div><div className="fttl">{f.flag}</div><div className="fdet">{f.detail}</div></div>
              </div>
            ))}
            {medFlags.map((f,i)=>(
              <div key={`m${i}`} className={`fi ${f.severity}`}>
                <span className={`fsev ${f.severity}`}>{f.severity}</span>
                <div><div className="fttl">{f.flag}</div><div className="fdet">{f.detail}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
/* ─── DETECTED SPECIAL DOCUMENTS CARD ───────────────────────────────── */
// Surfaces detectedDocs from profileData as a top-level card in the Analyser
// so counsellors see critical docs (IHS, TB, FRC, NOC, etc.) without opening ProfileCard.
// The source data is the same — no duplication.
const DETECTED_DOC_META = {
  "IHS Receipt":              { icon: "💳", color: "#1D6BE8", bg: "rgba(29,107,232,.08)",  bd: "rgba(29,107,232,.25)"  },
  "TB Certificate":           { icon: "🩺", color: "#059669", bg: "rgba(5,150,105,.08)",   bd: "rgba(5,150,105,.25)"   },
  "FRC":                      { icon: "👨‍👩‍👧‍👦", color: "#7c3aed", bg: "rgba(124,58,237,.08)", bd: "rgba(124,58,237,.25)"  },
  "MRC":                      { icon: "💍", color: "#7c3aed", bg: "rgba(124,58,237,.08)", bd: "rgba(124,58,237,.25)"  },
  "NOC":                      { icon: "✅", color: "#059669", bg: "rgba(5,150,105,.08)",   bd: "rgba(5,150,105,.25)"   },
  "Sponsor Letter":           { icon: "💰", color: "#B45309", bg: "rgba(245,158,11,.08)",  bd: "rgba(245,158,11,.3)"   },
  "Experience Letter":        { icon: "💼", color: "#4A5D7E", bg: "rgba(74,93,126,.08)",   bd: "rgba(74,93,126,.25)"   },
  "Recommendation Letter":    { icon: "📋", color: "#1D6BE8", bg: "rgba(29,107,232,.08)",  bd: "rgba(29,107,232,.25)"  },
  "Gap Letter":               { icon: "📅", color: "#B45309", bg: "rgba(245,158,11,.08)",  bd: "rgba(245,158,11,.3)"   },
  "Scholarship Letter":       { icon: "🎓", color: "#059669", bg: "rgba(5,150,105,.08)",   bd: "rgba(5,150,105,.25)"   },
  "Health Insurance":         { icon: "🏥", color: "#1D6BE8", bg: "rgba(29,107,232,.08)",  bd: "rgba(29,107,232,.25)"  },
  "Accommodation Confirmation":{ icon: "🏠", color: "#059669", bg: "rgba(5,150,105,.08)",  bd: "rgba(5,150,105,.25)"   },
  "University Fee Receipt":   { icon: "🧾", color: "#4A5D7E", bg: "rgba(74,93,126,.08)",   bd: "rgba(74,93,126,.25)"   },
  "Application Fee Receipt":  { icon: "🧾", color: "#4A5D7E", bg: "rgba(74,93,126,.08)",   bd: "rgba(74,93,126,.25)"   },
  "Visa Fee Receipt":         { icon: "🧾", color: "#4A5D7E", bg: "rgba(74,93,126,.08)",   bd: "rgba(74,93,126,.25)"   },
  "Death Certificate":        { icon: "📄", color: "#DC2626", bg: "rgba(220,38,38,.08)",   bd: "rgba(220,38,38,.25)"   },
};
function getDocMeta(type) {
  return DETECTED_DOC_META[type] || { icon: "📄", color: "var(--t2)", bg: "var(--s2)", bd: "var(--bd)" };
}

/* ─── SMART DETECTED DOCUMENTS DERIVER ──────────────────────────────────────
 * Priority order:
 *   Tier 1 — profileData field-presence  (AI extracted — most accurate)
 *   Tier 2 — profileData.detectedDocs[]  (special docs: IHS, NOC, TB, etc.)
 *   Tier 3 — Supabase doc_list[]         (persisted list from last save)
 *   Tier 4 — uploaded docs[]             (raw file list — last resort)
 *
 * Returns: Array<{ label, type, color, icon, source, detail?, status? }>
 * Each entry deduped by type-key. Source tells the UI where the data came from.
 */

/** Returns true if val is a non-empty, non-null, non-whitespace value. */
function isDocVal(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return !isNaN(val);
  if (Array.isArray(val)) return val.length > 0;
  return Boolean(val);
}

function deriveDetectedDocs(profileData, results, docs, docTypes, supabaseDocList) {
  const p   = profileData || {};
  const md  = ((results || {}).missingDocuments || []).map(d => (d.document || '').toLowerCase());
  const out = new Map(); // type-key → entry

  function add(key, entry) {
    if (!out.has(key)) out.set(key, entry);
  }

  // ── TIER 1: profileData field presence ───────────────────────────────────────
  // Passport
  const passportNum    = isDocVal(p.passportNumber);
  const passportExpiry = isDocVal(p.passportExpiry);
  if (passportNum || passportExpiry) {
    const expired = (() => {
      if (!passportExpiry) return false;
      const parts = (p.passportExpiry || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
      let iso = null;
      if (parts) { const m = months[parts[2].toLowerCase().slice(0,3)]; if (m) iso = `${parts[3]}-${String(m).padStart(2,'0')}-${parts[1].padStart(2,'0')}`; }
      if (!iso) iso = p.passportExpiry;
      return iso ? new Date(iso) < new Date() : false;
    })();
    add('passport', {
      label: 'Passport', type: 'passport',
      color: expired ? '#DC2626' : '#1D6BE8', icon: '🛂',
      source: 'ai',
      detail: passportNum ? p.passportNumber : null,
      status: expired ? 'expired' : passportNum && passportExpiry ? 'ok' : 'partial',
    });
  }

  // English tests (IELTS / TOEFL / PTE)
  const englishTests = Array.isArray(p.englishTests) ? p.englishTests.filter(t => isDocVal(t.overallScore)) : [];
  if (englishTests.length > 0) {
    englishTests.forEach((t, i) => {
      const ttype = (t.type || 'english').toLowerCase().replace(/\s+/g, '_');
      add(ttype + '_' + i, {
        label: t.type || 'English Test', type: 'english_test',
        color: '#B45309', icon: '📝',
        source: 'ai',
        detail: t.overallScore ? `Score: ${t.overallScore}` : null,
        status: 'ok',
      });
    });
  } else if (isDocVal(p.ieltsScore)) {
    add('ielts', { label: 'IELTS', type: 'ielts', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.ieltsScore}`, status: 'ok' });
  } else if (isDocVal(p.toeflScore)) {
    add('toefl', { label: 'TOEFL', type: 'toefl', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.toeflScore}`, status: 'ok' });
  } else if (isDocVal(p.pteScore)) {
    add('pte', { label: 'PTE Academic', type: 'pte', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.pteScore}`, status: 'ok' });
  }

  // Bank statement / financial evidence
  if (isDocVal(p.financialBalance) || isDocVal(p.financialHolder)) {
    add('bank_statement', {
      label: 'Bank Statement', type: 'bank_statement',
      color: '#059669', icon: '🏦',
      source: 'ai',
      detail: p.financialBalance && p.financialBalance !== 'Not found' ? `Balance: ${p.financialBalance}` : (p.financialHolder || null),
      status: isDocVal(p.financialBalance) ? 'ok' : 'partial',
    });
  }

  // Academic / transcript
  if (isDocVal(p.academicResult) || isDocVal(p.program) || isDocVal(p.university)) {
    add('transcript', {
      label: 'Academic Transcript', type: 'transcript',
      color: '#D97706', icon: '🎓',
      source: 'ai',
      detail: p.academicResult && p.academicResult !== 'Not found' ? p.academicResult : (p.program || null),
      status: isDocVal(p.academicResult) ? 'ok' : 'partial',
    });
  }

  // CNIC / National ID
  if (isDocVal(p.cnicNumber) || isDocVal(p.cnicExpiry)) {
    add('cnic', {
      label: 'CNIC / National ID', type: 'cnic',
      color: '#0284C7', icon: '🪪',
      source: 'ai',
      detail: p.cnicNumber && p.cnicNumber !== 'Not found' ? p.cnicNumber : null,
      status: isDocVal(p.cnicNumber) ? 'ok' : 'partial',
    });
  }

  // Offer letters
  if (Array.isArray(p.offerLetters) && p.offerLetters.length > 0) {
    p.offerLetters.forEach((o, i) => {
      if (isDocVal(o.university) || isDocVal(o.status) || isDocVal(o.country)) {
        add('offer_' + i, {
          label: 'Offer Letter' + (p.offerLetters.length > 1 ? ` ${i+1}` : ''), type: 'offer_letter',
          color: '#7C3AED', icon: '✉️',
          source: 'ai',
          detail: o.university && o.university !== 'Not found' ? o.university : (o.country || null),
          status: isDocVal(o.status) ? 'ok' : 'partial',
        });
      }
    });
  }

  // CAS / Pre-CAS
  const hasCAS = (Array.isArray(p.casDocuments) && p.casDocuments.some(d => isDocVal(d.casNumber) || isDocVal(d.university)))
               || isDocVal(p.cas?.cas_number) || isDocVal(p.cas?.university);
  if (hasCAS) {
    const casNum = p.casDocuments?.[0]?.casNumber || p.cas?.cas_number || null;
    add('cas', {
      label: 'CAS / Pre-CAS', type: 'cas',
      color: '#0EA5E9', icon: '🏫',
      source: 'ai',
      detail: casNum && casNum !== 'Not found' ? casNum : null,
      status: 'ok',
    });
  }

  // ── TIER 2: profileData.detectedDocs (special docs) ──────────────────────────
  if (Array.isArray(p.detectedDocs)) {
    p.detectedDocs.forEach((d, i) => {
      if (!d.type) return;
      const meta = getDocMeta(d.type);
      add('special_' + d.type + '_' + i, {
        label: d.type, type: 'special',
        color: meta.color, icon: meta.icon,
        source: 'ai',
        detail: d.reference || d.date || d.institution || null,
        status: 'ok',
      });
    });
  }

  // ── TIER 3: Supabase doc_list (fallback for saved cases with no live profileData) ──
  if (out.size === 0 && Array.isArray(supabaseDocList) && supabaseDocList.length > 0) {
    supabaseDocList.forEach((d, i) => {
      const t = d.type || 'other';
      const label = t === 'passport' ? 'Passport'
        : t === 'bank_statement' ? 'Bank Statement'
        : t === 'offer_letter' ? 'Offer Letter'
        : t === 'ielts' ? 'IELTS' : t === 'pte' ? 'PTE' : t === 'toefl' ? 'TOEFL'
        : t === 'cnic' ? 'CNIC' : t === 'transcript' ? 'Transcript'
        : t === 'degree' ? 'Degree'
        : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const color = t === 'passport' ? '#1D6BE8' : t === 'bank_statement' ? '#059669'
        : t === 'offer_letter' ? '#7C3AED' : (t === 'ielts' || t === 'pte' || t === 'toefl') ? '#B45309'
        : t === 'cnic' ? '#0284C7' : t === 'transcript' || t === 'degree' ? '#D97706' : '#64748B';
      add('db_' + t + '_' + i, {
        label, type: t, color, icon: '📄',
        source: 'db',
        detail: d.name || null,
        status: 'ok',
      });
    });
  }

  // ── TIER 4: uploaded docs[] (raw file list, last resort) ─────────────────────
  if (out.size === 0 && Array.isArray(docs) && docs.length > 0) {
    docs.forEach((doc, i) => {
      const t = (docTypes && docTypes[doc.id]) || doc.type || 'other';
      const label = t === 'passport' ? 'Passport' : t === 'bank_statement' ? 'Bank Statement'
        : t === 'offer_letter' ? 'Offer Letter' : t === 'ielts' ? 'IELTS'
        : t === 'pte' ? 'PTE' : t === 'toefl' ? 'TOEFL' : t === 'cnic' ? 'CNIC'
        : t === 'degree' ? 'Degree / Transcript' : t === 'photo' ? 'Photo' : t === 'other' ? 'Other'
        : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const color = t === 'passport' ? '#1D6BE8' : t === 'bank_statement' ? '#059669'
        : t === 'offer_letter' ? '#7C3AED' : (t === 'ielts' || t === 'pte' || t === 'toefl') ? '#B45309'
        : t === 'cnic' ? '#0284C7' : t === 'degree' ? '#D97706' : '#64748B';
      const name = doc.renamed || doc.file?.name || `File ${i+1}`;
      add('file_' + (doc.id || i), {
        label, type: t, color, icon: '📄',
        source: 'file',
        detail: name,
        status: 'ok',
      });
    });
  }

  return Array.from(out.values());
}

function DetectedDocsCard({ profileData }) {
  const docs = Array.isArray(profileData?.detectedDocs) ? profileData.detectedDocs : [];
  const mismatches = Array.isArray(profileData?.nameMismatches) ? profileData.nameMismatches : [];

  // Build sidebar items: each doc + a "mismatches" entry if any
  const allItems = [
    ...docs.map((doc, i) => ({ kind: "doc", doc, i })),
    ...(mismatches.length > 0 ? [{ kind: "mismatches" }] : []),
  ];

  const [activeIdx, setActiveIdx] = useState(0);

  if (allItems.length === 0) return (
    <div className="all-clear" style={{marginTop:8}}><CheckCircle size={16}/>No special documents detected.</div>
  );

  const active = allItems[activeIdx] || allItems[0];

  function renderDocDetail(doc) {
    const meta  = getDocMeta(doc.type);
    const isTB  = doc.type === "TB Certificate";
    const color = isTB ? (doc.result === "Clear" ? "#059669" : doc.result ? "#DC2626" : meta.color) : meta.color;
    const bg    = isTB ? (doc.result === "Clear" ? "rgba(5,150,105,.06)" : doc.result ? "rgba(220,38,38,.06)" : meta.bg) : meta.bg;
    const bd    = isTB ? (doc.result === "Clear" ? "rgba(5,150,105,.25)" : doc.result ? "rgba(220,38,38,.25)" : meta.bd) : meta.bd;
    return (
      <div style={{background:bg,border:`1px solid ${bd}`,borderRadius:"var(--r2)",padding:"14px 14px 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <span style={{fontSize:20,lineHeight:1}}>{meta.icon}</span>
          <div>
            <div style={{fontSize:13,fontWeight:700,color,fontFamily:"var(--fh)"}}>{doc.type}</div>
            {doc.reference && <div style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",marginTop:1}}>{doc.reference}</div>}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 12px"}}>
          {doc.date         && <div><div className="plbl">Date</div><div style={{fontSize:14,fontWeight:600,color:doc.date&&doc.date!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.date}</div></div>}
          {doc.expiry       && <div><div className="plbl">Expiry</div><div style={{fontSize:14,fontWeight:600,color:doc.expiry&&doc.expiry!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.expiry}</div></div>}
          {doc.amount       && <div><div className="plbl">Amount</div><div style={{fontSize:14,fontWeight:600,color:doc.amount&&doc.amount!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.amount}</div></div>}
          {doc.result       && <div><div className="plbl">Result</div><div style={{fontSize:14,fontWeight:700,color}}>{doc.result}</div></div>}
          {doc.institution  && <div style={{gridColumn:"1/-1"}}><div className="plbl">Institution</div><div style={{fontSize:14,fontWeight:600,color:doc.institution&&doc.institution!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.institution}</div></div>}
          {doc.from         && <div style={{gridColumn:"1/-1"}}><div className="plbl">Signed By</div><div style={{fontSize:14,fontWeight:600,color:doc.from&&doc.from!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.from}{doc.role ? <span style={{fontWeight:400,color:"var(--t2)",marginLeft:6}}>· {doc.role}</span> : null}</div></div>}
          {doc.employeeRole && <div style={{gridColumn:"1/-1"}}><div className="plbl">Employee Role</div><div style={{fontSize:14,fontWeight:600,color:doc.employeeRole&&doc.employeeRole!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.employeeRole}{doc.duration ? <span style={{fontWeight:400,color:"var(--t2)",marginLeft:6}}>· {doc.duration}</span> : null}</div></div>}
          {doc.type==="FRC" && (doc.memberCount || (Array.isArray(doc.members)&&doc.members.length>0)) && (
            <div style={{gridColumn:"1/-1"}}>
              <div className="plbl" style={{display:"flex",alignItems:"center",gap:6}}>
                Family Members
                <span style={{fontSize:9,fontWeight:700,background:"rgba(124,58,237,.1)",color:"#7c3aed",borderRadius:3,padding:"1px 5px"}}>
                  {doc.memberCount||(Array.isArray(doc.members)?doc.members.length:0)} listed
                </span>
              </div>
              {Array.isArray(doc.members)&&doc.members.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:4}}>
                  {doc.members.map((m,mi)=>(
                    <div key={mi} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",fontSize:13}}>
                      <span style={{fontWeight:600,color:"var(--t1)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name||"Unknown"}</span>
                      {m.relation&&<span style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)",flexShrink:0}}>{m.relation}</span>}
                      {m.cnic&&<span style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)",flexShrink:0}}>{m.cnic}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {doc.type==="MRC"&&doc.husbandName&&<div><div className="plbl">Husband</div><div style={{fontSize:14,fontWeight:600,color:doc.husbandName&&doc.husbandName!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.husbandName}</div></div>}
          {doc.type==="MRC"&&doc.wifeName&&<div><div className="plbl">Wife</div><div style={{fontSize:14,fontWeight:600,color:doc.wifeName&&doc.wifeName!=="Not found"?"var(--t1)":"var(--err)"}}>{doc.wifeName}</div></div>}
          {doc.notes&&<div style={{gridColumn:"1/-1"}}><div className="plbl">Notes</div><div style={{fontSize:13,color:doc.notes&&doc.notes!=="Not found"?"var(--t2)":"var(--err)",fontFamily:"var(--fu)",lineHeight:1.55}}>{doc.notes}</div></div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",gap:0,minHeight:200,border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden",background:"var(--bg)"}}>
      {/* ── Mini sidebar ── */}
      <div style={{width:136,flexShrink:0,borderRight:"1px solid var(--bd)",background:"var(--s2)",display:"flex",flexDirection:"column",overflowY:"auto"}}>
        {docs.map((doc, i) => {
          const meta = getDocMeta(doc.type);
          const isTB = doc.type === "TB Certificate";
          const accentColor = isTB ? (doc.result === "Clear" ? "#059669" : doc.result ? "#DC2626" : meta.color) : meta.color;
          const isActive = activeIdx === i;
          return (
            <button key={i} onClick={()=>setActiveIdx(i)}
              style={{
                display:"flex",alignItems:"center",gap:7,
                padding:"9px 10px",border:"none",cursor:"pointer",textAlign:"left",
                background: isActive ? "var(--bg)" : "transparent",
                borderLeft: isActive ? `3px solid ${accentColor}` : "3px solid transparent",
                borderBottom:"1px solid var(--bd)",
                transition:"background 120ms",
              }}>
              <span style={{fontSize:15,lineHeight:1,flexShrink:0}}>{meta.icon}</span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:10,fontWeight:700,color: isActive ? accentColor : "var(--t1)",fontFamily:"var(--fh)",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:88}}>{doc.type}</div>
                {doc.reference && <div style={{fontSize:9,color:"var(--t3)",fontFamily:"var(--fm)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:88,marginTop:1}}>{doc.reference}</div>}
              </div>
            </button>
          );
        })}
        {mismatches.length > 0 && (
          <button onClick={()=>setActiveIdx(docs.length)}
            style={{
              display:"flex",alignItems:"center",gap:7,
              padding:"9px 10px",border:"none",cursor:"pointer",textAlign:"left",
              background: activeIdx === docs.length ? "var(--bg)" : "transparent",
              borderLeft: activeIdx === docs.length ? "3px solid #DC2626" : "3px solid transparent",
              borderBottom:"1px solid var(--bd)",
            }}>
            <span style={{fontSize:14,lineHeight:1,flexShrink:0}}>⚠️</span>
            <div style={{fontSize:10,fontWeight:700,color: activeIdx===docs.length ? "#DC2626" : "var(--t1)",fontFamily:"var(--fh)",lineHeight:1.3}}>
              Name Mismatches
              <div style={{fontSize:9,fontWeight:400,color:"var(--t3)",fontFamily:"var(--fm)",marginTop:1}}>{mismatches.length} found</div>
            </div>
          </button>
        )}
      </div>

      {/* ── Detail panel ── */}
      <div style={{flex:1,padding:12,overflowY:"auto",minWidth:0}}>
        {active.kind === "doc" && renderDocDetail(active.doc)}
        {active.kind === "mismatches" && (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--err)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Name Mismatches</div>
            {mismatches.map((m,i)=>(
              <div key={i} style={{background:"rgba(220,38,38,.05)",border:"1px solid rgba(220,38,38,.2)",borderRadius:"var(--r1)",padding:"8px 10px"}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--err)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>{m.documentName||m.doc||"Unknown Document"}</div>
                <div style={{fontSize:12,color:"var(--t1)",fontWeight:600,marginBottom:2}}>Found: "{m.nameFound}"</div>
                <div style={{fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)"}}>{m.issue}</div>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"7px 10px",background:"var(--warng)",border:"1px solid rgba(180,83,9,.2)",borderRadius:"var(--r1)",fontSize:11,color:"var(--warn)",fontFamily:"var(--fm)",lineHeight:1.5}}>
              <span style={{flexShrink:0}}>⚠️</span>
              <span>Name mismatches must be resolved before visa submission — a statutory declaration or affidavit may be required.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


const INTAKE_SEASONS = ["Fall (Aug/Sept)", "Spring (Jan)", "Summer (May)", "Annual"];
const INTAKE_YEARS   = ["2026", "2027", "2028"];
const LEAD_STATUSES  = [
  "None",
  "New Lead",
  "Follow up",
  "Ready to Apply",
  "Application Started",
  "Application Paid",
  "Application Submitted",
  "Application Accepted",
  "Ready for Visa",
  "Done",
];
const COUNTRY_FLAGS  = Object.fromEntries(
  Object.entries({...COUNTRY_META, ...Object.fromEntries(
    Object.entries(UNIVERSITY_DATA).map(([k,v]) => [k, {flag: v.flag}])
  )}).map(([k,v]) => [k, v.flag || "🌍"])
);

function makeEmptyTarget() {
  return { country: "", countryOther: "", university: "", universityOther: "", programme: "", programmeOther: "", intakeYear: "", intakeSeason: "", deferred: false, deferredDate: "" };
}

// ── Auto-populate application targets from extracted offer letters ────────────
// Maps each offer letter → a TargetCard-compatible object.
// Country/university are matched against requirementsData so dropdowns pre-select
// correctly; unmatched values fall through to the "Other" + free-text path.
// intakeSeason is normalised to the closest INTAKE_SEASONS label.
// intakeYear is extracted from the offer's intakeSeason string (e.g. "Sep 2026" → "2026").
function makeTargetsFromOffers(offerLetters, requirementsData) {
  if (!Array.isArray(offerLetters) || !offerLetters.length) return [];

  const knownCountries  = Object.keys(requirementsData || {});

  // Best-effort season normaliser — maps AI output → INTAKE_SEASONS label
  function normaliseSeason(raw) {
    if (!raw || raw === "Not found") return "";
    const r = raw.toLowerCase();
    if (r.includes("sep") || r.includes("aug") || r.includes("fall") || r.includes("autumn")) return "Fall (Aug/Sept)";
    if (r.includes("jan") || r.includes("spring") || r.includes("winter"))                    return "Spring (Jan)";
    if (r.includes("may") || r.includes("summer"))                                             return "Summer (May)";
    if (r.includes("annual") || r.includes("rolling") || r.includes("any"))                   return "Annual";
    return "";
  }

  // Extract 4-digit year from a string like "Sep 2026" or "Fall 2027"
  function extractYear(raw) {
    if (!raw) return "";
    const m = raw.match(/(20\d{2})/);
    return m ? m[1] : "";
  }

  // Match country: exact first, then case-insensitive, else "Other"
  function matchCountry(raw) {
    if (!raw || raw === "Not found") return { country: "", countryOther: "" };
    if (knownCountries.includes(raw)) return { country: raw, countryOther: "" };
    const lower = raw.toLowerCase();
    const found = knownCountries.find(c => c.toLowerCase() === lower);
    if (found) return { country: found, countryOther: "" };
    return { country: "Other", countryOther: raw };
  }

  // Match university against the country's known list; fall back to Other + free text
  function matchUniversity(uniRaw, country, requirementsData) {
    if (!uniRaw || uniRaw === "Not found") return { university: "", universityOther: "" };
    if (!country || country === "Other") return { university: "Other", universityOther: uniRaw };
    const unis = Object.keys(requirementsData?.[country]?.universities || {});
    if (unis.includes(uniRaw)) return { university: uniRaw, universityOther: "" };
    const lower = uniRaw.toLowerCase();
    const found = unis.find(u => u.toLowerCase() === lower);
    if (found) return { university: found, universityOther: "" };
    return { university: "Other", universityOther: uniRaw };
  }

  // Match programme against the university's programmes list; fall back to Other + free text
  function matchProgramme(progRaw, country, uniKey, requirementsData) {
    if (!progRaw || progRaw === "Not found") return { programme: "", programmeOther: "" };
    const uniData = requirementsData?.[country]?.universities?.[uniKey];
    const progs = Array.isArray(uniData?.programs) ? uniData.programs.map(p => p.name) : [];
    if (!progs.length) return { programme: "Other", programmeOther: progRaw };
    if (progs.includes(progRaw)) return { programme: progRaw, programmeOther: "" };
    const lower = progRaw.toLowerCase();
    const found = progs.find(p => p.toLowerCase() === lower);
    if (found) return { programme: found, programmeOther: "" };
    return { programme: "Other", programmeOther: progRaw };
  }

  return offerLetters
    .filter(o => o && (o.country || o.university))  // skip completely empty entries
    .map(o => {
      const { country, countryOther } = matchCountry(o.country);
      const { university, universityOther } = matchUniversity(o.university, country, requirementsData);
      // For programme matching, use the resolved university key (not "Other")
      const uniKey = university !== "Other" ? university : "";
      const { programme, programmeOther } = matchProgramme(o.program, country, uniKey, requirementsData);
      return {
        country,
        countryOther,
        university,
        universityOther,
        programme,
        programmeOther,
        intakeSeason: normaliseSeason(o.intakeSeason),
        intakeYear:   extractYear(o.intakeSeason) || extractYear(o.intakeYear),
        deferred:     false,
        deferredDate: "",
        _fromOffer:   true,   // flag so UI can show "auto-filled" hint
        _offerProgram: o.program || "", // preserve raw value for "Other" pre-fill
      };
    });
}

function TargetCard({ target, idx, total, requirementsData, profileData, preferredOfferIndex, onChange, onRemove, collapsed, onToggleCollapse }) {
  const isPrimary = idx === 0;
  const countries = Object.keys(requirementsData);

  // Universities for selected country
  const unis = target.country && target.country !== "Other" && requirementsData[target.country]
    ? Object.keys(requirementsData[target.country].universities || {})
    : [];
  const showUniDropdown = unis.length > 0;

  // Programmes for selected university (from requirementsData)
  const resolvedUniKey = (target.university && target.university !== "Other") ? target.university : null;
  const programmes = resolvedUniKey && target.country && target.country !== "Other"
    ? (requirementsData[target.country]?.universities?.[resolvedUniKey]?.programs || []).map(p => p.name)
    : [];
  const showProgDropdown = programmes.length > 0;

  // Conflict detection
  const offerCountries = (Array.isArray(profileData?.offerLetters) ? profileData.offerLetters : [])
    .map(o => o.country).filter(c => c && c !== "Not found");
  const resolvedCountry = target.country === "Other" ? target.countryOther.trim() : target.country;
  const countryConflict = resolvedCountry && offerCountries.length > 0 &&
    !offerCountries.some(c => c.toLowerCase() === resolvedCountry.toLowerCase());

  const offerYears = (Array.isArray(profileData?.offerLetters) ? profileData.offerLetters : [])
    .map(o => (o.intakeSeason || "").match(/(20\d{2})/)?.[1]).filter(Boolean);
  const yearConflict = target.intakeYear && offerYears.length > 0 &&
    !offerYears.includes(target.intakeYear);

  const flag = resolvedCountry ? (COUNTRY_FLAGS[resolvedCountry] || "🌍") : null;
  const accentColor = isPrimary ? "var(--p)" : "var(--t2)";
  const accentBg    = isPrimary ? "var(--pg)" : "var(--s3)";
  const accentBd    = isPrimary ? "rgba(29,107,232,.25)" : "var(--bd)";

  // Resolved display values for collapsed summary
  const resolvedProg = target.programme === "Other" ? target.programmeOther : target.programme;

  return (
    <div style={{
      background: "var(--s1)", border: `1px solid ${isPrimary ? "rgba(29,107,232,.3)" : "var(--bd)"}`,
      borderRadius: "var(--r2)", overflow: "hidden",
      boxShadow: isPrimary ? "0 2px 8px rgba(29,107,232,.08)" : "var(--sh1)",
      transition: "box-shadow var(--base)",
    }}>
      {/* Card header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
        background: isPrimary ? "rgba(29,107,232,.04)" : "var(--s2)",
        borderBottom: collapsed ? "none" : `1px solid ${isPrimary ? "rgba(29,107,232,.12)" : "var(--bd)"}`,
        cursor: "pointer",
      }} onClick={onToggleCollapse}>
        <div style={{
          width: 22, height: 22, borderRadius: "var(--r1)", flexShrink: 0,
          background: accentBg, border: `1px solid ${accentBd}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <GraduationCap size={12} color={accentColor}/>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontFamily: "var(--fh)", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: accentColor }}>
            {isPrimary ? "Primary Target" : `Target ${idx + 1}`}
          </span>
          {isPrimary && (
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--fm)", textTransform: "uppercase", letterSpacing: ".06em", background: "var(--pg)", color: "var(--p)", border: "1px solid rgba(29,107,232,.2)", borderRadius: 4, padding: "1px 5px" }}>
              Sets target country
            </span>
          )}
          {target._fromOffer && (
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--fm)", textTransform: "uppercase", letterSpacing: ".06em", background: "rgba(5,150,105,.08)", color: "var(--ok)", border: "1px solid rgba(5,150,105,.2)", borderRadius: 4, padding: "1px 5px" }}>
              From offer letter
            </span>
          )}
          {/* Summary pills when collapsed */}
          {collapsed && resolvedCountry && (
            <span style={{ fontSize: 10, color: "var(--t2)", fontFamily: "var(--fu)", display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {flag} {resolvedCountry}
                {resolvedProg ? ` · ${resolvedProg}` : ""}
                {target.intakeYear ? ` · ${target.intakeYear}` : ""}
                {target.intakeSeason ? ` · ${target.intakeSeason.split(" ")[0]}` : ""}
                {target.deferred ? " · ⏳" : ""}
              </span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {total > 1 && (
            <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove target"
              style={{ width: 20, height: 20, borderRadius: "var(--r1)", border: "1px solid var(--bd)", background: "var(--s2)", color: "var(--t3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all var(--fast)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--errg)"; e.currentTarget.style.borderColor = "var(--err)"; e.currentTarget.style.color = "var(--err)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "var(--s2)"; e.currentTarget.style.borderColor = "var(--bd)"; e.currentTarget.style.color = "var(--t3)"; }}>
              <X size={10}/>
            </button>
          )}
          <ChevronDown size={13} color="var(--t3)" style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform var(--fast)" }}/>
        </div>
      </div>

      {/* Card body */}
      {!collapsed && (
        <div style={{ padding: "12px 12px 14px" }}>

          {/* Country — full width */}
          <div className="uni-select-wrap" style={{ marginBottom: 10 }}>
            <label className="uni-select-lbl">Destination Country</label>
            <select className="uni-select" value={target.country}
              onChange={e => { onChange({ ...target, country: e.target.value, countryOther: "", university: "", universityOther: "", programme: "", programmeOther: "" }); }}>
              <option value="">Select country…</option>
              {countries.map(c => <option key={c} value={c}>{requirementsData[c]?.flag || "🌍"} {c}</option>)}
              <option value="Other">🌍 Other…</option>
            </select>
            {target.country === "Other" && (
              <input className="uni-select" style={{ marginTop: 6 }}
                placeholder="Type country name…"
                value={target.countryOther}
                onChange={e => onChange({ ...target, countryOther: e.target.value })}/>
            )}
            {countryConflict && (
              <div style={{ marginTop: 5, fontSize: 11, color: "var(--warn)", display: "flex", alignItems: "flex-start", gap: 5, lineHeight: 1.4 }}>
                <TriangleAlert size={11} style={{ flexShrink: 0, marginTop: 1 }}/><span>Differs from extracted offer letter country ({offerCountries[0]}). This entry takes precedence.</span>
              </div>
            )}
          </div>

          {/* University + Programme — side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>

            {/* University */}
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">University</label>
              {showUniDropdown ? (
                <>
                  <select className="uni-select" value={target.university}
                    onChange={e => onChange({ ...target, university: e.target.value, universityOther: "", programme: "", programmeOther: "" })}
                    disabled={!target.country}>
                    <option value="">Select university…</option>
                    {unis.map(u => <option key={u} value={u}>{u}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {target.university === "Other" && (
                    <input className="uni-select" style={{ marginTop: 6 }}
                      placeholder="Type university name…"
                      value={target.universityOther}
                      onChange={e => onChange({ ...target, universityOther: e.target.value })}/>
                  )}
                </>
              ) : (
                <input className="uni-select"
                  placeholder={target.country && target.country !== "Other" ? "No data — type name…" : "Type university name…"}
                  value={target.universityOther}
                  onChange={e => onChange({ ...target, universityOther: e.target.value })}/>
              )}
            </div>

            {/* Programme */}
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Programme</label>
              {showProgDropdown ? (
                <>
                  <select className="uni-select" value={target.programme}
                    onChange={e => onChange({ ...target, programme: e.target.value, programmeOther: "" })}>
                    <option value="">Select programme…</option>
                    {programmes.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {target.programme === "Other" && (
                    <input className="uni-select" style={{ marginTop: 6 }}
                      placeholder="Type programme name…"
                      value={target.programmeOther}
                      onChange={e => onChange({ ...target, programmeOther: e.target.value })}/>
                  )}
                </>
              ) : (
                <input className="uni-select"
                  placeholder={resolvedUniKey ? "No programmes on file — type name…" : "Select university first or type…"}
                  value={target.programmeOther}
                  onChange={e => onChange({ ...target, programme: "Other", programmeOther: e.target.value })}/>
              )}
              {/* Show offer letter programme hint if Other and _offerProgram is set but not matched */}
              {target.programme === "Other" && !target.programmeOther && target._offerProgram && (
                <button
                  style={{ marginTop: 5, fontSize: 10, color: "var(--p)", background: "var(--pg)", border: "1px solid rgba(29,107,232,.2)", borderRadius: "var(--r1)", padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--fu)" }}
                  onClick={() => onChange({ ...target, programmeOther: target._offerProgram })}>
                  <ArrowUpRight size={10}/>Use offer: "{target._offerProgram}"
                </button>
              )}
            </div>
          </div>

          {/* Year + Season row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Intake Year</label>
              <select className="uni-select" value={target.intakeYear}
                onChange={e => onChange({ ...target, intakeYear: e.target.value })}>
                <option value="">Year…</option>
                {INTAKE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {yearConflict && (
                <div style={{ marginTop: 4, fontSize: 10, color: "var(--warn)", display: "flex", gap: 4, alignItems: "flex-start" }}>
                  <TriangleAlert size={10} style={{ flexShrink: 0, marginTop: 1 }}/><span>Offer shows {offerYears[0]}</span>
                </div>
              )}
            </div>
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Intake Season</label>
              <select className="uni-select" value={target.intakeSeason}
                onChange={e => onChange({ ...target, intakeSeason: e.target.value })}>
                <option value="">Season…</option>
                {INTAKE_SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Deferred */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", fontSize: 12, fontFamily: "var(--fu)", color: "var(--t2)", marginBottom: target.deferred ? 8 : 0 }}>
            <input type="checkbox" checked={target.deferred}
              onChange={e => onChange({ ...target, deferred: e.target.checked, deferredDate: e.target.checked ? target.deferredDate : "" })}
              style={{ width: 14, height: 14, accentColor: "var(--p)", cursor: "pointer" }}/>
            <span>Deferred</span>
          </label>
          {target.deferred && (
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Deferred Until</label>
              <input type="date" className="uni-select"
                value={target.deferredDate}
                onChange={e => onChange({ ...target, deferredDate: e.target.value })}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotesCard({
  notes, setNotes, onSave, onSaveCase, savedMsg,
  counsellorName, setCounsellorName,
  leadStatus, setLeadStatus,
  cases, activeCaseId, activeCaseSerial,
  applicationTargets, setApplicationTargets,
  requirementsData, profileData, preferredOfferIndex,
  orgSession,
  orgMembers = [],
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cardCollapsed, setCardCollapsed] = useState({});
  // Notes ledger: array of {text, ts} entries parsed from the notes string.
  // Format: entries separated by "\n\n---\n" with a timestamp header line.
  const NOTE_SEP = "\n\n---\n";
  const NOTE_TS_RE = /^\[(.+?)\]\n/;

  function parseNoteEntries(raw) {
    if (!raw || !raw.trim()) return [];
    return raw.split(NOTE_SEP).map(chunk => {
      const m = chunk.match(NOTE_TS_RE);
      if (m) return { ts: m[1], text: chunk.slice(m[0].length) };
      return { ts: null, text: chunk };
    }).filter(e => e.text.trim());
  }

  function buildNotesString(entries) {
    return entries.map(e => (e.ts ? `[${e.ts}]\n${e.text}` : e.text)).join(NOTE_SEP);
  }

  const noteEntries = parseNoteEntries(notes);
  const [draftNote, setDraftNote] = useState("");

  function commitDraft() {
    if (!draftNote.trim()) return;
    const ts = new Date().toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const newEntry = { ts, text: draftNote.trim() };
    const updated = [newEntry, ...noteEntries];
    setNotes(buildNotesString(updated));
    setDraftNote("");
  }

  const memberNames = orgMembers.map(m => m.full_name).filter(Boolean);

  function updateTarget(idx, newTarget) {
    setApplicationTargets(prev => prev.map((t, i) => i === idx ? newTarget : t));
  }
  function removeTarget(idx) {
    setApplicationTargets(prev => prev.filter((_, i) => i !== idx));
  }
  function addTarget() {
    if (applicationTargets.length >= 4) return;
    const newIdx = applicationTargets.length;
    setApplicationTargets(prev => [...prev, makeEmptyTarget()]);
    setCardCollapsed(prev => ({ ...prev, [newIdx]: false }));
  }
  function toggleCard(idx) {
    setCardCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  const [notesTab, setNotesTab] = useState("notes");
  const hasAnyTarget = applicationTargets.length > 0;
  const studentName  = profileData?.fullName && profileData.fullName !== "Not found" ? profileData.fullName : null;

  // Lead status pill colour
  const STATUS_COLOR = {
    "None":                   { bg:"var(--s3)",                    color:"var(--t3)",    bd:"var(--bd)" },
    "New Lead":               { bg:"rgba(29,107,232,.10)",         color:"var(--p)",     bd:"rgba(29,107,232,.25)" },
    "Follow up":              { bg:"rgba(245,158,11,.10)",         color:"var(--warn)",  bd:"rgba(245,158,11,.25)" },
    "Ready to Apply":         { bg:"rgba(124,58,237,.10)",         color:"#7C3AED",      bd:"rgba(124,58,237,.25)" },
    "Application Started":    { bg:"rgba(14,165,233,.10)",         color:"#0EA5E9",      bd:"rgba(14,165,233,.25)" },
    "Application Paid":       { bg:"rgba(14,165,233,.15)",         color:"#0284C7",      bd:"rgba(14,165,233,.35)" },
    "Application Submitted":  { bg:"rgba(245,158,11,.12)",         color:"#B45309",      bd:"rgba(245,158,11,.3)"  },
    "Application Accepted":   { bg:"rgba(5,150,105,.10)",          color:"var(--ok)",    bd:"rgba(5,150,105,.25)"  },
    "Ready for Visa":         { bg:"rgba(5,150,105,.15)",          color:"#047857",      bd:"rgba(5,150,105,.35)"  },
    "Done":                   { bg:"rgba(5,150,105,.20)",          color:"#065F46",      bd:"rgba(5,150,105,.4)"   },
  };
  const sc = STATUS_COLOR[leadStatus] || STATUS_COLOR["None"];

  // Pipeline stages
  const PIPELINE = ["New Lead","Ready to Apply","Application Started","Application Submitted","Application Accepted","Visa"];
  const PIPELINE_LABELS = ["Lead","Ready","Started","Submitted","Accepted","Visa"];
  function pipelineIdx() {
    if (!leadStatus || leadStatus === "None") return -1;
    if (leadStatus === "New Lead" || leadStatus === "Follow up") return 0;
    if (leadStatus === "Ready to Apply") return 1;
    if (leadStatus === "Application Started" || leadStatus === "Application Paid") return 2;
    if (leadStatus === "Application Submitted") return 3;
    if (leadStatus === "Application Accepted") return 4;
    if (leadStatus === "Ready for Visa" || leadStatus === "Done") return 5;
    return -1;
  }
  const pIdx = pipelineIdx();

  return (
    <div className="rc rc-profile vl-counsellor-card">
      {/* ── Header ── */}
      <div className="vl-cp-hdr">
        <div className="rc-ico" style={{background:"rgba(255,255,255,.18)",borderRadius:8,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <User size={14} color="#fff"/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",fontFamily:"var(--fh)"}}>Counsellor Panel</div>
          {activeCaseSerial && <div style={{fontSize:10,fontFamily:"var(--fm)",color:"rgba(255,255,255,0.65)",marginTop:1}}>{activeCaseSerial}</div>}
        </div>
        {leadStatus && leadStatus !== "None" && (
          <span style={{
            display:"inline-flex",alignItems:"center",gap:4,
            fontSize:9,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",
            background:sc.bg,color:sc.color,border:`1px solid ${sc.bd}`,
            borderRadius:4,padding:"2px 7px",flexShrink:0,
          }}>{leadStatus}</span>
        )}
        <button className={`rc-hdr--btn-collapse`} onClick={() => setCollapsed(c => !c)}
          style={{background:"none",border:"none",cursor:"pointer",padding:4,color:"rgba(255,255,255,0.8)",display:"flex",alignItems:"center",marginLeft:4}}>
          <ChevronDown size={14} style={{transition:"transform 200ms",transform:collapsed?"none":"rotate(180deg)"}}/>
        </button>
      </div>

      <div style={collapsed ? { display: "none" } : {}}>

        {/* ── Pipeline timeline ── */}
        <div className="vl-pipeline" style={{padding:"12px 16px 0"}}>
          <div className="vl-pipeline-track">
            {PIPELINE_LABELS.map((label, i) => {
              const done   = i < pIdx;
              const active = i === pIdx;
              return (
                <div key={i} className="vl-pipeline-step">
                  {i < PIPELINE_LABELS.length - 1 && (
                    <div className={`vl-pipeline-line${done || active ? " done" : ""}`}/>
                  )}
                  <div className={`vl-pipeline-dot${done ? " done" : active ? " active" : ""}`}>
                    {done ? <Check size={8}/> : active ? <Dot size={10}/> : null}
                  </div>
                  <div className={`vl-pipeline-label${active ? " active" : ""}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Static info row ── */}
        {(studentName || activeCaseSerial) && (
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 16px 0"}}>
            {studentName && (
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:1}}>Student</div>
                <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{studentName}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Counsellor + Lead Status row ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"10px 16px 0"}}>
          <div style={{ position: "relative" }}>
            <label className="uni-select-lbl">Counsellor</label>
            {activeCaseId ? (
              <>
                <div className="uni-select" style={{ background: "var(--s3)", opacity: 0.7, cursor: "not-allowed", display: "flex", alignItems: "center" }}>
                  {counsellorName || "—"}
                </div>
                <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 3, fontFamily: "var(--fm)" }}>🔒 Locked — saved</div>
              </>
            ) : (
              <select
                className="uni-select"
                value={counsellorName}
                onChange={e => setCounsellorName(e.target.value)}
              >
                <option value="">Select counsellor…</option>
                {memberNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="uni-select-lbl">Lead Status</label>
            <select className="uni-select" value={leadStatus} onChange={e => setLeadStatus(e.target.value)}
              style={{ background: sc.bg, color: sc.color, border:`1px solid ${sc.bd}`, fontWeight:600 }}>
              {LEAD_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Tab strip: Notes / Targets — no more Save tab ── */}
        <div className="vl-cp-tabs">
          <button className={`vl-cptab${notesTab==="notes"?" on":""}`} onClick={()=>setNotesTab("notes")}>
            Notes
          </button>
          <button className={`vl-cptab${notesTab==="targets"?" on":""}`} onClick={()=>setNotesTab("targets")}>
            Targets
            {hasAnyTarget && <span className="vl-cptab-count">{applicationTargets.length}</span>}
          </button>
        </div>

        {/* ── Notes tab — append-only ledger ── */}
        {notesTab === "notes" && (
          <div style={{padding:"12px 16px 0"}}>
            {/* Draft entry input */}
            <textarea
              className="notes-area"
              placeholder="Add a new note…"
              value={draftNote}
              onChange={e => setDraftNote(e.target.value)}
              style={{marginBottom:6}}
            />
            <button
              onClick={commitDraft}
              disabled={!draftNote.trim()}
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                width:"100%",padding:"7px 0",marginBottom:10,
                fontSize:12,fontWeight:700,fontFamily:"var(--fh)",
                background: draftNote.trim() ? "var(--p)" : "var(--s3)",
                color: draftNote.trim() ? "#fff" : "var(--t3)",
                border:"none",borderRadius:"var(--r1)",cursor: draftNote.trim() ? "pointer" : "not-allowed",
                transition:"background 150ms",
              }}
            ><Plus size={12}/>Add Note</button>

            {/* Read-only history ledger */}
            {noteEntries.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:260,overflowY:"auto",paddingBottom:4}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:2}}>Note History</div>
                {noteEntries.map((entry,i)=>(
                  <div key={i} style={{background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",padding:"8px 10px"}}>
                    {entry.ts && (
                      <div style={{fontSize:9,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:4,display:"flex",alignItems:"center",gap:4}}>
                        <Clock size={9}/>{entry.ts}
                      </div>
                    )}
                    <div style={{fontSize:11,color:"var(--t1)",fontFamily:"var(--fu)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{entry.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Targets tab ── */}
        {notesTab === "targets" && (
          <div style={{padding:"12px 16px"}}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <GraduationCap size={13} color="var(--p)"/>
                <span style={{ fontFamily: "var(--fh)", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t1)" }}>Application Targets</span>
                <span style={{ fontFamily: "var(--fm)", fontSize: 10, color: "var(--t3)" }}>({applicationTargets.length}/4)</span>
              </div>
              {applicationTargets.length < 4 && (
                <button onClick={addTarget} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 11, fontFamily: "var(--fu)", fontWeight: 600,
                  color: "var(--p)", background: "var(--pg)", border: "1px solid rgba(29,107,232,.2)",
                  borderRadius: "var(--r1)", padding: "4px 10px", cursor: "pointer",
                }}><Plus size={11}/>Add Target</button>
              )}
            </div>
            {applicationTargets.length === 0 ? (
              <div style={{ border: "1.5px dashed var(--bd)", borderRadius: "var(--r2)", padding: "20px 16px", textAlign: "center", background: "var(--s2)" }}>
                <GraduationCap size={22} color="var(--t3)" style={{ margin: "0 auto 8px" }}/>
                <div style={{ fontSize: 12, fontFamily: "var(--fu)", color: "var(--t2)", fontWeight: 600, marginBottom: 4 }}>No application targets yet</div>
                <div style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--fu)", marginBottom: 12 }}>Add up to 4 countries &amp; universities this student is applying to</div>
                <button onClick={addTarget} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: "var(--fu)", fontWeight: 600, color: "#fff", background: "var(--p)", border: "none", borderRadius: "var(--r1)", padding: "6px 14px", cursor: "pointer" }}>
                  <Plus size={12}/>Add First Target
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {applicationTargets.map((target, idx) => (
                  <TargetCard
                    key={idx} target={target} idx={idx} total={applicationTargets.length}
                    requirementsData={requirementsData} profileData={profileData}
                    preferredOfferIndex={preferredOfferIndex}
                    onChange={t => updateTarget(idx, t)} onRemove={() => removeTarget(idx)}
                    collapsed={!!cardCollapsed[idx]} onToggleCollapse={() => toggleCard(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Permanent Save button — always visible below divider ── */}
        <div style={{borderTop:"1px solid var(--bd)",padding:"12px 16px 14px",marginTop:4}}>
          {savedMsg && (
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--ok)",fontFamily:"var(--fm)",marginBottom:8}}>
              <Check size={12}/>{savedMsg}
            </div>
          )}
          <button
            onClick={onSaveCase}
            style={{
              display:"flex",alignItems:"center",justifyContent:"center",gap:7,
              width:"100%",padding:"9px 0",
              fontSize:12,fontWeight:700,fontFamily:"var(--fh)",letterSpacing:".04em",
              background:"#3B0764",color:"#fff",
              border:"none",borderRadius:"var(--r1)",cursor:"pointer",
              transition:"opacity 150ms",
            }}
            onMouseEnter={e=>e.currentTarget.style.opacity=".85"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}
          >
            <Save size={13}/>Save to History
          </button>
        </div>

      </div>{/* end !collapsed */}
    </div>
  );
}

/* ─── SKELETON ───────────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {[1,2,3,4].map(i=>(
        <div key={i} className="skel-card">
          <div className="skel-hdr"><div className="skel" style={{width:28,height:28}}/><div className="skel" style={{width:120,height:12}}/></div>
          <div className="skel-body"><div className="skel skel-line"/><div className="skel skel-line m"/><div className="skel skel-line s"/></div>
        </div>
      ))}
    </div>
  );
}

/* ─── CASE HISTORY ───────────────────────────────────────────────── */
// CaseHistory component extracted to src/CaseHistory.jsx

/* ─── POLICY RADAR TAB ───────────────────────────────────────────── */
/* ─── EXPIRY RADAR PAGE ──────────────────────────────────────────── */
function ExpiryRadarPage({ cases, onOpenCase, onCasesBackfilled }) {
  const [filter,       setFilter]       = React.useState("all");
  const [radarCases,   setRadarCases]   = React.useState(null);  // null = loading
  const [backfillMsg,  setBackfillMsg]  = React.useState(null);  // { count, dismissed }
  const [backfilling,  setBackfilling]  = React.useState(false);

  // On mount: fetch ALL cases with full profile_data, extract AI dates for any
  // case missing expiry_date, write them back to Supabase, then display.
  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      const session = getOrgSession();
      if (!session?.org_id) { setRadarCases([]); return; }

      // Fetch every case — select only the columns we need including profile_data
      const { data, error } = await supabase
        .from("cases")
        .select("id, case_serial, student_name, counsellor_name, target_country, expiry_date, expiry_doc_type, profile_data")
        .eq("org_id", session.org_id)
        .order("expiry_date", { ascending: true, nullsFirst: false });

      if (error || cancelled) { setRadarCases([]); return; }

      // Split into already-have-expiry and need-backfill
      const needsBackfill = (data || []).filter(r => !r.expiry_date && r.profile_data);
      const alreadySet    = (data || []).filter(r => r.expiry_date);

      let backfilledRows = [];

      if (needsBackfill.length > 0) {
        setBackfilling(true);

        // Compute expiry for each case that needs it
        const updates = needsBackfill.map(r => {
          const profile = typeof r.profile_data === "string"
            ? JSON.parse(r.profile_data) : r.profile_data;
          // expiryDates = manual overrides stored inside profile_data
          const manualOverrides = profile?.expiryDates || {};
          const { expiry_date, expiry_doc_type } = computeSoonestExpiry(manualOverrides, profile);
          return { id: r.id, expiry_date, expiry_doc_type,
            student_name: r.student_name, counsellor_name: r.counsellor_name,
            target_country: r.target_country, case_serial: r.case_serial };
        }).filter(u => u.expiry_date); // only write rows where we actually found a date

        // Batch-write to Supabase
        await Promise.all(updates.map(u =>
          supabase.from("cases")
            .update({ expiry_date: u.expiry_date, expiry_doc_type: u.expiry_doc_type })
            .eq("id", u.id)
            .eq("org_id", session.org_id)
        ));

        backfilledRows = updates;
        if (!cancelled && updates.length > 0) {
          setBackfillMsg({ count: updates.length, dismissed: false });
          // Also notify parent so sidebar badge updates
          onCasesBackfilled?.(updates.map(u => ({
            id: u.id, expiryDate: u.expiry_date, expiryDocType: u.expiry_doc_type,
          })));
        }
        setBackfilling(false);
      }

      if (cancelled) return;

      // Merge only rows that have an expiry date — exclude no-date cases entirely
      const allRows = [
        ...alreadySet.map(r => ({
          id:            r.id,
          caseSerial:    r.case_serial,
          studentName:   r.student_name || "Unnamed",
          counsellorName:r.counsellor_name || "",
          targetCountry: r.target_country || "",
          expiryDate:    r.expiry_date,
          expiryDocType: r.expiry_doc_type,
        })),
        ...backfilledRows.map(u => ({
          id:            u.id,
          caseSerial:    u.case_serial,
          studentName:   u.student_name || "Unnamed",
          counsellorName:u.counsellor_name || "",
          targetCountry: u.target_country || "",
          expiryDate:    u.expiry_date,
          expiryDocType: u.expiry_doc_type,
        })),
        // No-date cases are intentionally excluded from Expiry Radar
      ];

      // Sort: soonest expiry first
      allRows.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      setRadarCases(allRows);
    }
    run();
    return () => { cancelled = true; };
  }, []);

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  }
  function urgencyFor(days) {
    if (days === null) return "none";
    if (days < 0)  return "expired";
    if (days <= 7) return "urgent";
    if (days <= 30) return "soon";
    return "ok";
  }
  function urgencyStyle(urgency) {
    switch (urgency) {
      case "expired": return { color: "#DC2626", bg: "rgba(220,38,38,.08)", bd: "rgba(220,38,38,.25)" };
      case "urgent":  return { color: "#EA580C", bg: "rgba(234,88,12,.08)", bd: "rgba(234,88,12,.25)" };
      case "soon":    return { color: "#D97706", bg: "rgba(217,119,6,.08)", bd: "rgba(217,119,6,.25)" };
      case "ok":      return { color: "#059669", bg: "rgba(5,150,105,.08)", bd: "rgba(5,150,105,.25)" };
      default:        return { color: "var(--t3)", bg: "var(--s2)",          bd: "var(--bd)"           };
    }
  }
  function daysLabel(days) {
    if (days === null) return "No date set";
    if (days < 0)  return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return "Expires today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  }

  // Loading state
  if (radarCases === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{
          padding: "14px 16px", borderRadius: 10, background: "var(--s2)",
          border: "1px solid var(--bd)", display: "flex", alignItems: "center", gap: 10,
          fontSize: 12, color: "var(--t2)", fontWeight: 600,
        }}>
          <Loader2 size={14} style={{ animation: "spin .7s linear infinite", flexShrink: 0 }} />
          {backfilling
            ? "Scanning case profiles for expiry dates…"
            : "Loading all cases from Supabase…"}
        </div>
      </div>
    );
  }

  const withExpiry = radarCases.filter(c => c.expiryDate);
  const sorted     = withExpiry; // already sorted from DB query
  const noExpiry   = radarCases.filter(c => !c.expiryDate).length;

  const counts = {
    urgent: sorted.filter(c => { const u = urgencyFor(daysUntil(c.expiryDate)); return u === "expired" || u === "urgent"; }).length,
    soon:   sorted.filter(c => urgencyFor(daysUntil(c.expiryDate)) === "soon").length,
    ok:     sorted.filter(c => urgencyFor(daysUntil(c.expiryDate)) === "ok").length,
  };

  const filtered = sorted.filter(c => {
    const u = urgencyFor(daysUntil(c.expiryDate));
    if (filter === "all")    return true;
    if (filter === "urgent") return u === "expired" || u === "urgent";
    if (filter === "soon")   return u === "soon";
    if (filter === "ok")     return u === "ok";
    return true;
  });

  const BTN = ({ id, label, count, color }) => (
    <button onClick={() => setFilter(id)} style={{
      padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
      cursor: "pointer", border: `1px solid ${filter === id ? color : "var(--bd)"}`,
      background: filter === id ? `${color}22` : "var(--s2)",
      color: filter === id ? color : "var(--t2)",
      display: "flex", alignItems: "center", gap: 5, transition: "all .15s",
    }}>
      {label}
      {count != null && (
        <span style={{
          background: filter === id ? color : "var(--s3)",
          color: filter === id ? "#fff" : "var(--t2)",
          borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 800,
        }}>{count}</span>
      )}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Backfill banner */}
      {backfillMsg && !backfillMsg.dismissed && (
        <div style={{
          padding: "12px 16px", borderRadius: 10,
          background: "rgba(5,150,105,.08)", border: "1px solid rgba(5,150,105,.3)",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 12, fontWeight: 600, color: "#059669",
        }}>
          <CheckCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            {backfillMsg.count} case{backfillMsg.count !== 1 ? "s" : ""} auto-updated with AI-extracted expiry dates.
            {" "}Open any case to verify the dates are correct.
          </span>
          <button onClick={() => setBackfillMsg(m => ({ ...m, dismissed: true }))}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#059669", padding: 2, display: "flex" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Summary strip — bold stat cards */}
      <div className="expiry-stat-row">
        {[
          { bg: "#F97316", icon: AlertTriangle, label: "Expired / ≤7d", value: counts.urgent, sub: counts.urgent === 0 ? "All clear" : `${counts.urgent} need attention` },
          { bg: "#EC4899", icon: Clock,         label: "Due Soon",       value: counts.soon,   sub: counts.soon === 0   ? "None due soon"  : "Expiring within 30 days"    },
          { bg: "#6366F1", icon: CheckCircle,   label: "All Clear",      value: counts.ok,     sub: counts.ok === 0     ? "None tracked"   : "Documents in order"         },
          { bg: "#06B6D4", icon: FileText,      label: "No Date Set",    value: noExpiry,      sub: noExpiry === 0      ? "Fully tracked"  : `${noExpiry} case${noExpiry !== 1 ? "s" : ""} missing`  },
        ].map(({ bg, icon: Icon, label, value, sub }) => (
          <div key={label} className="expiry-stat-card" style={{ background: bg }}>
            <div className="expiry-stat-card__top">
              <span className="expiry-stat-card__label">{label}</span>
              <div className="expiry-stat-card__icon">
                <Icon size={17} color="#fff" strokeWidth={2.2} />
              </div>
            </div>
            <div className="expiry-stat-card__value">{value}</div>
            <div className="expiry-stat-card__sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <BTN id="all"    label="All tracked" count={sorted.length}  color="var(--p)" />
        <BTN id="urgent" label="Urgent"       count={counts.urgent}  color="#DC2626"  />
        <BTN id="soon"   label="Due soon"     count={counts.soon}    color="#D97706"  />
        <BTN id="ok"     label="All clear"    count={counts.ok}      color="#059669"  />
      </div>

      {/* Case rows */}
      {filtered.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", color: "var(--t3)",
          background: "var(--s2)", borderRadius: 10, border: "1px solid var(--bd)", fontSize: 13,
        }}>
          {sorted.length === 0
            ? "No cases have expiry dates tracked yet. Open a case and the Document Expiry Dates card will auto-fill from extracted documents."
            : "No cases match this filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(c => {
            const days    = daysUntil(c.expiryDate);
            const urgency = urgencyFor(days);
            const s       = urgencyStyle(urgency);
            // Find the matching full case from parent cases array so handleLoadCase works
            const fullCase = cases.find(fc => fc.id === c.id) || c;
            return (
              <div key={c.id} style={{
                display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12,
                padding: "12px 16px", borderRadius: 10,
                background: s.bg, border: `1px solid ${s.bd}`,
                cursor: "pointer", transition: "opacity .15s",
              }}
                onClick={() => onOpenCase(fullCase)}
                onMouseEnter={e => e.currentTarget.style.opacity = ".85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--t1)" }}>
                    {c.studentName}
                    {c.caseSerial && <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8, fontWeight: 500 }}>{c.caseSerial}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                    {c.expiryDocType ? `Soonest: ${c.expiryDocType}` : "Tracked document"}
                    {c.targetCountry ? ` · ${c.targetCountry}` : ""}
                    {c.counsellorName ? ` · ${c.counsellorName}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{daysLabel(days)}</div>
                  <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2 }}>
                    {c.expiryDate ? new Date(c.expiryDate).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : ""}
                  </div>
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, padding: "4px 10px",
                  borderRadius: 5, background: s.color, color: "#fff",
                  whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: ".05em",
                }}>
                  Open →
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PolicyRadar({ policyAlerts, cases, onOpenCase }) {
  const [search,      setSearch]      = useState("");
  const [countryFilter, setCountryFilter] = useState("All");
  const [severitySort,  setSeveritySort]  = useState("All"); // All | high | medium | low
  const [expandedId,    setExpandedId]    = useState(null);

  const sevOrder = { high: 0, medium: 1, low: 2 };
  const sevColor = { high: "var(--err)",  medium: "var(--warn)", low: "var(--ok)" };
  const sevBg    = { high: "rgba(220,38,38,.05)",  medium: "rgba(245,158,11,.05)",  low: "rgba(5,150,105,.05)" };
  const sevBd    = { high: "rgba(220,38,38,.2)",   medium: "rgba(245,158,11,.2)",   low: "rgba(5,150,105,.2)" };
  const sevLabel = { high: "HIGH", medium: "MEDIUM", low: "LOW" };

  // Unique countries from alerts
  const countries = ["All", ...Array.from(new Set(policyAlerts.map(a => a.country))).sort()];

  // Filter + sort
  const visible = policyAlerts
    .filter(a => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        a.title.toLowerCase().includes(q) ||
        a.detail.toLowerCase().includes(q) ||
        a.country.toLowerCase().includes(q);
      const matchCountry = countryFilter === "All" || a.country === countryFilter;
      const matchSev     = severitySort  === "All" || a.severity === severitySort;
      return matchSearch && matchCountry && matchSev;
    })
    .sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));

  // Group by country
  const byCountry = visible.reduce((acc, alert) => {
    if (!acc[alert.country]) acc[alert.country] = [];
    acc[alert.country].push(alert);
    return acc;
  }, {});

  // Affected cases per alert — returns array of case objects
  function affectedCases(alert) {
    return cases.filter(c => caseMatchesAlert(c.profile || {}, alert));
  }

  const totalAffected = new Set(
    policyAlerts.flatMap(a => affectedCases(a).map(c => c.id))
  ).size;

  if (!policyAlerts.length) return (
    <div className="empty" style={{padding:"60px 20px"}}>
      <Flag size={36} color="var(--t3)" style={{margin:"0 auto 12px"}}/>
      <div className="empty-ttl">No policy alerts yet</div>
      <div className="empty-sub">Live alerts will appear here once published from the admin panel.</div>
    </div>
  );

  return (
    <div>
      {/* ── Summary strip ── */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        {[
          { label:"Active Alerts",   value: policyAlerts.length,                         color:"var(--t1)" },
          { label:"Countries",       value: new Set(policyAlerts.map(a=>a.country)).size, color:"var(--p)"  },
          { label:"High Severity",   value: policyAlerts.filter(a=>a.severity==="high").length,   color:"var(--err)" },
          { label:"Your Cases Affected", value: totalAffected,                            color:"var(--warn)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{flex:"1 1 140px"}}>
            <div className="stat-num" style={{color:s.color}}>{s.value}</div>
            <div className="stat-lbl">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Controls ── */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        {/* Search */}
        <div style={{position:"relative",flex:"1 1 200px"}}>
          <Search size={13} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--t3)",pointerEvents:"none"}}/>
          <input
            className="notes-input"
            style={{paddingLeft:30,fontSize:13,width:"100%"}}
            placeholder="Search alerts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--t3)",lineHeight:1}}>
              <X size={12}/>
            </button>
          )}
        </div>
        {/* Country dropdown */}
        <select
          className="notes-input"
          style={{fontSize:13,minWidth:160}}
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
        >
          {countries.map(c => <option key={c} value={c}>{c === "All" ? "All Countries" : c}</option>)}
        </select>
        {/* Severity filter */}
        <select
          className="notes-input"
          style={{fontSize:13,minWidth:140}}
          value={severitySort}
          onChange={e => setSeveritySort(e.target.value)}
        >
          <option value="All">All Severities</option>
          <option value="high">High Only</option>
          <option value="medium">Medium Only</option>
          <option value="low">Low Only</option>
        </select>
      </div>

      {visible.length === 0 && (
        <div className="empty" style={{padding:"40px 20px"}}>
          <div className="empty-ttl">No alerts match your filters</div>
        </div>
      )}

      {/* ── Alerts grouped by country ── */}
      {Object.entries(byCountry).map(([country, alerts]) => (
        <div key={country} style={{marginBottom:28}}>
          {/* Country header */}
          <div style={{
            display:"flex",alignItems:"center",gap:10,
            marginBottom:12,paddingBottom:8,
            borderBottom:"1px solid var(--bd)",
          }}>
            <Globe size={14} color="var(--p)"/>
            <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{country}</span>
            <span style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
              {alerts.length} alert{alerts.length!==1?"s":""}
              {(() => {
                const n = new Set(alerts.flatMap(a => affectedCases(a).map(c=>c.id))).size;
                return n > 0 ? ` · ${n} case${n!==1?"s":""} affected` : "";
              })()}
            </span>
          </div>

          {/* Alert cards */}
          {alerts.map(alert => {
            const affected  = affectedCases(alert);
            const isOpen    = expandedId === alert.id;
            return (
              <div key={alert.id} style={{
                background: sevBg[alert.severity],
                border:`1px solid ${sevBd[alert.severity]}`,
                borderRadius:"var(--r2)",marginBottom:10,overflow:"hidden",
              }}>
                {/* Card header — always visible */}
                <div
                  style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",cursor:"pointer"}}
                  onClick={() => setExpandedId(isOpen ? null : alert.id)}
                >
                  <span style={{
                    fontSize:9,fontWeight:700,letterSpacing:".06em",
                    padding:"2px 7px",borderRadius:4,flexShrink:0,
                    background: sevBd[alert.severity],
                    color: sevColor[alert.severity],
                  }}>
                    {sevLabel[alert.severity]}
                  </span>
                  <span style={{fontSize:13,fontWeight:600,color:"var(--t1)",flex:1}}>{alert.title}</span>
                  {affected.length > 0 && (
                    <span style={{
                      fontSize:10,fontWeight:700,fontFamily:"var(--fm)",
                      color:sevColor[alert.severity],flexShrink:0,
                      background:sevBd[alert.severity],
                      padding:"2px 8px",borderRadius:100,
                    }}>
                      ⚠ {affected.length} case{affected.length!==1?"s":""}
                    </span>
                  )}
                  <ChevronDown size={13} color="var(--t3)" style={{flexShrink:0,transform:isOpen?"rotate(180deg)":"none",transition:"transform .2s"}}/>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div style={{padding:"0 14px 14px",borderTop:`1px solid ${sevBd[alert.severity]}`}}>
                    <p style={{fontSize:12,color:"var(--t2)",lineHeight:1.7,margin:"12px 0 10px"}}>{alert.detail}</p>

                    {/* Meta row */}
                    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:12}}>
                      {alert.effective_date && <span>Effective: {alert.effective_date}</span>}
                      {alert.verified_at    && <span>Verified: {alert.verified_at}</span>}
                      {alert.source_url && (
                        <a href={alert.source_url} target="_blank" rel="noopener noreferrer"
                          style={{color:"var(--p)",textDecoration:"underline"}}>
                          Official source →
                        </a>
                      )}
                    </div>

                    {/* Affected cases */}
                    {affected.length > 0 && (
                      <div style={{background:"var(--s2)",borderRadius:"var(--r1)",padding:"10px 12px"}}>
                        <div style={{fontSize:11,fontWeight:700,color:sevColor[alert.severity],marginBottom:8,textTransform:"uppercase",letterSpacing:".05em"}}>
                          ⚠ Affected Cases ({affected.length})
                        </div>
                        {affected.map(c => {
                          const name    = c.profile?.fullName || "Unknown";
                          const country = resolveProfileCountry(c.profile || {}) || "—";
                          const intake  = (() => {
                            const offers = Array.isArray(c.profile?.offerLetters) ? c.profile.offerLetters : [];
                            return offers[0]?.intakeSeason || "—";
                          })();
                          const score   = c.results?.eligibility?.overallScore ?? "—";
                          return (
                            <div key={c.id} style={{
                              display:"flex",alignItems:"center",gap:10,
                              padding:"7px 0",
                              borderBottom:"1px solid var(--bd)",
                            }}>
                              <User size={12} color="var(--t3)" style={{flexShrink:0}}/>
                              <div style={{flex:1}}>
                                <span style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{name}</span>
                                <span style={{fontSize:11,color:"var(--t3)",marginLeft:8,fontFamily:"var(--fm)"}}>
                                  {country} · {intake} · {score}/100
                                </span>
                              </div>
                              <button
                                className="btn-s"
                                style={{fontSize:11,padding:"3px 10px",flexShrink:0}}
                                onClick={() => onOpenCase(c)}
                              >
                                <ArrowUpRight size={11}/>Open
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {affected.length === 0 && (
                      <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>No saved cases currently match this alert.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ─── DASHBOARD ──────────────────────────────────────────────────── */
/* Dashboard component moved to StudentDashboard.jsx */

/* ─── AI CHAT PANEL ──────────────────────────────────────────────── */
function buildChatContext(profileData, results, docs) {
  if (!profileData || !results) return null;
  const p = profileData;
  const e = results.eligibility || {};
  const lines = [
    "=== STUDENT PROFILE (extracted from documents) ===",
    `Name: ${p.fullName||"Not found"}`,
    `DOB: ${p.dob||"Not found"}`,
    `Nationality: ${p.nationality||"Not found"}`,
    `Passport: ${p.passportNumber||"Not found"} (issued ${p.passportIssueDate||"Not found"}, expires ${p.passportExpiry||"Not found"})`,
    `Offer Letters: ${(()=>{const offers=Array.isArray(p.offerLetters)?p.offerLetters:[];return offers.length?offers.map((o,i)=>`${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join(" / "):"None found";})()}`,
    `Target Country (fallback): ${p.targetCountry||"Not found"}`,
    `Highest Qualification: ${p.program||"Not found"} (${p.yearOfPassing||"year unknown"})`,
    `Institution (highest qual): ${p.university||"Not found"}`,
    `Academic Results:\n${p.academicResult||"Not found"}`,
    `Study Gap: ${p.studyGap||"None > 24 months"}`,
    `IELTS: ${p.ieltsScore||"Not found"} | TOEFL: ${p.toeflScore||"Not found"} | PTE: ${p.pteScore||"Not found"}`,
    Array.isArray(p.englishTests) && p.englishTests.length > 0
      ? `English Tests (detailed):\n${p.englishTests.map(et => {
          const subs = et.subScores ? Object.entries(et.subScores).filter(([,v])=>v&&v!=="").map(([k,v])=>`${k}=${v}`).join(", ") : "";
          return `  • ${et.type||"Test"}: ${et.overallScore||"?"}${et.testDate&&et.testDate!=="Not found"?` (${et.testDate})`:""}${et.urn&&et.urn!=="Not found"?` | URN: ${et.urn}`:""}${subs?` | ${subs}`:""}`;
        }).join("\n")}`
      : "",
    `Other English Test/Cert: ${p.otherEnglishTest||"Not found"}`,
    `Medium of Instruction: ${p.mediumOfInstruction||"Not found"}`,
    `Financial Balance: ${p.financialBalance||"Not found"}`,
    `Financial Holder: ${p.financialHolder||"Not found"}`,
    `Funds Required (counsellor-entered): ${p.fundsRequired||"Not entered"}`,
    (()=>{
      if (!p.fundsRequired || !p.financialBalance) return "";
      const avail = parseCurrencyAmount(p.financialBalance);
      const req   = parseCurrencyAmount(p.fundsRequired);
      if (avail.amount === null || req.amount === null) return "Sufficiency: Cannot parse amounts";
      if (avail.currency !== req.currency) return `Sufficiency: Currency mismatch (${avail.currency||"?"} vs ${req.currency||"?"}) — manual verification needed`;
      const diff = avail.amount - req.amount;
      return diff >= 0
        ? `Sufficiency: SUFFICIENT — ${avail.currency} ${avail.amount.toLocaleString()} available vs ${req.amount.toLocaleString()} required (+${diff.toLocaleString()})`
        : `Sufficiency: SHORTFALL — ${avail.currency} ${Math.abs(diff).toLocaleString()} below requirement`;
    })(),
    "",
    "=== ELIGIBILITY SCORES ===",
    `Overall: ${e.overallScore}/100 | Financial: ${e.financialScore}/100 | Academic: ${e.academicScore}/100 | Documents: ${e.documentScore}/100`,
    `Summary: ${e.summary||""}`,
    e.notes?.length ? `Notes: ${e.notes.join("; ")}` : "",
    "",
    "=== MISSING DOCUMENTS ===",
    (results.missingDocuments||[]).map(m=>`- ${m.document}: ${m.reason}`).join("\n") || "None flagged",
    "",
    "=== RED FLAGS ===",
    (results.redFlags||[]).map(f=>`[${f.severity?.toUpperCase()}] ${f.flag} — ${f.detail}`).join("\n") || "None",
    "",
  "=== DETECTED SPECIAL DOCUMENTS ===",
  (profileData?.detectedDocs?.length
  ? profileData.detectedDocs.map(d =>
      `- ${d.type}${d.reference ? ` | Ref: ${d.reference}` : ""}${d.amount ? ` | Amount: ${d.amount}` : ""}${d.date ? ` | Date: ${d.date}` : ""}${d.expiry ? ` | Expiry: ${d.expiry}` : ""}${d.result ? ` | Result: ${d.result}` : ""}${d.institution ? ` | Institution: ${d.institution}` : ""}${d.notes ? ` | Notes: ${d.notes}` : ""}`
    ).join("\n")
  : "None detected"),
  "",   
  "=== NAME MISMATCHES ===",
  (profileData?.nameMismatches?.length
  ? profileData.nameMismatches.map(m =>
      `- ${m.doc}: Found "${m.nameFound}" — ${m.issue}`
    ).join("\n")
  : "None detected"),
  "",
   "=== REJECTIONS / DEFERMENTS ===",
    (results.rejections||[]).map(r=>`${r.type} — ${r.country||""} ${r.university||""} ${r.program||""} (${r.date||"no date"}): ${r.reason||""}`).join("\n") || "None found",
    "",
    "=== UPLOADED DOCUMENTS ===",
    docs.map(d=>`- ${d.renamed||d.file.name} [${d.type}]`).join("\n") || "No docs",
  ];
  return lines.join("\n");
}

const CHAT_SUGGESTIONS = [
  "Does the student meet the IELTS requirement for their offer letter university?",
  "What is the biggest risk factor in this application?",
  "Is the financial proof sufficient for a UK student visa?",
  "Are there any study gaps that could be a visa concern?",
  "What documents are still missing from this application?",
  "Summarise this student's profile in 3 bullet points.",
  "Is the passport valid long enough for the proposed study period?",
  "What counselling advice would you give this student?",
];

function formatBubble(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")  // escape HTML first
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<strong style='font-size:13px;display:block;margin-top:10px'>$1</strong>")
    .replace(/^## (.+)$/gm, "<strong style='font-size:14px;display:block;margin-top:12px'>$1</strong>")
    .replace(/^# (.+)$/gm, "<strong style='font-size:15px;display:block;margin-top:14px'>$1</strong>")
    .replace(/^[-•*]\s+(.+)$/gm, "<div style='display:flex;gap:6px;margin:2px 0'><span>•</span><span>$1</span></div>")
    .replace(/^\d+\.\s+(.+)$/gm, "<div style='display:flex;gap:6px;margin:2px 0'><span style='min-width:16px'>$&</span></div>")
    .replace(/\n\n/g, "<div style='margin-top:8px'></div>")
    .replace(/\n/g, "<br/>");
}

function ChatPanel({ profileData, results, docs, messages, setMessages, onCreditsUpdate }) {
  const [input,       setInput]       = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const hasCtx = profileData && results && Object.keys(profileData).length > 0;
  const ctxString = hasCtx ? buildChatContext(profileData, results, docs) : null;
  const studentName = profileData?.fullName && profileData.fullName !== "Not found" ? profileData.fullName.split(" ")[0] : "the student";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  async function sendMessage(userText) {
    const text = (userText || input).trim();
    if (!text || chatLoading || !hasCtx) return;
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setChatLoading(true);
    try {
      // System prompt is passed via the worker's `system` field so it gets
      // cache_control: ephemeral applied server-side. This caches ctxString
      // (~800–2,000 tokens) across all turns in the session, saving ~90% of
      // input cost on every message after the first.
      const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const systemPrompt = `You are VisaLens AI, an expert student visa counselling assistant. You have been given a fully extracted student profile below — do NOT ask to see documents again; use only the data provided.\n\nToday's date: ${todayStr}. When referencing timelines, deadlines, or dates, use this as the current date.\n\nAnswer counsellor questions concisely and accurately. When referencing requirements (IELTS, GPA, financials), state both the requirement AND the student's actual value. Use "Not found" context to flag gaps. Keep answers under 200 words unless a longer breakdown is genuinely needed.\n\n${ctxString}`;
      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: systemPrompt,          // worker wraps this in cache_control: ephemeral
          messages: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        })),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      if (typeof data.analyses_remaining === "number" && onCreditsUpdate) onCreditsUpdate(data.analyses_remaining);
      const reply = data.content?.map(b => b.text || "").join("") || "(no response)";
      setMessages(p => [...p, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(p => [...p, { role: "assistant", content: `⚠️ Error: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function copyChat() {
    if (!messages.length) return;
    const text = messages.map(m => `${m.role === 'user' ? 'You' : 'VisaLens AI'}:\n${m.content}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function exportChatPDF() {
    if (!messages.length) return;
    const html = `<!DOCTYPE html><html><head><title>Chat History - ${studentName}</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 800px; margin: 40px auto; padding: 20px; }
      h1 { color: #1D6BE8; margin-bottom: 5px; }
      .meta { font-size: 12px; color: #666; margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
      .msg { margin-bottom: 20px; padding: 14px 18px; border-radius: 8px; font-size: 14px; }
      .user { background: #EEF3FB; border-left: 4px solid #1D6BE8; }
      .ai { background: #F8FAFC; border-left: 4px solid #94A3B8; }
      .name { font-weight: 700; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #444; }
      .content { white-space: pre-wrap; }
    </style>
    </head><body>
    <h1>VisaLens AI Chat History</h1>
    <div class="meta">Student: <strong>${profileData?.fullName || "Unknown"}</strong> &nbsp;|&nbsp; Generated on: ${new Date().toLocaleString()}</div>
    ${messages.map(m => `
      <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">
        <div class="name">${m.role === 'user' ? 'Counselor' : 'VisaLens AI'}</div>
        <div class="content">${m.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")}</div>
      </div>
    `).join('')}
    </body></html>`;
    
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
  }

  if (!hasCtx) {
    return (
      <div className="chat-wrap">
        <div className="chat-no-ctx">
          <div className="chat-empty-ico"><MessageSquare size={22} color="var(--p)"/></div>
          <div className="chat-empty-ttl">No analysis loaded</div>
          <div className="chat-empty-sub">Run an analysis first (or load a case from History). The AI assistant uses the extracted profile as its context — no documents are re-read.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
  {/* Add the color class here (e.g., rc-hdr--blue or rc-hdr--purple) */}
  <div className="chat-hdr rc-hdr--purple"> 
    <div className="chat-hdr-ico">
      <MessageSquare size={15} color="#fff"/> {/* Ensure icon is white too */}
    </div>
    <div style={{flex:1}}>
      {/* This is the text that will turn white */}
      <div className="chat-hdr-title">AI Counsellor Chat — {studentName}</div> 
      <div className="chat-hdr-ctx">
        <span className="chat-ctx-pill">
          <CheckCircle size={9} color="#fff"/>
          Profile context loaded
        </span>
      </div>
    </div>
  
        
        {/* NEW BUTTONS HERE */}
        {messages.length > 0 && (
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="btn-s" style={{ height: "28px", padding: "0 10px", fontSize: "11px" }} onClick={copyChat}>
              {copied ? <><Check size={12}/>Copied</> : <><Copy size={12}/>Copy</>}
            </button>
            <button className="btn-s" style={{ height: "28px", padding: "0 10px", fontSize: "11px" }} onClick={exportChatPDF}>
              <Printer size={12}/>Export PDF
            </button>
            <button className="chat-clear-btn" onClick={() => setMessages([])} title="Clear chat history">
              <Trash2 size={12}/>
            </button>
          </div>
        )}
      </div>

      <div className="chat-msgs">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-ico"><MessageSquare size={22} color="var(--p)"/></div>
            <div className="chat-empty-ttl">Ask anything about {studentName}</div>
            <div className="chat-empty-sub">The assistant has the full extracted profile in context. Questions are answered instantly without re-reading documents.</div>
            <div className="chat-chips">
              {CHAT_SUGGESTIONS.map((s, i) => (
                <button key={i} className="chat-chip" onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <div className={`chat-avatar ${m.role}`}>
                  {m.role === "user" ? "You" : <ShieldCheck size={13}/>}
                </div>
                <div
                  className={`chat-bubble ${m.role}`}
                  dangerouslySetInnerHTML={{ __html: formatBubble(m.content) }}
                />
              </div>
            ))}
            {chatLoading && (
              <div className="chat-msg assistant">
                <div className="chat-avatar assistant"><ShieldCheck size={13}/></div>
                <div className="chat-typing">
                  <div className="chat-dot"/><div className="chat-dot"/><div className="chat-dot"/>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </>
        )}
      </div>

      <div className="chat-footer">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={`Ask about ${studentName}'s application…`}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            rows={1}
            disabled={chatLoading}
          />
          <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() || chatLoading}>
            {chatLoading ? <Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/> : <Send size={15}/>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ZIP / FOLDER DOWNLOAD MODAL ────────────────────────────────── */
function ZipModal({ docs, studentName, offerLetters, docTypes, setDocTypes, subTypes, setSubTypes, personTags, setPersonTags, customLabels, setCustomLabels, spouseName, setSpouseName, onClose }) {
  const [name,          setName]          = useState(studentName || "");
  const [zipping,       setZipping]       = useState(false);
  const [done,          setDone]          = useState(false);
  const [error,         setError]         = useState("");
  const [selectedId,    setSelectedId]    = useState(docs[0]?.id || null);
  const [previewSrc,    setPreviewSrc]    = useState(null);
  const [previewKind,   setPreviewKind]   = useState(null);
  const [previewText,   setPreviewText]   = useState("");

  const selectedDoc    = docs.find(d => d.id === selectedId) || docs[0];
  const hasSpouseDocs  = Object.values(personTags).some(p => p === "spouse");

  useEffect(() => {
    if (!selectedDoc) return;
    setPreviewSrc(null); setPreviewText(""); setPreviewKind(null);
    const f = selectedDoc.file;
    if (f.type.startsWith("image/")) {
      setPreviewKind("image");
      const r = new FileReader(); r.onload = () => setPreviewSrc(r.result); r.readAsDataURL(f);
    } else if (f.type === "application/pdf") {
      setPreviewKind("pdf");
    } else {
      setPreviewKind("text");
      const r = new FileReader(); r.onload = () => setPreviewText(r.result.slice(0,2000)); r.readAsText(f);
    }
  }, [selectedId]);

  function safe(s) { return (s||"").trim().replace(/[^\w\s-]/g,"").replace(/\s+/g,"-") || "Unknown"; }

  function ownerPrefix(doc) {
    const p = personTags[doc.id] || "primary";
    if (p === "spouse")  return spouseName.trim() ? safe(spouseName.trim()) : "Spouse";
    if (p === "child")   return `${safe(name||"Student")}-Child`;
    return safe(name || "Student");
  }

  function resolveTypeLabel(doc) {
    const t = docTypes[doc.id] || "other";
    if (t === "other") {
      const custom = (customLabels[doc.id]||"").trim();
      return custom ? custom.replace(/\s+/g,"-").replace(/[^a-zA-Z0-9\-]/g,"") : "Other-Document";
    }
    return getDT(t).label.replace(/\s*\/\s*/g,"-").replace(/\s+/g,"-").replace(/[()]/g,"");
  }

  function buildFilename(doc) {
    const owner     = ownerPrefix(doc);
    const typeLabel = resolveTypeLabel(doc);
    const qualifier = smartQualifier(doc, docs, docTypes, customLabels, offerLetters, subTypes);
    const ext       = (doc.file.name.split(".").pop() || "pdf").toLowerCase();
    return `${owner}-${typeLabel}${qualifier}.${ext}`;
  }

  const finalNames = deduplicateFilenames(docs, buildFilename);

  async function buildZip() {
    if (!name.trim()) { setError("Please enter a student name."); return; }
    if (hasSpouseDocs && !spouseName.trim()) {
      setError("Please enter the spouse's name — some documents are tagged as Spouse."); return;
    }
    setError(""); setZipping(true);
    try {
      const zip        = new JSZip();
      const folderName = `${safe(name)}-${new Date().toISOString().slice(0,10)}`;
      const folder     = zip.folder(folderName);
      for (const doc of docs) {
        const buf = await doc.file.arrayBuffer();
        folder.file(finalNames[doc.id].name, buf);
      }
      const base64  = await zip.generateAsync({ type:"base64" });
      const a       = document.createElement("a");
      a.href = `data:application/zip;base64,${base64}`; a.download = `${folderName}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setDone(true);
    } catch(e) {
      setError("Failed to generate ZIP: " + (e.message||"Unknown error"));
    } finally { setZipping(false); }
  }

  const groupedTypes = DOC_TYPES.reduce((acc, dt) => {
    if (!acc[dt.group]) acc[dt.group] = [];
    acc[dt.group].push(dt);
    return acc;
  }, {});

  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal zip-modal-wide" role="dialog">
        <div className="modal-hdr">
          <div className="rc-ico"><FolderDown size={14}/></div>
          <span className="modal-title">Download Organised Folder</span>
          <button className="btn-ico" onClick={onClose}><X size={14}/></button>
        </div>

        <div className="zip-body">
          <div className="zip-left">
            <div className="zip-section">
              <div className="zip-lbl">Student Name <span style={{color:"var(--err)"}}>*</span></div>
              <input className="zip-input" value={name}
                onChange={e=>{setName(e.target.value);setError("");setDone(false);}}
                placeholder="e.g. Saima Maqbool" autoFocus/>
              {name.trim() && (
                <div className="zip-folder-chip"><FolderOpen size={11}/>
                  {safe(name)}-{new Date().toISOString().slice(0,10)}.zip
                </div>
              )}
            </div>

            {hasSpouseDocs && (
              <div className="zip-section">
                <div className="zip-lbl">Spouse Name <span style={{color:"var(--err)"}}>*</span></div>
                <input className="zip-input" value={spouseName}
                  onChange={e=>{setSpouseName(e.target.value);setError("");}}
                  placeholder="e.g. Ahmed Maqbool"/>
              </div>
            )}

            <div className="zip-section" style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
              <div className="zip-lbl">Documents ({docs.length})</div>
              <div className="zip-doc-list">
                {docs.map(doc => {
                  const isSelected  = doc.id === selectedId;
                  const t           = docTypes[doc.id] || "other";
                  const person      = personTags[doc.id] || "primary";
                  const finalName   = name.trim() ? finalNames[doc.id]?.name : "—";
                  const needsSubType = t === "transcript" || t === "offer_letter";

                  return (
                    <div key={doc.id}
                      className={`zip-doc-row${isSelected?" active":""}`}
                      onClick={()=>setSelectedId(doc.id)}
                    >
                      <div className="zip-doc-meta">
                        <div className="zip-doc-name" title={doc.file.name}>{doc.file.name}</div>
                        <div className="zip-doc-renamed">{finalName}</div>
                      </div>
                      <div className="zip-doc-controls" onClick={e=>e.stopPropagation()}>
                        <div className="zip-person-row">
                          {["primary","spouse","child"].map(p => (
                            <button key={p}
                              className={`zip-person-btn${person===p?" on":""}`}
                              onClick={()=>setPersonTags(prev=>({...prev,[doc.id]:p}))}
                            >{p==="primary"?"Student":p==="spouse"?"Spouse":"Child"}</button>
                          ))}
                        </div>

                        <select className="doc-sel" value={t}
                          onChange={e=>{
                            setDocTypes(p=>({...p,[doc.id]:e.target.value}));
                            setSubTypes(p=>({...p,[doc.id]:""}));
                          }}>
                          {Object.entries(groupedTypes).map(([group, items]) => (
                            <optgroup key={group} label={group}>
                              {items.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                            </optgroup>
                          ))}
                        </select>

                        {t === "transcript" && (
                          <select className="doc-sel zip-subtype-sel"
                            value={subTypes[doc.id]||""}
                            onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}>
                            {TRANSCRIPT_LEVELS.map(l=>(
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </select>
                        )}

                        {t === "offer_letter" && (
                          <input className="zip-custom-label" style={{marginTop:3}}
                            value={subTypes[doc.id]||""}
                            onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}
                            placeholder="University name (e.g. Sheffield)"
                            onClick={e=>e.stopPropagation()}/>
                        )}

                        {t === "other" && (
                          <input className="zip-custom-label"
                            value={customLabels[doc.id]||""}
                            onChange={e=>setCustomLabels(p=>({...p,[doc.id]:e.target.value}))}
                            placeholder="Custom label…"
                            onClick={e=>e.stopPropagation()}/>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {error && <div className="zip-error"><AlertCircle size={13}/>{error}</div>}
            {done  && <div className="zip-success"><CheckCircle size={13}/>Downloaded! Extract ZIP to your student files folder.</div>}

            <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:4}}>
              <button className="btn-s" onClick={onClose}>Cancel</button>
              <button className="btn-p" onClick={buildZip} disabled={zipping||!name.trim()}>
                {zipping
                  ? <><Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/>Building…</>
                  : <><FolderDown size={14}/>{done?"Download Again":"Download ZIP"}</>
                }
              </button>
            </div>
          </div>

          <div className="zip-preview-pane">
            {selectedDoc ? (
              <>
                <div className="zip-preview-hdr"><Eye size={12}/><span>{selectedDoc.file.name}</span></div>
                <div className="zip-preview-content">
                  {previewKind==="image" && previewSrc && (
                    <img src={previewSrc} alt={selectedDoc.file.name} className="zip-preview-img"/>
                  )}
                  {previewKind==="image" && !previewSrc && (
                    <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>
                  )}
                  {previewKind==="pdf" && (
                    <div className="zip-preview-placeholder" style={{padding:24,textAlign:"center"}}>
                      <FileText size={36} color="var(--t3)"/>
                      <div style={{fontSize:12,color:"var(--t2)",marginTop:10,fontWeight:600}}>{selectedDoc.file.name}</div>
                      <div style={{fontSize:11,color:"var(--t3)",marginTop:6,fontFamily:"var(--fm)",lineHeight:1.5}}>PDF preview not available in this environment.<br/>File will be correctly included in the ZIP.</div>
                    </div>
                  )}
                  {previewKind==="text" && (
                    <pre className="zip-preview-text">{previewText||"Loading…"}</pre>
                  )}
                  {!previewKind && (
                    <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>
                  )}
                </div>
              </>
            ) : (
              <div className="zip-preview-placeholder">
                <Eye size={28} color="var(--t3)"/>
                <div style={{fontSize:12,color:"var(--t3)",marginTop:8}}>Click a document to preview</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function smartQualifier(doc, allDocs, docTypes, customLabels, offerLetters, subTypes) {
  const t    = docTypes[doc.id] || "other";
  const same = allDocs.filter(d => (docTypes[d.id]||"other") === t);
  if (same.length < 2) return "";

  const idx = same.indexOf(doc);
  const explicitSub = subTypes ? (subTypes[doc.id]||"").trim() : "";
  if (explicitSub) return `-${explicitSub.replace(/\s+/g,"-")}`;

  const n = doc.file.name.toLowerCase();

  function hasKw(kws) {
    return kws.some(kw => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(n);
    });
  }

  if (t === "transcript") {
    if (hasKw(["phd","doctorate"]))                                          return "-PhD";
    if (hasKw(["mphil"]))                                                    return "-MPhil";
    if (hasKw(["masters","master's","msc","mba","postgrad","postgraduate"])) return "-Masters";
    if (hasKw(["bachelors","bachelor's","bsc","bca","bba","undergrad"]))     return "-Bachelors";
    if (hasKw(["intermediate","fsc","hssc","a-level","a level"]))            return "-Intermediate";
    if (hasKw(["matric","ssc","o-level","o level","secondary school"]))      return "-Matric";
    if (hasKw(["m.a","m.sc"]))                                               return "-Masters";
    if (hasKw(["b.a","b.sc"]))                                               return "-Bachelors";
  }

  if (t === "offer_letter") {
    const offers = Array.isArray(offerLetters) ? offerLetters : [];
    if (offers[idx]?.university) {
      const uni = offers[idx].university
        .replace(/university of /i,"").replace(/university/i,"")
        .trim().split(/\s+/)[0];
      if (uni) return `-${uni}`;
    }
  }

  return `-${idx + 1}`;
}

function deduplicateFilenames(docs, filenameFn) {
  const names  = {};
  const result = {};
  for (const doc of docs) {
    let name = filenameFn(doc);
    if (names[name] === undefined) {
      names[name] = 0;
    } else {
      names[name]++;
    }
    result[doc.id] = { name, collision: false };
  }
  const seen = {};
  for (const doc of docs) {
    const name = result[doc.id].name;
    if (!seen[name]) { seen[name] = []; }
    seen[name].push(doc.id);
  }
  const suffixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const [name, ids] of Object.entries(seen)) {
    if (ids.length > 1) {
      ids.forEach((id, i) => {
        const dot = name.lastIndexOf(".");
        result[id].name = dot > -1
          ? name.slice(0, dot) + `-${suffixes[i]||i+1}` + name.slice(dot)
          : name + `-${suffixes[i]||i+1}`;
      });
    }
  }
  return result;
}
/* ─── RESUME BUILDER ─────────────────────────────────────────────── */
/* ─── SOP BUILDER ────────────────────────────────────────────────── */
// SOPTargetPicker — isolated local state, never writes back to profileData.
// Seeds from the resolved offer letter if one exists, but the counsellor
// can freely override for speculative drafts without corrupting analysis data.
function SOPTargetPicker({ profileData, preferredOfferIndex, requirementsData, onTargetChange }) {
  const resolved    = resolveOffer(profileData, preferredOfferIndex);
  const fromOffer   = !!(resolved.hasOffer && resolved.university);

  const [country,  setCountry]  = useState(resolved.country   || "");
  const [uniName,  setUniName]  = useState(resolved.university || "");
  const [progName, setProgName] = useState("");

  // Re-seed if the parent's preferred offer changes
  useEffect(() => {
    const r = resolveOffer(profileData, preferredOfferIndex);
    setCountry(r.country   || "");
    setUniName(r.university || "");
    setProgName("");
  }, [preferredOfferIndex, profileData]);

  const countries   = Object.keys(requirementsData);
  const countryData = country ? requirementsData[country] : null;
  const unis        = countryData ? Object.keys(countryData.universities) : [];
  const uniData     = (countryData && uniName) ? countryData.universities[uniName] : null;
  const progs       = uniData ? uniData.programs : [];
  const prog        = progName ? (progs.find(p => p.name === progName) || null) : null;

  // Bubble selection up whenever it changes
  useEffect(() => {
    onTargetChange({ country, uniName, progName, prog, uniData, countryData });
  }, [country, uniName, progName]);

  function handleCountryChange(val) { setCountry(val); setUniName(""); setProgName(""); }
  function handleUniChange(val)     { setUniName(val); setProgName(""); }
  function handleReset()            { setCountry(""); setUniName(""); setProgName(""); }

  return (
    <div className="rc rc-purple" style={{marginBottom:0}}>
      <div className="rc-hdr rc-hdr--purple">
        <div className="rc-ico"><Building2 size={14} color="#ffffff"/></div>
        <span className="rc-ttl">Target University</span>
        {fromOffer && country && (
          <span style={{
            marginLeft:6, fontSize:10, fontWeight:600, color:"#ffffff",
            background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.3)",
            borderRadius:"var(--r1)", padding:"2px 7px", display:"flex", alignItems:"center", gap:4,
          }}>
            <CheckCircle size={9} color="#ffffff"/>From offer letter
          </span>
        )}
        {!fromOffer && country && (
          <span style={{
            marginLeft:6, fontSize:10, fontWeight:600, color:"#ffffff",
            background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.3)",
            borderRadius:"var(--r1)", padding:"2px 7px",
          }}>
            Manual selection
          </span>
        )}
        {(country||uniName||progName) && (
          <button onClick={handleReset} title="Clear selection"
            style={{marginLeft:"auto",fontSize:11,fontWeight:600,color:"#ffffff",background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:"var(--r1)",padding:"2px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <RefreshCw size={10} color="#ffffff"/>Clear
          </button>
        )}
      </div>
      <div className="rc-body" style={{paddingTop:8}}>
        {fromOffer && (
          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:"rgba(5,150,105,.05)",border:"1px solid rgba(5,150,105,.15)",borderRadius:"var(--r1)",fontSize:11,color:"#065f46",fontFamily:"var(--fm)",marginBottom:12,lineHeight:1.5}}>
            <Info size={12} style={{flexShrink:0,marginTop:1}}/>
            Pre-filled from the extracted offer letter. You can override the selection below — changes here only affect this SOP draft and will not alter the main analysis.
          </div>
        )}
        <div className="uni-selects">
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">Country</label>
            <select className="uni-select" value={country} onChange={e => handleCountryChange(e.target.value)}>
              <option value="">Select country…</option>
              {countries.map(c => <option key={c} value={c}>{requirementsData[c].flag} {c}</option>)}
            </select>
          </div>
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">University</label>
            <select className="uni-select" value={uniName} onChange={e => handleUniChange(e.target.value)} disabled={!country}>
              <option value="">Select university…</option>
              {unis.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="uni-select-wrap">
            <label className="uni-select-lbl">Programme</label>
            <select className="uni-select" value={progName} onChange={e => setProgName(e.target.value)} disabled={!uniName||!progs.length}>
              <option value="">Select programme…</option>
              {progs.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
        </div>
        {prog && uniData && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
            {[
              {l:"Ranking",    v: uniData.ranking},
              {l:"Duration",   v: prog.duration},
              {l:"IELTS req.", v: `${prog.ielts}`},
              {l:"Financial",  v: `${prog.financial?.toLocaleString()}`},
              {l:"Tuition/yr", v: prog.tuition === 0 ? "Free" : prog.tuition?.toLocaleString()},
            ].map(f => (
              <div key={f.l} style={{fontSize:11,background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",padding:"3px 8px",color:"var(--t2)",fontFamily:"var(--fm)"}}>
                <span style={{color:"var(--t3)"}}>{f.l}: </span><span style={{color:"var(--t1)",fontWeight:600}}>{f.v}</span>
              </div>
            ))}
            {prog.note && (
              <div style={{fontSize:11,background:"rgba(180,83,9,.06)",border:"1px solid rgba(180,83,9,.2)",borderRadius:"var(--r1)",padding:"3px 8px",color:"var(--warn)",fontFamily:"var(--fm)"}}>
                <Info size={10} style={{marginRight:4}}/>{prog.note}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SOPBuilder({ profileData, results, universitySop, visaSop, setUniversitySop, setVisaSop, onSaveSops, preferredOfferIndex, requirementsData }) {
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [copied,    setCopied]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState("");
  const [activeTab, setActiveTab] = useState("university"); // "university" | "visa"
  const [sopVA,     setSopVA]     = useState(universitySop || ""); // University version
  const [sopVB,     setSopVB]     = useState(visaSop || ""); // Visa Intent version
  const [target,    setTarget]    = useState({ country:"", uniName:"", progName:"", prog:null, uniData:null, countryData:null });

  // Sync local state up to parent whenever either SOP changes
  useEffect(() => { setUniversitySop(sopVA); }, [sopVA]);
  useEffect(() => { setVisaSop(sopVB); }, [sopVB]);

  // On load: restore both SOPs from parent (when a case is loaded)
  useEffect(() => {
    if (universitySop && !sopVA) setSopVA(universitySop);
    if (visaSop && !sopVB) setSopVB(visaSop);
  }, []);

  const hasProfile = profileData?.fullName && profileData.fullName !== "Not found";
  const hasTarget  = !!(target.uniName && target.progName);

  // ── Derive English test summary ───────────────────────────────────
  function buildEnglishSummary() {
    const tests = Array.isArray(profileData?.englishTests) ? profileData.englishTests : [];
    if (tests.length) return tests.map(t => `${t.type} ${t.overallScore}${t.testDate && t.testDate !== "Not found" ? ` (${t.testDate})` : ""}`).join(", ");
    const parts = [];
    if (profileData?.ieltsScore && profileData.ieltsScore !== "Not found") parts.push(`IELTS ${profileData.ieltsScore}`);
    if (profileData?.toeflScore && profileData.toeflScore !== "Not found") parts.push(`TOEFL ${profileData.toeflScore}`);
    if (profileData?.pteScore   && profileData.pteScore   !== "Not found") parts.push(`PTE ${profileData.pteScore}`);
    return parts.join(", ") || "Not found";
  }

  // ── Build the student context block sent to the model ────────────
  function buildStudentContext() {
    const p = profileData;
    const prog = target.prog;
    const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = [
      `TODAY'S DATE: ${todayStr}`,
      `CRITICAL: All future dates (graduation, return, employment) MUST be calculated forward from ${todayStr}. Never reference a date in the past as a future event.`,
      "",
      `Student Name: ${p.fullName}`,
      `Nationality: ${p.nationality || "Not found"}`,
      `Academic Background: ${p.academicResult || "Not found"}`,
      `Highest Qualification: ${p.program || "Not found"} at ${p.university || "Not found"} (${p.yearOfPassing || "year unknown"})`,
      `English Proficiency: ${buildEnglishSummary()}`,
      `Study Gap: ${p.studyGap && p.studyGap !== "Not found" ? p.studyGap : "None identified"}`,
      `Financial Balance: ${p.financialBalance || "Not found"}`,
      `Name Mismatches: ${Array.isArray(p.nameMismatches) && p.nameMismatches.length ? p.nameMismatches.map(m => m.issue).join("; ") : "None"}`,
      "",
      `Target University: ${target.uniName || "Not specified"}`,
      `Target Programme: ${target.progName || "Not specified"}`,
      `Target Country: ${target.country || "Not specified"}`,
    ];
    if (prog) {
      lines.push(`Programme Duration: ${prog.duration}`);
      lines.push(`Programme Level: ${prog.level}`);
      lines.push(`IELTS Requirement: ${prog.ielts}`);
      if (prog.note) lines.push(`Programme Note: ${prog.note}`);
    }
    if (target.uniData) {
      lines.push(`University Ranking: ${target.uniData.ranking}`);
    }
    if (results?.eligibility) {
      lines.push(`Eligibility Score: ${results.eligibility.overallScore}/100`);
    }
    const redFlags = results?.redFlags || [];
    if (redFlags.length) {
      lines.push(`Risk Flags: ${redFlags.map(f => `[${f.severity}] ${f.flag}`).join("; ")}`);
    }
    return lines.join("\n");
  }

  // ── System prompts — static so worker can cache them ─────────────
  const SOP_SYSTEM_UNIVERSITY = `You are a senior UK/international student visa SOP strategist with 15 years of experience. Write a 950-1050 word Statement of Purpose strictly following the structure below. Output plain text only — no markdown, no headers with hashes, no bullet points, no introductory or concluding filler text outside the SOP itself.

CRITICAL DATE RULE: The student data includes TODAY'S DATE. Every future event (graduation, return home, starting a job) must be dated AFTER today. Never write a return or graduation date that has already passed. If you are unsure of the intake season, write "upon completion of the programme" rather than inventing a specific month or year.

MANDATORY STRUCTURE (use these exact section headings on their own line):

THE HOOK
One compelling paragraph (120-150 words). Open with a specific professional moment, observation, or problem — not a generic statement about passion. No quotes. Establish exactly what field you are entering and why now.

ACADEMIC JOURNEY
One paragraph (180-200 words). Do not list qualifications — narrate the academic arc. Reference the highest qualification and relevant modules or capstone projects. If a study gap exists in the data, frame it as intentional professional development (min 80 words on this if gap > 24 months). If no gap, use this space to deepen academic narrative.

PROFESSIONAL PIVOT
One paragraph (170-190 words). Identify the specific skill gap that only postgraduate study can fill. Connect current experience or academic knowledge to what the programme uniquely offers. Be concrete about what cannot be learned on the job.

WHY THIS PROGRAMME · WHY THIS UNIVERSITY · WHY THIS COUNTRY
One paragraph (260-300 words). Mandatory: name at least two specific modules or research areas from this exact programme. Mandatory: name one specific faculty strength, research centre, or industry partnership of this university. Mandatory: contrast this country's offering with at least one alternative (home country or USA) to show genuine comparative research.

CAREER ROADMAP
One paragraph (130-150 words). Short-term goal: specific role within 12 months of graduation. Long-term goal: 5-10 year vision in the home country's context. The long-term goal must be grounded in the home country's industry landscape.

FINANCIAL AND PERSONAL COMMITMENT
One paragraph (120-140 words). State financial readiness without specific figures (e.g. "fully funded through family savings and a verified bank balance"). Mention home ties that motivate return — family, property, professional network, or career opportunity — without being sentimental. End with one sentence of genuine commitment.

TONE: British English. Formal but human. Analytical, not promotional. Evidence-based. First person throughout. Never use the phrases "prestigious institution", "world-class", "since childhood", "always dreamed", or "passion for".`;

  const SOP_SYSTEM_VISA = `You are a senior UK/international student visa SOP strategist specialising in Genuine Student compliance. Write a 900-1000 word Statement of Purpose optimised for the visa officer, not the admissions committee. Output plain text only — no markdown, no headers with hashes, no bullet points, no introductory or concluding filler text outside the SOP itself.

CRITICAL DATE RULE: The student data includes TODAY'S DATE. Every future event (graduation, return home, starting a job) must be dated AFTER today. Never write a return or graduation date that has already passed. If you are unsure of the intake season, write "upon completion of the programme" rather than inventing a specific month or year.

MANDATORY STRUCTURE (use these exact section headings on their own line):

PURPOSE OF STUDY
One paragraph (150-170 words). State clearly what programme you are undertaking, at which institution, and why this specific qualification is necessary for your stated career. Avoid generic praise. Every sentence must be verifiable or logical.

ACADEMIC AND PROFESSIONAL BACKGROUND
One paragraph (180-200 words). Demonstrate that you are academically capable of completing this programme. Reference specific results. If a study gap exists, dedicate 80-100 words to explaining it as a deliberate, productive period — employment, family responsibility, or professional development. Be specific and consistent with any supporting documents.

FINANCIAL CAPABILITY
One paragraph (120-140 words). State that funds are in place and have been maintained for the required period. Reference the sponsorship source (self, family, scholarship) without revealing specific amounts. Confirm awareness of the full cost including tuition, living, and IHS. Show this is not a financial stretch.

WHY THIS SPECIFIC PROGRAMME ABROAD
One paragraph (200-220 words). Explain why this qualification cannot be obtained to the same standard in your home country. Reference specific limitations of the home country's provision in this field. Name one or two unique aspects of the target university or country that make it the only logical choice.

TIES TO HOME COUNTRY AND INTENTION TO RETURN
One paragraph (200-220 words). This is the most important section for the visa officer. Be explicit and concrete: name the family members you will return to, the career opportunity waiting, the professional network established, the property or business interest. Avoid vague statements. The officer must be able to picture your life at home that you are returning to.

POST-STUDY PLANS
One paragraph (120-140 words). Describe your first role after returning home. Name the sector, the type of employer, the function. Reference any job market data or industry trend that makes this role realistic. Do not mention any intention to work in the host country after graduation.

TONE: British English. Formal and direct. Written as a legal declaration, not a personal essay. First person. No emotional appeals. Every claim must sound verifiable. Never use vague language like "I hope to", "I plan to explore", or "I believe".`;

  async function generateSOP(version) {
    if (!hasProfile) {
      setError("Student profile is empty. Please analyse a document or load a case first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const systemPrompt = version === "university" ? SOP_SYSTEM_UNIVERSITY : SOP_SYSTEM_VISA;
      const studentContext = buildStudentContext();
      const versionNote = version === "university"
        ? "Write the UNIVERSITY ADMISSIONS version of the SOP. Optimise for the admissions committee."
        : "Write the VISA INTENT version of the SOP. Optimise for the visa officer. Prioritise Genuine Student compliance and home-tie reinforcement.";

      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: `${versionNote}\n\nStudent Data:\n${studentContext}` }],
        }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      const text = data.content?.map(b => b.text || "").join("") || "";
      if (version === "university") { setSopVA(text); setActiveTab("university"); }
      else                          { setSopVB(text); setActiveTab("visa"); }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function printSOP(text, version) {
    const w = window.open("", "_blank");
    if (!w) return;
    const label = version === "university" ? "University Admissions SOP" : "Visa Intent SOP";
    w.document.write(`<html><head><title>${profileData.fullName || "Student"} — ${label}</title>
    <style>body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.8;color:#111;max-width:800px;margin:40px auto;padding:20px;white-space:pre-wrap;font-size:14px;}</style>
    </head><body>${text.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 250);
  }

  function copyText(text) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function clearAll() {
    if (window.confirm("Clear both SOP drafts?")) { setSopVA(""); setSopVB(""); setSop(""); }
  }

  const activeText = activeTab === "university" ? sopVA : sopVB;
  const setActiveText = activeTab === "university" ? setSopVA : setSopVB;
  const hasBoth = sopVA && sopVB;

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>

      {/* ── University Target Picker ── */}
      <SOPTargetPicker
        profileData={profileData}
        preferredOfferIndex={preferredOfferIndex}
        requirementsData={requirementsData}
        onTargetChange={setTarget}
      />

      {/* ── Main SOP Card ── */}
      <div className="rc rc-purple">
        <div className="rc-hdr rc-hdr--purple">
          <div className="rc-ico"><BookOpen size={14} color="#ffffff"/></div>
          <span className="rc-ttl">AI SOP Builder</span>
          {(sopVA||sopVB) && (
            <span style={{marginLeft:6,fontSize:10,fontWeight:600,color:"#ffffff",background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:"var(--r1)",padding:"2px 7px"}}>
              Saves with case
            </span>
          )}
        </div>
        <div className="rc-body">

          {/* ── No profile warning ── */}
          {!hasProfile && (
            <div className="err-banner" style={{marginBottom:16}}>
              <AlertCircle size={14}/>
              No student profile loaded. Analyse a document or load a case from History first.
            </div>
          )}

          {/* ── University target warning ── */}
          {hasProfile && !hasTarget && (
            <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:"rgba(180,83,9,.05)",border:"1px solid rgba(180,83,9,.2)",borderRadius:"var(--r1)",fontSize:11,color:"var(--warn)",fontFamily:"var(--fm)",marginBottom:16,lineHeight:1.5}}>
              <Info size={12} style={{flexShrink:0,marginTop:1}}/>
              Select a university and programme above for the best SOP — specific modules and ranking will be injected automatically. You can still generate without a selection.
            </div>
          )}

          {/* ── Action toolbar ── */}
          <div className="toolbar" style={{justifyContent:"flex-start",marginBottom:16,gap:8,flexWrap:"wrap"}}>
            <button className="btn-p btn-generate" style={{width:"auto",padding:"0 14px"}} onClick={() => generateSOP("university")} disabled={loading||!hasProfile}>
              {loading && activeTab==="university"
                ? <><Loader2 size={14} style={{animation:"spin 1s linear infinite"}}/>Drafting…</>
                : <><FileText size={14}/>{sopVA?"Regenerate":"Generate"} University SOP</>
              }
            </button>
            <button className="btn-p btn-generate" style={{width:"auto",padding:"0 14px"}} onClick={() => generateSOP("visa")} disabled={loading||!hasProfile}>
              {loading && activeTab==="visa"
                ? <><Loader2 size={13} style={{animation:"spin 1s linear infinite"}}/>Drafting…</>
                : <><ShieldCheck size={13}/>{sopVB?"Regenerate":"Generate"} Visa Intent SOP</>
              }
            </button>
            {(sopVA||sopVB) && (
              <>
                <button className="btn-s" onClick={() => copyText(activeText)} disabled={!activeText}>
                  {copied ? <><Check size={13}/>Copied!</> : <><Copy size={13}/>Copy</>}
                </button>
                <button className="btn-s" onClick={() => printSOP(activeText, activeTab)} disabled={!activeText}>
                  <Printer size={13}/>Print / PDF
                </button>
                <button className="btn-danger" onClick={clearAll}>
                  <Trash2 size={13}/>Clear All
                </button>
                <button className="btn-p" style={{width:"auto",padding:"0 14px",marginLeft:"auto"}} onClick={async () => { await onSaveSops(); setSaveMsg("Saved ✓"); setTimeout(()=>setSaveMsg(""),2500); }}>
                  <Save size={13}/>Save to Case
                </button>
              </>
            )}
          </div>

          {saveMsg && <div style={{fontSize:12,color:"var(--ok)",fontFamily:"var(--fm)",marginBottom:8,display:"flex",alignItems:"center",gap:5}}><Check size={12}/>{saveMsg}</div>}

          {error && <div className="err-banner" style={{margin:"0 0 16px 0"}}><AlertCircle size={14}/>{error}</div>}

          {/* ── Empty state ── */}
          {!sopVA && !sopVB && !loading && (
            <div className="empty" style={{padding:"48px 20px"}}>
              <BookOpen size={36} color="var(--t3)" style={{margin:"0 auto 10px"}}/>
              <div className="empty-ttl">No SOP drafted yet</div>
              <div className="empty-sub">
                Choose a university above, then generate either version.<br/>
                <strong>University SOP</strong> — optimised for the admissions committee.<br/>
                <strong>Visa Intent SOP</strong> — optimised for the visa officer, Genuine Student compliant.
              </div>
            </div>
          )}

          {/* ── Version tabs + editor ── */}
          {(sopVA||sopVB) && (
            <>
              {/* Version switcher */}
              <div style={{display:"flex",gap:0,marginBottom:14,border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden",width:"fit-content"}}>
                {[
                  {key:"university", label:"University SOP", icon:<FileText size={12}/>, has:!!sopVA},
                  {key:"visa",       label:"Visa Intent SOP", icon:<ShieldCheck size={12}/>, has:!!sopVB},
                ].map(v => (
                  <button key={v.key} onClick={() => setActiveTab(v.key)}
                    style={{
                      display:"flex",alignItems:"center",gap:5,
                      padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",border:"none",
                      background: activeTab===v.key ? "var(--p)" : "var(--s2)",
                      color: activeTab===v.key ? "#fff" : "var(--t2)",
                      transition:"background .15s",
                    }}>
                    {v.icon}
                    {v.label}
                    {v.has && <span style={{width:6,height:6,borderRadius:"50%",background:activeTab===v.key?"rgba(255,255,255,.6)":"var(--ok)",flexShrink:0}}/>}
                  </button>
                ))}
              </div>

              {/* Word count */}
              {activeText && (
                <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:6}}>
                  {activeText.trim().split(/\s+/).filter(Boolean).length} words
                  {hasBoth && <span style={{marginLeft:12,color:"var(--t3)"}}>· Generate both versions, then Save to Case</span>}
                </div>
              )}

              {/* Editor */}
              {activeText ? (
                <textarea
                  className="notes-area"
                  style={{minHeight:"640px",fontFamily:"var(--fu)",fontSize:"14px",lineHeight:1.8}}
                  value={activeText}
                  onChange={e => setActiveText(e.target.value)}
                  placeholder="SOP text will appear here…"
                />
              ) : (
                <div className="empty" style={{padding:"32px 20px",minHeight:200}}>
                  <div className="empty-sub">This version hasn't been generated yet. Click the button above.</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResumeBuilder({ profileData, results, resume, setResume, onSaveResume }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function generateResume() {
    if (!profileData || !profileData.fullName || profileData.fullName === "Not found") {
      setError("Student profile is empty. Please analyse a document or load a case first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Static template instructions → system (cached). Dynamic student data → user message.
      const RESUME_SYSTEM = `You are a professional resume writer specialising in international student applications. Your output will be used by a visa consultant and edited further — write content that is accurate, specific, and easy to customise. Output raw text only — no markdown code blocks, no triple backticks, no introductory or concluding text outside the resume itself.

CRITICAL RULES:
- Use only information explicitly provided. Never invent a phone number, email, company name, or specific achievement.
- Where information is missing, write a clear editorial placeholder in [square brackets] so the consultant knows exactly what to fill in. Example: [Insert phone number] or [Insert LinkedIn URL].
- All dates must be after TODAY'S DATE provided in the student data. Never write a past date as a future event.
- The Professional Summary must reference the target programme and university if provided — this is the single biggest quality improvement you can make.
- Skills must be derived from the student's field of study and qualifications — not generic. A CS student gets technical skills. A business student gets analytical/management skills. Do not mix them up.
- The Education section must list ALL qualifications found in academicResult in reverse chronological order (most recent first).
- If the study gap field describes a period of work or professional activity, write a structured Experience entry for it with placeholder bullets. If there is genuinely no work experience, write the placeholder message.
- Never use the phrase "results-driven", "dynamic professional", "passionate about", or "detail-oriented".

REQUIRED FORMAT (follow spacing exactly):

[STUDENT FULL NAME IN CAPS]
[Nationality] National | DOB: [Date of Birth]
Phone: [phone or INSERT PLACEHOLDER] | Email: [email or INSERT PLACEHOLDER] | LinkedIn: [INSERT PLACEHOLDER]

─────────────────────────────────────────────
PROFESSIONAL SUMMARY
─────────────────────────────────────────────
[3-4 sentences. Sentence 1: current academic level and field. Sentence 2: specific skills or strengths relevant to target programme. Sentence 3: career direction tied to target programme/university if provided. Sentence 4: English proficiency and readiness for postgraduate study abroad. Be specific, not generic.]

─────────────────────────────────────────────
EDUCATION
─────────────────────────────────────────────
[For EACH qualification in reverse chronological order:]
[Degree / Programme Name] | [Year of Completion]
[Institution Name]
Grade / Result: [Result]

─────────────────────────────────────────────
CORE COMPETENCIES
─────────────────────────────────────────────
[3-column layout, 6-9 bullet points total. Derive from field of study:]
• [Field-specific technical or analytical skill]    • [Transferable skill]    • [Tool or methodology]
• [Field-specific skill]                            • [Research or soft skill] • [Additional strength]
• [Field-specific skill]                            • [Communication/language]

─────────────────────────────────────────────
PROFESSIONAL EXPERIENCE
─────────────────────────────────────────────
[If study gap describes work or professional activity:]
[Job Title — be specific based on gap description]                    [Start Year – End Year]
[Company / Organisation Name — use placeholder if unknown]
• [Key responsibility relevant to target field — use placeholder if specifics unknown]
• [Achievement or contribution — quantify if possible, otherwise use placeholder]
• [Additional responsibility or learning outcome]

[If no work experience identified:]
[This section requires input from the student. Please add relevant work experience, internships, volunteer work, or freelance projects here.]

─────────────────────────────────────────────
ENGLISH LANGUAGE PROFICIENCY
─────────────────────────────────────────────
[List each test on its own line:]
[Test Name]: [Overall Score] (Listening: [L] | Reading: [R] | Writing: [W] | Speaking: [S]) — [Test Date if available]

─────────────────────────────────────────────
ADDITIONAL INFORMATION
─────────────────────────────────────────────
• Passport Validity: [Expiry date if provided, else INSERT PLACEHOLDER]
• Target Programme: [Programme name and university if provided, else omit this line]
• [Any other relevant detail from the profile — financial readiness, medium of instruction if English, rejection history if relevant to explain gap, etc. Add only what is substantiated by the data.]`;

      const englishTestsSummary = Array.isArray(profileData.englishTests) && profileData.englishTests.length > 0
        ? profileData.englishTests.map(t =>
            `${t.type}: ${t.overallScore}${t.testDate ? ` (${t.testDate})` : ""}` +
            (t.subScores ? ` — L:${t.subScores.listening||"?"} R:${t.subScores.reading||"?"} W:${t.subScores.writing||"?"} S:${t.subScores.speaking||"?"}` : "")
          ).join("\n")
        : [
            profileData.ieltsScore && profileData.ieltsScore !== "Not found" ? `IELTS: ${profileData.ieltsScore}` : null,
            profileData.toeflScore && profileData.toeflScore !== "Not found" ? `TOEFL: ${profileData.toeflScore}` : null,
            profileData.pteScore   && profileData.pteScore   !== "Not found" ? `PTE: ${profileData.pteScore}`   : null,
          ].filter(Boolean).join("\n") || "Not found";

      const offerSummary = Array.isArray(profileData.offerLetters) && profileData.offerLetters.length > 0
        ? profileData.offerLetters.map(o =>
            `${o.status} offer — ${o.program || "Programme not specified"} at ${o.university || "University not specified"}, ${o.country || ""} (${o.intakeSeason || "intake not specified"})`
          ).join("\n")
        : "No offer letter on file";

      const studentData = `TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
All future dates must fall after this date. Do not reference any past date as a future event.

=== STUDENT PROFILE ===
Full Name: ${profileData.fullName}
Date of Birth: ${profileData.dob || "Not found"}
Nationality: ${profileData.nationality || "Not found"}
Passport Number: ${profileData.passportNumber || "Not found"}
Passport Expiry: ${profileData.passportExpiry || "Not found"}

=== QUALIFICATIONS (academicResult field — list ALL of these in Education section) ===
${profileData.academicResult || "Not found"}

Highest Qualification Title: ${profileData.program || "Not found"}
Institution: ${profileData.university || "Not found"}
Year of Completion: ${profileData.yearOfPassing || "Not found"}

=== STUDY GAP ===
${profileData.studyGap && profileData.studyGap !== "Not found" ? profileData.studyGap : "No study gap identified"}

=== ENGLISH PROFICIENCY ===
${englishTestsSummary}
Medium of Instruction: ${profileData.mediumOfInstruction || "Not specified"}

=== TARGET / OFFER ===
${offerSummary}

=== FINANCIAL ===
Available Funds: ${profileData.financialBalance || "Not found"}
Sponsor: ${profileData.financialHolder || "Not specified"}

=== RISK FLAGS (for context only — do not include in resume) ===
${(results?.redFlags || []).map(f => `[${f.severity}] ${f.flag}`).join("\n") || "None"}`;

      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: RESUME_SYSTEM,         // cached by worker via cache_control: ephemeral
          messages: [{ role: "user", content: studentData }],
        }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      setResume(data.content?.map(b => b.text || "").join("") || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function printResume() {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><head><title>${profileData.fullName || "Student"} - Resume</title>
      <style>body{font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #111; max-width: 800px; margin: 40px auto; padding: 20px; white-space: pre-wrap;}</style>
      </head><body>${resume.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
  }

  function copyResume() {
    if (!resume) return;
    navigator.clipboard.writeText(resume);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function clearResume() {
    if (window.confirm("Are you sure you want to clear this resume draft?")) {
      setResume("");
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <div className="rc rc-purple">
        <div className="rc-hdr rc-hdr--purple">
          <div className="rc-ico"><FileText size={14} color="#ffffff"/></div>
          <span className="rc-ttl">AI Resume Builder</span>
        </div>
        <div className="rc-body">
          <div className="toolbar" style={{ justifyContent: "flex-start", marginBottom: 16, gap: "8px", flexWrap: "wrap" }}>
            <button className="btn-p btn-generate" style={{ width: "auto", padding: "0 16px" }} onClick={generateResume} disabled={loading}>
              {loading ? <Loader2 size={14} style={{animation:"spin 1s linear infinite"}}/> : <FileText size={14}/>}
              {loading ? "Drafting Resume..." : resume ? "Regenerate Resume" : "Generate Resume"}
            </button>
            
            {resume && (
              <>
                <button className="btn-s" onClick={copyResume}>
                  {copied ? <><Check size={13}/> Copied!</> : <><Copy size={13}/> Copy Text</>}
                </button>
                <button className="btn-s" onClick={printResume}>
                  <Printer size={13}/> Print / PDF
                </button>
                <button className="btn-danger" onClick={clearResume}>
                  <Trash2 size={13}/> Clear
                </button>
                <button className="btn-p" style={{width:"auto",padding:"0 14px",marginLeft:"auto"}} onClick={async () => { await onSaveResume(); setSaveMsg("Saved ✓"); setTimeout(()=>setSaveMsg(""),2500); }}>
                  <Save size={13}/> Save to Case
                </button>
              </>
            )}
          </div>
          
          {saveMsg && <div style={{fontSize:12,color:"var(--ok)",fontFamily:"var(--fm)",marginBottom:8,display:"flex",alignItems:"center",gap:5}}><Check size={12}/>{saveMsg}</div>}
          
          {error && <div className="err-banner" style={{ margin: "0 0 16px 0" }}><AlertCircle size={14}/>{error}</div>}
          
          {!resume && !loading && !error && (
            <div className="empty" style={{ padding: "48px 20px" }}>
              <FileText size={36} color="var(--t3)" style={{marginBottom:10, margin:"0 auto"}}/>
              <div className="empty-ttl">No Resume Drafted</div>
              <div className="empty-sub">Click the button above to generate a professional resume based on the extracted student profile.</div>
            </div>
          )}

          {resume && (
            <textarea
              className="notes-area"
              style={{ minHeight: "600px", fontFamily: "var(--fu)", fontSize: "14px" }}
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="Resume text will appear here..."
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── ORG STATUS BAR ─────────────────────────────────────────────── */
function OrgStatusBar({ orgSession, orgCredits, onRefresh, onLogout }) {
  const [refreshing, setRefreshing] = useState(false);
  if (!orgSession) return null;

  const credits = orgCredits ?? orgSession.analyses_remaining ?? 0;
  const total   = orgSession.analyses_total || 0;
  const pct     = total > 0 ? Math.round((credits / total) * 100) : 100;

  const creditColor =
    credits <= 10  ? "var(--err)"  :
    credits <= 50  ? "var(--warn)" :
    "var(--t3)";

  const planLabel = (orgSession.plan || "starter").charAt(0).toUpperCase() +
                    (orgSession.plan || "starter").slice(1);

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  return (
    <div className="org-status-bar">
      <div className="org-status-inner">
        <div className="org-status-left">
          <div className="org-status-dot"/>
          <span className="org-status-name">{orgSession.org_name}</span>
          <span className="org-status-sep">·</span>
          <span className="org-status-plan">{planLabel}</span>
        </div>
        <div className="org-status-center">
          <div className="org-credits-bar-track">
            <div className="org-credits-bar-fill" style={{
              width: `${Math.min(pct, 100)}%`,
              background: creditColor,
            }}/>
          </div>
          <span className="org-status-credits" style={{ color: creditColor }}>
            {credits.toLocaleString()} analyses remaining
          </span>
        </div>
        <div className="org-status-right">
          <button
            className="org-status-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh analysis balance"
          >
            <RefreshCw size={11} style={{ animation: refreshing ? "spin .7s linear infinite" : "none" }}/>
          </button>
          <button
            className="org-status-btn org-status-btn--signout"
            onClick={onLogout}
            title="Sign out"
          >
            <X size={11}/>
            <span>Sign out</span>
          </button>
    </div>
      </div>
    </div>
  );
}

/* ─── PERSON CLARIFICATION UI ────────────────────────────────────── */
const RELATION_OPTIONS = [
  { value: "student",  label: "Student",         emoji: "🎓", color: "#1D6BE8", bg: "rgba(29,107,232,.1)"  },
  { value: "father",   label: "Father",           emoji: "👨", color: "#059669", bg: "rgba(5,150,105,.1)"   },
  { value: "mother",   label: "Mother",           emoji: "👩", color: "#059669", bg: "rgba(5,150,105,.1)"   },
  { value: "spouse",   label: "Spouse",           emoji: "💍", color: "#7C3AED", bg: "rgba(124,58,237,.1)"  },
  { value: "sibling",  label: "Sibling",          emoji: "👫", color: "#B45309", bg: "rgba(180,83,9,.1)"    },
  { value: "child",    label: "Child",            emoji: "🧒", color: "#0284C7", bg: "rgba(2,132,199,.1)"   },
  { value: "other",    label: "Other / Unknown",  emoji: "👤", color: "#94A3B8", bg: "rgba(148,163,184,.1)" },
  { value: "unknown",  label: "Unknown — Exclude",emoji: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.1)"   },
];

// Relations whose data must NEVER contribute to the student profile
const EXCLUDED_RELATIONS = new Set(["unknown", "other"]);

/* ─── ANALYSIS READINESS CHECK ───────────────────────────────────── */
const PRIORITY_TYPES_SET = new Set([
  "passport", "bank_statement", "financial_proof", "offer_letter",
  "transcript", "degree_certificate", "language_test", "cas",
  "birth_certificate", "domicile", "family_reg_cert", "marriage_reg_cert"
]);

function AnalysisReadinessCheck({ docs, docTypes, selection, onSelectionChange, onConfirm, onCancel }) {
  const THRESHOLD = 3.8 * 1024 * 1024;
  const selectedDocs   = docs.filter(d => !d.tooLarge && selection.has(d.id));
  const unselectedDocs = docs.filter(d => !d.tooLarge && !selection.has(d.id));
  const selectedSize   = selectedDocs.reduce((s, d) => s + d.file.size, 0);
  const pct            = Math.min((selectedSize / THRESHOLD) * 100, 100);
  const overLimit      = selectedSize > THRESHOLD;
  const fmtMB          = b => (b / 1024 / 1024).toFixed(1);

  function toggle(id) {
    onSelectionChange(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const barColor = overLimit ? "#DC2626" : pct > 80 ? "#B45309" : "#059669";

  return (
    <div className="prescan-wrap">
      <div className="prescan-header">
        <div className="prescan-icon"><BarChart3 size={18} color="#1D6BE8"/></div>
        <div>
          <div className="prescan-title">Document Size Limit — Select Files for Analysis</div>
          <div className="prescan-sub">
            Total upload exceeds the 3.8MB analysis limit. Core documents have been pre-selected. Adjust which documents to include, then confirm.
          </div>
        </div>
      </div>

      {/* Size meter */}
      <div style={{margin:"0 0 14px",padding:"10px 14px",background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
          <span style={{fontWeight:600,color:"var(--t1)"}}>Selected size</span>
          <span style={{fontWeight:700,color:barColor}}>{fmtMB(selectedSize)} / 3.8 MB</span>
        </div>
        <div style={{height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:3,transition:"width 200ms"}}/>
        </div>
        {overLimit && (
          <div style={{marginTop:6,fontSize:11,color:"#DC2626",fontFamily:"var(--fm)"}}>
            ⚠️ Selection is over the limit — deselect some documents before confirming.
          </div>
        )}
      </div>

      {/* In — selected docs */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--t3)",marginBottom:6}}>
          Included in analysis ({selectedDocs.length})
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {selectedDocs.map(doc => {
            const t = docTypes[doc.id] || doc.type || "other";
            const isCore = PRIORITY_TYPES_SET.has(t);
            return (
              <div key={doc.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(5,150,105,.06)",border:"1px solid rgba(5,150,105,.2)",borderRadius:"var(--r1)",cursor:"pointer"}} onClick={() => toggle(doc.id)}>
                <CheckCircle size={13} color="#059669" style={{flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{doc.renamed||doc.file.name}</div>
                  <div style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)"}}>{getDT(t).label} · {fmtMB(doc.file.size)}MB · <span style={{color:isCore?"#059669":"var(--t3)",fontWeight:isCore?700:400}}>{isCore?"Core":"Supporting"}</span></div>
                </div>
                <X size={11} color="var(--t3)" style={{flexShrink:0}}/>
              </div>
            );
          })}
        </div>
      </div>

      {/* Out — excluded docs */}
      {unselectedDocs.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--t3)",marginBottom:6}}>
            Not included ({unselectedDocs.length}) — click to add
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {unselectedDocs.map(doc => {
              const t = docTypes[doc.id] || doc.type || "other";
              const wouldFit = selectedSize + doc.file.size <= THRESHOLD;
              return (
                <div key={doc.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",cursor:wouldFit?"pointer":"not-allowed",opacity:wouldFit?1:.5}} onClick={() => wouldFit && toggle(doc.id)} title={wouldFit?"":"Adding this file would exceed the size limit"}>
                  <div style={{width:13,height:13,borderRadius:"50%",border:"1.5px solid var(--bd)",flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{doc.renamed||doc.file.name}</div>
                    <div style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)"}}>{getDT(t).label} · {fmtMB(doc.file.size)}MB{!wouldFit?" · too large to add":""}</div>
                  </div>
                  <Plus size={11} color="var(--t3)" style={{flexShrink:0}}/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="prescan-footer">
        <button className="btn-s" onClick={onCancel}>Cancel</button>
        <button
          className="btn-p"
          style={{flex:1,maxWidth:280}}
          disabled={overLimit || selectedDocs.length === 0}
          onClick={onConfirm}
        >
          <ShieldCheck size={14}/>Analyse {selectedDocs.length} Document{selectedDocs.length!==1?"s":""}
        </button>
      </div>
    </div>
  );
}

function PersonClarificationUI({ preScanData, onConfirm, onSkip, loading, onRemoveDocs }) {
  const [people, setPeople] = useState(() =>
    (preScanData?.people || []).map(p => ({
      ...p,
      relation: (p.suggestedRelation === "other" || !p.suggestedRelation) ? "unknown" : p.suggestedRelation,
    }))
  );

  const triggerReasons = preScanData?.triggerReasons || [];
  const studentCount  = people.filter(p => p.relation === "student").length;
  const hasStudent    = studentCount >= 1;
  const multiStudent  = studentCount > 1;
  // Two-student scenario: both marked as students — counsellor must pick one to analyse now
  const twoStudents   = multiStudent;

  function setRelation(idx, val) {
    setPeople(prev => prev.map((p, i) => i === idx ? { ...p, relation: val } : p));
  }

  const relMeta = r => RELATION_OPTIONS.find(o => o.value === r) || RELATION_OPTIONS[RELATION_OPTIONS.length - 1];

  // Determine if an unknown person spans a multi-person file (shared with student docs)
  // by checking if any of their files also appear in the student's file list
  const studentFiles = new Set(
    people.filter(p => p.relation === "student").flatMap(p => (p.files || []).map(f => f.toLowerCase()))
  );
  function isSharedFile(person) {
    return (person.files || []).some(f => studentFiles.has(f.toLowerCase()));
  }

  const [mergedIndices, setMergedIndices] = useState(new Set());

  function handleConfirm() {
    if (mergedIndices.size === 0) { onConfirm(people); return; }
    const studentIdx = people.findIndex(p => p.relation === "student");
    const merged = people.map((p, i) => {
      if (i === studentIdx) {
        const extraFiles = [...mergedIndices]
          .flatMap(mi => people[mi].files || [])
          .filter(f => !(p.files || []).includes(f));
        return { ...p, files: [...(p.files || []), ...extraFiles] };
      }
      return p;
    }).filter((_, i) => !mergedIndices.has(i));
    onConfirm(merged);
  }

  return (
    <div className="prescan-wrap">
      <div className="prescan-header">
        <div className="prescan-icon"><Users size={18} color="#1D6BE8"/></div>
        <div>
          <div className="prescan-title">
            {twoStudents
              ? `${studentCount} Students Detected — Pick One to Analyse`
              : `${people.length} ${people.length === 1 ? "Person" : "People"} Found — Confirm Relationships`
            }
          </div>
          <div className="prescan-sub">
            {twoStudents
              ? "Documents from two different students were detected. Mark one as \"Student\" and the other as \"Unknown — Exclude\", then confirm. Each student should be analysed in a separate session."
              : "AI identified each person's documents. Confirm who is the student and who are supporting parties — then click Confirm & Analyse."
            }
          </div>
        </div>
      </div>

      {/* ── Why did this UI fire? ── */}
      {triggerReasons.length > 0 && (
        <div style={{
          margin: "0 0 12px",
          padding: "8px 12px",
          background: "rgba(29,107,232,.06)",
          border: "1px solid rgba(29,107,232,.2)",
          borderRadius: "var(--r1)",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}>
          <Info size={13} color="#1D6BE8" style={{ flexShrink: 0, marginTop: 1 }}/>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1D6BE8", marginBottom: 3 }}>
              Why am I seeing this?
            </div>
            <div style={{ fontSize: 11, color: "var(--t2)", fontFamily: "var(--fm)", lineHeight: 1.5 }}>
              {triggerReasons.join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div className="prescan-people">
        {people.map((person, idx) => {
          const meta      = relMeta(person.relation);
          const isFirst   = idx === 0;
          const isExcluded = EXCLUDED_RELATIONS.has(person.relation);
          const shared    = isExcluded && isSharedFile(person);
          const canRemove = isExcluded && !shared && (person.files || []).length > 0;

          return (
            <div key={idx} className={`prescan-card${person.relation === "student" ? " prescan-card--student" : ""}${isExcluded ? " prescan-card--excluded" : ""}${mergedIndices.has(idx) ? " prescan-card--merged" : ""}`}>
              <div className="prescan-card-top">
                <div className="prescan-avatar" style={{ background: meta.bg, color: meta.color }}>
                  {meta.emoji}
                </div>
                <div className="prescan-card-info">
                  <div className="prescan-name">{person.name || "Unknown"}</div>
                  {person.identifiers && (
                    <div className="prescan-identifiers">{person.identifiers}</div>
                  )}
                  {person.richnessScore > 0 && (
                    <div className="prescan-score">
                      <span style={{ background: meta.bg, color: meta.color, borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>
                        {person.richnessScore} doc pts
                      </span>
                      {isFirst && <span className="prescan-likely-badge">★ Most likely student</span>}
                    </div>
                  )}
                </div>
                <div className="prescan-relation-wrap">
                  <div className="prescan-relation-label">Relation</div>
                  <select
                    className="prescan-relation-sel"
                    value={person.relation}
                    onChange={e => setRelation(idx, e.target.value)}
                    style={{ borderColor: meta.color, color: meta.color }}
                  >
                    {RELATION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Same-person merge banner ── */}
              {!isFirst && person.relation !== "student" && (isSharedFile(person) || mergedIndices.has(idx)) && (
                <div style={{
                  marginTop: 8, padding: "8px 10px",
                  background: mergedIndices.has(idx) ? "rgba(5,150,105,.06)" : "rgba(29,107,232,.06)",
                  border: `1px solid ${mergedIndices.has(idx) ? "rgba(5,150,105,.3)" : "rgba(29,107,232,.2)"}`,
                  borderRadius: "var(--r1)", display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Info size={13} color={mergedIndices.has(idx) ? "#059669" : "#1D6BE8"} style={{flexShrink:0}}/>
                  <div style={{flex:1, fontSize:11, color:"var(--t2)", fontFamily:"var(--fm)", lineHeight:1.5}}>
                    {mergedIndices.has(idx)
                      ? <strong style={{color:"#059669"}}>✓ Merged into student — their files will be analysed together</strong>
                      : "Looks like this could be the same person as the student (shared documents detected)."
                    }
                  </div>
                  {!mergedIndices.has(idx) && (
                    <button
                      style={{fontSize:11,fontWeight:700,color:"#1D6BE8",background:"rgba(29,107,232,.1)",border:"1px solid rgba(29,107,232,.25)",borderRadius:"var(--r1)",padding:"3px 10px",cursor:"pointer",whiteSpace:"nowrap"}}
                      onClick={() => setMergedIndices(prev => new Set([...prev, idx]))}
                    >
                      → Same person
                    </button>
                  )}
                  {mergedIndices.has(idx) && (
                    <button
                      style={{fontSize:11,fontWeight:600,color:"var(--t3)",background:"transparent",border:"1px solid var(--bdr)",borderRadius:"var(--r1)",padding:"3px 10px",cursor:"pointer"}}
                      onClick={() => setMergedIndices(prev => { const s = new Set(prev); s.delete(idx); return s; })}
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}

              {person.files?.length > 0 && (
                <div className="prescan-files">
                  {person.files.map((f, j) => (
                    <span key={j} className="prescan-file-pill">{f}</span>
                  ))}
                  {person.pagesFound?.length > 0 && (
                    <span className="prescan-file-pill" style={{
                      background: "rgba(29,107,232,.08)",
                      color: "var(--t3)",
                      fontStyle: "italic",
                    }}>
                      {person.pagesFound.length} page{person.pagesFound.length !== 1 ? "s" : ""} scanned
                    </span>
                  )}
                </div>
              )}

              {/* ── Unknown/excluded person actions ── */}
              {isExcluded && (
                <div style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  background: "rgba(220,38,38,.06)",
                  border: "1px solid rgba(220,38,38,.2)",
                  borderRadius: "var(--r1)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}>
                  <XCircle size={13} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }}/>
                  <div style={{ flex: 1 }}>
                    {shared ? (
                      <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, marginBottom: 3 }}>
                        Data from this person is inside a shared document
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, marginBottom: 3 }}>
                        This person's documents will be excluded from analysis
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--t2)", fontFamily: "var(--fm)", lineHeight: 1.4 }}>
                      {shared
                        ? "Their personal, academic and English test data will be explicitly excluded from the student profile. Only financial data may be used if they are a confirmed sponsor."
                        : "Their identity, academic records and English test scores will not be used. Remove their document to prevent any data from being sent to the AI."}
                    </div>
                    {canRemove && (
                      <button
                        style={{
                          marginTop: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#fff",
                          background: "#DC2626",
                          border: "none",
                          borderRadius: "var(--r1)",
                          padding: "4px 12px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                        onClick={() => {
                          onRemoveDocs(person.files || []);
                          setPeople(prev => prev.filter((_, i) => i !== idx));
                        }}
                      >
                        <Trash2 size={11}/>Remove {person.files.length === 1 ? "document" : `${person.files.length} documents`} from analysis
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {twoStudents && (
        <div className="prescan-warn" style={{background:"rgba(180,83,9,.06)",borderColor:"rgba(180,83,9,.25)",color:"var(--warn)"}}>
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1, color:"var(--warn)" }}/>
          <span><strong>Two students detected.</strong> Each student must be analysed in a separate session. Mark one as "Student" and set the other to "Unknown — Exclude" to continue. Their documents will not mix.</span>
        </div>
      )}

      {!hasStudent && !twoStudents && (
        <div className="prescan-warn">
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }}/>
          <span>No one is marked as "Student". At least one person must be the student.</span>
        </div>
      )}

      <div className="prescan-footer">
        <button
          className="btn-s"
          onClick={onSkip}
          disabled={loading}
          title="Skip person identification and run analysis with current document tags"
        >
          Skip — Analyse as-is
        </button>
        <button
          className="btn-p"
          style={{ flex: 1, maxWidth: 280 }}
          disabled={!hasStudent || (twoStudents && mergedIndices.size === 0) || loading}
      onClick={handleConfirm}
        >
          {loading
            ? <><Loader2 size={14} style={{ animation: "spin .7s linear infinite" }}/>Analysing…</>
            : <><ShieldCheck size={14}/>Confirm &amp; Analyse</>
          }
        </button>
      </div>
    </div>
  );
}

/* ─── MAIN APP ───────────────────────────────────────────────────── */

// ── Summary columns (no heavy blobs) ─────────────────────────────────────────
const CASE_PAGE_SIZE = 10;
const CASE_SUMMARY_COLS = "id, case_serial, created_at, updated_at, status_updated_at, student_name, counsellor_name, assigned_to, overall_score, target_country, preferred_offer_index, application_targets, lead_status, expiry_date, expiry_doc_type, referral_source, payment_status";

function _mapSummaryRow(r) {
  return {
    id:                  r.id,
    caseSerial:          r.case_serial || null,
    savedAt:             r.created_at,
    updatedAt:           r.updated_at,
    statusUpdatedAt:     r.status_updated_at || r.updated_at || r.created_at,
    studentName:         r.student_name || "",
    student_name:        r.student_name || "",
    counsellorName:      r.counsellor_name || "",
    assigned_to:         r.assigned_to     || null,
    overallScore:        r.overall_score || 0,
    targetCountry:       r.target_country || "",
    preferredOfferIndex: r.preferred_offer_index || 0,
    applicationTargets:  Array.isArray(r.application_targets) ? r.application_targets : [],
    leadStatus:          r.lead_status || "None",
    expiryDate:          r.expiry_date || null,
    expiryDocType:       r.expiry_doc_type || null,
    referralSource:      r.referral_source || 'Direct',
    paymentStatus:       r.payment_status || 'Unpaid',
    fromSupabase:        true,
    _summaryOnly:        true,
  };
}

// ── _applyCaseScope ───────────────────────────────────────────────────────────
// Adds the correct row-level filter to a Supabase cases query based on the
// caller's role, mirroring the caseScope() logic in the worker:
//   org_owner / branch_manager / senior_counsellor → all cases in org (org_id)
//   counsellor / viewer                            → only their own (created_by)
// branch_manager scoping to branch_id is enforced by RLS on the DB side;
// the client filter is defence-in-depth only.
function _applyCaseScope(query, session) {
  const role = session?.role;
  if (role === 'counsellor' || role === 'viewer') {
    // Cases this member created OR has been assigned to (handles reassignments)
    return query.or(`created_by.eq.${session.member_id},assigned_to.eq.${session.member_id}`);
  }
  // org_owner, branch_manager, senior_counsellor → whole org
  return query.eq('org_id', session.org_id);
}

// ── loadCasesFromSupabase ─────────────────────────────────────────────────────
// Loads summary-only columns for the 10 most recent cases.
// Full case data is fetched on demand when a counsellor opens a case.
async function loadCasesFromSupabase() {
  const session = getOrgSession();
  if (!session?.org_id) return [];
  try {
    let query = supabase
      .from("cases")
      .select(CASE_SUMMARY_COLS)
      .order("created_at", { ascending: false })
      .range(0, CASE_PAGE_SIZE - 1);
    query = _applyCaseScope(query, session);
    const { data, error } = await query;
    if (error) { console.error("Supabase load error:", error); return []; }
    return (data || []).map(_mapSummaryRow);
  } catch (e) { console.error("Supabase load error:", e); return []; }
}

// ── loadMoreCases ─────────────────────────────────────────────────────────────
// Fetches the next page of summary rows. page=1 → rows 11-20, page=2 → 21-30…
// Returns { cases, hasMore }
async function loadMoreCases(page = 1) {
  const session = getOrgSession();
  if (!session?.org_id) return { cases: [], hasMore: false };
  try {
    const from = page * CASE_PAGE_SIZE;
    const to   = from + CASE_PAGE_SIZE - 1;
    let query = supabase
      .from("cases")
      .select(CASE_SUMMARY_COLS)
      .order("created_at", { ascending: false })
      .range(from, to);
    query = _applyCaseScope(query, session);
    const { data, error } = await query;
    if (error) { console.error("Supabase paginate error:", error); return { cases: [], hasMore: false }; }
    const cases = (data || []).map(_mapSummaryRow);
    return { cases, hasMore: cases.length === CASE_PAGE_SIZE };
  } catch (e) { console.error("Supabase paginate error:", e); return { cases: [], hasMore: false }; }
}

// ── loadFullCase ──────────────────────────────────────────────────────────────
// Fetches the single complete row for a case. Called when counsellor opens a case.
async function loadFullCase(id) {
  const session = getOrgSession();
  if (!session?.org_id) return null;
  try {
    let query = supabase
      .from("cases")
      .select("*")
      .eq("id", id);
    query = _applyCaseScope(query, session);
    const { data: r, error } = await query.single();
    if (error) { console.error("Supabase full-load error:", error); return null; }
    return {
      id:                  r.id,
      caseSerial:          r.case_serial || null,
      savedAt:             r.created_at,
      updatedAt:           r.updated_at,
      statusUpdatedAt:     r.status_updated_at || r.updated_at || r.created_at,
      studentName:         r.student_name || "",
      student_name:        r.student_name || "",
      profile:             r.profile_data,
      results:             r.results,
      notes:               r.notes || "",
      sopText:             r.sop_text || "",
      universitySop:       r.university_sop || "",
      visaSop:             r.visa_sop || "",
      resumeText:          r.resume_text || "",
      preferredOfferIndex: r.preferred_offer_index || 0,
      counsellorName:      r.counsellor_name || "",
      overallScore:        r.overall_score || 0,
      targetCountry:       r.target_country || "",
      applicationTargets:  Array.isArray(r.application_targets) ? r.application_targets : [],
      leadStatus:          r.lead_status || "None",
      referralSource:      r.referral_source || 'Direct',
      paymentStatus:       r.payment_status || 'Unpaid',
      fromSupabase:        true,
      _summaryOnly:        false,
    };
  } catch (e) { console.error("Supabase full-load error:", e); return null; }
}



// ── searchCases ───────────────────────────────────────────────────────────────
// Server-side search across student_name, case_serial, counsellor_name.
// Returns summary rows — full case still fetched on open.
async function searchCases(term = "") {
  const session = getOrgSession();
  if (!session?.org_id) return [];
  const t = term.trim();
  if (!t) return loadCasesFromSupabase();
  try {
    let query = supabase
      .from("cases")
      .select(CASE_SUMMARY_COLS)
      .or(`student_name.ilike.%${t}%,case_serial.ilike.%${t}%,counsellor_name.ilike.%${t}%`)
      .order("created_at", { ascending: false })
      .limit(CASE_PAGE_SIZE);
    query = _applyCaseScope(query, session);
    const { data, error } = await query;
    if (error) { console.error("Supabase search error:", error); return []; }
    return (data || []).map(_mapSummaryRow);
  } catch (e) { console.error("Supabase search error:", e); return []; }
}

async function deleteCaseFromSupabase(id) {
  const session = getOrgSession();
  if (!session?.org_id) return;
  try { await supabase.from('cases').delete().eq('id', id).eq('org_id', session.org_id); }
  catch (e) { console.error('Supabase delete error:', e); }
}

async function countCasesInSupabase() {
  const session = getOrgSession();
  if (!session?.org_id) return 0;
  try {
    let query = supabase
      .from("cases")
      .select("id", { count: "exact", head: true });
    query = _applyCaseScope(query, session);
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  } catch (e) { return 0; }
}

// Fetch ALL cases with an expiry_date set — lightweight, used only for
// HomeDashboard expiry alert counts (not limited to the 10-case page).
// Fetch ALL cases, backfill expiry_date from profile_data where missing (same logic
// as ExpiryRadarPage), return lightweight { id, expiryDate } objects for the
// HomeDashboard alert counts. Runs on mount so counts are accurate without
// requiring the user to visit Expiry Radar first.
async function loadExpiryAlertsFromSupabase() {
  const session = getOrgSession();
  if (!session?.org_id) return [];
  try {
    let query = supabase
      .from("cases")
      .select("id, expiry_date, profile_data");
    query = _applyCaseScope(query, session);
    const { data, error } = await query;
    if (error) return [];

    const rows = data || [];

    // Backfill rows missing expiry_date but having profile_data
    const needsBackfill = rows.filter(r => !r.expiry_date && r.profile_data);
    if (needsBackfill.length > 0) {
      const updates = needsBackfill.map(r => {
        const profile = typeof r.profile_data === "string"
          ? JSON.parse(r.profile_data) : r.profile_data;
        const { expiry_date, expiry_doc_type } = computeSoonestExpiry(profile?.expiryDates || {}, profile);
        return { id: r.id, expiry_date, expiry_doc_type };
      }).filter(u => u.expiry_date);

      // Write back to Supabase silently
      await Promise.all(updates.map(u =>
        supabase.from("cases")
          .update({ expiry_date: u.expiry_date, expiry_doc_type: u.expiry_doc_type })
          .eq("id", u.id)
          .eq("org_id", session.org_id)
      ));

      // Merge backfilled dates into the in-memory rows array
      updates.forEach(u => {
        const row = rows.find(r => r.id === u.id);
        if (row) row.expiry_date = u.expiry_date;
      });
    }

    return rows
      .filter(r => r.expiry_date)
      .map(r => ({ id: r.id, expiryDate: r.expiry_date }));
  } catch { return []; }
}

function VisaLensApp({ orgSession, onLogout }) {

  // ── callGeminiInsight: Gemini 3.1 Flash Lite text suggestions for child components ──
  // Used by RadarMatrix hover insights. Calls the gemini-insight worker route —
  // no credit deduction, logs to usage_log with endpoint:'micro_action'.
  // Returns plain text string directly.
  async function callGeminiInsight(prompt, caseId) {
    await refreshTokenIfNeeded();
    const resp = await fetch(PROXY_URL, {
      method:  'POST',
      headers: getAuthHeaders(),
      body:    JSON.stringify(withOrg({
        action:  'gemini-insight',
        prompt,
        ...(caseId && { case_id: caseId }),
      })),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `Proxy error ${resp.status}`);
    return data.text || '';
  }

  const [tab,               setTab]               = useState("home");
  const [isAdminUnlocked,   setIsAdminUnlocked]   = useState(false);
  const [sidebarOpen,       setSidebarOpen]        = useState(true);
  const [docPanelOpen,      setDocPanelOpen]       = useState(true);
  const [chatMessages,      setChatMessages]       = useState([]);
  const [chatOpen,          setChatOpen]           = useState(false);
  const [analyzerSideTab,   setAnalyzerSideTab]    = useState("personal");
  const [orgCredits,        setOrgCredits]         = useState(orgSession?.analyses_remaining ?? null);
  const [resumeText,        setResumeText]         = useState("");
  const [sopText,           setSopText]            = useState("");
  const [universitySop,     setUniversitySop]      = useState("");
  const [visaSop,           setVisaSop]            = useState("");
  const [docs,              setDocs]              = useState([]);
  const [qualities,         setQualities]         = useState({});
  const [preview,           setPreview]           = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [results,           setResults]           = useState(null);
  const [profileData,       setProfileData]       = useState({});
  const [notes,             setNotes]             = useState("");
  const [savedMsg,          setSavedMsg]          = useState("");
  const [error,             setError]             = useState("");
  const [dragOver,          setDragOver]          = useState(false);
  const [cases,             setCases]             = useState([]);
  const [totalCases,        setTotalCases]        = useState(0);
  const [lastSaved,         setLastSaved]         = useState(null);
  const [expiryAlerts,      setExpiryAlerts]      = useState([]);
  const [searchQuery,       setSearchQuery]       = useState("");
  const [searchResults,     setSearchResults]     = useState(null);
  const [searchLoading,     setSearchLoading]     = useState(false);
  const [renameSuggestion,  setRenameSuggestion]  = useState("");
  const [showReport,        setShowReport]        = useState(false);
  const [showZip,           setShowZip]           = useState(false);
  const [darkMode,          setDarkMode]          = useState(false);
  const [customRequirements,setCustomRequirements] = useState(null);
  const [reqsCsvText,       setReqsCsvText]       = useState("");
  const [preScanData,       setPreScanData]        = useState(null);   // { people: [{name, relation, files, richnessScore, identifiers}] }
  const [preScanLoading,    setPreScanLoading]     = useState(false);
  const [analysedDocIds,    setAnalysedDocIds]     = useState(new Set()); // IDs of docs already analysed
  const [readinessModal,    setReadinessModal]     = useState(false);   // show AnalysisReadinessCheck modal
  const [readinessSelection,setReadinessSelection] = useState(new Set()); // doc IDs selected for analysis
  const [preferredOfferIndex, setPreferredOfferIndex] = useState(0);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState(null); // used for ProgramMatcher "jump"
  const [leadStatus, setLeadStatus] = useState("None");
  const [applicationTargets, setApplicationTargets] = useState([]);
  // Auto-seed from session: full_name is the authoritative field from the RBAC login
  // response. counsellor_name is a legacy fallback for older access-code sessions.
  const [counsellorName, setCounsellorName] = useState(
    () => orgSession?.full_name || orgSession?.counsellor_name || ""
  );
  const [caseListPage,  setCaseListPage]  = useState(0);
  const [hasMoreCases,  setHasMoreCases]  = useState(true);
  const [docTypes,      setDocTypes]      = useState({});
  const [subTypes,      setSubTypes]      = useState({});
  const [personTags,    setPersonTags]    = useState({});
  const [customLabels,  setCustomLabels]  = useState({});
  const [docDepOpen,    setDocDepOpen]    = useState({});
  const [spouseName,    setSpouseName]    = useState("");
  const [profileDirty,      setProfileDirty]      = useState(false);
  const [expiryDates,       setExpiryDates]       = useState({});
  const [expiryDirty,       setExpiryDirty]       = useState(false);
  const [reassessing,       setReassessing]       = useState(false);
  const [liveElig,          setLiveElig]          = useState(null);
  const [confirmOverwrite,  setConfirmOverwrite]  = useState(false); // show overwrite warning before analyse
  const [convertingPdfs,   setConvertingPdfs]    = useState(new Set()); // doc IDs currently being converted to images
  const [driveConnected,    setDriveConnected]    = useState(hasDriveToken);
  const [driveImporting,    setDriveImporting]    = useState(false);
  const [driveSaving,       setDriveSaving]       = useState(false);
  const [driveSaveResult,   setDriveSaveResult]   = useState(null);
  const [policyAlerts,      setPolicyAlerts]      = useState([]);
  const [inboxUnread,       setInboxUnread]       = useState(0);
  const [chatUnread,        setChatUnread]        = useState(0);
  const [calendarDate,      setCalendarDate]      = useState(null);
  const [orgMembers,        setOrgMembers]        = useState([]); // active profiles for counsellor dropdowns

  // ── App-level floating chat tray (persists across tab changes) ────────
  // Each entry: { caseId: string, studentName: string, minimised: bool }
  // Max 3 panels. Opening the same case un-minimises it rather than duplicating.
  const [openChats, setOpenChats] = useState([]);
  const [peekOpen,  setPeekOpen]  = useState(false);

  function openChat(caseId, studentName) {
    setOpenChats(prev => {
      const existing = prev.find(c => c.caseId === caseId);
      if (existing) {
        // Already open — just un-minimise it
        return prev.map(c => c.caseId === caseId ? { ...c, minimised: false } : c);
      }
      const next = [...prev, { caseId, studentName, minimised: false }];
      return next.slice(-3); // keep max 3, drop oldest
    });
  }
  // Register into module-level bridge so any component can call chatBridge.open()
  chatBridge.open = openChat;

  function closeChat(caseId) {
    setOpenChats(prev => prev.filter(c => c.caseId !== caseId));
  }

  function toggleChatMinimise(caseId) {
    setOpenChats(prev => prev.map(c => c.caseId === caseId ? { ...c, minimised: !c.minimised } : c));
  }
  // ─────────────────────────────────────────────────────────────────────
  const fileRef = useRef();
  const autoSaveTimer = useRef(null);
  const resultsRef = useRef(null);
  const qualitiesRef = useRef({});
  const preScanRunning = useRef(false);

// ─── INSERT NEW REALTIME SYNC BRIDGE HERE ──────────────────────────
useEffect(() => {
  if (!activeCaseId || !orgSession?.org_id) return;

  console.log(`🔌 Initializing Realtime sync for Case: ${activeCaseId}`);

  const channel = supabase
    .channel(`active-case-sync-${activeCaseId}`) // Note: added ID to channel name for uniqueness
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'cases',
        filter: `id=eq.${activeCaseId}`,
      },
      (payload) => {
        const updatedRow = payload.new;
        console.log("⚡ Realtime Update Received:", updatedRow);

        // Update local profileData so the UI reflects DB changes instantly
        // Only update from profile_data column to avoid corrupting with raw DB column names
        if (updatedRow.profile_data) {
          setProfileData((prev) => ({ ...prev, ...updatedRow.profile_data }));
        }

        // Update results if the AI background worker finished a re-assessment
        if (updatedRow.results) {
          setResults(updatedRow.results);
        }
      }
    )
    .subscribe();

  return () => {
    console.log("🔌 Closing Realtime channel");
    supabase.removeChannel(channel);
  };
}, [activeCaseId, orgSession?.org_id]);
// ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      Object.entries(DARK_VARS).forEach(([k,v]) => root.style.setProperty(k,v));
      document.body.classList.add("dm");
    } else {
      Object.keys(DARK_VARS).forEach(k => root.style.removeProperty(k));
      document.body.classList.remove("dm");
    }
  }, [darkMode]);

  useEffect(() => {
    (async () => { try { await window.storage.set("visalens_v14_dark", darkMode?"1":"0"); } catch {} })();
  }, [darkMode]);

  useEffect(() => {
    if (!profileDirty || !results) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try { await window.storage.set("visalens_v14_profile", JSON.stringify(profileData)); } catch {}
    }, 2000);
    return () => clearTimeout(autoSaveTimer.current);
  }, [profileData, profileDirty]);

  useEffect(() => {
    if (!results || !profileDirty) { setLiveElig(null); return; }
    const p = profileData;

    // ── Document score — unified formula (same as DocChecklist + MAIN_PROMPT) ──
    const docResult = computeDocScore(p, results);
    const docScore  = docResult.score;

    let finScore = results.eligibility.financialScore;
    if (p.financialBalance && p.fundsRequired) {
      const avail = parseCurrencyAmount(p.financialBalance);
      const req   = parseCurrencyAmount(p.fundsRequired);
      if (avail.amount !== null && req.amount !== null && avail.currency === req.currency) {
        const ratio = avail.amount / req.amount;
        finScore = ratio >= 1.1 ? 90 : ratio >= 1.0 ? 75 : ratio >= 0.8 ? 45 : 25;
      }
    }
    let acadScore = results.eligibility.academicScore;
    const gpa = parseGPA(p.academicResult || "");
    if (gpa !== null) {
      acadScore = gpa >= 3.5 ? 95 : gpa >= 3.0 ? 80 : gpa >= 2.5 ? 60 : 40;
    }
    const ielts = parseIELTS(p.ieltsScore || "");
    if (ielts !== null) {
      acadScore = Math.round((acadScore + (ielts >= 7.0 ? 95 : ielts >= 6.5 ? 80 : ielts >= 6.0 ? 65 : 50)) / 2);
    }
    const overallScore = Math.round(docScore * 0.3 + finScore * 0.35 + acadScore * 0.35);
    setLiveElig({ ...results.eligibility, overallScore, financialScore: finScore, academicScore: acadScore, documentScore: docScore, _liveComputed: true });
  }, [profileData, profileDirty, results]);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("visalens_v14_profile");
        if (r && r.value && results) {
          const saved = JSON.parse(r.value);
          setProfileData(saved); setProfileDirty(true);
        }
      } catch {}
    })();
  }, [results]);
 useEffect(() => {
  (async () => {
    // ── Restore Supabase auth session so RLS policies see the correct auth.uid() ──
    // The app authenticates via the worker which returns access_token + refresh_token.
    // Without this, the Supabase JS client makes requests as anon and RLS blocks everything.
    try {
      const _s = (() => { try { const r = sessionStorage.getItem("visalens_org_session"); return r ? JSON.parse(r) : null; } catch { return null; } })();
      if (_s?.access_token && _s?.refresh_token) {
        await supabase.auth.setSession({
          access_token:  _s.access_token,
          refresh_token: _s.refresh_token,
        });
      }
    } catch (e) { console.warn('[Auth] setSession failed:', e); }

    const remoteCases = await loadCasesFromSupabase();
    const total = await countCasesInSupabase();
    setTotalCases(total);
    const alerts = await loadExpiryAlertsFromSupabase();
    setExpiryAlerts(alerts);
    if (remoteCases.length > 0) {
      setCases(remoteCases);
    } else {
      try {
        const r = await window.storage.get("visalens_v14");
        if (r) { const parsed = JSON.parse(r.value); setCases(Array.isArray(parsed) ? parsed : []); }
      } catch {}
    }
    // Load requirements CSV — Supabase first (org-wide), fall back to localStorage
    try {
      const session = getOrgSession();
      let csvText = null;
      if (session?.org_id) {
        try {
          const { data: orgData, error: orgErr } = await supabase
            .from('organizations')
            .select('requirements_csv')
            .eq('id', session.org_id)
            .single();
          // 406 means column not yet added to DB — silently fall through to localStorage
          if (!orgErr && orgData?.requirements_csv) csvText = orgData.requirements_csv;
        } catch (_) { /* column not present — use localStorage fallback below */ }
      }
      if (!csvText) {
        const r = await window.storage.get("visalens_v14_reqs");
        if (r && r.value) csvText = r.value;
      }
      if (csvText) {
        const rows = parseCSV(csvText);
        if (rows.length) { setCustomRequirements(csvToRequirements(rows)); setReqsCsvText(csvText); }
      }
    } catch {}
    try {
      const r = await window.storage.get("visalens_v14_dark");
      if (r && r.value === "1") setDarkMode(true);
    } catch {}
    // Fetch live policy alerts from Supabase (new org-scoped schema)
    try {
      const _orgSession = (() => { try { const r = sessionStorage.getItem("visalens_org_session"); return r ? JSON.parse(r) : null; } catch { return null; } })();
      if (_orgSession?.org_id) {
        const { data } = await supabase
          .from('policy_alerts')
          .select('id, affected_countries, title, detail, severity, created_at, expires_at, source_url, org_id')
          .eq('org_id', _orgSession.org_id)
          .eq('is_active', true)
          .neq('status', 'archived')
          .order('created_at', { ascending: false });
        setPolicyAlerts((data || []).filter(a => {
          if (a.expires_at && new Date(a.expires_at) < new Date()) return false;
          return true;
        }).sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return (order[a.severity] ?? 1) - (order[b.severity] ?? 1);
        }));

        // Load inbox unread count for sidebar badge
        try {
          const inboxRes = await authedFetch(`${PROXY_URL}/api/inbox/alerts?unread=true&limit=200`, {}, supabase);
          if (inboxRes.ok) {
            const inboxData = await inboxRes.json();
            setInboxUnread((inboxData.alerts || []).filter(a => !a.is_read).length);
          }
        } catch {}
      }
    } catch {}
  })();
  preloadDriveScripts();
  // Fetch active org members for counsellor dropdowns (analyzer + reassign)
  (async () => {
    try {
      const _s = (() => { try { const r = sessionStorage.getItem("visalens_org_session"); return r ? JSON.parse(r) : null; } catch { return null; } })();
      if (_s?.org_id) {
        const { data } = await supabase.from('profiles').select('id, full_name').eq('org_id', _s.org_id).eq('is_active', true);
        if (data) setOrgMembers(data);
      }
    } catch {}
  })();
}, []);

/* ── Chat unread count — queries chat_messages vs chat_reads ─────────
   Counts messages the current counsellor hasn't read yet: newer than
   their last_read_at per case, sent by someone else.
   Re-runs on tab change so the badge clears promptly after they open
   the Dashboard and view a thread.                                    */
useEffect(() => {
  async function loadChatUnread() {
    try {
      const s = JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null');
      if (!s?.org_id || !s?.member_id) return;

      // 1. This counsellor's last-read timestamp per case
      const { data: reads } = await supabase
        .from('chat_reads')
        .select('case_id, last_read_at')
        .eq('member_id', s.member_id);
      const readMap = Object.fromEntries((reads || []).map(r => [r.case_id, r.last_read_at]));

      // 2. Recent messages sent by others (not self)
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, case_id, created_at')
        .eq('org_id', s.org_id)
        .eq('is_deleted', false)
        .neq('sender_id', s.member_id)
        .order('created_at', { ascending: false })
        .limit(500);

      // 3. Count those newer than last_read_at
      const unreadCount = (msgs || []).filter(m => {
        const lastRead = readMap[m.case_id];
        return !lastRead || new Date(m.created_at) > new Date(lastRead);
      }).length;

      setChatUnread(unreadCount);
    } catch { /* fail silently — badge stays at 0 */ }
  }
  loadChatUnread();
}, [tab]);

async function persist(u) { try { await window.storage.set("visalens_v14", JSON.stringify(u)); } catch {} }

// ── generateCaseSerial ────────────────────────────────────────────────────────
// Calls the increment_case_seq RPC (atomic, race-safe) then assembles the serial.
// Requires migration.sql to have been run in Supabase first.
async function generateCaseSerial(orgId, orgName, studentName, targetCountry) {
  const now     = new Date();
  const dateStr = _isoDate(now);
  const pgDate  = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
  let seq = "0001";
  try {
    const { data, error } = await supabase.rpc("increment_case_seq", {
      p_org_id:   orgId,
      p_seq_date: pgDate,
    });
    if (!error && data != null) {
      seq = String(data).padStart(4, "0");
    } else {
      console.warn("increment_case_seq failed, using timestamp fallback:", error);
      seq = String(Date.now()).slice(-4);
    }
  } catch (e) {
    console.warn("increment_case_seq threw:", e);
    seq = String(Date.now()).slice(-4);
  }
  const orgSlug = _slugify(orgName, 6);
  const cc      = COUNTRY_ISO2[targetCountry] || "XX";
  const ini     = _initials(studentName, 3);
  return `${orgSlug}-${cc}-${dateStr}-${ini}${seq}`;
}

// ── saveCaseToSupabase ────────────────────────────────────────────────────────
// Returns { id, caseSerial } on success, null on failure.
async function saveCaseToSupabase(profile, res, docList, notesText, prefIdx, counsellor, sopText, uniSop, visaSop, resumeText, applicationTargets = [], leadStatus = "None") {
  const session = getOrgSession();
  if (!session?.org_id) return null;
  try {
    const resolved = resolveOffer(profile, prefIdx);
    // Primary target country takes precedence over offer/profile country
    const primaryTarget = Array.isArray(applicationTargets) ? applicationTargets[0] : null;
    const primaryCountry = primaryTarget
      ? (primaryTarget.countryOther || primaryTarget.country || "")
      : "";
    const country = primaryCountry || resolved.country || profile.targetCountry || "";
    const studentName = profile.fullName || profile.studentName || "Unknown";

    // Calculate readiness and viability scores for score_data
    const readinessScore = computeDocScore(profile, res || {});
    const viabilityScoreData = viabilityScore(profile);
    const scoreData = {
      readiness: {
        score: readinessScore.score,
        breakdown: readinessScore.breakdown
      },
      viability: {
        score: viabilityScoreData.score,
        confidence: viabilityScoreData.confidence,
        breakdown: viabilityScoreData.breakdown
      },
      metadata: {
        calculatedAt: new Date().toISOString(),
        version: "1.0"
      }
    };

    const caseSerial = await generateCaseSerial(
      session.org_id,
      session.org_name,
      studentName,
      country
    );
    const { data, error } = await supabase.from("cases").insert({
      org_id:                session.org_id,
      case_serial:           caseSerial,
      student_name:          profile.fullName || "Unknown",
      profile_data:          profile,
      results:               res,
      doc_list:              docList.map(d => ({ name: d.renamed || d.file?.name, type: d.type })),
      notes:                 notesText || "",
      sop_text:              sopText || "",
      university_sop:        uniSop || "",
      visa_sop:              visaSop || "",
      resume_text:           resumeText || "",
      preferred_offer_index: prefIdx || 0,
      // Ownership — always stamped from the verified session, never from free-text input.
      // created_by / assigned_to are UUIDs that power _applyCaseScope() filtering.
      // counsellor_email is the authoritative identity field for the inbox scanner.
      created_by:            session.member_id    || null,
      assigned_to:           session.member_id    || null,
      counsellor_email:      session.email        || null,
      counsellor_name:       session.full_name    || counsellor || "Unknown",
      overall_score:         res?.eligibility?.overallScore || 0,
      target_country:        country,
      application_targets:   applicationTargets,
      lead_status:           leadStatus || "None",
      score_data:            scoreData,
    }).select("id, case_serial").single();
    if (error) { console.error("Supabase save error:", error); return null; }
    return { id: data?.id, caseSerial: data?.case_serial };
  } catch (e) { console.error("Supabase save error:", e); return null; }
}

  const mergedRequirements = customRequirements
    ? { ...UNIVERSITY_DATA, ...customRequirements }
    : UNIVERSITY_DATA;

  async function fileToBase64(file) {
    return new Promise((res,rej) => {
      const r = new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=()=>rej(); r.readAsDataURL(file);
    });
  }
  // ── PDF → Image conversion (PDF.js) ─────────────────────────────────────
  // Renders PDF pages to JPEGs and sends via vision path (~1800 tokens/page flat)
  // instead of text-extraction path (~2800 tokens/page, scales with content density).
  async function convertPdfToImages(doc) {
    setConvertingPdfs(p => new Set([...p, doc.id]));
    try {
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await doc.file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageCount = pdf.numPages;

      // ── Bank statement page slicing ──────────────────────────────────────
      // A bank statement PDF can be 50+ pages but we only need:
      //   • First 3 pages  — account holder info, opening balance, account number
      //   • Last 4 pages   — most recent transactions, closing balance
      // Middle pages are transaction history we don't need for extraction.
      // For other doc types, or statements ≤ 7 pages, render everything.
      const isBankDoc = doc.type === "bank_statement" || guessType(doc.renamed || doc.file.name) === "bank_statement";
      const BANK_HEAD = 2; // first N pages to keep (page 1 = account info, page 2 = first transactions)
      const BANK_TAIL = 2; // last N pages to keep (last page = summary/closing balance, second-to-last = final txns)
      const shouldSlice = isBankDoc && pageCount > (BANK_HEAD + BANK_TAIL);

      // Build the set of 1-based page numbers we actually want to render
      const pagesToRender = new Set();
      if (shouldSlice) {
        for (let i = 1; i <= BANK_HEAD; i++) pagesToRender.add(i);
        for (let i = pageCount - BANK_TAIL + 1; i <= pageCount; i++) pagesToRender.add(i);
      } else {
        for (let i = 1; i <= pageCount; i++) pagesToRender.add(i);
      }

      // jpegBlobs entries carry their original 1-based page number
      const jpegBlobs = []; // [{blob, pageNum}]

      for (let i = 1; i <= pageCount; i++) {
        if (!pagesToRender.has(i)) continue; // skip middle pages entirely
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // 1.5x = good quality/size balance
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
        jpegBlobs.push({ blob, pageNum: i });
      }

      const baseName = (doc.renamed || doc.file.name).replace(/\.pdf$/i, "");
      const renderedCount = jpegBlobs.length;

      const makeImgBlob = (blob, name) => {
        const b = new Blob([blob], { type: "image/jpeg" });
        Object.defineProperty(b, "name",         { value: name,      writable: false });
        Object.defineProperty(b, "lastModified",  { value: Date.now(), writable: false });
        return b;
      };

      if (renderedCount === 1 && pageCount === 1) {
        // Single page — replace in-place, keep same doc ID so qualities/MRZ carry over automatically
        const imgFile = makeImgBlob(jpegBlobs[0].blob, `${baseName}.jpg`);
        const newDoc = { ...doc, file: imgFile, renamed: `${baseName}.jpg`, _convertedFromPdf: true };
        setDocs(prev => prev.map(d => d.id === doc.id ? newDoc : d));
        // Re-run MRZ on the new JPEG if this is a passport
        if (doc.type === "passport" || guessType(baseName) === "passport") {
          geminiMRZ(newDoc).then(mrzResult => {
            if (!mrzResult) return;
            setQualities(p => ({ ...p, [newDoc.id]: { ...(p[newDoc.id] || {}), mrz: mrzResult } }));
            if (mrzResult.valid && mrzResult.passportNumber) {
              setProfileData(prev => {
                if (prev.passportNumber && prev.passportNumber !== "Not found" && prev.passportNumber !== "") return prev;
                return { ...prev, passportNumber: mrzResult.passportNumber,
                  passportExpiry: mrzResult.expiry && mrzResult.expiry !== "Not found" ? mrzResult.expiry : prev.passportExpiry,
                  dob: mrzResult.dob && mrzResult.dob !== "Not found" ? mrzResult.dob : prev.dob,
                  nationality: mrzResult.nationality || prev.nationality };
              });
            }
          });
        }
      } else {
        // Multi-page — replace one doc with N image docs (one per rendered page).
        // For bank statements, jpegBlobs only has first 3 + last 4 pages;
        // filenames use the ORIGINAL 1-based page number so it's auditable
        // (e.g. _p1, _p2, _p3, _p47, _p48, _p49, _p50 for a 50-page statement).
        const newDocs = jpegBlobs.map(({ blob, pageNum }) => ({
          id: Math.random().toString(36).slice(2),
          file: makeImgBlob(blob, `${baseName}_p${pageNum}.jpg`),
          type: doc.type,
          renamed: `${baseName}_p${pageNum}.jpg`,
          tooLarge: false,
          largeWarning: false,
          isNew: doc.isNew,
          _convertedFromPdf: true,
          // Track slicing so UI can show "X of Y pages" badge
          ...(shouldSlice && { _slicedFrom: pageCount, _slicedKeep: renderedCount }),
        }));
        setDocs(prev => {
          const idx = prev.findIndex(d => d.id === doc.id);
          const next = [...prev];
          next.splice(idx, 1, ...newDocs);
          return next;
        });
        const tagVal = p => p[doc.id] || "primary";
        const typeVal = p => p[doc.id] || "";
        setPersonTags(p  => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, tagVal(p)])) }));
        setDocTypes(p    => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, typeVal(p)])) }));
        setSubTypes(p    => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, ""])) }));
        setCustomLabels(p => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, ""])) }));
        setDocDepOpen(p  => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, false])) }));
        // ── Copy MRZ + quality data from original doc to new page IDs ──────
        setQualities(p => ({
          ...p,
          ...Object.fromEntries(newDocs.map(d => [d.id, p[doc.id] || {}])),
        }));
        // Re-run MRZ on page 1 of the converted images if this is a passport
        if (doc.type === "passport" || guessType(baseName) === "passport") {
          const page1 = newDocs[0];
          geminiMRZ(page1).then(mrzResult => {
            if (!mrzResult) return;
            setQualities(p => ({ ...p, [page1.id]: { ...(p[page1.id] || {}), mrz: mrzResult } }));
            if (mrzResult.valid && mrzResult.passportNumber) {
              setProfileData(prev => {
                if (prev.passportNumber && prev.passportNumber !== "Not found" && prev.passportNumber !== "") return prev;
                return { ...prev, passportNumber: mrzResult.passportNumber,
                  passportExpiry: mrzResult.expiry && mrzResult.expiry !== "Not found" ? mrzResult.expiry : prev.passportExpiry,
                  dob: mrzResult.dob && mrzResult.dob !== "Not found" ? mrzResult.dob : prev.dob,
                  nationality: mrzResult.nationality || prev.nationality };
              });
            }
          });
        }
      }
    } catch (err) {
      console.error("PDF→image conversion failed:", err);
      setError("Could not convert PDF to images — try again or use the original.");
    } finally {
      setConvertingPdfs(p => { const n = new Set(p); n.delete(doc.id); return n; });
    }
  }

  async function convertAllPdfsToImages() {
    const pdfs = docs.filter(d => !d.tooLarge && d.file.type === "application/pdf" && !d._convertedFromPdf);
    for (const doc of pdfs) await convertPdfToImages(doc);
  }

  function parseJSON(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw.replace(/```json\s*|```\s*/g,"").trim()); } catch {}
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch {}
    try {
      const start = raw.indexOf("{");
      if (start !== -1) {
        let depth = 0, i = start;
        for (; i < raw.length; i++) {
          if (raw[i] === "{") depth++;
          else if (raw[i] === "}") { depth--; if (depth === 0) break; }
        }
        if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
      }
    } catch {}
    try {
      const s = raw.replace(/```json\s*|```\s*/g,"").trim();
      if (s.startsWith("{")) {
        let fixed = s;
        let braces = 0, brackets = 0, inStr = false, esc = false;
        for (const ch of fixed) {
          if (esc) { esc = false; continue; }
          if (ch === "\\" && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") braces++;
          else if (ch === "}") braces--;
          else if (ch === "[") brackets++;
          else if (ch === "]") brackets--;
        }
        fixed = fixed.replace(/,\s*$/, "");
        while (brackets > 0) { fixed += "]"; brackets--; }
        while (braces > 0)   { fixed += "}"; braces--; }
        return JSON.parse(fixed);
      }
    } catch {}
    return null;
  }

  async function checkQuality(doc) {
    // Only run on images — PDFs and text files get a pass
    if (!doc.file.type.startsWith("image/") || doc.file.size > 10*1024*1024) {
      setQualities(p=>({...p,[doc.id]:{status:"ok"}})); return;
    }
    try {
      const b64  = await fileToBase64(doc.file);
      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body:JSON.stringify(withOrg({
          action:   "gemini-quality",
          name:     doc.renamed || doc.file.name,
          mimeType: doc.file.type,
          data:     b64,
        }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setQualities(p=>({...p,[doc.id]:{
        status:   data.status   || "ok",
        detail:   data.detail   || "",
        rotation: data.rotation || 0,
      }}));
    } catch {
      // Quality check failure is non-fatal — mark ok so upload proceeds
      setQualities(p=>({...p,[doc.id]:{status:"ok"}}));
    }
  }

  // ── Gemini MRZ extractor — called when a passport doc is added ───────
  async function geminiMRZ(doc) {
    if (!doc.file.type.startsWith("image/") && doc.file.type !== "application/pdf") return null;
    try {
      const b64  = await fileToBase64(doc.file);
      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body:JSON.stringify(withOrg({
          action:   "gemini-mrz",
          name:     doc.renamed || doc.file.name,
          mimeType: doc.file.type,
          data:     b64,
        }))
      });
      const data = await resp.json();
      return data; // { valid, passportNumber, dob, expiry, nationality, checksums, error? }
    } catch(e) {
      console.warn("MRZ extraction failed:", e.message);
      return null;
    }
  }

  // ── Gemini bank pre-extractor — called when a bank statement is added ─
  async function geminiBankExtract(doc) {
    if (doc.file.size > 10*1024*1024) return null; // skip very large files
    try {
      const b64  = await fileToBase64(doc.file);
      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body:JSON.stringify(withOrg({
          action:   "gemini-bank",
          name:     doc.renamed || doc.file.name,
          mimeType: doc.file.type,
          data:     b64,
        }))
      });
      const data = await resp.json();
      return data; // { accountHolder, closingBalance, currency, confidence, ... }
    } catch(e) {
      console.warn("Bank pre-extraction failed:", e.message);
      return null;
    }
  }

 async function handleDriveImport() {
  setDriveImporting(true);
  try {
    await openDrivePicker(async (driveFiles) => {
      if (!driveFiles?.length) { setDriveImporting(false); return; }
      setDriveConnected(true);
      const token = await getAccessToken();
      const fetched = [];
      for (const df of driveFiles) {
        try {
          // ── Type check BEFORE downloading ──
          const ext = df.name.split(".").pop()?.toLowerCase() || "";
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            setError(`🚫 ${df.name} is not supported. Only PDF, JPG, PNG and TXT files are allowed.`);
            setTimeout(() => setError(""), 8000);
            continue;
          }

          const blob = await downloadDriveFile(df.id, df.mimeType, token);
          const mime = blob.type || (ext === "pdf" ? "application/pdf" : ext.startsWith("jp") ? "image/jpeg" : "image/png");

          // ── MIME check AFTER downloading ──
          if (!ALLOWED_MIME_TYPES.has(mime)) {
            setError(`🚫 ${df.name} has an unsupported format and was skipped.`);
            setTimeout(() => setError(""), 8000);
            continue;
          }

          const typedBlob = new Blob([blob], { type: mime });
          Object.defineProperty(typedBlob, "name", { value: df.name, writable: false });
          Object.defineProperty(typedBlob, "lastModified", { value: Date.now(), writable: false });

          // ── Size check ──
          if (typedBlob.size > 10 * 1024 * 1024) {
            setError(`🚫 ${df.name} exceeds 10MB and was skipped. Compress at ilovepdf.com first.`);
            setTimeout(() => setError(""), 10000);
            continue;
          }

          fetched.push(typedBlob);
        } catch (e) {
          console.error("Drive download error:", e);
          setError(`⚠️ Could not download ${df.name} from Drive: ${e.message}`);
          setTimeout(() => setError(""), 8000);
        }
      }
      if (fetched.length) addFiles(fetched);
      setDriveImporting(false);
    });
  } catch (e) {
    setError("Google Drive connection failed. Please try again.");
    setTimeout(() => setError(""), 8000);
  } finally {
    setDriveImporting(false);
  }
}

  // ── Google Drive: save to Drive ──────────────────────────────────────
  async function handleSaveToDrive() {
    if (!docs.length && !results) return;
    setDriveSaving(true);
    setDriveSaveResult(null);
    try {
      const token      = await getAccessToken();
      setDriveConnected(true);
      const rootId     = await getDriveRootFolderId(token);
      const studentName = profileData?.fullName || results?.studentProfile?.fullName || "Unknown Student";
      const today      = new Date().toISOString().split("T")[0];
      const folderName = `${studentName} — ${today}`;
      const subId      = await createDriveSubfolder(token, rootId, folderName);

      // Upload all docs
      for (const doc of docs) {
        const t      = docTypes[doc.id] || doc.type || "other";
        const dt     = getDT(t);
        const sub    = subTypes[doc.id] || "";
        const label  = sub ? `${dt.label}-${sub}` : dt.label;
        const ext    = doc.file.name.split(".").pop() || "pdf";
        const fname  = `${label}.${ext}`;
        await uploadFileToDrive(token, subId, doc.file, fname);
      }

      // Upload text report if analysis done
      if (results) {
        const p = profileData || results.studentProfile || {};
        const lines = [
          `VisaLens Report — ${studentName}`,
          `Generated: ${new Date().toLocaleString()}`,
          ``,
          `=== PROFILE ===`,
          `Name: ${p.fullName || "—"}`,
          `Passport: ${p.passportNumber || "—"} (expires ${p.passportExpiry || "—"})`,
          `IELTS: ${p.ieltsScore || "—"} | TOEFL: ${p.toeflScore || "—"} | PTE: ${p.pteScore || "—"}`,
          `Financial Balance: ${p.financialBalance || "—"}`,
          `Highest Qualification: ${p.program || "—"} — ${p.university || "—"} (${p.yearOfPassing || "—"})`,
          ``,
          `=== ELIGIBILITY ===`,
          `Overall: ${results.eligibility?.overallScore || "—"}/100`,
          `Financial: ${results.eligibility?.financialScore || "—"}/100`,
          `Academic: ${results.eligibility?.academicScore || "—"}/100`,
          `Document: ${results.eligibility?.documentScore || "—"}/100`,
          ``,
          `=== RED FLAGS (${results.redFlags?.length || 0}) ===`,
          ...(results.redFlags || []).map(f => `[${f.severity?.toUpperCase() || "?"}] ${f.flag}: ${f.detail || ""}`),
          ``,
          `=== MISSING DOCUMENTS ===`,
          ...(results.missingDocuments || []).map(m => `• ${m.document}: ${m.whyNeeded || ""}`),
          ``,
          `=== NOTES ===`,
          notes || "(no notes)",
        ].join("\n");
        const reportBlob = new Blob([lines], { type: "text/plain" });
    const reportName = `VisaLens_Report_${studentName.replace(/\s+/g, "_")}.txt`;
    await uploadFileToDrive(token, subId, reportBlob, reportName);
      }

      // Get folder link
      const folderResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${subId}?fields=webViewLink`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const folderData = await folderResp.json();
      setDriveSaveResult({ link: folderData.webViewLink, folderName });
    } catch (e) {
      setError("Save to Drive failed: " + (e.message || "Unknown error"));
      setTimeout(() => setError(""), 10000);
    }
    setDriveSaving(false);
  }

  function handleDisconnectDrive() {
    clearDriveToken();
    setDriveConnected(false);
    setDriveSaveResult(null);
  }
  
  async function compressImage(file, maxSizeKB = 800) {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= maxSizeKB * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      const MAX_DIM = 2400;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const tryQuality = (quality) => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxSizeKB * 1024 || quality <= 0.6) {
            const newName = file.name.replace(/\.[^.]+$/, ".jpg");
Object.defineProperty(blob, "name", { value: newName, writable: false });
Object.defineProperty(blob, "lastModified", { value: Date.now(), writable: false });
resolve(blob);
          } else {
            tryQuality(Math.round((quality - 0.1) * 10) / 10);
          }
        }, "image/jpeg", quality);
      };
      tryQuality(0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
  
  // Ref so addFiles always sees current results state despite useCallback([]) dep array
  const resultsExistRef = useRef(false);
  useEffect(() => { resultsExistRef.current = !!results; }, [results]);
  useEffect(() => { qualitiesRef.current = qualities; }, [qualities]);

  const addFiles = useCallback(async (files) => {
  const fileArray = Array.from(files);
  const processedFiles = [];

  for (const f of fileArray) {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";

    if (UNSUPPORTED_BUT_COMMON.has(ext)) {
      setError(`🚫 ${f.name}: ${ext.toUpperCase()} files are not supported. Please save as PDF and re-upload.`);
      setTimeout(() => setError(""), 8000);
      continue;
    }

    if (ext === "docx") {
      try {
        const text = await extractTextFromDocx(f);
        const txtBlob = new Blob([text], { type: "text/plain" });
        Object.defineProperty(txtBlob, "name", { value: f.name.replace(/\.docx?$/, ".txt"), writable: false });
        Object.defineProperty(txtBlob, "lastModified", { value: Date.now(), writable: false });
        processedFiles.push(txtBlob);
      } catch (e) {
        setError(`⚠️ Could not read ${f.name}. Try saving as PDF first.`);
        setTimeout(() => setError(""), 8000);
      }
      continue;
    }

    processedFiles.push(f);
  }

  // ── Auto-compress images silently ──
  const compressedFiles = await Promise.all(
    processedFiles.map(f => compressImage(f, 800))
  );

  // ── Per-file size checks — flag oversized files ──
  // Use ref to avoid stale closure (results state would always be null with useCallback([]))
  const hasResults = resultsExistRef.current;
  const newDocs = compressedFiles.map(f => ({
    id: Math.random().toString(36).slice(2),
    file: f,
    type: guessType(f.name),
    renamed: null,
    tooLarge: f.size >= 100 * 1024 * 1024,   // truly blocked: ≥100MB
    largeWarning: f.size >= 10 * 1024 * 1024 && f.size < 100 * 1024 * 1024, // inline warning: 10–100MB
    isNew: hasResults,
  }));

  setDocs(p => [...p, ...newDocs]);
  setPreScanData(null);   // reset pre-scan whenever new files are added
  const newIds = newDocs.map(d => d.id);
  setDocTypes(p => ({ ...p, ...Object.fromEntries(newDocs.map(d => [d.id, guessType(d.file.name)])) }));
  setPersonTags(p => ({ ...p, ...Object.fromEntries(newIds.map(id => [id, "primary"])) }));
  setSubTypes(p => ({ ...p, ...Object.fromEntries(newIds.map(id => [id, ""])) }));
  setCustomLabels(p => ({ ...p, ...Object.fromEntries(newIds.map(id => [id, ""])) }));
  setDocDepOpen(p => ({ ...p, ...Object.fromEntries(newIds.map(id => [id, false])) }));
  newDocs.forEach(d => {
    const docType = guessType(d.file.name);
    setQualities(p => ({ ...p, [d.id]: { status: "checking" } }));
    checkQuality(d);

    // ── Passport detected → run MRZ extraction in background ──────────
    if (["passport"].includes(docType) && (d.file.type.startsWith("image/") || d.file.type === "application/pdf")) {
      geminiMRZ(d).then(mrzResult => {
        if (!mrzResult) return;
        setQualities(p => ({
          ...p,
          [d.id]: {
            ...(p[d.id] || {}),
            mrz: mrzResult,
          },
        }));
        // If MRZ is valid and passport number extracted, pre-fill profile field
        if (mrzResult.valid && mrzResult.passportNumber) {
          setProfileData(prev => {
            // Only pre-fill if field is empty or Not found
            if (prev.passportNumber && prev.passportNumber !== "Not found" && prev.passportNumber !== "") return prev;
            return {
              ...prev,
              passportNumber: mrzResult.passportNumber,
              passportExpiry: mrzResult.expiry && mrzResult.expiry !== "Not found" ? mrzResult.expiry : prev.passportExpiry,
              dob:            mrzResult.dob    && mrzResult.dob    !== "Not found" ? mrzResult.dob    : prev.dob,
              nationality:    mrzResult.nationality && mrzResult.nationality !== "" ? mrzResult.nationality : prev.nationality,
            };
          });
        }
      });
    }

    // ── Bank statement detected → run pre-extraction in background ─────
    if (["bank_statement"].includes(docType)) {
      geminiBankExtract(d).then(bankResult => {
        if (!bankResult || bankResult.confidence === "low") return;
        setQualities(p => ({
          ...p,
          [d.id]: {
            ...(p[d.id] || {}),
            bank: bankResult,
          },
        }));
        // Pre-fill financial fields if empty
        if (bankResult.closingBalance || bankResult.accountHolder) {
          setProfileData(prev => ({
            ...prev,
            financialBalance: prev.financialBalance && prev.financialBalance !== "Not found" && prev.financialBalance !== ""
              ? prev.financialBalance
              : (bankResult.closingBalance || prev.financialBalance),
            financialHolder: prev.financialHolder && prev.financialHolder !== "Not found" && prev.financialHolder !== ""
              ? prev.financialHolder
              : (bankResult.accountHolder || prev.financialHolder),
          }));
        }
      });
    }
  });
}, []);

  function removeDocsByNames(fileNames) {
    const nameSet = new Set(fileNames.map(n => n.toLowerCase()));
    setDocs(prev => prev.filter(d => !nameSet.has((d.renamed||d.file.name).toLowerCase())));
  }

  function exportPDF() {
    if (!results || !profileData) return;
    const p = profileData, e = results.eligibility;
    const sc = s => s >= 70 ? "#059669" : s >= 45 ? "#B45309" : "#DC2626";
    const bar = (label, score) => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${label}</span><span style="font-weight:700;color:${sc(score)}">${score}/100</span>
        </div>
        <div style="height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${score}%;background:${sc(score)};border-radius:3px"></div>
        </div>
      </div>`;
    const row = (label, val) => val && val !== "Not found"
      ? `<tr><td style="padding:5px 8px;color:#64748B;font-size:12px;white-space:nowrap">${label}</td><td style="padding:5px 8px;font-size:13px;font-weight:500">${val}</td></tr>`
      : "";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>VisaLens Report — ${p.fullName||"Student"}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;color:#0F1E3C;margin:0;padding:32px;background:#fff}
  h1{font-size:22px;font-weight:700;color:#1D6BE8;margin:0 0 4px}
  .meta{font-size:12px;color:#94A3B8;margin-bottom:24px}
  .section{margin-bottom:22px;break-inside:avoid}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94A3B8;border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge-ok{background:#D1FAE5;color:#059669}
  .badge-warn{background:#FEF3C7;color:#B45309}
  .badge-err{background:#FEE2E2;color:#DC2626}
  .item{padding:8px 10px;border-radius:6px;margin-bottom:6px;font-size:13px}
  .item-warn{background:#FFFBEB;border:1px solid #FCD34D}
  .item-flag-high{background:#FEF2F2;border:1px solid #FCA5A5}
  .item-flag-med{background:#FFFBEB;border:1px solid #FCD34D}
  .item-flag-low{background:#EFF6FF;border:1px solid #BFDBFE}
  .item-title{font-weight:600;margin-bottom:2px}
  .item-detail{font-size:12px;color:#4A5D7E}
  .summary{font-size:13px;color:#4A5D7E;line-height:1.6;margin-bottom:14px}
  .gap-box{background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E;margin-bottom:14px}
  @media print{body{padding:16px}button{display:none}}
</style></head><body>
<h1>VisaLens Student Report</h1>
<div class=\"meta\">Generated ${new Date().toLocaleString()}</div>

<div class="section">
  <div class="section-title">Personal Information</div>
  <table>
    ${row("Full Name", p.fullName)}${row("Date of Birth", p.dob)}${row("Nationality", p.nationality)}
    ${row("Passport No.", p.passportNumber)}${row("Passport Expiry", p.passportExpiry)}
    ${(()=>{const offers=Array.isArray(p.offerLetters)?p.offerLetters:[];return offers.map((o,i)=>`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px;white-space:nowrap">${i===0?"★ Preferred Offer":"Offer "+(i+1)}</td><td style="padding:5px 8px;font-size:13px;font-weight:500"><span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:600;background:${o.status==="Full"?"#D1FAE5":"#FEF3C7"};color:${o.status==="Full"?"#059669":"#B45309"};margin-right:6px">${o.status||""}</span>${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?` · ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` · ${o.intakeSeason}`:""}${o.conditions?`<br><span style="font-size:11px;color:#B45309">⚠️ Conditions: ${o.conditions}</span>`:""}</td></tr>`).join("");})()}
  </table>
</div>

<div class="section">
  <div class="section-title">Academic Background</div>
  <table>
    ${row("Highest Qualification", p.program + (p.yearOfPassing && p.yearOfPassing!=="Not found" ? ` (${p.yearOfPassing})` : ""))}
    ${row("University", p.university)}
  </table>
  ${p.studyGap && p.studyGap !== "Not found" ? `<div class="gap-box">⚠️ Study Gap: ${p.studyGap}</div>` : ""}
  ${p.academicResult && p.academicResult !== "Not found" ? `<div style="font-size:12px;color:#4A5D7E;white-space:pre-line;padding:8px 10px;background:#F8FAFC;border-radius:6px;border:1px solid #E2E8F0">${p.academicResult}</div>` : ""}
</div>

<div class="section">
  <div class="section-title">English Qualifications</div>
  ${(()=>{
    const tests = Array.isArray(p.englishTests) && p.englishTests.length > 0 ? p.englishTests : [];
    if (tests.length > 0) {
      return `<div style="display:flex;flex-direction:column;gap:8px">${tests.map(et => {
        const subKeys = ["listening","reading","writing","speaking"];
        const subs = et.subScores ? subKeys.filter(k=>et.subScores[k]&&et.subScores[k]!=="") : [];
        const hasUrn = et.urn && et.urn !== "Not found" && et.urn !== "";
        const typeColor = et.type?.includes("UKVI") ? "#059669" : et.type?.includes("IELTS") ? "#1D6BE8" : et.type?.includes("PTE") ? "#7C3AED" : et.type?.includes("TOEFL") ? "#B45309" : "#0284C7";
        return `<div style="border:1.5px solid ${typeColor}30;border-radius:6px;overflow:hidden">
          <div style="background:${typeColor}10;padding:6px 10px;border-bottom:1px solid ${typeColor}20;display:flex;align-items:center;gap:10px">
            <span style="font-size:11px;font-weight:700;color:${typeColor};letter-spacing:.04em">${et.type||"English Test"}</span>
            <span style="font-size:14px;font-weight:800;color:${typeColor}">${et.overallScore||"N/A"}</span>
            ${et.testDate&&et.testDate!=="Not found"?`<span style="font-size:11px;color:#94A3B8;margin-left:auto">${et.testDate}</span>`:""}
          </div>
          <div style="padding:8px 10px">
            ${hasUrn?`<div style="font-size:11px;color:#4A5D7E;font-family:monospace;margin-bottom:6px;padding:4px 8px;background:#F1F5F9;border-radius:4px;word-break:break-all">URN: ${et.urn}</div>`:""}
            ${subs.length>0?`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${subs.map(k=>`<div style="text-align:center;padding:4px;background:#F8FAFC;border-radius:4px"><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">${k}</div><div style="font-size:13px;font-weight:700;color:#0F1E3C">${et.subScores[k]}</div></div>`).join("")}</div>`:""}
          </div>
        </div>`;
      }).join("")}</div>`;
    }
    // Fallback to legacy flat fields
    return `<table>${row("IELTS", p.ieltsScore)}${row("TOEFL", p.toeflScore)}${row("PTE", p.pteScore)}${p.otherEnglishTest&&p.otherEnglishTest!=="Not found"?row("Other English Test/Cert", p.otherEnglishTest):""}</table>`;
  })()}
  ${p.mediumOfInstruction&&p.mediumOfInstruction!=="Not found"?`<div style="margin-top:8px">${row("Medium of Instruction", p.mediumOfInstruction)}</div>`:""}
</div>

<div class="section">
  <div class="section-title">Financial</div>
  <table>${row("Account Holder", p.financialHolder)}${row("Funds Available", p.financialBalance)}${p.fundsRequired?row("Funds Required", p.fundsRequired):""}${(()=>{if(!p.fundsRequired||!p.financialBalance)return"";const a=parseCurrencyAmount(p.financialBalance),r=parseCurrencyAmount(p.fundsRequired);if(a.amount===null||r.amount===null)return`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEF3C7;color:#B45309;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">Cannot parse — verify manually</span></td></tr>`;if(a.currency!==r.currency)return`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEF3C7;color:#B45309;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">⚠️ Currency mismatch — manual check required</span></td></tr>`;const d=a.amount-r.amount;return d>=0?`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#D1FAE5;color:#059669;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">✓ Appears sufficient (+${a.currency} ${d.toLocaleString()})</span><br><span style="font-size:11px;color:#64748B">Verify this figure reflects current visa rules before submission.</span></td></tr>`:`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">✗ Shortfall of ${a.currency} ${Math.abs(d).toLocaleString()}</span></td></tr>`;})()}</table>
</div>

<div class="section">
  <div class="section-title">Visa Eligibility — Executive Summary</div>
  <div class="summary">${e.summary||""}</div>
  ${bar("Overall Eligibility", e.overallScore)}
  ${bar("Financial Strength", e.financialScore)}
  ${bar("Academic Standing", e.academicScore)}
  ${bar("Document Completeness", e.documentScore)}
  ${e.notes?.length ? `<ul style="margin:10px 0 0;padding-left:18px">${e.notes.map(n=>`<li style="font-size:12px;color:#4A5D7E;margin-bottom:4px">${n}</li>`).join("")}</ul>` : ""}
</div>

${results.rejections?.length ? `<div class="section">
  <div class="section-title">Rejections &amp; Deferments</div>
  ${results.rejections.map(r=>`<div class="item item-flag-high">
    <div class="item-title">${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.date?` (${r.date})`:""}</div>
    ${r.university?`<div class="item-detail">${r.university}${r.program?`, ${r.program}`:""}</div>`:""}
    ${r.reason?`<div class="item-detail">${r.reason}</div>`:""}
  </div>`).join("")}
</div>` : ""}

${results.missingDocuments?.length ? `<div class="section">
  <div class="section-title">Gaps &amp; Concerns</div>
  ${results.missingDocuments.map(d=>`<div class="item item-warn">
    <div class="item-title">${d.document}</div>
    <div class="item-detail">${d.reason}</div>
  </div>`).join("")}
</div>` : ""}

${results.redFlags?.length ? `<div class="section">
  <div class="section-title">Risk Flags</div>
  ${results.redFlags.map(f=>`<div class="item item-flag-${f.severity==="high"?"high":f.severity==="medium"?"med":"low"}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
      <span class="badge badge-${f.severity==="high"?"err":f.severity==="medium"?"warn":"ok"}">${f.severity.toUpperCase()}</span>
      <span class="item-title">${f.flag}</span>
    </div>
    <div class="item-detail">${f.detail}</div>
  </div>`).join("")}
</div>` : ""}

${notes ? `<div class="section"><div class="section-title">Counselor Notes</div><div style="font-size:13px;color:#4A5D7E;white-space:pre-wrap;padding:10px;background:#F8FAFC;border-radius:6px;border:1px solid #E2E8F0">${notes}</div></div>` : ""}

</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  }

function exportCSV() {
  if (!results || !profileData) return;
  const p = profileData, e = results.eligibility;
  const esc = v => `"${String(v||"").replace(/"/g,'""')}"`;
  const offers = Array.isArray(p.offerLetters) ? p.offerLetters : [];
  const preferredOffer = offers[preferredOfferIndex] || offers[0] || {};
  const rows = [
    ["Field", "Value"],
    ["Full Name",           p.fullName],
    ["Date of Birth",       p.dob],
    ["Nationality",         p.nationality],
    ["Passport No.",        p.passportNumber],
    ["Passport Expiry",     p.passportExpiry],
    ["CNIC No.",            p.cnicNumber],
    ["Preferred University",preferredOffer.university],
    ["Preferred Country",   preferredOffer.country],
    ["Preferred Programme", preferredOffer.program],
    ["Offer Status",        preferredOffer.status],
    ["Intake",              preferredOffer.intakeSeason],
    ["Conditions",          preferredOffer.conditions],
    ["Highest Qualification",p.program],
    ["Year of Passing",     p.yearOfPassing],
    ["Academic University", p.university],
    ["Academic Result",     p.academicResult],
    ["Study Gap",           p.studyGap],
    ["IELTS Score",         p.ieltsScore],
    ["TOEFL Score",         p.toeflScore],
    ["PTE Score",           p.pteScore],
    ...(Array.isArray(p.englishTests) && p.englishTests.length > 0
      ? p.englishTests.map((et, i) => {
          const subs = et.subScores ? Object.entries(et.subScores).filter(([,v])=>v&&v!=="").map(([k,v])=>`${k}:${v}`).join(" ") : "";
          return [`English Test ${i+1}`, `${et.type||""}|${et.overallScore||""}|${et.testDate||""}|URN:${et.urn||""}|${subs}`];
        })
      : []),
    ["Other English Test",  p.otherEnglishTest],
    ["Medium of Instruction",p.mediumOfInstruction],
    ["Financial Balance",   p.financialBalance],
    ["Financial Holder",    p.financialHolder],
    ["Overall Score",       e?.overallScore],
    ["Financial Score",     e?.financialScore],
    ["Academic Score",      e?.academicScore],
    ["Document Score",      e?.documentScore],
    ["Summary",             e?.summary],
    ["Red Flags",           results.redFlags?.map(f=>`[${f.severity.toUpperCase()}] ${f.flag}: ${f.detail}`).join(" | ")],
    ["Missing Documents",   results.missingDocuments?.map(d=>`${d.document}: ${d.reason}`).join(" | ")],
    ["Counsellor Notes",    notes],
    ["Counsellor Name",     counsellorName],
    ["Export Date",         new Date().toLocaleString()],
  ];
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VisaLens_${(p.fullName||"Student").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

  async function buildContent(docList, prompt, personTagsMap = {}, qualitiesMap = {}) {
    const content = [];
    const personLabel = t => t === "spouse" ? "Spouse (Dependant)" : t === "child" ? "Child (Dependant)" : "Student (Primary Applicant)";
    for (const doc of docList) {
      const ptag = personTagsMap[doc.id] || "primary";
      content.push({type:"text",text:`--- File: "${doc.renamed||doc.file.name}" | Type: ${getDT(doc.type).label} | Person: ${personLabel(ptag)} ---`});

      // ── MRZ ground truth — injected BEFORE the document ─────────────────
      // Gemini ran full ICAO 9303 triple-checksum (passport no + DOB + expiry).
      // These values are cryptographically verified. Claude visual OCR of a
      // compressed multi-page PDF is unreliable — always loses to checksum math.
      const mrz = qualitiesMap[doc.id]?.mrz;
      if (mrz?.valid) {
        content.push({type:"text", text:
          `MANDATORY OVERRIDE — MACHINE-VERIFIED MRZ DATA
` +
          `These passport fields were validated by an MRZ reader using ICAO 9303 triple-checksum BEFORE this document was sent to you.
` +
          `YOU MUST USE THESE EXACT VALUES. Do NOT read passportNumber, dob, passportExpiry or nationality from the document image.
` +
          `Your visual OCR of a compressed multi-page PDF is less accurate than a checksum-verified MRZ scan.
` +
          `If what you see in the image differs from the values below, your image reading is WRONG. Trust the checksum.
` +
          `passportNumber = ${mrz.passportNumber}
` +
          `dob            = ${mrz.dob}
` +
          `passportExpiry = ${mrz.expiry}
` +
          `nationality    = ${mrz.nationality || "Pakistani"}
` +
          `END MANDATORY OVERRIDE`
        });
      }
      if (doc.file.type.startsWith("image/"))       content.push({type:"image",  source:{type:"base64",media_type:doc.file.type,data:await fileToBase64(doc.file)}});
      else if (doc.file.type==="application/pdf") {
        // For bank statement PDFs: physically slice to first 2 + last 2 pages and send
        // as images. This prevents the "too much media" API error on long statements
        // (e.g. a 97-page statement would exceed the 100-page API limit).
        // For all other PDFs: send the full document.
        const isBankPdf = doc.type === "bank_statement" || guessType(doc.renamed || doc.file.name) === "bank_statement";
        if (isBankPdf) {
          const SLICE_HEAD = 2;
          const SLICE_TAIL = 2;
          try {
            // Ensure PDF.js is loaded
            if (!window.pdfjsLib) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
              });
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            }
            const arrayBuffer = await doc.file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const totalPages = pdf.numPages;
            // Build set of pages to render: first SLICE_HEAD + last SLICE_TAIL (deduplicated)
            const pagesToSlice = new Set();
            for (let i = 1; i <= Math.min(SLICE_HEAD, totalPages); i++) pagesToSlice.add(i);
            for (let i = Math.max(1, totalPages - SLICE_TAIL + 1); i <= totalPages; i++) pagesToSlice.add(i);
            const sortedPages = Array.from(pagesToSlice).sort((a, b) => a - b);
            content.push({type:"text", text:
              `BANK STATEMENT — ${totalPages} pages total. ` +
              `Sending pages: ${sortedPages.join(", ")} only (first ${SLICE_HEAD} + last ${SLICE_TAIL}). ` +
              `Page 1 has account holder name and account number. Last page has the closing balance summary. ` +
              `Extract the CLOSING BALANCE from the final summary page.`
            });
            for (const pageNum of sortedPages) {
              const page = await pdf.getPage(pageNum);
              const viewport = page.getViewport({ scale: 1.5 });
              const canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
              const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
              const b64 = await new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result.split(",")[1]);
                reader.onerror = rej;
                reader.readAsDataURL(blob);
              });
              content.push({type:"text", text:`[Bank Statement Page ${pageNum} of ${totalPages}]`});
              content.push({type:"image", source:{type:"base64", media_type:"image/jpeg", data:b64}});
            }
          } catch (sliceErr) {
            // Fallback: send full PDF if slicing fails
            console.warn("Bank PDF slicing failed, sending full PDF:", sliceErr);
            content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:await fileToBase64(doc.file)}});
          }
        } else {
          content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:await fileToBase64(doc.file)}});
        }
      }
      else content.push({type:"text",text:`[Content]: ${(await doc.file.text()).slice(0,2000)}`});
    }
    if (prompt) content.push({type:"text",text:prompt});
  return content;
  }

  async function callAPI(content, maxTokens=1500, { billable=false, creditsCost=1, system=null, estimatedTokens=0 }={}) {
  const resp = await fetch(PROXY_URL, {
    method:"POST", headers:getAuthHeaders(),
    body:JSON.stringify(withOrg({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages:   [{ role:"user", content }],
      ...(system && { system }),       // passed separately for caching
      billable,                        // only true for runFullAnalysis
      credits_cost:      creditsCost,  // legacy field — worker ignores for billing, uses actual tokens
      estimated_tokens:  estimatedTokens, // worker uses for pre-flight check
    }))
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message||data.error||"API error");
  // Only sync credits bar from the server when actual credits were charged.
  // Non-billable calls (re-assess, search, chat) return the current DB value which may
  // lag behind the optimistic pre-deduct — letting them overwrite would cause the bar
  // to jump back up briefly after every non-billable call.
  if (typeof data.analyses_remaining === "number" && (data.actual_credits_used ?? 0) > 0) {
    setOrgCredits(data.analyses_remaining);
  }
  return data.content?.map(b=>b.text||"").join("")||"";
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function preScan() {
    if (!docs.length) return;
    if (preScanRunning.current) return;
    preScanRunning.current = true;
    setPreScanLoading(true); setError("");
    try {
      const docsToScan = readinessSelection.size > 0
        ? docs.filter(d => readinessSelection.has(d.id) && !d.tooLarge)
        : docs.filter(d => !d.tooLarge);

      const documents = await Promise.all(docsToScan.map(async doc => {
        const base = { name: doc.renamed || doc.file.name, mimeType: doc.file.type };
        if (doc.file.type.startsWith('image/') || doc.file.type === 'application/pdf') {
          return { ...base, data: await fileToBase64(doc.file) };
        } else {
          const fullText = await doc.file.text();
          // Take first 4000 + last 1000 chars to catch headers and footers in long docs
          const textContent = fullText.length > 5000
            ? fullText.slice(0, 4000) + '\n...\n' + fullText.slice(-1000)
            : fullText;
          return { ...base, data: '', textContent };
        }
      }));

      const preScanAbort = new AbortController();
      const preScanTimeout = setTimeout(() => preScanAbort.abort(), 45000);
      const resp = await fetch(PROXY_URL, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({ action: 'gemini-prescan', documents })),
        signal: preScanAbort.signal,
      });
      clearTimeout(preScanTimeout);
      const json = await resp.json();
      if (json.error) throw new Error(json.error);

      console.log("🔍 [PRESCAN] Raw Output from Gemini Worker:", json);

      // 🛡️ BULLETPROOF DATA EXTRACTOR: Catch the array no matter how Gemini formats it
      let rawData = [];
      if (Array.isArray(json)) {
        rawData = json;
      } else if (json.peopleFound && Array.isArray(json.peopleFound)) {
        rawData = json.peopleFound;
      } else if (json.rawDataFound && Array.isArray(json.rawDataFound)) {
        rawData = json.rawDataFound;
      }

      const primaryCandidates = new Map();
      const relativeNames = new Set();

      // Helper: normalise a DOB string for comparison
      const normDob = (d) => (d && d.toLowerCase() !== "not found" && d.toLowerCase() !== "null") ? d.trim() : "";

      // Helper: order-insensitive name key — "NIDA ALIYA" and "ALIYA NIDA" → same key "ALIYA NIDA"
      // Also strips common honorifics so "MR JOHN SMITH" === "JOHN SMITH"
      const HONORIFICS = new Set(["MR","MRS","MS","MISS","DR","PROF","SIR","MASTER"]);
      const nameKey = (raw) => raw.trim().toUpperCase()
        .split(/\s+/)
        .filter(w => !HONORIFICS.has(w))
        .sort()
        .join(" ");

      // Helper: check if two name keys share enough words to be the same person
      // (handles "NIDA ALIYA" vs "ALIYA NIDA KAHLOON" — subset match)
      const nameKeysOverlap = (keyA, keyB) => {
        const wordsA = new Set(keyA.split(" "));
        const wordsB = new Set(keyB.split(" "));
        const shared = [...wordsA].filter(w => wordsB.has(w)).length;
        // Overlap if shared words cover ≥ 2 words AND ≥ 60% of the shorter name
        return shared >= 2 && shared / Math.min(wordsA.size, wordsB.size) >= 0.6;
      };

      rawData.forEach(item => {
        if (!item.nameFound || item.nameFound.length <= 3 || item.nameFound.toLowerCase() === "not found") return;
        
        const cleanName = item.nameFound.trim().toUpperCase();
        const role = (item.role || "").trim().toLowerCase();
        const dob  = normDob(item.dobFound);

        // 1. Ignore officials entirely
        if (role.includes("official")) return;

        // 2. Track relatives, but DO NOT let them trigger the UI
        if (role.includes("relative")) {
          relativeNames.add(cleanName);
          return; 
        }

        // 3. Blank role: only treat as primary if the filename strongly hints at a solo primary document
        //    AND is not a family/relative document
        if (role === "") {
          const fname = (item.filename || "").toLowerCase();
          const isRelativeDoc = /frc|family|marriage|nikah|birth.cert|relative|spouse|parent/.test(fname);
          const looksLikePrimaryDoc = /passport|transcript|degree|statement|marksheet/.test(fname);
          if (isRelativeDoc || !looksLikePrimaryDoc) return;
        }

        // 4. Collect PRIMARY candidates
        // Composite key = SORTED words of name (order-insensitive) so "NIDA ALIYA"
        // and "ALIYA NIDA" both resolve to the same bucket.
        // DOB is used to ENRICH the entry, not to split it.
        if (role.includes("primary") || role === "") {
          const compositeKey = nameKey(cleanName);

          // Also check if any existing key has high word-overlap (partial name match)
          let existingKey = compositeKey;
          for (const k of primaryCandidates.keys()) {
            if (k !== compositeKey && nameKeysOverlap(k, compositeKey)) {
              // Merge into whichever key is longer (more complete name)
              existingKey = k.split(" ").length >= compositeKey.split(" ").length ? k : compositeKey;
              if (existingKey !== k) {
                // Re-key: move existing entry to the new longer key
                const entry = primaryCandidates.get(k);
                primaryCandidates.delete(k);
                primaryCandidates.set(existingKey, entry);
              }
              break;
            }
          }

          if (!primaryCandidates.has(existingKey)) {
            primaryCandidates.set(existingKey, {
              name: cleanName,
              identifiers: dob || "No DOB",
              files: [item.filename || "Unknown Document"],
              relation: "unknown",
              // Richness: +1 DOB present, +1 per extra file later
              richnessScore: dob ? 6 : 5
            });
          } else {
            const existing = primaryCandidates.get(existingKey);
            if (item.filename && !existing.files.includes(item.filename)) {
              existing.files.push(item.filename);
              existing.richnessScore += 1; // more docs = richer profile
            }
            if (existing.identifiers === "No DOB" && dob) {
              existing.identifiers = dob;
              existing.richnessScore += 1;
            }
          }
        }
      });

      const validPrimaries = Array.from(primaryCandidates.values());
      
      console.log("👥 [PRESCAN] Primary Candidates found:", validPrimaries);
      console.log("👨‍👩‍👧‍👦 [PRESCAN] Relatives acknowledged (bypassed):", Array.from(relativeNames));

      // 🎯 THE SMART ALARM: Only trigger UI if we have 2 or more PRIMARY candidates
      if (validPrimaries.length >= 2) {
        console.log("🚨 [PRESCAN] COLLISION DETECTED! Multiple primaries found.");

        // ── Expand each person's files to include all sibling _pN pages ──────
        // Gemini only links pages where a name actually appears (e.g. Nakash_p2.jpg,
        // Nakash_p4.jpg). But Nakash_p1/p3/p5 are unnamed pages from the same original
        // PDF — they belong to the same person and must be removed together.
        // Strategy: for every filename in person.files, derive its base stem (strip
        // extension and _pN suffix), then pull in ALL docs in the dropzone that share
        // that same base stem.
        const allDocNames = docs.filter(d => !d.tooLarge).map(d => d.renamed || d.file.name);
        const expandedPrimaries = validPrimaries.map(person => {
          const expandedFiles = new Set(person.files || []);
          for (const f of (person.files || [])) {
            // Derive base: strip extension then optional _pN suffix
            const base = f
              .toLowerCase()
              .replace(/\.jpe?g$/i, "")
              .replace(/\.pdf$/i, "")
              .replace(/_p\d+$/, "");
            // Find all dropzone docs that share this base
            for (const docName of allDocNames) {
              const docBase = docName
                .toLowerCase()
                .replace(/\.jpe?g$/i, "")
                .replace(/\.pdf$/i, "")
                .replace(/_p\d+$/, "");
              if (docBase === base) expandedFiles.add(docName);
            }
          }
          return { ...person, files: Array.from(expandedFiles) };
        });

        setPreScanData({
          people: expandedPrimaries,
          triggerReasons: ["Multiple distinct primary applicants detected across documents (e.g., conflicting passports or transcripts.)."]
        });
        setPreScanLoading(false);
        return;
      }

      console.log("✅ [PRESCAN] Single primary applicant verified. Proceeding to Claude.");
      setPreScanData(null);
      await runFullAnalysis(validPrimaries[0] || null, [], new Set());
    } catch(e) {
      console.warn('Gemini pre-scan skipped:', e.message);
      setPreScanData(null);
      await runFullAnalysis(null, [], new Set());
    } finally {
      setPreScanLoading(false);
      preScanRunning.current = false;
    }
  }

async function analyze() {
    if (!docs.length) return;
    if (results) { setConfirmOverwrite(true); return; }
    if (preScanData === null && !preScanLoading) { 
      await preScan(); 
      return; 
    }
  }

async function confirmAndAnalyze(confirmedPeople) {
    // Standardize exclusions
    const EXCLUDED_RELATIONS = new Set(["unknown", "other", "exclude"]);
    
    const excludedPeople = confirmedPeople.filter(p => EXCLUDED_RELATIONS.has(p.relation?.toLowerCase() || "unknown"));
    const activePeople   = confirmedPeople.filter(p => !EXCLUDED_RELATIONS.has(p.relation?.toLowerCase() || "unknown"));

    // GRAB THE TARGET STUDENT FOR CLAUDE
    const targetStudent = activePeople.find(p => p.relation === "student");

    // Build base stems for each active person so sibling _pN pages get the same tag.
    // e.g. Faisal tagged as student with only p15 linked — p1–p14 share the same
    // base stem and must also be tagged "primary" so they're included in analysis.
    const allActiveDocNames = docs.filter(d => !d.tooLarge).map(d => d.renamed || d.file.name);
    const fileTagMap = {};
    for (const person of activePeople) {
      let tag = "primary";
      if (person.relation === "spouse") tag = "spouse";
      else if (person.relation === "child") tag = "child";
      // Collect base stems from this person's known files
      const personBaseStems = new Set(
        (person.files || []).map(f =>
          f.toLowerCase().replace(/\.jpe?g$/i, "").replace(/\.pdf$/i, "").replace(/_p\d+$/, "")
        )
      );
      // Map all dropzone docs that share a base stem
      for (const docName of allActiveDocNames) {
        const docBase = docName.toLowerCase()
          .replace(/\.jpe?g$/i, "").replace(/\.pdf$/i, "").replace(/_p\d+$/, "");
        if (personBaseStems.has(docBase)) fileTagMap[docName.toLowerCase()] = tag;
      }
      // Also map explicitly listed filenames (catches non-converted originals)
      for (const fname of (person.files || [])) {
        fileTagMap[fname.toLowerCase()] = tag;
      }
    }

    setPersonTags(prev => {
      const next = { ...prev };
      for (const doc of docs) {
        const fname = (doc.renamed || doc.file.name).toLowerCase();
        if (fileTagMap[fname] !== undefined) next[doc.id] = fileTagMap[fname];
      }
      return next;
    });

    const excludedNames = excludedPeople.map(p => p.name).filter(Boolean).filter(n => n !== "Unknown");
    // activeFileNames = everything already mapped as belonging to an active person (expanded)
    const activeFileNames = new Set(Object.keys(fileTagMap));

    // Derive base stems for all excluded files so sibling _pN pages get blocked too.
    // e.g. Faisal is linked to p15 only — but p1–p14 share the same base stem and must
    // also be excluded, otherwise they leak through to Claude as unowned docs.
    const excludedBaseStems = new Set(
      excludedPeople.flatMap(p => (p.files || []).map(f =>
        f.toLowerCase().replace(/\.jpe?g$/i, "").replace(/\.pdf$/i, "").replace(/_p\d+$/, "")
      ))
    );
    const allActiveDocs = docs.filter(d => !d.tooLarge);
    const excludedFileNames = new Set([
      // Explicitly linked excluded files
      ...excludedPeople.flatMap(p => (p.files || []).map(f => f.toLowerCase())),
      // Any dropzone doc whose base stem matches an excluded person's base stem
      ...allActiveDocs
        .map(d => (d.renamed || d.file.name))
        .filter(name => {
          const docBase = name.toLowerCase()
            .replace(/\.jpe?g$/i, "").replace(/\.pdf$/i, "").replace(/_p\d+$/, "");
          return excludedBaseStems.has(docBase);
        })
        .map(name => name.toLowerCase()),
    // Never exclude a file that belongs to an active (non-excluded) person
    ].filter(f => !activeFileNames.has(f)));

    setPreScanData(null);
    await runFullAnalysis(targetStudent, excludedNames, excludedFileNames);
  }

  async function runFullAnalysis(targetStudent = null, excludedNames = [], excludedFileNames = new Set()) {
    setLoading(true); setError(""); setResults(null); setUniversitySop(""); setVisaSop(""); setResumeText(""); setProfileData({});
    setNotes(""); setSavedMsg(""); setActiveCaseId(null); setSearchResults(null);
    setApplicationTargets([]); setLeadStatus("None");

    try {
      const docsForAnalysis = docs.filter(d =>
        !d.tooLarge && !excludedFileNames.has((d.renamed || d.file.name).toLowerCase())
      );

      const targetName = targetStudent && targetStudent.name ? targetStudent.name : "the PRIMARY APPLICANT";
      
      const _today = new Date();
      const _todayStr = _today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const _todayYear = _today.getFullYear();
      const MAIN_PROMPT = `You are an expert student visa counselor assistant. Analyse all documents and return ONLY valid JSON.
TODAY'S DATE: ${_todayStr}. Use this as the current date for ALL date calculations, age calculations, and study gap assessments. Never assume a fixed year.
🎯 CRITICAL DIRECTIVE: You are extracting a profile EXCLUSIVELY for: ${targetName}.
If you see documents belonging to ANYONE else, IGNORE THEM COMPLETELY.

{"studentProfile":{"fullName":"","dob":"","nationality":"","gender":"","city":"","mobileNumber":"","email":"","passportNumber":"","passportExpiry":"","passportIssueDate":"","cnicNumber":"","cnicExpiry":"","cnicAddressRomanUrdu":"","program":"","yearOfPassing":"","university":"","targetCountry":"","offerLetters":[{"status":"Full|Conditional","university":"","country":"","program":"","intakeSeason":"","conditions":""}],"casDocuments":[{"type":"CAS|Pre-CAS","casNumber":"","university":"","course":"","intakeSeason":"","sponsorshipStatus":"Confirmed|Conditional|Withdrawn","expiryDate":"","conditions":"","notes":""}],"financialBalance":"","financialHolder":"","academicResult":"","studyGap":"","ieltsScore":"","toeflScore":"","pteScore":"","englishTests":[{"type":"IELTS|IELTS UKVI|TOEFL|PTE Academic|PTE UKVI|Duolingo|OET|Cambridge","overallScore":"","testDate":"","urn":"","subScores":{"listening":"","reading":"","writing":"","speaking":""}}],"otherEnglishTest":"","mediumOfInstruction":"","detectedDocs":[],"nameMismatches":[{"documentName":"","nameFound":"","issue":""}]},"rejections":[{"type":"visa|admission|deferment","country":"","university":"","program":"","date":"","reason":""}],"missingDocuments":[{"document":"","reason":""}],"eligibility":{"overallScore":0,"financialScore":0,"academicScore":0,"documentScore":0,"summary":"","notes":[],"findings":[]},"redFlags":[{"flag":"","severity":"high|medium|low","detail":""}]}

DEPENDANT DOCUMENT HANDLING:
Each document is pre-tagged with a "Person:" label in its file header.

Field extraction rules:
- program: the HIGHEST COMPLETED qualification for ${targetName} ONLY. Do NOT extract degrees belonging to anyone else.
- yearOfPassing: the year ${targetName}'s highest qualification was completed.
- university: institution where ${targetName} obtained it.
- fullName: Extract ${targetName}'s full name using this priority: (1) Passport, (2) CNIC, (3) Offer letter.
- dob: If a MANDATORY OVERRIDE block is present for this document, use that dob value exactly. Otherwise extract ${targetName}'s date of birth.- offerLetters: an ARRAY — one entry per offer/admission letter found. If NO offer letter is found, return an EMPTY ARRAY [].
- casDocuments: an ARRAY — one entry per CAS or Pre-CAS document found. Return EMPTY ARRAY [] if none found.
- passportNumber: If a MANDATORY OVERRIDE block is present above this document, you MUST use that passportNumber value exactly as written — it is cryptographically verified and overrides anything you see visually. Do NOT read the image for this field when an override is present. Otherwise extract ONLY from a passport document. The passport scan may be rotated 90° or sideways — look for the MRZ regardless of orientation. PRIMARY METHOD — find the MRZ: two lines of monospace characters at the bottom edge of the data page (the page with the photo). The passport number is the first 9 characters of the SECOND MRZ line (e.g. "EP5529331PAK..." → "EP5529331"). SECONDARY METHOD — look for a field labelled "Passport No." on the same page as "ISLAMIC REPUBLIC OF PAKISTAN". VALIDATE: must match exactly ^[A-Z]{2}[0-9]{7}$ (2 uppercase letters + 7 digits). If the extracted value does not match, REJECT it. Set to "Not found" if extraction fails.
- passportIssueDate: Extract from passport document ONLY. PRIMARY METHOD — MRZ line 2, characters 14–19 give expiry; characters 7–12 give issue date (YYMMDD format, e.g. "200915" = 15 Sep 2020). SECONDARY METHOD — field labelled "Date of Issue" on the data page. Format output as DD MMM YYYY (e.g. "15 Sep 2020"). "Not found" if no passport document is present.
- passportExpiry: If a MANDATORY OVERRIDE block is present above this document, use that passportExpiry value exactly — it is cryptographically verified. Do NOT read the image for this field when an override is present. Otherwise extract ONLY from a passport document. The scan may be rotated — look for MRZ regardless of orientation. PRIMARY METHOD — MRZ line 2, characters 14–19 (YYMMDD format, e.g. "300918" = 18 Sep 2030). SECONDARY METHOD — field labelled "Date of Expiry" on the data page. Format output as DD MMM YYYY (e.g. "18 Sep 2030"). NEVER use CNIC expiry for this field. Set to "Not found" if no passport document is present.
- cnicNumber: Scan ALL uploaded documents for a Pakistani National Identity Card (CNIC) regardless of filename. A CNIC front is identified by ALL of these visual markers: (1) printed header "PAKISTAN National Identity Card" or "Islamic Republic of Pakistan"; (2) a gold/yellow chip on the left; (3) fields labelled "Name", "Identity Number" (format XXXXX-XXXXXXX-X), "Date of Birth", "Date of Issue", "Date of Expiry"; (4) a black-and-white photo top-right; (5) Urdu text alongside English. Extract the Identity Number in format XXXXX-XXXXXXX-X. Set to "Not found" if no CNIC front is found.
- cnicExpiry: From the same CNIC front identified above, extract the "Date of Expiry" field. Format as found (e.g. 07.03.2022). NEVER use passport expiry for this field. Set to "Not found" if no CNIC front found.
- cnicAddressRomanUrdu: Scan ALL uploaded documents for a Pakistani CNIC back side. The back may appear as a separate image, OR combined with the front on the same PDF page (one card above the other). The back is identified by these markers: 
  (1) CNIC number (XXXXX-XXXXXXX-X) printed top-right; 
  (2) small photo top-left; 
  (3) black QR code top-right; 
  (4) two lines of Urdu address text — upper line starting with "موجودہ پتہ" and the lower line starting with or containing "مستقل پتہ" — the address text follows immediately after this label on the same line, separated by a colon 
  پتہ"; (5) registration number below QR code; 
  (6) "Registrar General of Pakistan" bottom-left. IMPORTANT:  Extract ONLY the مستقل پتہ line.
- financialHolder: full name of account holder as printed on bank statement.
- financialBalance: extract the MOST RECENT closing/available balance from the student's or confirmed sponsor's primary bank statement.
- academicResult: list EACH qualification on a SEPARATE line. Format: "[Degree] ([Year if known]): [Result/Grade]".
- studyGap: Follow these steps exactly:
  (1) List every qualification with its completion year in chronological order.
  (2) Estimate the START year of each qualification using standard durations: Matric/O-Levels=2yr, Intermediate/FSc=2yr, Bachelor's=4yr, Master's=2yr, PhD=4yr.
  (3) For each consecutive pair, calculate gap between previous completion year and next estimated start year. Flag if over 24 months.
  (4) Calculate gap between most recent qualification completion year and the CURRENT YEAR from TODAY'S DATE at the top of this prompt. Flag if over 24 months.
  (5) Format: "X year(s) gap between [Qual A] ([Year]) and [Qual B / present] ([Year])".
  (6) If NO gap exceeds 24 months, output "Not found".
- ieltsScore: Overall band score as a string (e.g. "6.5"). Extract from ANY English test document labelled IELTS or IELTS UKVI. "Not found" if absent.
- toeflScore: Total score as a string (e.g. "95"). Extract from TOEFL iBT/ITP result documents. "Not found" if absent.
- pteScore: Overall score as a string (e.g. "65"). Extract from PTE Academic or PTE UKVI result documents. "Not found" if absent.
- englishTests: ARRAY — one entry per distinct English test result/certificate found. ALWAYS populate this array whenever ANY English test document is present. Fields:
  * type: exact test name — "IELTS", "IELTS UKVI", "TOEFL iBT", "PTE Academic", "PTE UKVI", "Duolingo", "OET", "Cambridge", or other exact name as printed
  * overallScore: overall band/score as printed (e.g. "6.5", "79", "65")
  * testDate: date of test as printed (e.g. "25 Jun 2024"), "Not found" if absent
  * urn: ANY reference/registration/URN number found on the certificate. This includes SELT URN numbers, UKVI reference numbers, candidate numbers, TRF numbers, score report codes — ANY unique identifier printed on the certificate. Format: exactly as printed (e.g. "PEL/240625/83908/PTE004074785", "UK12345678", "TRF-2024-XXXX"). "Not found" if absent.
  * subScores: object with listening/reading/writing/speaking. Use the numeric value as a string (e.g. "6.5", "24"). Use "" for any sub-score not shown on the document.
- otherEnglishTest: ONLY populate if an actual test RESULT or CERTIFICATE document is present that is NOT already covered by ieltsScore, toeflScore, or pteScore fields.
- mediumOfInstruction: ONLY populate if a dedicated MOI (Medium of Instruction) certificate or letter is present. Extract the full value as: "[Language] — [Institution Name as printed on the letter]" (e.g. "English — University of Punjab", "English — Bahria University Islamabad"). If the institution name is not on the MOI letter, use just the language (e.g. "English"). "Not found" if no MOI document is present.
- nameMismatches: ARRAY of name discrepancies. Compare: (1) passport name vs academic transcripts vs degree certificates — flag any spelling difference. (2) If a CNIC shows "Husband Name" field, flag it if that husband name does not appear as a separate identified person. (3) If FRC lists members whose names differ from the student's passport name, flag each one. Each entry MUST include: documentName (exact filename or document type where the mismatch was found, e.g. "Bachelors Transcript" or "CNIC Front"), nameFound (the name as it appears on that document), and issue (description of the mismatch).
- detectedDocs: ARRAY of special documents. You MUST scan EVERY uploaded document for ALL types listed below. If a document of that type is present, you MUST include it — omitting any detected document is a critical error. Extract ALL visible fields:
  * FRC (Family Registration Certificate): { type:"FRC", reference, date, memberCount, members:[{name,cnic,dob,relation}] } — list EVERY member shown including the applicant.
  * MRC (Marriage Registration Certificate): { type:"MRC", reference, date, husbandName, wifeName, registrationNo }.
  * IHS Receipt: { type:"IHS Receipt", reference, amount, date, expiry }.
  * TB Certificate: { type:"TB Certificate", reference, result:"Clear|Not Clear", date, expiry, institution }.
  * Recommendation Letter / Reference Letter: { type:"Recommendation Letter", from, role, institution, date, notes } — include EVERY recommendation or reference letter found, no exceptions. "from" = full name of signatory, "role" = their job title/designation, "institution" = their organisation.
  * Experience / Employment Letter / Work Experience Letter: { type:"Experience Letter", from, role, institution, date, employeeRole, duration, notes } — any letter confirming work history. "from" = signatory name, "role" = signatory title, "institution" = employer name, "employeeRole" = the student's job title, "duration" = period of employment.
  * No Objection Certificate (NOC): { type:"NOC", from, role, institution, date, notes } — any NOC from employer, parent, or guardian.
  * Sponsor Letter / Financial Sponsor Declaration: { type:"Sponsor Letter", from, role, institution, date, amount, notes }.
  * University Fee Receipt: { type:"University Fee Receipt", reference, amount, date, institution }.
  * Application Fee Receipt: { type:"Application Fee Receipt", reference, amount, date, institution }.
  * Visa Fee Receipt: { type:"Visa Fee Receipt", reference, amount, date, institution }.
  * Health Insurance Certificate: { type:"Health Insurance", reference, amount, date, expiry }.
  * Accommodation Confirmation: { type:"Accommodation Confirmation", institution, date, notes }.
  * Scholarship / Funding Letter: { type:"Scholarship Letter", reference, amount, date, institution, notes }.
  * Gap / Explanation Letter: { type:"Gap Letter", date, institution, notes }.
  * Death Certificate: { type:"Death Certificate", name, date, notes }.
  * Any other official letter or certificate not listed above that a visa officer would consider relevant: { type:"[document type as named on the document]", date, institution, notes }.
  If none of these are present, return [].
- findings: Array [{title,detail}] of notable discoveries that fall OUTSIDE the six structured summary categories — e.g. unexpected documents (death certificate, foreign visa stamps, disputed FRC entries), immigration history anomalies, sponsor inconsistencies, anything a senior counsellor needs to flag. Be specific. Empty [] if nothing notable.
- rejections: all visa rejections, admission rejections, and deferments found. Empty array [] if none.
- missingDocuments: flag missing required documents, unclear financial evidence, unverified sponsor docs, study gaps over 24 months.
- redFlags: high severity: expired passport, previous visa refusal, insufficient funds. Medium: study gap over 2 years, name mismatch, conditional offer with unmet conditions. Low: missing minor docs.
- summary: Write EXACTLY one sentence per category below, in this exact order. Each sentence MUST begin with the ALL-CAPS label, followed by a colon and detail drawn ONLY from that category's data source. Use ONLY these labels in this order:
  1. STRONG FINANCIAL POSITION / GOOD FINANCIAL POSITION / WEAK FINANCIAL POSITION — draw ONLY from financialBalance and financialHolder fields
  2. EXCELLENT ACADEMIC RECORD / GOOD ACADEMIC RECORD / WEAK ACADEMIC RECORD — draw ONLY from academicResult field
  3. ENGLISH PROFICIENCY / ENGLISH PROFICIENCY ABSENT — draw ONLY from englishTests array; use ENGLISH PROFICIENCY if any test exists, ENGLISH PROFICIENCY ABSENT if none
  4. IDENTITY VERIFIED / IDENTITY INCOMPLETE — draw ONLY from passportNumber, passportExpiry, cnicNumber, cnicExpiry, TB certificate, IHS receipt
  5. DOCUMENTS COMPLETE / MISSING DOCUMENTS — verdict on the FULL visa document package (passport, CNIC, offer letter, CAS, financials, TB, IHS); NEVER use DOCUMENTS COMPLETE if anything is missing; use MISSING DOCUMENTS and list ALL absent items
  6. CRITICAL GAPS / MAJOR BLOCKER / CRITICAL BLOCKER — only if admission docs (offer letter, CAS) or other visa-critical items are absent and prevent assessment; OMIT this line if no blocker exists
  RULES: Each label appears AT MOST ONCE. DOCUMENTS COMPLETE and MISSING DOCUMENTS are mutually exclusive — never both. English test results MUST use ENGLISH PROFICIENCY label, never DOCUMENTS COMPLETE.
Scoring rules — follow these EXACTLY, do not invent your own formula:
documentScore: Start at 0. Add points ONLY when the field is genuinely extracted and non-empty (not "Not found"):
  +25 if passportNumber AND passportExpiry are both present and passportExpiry is a future date
  +10 if only one of passportNumber or passportExpiry is present (partial)
  +20 if englishTests array has at least one entry with a real overallScore (or ieltsScore/toeflScore/pteScore is filled)
  +15 if financialBalance is present
  +15 if academicResult is present
  +10 if cnicNumber is present
  +10 if offerLetters array has at least one entry with a university name
  +5  if casDocuments array has at least one entry with a casNumber or university
  IMPORTANT: Every item in missingDocuments REDUCES the category score to 0 for that item — a missing doc cannot also score points.
  documentScore MUST be 0 if BOTH passportNumber and passportExpiry are absent.
  documentScore of 100 is ONLY possible if all 7 categories above are satisfied with real data.
financialScore: 0–100 based on financial evidence quality and fund sufficiency.
academicScore: 0–100 based on academic qualifications, GPA, and English test scores combined.
overallScore = financialScore×0.40 + academicScore×0.30 + documentScore×0.30. Round to integer.
Return ONLY the JSON object.`;

    // ── Estimate tokens + tier BEFORE the call ───────────────────────────
    // estimateTokens() uses file size/type heuristics matching worker tokenTier().
    // Drives: (a) pre-flight credit gate, (b) usage_log estimated vs actual.
    const estimatedTokens = estimateTokens(docsForAnalysis);
    const creditsCost     = tokenTierClient(estimatedTokens);

    // ── Optimistic pre-deduct — update bar immediately so user sees cost ──
    // Worker will return the real analyses_remaining after the call and
    // callAPI will correct the bar to the authoritative value then.
    setOrgCredits(prev => prev !== null ? Math.max(0, prev - creditsCost) : prev);

    // ── SINGLE CALL — billable, prompt cached, tiered credits ──────────
    // MAIN_PROMPT passed as `system` so the Worker can cache it separately
    const content = await buildContent(docsForAnalysis, "", personTags, qualitiesRef.current);

    // Guard: abort before spending a credit if buildContent produced no real
    // document/image blocks (happens when docsForAnalysis is empty after filtering,
    // or PDF slicing silently produced nothing). Without this, Claude receives an
    // almost-empty message, returns ~3 tokens, parseJSON fails, and 1 credit is wasted.
    const hasDocContent = content.some(b => b.type === "image" || b.type === "document");
    if (!hasDocContent) {
      throw new Error("No documents could be prepared for analysis — all files may have been excluded or failed to load. Please check your uploads and try again.");
    }

    const raw = await callAPI(content, 3500, {
      billable:         true,
      creditsCost,
      estimatedTokens,
      system:           MAIN_PROMPT,
    });
    if (!raw || raw.trim().length < 10) {
      console.error("❌ [ANALYSIS] Empty or near-empty response from Claude:", JSON.stringify(raw));
      throw new Error("Analysis returned an empty response — the document set may be too large. Try removing some files and re-running.");
    }
    console.log("🔍 [ANALYSIS] Raw response length:", raw.length, "| Starts with:", raw.slice(0, 80));
    const parsed = parseJSON(raw);

    if (!parsed) {
      console.error("❌ [ANALYSIS] Failed to parse JSON. Raw response (first 500 chars):", raw.slice(0, 500));
      throw new Error("Could not parse analysis response — the AI returned an unexpected format. Please try again.");
    }

    const safeArr = (v) => Array.isArray(v) ? v : [];
    parsed.rejections        = safeArr(parsed.rejections);
    parsed.missingDocuments  = safeArr(parsed.missingDocuments);
    parsed.redFlags          = safeArr(parsed.redFlags);
    if (parsed.eligibility) parsed.eligibility.notes    = safeArr(parsed.eligibility?.notes);
    if (parsed.eligibility) parsed.eligibility.findings = safeArr(parsed.eligibility?.findings);
    if (parsed.studentProfile) parsed.studentProfile.offerLetters  = safeArr(parsed.studentProfile?.offerLetters);
    if (parsed.studentProfile) parsed.studentProfile.casDocuments   = safeArr(parsed.studentProfile?.casDocuments);
    if (parsed.studentProfile) parsed.studentProfile.englishTests   = safeArr(parsed.studentProfile?.englishTests);

    // ── Normalise scalar profile fields — any field the AI was asked for but
    //    returned empty/null/undefined becomes "Not found" so the red styling fires.
    if (parsed.studentProfile) {
      const SCALAR_FIELDS = [
        "fullName","dob","nationality","gender","city","mobileNumber","email",
        "passportNumber","passportExpiry","passportIssueDate","cnicNumber","cnicExpiry","cnicAddressRomanUrdu",
        "program","yearOfPassing","university","targetCountry",
        "financialBalance","financialHolder","academicResult","studyGap",
        "ieltsScore","toeflScore","pteScore","otherEnglishTest","mediumOfInstruction",
      ];
      for (const k of SCALAR_FIELDS) {
        const v = parsed.studentProfile[k];
        if (v === undefined || v === null || v === "" || v === "null" || v === "N/A") {
          parsed.studentProfile[k] = "Not found";
        }
      }
    }

    // ── Client-side passport number validation ──
    // Uses format check + MRZ sanity checks. Rejects format errors and
    // suspicious numbers (all-same-digit, sequential). Valid numbers pass
    // through — the check digit is shown in the UI for manual verification.
    if (parsed.studentProfile?.passportNumber) {
      const pn = (parsed.studentProfile.passportNumber || "").trim().toUpperCase();
      const v  = validatePassportNumber(pn);
      if (v === "format_error" || v === "suspicious") {
        parsed.studentProfile.passportNumber = "Not found";
      }
    }

    // ── MRZ hard override — last line of defence ──────────────────────────
    // If Gemini returned a checksum-validated MRZ for any passport in this
    // analysis, overwrite whatever Claude extracted with the verified values.
    // Claude's visual read of a multi-page PDF is less reliable than Gemini's
    // dedicated MRZ extraction with ICAO checksum validation.
    for (const doc of docsForAnalysis) {
      const mrz = qualities[doc.id]?.mrz;
      if (mrz?.valid && parsed.studentProfile) {
        parsed.studentProfile.passportNumber = mrz.passportNumber;
        if (mrz.expiry && mrz.expiry !== "Not found")       parsed.studentProfile.passportExpiry = mrz.expiry;
        if (mrz.dob    && mrz.dob    !== "Not found")       parsed.studentProfile.dob            = mrz.dob;
        if (mrz.nationality && mrz.nationality !== "")      parsed.studentProfile.nationality     = mrz.nationality;
        break; // only apply first valid passport MRZ (primary applicant)
      }
    }

    setResults(parsed);
    const migratedProfile = migrateOfferLetter({...parsed.studentProfile});
    setProfileData(migratedProfile);
    setProfileDirty(false);
    setLiveElig(null);
    setPreferredOfferIndex(0);
    // Auto-seed application targets from extracted offer letters (only if none set yet)
    setApplicationTargets(prev => {
      if (prev.length > 0) return prev;
      const fromOffers = makeTargetsFromOffers(
        migratedProfile.offerLetters || [],
        mergedRequirements
      );
      return fromOffers;
    });
    setReadinessModal(false);
    setReadinessSelection(new Set());
    const name = parsed.studentProfile.fullName;
    if (name && name !== "Not found") setRenameSuggestion(name.replace(/\s+/g, "_"));
    // Mark all currently analysed docs
    setAnalysedDocIds(new Set(docs.map(d => d.id)));
    // Clear isNew flag on all docs
    setDocs(p => p.map(d => ({ ...d, isNew: false })));
    if (window.innerWidth <= 768) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  } catch(e) {
    const msg = e.message || "";
    if (msg.toLowerCase().includes("stream") || msg.toLowerCase().includes("body") || msg.toLowerCase().includes("too big") || msg.toLowerCase().includes("payload")) {
      setError("Request too large — remove some documents and analyse, then add the remaining documents back to update the profile. Compress PDFs at ilovepdf.com if needed.");
    } else {
      setError(msg || "Analysis failed.");
    }
  } finally {
    setLoading(false);
  }
}

  async function supplementalUpdate() {
    const newDocs = docs.filter(d => d.isNew && !d.tooLarge);
    if (!newDocs.length || !results) return;
    setLoading(true); setError("");
    try {
      // Optimistic pre-deduct — supplemental calls are always Tier 1 (small patch doc set)
      const suppTokens  = estimateTokens(newDocs);
      const suppCredits = tokenTierClient(suppTokens);
      setOrgCredits(prev => prev !== null ? Math.max(0, prev - suppCredits) : prev);

      // Static instructions → system (cached by worker via cache_control: ephemeral).
      // Dynamic existing profile JSON → user message content, alongside the new doc images.
      // This avoids re-billing the instruction block (~400 tokens) on every supplemental call,
      // and reduces max_tokens from 2500 → 1200 since this is a patch, not a full extraction.
      const MERGE_SYSTEM = `You are an expert student visa counselor assistant. Additional supporting documents are provided. A profile has already been extracted from previous documents — use ONLY these new documents to SUPPLEMENT and IMPROVE the existing data. Do not repeat or regress already-found fields unless you find a correction. Return ONLY valid JSON in the exact same schema as the existing profile — no markdown, no explanation.`;

      const existingContext = `EXISTING PROFILE:
${JSON.stringify(results?.studentProfile || {}, null, 0)}

EXISTING FLAGS:
Missing docs: ${JSON.stringify(results?.missingDocuments || [])}
Red flags: ${JSON.stringify(results?.redFlags || [])}

Analyse ONLY the new documents above and return updated/additional fields. If a field was already found and these docs add nothing new, return the same value.`;

      const content = await buildContent(newDocs, existingContext, personTags, qualities);
      const raw = await callAPI(content, 1200, { system: MERGE_SYSTEM });
      const parsed2 = parseJSON(raw);

      if (!parsed2) throw new Error("Could not parse supplemental response.");

      // Deep merge into existing results
      const safeArr = (v) => Array.isArray(v) ? v : [];
      const merged = {
        ...results,
        studentProfile: {
          ...results.studentProfile,
          ...Object.fromEntries(
            Object.entries(parsed2?.studentProfile || {}).filter(([k, v]) => {
              const existing = results.studentProfile?.[k];
              return v && v !== "Not found" && v !== "" && v !== 0 &&
                (!existing || existing === "Not found" || existing === "");
            })
          ),
          offerLetters:   [...safeArr(results.studentProfile?.offerLetters),   ...safeArr(parsed2?.studentProfile?.offerLetters)],
          casDocuments:   [...safeArr(results.studentProfile?.casDocuments),   ...safeArr(parsed2?.studentProfile?.casDocuments)],
          englishTests:   [...safeArr(results.studentProfile?.englishTests),   ...safeArr(parsed2?.studentProfile?.englishTests).filter(t => !safeArr(results.studentProfile?.englishTests).some(x => x.type === t.type))],
          detectedDocs:   [...safeArr(results.studentProfile?.detectedDocs),   ...safeArr(parsed2?.studentProfile?.detectedDocs)],
          nameMismatches: [...safeArr(results.studentProfile?.nameMismatches), ...safeArr(parsed2?.studentProfile?.nameMismatches)],
        },
        missingDocuments: [
          ...safeArr(results.missingDocuments),
          ...safeArr(parsed2?.missingDocuments).filter(m => !safeArr(results.missingDocuments).some(x => x.document === m.document)),
        ],
        redFlags: [
          ...safeArr(results.redFlags),
          ...safeArr(parsed2?.redFlags).filter(f => !safeArr(results.redFlags).some(x => x.flag === f.flag)),
        ],
        rejections: [...safeArr(results.rejections), ...safeArr(parsed2?.rejections)],
        eligibility: parsed2?.eligibility?.overallScore > (results?.eligibility?.overallScore || 0)
          ? parsed2.eligibility : results.eligibility,
      };

      // Passport validation
      if (merged.studentProfile?.passportNumber) {
        const pn = (merged.studentProfile.passportNumber || "").trim().toUpperCase();
        const v  = validatePassportNumber(pn);
        if (v === "format_error" || v === "suspicious") merged.studentProfile.passportNumber = "Not found";
      }

      setResults(merged);
      const mergedProfile = migrateOfferLetter({ ...merged.studentProfile });
      setProfileData(mergedProfile);
      setProfileDirty(false);
      // Merge any newly-discovered offer letters into targets (skip duplicates by country+uni)
      setApplicationTargets(prev => {
        const fromOffers = makeTargetsFromOffers(mergedProfile.offerLetters || [], mergedRequirements);
        if (!fromOffers.length) return prev;
        const existingKeys = new Set(
          prev.map(t => `${t.country}|${t.countryOther}|${t.university}|${t.universityOther}`.toLowerCase())
        );
        const novel = fromOffers.filter(t => {
          const k = `${t.country}|${t.countryOther}|${t.university}|${t.universityOther}`.toLowerCase();
          return !existingKeys.has(k);
        });
        return [...prev, ...novel].slice(0, 4); // cap at 4
      });
      // Mark new docs as analysed
      setAnalysedDocIds(prev => new Set([...prev, ...newDocs.map(d => d.id)]));
      setDocs(p => p.map(d => ({ ...d, isNew: false })));
    } catch(e) {
      const msg = e.message || "";
      if (msg.toLowerCase().includes("stream") || msg.toLowerCase().includes("body") || msg.toLowerCase().includes("too big")) {
        setError("New documents too large — compress PDFs at ilovepdf.com and try again.");
      } else {
        setError(msg || "Supplemental update failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true); setSearchResults(null);
    try {
      // Search operates entirely on extracted profile + results JSON — zero document re-sending.
      // This avoids re-paying image/PDF input tokens (previously 10k–50k tokens per search).
      const profileCtx = results
        ? buildChatContext(profileData, results, docs)
        : `Uploaded documents:\n${docs.map(d=>`- ${d.renamed||d.file.name} [${d.type}]`).join("\n")}`;

      const prompt = `You are a visa document assistant. A counsellor is searching for specific information.

EXTRACTED PROFILE & ANALYSIS DATA:
${profileCtx}

SEARCH QUERY: "${searchQuery}"

Search the profile data above and return results. Return ONLY a JSON array — no markdown:
[{"filename":"field or section name","found":true,"snippet":"the exact value or relevant excerpt, max 120 chars"}]

Rules:
- Include an entry for each relevant field or section that matches the query.
- If nothing matches, return an empty array [].
- "filename" should be the field label (e.g. "IELTS Score", "Financial Balance", "Red Flags").
- "snippet" is the actual value found, not a description.`;

      const resp = await fetch(PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }],
        })),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      const raw = data.content?.map(b => b.text || "").join("") || "";
      setSearchResults(parseJSON(raw) || []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }

  function clearAll() {
    setDocs([]); setQualities({}); setResults(null); setProfileData({});
    setNotes(""); setSavedMsg(""); setError(""); setActiveCaseId(null);  setSearchQuery("");
    setSearchResults(null); setRenameSuggestion(""); setPreScanData(null);
    setPreferredOfferIndex(0);
    setDocTypes({}); setSubTypes({}); setPersonTags({}); setCustomLabels({}); setDocDepOpen({});
    setSpouseName(""); setProfileDirty(false); setLiveElig(null);
    setReadinessModal(false); setReadinessSelection(new Set());
    setChatMessages([]); setResumeText("");
    setAnalysedDocIds(new Set());
    setApplicationTargets([]);
    setExpiryDates({}); setExpiryDirty(false);
    setLeadStatus("None");
    try { window.storage.delete("visalens_v14_profile"); } catch {}
  }

  function setProfileDataDirty(updater) {
    setProfileData(updater);
    setProfileDirty(true);
  }
  function applyRenameAll() {
    if (!renameSuggestion) return;
    setDocs(p=>p.map(d=>{ const t=getDT(d.type).label.replace(/\s*\/\s*/g,"-").replace(/\s+/g,"_").replace(/[()]/g,""); const ext=d.file.name.split(".").pop()||""; return {...d,renamed:`${renameSuggestion}_${t}.${ext}`}; }));
  }
  function applyRenameOne(id, type) {
    const t=getDT(type).label.replace(/\s*\/\s*/g,"-").replace(/\s+/g,"_").replace(/[()]/g,"");
    const ext=docs.find(d=>d.id===id)?.file.name.split(".").pop()||"";
    setDocs(p=>p.map(d=>d.id===id?{...d,renamed:`${renameSuggestion}_${t}.${ext}`}:d));
  }

  function handleSaveNotes() { setSavedMsg("Notes saved"); setTimeout(()=>setSavedMsg(""),2500); }
  async function handleSaveCase() {
  if (!results) return;
  setSavedMsg("Saving…");

  if (activeCaseId) {
    const profileWithExpiry = { ...profileData, expiryDates };
    const prevCase = cases.find(c => c.id === activeCaseId);
    const leadChanged =
      prevCase && (prevCase.leadStatus || "None") !== (leadStatus || "None");
    const statusTs = new Date().toISOString();
    await updateCaseInSupabase(activeCaseId, notes, preferredOfferIndex, sopText, universitySop, visaSop, resumeText, applicationTargets, leadStatus, profileWithExpiry, expiryDates, results);
    setExpiryDirty(false);
    const primaryTarget  = applicationTargets[0];
    const primaryCountry = primaryTarget ? (primaryTarget.countryOther || primaryTarget.country || "") : "";
    const { expiry_date: savedExpiryDate, expiry_doc_type: savedExpiryDocType } = computeSoonestExpiry(expiryDates, profileData);
    setCases(prev => prev.map(c =>
      c.id === activeCaseId ? { ...c, notes, sopText, universitySop, visaSop, resumeText, preferredOfferIndex,
        applicationTargets, leadStatus,
        targetCountry: primaryCountry || c.targetCountry,
        expiryDate:    savedExpiryDate    || c.expiryDate,
        expiryDocType: savedExpiryDocType || c.expiryDocType,
        profileData:   profileWithExpiry,
        results:       results,
        overallScore:  results?.eligibility?.overallScore ?? c.overallScore,
        ...(leadChanged ? { statusUpdatedAt: statusTs } : {}),
      } : c
    ));
    loadExpiryAlertsFromSupabase().then(setExpiryAlerts);
    setSavedMsg("Case updated ✓");
    setLastSaved(Date.now());
  } else {
    const saved = await saveCaseToSupabase(profileData, results, docs, notes, preferredOfferIndex, counsellorName, sopText, universitySop, visaSop, resumeText, applicationTargets, leadStatus);
    if (saved?.id) {
      setActiveCaseId(saved.id);
      const remoteCases = await loadCasesFromSupabase();
      setCases(remoteCases);
      setCaseListPage(0);
      setHasMoreCases(true);
      const newTotal = await countCasesInSupabase();
      setTotalCases(newTotal);
      loadExpiryAlertsFromSupabase().then(setExpiryAlerts);
      setSavedMsg(`Saved ✓  ${saved.caseSerial || ""}`);
      setCounsellorName("");
    } else {
      const newId = Date.now().toString();
      const updated = [{ id: newId, savedAt: new Date().toISOString(), results, profile: profileData, notes, sopText, universitySop, visaSop, resumeText, preferredOfferIndex, applicationTargets }, ...cases];
      setActiveCaseId(newId);
      setCases(updated); persist(updated);
      setSavedMsg("Saved locally (no org_id)");
      setCounsellorName("");
    }
  }
  setTimeout(() => setSavedMsg(""), 2500);
}
  const handleLoadCase = useCallback(async function handleLoadCase(c) {
    if (docs.length > 0 || results) {
      const confirmed = window.confirm(
        "Loading this case will clear your current session. Continue?"
      );
      if (!confirmed) return;
    }

    // If we only have the summary row, fetch the full case first
    let fullCase = c;
    if (c._summaryOnly) {
      setSavedMsg("Loading case data…");
      const loaded = await loadFullCase(c.id);
      if (!loaded) {
        setSavedMsg("Could not load case — please try again.");
        setTimeout(() => setSavedMsg(""), 2500);
        return;
      }
      fullCase = loaded;
      // Cache into local state so next open is instant (no re-fetch)
      setCases(prev => prev.map(x => x.id === c.id ? { ...x, ...fullCase, _summaryOnly: false } : x));
      setSavedMsg("Case loaded successfully");
      setTimeout(() => setSavedMsg(""), 2000);
    }

    // Clear ALL state first (using the same logic as the Clear button)
    clearAll();

    // Set the loaded case data
    setActiveCaseId(fullCase.id);
    setActiveStudentId(fullCase.id);
    setResults(fullCase.results || null);
    
    // Load profile data with proper migration
    const profileToLoad = fullCase.profile || fullCase.results?.studentProfile || {};
    const migratedProfile = migrateOfferLetter(profileToLoad);
    setProfileData(migratedProfile);
    
    setPreferredOfferIndex(fullCase.preferredOfferIndex || 0);
    setNotes(fullCase.notes || "");
    setSopText(fullCase.sopText || "");
    setUniversitySop(fullCase.universitySop || fullCase.sopText || "");
    setVisaSop(fullCase.visaSop || "");
    setResumeText(fullCase.resumeText || "");
    setCounsellorName(fullCase.counsellorName || "");
    setApplicationTargets(Array.isArray(fullCase.applicationTargets) ? fullCase.applicationTargets : []);
    setLeadStatus(fullCase.leadStatus || "None");
    setProfileDirty(false);
    setLiveElig(null);
    setExpiryDates(migratedProfile?.expiryDates || {});
    setExpiryDirty(false);
    setAnalysedDocIds(new Set());
    setDriveSaveResult(null);
    
    // Switch to analyze tab
    setTab("analyze");
  }, [docs, results]); // useCallback — ensures Dashboard always gets fresh reference

  // Jump from StudentDashboard → ProgramMatcher with a specific student loaded
  const handleJumpToMatcher = useCallback(async (studentId) => {
    setActiveStudentId(studentId);
    setTab('match');
    try {
      const { data, error } = await supabase
        .from('cases')
        .select('profile_data, student_name')
        .eq('id', studentId)
        .single();
      if (error) { console.error('[App] jump-to-matcher load error:', error); return; }
      if (data?.profile_data) {
        // Ensure ProgramMatcher can detect a "new student" jump via profile.id
        setProfileData({ ...data.profile_data, id: studentId, student_name: data.student_name || data.profile_data?.student_name });
      }
    } catch (e) {
      console.error('[App] jump-to-matcher load error:', e);
    }
  }, []);

// ── updateCaseStatus ─────────────────────────────────────────────────────────
// Handles the OPTIMISTIC UI transition for student stages.
// This makes moving a student feel instant while syncing in the background.
const updateCaseStatus = async (caseId, newStatus) => {
  // 1. Snapshot for rollback if the network fails
  const previousCases = [...cases];
  
  // 2. OPTIMISTIC UPDATE: Update local state IMMEDIATELY
  // Note: We use 'leadStatus' to match your existing state variable names
  setCases(prev => prev.map(c => 
    c.id === caseId 
      ? { ...c, leadStatus: newStatus, isOptimistic: true, error: null } 
      : c
  ));

  try {
    const session = getOrgSession();
    if (!session?.org_id) throw new Error("No session");

    // 3. API Request: Matches your Supabase column 'lead_status'
    const { error } = await supabase
      .from('cases')
      .update({ 
        lead_status: newStatus,
        status_updated_at: new Date().toISOString() 
      })
      .eq('id', caseId)
      .eq('org_id', session.org_id);

    if (error) throw error;

    // 4. Success: Clear the 'optimistic' flag
    setCases(prev => prev.map(c => 
      c.id === caseId ? { ...c, isOptimistic: false } : c
    ));

  } catch (err) {
    // 5. ROLLBACK: If it fails, snap back to the previous state
    console.error("Pipeline update failed:", err.message);
    setCases(previousCases);
    
    // Optional: Mark the specific card with an error
    setCases(prev => prev.map(c => 
      c.id === caseId ? { ...c, error: "Failed to save status." } : c
    ));
  }
};

  async function handleDeleteCase(id) {
  await deleteCaseFromSupabase(id);
  const u = cases.filter(c => c.id !== id);
  setCases(u); persist(u);
  }
  async function handleLoadMoreCases() {
    const nextPage = caseListPage + 1;
    const { cases: more, hasMore } = await loadMoreCases(nextPage);
    setCaseListPage(nextPage);
    setHasMoreCases(hasMore);
    setCases(prev => {
      const existingIds = new Set(prev.map(c => c.id));
      return [...prev, ...more.filter(c => !existingIds.has(c.id))];
    });
  }
  async function updateCaseInSupabase(id, notesText, prefIdx, sopText, uniSop, visaSop, resumeText, applicationTargets = [], leadStatus = "None", updatedProfile = null, expiryDatesMap = {}, updatedResults = null) {
  const session = getOrgSession();
  if (!session?.org_id) return;
  try {
    const primaryTarget  = Array.isArray(applicationTargets) ? applicationTargets[0] : null;
    const primaryCountry = primaryTarget ? (primaryTarget.countryOther || primaryTarget.country || "") : "";
    const { expiry_date, expiry_doc_type } = computeSoonestExpiry(expiryDatesMap, updatedProfile);
    const row = cases.find(c => c.id === id);
    const prevLead = row ? (row.leadStatus || "None") : null;
    const nextLead = leadStatus || "None";
    const leadStatusChanged = row != null && prevLead !== nextLead;

    // Calculate readiness and viability scores for score_data
    const profileToScore = updatedProfile || row?.profileData || {};
    const resultsToScore = updatedResults || row?.results || {};
    const readinessScore = computeDocScore(profileToScore, resultsToScore);
    const viabilityScoreData = viabilityScore(profileToScore);
    const scoreData = {
      readiness: {
        score: readinessScore.score,
        breakdown: readinessScore.breakdown
      },
      viability: {
        score: viabilityScoreData.score,
        confidence: viabilityScoreData.confidence,
        breakdown: viabilityScoreData.breakdown
      },
      metadata: {
        calculatedAt: new Date().toISOString(),
        version: "1.0"
      }
    };

    const updatePayload = {
      notes:                notesText || "",
      sop_text:             sopText || "",
      university_sop:       uniSop || "",
      visa_sop:             visaSop || "",
      resume_text:          resumeText || "",
      preferred_offer_index: prefIdx || 0,
      application_targets:  applicationTargets,
      lead_status:          nextLead,
      updated_at:           new Date().toISOString(),
      ...(updatedProfile ? { profile_data: updatedProfile } : {}),
      // Write results + overall_score when provided (e.g. after re-assess)
      // so StudentDashboard's realtime subscription picks up the new doc score
      ...(updatedResults ? {
        results:       updatedResults,
        overall_score: updatedResults?.eligibility?.overallScore ?? (row?.overallScore ?? 0),
      } : {}),
      ...(expiry_date ? { expiry_date, expiry_doc_type } : {}),
      ...(expiryDatesMap?.counsellorEmail ? { counsellor_email: expiryDatesMap.counsellorEmail } : {}),
      ...(leadStatusChanged ? { status_updated_at: new Date().toISOString() } : {}),
      score_data:            scoreData,
    };
    if (primaryCountry) updatePayload.target_country = primaryCountry;
    const { error } = await supabase.from("cases")
      .update(updatePayload)
      .eq("id", id)
      .eq("org_id", session.org_id);
    if (error) console.error("Supabase update error:", error);
  } catch (e) { console.error("Supabase update error:", e); }
}
async function renameCounsellorInSupabase(oldName, newName) {
  const session = getOrgSession();
  if (!session?.org_id) return;
  try {
    const { error } = await supabase.from('cases')
      .update({ counsellor_name: newName })
      .eq('counsellor_name', oldName)
      .eq('org_id', session.org_id);
    if (error) console.error('Rename error:', error);
  } catch (e) { console.error('Rename error:', e); }
}

async function mergeCounsellorsInSupabase(sourceName, targetName) {
  const session = getOrgSession();
  if (!session?.org_id) return;
  try {
    const { error } = await supabase.from('cases')
      .update({ counsellor_name: targetName })
      .eq('counsellor_name', sourceName)
      .eq('org_id', session.org_id);
    if (error) console.error('Merge error:', error);
  } catch (e) { console.error('Merge error:', e); }
}

  const reAssessLastRun = useRef(0);

  async function reAssess() {
    if (!results || !profileDirty) return;
    // 30-second cooldown — prevents repeated uncached calls on every edit
    const now = Date.now();
    if (now - reAssessLastRun.current < 30_000) {
      setSavedMsg("Please wait 30 s before re-assessing again");
      setTimeout(() => setSavedMsg(""), 2500);
      return;
    }
    reAssessLastRun.current = now;
    setReassessing(true);
    try {
      const p = profileData;
      const offers = Array.isArray(p.offerLetters) ? p.offerLetters : [];
      const englishLines = (() => {
        if (Array.isArray(p.englishTests) && p.englishTests.length > 0) {
          return p.englishTests.map(et => {
            const subs = et.subScores ? Object.entries(et.subScores)
              .filter(([,v]) => v && v !== "")
              .map(([k,v]) => `${k[0].toUpperCase()}${k.slice(1)}:${v}`)
              .join(" ") : "";
            const urn  = et.urn && et.urn !== "Not found" ? ` | URN: ${et.urn}` : "";
            const date = et.testDate && et.testDate !== "Not found" ? ` (${et.testDate})` : "";
            return `${et.type||"English Test"}: ${et.overallScore||"Not found"}${date}${subs ? ` | ${subs}` : ""}${urn}`;
          }).join("\n");
        }
        const parts = [];
        if (p.ieltsScore && p.ieltsScore !== "Not found") parts.push(`IELTS: ${p.ieltsScore}`);
        if (p.toeflScore && p.toeflScore !== "Not found") parts.push(`TOEFL: ${p.toeflScore}`);
        if (p.pteScore   && p.pteScore   !== "Not found") parts.push(`PTE: ${p.pteScore}`);
        return parts.length ? parts.join("\n") : "Not found";
      })();

      // Static instruction block → system (cached). Dynamic profile data → user message.
      // Splitting this way lets the worker cache the instruction block across re-assess calls.
      const REASSESS_SYSTEM = `You are an expert student visa counsellor assistant performing a re-assessment. You will receive an edited student profile. Based ONLY on that profile data, return a JSON eligibility update. Do not re-read documents. Return ONLY valid JSON — no markdown, no explanation.
{"eligibility":{"overallScore":0,"financialScore":0,"academicScore":0,"documentScore":0,"summary":"","notes":[],"findings":[]},"missingDocuments":[{"document":"","reason":""}],"redFlags":[{"flag":"","severity":"high|medium|low","detail":""}]}
Rules: scores 0-100. Reflect improvements from edited fields.
Summary: Write one sentence per category in this exact order using ONLY these labels:
1. STRONG/GOOD/WEAK FINANCIAL POSITION — from financial balance only
2. EXCELLENT/GOOD/WEAK ACADEMIC RECORD — from academic results only
3. ENGLISH PROFICIENCY / ENGLISH PROFICIENCY ABSENT — from English tests only
4. IDENTITY VERIFIED / IDENTITY INCOMPLETE — from passport + CNIC only
5. DOCUMENTS COMPLETE / MISSING DOCUMENTS — full package verdict; mutually exclusive, never both
6. CRITICAL GAPS / MAJOR BLOCKER / CRITICAL BLOCKER — only if visa-critical docs absent; omit if not applicable
Each label used at most once. English test results must use ENGLISH PROFICIENCY label only, never DOCUMENTS COMPLETE.
Findings: Array of {title, detail} for anything notable not covered by the structured labels above.`;

      // ── Pipeline context injection ────────────────────────────────────────
      // leadStatus and recent notes are written by the Dashboard but were
      // previously invisible to re-assess. Including them here prevents the
      // AI from scoring a student as "intake stage" when they've already been
      // moved to "Application Submitted" or had a visa appointment booked.
      //
      // We take the last 3 note lines only — sending the full notes log could
      // push the prompt over budget and most of it is stale context anyway.
      // The slice is done on non-empty lines to avoid counting blank separators.
      const recentNoteLines = (notes || "")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .slice(-3)
        .join(" | ");

      const profileSummary = `EDITED STUDENT PROFILE:
Name: ${p.fullName||"Not found"}
DOB: ${p.dob||"Not found"}
Nationality: ${p.nationality||"Not found"}
Passport: ${p.passportNumber||"Not found"} (expires ${p.passportExpiry||"Not found"})
Offer Letters: ${offers.length ? offers.map((o,i)=>`${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join(" / ") : "None"}
Highest Qualification: ${p.program||"Not found"} (${p.yearOfPassing||"year unknown"})
University: ${p.university||"Not found"}
Academic Results: ${p.academicResult||"Not found"}
Study Gap: ${p.studyGap||"None"}
English Proficiency:
${englishLines}
Other English Test/Cert: ${p.otherEnglishTest||"Not found"}
Medium of Instruction: ${p.mediumOfInstruction||"Not found"}
Financial Balance: ${p.financialBalance||"Not found"}
Financial Holder: ${p.financialHolder||"Not found"}
Funds Required: ${p.fundsRequired||"Not entered"}
Lead Status: ${leadStatus||"None"}
Recent Activity: ${recentNoteLines||"No recent notes"}
Previous Score: ${results.eligibility.overallScore}/100 | Missing: ${(results.missingDocuments||[]).map(m=>m.document).join(", ")||"None"} | Flags: ${(results.redFlags||[]).map(f=>`[${f.severity}] ${f.flag}`).join(", ")||"None"}`;

      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body:JSON.stringify(withOrg({
          model:"claude-haiku-4-5-20251001",
          max_tokens: 900,           // raised to fit findings array in output
          system: REASSESS_SYSTEM,   // cached by worker via cache_control: ephemeral
          messages:[{role:"user", content: profileSummary}],
        }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const raw    = data.content?.map(b=>b.text||"").join("")||"";
      const parsed = parseJSON(raw);
      if (parsed) {
        const toArr = (v, fallback) => Array.isArray(v) ? v : fallback;
        // Preserve findings from original analysis — reassess doesn't re-read docs
        // so can't discover new findings; keep existing ones unless AI returned new ones
        if (parsed.eligibility) {
          parsed.eligibility.findings = Array.isArray(parsed.eligibility.findings) && parsed.eligibility.findings.length > 0
            ? parsed.eligibility.findings
            : (results?.eligibility?.findings || []);
          parsed.eligibility.notes = toArr(parsed.eligibility.notes, []);
        }
        // Build the new results object in a local var so we can pass it
        // to Supabase AND to setResults in the same tick — no stale-closure risk.
        const newResults = {
          ...results,
          eligibility:      parsed.eligibility                          || results.eligibility,
          missingDocuments: toArr(parsed.missingDocuments, results.missingDocuments),
          redFlags:         toArr(parsed.redFlags,         results.redFlags),
        };
        setResults(newResults);
        setLiveElig(null);
        setProfileDirty(false);
        setSavedMsg("Re-assessment complete"); setTimeout(()=>setSavedMsg(""),3000);

        // ── Auto-save to Supabase ────────────────────────────────────────────
        // reAssess() previously only updated React state — it never wrote to
        // the DB. So StudentDashboard's realtime subscription never fired, and
        // DocChecklist / DocHealthChip kept reading stale profileData /
        // missingDocuments. Writing results + profile_data here fixes that.
        if (activeCaseId) {
          const profileWithExpiry = { ...profileData, expiryDates };
          await updateCaseInSupabase(
            activeCaseId,
            notes,
            preferredOfferIndex,
            sopText,
            universitySop,
            visaSop,
            resumeText,
            applicationTargets,
            leadStatus,
            profileWithExpiry,
            expiryDates,
            newResults,   // ← writes results col + overall_score so realtime fires
          );
          // Patch local cases state immediately (realtime has ~200 ms latency)
          setCases(prev => prev.map(c =>
            c.id === activeCaseId
              ? { ...c,
                  results:      newResults,
                  overallScore: newResults.eligibility?.overallScore ?? c.overallScore,
                  profileData:  profileData,
                }
              : c
          ));
        }
      }
    } catch(e) { setError("Re-assessment failed: " + (e.message||"Unknown error")); }
    finally { setReassessing(false); }
  }

  async function handleLoadRequirements(reqs, csvText) {
    setCustomRequirements(reqs);
    setReqsCsvText(csvText);
    // Save to Supabase (org-wide — all counsellors get it) and localStorage (fallback)
    try {
      const session = getOrgSession();
      if (session?.org_id) {
        await supabase
          .from('organizations')
          .update({ requirements_csv: csvText })
          .eq('id', session.org_id);
      }
    } catch {}
    try { await window.storage.set("visalens_v14_reqs", csvText); } catch {}
  }
  async function handleClearRequirements() {
    setCustomRequirements(null);
    setReqsCsvText("");
    // Clear from Supabase and localStorage
    try {
      const session = getOrgSession();
      if (session?.org_id) {
        await supabase
          .from('organizations')
          .update({ requirements_csv: null })
          .eq('id', session.org_id);
      }
    } catch {}
    try { await window.storage.delete("visalens_v14_reqs"); } catch {}
  }

  return (
    <ChatContext.Provider value={openChat}>
      {preview    && <PreviewModal doc={preview} onClose={()=>setPreview(null)}/>}
      {showReport && <ReportModal profile={profileData} results={results} onClose={()=>setShowReport(false)}/>}
      {showZip    && docs.length > 0 && (
        <ZipModal
          docs={docs}
          studentName={profileData?.fullName && profileData.fullName !== "Not found" ? profileData.fullName : ""}
          offerLetters={profileData?.offerLetters || []}
          docTypes={docTypes}     setDocTypes={setDocTypes}
          subTypes={subTypes}     setSubTypes={setSubTypes}
          personTags={personTags} setPersonTags={setPersonTags}
          customLabels={customLabels} setCustomLabels={setCustomLabels}
          spouseName={spouseName} setSpouseName={setSpouseName}
          onClose={()=>setShowZip(false)}
        />
      )}

      <div className={`app app--sidebar-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>

        {/* ── PERSISTENT LEFT SIDEBAR ── */}
        <aside className="app-sidebar" aria-label="Main navigation">

          {/* Sidebar header / branding */}
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-mark"><ShieldCheck size={15}/></div>
              {sidebarOpen && (
                <>
                  <span className="logo-name">VisaLens</span>
                  <span className="logo-tag">Pro</span>
                </>
              )}
            </div>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(o => !o)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? <ChevronDown size={14} style={{transform:"rotate(90deg)"}}/> : <ChevronDown size={14} style={{transform:"rotate(-90deg)"}}/>}
            </button>
            <NotificationBell session={orgSession} />
          </div>

          {/* Active student badge */}
          {profileData?.fullName && profileData.fullName !== "Not found" && (
            <div className="sidebar-student-badge" title="Currently loaded student">
              <div className="sidebar-student-avatar"><User size={12}/></div>
              {sidebarOpen && (
                <div className="sidebar-student-info">
                  <div className="sidebar-student-label">Active Case</div>
                  <div className="sidebar-student-name">{profileData.fullName}</div>
                </div>
              )}
            </div>
          )}

          {/* Nav items */}
          <nav className="sidebar-nav" role="tablist">
            <div className="sidebar-nav-section-label">{sidebarOpen && "Workspace"}</div>

            <button role="tab" aria-selected={tab==="home"} className={`sidebar-nav-item${tab==="home"?" on":""}`} onClick={()=>setTab("home")} title="Dashboard">
              <span className="sidebar-nav-icon"><LayoutDashboard size={16}/></span>
              {sidebarOpen && <span className="sidebar-nav-label">Home</span>}
            </button>

            {!orgSession?.restricted_tabs?.includes("analyze") && (
        <button role="tab" aria-selected={tab==="analyze"} className={`sidebar-nav-item${tab==="analyze"?" on":""}`} onClick={()=>setTab("analyze")} title="Analyse">
                <span className="sidebar-nav-icon"><FileText size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Analyse</span>}
              </button>
            )}

            {/* AI Chat is now embedded inline in the Analyser */}

            {(!orgSession?.restricted_tabs?.includes("resume") || !orgSession?.restricted_tabs?.includes("sop")) && (
              <button role="tab" aria-selected={tab==="sop_resume"} className={`sidebar-nav-item${tab==="sop_resume"?" on":""}`} onClick={()=>setTab("sop_resume")} title="SOP & CV Builder">
                <span className="sidebar-nav-icon"><BookOpen size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">SOP &amp; CV Builder</span>}
                {sopText && <span className="sidebar-nav-badge">✓</span>}
              </button>
            )}
      
      {!orgSession?.restricted_tabs?.includes("mock_interview") && (
            <button role="tab" aria-selected={tab === "mock_interview"} 
              className={`sidebar-nav-item${tab === "mock_interview" ? " on" : ""}`} 
              onClick={() => setTab("mock_interview")} 
              title="Mock Interview"
            >
              <span className="sidebar-nav-icon"><Mic size={16}/></span>
              {sidebarOpen && <span className="sidebar-nav-label">AI Interview Assistant</span>}
              {/* Optional: Add badge logic here if you want */}
            </button>
          )}

      <div className="sidebar-nav-divider"/>
            <div className="sidebar-nav-section-label">{sidebarOpen && "Tools"}</div>

            {!orgSession?.restricted_tabs?.includes("dashboard") && (
              <button role="tab" aria-selected={tab==="dashboard"} className={`sidebar-nav-item${tab==="dashboard"?" on":""}`} onClick={()=>setTab("dashboard")} title="Student Dashboard">
                <span className="sidebar-nav-icon"><LayoutDashboard size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Student Dashboard</span>}
                {totalCases > 0 && <span className={`sidebar-nav-badge${tab==="dashboard"?" sidebar-nav-badge--active":""}`}>{totalCases}</span>}
                {chatUnread > 0 && tab !== "dashboard" && (
                  <span
                    className="sidebar-nav-badge sidebar-nav-badge--warn"
                    title={`${chatUnread} unread chat message${chatUnread !== 1 ? "s" : ""}`}
                    style={{ background: "rgba(29,107,232,.15)", color: "#1D6BE8" }}
                  >
                    💬{chatUnread}
                  </span>
                )}
              </button>
            )}

            {/* Radar Intel — branch managers and owners only */}
            {(['org_owner','branch_manager'].includes(orgSession?.role) || !orgSession?.access_token) && !orgSession?.restricted_tabs?.includes("radar_intel") && (
              <button role="tab" aria-selected={tab==="radar_intel"} className={`sidebar-nav-item${tab==="radar_intel"?" on":""}`} onClick={()=>setTab("radar_intel")} title="Radar Intel">
                <span className="sidebar-nav-icon"><BarChart3 size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Lead Generator</span>}
                {totalCases > 0 && <span className={`sidebar-nav-badge${tab==="radar_intel"?" sidebar-nav-badge--active":""}`} style={{ background: tab==="radar_intel"?'var(--p)':'rgba(76,29,149,.15)', color: tab==="radar_intel"?'#fff':'#4C1D95' }}>AI</span>}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("match") && (
        <button role="tab" aria-selected={tab==="match"} className={`sidebar-nav-item${tab==="match"?" on":""}`} onClick={()=>setTab("match")} title="Program Match">
                <span className="sidebar-nav-icon"><Target size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Program Match</span>}
                {profileData?.fullName && profileData.fullName !== "Not found" && <span className={`sidebar-nav-badge${tab==="match"?" sidebar-nav-badge--active":""}`}>AI</span>}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("inbox") && (
              <button role="tab" aria-selected={tab==="inbox"} className={`sidebar-nav-item${tab==="inbox"?" on":""}`} onClick={()=>setTab("inbox")} title="Inbox Scanner">
                <span className="sidebar-nav-icon"><Mail size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Inbox Scanner</span>}
                {inboxUnread > 0 && (
                  <span className={`sidebar-nav-badge${tab==="inbox" ? " sidebar-nav-badge--active" : " sidebar-nav-badge--warn"}`}>
                    {inboxUnread}
                  </span>
                )}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("calendar") && (
              <button role="tab" aria-selected={tab==="calendar"} className={`sidebar-nav-item${tab==="calendar"?" on":""}`} onClick={()=>setTab("calendar")} title="Calendar">
                <span className="sidebar-nav-icon"><Calendar size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Calendar</span>}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("expiry") && (
              <button role="tab" aria-selected={tab==="expiry"} className={`sidebar-nav-item${tab==="expiry"?" on":""}`} onClick={()=>setTab("expiry")} title="Expiry Radar">
                <span className="sidebar-nav-icon"><Clock size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Expiry Radar</span>}
                {cases.filter(c=>c.expiryDate&&Math.ceil((new Date(c.expiryDate)-new Date())/86400000)<=30).length > 0 && (
                  <span className="sidebar-nav-badge sidebar-nav-badge--warn">
                    {cases.filter(c=>c.expiryDate&&Math.ceil((new Date(c.expiryDate)-new Date())/86400000)<=30).length}
                  </span>
                )}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("policy") && (
              <button role="tab" aria-selected={tab==="policy"} className={`sidebar-nav-item${tab==="policy"?" on":""}`} onClick={()=>setTab("policy")} title="Policy Alerts">
                <span className="sidebar-nav-icon"><Bell size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Policy Alerts</span>}
                {policyAlerts.length > 0 && (
                  <span className={`sidebar-nav-badge${policyAlerts.some(a=>a.severity==="high")?" sidebar-nav-badge--warn":""}`}>
                    {policyAlerts.length}
                  </span>
                )}
              </button>
            )}

            {!orgSession?.restricted_tabs?.includes("history") && (
        <button role="tab" aria-selected={tab==="history"} className={`sidebar-nav-item${tab==="history"?" on":""}`} onClick={()=>setTab("history")} title="Case History">
                <span className="sidebar-nav-icon"><FolderOpen size={16}/></span>
                {sidebarOpen && <span className="sidebar-nav-label">Case History</span>}
              </button>
            )}
            
            {/* Agency Panel — only visible to branch_manager+ or legacy sessions */}
            {(['org_owner','branch_manager','senior_counsellor'].includes(orgSession?.role) || !orgSession?.access_token) && (
              <>
                <div className="sidebar-nav-divider"/>
                <div className="sidebar-nav-section-label">{sidebarOpen && "Agency"}</div>

                <button role="tab" aria-selected={tab==="agency"} className={`sidebar-nav-item${tab==="agency"?" on":""}`} title="Agency Panel"
                  onClick={() => {
                    if (orgSession?.access_token) { setTab("agency"); return; }
                    if (isAdminUnlocked) { setTab("agency"); return; }
                    const pin = window.prompt("Enter Agency Admin PIN to access this panel:");
                    if (pin === "2026") { setIsAdminUnlocked(true); setTab("agency"); }
                    else if (pin !== null) { alert("Incorrect PIN. Access denied."); }
                  }}
                >
                  <span className="sidebar-nav-icon"><Building2 size={16}/></span>
                  {sidebarOpen && <span className="sidebar-nav-label">Agency Panel</span>}
                </button>

                {!orgSession?.restricted_tabs?.includes("requirements") && (
                  <button role="tab" aria-selected={tab==="requirements"} className={`sidebar-nav-item${tab==="requirements"?" on":""}`} onClick={()=>setTab("requirements")} title="University Data">
                    <span className="sidebar-nav-icon"><FileSpreadsheet size={16}/></span>
                    {sidebarOpen && <span className="sidebar-nav-label">University Data</span>}
                    {customRequirements && <span className="sidebar-nav-badge">CSV</span>}
                  </button>
                )}
              </>
            )}
          </nav>

          {/* Sidebar footer — org status + controls */}
          <div className="sidebar-footer">

            {/* User identity card */}
            {orgSession && (() => {
              const name = orgSession.full_name || orgSession.email || "User";
              const initials = name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join("") || "?";
              const roleLabel = orgSession.role ? orgSession.role.replace(/_/g," ") : (orgSession.org_name ? "Member" : "User");
              return (
                <div className="sidebar-user-card" title={`Signed in as ${name}`}>
                  <div className="sidebar-user-avatar">{initials}</div>
                  {sidebarOpen && (
                    <div className="sidebar-user-info">
                      <div className="sidebar-user-name">{name}</div>
                      <div className="sidebar-user-role">{roleLabel}</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Org + credits — floats as its own card */}
            {sidebarOpen && orgSession && (
              <div className="sidebar-org-card">
                <div className="sidebar-org-row">
                  <div className="org-status-dot"/>
                  <span className="sidebar-org-name">{orgSession.org_name}</span>
                  <span className="sidebar-org-plan">
                    {((orgSession.plan||"starter").charAt(0).toUpperCase()+(orgSession.plan||"starter").slice(1))}
                  </span>
                </div>
                              <div className="sidebar-credits-row">
                                  {orgSession.credit_quota !== null && orgSession.credit_quota !== undefined ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
                                          <span className="sidebar-credits-label" style={{ color: "var(--t2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                              <span>Personal Limit:</span>
                                              <strong style={{ color: "var(--p)", fontSize: 12 }}>{orgSession.credit_quota}</strong>
                                          </span>
                                      </div>
                                  ) : (
                                      <>
                                          <div className="sidebar-credits-track">
                                              <div className="sidebar-credits-fill" style={{
                                                  width: `${Math.min(orgSession.analyses_total > 0 ? Math.round(((orgCredits ?? orgSession.analyses_remaining ?? 0) / orgSession.analyses_total) * 100) : 100, 100)}%`,
                                                  background: (orgCredits ?? orgSession.analyses_remaining ?? 0) <= 10 ? "var(--err)" : (orgCredits ?? orgSession.analyses_remaining ?? 0) <= 50 ? "var(--warn)" : "var(--p)",
                                              }} />
                                          </div>
                                          <span className="sidebar-credits-label" style={{ color: (orgCredits ?? orgSession.analyses_remaining ?? 0) <= 10 ? "var(--err)" : (orgCredits ?? orgSession.analyses_remaining ?? 0) <= 50 ? "var(--warn)" : "var(--t3)" }}>
                                              {(orgCredits ?? orgSession.analyses_remaining ?? 0).toLocaleString()} left
                                          </span>
                                      </>
                                  )}
                              </div>
              </div>
            )}

            <div className="sidebar-footer-actions">
              <button className="sidebar-footer-btn" onClick={()=>setDarkMode(d=>!d)} title={darkMode?"Switch to Light Mode":"Switch to Dark Mode"}>
                {darkMode ? <Sun size={14}/> : <Moon size={14}/>}
              </button>
              {sidebarOpen && (
                <button className="sidebar-footer-btn sidebar-footer-btn--signout" onClick={onLogout} title="Sign out">
                  <X size={13}/><span>Sign out</span>
                </button>
              )}
            </div>
            {sidebarOpen && (
              <div className="sidebar-ai-pip">
                <div className="pip"/>
                <span>AI Active</span>
              </div>
            )}
          </div>
        </aside>

        {/* ── DOCUMENT CONTEXT PANEL (Analyse tab only) ── */}
        {tab === "analyze" && (
          <div className={`doc-panel${docPanelOpen ? "" : " doc-panel--collapsed"}`}>

            {/* Collapsed strip */}
            {!docPanelOpen && (
              <div className="doc-panel-strip" onClick={() => setDocPanelOpen(true)} title="Open document panel">
                <Upload size={15} color="var(--t2)"/>
                {docs.length > 0 && <span className="doc-panel-strip-badge">{docs.length}</span>}
              </div>
            )}

            {/* Expanded panel */}
            {docPanelOpen && (
              <>
                <div className="doc-panel-hdr">
                  <span className="doc-panel-title">
                    <Upload size={12}/>Documents
                    {docs.length > 0 && <span className="badge b-neu" style={{marginLeft:6}}>{docs.length} file{docs.length!==1?"s":""}</span>}
                  </span>
                  <button className="doc-panel-close" onClick={() => setDocPanelOpen(false)} title="Collapse document panel">
                    <ChevronDown size={13} style={{transform:"rotate(90deg)"}}/>
                  </button>
                </div>
                <div className="doc-panel-body">

                  {/* Drop zone */}
                  <div className={`dz${dragOver?" over":""}`}
                    onClick={()=>fileRef.current?.click()}
                    onDragOver={e=>{e.preventDefault();setDragOver(true)}}
                    onDragLeave={()=>setDragOver(false)}
                    onDrop={e=>{e.preventDefault();setDragOver(false);addFiles(e.dataTransfer.files)}}
                    role="button" tabIndex={0} onKeyDown={e=>e.key==="Enter"&&fileRef.current?.click()}>
                    <div className="dz-ico"><Upload size={18}/></div>
                    <div className="dz-h">Drop files here</div>
                    <div className="dz-s">PDFs, images, text · <span className="dz-link">browse files</span></div>
                  </div>
                  <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.txt" style={{display:"none"}} onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>

                  {/* Google Drive Import */}
                  <div style={{padding:"0 14px 8px",display:"flex",flexDirection:"column",gap:5}}>
                    <button className="btn-s"
                      style={{width:"100%",justifyContent:"center",gap:8,height:34,borderColor:"rgba(66,133,244,.4)",color:"#4285F4",background:"rgba(66,133,244,.06)"}}
                      onClick={handleDriveImport} disabled={driveImporting}
                      onMouseEnter={preloadDriveScripts} onTouchStart={preloadDriveScripts} onFocus={preloadDriveScripts}>
                      {driveImporting ? <Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/> : <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>}
                      {driveImporting ? "Connecting…" : "Google Drive"}
                    </button>
                    {driveConnected && (
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"2px 2px"}}>
                        <span style={{fontSize:10,fontFamily:"var(--fm)",color:"var(--ok)",display:"flex",alignItems:"center",gap:4}}><Check size={10}/>Drive connected</span>
                        <button style={{fontSize:10,fontFamily:"var(--fm)",color:"var(--t3)",background:"transparent",border:"none",cursor:"pointer",textDecoration:"underline",padding:0}} onClick={handleDisconnectDrive}>Disconnect</button>
                      </div>
                    )}
                  </div>

                  {/* Rename row */}
                  {renameSuggestion && (
                    <div className="rename-row">
                      <input className="rename-input" value={renameSuggestion} onChange={e=>setRenameSuggestion(e.target.value)} placeholder="Student name prefix…"/>
                      <button className="btn-rename" onClick={applyRenameAll}>Rename All</button>
                    </div>
                  )}

                  {/* Doc list — same as before, no logic changes */}
                  <div className="doc-list">
                      {docs.map(doc=>{
                        const t      = docTypes[doc.id] || doc.type || "other";
                        const {Icon} = getDT(t);
                        const q      = qualities[doc.id];
                        const rowCls = q?.status==="error"?" qerr":q?.status==="warn"?" qwarn":"";
                        const isImg  = doc.file.type.startsWith("image/");
                        const person = personTags[doc.id] || "primary";
                        const depOpen = !!docDepOpen[doc.id];
                        const skipped = readinessSelection.size > 0 && !readinessSelection.has(doc.id);
                        return (
                          <div key={doc.id} className={`doc-row${rowCls}`} style={skipped?{opacity:.4}:{}}>
                            <div className="doc-thumb" onClick={()=>setPreview(doc)} role="button">
                              {isImg?<ThumbImg file={doc.file}/>:<Icon size={16} color="#4A5D7E"/>}
                              <div className="thumb-ov"><ZoomIn size={12} color="#fff"/></div>
                            </div>
                            <div className="doc-meta">
                              <div className="doc-fn">
                                {doc.renamed||doc.file.name}
                                <span style={{marginLeft:6,fontSize:10,fontWeight:400,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                                  {doc.file.size < 1024*1024
                                    ? `${Math.round(doc.file.size/1024)}KB`
                                    : `${(doc.file.size/1024/1024).toFixed(1)}MB`}
                                </span>
                              </div>
                              {doc.renamed&&<div className="doc-ren">↳ {doc.file.name}</div>}
                              {skipped && <span className="doc-qb warn"><TriangleAlert size={9}/>Not included in analysis</span>}
                              <select className="doc-sel" value={t}
                                onChange={e=>{
                                  setDocTypes(p=>({...p,[doc.id]:e.target.value}));
                                  setSubTypes(p=>({...p,[doc.id]:""}));
                                }}>
                                {Object.entries(DOC_TYPES.reduce((a,dt)=>{if(!a[dt.group])a[dt.group]=[];a[dt.group].push(dt);return a},{})).map(([grp,items])=>(
                                  <optgroup key={grp} label={grp}>
                                    {items.map(dt=><option key={dt.value} value={dt.value}>{dt.label}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                              {t === "transcript" && (
                                <select className="doc-sel doc-subsel"
                                  value={subTypes[doc.id]||""}
                                  onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}>
                                  {TRANSCRIPT_LEVELS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                              )}
                              {t === "offer_letter" && (
                                <input className="doc-subin"
                                  value={subTypes[doc.id]||""}
                                  onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}
                                  placeholder="University (e.g. Sheffield)"/>
                              )}
                              {t === "other" && (
                                <input className="doc-subin"
                                  value={customLabels[doc.id]||""}
                                  onChange={e=>setCustomLabels(p=>({...p,[doc.id]:e.target.value}))}
                                  placeholder="Describe document…"/>
                              )}
                              {person !== "primary" && (
                                <div className="doc-person-active">
                                  {person === "spouse" ? "👫 Spouse" : "👶 Child"}
                                  <button className="doc-person-clear" onClick={()=>setPersonTags(p=>({...p,[doc.id]:"primary"}))}><X size={9}/></button>
                                </div>
                              )}
                              {person === "primary" && (
                                <button className="doc-dep-toggle" onClick={()=>setDocDepOpen(p=>({...p,[doc.id]:!depOpen}))}>
                                  {depOpen ? <><ChevronDown size={9} style={{transform:"rotate(180deg)"}}/> Hide</> : <>+ Dependant</>}
                                </button>
                              )}
                              {depOpen && person === "primary" && (
                                <div className="doc-dep-row">
                                  <button className="doc-dep-btn" onClick={()=>{setPersonTags(p=>({...p,[doc.id]:"spouse"}));setDocDepOpen(p=>({...p,[doc.id]:false}));}}>Spouse</button>
                                  <button className="doc-dep-btn" onClick={()=>{setPersonTags(p=>({...p,[doc.id]:"child"}));setDocDepOpen(p=>({...p,[doc.id]:false}));}}>Child</button>
                                </div>
                              )}
                              {doc.tooLarge&&<span className="doc-qb err"><XCircle size={9}/>Too large ({(doc.file.size/1024/1024).toFixed(1)}MB) — file is blocked. <a href="https://www.ilovepdf.com/compress_pdf" target="_blank" rel="noopener noreferrer" style={{color:"inherit",textDecoration:"underline"}}>Compress here</a></span>}
                              {!doc.tooLarge&&doc.largeWarning&&<span className="doc-qb warn"><TriangleAlert size={9}/>{(doc.file.size/1024/1024).toFixed(1)}MB — large file, may affect speed</span>}
                              {doc._slicedFrom && <span className="doc-qb ok" title="Middle pages skipped — only first 3 + last 4 pages kept to save tokens"><CheckCircle size={9}/>{doc._slicedKeep} of {doc._slicedFrom} pages · bank optimised</span>}
                              {!doc.tooLarge&&q?.status==="checking"&&<span className="doc-qb chk"><Loader2 size={9} style={{animation:"spin .7s linear infinite"}}/>Checking…</span>}
                              {!doc.tooLarge&&q?.status==="warn"&&<span className="doc-qb warn"><TriangleAlert size={9}/>Low quality{q.detail?` — ${q.detail}`:""}{q.rotation&&q.rotation!==0?` · Rotated ${q.rotation}°`:""}</span>}
                              {!doc.tooLarge&&q?.status==="error"&&<span className="doc-qb err"><EyeOff size={9}/>Unreadable{q.detail?` — ${q.detail}`:""}</span>}
                              {/* ── MRZ checksum result badge ── */}
                              {q?.mrz && q.mrz.valid && (
                                <span className="doc-qb ok" title={`Passport: ${q.mrz.checksums?.passport?.valid?"✓":"✗"} · DOB: ${q.mrz.checksums?.dob?.valid?"✓":"✗"} · Expiry: ${q.mrz.checksums?.expiry?.valid?"✓":"✗"}`}>
                                  <ShieldCheck size={9}/>MRZ valid · {q.mrz.passportNumber}
                                </span>
                              )}
                              {q?.mrz && !q.mrz.valid && q.mrz.error && (
                                <span className="doc-qb err" title={q.mrz.error}>
                                  <XCircle size={9}/>MRZ {q.mrz.error}
                                </span>
                              )}
                              {/* ── Bank pre-extraction badge ── */}
                              {q?.bank && q.bank.confidence !== "low" && q.bank.closingBalance && (
                                <span className="doc-qb ok" title={`Holder: ${q.bank.accountHolder||"—"} · Bank: ${q.bank.bankName||"—"} · Period: ${q.bank.statementPeriod||"—"}`}>
                                  <CheckCircle size={9}/>Balance: {q.bank.closingBalance}
                                </span>
                              )}
                            </div>
                            <div className="doc-acts">
                              <button className="btn-ico" onClick={()=>setPreview(doc)}><Eye size={12}/></button>
                              {renameSuggestion&&<button className="btn-ico" onClick={()=>applyRenameOne(doc.id,t)}><Pencil size={12}/></button>}
                              {!doc.tooLarge && doc.file.type === "application/pdf" && !doc._convertedFromPdf && (() => {
                                const currentTier = tokenTierClient(estimateTokens(docs.filter(d=>!d.tooLarge)));
                                if (currentTier < 2) return null; // Tier 1 — no benefit
                                return (
                                  <button
                                    className="btn-ico"
                                    title="Convert to image — reduces token cost"
                                    disabled={convertingPdfs.has(doc.id)}
                                    onClick={() => convertPdfToImages(doc)}
                                    style={{fontSize:9,fontWeight:700,padding:"2px 5px",width:"auto",color:"var(--accent)",opacity:convertingPdfs.has(doc.id)?0.5:1}}
                                  >
                                    {convertingPdfs.has(doc.id)
                                      ? <Loader2 size={10} style={{animation:"spin .7s linear infinite"}}/>
                                      : "IMG"}
                                  </button>
                                );
                              })()}
                              <button className="btn-ico d" onClick={()=>{
                                setDocs(p=>p.filter(d=>d.id!==doc.id));
                                setQualities(p=>{const n={...p};delete n[doc.id];return n;});
                                setDocTypes(p=>{const n={...p};delete n[doc.id];return n;});
                                setPersonTags(p=>{const n={...p};delete n[doc.id];return n;});
                                setSubTypes(p=>{const n={...p};delete n[doc.id];return n;});
                                setCustomLabels(p=>{const n={...p};delete n[doc.id];return n;});
                                setDocDepOpen(p=>{const n={...p};delete n[doc.id];return n;});
                              }}><X size={12}/></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Token bar + error + overwrite + analyse btn + drive */}
                    {docs.some(d=>d.tooLarge)&&(
                      <div className="err-banner" style={{margin:"0 14px 6px",background:"rgba(220,38,38,.08)",borderColor:"rgba(220,38,38,.3)",color:"#ef4444"}}>
                        <XCircle size={14} style={{flexShrink:0,marginTop:1}}/><span>Files over 100MB skipped.</span>
                      </div>
                    )}
                    {docs.length > 0 && (() => {
                      const activeDocs=docs.filter(d=>!d.tooLarge);const estTokens=estimateTokens(activeDocs);const analysesCost=tokenTierClient(estTokens);const pct=Math.min((estTokens/(20000*Math.max(analysesCost,1)))*100,100);const color=analysesCost>=3?"#7c3aed":analysesCost===2?"#f59e0b":"#2563eb";const totalMB=activeDocs.reduce((s,d)=>s+d.file.size,0)/1024/1024;const isOptimising=convertingPdfs.size>0;const unconvertedPdfs=activeDocs.filter(d=>d.file.type==="application/pdf"&&!d._convertedFromPdf);const showOptimise=unconvertedPdfs.length>0;
                      return(<div style={{padding:"4px 14px 2px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}><span style={{fontSize:10,color:"var(--t3)"}}>{totalMB.toFixed(1)} MB</span><span style={{fontSize:10,fontWeight:600,color}}>~{(estTokens/1000).toFixed(0)}k tokens{analysesCost>1&&<span style={{marginLeft:6,background:color,color:"#fff",borderRadius:3,padding:"1px 6px"}}>{analysesCost} analyses</span>}</span></div><div style={{height:3,borderRadius:2,background:"var(--border)",overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:2,transition:"width .3s"}}/></div>{analysesCost>=2&&showOptimise&&(<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4,gap:8}}><span style={{fontSize:10,color}}>{analysesCost>=3?"Heavy":"Large"} case</span><button disabled={isOptimising} onClick={convertAllPdfsToImages} style={{flexShrink:0,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:3,border:`1px solid ${color}`,background:"transparent",color,cursor:"pointer",opacity:isOptimising?0.4:1}}>{isOptimising?<Loader2 size={9} style={{animation:"spin .7s linear infinite"}}/>:"⚡ Optimise"}</button></div>)}</div>);
                    })()}
                    {error&&<div className="err-banner" style={{margin:"0 14px 6px"}}><AlertCircle size={14} style={{flexShrink:0,marginTop:1}}/><span>{error}</span></div>}
                    {confirmOverwrite&&(
                      <div style={{margin:"0 14px 8px",padding:"10px 12px",background:"rgba(220,38,38,.06)",border:"1px solid rgba(220,38,38,.25)",borderRadius:"var(--r2)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,fontWeight:700,fontSize:12,color:"var(--err)",marginBottom:6}}><TriangleAlert size={13} style={{flexShrink:0}}/>A case is already loaded</div>
                        <div style={{fontSize:11,color:"var(--t2)",marginBottom:10,lineHeight:1.5}}>Analysing now will <strong>overwrite</strong> the current profile.</div>
                        <div style={{display:"flex",gap:6}}>
                          <button style={{flex:1,fontSize:11,fontWeight:600,padding:"5px 0",borderRadius:"var(--r1)",border:"1px solid rgba(220,38,38,.3)",background:"var(--err)",color:"#fff",cursor:"pointer"}} onClick={async()=>{
  setConfirmOverwrite(false);
  setDocs(p => p.map(d => ({ ...d, isNew: false })));
  setAnalysedDocIds(new Set());
  if (preScanData === null && !preScanLoading) { await preScan(); }
}}>Yes, overwrite</button>
                          <button style={{flex:1,fontSize:11,fontWeight:600,padding:"5px 0",borderRadius:"var(--r1)",border:"1px solid var(--bd)",background:"var(--s2)",color:"var(--t1)",cursor:"pointer"}} onClick={()=>setConfirmOverwrite(false)}>Cancel</button>
                        </div>
                      </div>
                    )}
                    <div className="btn-wrap" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button className="btn-p" style={{flex:1}} disabled={!docs.length||loading||preScanLoading} onClick={analyze}>
                        {preScanLoading?<><Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/>Identifying…</>:loading?<><Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/>Analysing…</>:<><ShieldCheck size={16}/>Analyse {docs.length>0?`${docs.length} `:""}Doc{docs.length!==1?"s":""}</>}
                      </button>
                      {(docs.length>0||results)&&<button className="btn-clear-all" onClick={clearAll}><Trash2 size={14}/>Clear</button>}
                    </div>
                    {docs.length>0&&<button className="btn-download-folder" onClick={()=>setShowZip(true)}><Download size={13}/>Download Folder</button>}
                    {(docs.length>0||results)&&(
                      <div style={{padding:"0 14px 8px",display:"flex",flexDirection:"column",gap:5}}>
                        <button className="btn-download-folder" style={{borderColor:"rgba(66,133,244,.4)",color:"#4285F4",background:"rgba(66,133,244,.05)"}} onClick={handleSaveToDrive} disabled={driveSaving}>
                          {driveSaving?<><Loader2 size={13} style={{animation:"spin .7s linear infinite"}}/>Saving…</>:<><svg width="13" height="13" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>Save to Drive</>}
                        </button>
                        {driveSaveResult&&<div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:"var(--okg)",border:"1px solid rgba(5,150,105,.2)",borderRadius:"var(--r1)",fontSize:12,fontFamily:"var(--fm)"}}><CheckCircle size={13} color="var(--ok)" style={{flexShrink:0,marginTop:1}}/><div><div style={{fontWeight:700,color:"var(--ok)",marginBottom:3}}>Saved ✓</div><a href={driveSaveResult.link} target="_blank" rel="noopener noreferrer" style={{color:"var(--p)",textDecoration:"underline",fontSize:11}}>Open in Drive →</a></div></div>}
                      </div>
                    )}
                    {docs.length>0&&(
                      <div className="search-panel">
                        <div className="card-ttl" style={{marginBottom:8}}><Search size={12}/>Search Documents</div>
                        <div className="search-row">
                          <input className="search-input" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()} placeholder="e.g. IELTS score…"/>
                          {searchQuery&&<button className="btn-search-clear" onClick={()=>{setSearchQuery("");setSearchResults(null);}}><X size={12}/></button>}
                          <button className="btn-search" onClick={doSearch} disabled={!searchQuery.trim()||searchLoading}>{searchLoading?<Loader2 size={13} style={{animation:"spin .7s linear infinite"}}/>:<Search size={13}/>}{searchLoading?"…":"Search"}</button>
                        </div>
                        {searchResults!==null&&(searchResults.filter(r=>r.found).length===0?<div className="search-none">"{searchQuery}" not found.</div>:searchResults.filter(r=>r.found).map((r,i)=><div key={i} className="sr"><CheckCircle size={14} color="#1D6BE8" style={{flexShrink:0,marginTop:1}}/><div><div className="sr-name">{r.filename}</div><div className="sr-snip">{r.snippet}</div></div></div>))}
                      </div>
                    )}
                  </div>{/* end doc-panel-body */}
                </>
              )}
          </div>
        )}{/* end doc-panel */}

        {/* ── CONTENT AREA ── */}
        <div className="app-content">
        <main className="main">

          {/* ── HOME DASHBOARD ── */}
          {tab==="home" && (
            <HomeDashboard
              orgSession={orgSession}
              orgCredits={orgCredits}
              cases={cases}
              totalCases={totalCases}
              expiryAlerts={expiryAlerts}
              onNewCase={() => setTab('analyze')}
              onOpenCase={handleLoadCase}
              onNavigate={(dest) => {
                if (dest === 'agency') {
                  // JWT sessions: role enforced server-side, no PIN needed
                  if (orgSession?.access_token) { setTab('agency'); return; }
                  // Legacy: PIN gate
                  if (isAdminUnlocked) { setTab('agency'); return; }
                  const pin = window.prompt('Enter Agency Admin PIN to access this panel:');
                  if (pin === '2026') { setIsAdminUnlocked(true); setTab('agency'); }
                  else if (pin !== null) { alert('Incorrect PIN. Access denied.'); }
                } else {
                  setTab(dest);
                }
              }}
            />
          )}

          {/* ── ANALYSE ── */}
          {tab==="analyze" && (
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Visalens AI <em>Document Analyser</em></h1>
                <p className="pg-sub">Profile · Eligibility · University Check · Risk Flags</p>
              </div>

              {!loading && !preScanLoading && preScanData && !readinessModal && (
                <PersonClarificationUI preScanData={preScanData} onConfirm={confirmAndAnalyze}
                  onSkip={() => { setPreScanData(null); runFullAnalysis(); }} loading={loading}
                  onRemoveDocs={(fileNames) => { const nameSet = new Set(fileNames.map(n => n.toLowerCase())); setDocs(prev => prev.filter(d => !nameSet.has((d.renamed||d.file.name).toLowerCase()))); }}
                />
              )}

              {(loading || preScanLoading) && <Skeleton/>}

              {!loading&&!preScanLoading&&!preScanData&&!results&&(
                <div className="empty">
                  <FileText size={40} className="empty-ico" color="#94A3B8"/>
                  <div className="empty-ttl">No analysis yet</div>
                  <div className="empty-sub">Upload documents in the panel on the left and click Analyse.<br/>Profile, eligibility scores, university check and risk flags appear here.</div>
                </div>
              )}

              {results&&(
                <>
                  <div className="toolbar" ref={resultsRef}>
                    <button className="btn-s" onClick={()=>setShowReport(true)}><Send size={13}/>Share Report</button>
                    <button className="btn-s" onClick={exportPDF}><Printer size={13}/>Export PDF</button>
                    <button className="btn-s" onClick={exportCSV}><FileSpreadsheet size={13}/>Export CSV</button>
                    <AlertsButton policyAlerts={policyAlerts} profileData={profileData} docs={docs} qualities={qualities} preferredOfferIndex={preferredOfferIndex}/>
                    {profileDirty&&(
                      <button className="btn-reassess" onClick={reAssess} disabled={reassessing}>
                        {reassessing?<><Loader2 size={13} style={{animation:"spin .7s linear infinite"}}/>Re-assessing…</>:<><RefreshCw size={13}/>Re-assess with edits</>}
                      </button>
                    )}
                    {profileDirty&&!reassessing&&<span className="toolbar-dirty-badge"><Edit3 size={10}/>Unsaved edits · auto-saving…</span>}
                  </div>

                  {/* ── NEW: SIDEBAR + CONTENT + HOVERING COUNSELLOR LAYOUT ── */}
                  <div className="vl-analyzer-layout">

                    {/* ── LEFT COLUMN: SIDEBAR + DETECTED DOCS PANEL ── */}
                    <div style={{display:"flex",flexDirection:"column",gap:12,marginRight:16,alignSelf:"start",position:"sticky",top:72}}>

                    {/* LEFT SIDEBAR: TABBED NAVIGATION */}
                    <div className="vl-analyzer-sidebar" style={{position:"static",marginRight:0,maxHeight:"none",overflow:"hidden"}}>

                      {/* Student identity strip — dark purple */}
                      <div className="vl-sidebar-identity">
                        <div className="vl-sidebar-avatar">
                          {(profileData?.fullName && profileData.fullName !== "Not found"
                            ? profileData.fullName.trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join("")
                            : "?")}
                        </div>
                        <div className="vl-sidebar-id-info">
                          <div className="vl-sidebar-id-name">
                            {profileData?.fullName && profileData.fullName !== "Not found" ? profileData.fullName : "Unknown Student"}
                          </div>
                          <div className="vl-sidebar-id-meta">
                            {(() => { const _serial = cases.find(c=>c.id===activeCaseId)?.caseSerial || null; return _serial ? (
                              <span className="vl-sidebar-id-case">{_serial}</span>
                            ) : null; })()}
                            {profileData?.passportNumber && profileData.passportNumber !== "Not found" && (
                              <span className="vl-sidebar-id-passport">
                                <span style={{opacity:.7,fontSize:9}}>PPT</span> {profileData.passportNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Navigation tabs */}
                      <nav className="vl-sidebar-nav">
                        {[
                          { id: "personal",   label: "Personal",        icon: <User size={14}/>,          count: null },
                          { id: "academic",   label: "Academic",         icon: <GraduationCap size={14}/>, count: null },
                          { id: "english",    label: "English",          icon: <Languages size={14}/>,     count: (profileData?.englishTests||[]).filter(t=>t.overallScore).length || null },
                          { id: "financial",  label: "Financial",        icon: <CreditCard size={14}/>,    count: null },
                          { id: "offers",     label: "Offers & CAS",     icon: <FileText size={14}/>,      count: (Array.isArray(profileData?.offerLetters)?profileData.offerLetters.filter(o=>o.university||o.country).length:0) || null },
                          { id: "documents",  label: "Special Docs",     icon: <ShieldCheck size={14}/>,   count: (profileData?.detectedDocs||[]).length || null },
                          { id: "expiry",     label: "Expiry Tracker",   icon: <Clock size={14}/>,         count: null },
                          { divider: true },
                          { id: "assessment", label: "Visa Eligibility", icon: <BarChart3 size={14}/>,     count: null },
                          { id: "risks",      label: "Risk Flags",       icon: <AlertTriangle size={14}/>, count: (results?.redFlags||[]).length || null },
                        ].map((tab, tabIdx) => {
                          if (tab.divider) return <div key={`div-${tabIdx}`} className="vl-sidebar-divider"/>;
                          return (
                          <button
                            key={tab.id}
                            className={`vl-sidebar-tab${analyzerSideTab === tab.id ? " active" : ""}`}
                            onClick={() => {
                              setAnalyzerSideTab(tab.id);
                              if (tab.id === "assessment") {
                                setTimeout(() => {
                                  document.getElementById("vl-elig-anchor")?.scrollIntoView({behavior:"smooth", block:"start"});
                                }, 50);
                              }
                            }}
                          >
                            <span className="vl-sidebar-tab-icon">{tab.icon}</span>
                            <span className="vl-sidebar-tab-label">{tab.label}</span>
                            {tab.count > 0 && (
                              <span className="vl-sidebar-tab-badge">{tab.count}</span>
                            )}
                          </button>
                          );
                        })}
                      </nav>
                    </div>{/* end vl-analyzer-sidebar */}

                   {/* ── DETECTED DOCUMENTS PANEL ── */}
<div className="vl-sidebar-docs-panel">
  <div className="vl-sidebar-docs-panel-hdr">
    <File size={13}/>
    <span>Detected Documents</span>
    {(() => { const n = deriveDetectedDocs(profileData, results, docs, docTypes, cases.find(c=>c.id===activeCaseId)?.docList).length; return n > 0 && <span className="vl-sidebar-docs-badge">{n}</span>; })()}
  </div>
  <div className="vl-sidebar-docs-list">
    {(() => {
      const detectedList = deriveDetectedDocs(profileData, results, docs, docTypes, cases.find(c=>c.id===activeCaseId)?.docList);
      if (detectedList.length === 0) return <div className="vl-sidebar-docs-empty">No documents loaded</div>;
      return detectedList.map((item, i) => (
        <div key={i} className="vl-sidebar-doc-row">
          <div className="vl-sidebar-doc-ext" style={{background:`${item.color}18`,color:item.color,borderColor:`${item.color}30`,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',width:28,height:28,flexShrink:0,borderRadius:4,border:'1px solid'}}>
            {item.icon}
          </div>
          <div className="vl-sidebar-doc-info">
            <div className="vl-sidebar-doc-name" style={{display:'flex',alignItems:'center',gap:4}}>
              {item.label}
              {item.status === 'expired' && <span style={{fontSize:9,fontWeight:700,color:'#DC2626',background:'rgba(220,38,38,.1)',borderRadius:3,padding:'1px 4px'}}>EXPIRED</span>}
              {item.status === 'partial' && <span style={{fontSize:9,fontWeight:700,color:'#B45309',background:'rgba(180,83,9,.1)',borderRadius:3,padding:'1px 4px'}}>PARTIAL</span>}
            </div>
            {item.detail && <div className="vl-sidebar-doc-type" style={{color:item.color}}>{item.detail}</div>}
            <div style={{fontSize:9,color:'var(--t3)',fontFamily:'var(--fm)',marginTop:1}}>{item.source==='ai'?'AI extracted':item.source==='db'?'Saved case':item.source==='file'?'Uploaded file':'Detected'}</div>
          </div>
        </div>
      ));
    })()}
  </div>
</div>

                    </div>{/* end left column wrapper */}

                    {/* ── MAIN CONTENT PANEL ── */}
                    <div className="vl-analyzer-content">

                      {/* Hidden renders to preserve ProfileCard state for all groups */}
                      <div style={{display:"none"}}>
                        <ProfileCard data={profileData} setData={setProfileDataDirty} preferredOfferIndex={preferredOfferIndex} setPreferredOfferIndex={setPreferredOfferIndex} requirementsData={mergedRequirements}/>
                      </div>

                      {/* ── PERSONAL TAB ── */}
                      {analyzerSideTab === "personal" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header vl-header-purple">
                            <User size={16}/>
                            <span>Personal Information</span>
                          </div>
                          <div className="vl-field-grid">
                            {[
                              {k:"fullName",           l:"Full Name"},
                              {k:"dob",                l:"Date of Birth"},
                              {k:"nationality",        l:"Nationality"},
                              {k:"gender",             l:"Gender"},
                              {k:"city",               l:"City"},
                              {k:"mobileNumber",       l:"Mobile Number"},
                              {k:"email",              l:"Email Address"},
                              {k:"passportNumber",     l:"Passport Number"},
                              {k:"passportIssueDate",  l:"Passport Issued"},
                              {k:"passportExpiry",     l:"Passport Expiry"},
                              {k:"cnicNumber",         l:"CNIC Number"},
                              {k:"cnicExpiry",         l:"CNIC Expiry"},
                            ].map(f => {
                              const raw = profileData[f.k];
                              const isEmpty = !raw || raw === "Not found" || raw.trim() === "";
                              return (
                                <div key={f.k} className="vl-field-row">
                                  <div className="vl-field-label">{f.l}</div>
                                  <input
                                    className={`vl-field-input${isEmpty ? " vl-field-notfound" : ""}`}
                                    value={isEmpty ? "" : raw}
                                    onChange={e => setProfileDataDirty(p => ({...p, [f.k]: e.target.value}))}
                                    placeholder="NOT FOUND"
                                  />
                                  {!isEmpty && (
                                    <button className="vl-field-copy" onClick={() => navigator.clipboard?.writeText(raw)} title="Copy">
                                      <Copy size={11}/>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {/* CNIC Address full-width */}
                            <div className="vl-field-row vl-field-row-full">
                              <div className="vl-field-label">CNIC Address (Roman Urdu)</div>
                              <textarea
                                className={`vl-field-input vl-field-textarea${(!profileData.cnicAddressRomanUrdu || profileData.cnicAddressRomanUrdu === "Not found") ? " vl-field-notfound" : ""}`}
                                value={profileData.cnicAddressRomanUrdu && profileData.cnicAddressRomanUrdu !== "Not found" ? profileData.cnicAddressRomanUrdu : ""}
                                onChange={e => setProfileDataDirty(p => ({...p, cnicAddressRomanUrdu: e.target.value}))}
                                placeholder="NOT FOUND"
                                rows={2}
                              />
                            </div>
                          </div>
                          {/* Name mismatches */}
                          {Array.isArray(profileData?.nameMismatches) && profileData.nameMismatches.length > 0 && (
                            <div className="vl-mismatch-section">
                              <div className="vl-mismatch-header"><AlertCircle size={13} color="var(--err)"/>Name Mismatches Detected</div>
                              {profileData.nameMismatches.map((m,i) => (
                                <div key={i} className="vl-mismatch-row">
                                  <span className="vl-mismatch-doc">{m.documentName}</span>
                                  <span className="vl-mismatch-found">{m.nameFound}</span>
                                  {m.issue && <span className="vl-mismatch-issue">{m.issue}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Study gap */}
                          {profileData?.studyGap && profileData.studyGap !== "Not found" && profileData.studyGap !== "" && (
                            <div className="vl-alert-strip vl-alert-warn">
                              <Clock size={13} style={{flexShrink:0}}/>
                              <div><strong>Study Gap Detected</strong><br/>{profileData.studyGap}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── ACADEMIC TAB ── */}
                      {analyzerSideTab === "academic" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header vl-header-purple">
                            <GraduationCap size={16}/>
                            <span>Academic Background</span>
                          </div>
                          <div className="vl-field-grid">
                            {[
                              {k:"program",       l:"Highest Qualification"},
                              {k:"yearOfPassing", l:"Year of Passing"},
                              {k:"university",    l:"University / Institution"},
                            ].map(f => {
                              const raw = profileData[f.k];
                              const isEmpty = !raw || raw === "Not found" || raw.trim() === "";
                              return (
                                <div key={f.k} className="vl-field-row">
                                  <div className="vl-field-label">{f.l}</div>
                                  <input
                                    className={`vl-field-input${isEmpty ? " vl-field-notfound" : ""}`}
                                    value={isEmpty ? "" : raw}
                                    onChange={e => setProfileDataDirty(p => ({...p, [f.k]: e.target.value}))}
                                    placeholder="NOT FOUND"
                                  />
                                  {!isEmpty && (
                                    <button className="vl-field-copy" onClick={() => navigator.clipboard?.writeText(raw)} title="Copy">
                                      <Copy size={11}/>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {["academicResult","studyGap"].map(k => {
                              const labels = {academicResult:"Academic Result / GPA", studyGap:"Study Gap"};
                              const raw = profileData[k];
                              const isEmpty = !raw || raw === "Not found" || raw.trim() === "";
                              return (
                                <div key={k} className="vl-field-row vl-field-row-full">
                                  <div className="vl-field-label">{labels[k]}</div>
                                  <textarea
                                    className={`vl-field-input vl-field-textarea${isEmpty ? " vl-field-notfound" : ""}`}
                                    value={isEmpty ? "" : raw}
                                    onChange={e => setProfileDataDirty(p => ({...p, [k]: e.target.value}))}
                                    placeholder="NOT FOUND"
                                    rows={2}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── ENGLISH TAB ── */}
                      {analyzerSideTab === "english" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header vl-header-purple">
                            <Languages size={16}/>
                            <span>English Qualifications</span>
                          </div>
                          {/* English tests */}
                          {(profileData?.englishTests||[]).length === 0 ? (
                            <div className="vl-empty-note">No English test certificates detected. Add manually or re-analyse with test documents.</div>
                          ) : (
                            <div className="vl-english-tests">
                              {(profileData.englishTests||[]).map((test, idx) => {
                                const typeColor = test.type==="IELTS"||test.type==="IELTS UKVI" ? "#1D6BE8" : test.type==="PTE Academic"||test.type==="PTE UKVI" ? "#7C3AED" : test.type==="TOEFL" ? "#059669" : "var(--t2)";
                                const subKeys = ["listening","reading","writing","speaking"];
                                const hasUrn = test.urn && test.urn.trim();
                                function updateTest(key, val) { setProfileDataDirty(p => ({...p, englishTests: (p.englishTests||[]).map((t,j)=>j===idx?{...t,[key]:val}:t)})); }
                                function updateSub(sub, val) { setProfileDataDirty(p => ({...p, englishTests: (p.englishTests||[]).map((t,j)=>j===idx?{...t,subScores:{...t.subScores,[sub]:val}}:t)})); }
                                return (
                                  <div key={idx} className="vl-english-card">
                                    <div className="vl-english-card-hdr" style={{borderLeft:`3px solid ${typeColor}`}}>
                                      {/* Editable test type */}
                                      <input
                                        className="vl-english-type-input"
                                        value={test.type||""}
                                        onChange={e=>updateTest("type",e.target.value)}
                                        placeholder="Test Type"
                                        style={{color:typeColor}}
                                      />
                                      {test.overallScore && <span className="vl-english-score" style={{color:typeColor}}>{test.overallScore}</span>}
                                      {test.testDate && <span className="vl-english-date">{test.testDate}</span>}
                                      <button className="vl-remove-btn" onClick={() => setProfileDataDirty(p => ({...p, englishTests: (p.englishTests||[]).filter((_,j)=>j!==idx)}))}>
                                        <X size={11}/>
                                      </button>
                                    </div>
                                    <div className="vl-field-grid" style={{padding:"0"}}>
                                      <div className="vl-field-row">
                                        <div className="vl-field-label">Overall Score</div>
                                        <input className={`vl-field-input${!test.overallScore?" vl-field-notfound":""}`} value={test.overallScore||""} onChange={e=>updateTest("overallScore",e.target.value)} placeholder="NOT FOUND"/>
                                      </div>
                                      <div className="vl-field-row">
                                        <div className="vl-field-label">Test Date</div>
                                        <input className={`vl-field-input${!test.testDate?" vl-field-notfound":""}`} value={test.testDate||""} onChange={e=>updateTest("testDate",e.target.value)} placeholder="NOT FOUND"/>
                                      </div>
                                      {/* Expiry date — change 3 */}
                                      <div className="vl-field-row vl-field-row-full">
                                        <div className="vl-field-label">Expiry Date</div>
                                        <input className={`vl-field-input${!test.expiryDate?" vl-field-notfound":""}`} value={test.expiryDate||""} onChange={e=>updateTest("expiryDate",e.target.value)} placeholder="NOT FOUND"/>
                                      </div>
                                      <div className="vl-field-row vl-field-row-full">
                                        <div className="vl-field-label" style={{display:"flex",alignItems:"center",gap:6}}>
                                          URN / Reference
                                          {hasUrn && <span style={{fontSize:9,fontWeight:600,background:"rgba(2,132,199,.1)",color:"#0284C7",border:"1px solid rgba(2,132,199,.2)",borderRadius:4,padding:"1px 5px"}}>Found</span>}
                                        </div>
                                        <input className={`vl-field-input${!test.urn?" vl-field-notfound":""}`} style={{fontFamily:"var(--fm)",fontSize:11}} value={test.urn||""} onChange={e=>updateTest("urn",e.target.value)} placeholder="NOT FOUND"/>
                                      </div>
                                      {subKeys.map(sub => (
                                        <div key={sub} className="vl-field-row">
                                          <div className="vl-field-label" style={{textTransform:"capitalize"}}>{sub}</div>
                                          <input className={`vl-field-input${!test.subScores?.[sub]?" vl-field-notfound":""}`} value={test.subScores?.[sub]||""} onChange={e=>updateSub(sub,e.target.value)} placeholder="—"/>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {/* Add test — change 4: defaults to editable "IELTS" heading */}
                          <div style={{padding:"10px 18px 4px"}}>
                            <button className="vl-add-btn" style={{margin:0}} onClick={() => setProfileDataDirty(p => ({...p, englishTests: [...(p.englishTests||[]), {type:"IELTS",overallScore:"",testDate:"",expiryDate:"",urn:"",subScores:{listening:"",reading:"",writing:"",speaking:""}}]}))}>
                              <Plus size={12}/>Add English Test
                            </button>
                          </div>
                          {/* Other English / MOI */}
                          <div className="vl-field-grid" style={{marginTop:0}}>
                            {[
                              {k:"otherEnglishTest", l:"Other English Test / Certificate"},
                              {k:"otherEnglishTestExpiry", l:"Other Test Expiry"},
                            ].map(f => {
                              const raw = profileData[f.k];
                              const isEmpty = !raw || raw === "Not found" || raw.trim() === "";
                              return (
                                <div key={f.k} className="vl-field-row vl-field-row-full">
                                  <div className="vl-field-label">{f.l}</div>
                                  <input className={`vl-field-input${isEmpty?" vl-field-notfound":""}`} value={isEmpty?"":raw} onChange={e=>setProfileDataDirty(p=>({...p,[f.k]:e.target.value}))} placeholder="NOT FOUND"/>
                                </div>
                              );
                            })}
                            <div className="vl-field-row vl-field-row-full">
                              <div className="vl-field-label">Medium of Instruction</div>
                              <textarea className={`vl-field-input vl-field-textarea${(!profileData.mediumOfInstruction||profileData.mediumOfInstruction==="Not found")?" vl-field-notfound":""}`} value={profileData.mediumOfInstruction && profileData.mediumOfInstruction !== "Not found" ? profileData.mediumOfInstruction : ""} onChange={e => setProfileDataDirty(p => ({...p, mediumOfInstruction: e.target.value}))} placeholder="NOT FOUND" rows={2}/>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── FINANCIAL TAB ── */}
                      {analyzerSideTab === "financial" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header vl-header-purple">
                            <CreditCard size={16}/>
                            <span>Financial Information</span>
                          </div>
                          <div className="vl-field-grid">
                            {[
                              {k:"financialHolder",  l:"Account Holder"},
                              {k:"bankName",         l:"Bank Name"},
                              {k:"financialBalance", l:"Funds Available (from documents)"},
                            ].map(f => {
                              const raw = profileData[f.k];
                              const isEmpty = !raw || raw === "Not found" || raw.trim() === "";
                              return (
                                <div key={f.k} className="vl-field-row vl-field-row-full">
                                  <div className="vl-field-label">{f.l}</div>
                                  <input className={`vl-field-input${isEmpty?" vl-field-notfound":""}`} value={isEmpty?"":raw} onChange={e=>setProfileDataDirty(p=>({...p,[f.k]:e.target.value}))} placeholder="NOT FOUND"/>
                                </div>
                              );
                            })}
                            <div className="vl-field-row vl-field-row-full">
                              <div className="vl-field-label" style={{display:"flex",alignItems:"center",gap:6}}>
                                Funds Required
                                {profileData.fundsRequiredSource === "auto" && profileData.fundsRequiredLabel && (
                                  <span style={{fontSize:9,fontWeight:600,background:"rgba(29,107,232,.1)",color:"var(--p)",border:"1px solid rgba(29,107,232,.2)",borderRadius:4,padding:"1px 5px"}}>Auto · {profileData.fundsRequiredLabel}</span>
                                )}
                                {profileData.fundsRequiredSource === "manual" && (
                                  <span style={{fontSize:9,fontWeight:600,background:"rgba(245,158,11,.1)",color:"var(--warn)",border:"1px solid rgba(245,158,11,.2)",borderRadius:4,padding:"1px 5px"}}>Edited</span>
                                )}
                              </div>
                              <input
                                className={`vl-field-input${(!profileData.fundsRequired||profileData.fundsRequired.trim()==="")?" vl-field-notfound":""}`}
                                value={profileData.fundsRequired||""}
                                onChange={e => setProfileDataDirty(p => ({...p, fundsRequired: e.target.value, fundsRequiredSource: e.target.value.trim() ? "manual" : (p.fundsRequiredSource === "auto" ? "auto" : null)}))}
                                placeholder="NOT FOUND"
                              />
                            </div>
                          </div>
                          {/* Sufficiency banner — stable key prevents state reset on each render */}
                          <div style={{padding:"0 0 2px"}}>
                            <FundsSufficiencyBanner
                              key={`fsb-${profileData.financialBalance||""}-${profileData.fundsRequired||""}`}
                              balance={profileData.financialBalance}
                              required={profileData.fundsRequired}
                            />
                          </div>
                        </div>
                      )}

                      {/* ── OFFERS & CAS TAB ── */}
                      {analyzerSideTab === "offers" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header">
                            <FileText size={16} color="var(--p)"/>
                            <span>Offer Letters &amp; CAS Documents</span>
                          </div>
                          <OfferLettersSection data={profileData} setData={setProfileDataDirty} preferredIdx={preferredOfferIndex} setPreferredIdx={setPreferredOfferIndex}/>
                          <CasDocumentsSection data={profileData} setData={setProfileDataDirty}/>
                        </div>
                      )}

                      {/* ── SPECIAL DOCS TAB ── */}
                      {analyzerSideTab === "documents" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header">
                            <ShieldCheck size={16} color="#7C3AED"/>
                            <span>Detected Special Documents</span>
                            {(profileData?.detectedDocs||[]).length > 0 && (
                              <span className="badge b-info" style={{marginLeft:"auto",fontSize:9}}>{profileData.detectedDocs.length} detected</span>
                            )}
                          </div>
                          <DetectedDocsCard profileData={profileData}/>
                        </div>
                      )}

                      {/* ── EXPIRY TAB ── */}
                      {analyzerSideTab === "expiry" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header">
                            <Clock size={16} color="var(--warn)"/>
                            <span>Expiry Tracker</span>
                          </div>
                          <ExpiryCard
                            profileData={profileData}
                            expiryDates={expiryDates}
                            setExpiryDates={setExpiryDates}
                            onDirty={() => setExpiryDirty(true)}
                          />
                          {expiryDirty && (
                            <div className="vl-alert-strip vl-alert-warn" style={{marginTop:12}}>
                              <AlertTriangle size={13} style={{flexShrink:0}}/>
                              Expiry dates changed — press <strong style={{margin:"0 4px"}}>Save to History</strong> before leaving this tab
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── ASSESSMENT TAB ── */}
                      {analyzerSideTab === "assessment" && (
                        <div className="vl-content-section">
                          <UniversityChecker profile={profileData} requirementsData={mergedRequirements} preferredOfferIndex={preferredOfferIndex}/>
                          {(liveElig||results.eligibility) && <EligCard data={liveElig||results.eligibility} summary={results.eligibility?.summary} findings={results.eligibility?.findings} profile={profileData} isLive={!!liveElig}/>}
                        </div>
                      )}

                      {/* ── RISKS TAB ── */}
                      {analyzerSideTab === "risks" && (
                        <div className="vl-content-section">
                          <div className="vl-content-section-header">
                            <AlertTriangle size={16} color="var(--err)"/>
                            <span>Risk Flags &amp; Notable Findings</span>
                          </div>
                          <div style={{padding:"14px 16px"}}>
                            <RisksCard
                              flags={results.redFlags||[]}
                              missingItems={results.missingDocuments||[]}
                              rejections={results.rejections||[]}
                            />
                          </div>
                        </div>
                      )}

                      {/* ── VISA ELIGIBILITY — always visible at bottom of every tab ── */}
                      {analyzerSideTab !== "assessment" && (liveElig||results.eligibility) && (
                        <div id="vl-elig-anchor" className="vl-content-section" style={{marginTop:14}}>
                          <EligCard data={liveElig||results.eligibility} summary={results.eligibility?.summary} findings={results.eligibility?.findings} profile={profileData} isLive={!!liveElig}/>
                        </div>
                      )}

                    </div>{/* end vl-analyzer-content */}

                    {/* ── HOVERING COUNSELLOR PANEL (right) ── */}
                    <div className="vl-counsellor-hover">
                      <NotesCard
                        notes={notes} setNotes={setNotes}
                        onSave={handleSaveNotes} onSaveCase={handleSaveCase}
                        savedMsg={savedMsg}
                        counsellorName={counsellorName} setCounsellorName={setCounsellorName}
                        leadStatus={leadStatus} setLeadStatus={setLeadStatus}
                        cases={cases} activeCaseId={activeCaseId}
                        activeCaseSerial={cases.find(c=>c.id===activeCaseId)?.caseSerial || null}
                        applicationTargets={applicationTargets} setApplicationTargets={setApplicationTargets}
                        requirementsData={mergedRequirements}
                        profileData={profileData} preferredOfferIndex={preferredOfferIndex}
                        orgSession={orgSession}
                        orgMembers={orgMembers}
                      />
                    </div>

                  </div>{/* end vl-analyzer-layout */}

                  {/* ── FLOATING CHAT PILL (bottom-right) ── */}
                  {!orgSession?.restricted_tabs?.includes("chat") && (
                    <>
                      {chatOpen && (
                        <div className="vl-chat-popover">
                          <ChatPanel
                            profileData={profileData}
                            results={results}
                            docs={docs}
                            messages={chatMessages}
                            setMessages={setChatMessages}
                            onCreditsUpdate={setOrgCredits}
                          />
                        </div>
                      )}
                      <button className="vl-chat-pill" onClick={() => setChatOpen(o => !o)}>
                        {chatOpen
                          ? <><X size={15}/>Close Chat</>
                          : <><MessageSquare size={15}/>AI Chat{chatMessages.length > 0 && <span className="vl-chat-pill-dot has-messages"/>}</>
                        }
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ── CHAT ── */}
          {tab==="chat"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">AI <em>Counsellor Chat</em></h1>
                <p className="pg-sub">Ask questions about the loaded student profile · uses extracted context, not raw images · fast &amp; cost-effective</p>
              </div>
              <ChatPanel 
                profileData={profileData} 
                results={results} 
                docs={docs} 
                messages={chatMessages} 
                setMessages={setChatMessages}
                onCreditsUpdate={setOrgCredits}
              />
            </>
          )}

          {/* ── SOP + RESUME (combined 2-panel) ── */}
          {tab==="sop_resume"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">SOP &amp; CV <em>Builder</em></h1>
                <p className="pg-sub">Generate your Statement of Purpose and professional CV side by side — all in one view</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start"}}>
                {/* Left panel — SOP */}
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--bd)"}}>
                    📄 Statement of Purpose
                  </div>
                  <SOPBuilder
                    profileData={profileData}
                    results={results}
                    universitySop={universitySop}
                    visaSop={visaSop}
                    setUniversitySop={setUniversitySop}
                    setVisaSop={setVisaSop}
                    onSaveSops={handleSaveCase}
                    preferredOfferIndex={preferredOfferIndex}
                    requirementsData={mergedRequirements}
                  />
                </div>
                {/* Right panel — Resume */}
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--bd)"}}>
                    📋 CV / Resume
                  </div>
                  <ResumeBuilder profileData={profileData} results={results} resume={resumeText} setResume={setResumeText} onSaveResume={handleSaveCase} />
                </div>
              </div>
            </>
          )}
      
      {/* ── Mock Interview ── */}
          {tab==="mock_interview"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">AI Interview <em>Assistant</em></h1>
                <p className="pg-sub">Voice-to-voice AI practice sessions for University and Embassy interviews</p>
              </div>
              
              {/* Check if the case is saved to the database first! */}
              {!activeCaseId ? (
                <div className="err-banner" style={{marginBottom:16}}>
                  <AlertCircle size={14}/> Please click "Save to History" on the Analyse tab before starting a mock interview.
                </div>
              ) : (
                <MockInterview 
  caseId={activeCaseId}
  mode="university" 
  orgSession={orgSession}
  onComplete={(report) => console.log("Interview Complete!", report)}
/>
              )}
            </>
          )}
      
          {/* ── REQUIREMENTS ── */}
          {tab==="requirements"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">University <em>Data Bank</em></h1>
                <p className="pg-sub">Upload a CSV of university + programme requirements · data persists across sessions · University Checker uses this data</p>
              </div>
              <RequirementsManager
                customRequirements={customRequirements}
                csvText={reqsCsvText}
                onLoad={handleLoadRequirements}
                onClear={handleClearRequirements}
              />
            </>
          )}
      {/* ── Program Match ── */}
      {tab==="match" && (
  <>
    <div className="pg-hdr">
      <h1 className="pg-title">Program <em>Match</em></h1>
      <p className="pg-sub">AI-ranked programs from your university database · matched against loaded student</p>
    </div>
    <ProgramMatcher
      profile={profileData}
      requirementsData={mergedRequirements}
      preferredOfferIndex={preferredOfferIndex}
      onCreditsUpdate={setOrgCredits}
      activeStudentId={activeStudentId}
    />
  </>
)}

          {/* ── DASHBOARD ── */}
          {tab==="dashboard"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Student <em>Dashboard</em></h1>
                <p className="pg-sub">Live operations hub · pipeline funnel · expiry radar · action queue</p>
              </div>
              <StudentDashboard
                onLoad={handleLoadCase}
                onOpenMatcher={handleJumpToMatcher}
                onUpdateStatus={updateCaseStatus}
                totalCases={totalCases}
                lastSaved={lastSaved}
                orgSession={orgSession}
                orgCredits={orgCredits}
                policyAlerts={policyAlerts}
                callGeminiInsight={callGeminiInsight}
                onOpenChat={openChat}
                openChatCount={openChats.length}
                onPeekChange={setPeekOpen}
                onPaymentUpdate={(caseId, newStatus) => {
                  setCases(prev => prev.map(c => c.id === caseId ? { ...c, paymentStatus: newStatus } : c));
                }}
              />
            </>
          )}

          {/* ── RADAR INTEL (managers/owners only) ── */}
          {tab==="radar_intel"&&(
            <RadarIntelPage
              orgSession={orgSession}
              callGeminiInsight={callGeminiInsight}
              onOpenCase={handleLoadCase}
              totalCases={totalCases}
              lastSaved={lastSaved}
              policyAlerts={policyAlerts}
            />
          )}

          {/* ── POLICY ALERTS ── */}
          {tab==="policy"&&(
            <AlertsPage
              onOpenCase={handleLoadCase}
            />
          )}

          {/* ── INBOX SCANNER ── */}
          {tab==="inbox"&&(
            <InboxDashboard
              orgSession={orgSession}
              cases={cases}
              onOpenCase={handleLoadCase}
              onOpenCalendar={(date) => { setCalendarDate(date); setTab("calendar"); }}
              onUnreadChange={(count) => setInboxUnread(count)}
              authedFetch={authedFetch}
            />
          )}

          {/* ── CALENDAR ── */}
          {tab==="calendar"&&(
            <CalendarPage
              cases={cases}
              onOpenCase={handleLoadCase}
              initialDate={calendarDate}
            />
          )}

          {/* ── EXPIRY RADAR ── */}
          {tab==="expiry"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Expiry <em>Radar</em></h1>
                <p className="pg-sub">Document expiry dates across all saved cases · sorted by soonest deadline</p>
              </div>
              <ExpiryRadarPage
                cases={cases}
                onOpenCase={handleLoadCase}
                onCasesBackfilled={updates => {
                  setCases(prev => prev.map(c => {
                    const u = updates.find(u => u.id === c.id);
                    return u ? { ...c, expiryDate: u.expiryDate, expiryDocType: u.expiryDocType } : c;
                  }));
                }}
              />
            </>
          )}

          {/* ── HISTORY ── */}
          {tab==="history"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Case <em>History</em></h1>
                <p className="pg-sub">{totalCases} saved case{totalCases!==1?"s":""} · stored in Visalens cloud</p>
              </div>
<CaseHistory
  onLoad={handleLoadCase}
  onDelete={handleDeleteCase}
  onRenameCounsellor={async (oldName, newName) => {
    await renameCounsellorInSupabase(oldName, newName);
  }}
  onMergeCounsellors={async (sourceName, targetName) => {
    await mergeCounsellorsInSupabase(sourceName, targetName);
  }}
  onExpandCase={async (id) => {
    return await loadFullCase(id);
  }}
  refreshKey={totalCases}
  orgSession={orgSession}
  loadCasesFromSupabase={loadCasesFromSupabase}
  loadMoreCases={loadMoreCases}
  loadFullCase={loadFullCase}
  searchCases={searchCases}
  deleteCaseFromSupabase={deleteCaseFromSupabase}
  countCasesInSupabase={countCasesInSupabase}
/>
            </>
          )}
{tab==="agency" && (
  <>
    <div className="pg-hdr">
      <h1 className="pg-title">Agency <em>Panel</em></h1>
      <p className="pg-sub">Manage counsellors · track credit usage · invite team members</p>
    </div>
    <AgencyPanel availableCountries={Object.keys(mergedRequirements)} />
  </>
)}
        </main>
        {/* ── FOOTER ── */}
        <footer className="app-footer">
          <span>Powered by</span>
          <a href="https://designlama-ai.com" target="_blank" rel="noopener noreferrer" className="footer-brand">
            Designlama<span className="footer-brand-ai">-ai</span>
          </a>
        </footer>
        </div>{/* end .app-content */}
      </div>{/* end .app */}

      {/* ── FLOATING CHAT TRAY — app-level, persists across all tab changes ── */}
      <FloatingChatTray
        chats={openChats}
        onClose={closeChat}
        onToggleMinimise={toggleChatMinimise}
        peekOpen={peekOpen}
      />
    </ChatContext.Provider>
  );
}
/* ════════════════════════════════════════════════════════════════════════
   RADAR INTEL PAGE
   Standalone full-page view of the Smart ROI Matrix + counsellor analytics.
   Only accessible to branch_manager and org_owner roles (enforced in App nav
   and in the tab render guard above). Loads its own cases from Supabase so
   it works independently of any currently-loaded student in the Analyser.
════════════════════════════════════════════════════════════════════════ */
function RadarIntelPage({ orgSession, callGeminiInsight, onOpenCase, totalCases, lastSaved, policyAlerts = [] }) {
  const [cases,       setCases]       = React.useState([]);
  const [loading,     setLoading]     = React.useState(false);
  const [lastLoaded,  setLastLoaded]  = React.useState(null);
  const [counsellorFilter, setCounsellorFilter] = React.useState('All');
  const [viewMode,    setViewMode]    = React.useState('radar');  // 'radar' | 'perf'
  const [orgMembers,  setOrgMembers]  = React.useState([]); // active profiles from DB
  const geminiCache   = React.useRef(new Map());

  // Fetch active org members so counsellorList reflects real users, not legacy text names
  React.useEffect(() => {
    if (!orgSession?.org_id) return;
    window._supabaseInstance
      .from('profiles')
      .select('id, full_name')
      .eq('org_id', orgSession.org_id)
      .eq('is_active', true)
      .then(({ data }) => { if (data) setOrgMembers(data); });
  }, [orgSession?.org_id]);

  // Quadrant snapshot for movement tracking (same key as StudentDashboard)
  const [previousQuadrants, setPreviousQuadrants] = React.useState(() => {
    try { const s = orgSession; return JSON.parse(localStorage.getItem(`visalens_quadrants_${s?.org_id}`) || '{}'); }
    catch { return {}; }
  });

  const handleQuadrantsComputed = React.useCallback((map) => {
    try {
      const s = orgSession;
      if (!s?.org_id) return;
      localStorage.setItem(`visalens_quadrants_${s.org_id}`, JSON.stringify(map));
      setPreviousQuadrants(prev => {
        const hasChange = Object.keys(map).some(id => prev[id] !== map[id]);
        return hasChange ? { ...prev, ...map } : prev;
      });
    } catch {}
  }, [orgSession]);

  async function load() {
    setLoading(true);
    try {
      const s = orgSession;
      if (!s?.org_id) { setLoading(false); return; }
      let q = window._supabaseInstance.from('cases')
        .select('id,case_serial,created_at,updated_at,status_updated_at,student_name,counsellor_name,overall_score,target_country,lead_status,expiry_date,expiry_doc_type,application_targets,results,profile_data,doc_list,payment_status')
        .order('created_at', { ascending: false })
        .range(0, 199); // up to 200 for the radar — sufficient for org-level analytics
      if (s.role === 'counsellor' || s.role === 'viewer') {
        const name = s.name || s.full_name || s.email || '';
        if (name) q = q.eq('org_id', s.org_id).or(`created_by.eq.${s.member_id},counsellor_name.eq."${name}"`);
        else q = q.eq('org_id', s.org_id).eq('created_by', s.member_id);
      } else {
        q = q.eq('org_id', s.org_id);
      }
      const { data } = await q;
      setCases((data || []).map(r => ({
        id: r.id, caseSerial: r.case_serial || null,
        savedAt: r.created_at, updatedAt: r.updated_at,
        statusUpdatedAt: r.status_updated_at || r.updated_at || r.created_at,
        studentName: r.student_name || 'Unnamed', counsellorName: r.counsellor_name || '',
        overallScore: r.overall_score || 0, targetCountry: r.target_country || '',
        leadStatus: r.lead_status || 'None', expiryDate: r.expiry_date || null,
        expiryDocType: r.expiry_doc_type || null,
        applicationTargets: Array.isArray(r.application_targets) ? r.application_targets : [],
        results: r.results || {}, profileData: r.profile_data || {},
        docList: Array.isArray(r.doc_list) ? r.doc_list : [],
        paymentStatus: r.payment_status || 'Unpaid',
      })));
      setLastLoaded(new Date());
    } catch (e) { console.error('[RadarIntelPage] load error:', e); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, [totalCases, lastSaved]);

  // Use real member profiles as authoritative counsellor list.
  // Falls back to names on cases only if profiles haven't loaded yet.
  const counsellorOptions = React.useMemo(() => {
    const memberNames = orgMembers.map(m => m.full_name).filter(Boolean);
    if (memberNames.length > 0) return ['All', ...memberNames];
    return ['All', ...new Set(cases.map(c => c.counsellorName).filter(Boolean))];
  }, [orgMembers, cases]);

  const filtered = React.useMemo(() =>
    counsellorFilter === 'All' ? cases : cases.filter(c => c.counsellorName === counsellorFilter),
    [cases, counsellorFilter]);

  // Counsellor performance data (mirrors logic in StudentDashboard counsellorPerf memo)
  const counsellorPerf = React.useMemo(() => {
    const names = counsellorOptions.filter(n => n !== 'All');
    if (names.length < 1) return [];
    return names.map(name => {
      const myCases = cases.filter(c => c.counsellorName === name);
      const total = myCases.length;
      if (total === 0) return { name, total: 0, vip: 0, sales: 0, drainers: 0, dead: 0, movedUp: 0, movedDown: 0, avgScore: 0, score: 0 };
      const withQ = myCases.map(c => {
        const rawV = _viabilityScoreForRadar(c.profileData)?.score ?? c.overallScore ?? 0;
        const doc  = _computeDocScoreForRadar(c.profileData, c.results);
        const rPct = Math.round(((doc?.score ?? 0) / (doc?.totalPossible || 100)) * 100);
        let q = 'dead';
        if (rawV >= 50 && rPct >= 50) q = 'vip';
        else if (rawV >= 50 && rPct < 50) q = 'sales';
        else if (rawV < 50 && rPct >= 50) q = 'drainers';
        const prev = previousQuadrants[c.id];
        const moved = !!prev && prev !== q;
        const dir = moved ? (['vip', 'sales'].includes(q) ? 'up' : 'down') : null;
        return { q, moved, dir };
      });
      const vip = withQ.filter(c => c.q === 'vip').length;
      const sales = withQ.filter(c => c.q === 'sales').length;
      const drainers = withQ.filter(c => c.q === 'drainers').length;
      const dead = withQ.filter(c => c.q === 'dead').length;
      const movedUp = withQ.filter(c => c.dir === 'up').length;
      const movedDown = withQ.filter(c => c.dir === 'down').length;
      const avgScore = Math.round(myCases.reduce((s, c) => s + (c.overallScore || 0), 0) / total);
      const perfScore = Math.max(0, Math.min(100, Math.round(
        ((vip * 3 + sales * 2) / (total * 3)) * 60 +
        ((movedUp - movedDown) / Math.max(total, 1)) * 20 +
        (avgScore / 100) * 20
      )));
      return { name, total, vip, sales, drainers, dead, movedUp, movedDown, avgScore, score: perfScore };
    }).sort((a, b) => b.score - a.score);
  }, [cases, counsellorOptions, previousQuadrants]);

  const QUAD_COLOR = { vip: '#02a06d', sales: '#0d5fe0', drainers: '#e07b00', dead: '#6b7280' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Page header */}
      <div className="pg-hdr">
        <h1 className="pg-title">Lead <em>Generator</em></h1>
        <p className="pg-sub">Pipeline ROI matrix · counsellor performance · quadrant analytics · branch-level view</p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* View toggle */}
        <div style={{ display: 'flex', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', background: 'var(--s2)' }}>
          {[['radar', '⬡ Matrix View'], ['perf', '📊 Counsellor Analytics']].map(([mode, label]) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', background: viewMode === mode ? 'var(--s1)' : 'transparent', color: viewMode === mode ? 'var(--p)' : 'var(--t3)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--fu)', borderRight: mode === 'radar' ? '1px solid var(--bd)' : 'none', transition: 'all .15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Counsellor filter */}
        {counsellorOptions.length > 2 && (
          <select value={counsellorFilter} onChange={e => setCounsellorFilter(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--fu)', cursor: 'pointer' }}>
            {counsellorOptions.map(n => <option key={n} value={n}>{n === 'All' ? 'All counsellors' : n}</option>)}
          </select>
        )}

        {/* Refresh */}
        <button onClick={load} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--s1)', color: 'var(--t2)', fontSize: 12, fontFamily: 'var(--fu)', cursor: 'pointer', marginLeft: 'auto' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin .7s linear infinite' : 'none' }} />
          {lastLoaded && !loading && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{Math.floor((Date.now() - lastLoaded) / 60000)}m ago</span>}
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── RADAR MATRIX VIEW ── */}
      {viewMode === 'radar' && (
        <RadarMatrix
          cases={filtered}
          onOpenCase={onOpenCase}
          callGeminiInsight={callGeminiInsight}
          externalInsightCache={geminiCache.current}
          previousQuadrants={previousQuadrants}
          onQuadrantsComputed={handleQuadrantsComputed}
          counsellorList={counsellorOptions.filter(n => n !== 'All')}
          onReassign={async (caseId, counsellorName) => {
            const ts = new Date().toISOString();
            // Look up member id to keep assigned_to (uuid) in sync with counsellor_name
            const member = orgMembers.find(m => m.full_name === counsellorName);
            const assignedToId = member?.id || null;
            setCases(prev => prev.map(c => c.id === caseId ? {
              ...c,
              counsellorName,
              counsellor_name: counsellorName,
              assigned_to:     assignedToId,
              updatedAt: ts,
            } : c));
            const s = orgSession;
            if (!s?.org_id) return;
            await window._supabaseInstance.from('cases')
              .update({
                counsellor_name: counsellorName,
                assigned_to:     assignedToId,
                updated_at:      ts,
              })
              .eq('id', caseId).eq('org_id', s.org_id);
          }}
          onStatusChange={async (caseId, newStatus) => {
            const ts = new Date().toISOString();
            setCases(prev => prev.map(c => c.id === caseId ? { ...c, leadStatus: newStatus, updatedAt: ts } : c));
            const s = orgSession;
            if (!s?.org_id) return;
            await window._supabaseInstance.from('cases')
              .update({ lead_status: newStatus, updated_at: ts, status_updated_at: ts })
              .eq('id', caseId).eq('org_id', s.org_id);
          }}
          orgSession={orgSession}
        />
      )}

      {/* ── COUNSELLOR ANALYTICS VIEW ── */}
      {viewMode === 'perf' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {[
              { label: 'Total Cases', val: cases.length, color: 'var(--p)' },
              { label: 'VIP Lane', val: counsellorPerf.reduce((s, c) => s + c.vip, 0), color: '#02a06d' },
              { label: 'Sales Priority', val: counsellorPerf.reduce((s, c) => s + c.sales, 0), color: '#0d5fe0' },
              { label: 'Time Drainers', val: counsellorPerf.reduce((s, c) => s + c.drainers, 0), color: '#e07b00' },
              { label: 'Dead Zone', val: counsellorPerf.reduce((s, c) => s + c.dead, 0), color: '#6b7280' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--s2)', border: '1px solid var(--bd)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--fu)', lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Counsellor cards */}
          {counsellorPerf.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--t3)', fontSize: 14, fontFamily: 'var(--fu)' }}>
              No counsellor data available yet. Cases need to be assigned to counsellors.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {counsellorPerf.map((cp, idx) => {
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                const barColor = cp.score >= 70 ? '#02a06d' : cp.score >= 40 ? '#0d5fe0' : '#e07b00';
                const initials = cp.name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
                const hue = cp.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
                return (
                  <div key={cp.name} style={{ padding: '18px 20px', borderRadius: 12, background: 'var(--s1)', border: '1px solid var(--bd)', boxShadow: 'var(--sh1)' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: `hsl(${hue},55%,88%)`, color: `hsl(${hue},55%,30%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, fontFamily: 'var(--fu)' }}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {medal && <span style={{ fontSize: 16 }}>{medal}</span>}
                          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cp.name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 2 }}>{cp.total} case{cp.total !== 1 ? 's' : ''} · avg score {cp.avgScore}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: barColor, fontFamily: 'var(--fu)', lineHeight: 1 }}>{cp.score}</div>
                        <div style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Perf score</div>
                      </div>
                    </div>

                    {/* Performance bar */}
                    <div style={{ height: 6, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
                      <div style={{ height: '100%', width: `${cp.score}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor})`, borderRadius: 3, transition: 'width .5s' }} />
                    </div>

                    {/* Quadrant breakdown */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
                      {[['VIP', cp.vip, '#02a06d'], ['Sales', cp.sales, '#0d5fe0'], ['Drain', cp.drainers, '#e07b00'], ['Dead', cp.dead, '#6b7280']].map(([label, count, color]) => (
                        <div key={label} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: color + '12', border: `1px solid ${color}30` }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'var(--fu)', lineHeight: 1 }}>{count}</div>
                          <div style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Movement */}
                    {(cp.movedUp > 0 || cp.movedDown > 0) && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {cp.movedUp > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(2,160,109,.1)', color: '#02a06d', fontFamily: 'var(--fu)' }}>↑ {cp.movedUp} improved</span>}
                        {cp.movedDown > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(220,38,38,.1)', color: '#DC2626', fontFamily: 'var(--fu)' }}>↓ {cp.movedDown} declined</span>}
                        <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', display: 'flex', alignItems: 'center' }}>vs last session</span>
                      </div>
                    )}

                    {/* Filter button */}
                    <button onClick={() => { setCounsellorFilter(cp.name); setViewMode('radar'); }}
                      style={{ marginTop: 12, width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t2)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--fu)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--p)'; e.currentTarget.style.color = 'var(--p)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.color = 'var(--t2)'; }}
                    >
                      View in Matrix →
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Methodology note */}
          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--bd)', fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', lineHeight: 1.65 }}>
            <strong style={{ color: 'var(--t2)' }}>Performance score methodology:</strong> Pipeline quality 60% (VIP cases ×3 + Sales ×2 weight, normalised over total) · Quadrant movement delta since last session 20% (improvements minus declines) · Average case viability score 20%. Score range 0–100. Counsellors with no cases assigned are excluded.
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── FLOATING CHAT TRAY ─────────────────────────────────────────────────
   App-level chat tray — renders at fixed bottom-right, persists across all
   page/tab changes. Max 3 panels. Each panel expands upward when clicked.
   Chat thread is ChatTrayThread (self-contained, identical logic to
   ChatThreadInline in StudentDashboard but kept here to avoid circular deps).
─────────────────────────────────────────────────────────────────────────── */
const SENDER_PALETTE_TRAY = [
  { bg:'rgba(29,107,232,.12)',  color:'#1D6BE8' },
  { bg:'rgba(5,150,105,.12)',   color:'#059669' },
  { bg:'rgba(139,92,246,.12)',  color:'#7C3AED' },
  { bg:'rgba(252,71,28,.12)',   color:'#FC471C' },
  { bg:'rgba(245,158,11,.12)',  color:'#D97706' },
  { bg:'rgba(236,72,153,.12)',  color:'#DB2777' },
  { bg:'rgba(20,184,166,.12)',  color:'#0D9488' },
  { bg:'rgba(99,102,241,.12)',  color:'#4F46E5' },
];
function senderColorTray(name=''){
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return SENDER_PALETTE_TRAY[h%SENDER_PALETTE_TRAY.length];
}
function extractTagsTray(text=''){
  return [...new Set((text.match(/#\w+/g)||[]).map(t=>t.toLowerCase()))];
}
function fmtTrayTime(iso){
  if(!iso) return '';
  const d=new Date(iso), now=new Date();
  const diffDays=Math.floor((now-d)/86400000);
  if(diffDays===0) return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  if(diffDays===1) return 'Yesterday';
  if(diffDays<7)   return d.toLocaleDateString('en-GB',{weekday:'short'});
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
const TRAY_PAGE = 50;

/* ─── Task Popover — portal-anchored to "Make task" button (tray copy) ── */
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#059669' },
  { value: 'medium', label: 'Medium', color: '#D97706' },
  { value: 'high',   label: 'High',   color: '#FC471C' },
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
];

function TaskPopover({ msg, caseId, studentName, orgMembers, anchorRect, onClose, onCreated }) {
  const session      = getOrgSession();
  const myId         = session?.member_id || null;
  const myName       = session?.full_name || session?.name || session?.email || 'Me';
  const orgId        = session?.org_id    || null;

  function guessAssignee() {
    const mentioned = (msg.mentioned_ids || []);
    if (mentioned.length) {
      const m = orgMembers.find(om => om.id === mentioned[0]);
      if (m) return { id: m.id, name: m.full_name };
    }
    if (msg.sender_id && msg.sender_id !== myId) {
      return { id: msg.sender_id, name: msg.sender_name };
    }
    return { id: myId, name: myName };
  }

  const guess = guessAssignee();

  const [title,        setTitle]        = React.useState(
    msg.content ? (msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content) : ''
  );
  const [priority,     setPriority]     = React.useState('medium');
  const [dueDate,      setDueDate]      = React.useState('');
  const [assigneeId,   setAssigneeId]   = React.useState(guess.id   || '');
  const [assigneeName, setAssigneeName] = React.useState(guess.name || '');
  const [saving,       setSaving]       = React.useState(false);
  const [saved,        setSaved]        = React.useState(false);
  const [assignOpen,   setAssignOpen]   = React.useState(false);
  const [priorOpen,    setPriorOpen]    = React.useState(false);

  const panelRef = React.useRef(null);
  const titleRef = React.useRef(null);

  // Position: prefer opening above the button so it's always on-screen.
  // The popover is ~380px tall. If there's not enough room above, open below.
  const POPOVER_H = 380;
  const POPOVER_W = 300;
  const spaceAbove = anchorRect ? anchorRect.top : window.innerHeight;
  const openAbove  = anchorRect ? spaceAbove >= POPOVER_H : false;
  const top   = anchorRect
    ? openAbove
      ? Math.round(anchorRect.top - POPOVER_H - 6)
      : Math.min(Math.round(anchorRect.bottom + 6), window.innerHeight - POPOVER_H - 8)
    : 60;
  const rawRight = anchorRect ? Math.round(window.innerWidth - anchorRect.right) : 16;
  const right = Math.max(8, Math.min(rawRight, window.innerWidth - POPOVER_W - 8));

  React.useEffect(() => {
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 10);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  React.useEffect(() => { setTimeout(() => titleRef.current?.focus(), 30); }, []);

  async function handleCreate() {
    if (!title.trim() || !orgId || saving) return;
    setSaving(true);
    const { data: newTask, error } = await supabase.from('case_tasks').insert({
      case_id:          caseId,
      org_id:           orgId,
      title:            title.trim(),
      priority,
      due_date:         dueDate || null,
      assigned_to_id:   assigneeId   || null,
      assigned_to_name: assigneeName || null,
      created_by_id:    myId,
      created_by_name:  myName,
      status:           'open',
    }).select('id').single();
    setSaving(false);
    if (!error) {
      // System message — appears as pill divider in all chat views
      supabase.from('chat_messages').insert({
        case_id:     caseId,
        org_id:      orgId,
        sender_id:   myId,
        sender_name: myName,
        content:     `Task created: "${title.trim()}"${assigneeName ? ` → assigned to ${assigneeName}` : ''}${priority !== 'medium' ? ` · ${priority}` : ''}`,
        tags:        [],
        attachments: [],
        is_deleted:  false,
        is_system:   true,
        type:        'task_created',
        task_id:     newTask?.id || null,
      }).then(({ error: e }) => { if(e) console.warn('[ChatTrayThread] system msg error:', e); });

      // Assignee notification (skip if self-assigned)
      if (assigneeId && assigneeId !== myId) {
        supabase.from('notifications').insert({
          recipient_id: assigneeId,
          org_id:       orgId,
          type:         'task_assigned',
          actor_name:   myName,
          sender_name:  myName,
          case_id:      caseId,
          case_name:    studentName,
          message_id:   newTask?.id || null,
          body:         title.trim(),
          is_read:      false,
        }).then(({ error: e }) => { if(e) console.warn('[ChatTrayThread] task notif error:', e); });
      }

      setSaved(true);
      onCreated?.();
      setTimeout(() => onClose(), 900);
    }
  }

  const priColor = PRIORITY_OPTIONS.find(p => p.value === priority)?.color || '#D97706';

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top, right, width: 300, borderRadius: 10,
        background: 'var(--s1)', border: '1px solid var(--bd)',
        boxShadow: '0 8px 32px rgba(10,20,50,.35)', zIndex: 99999, overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--s2)',
      }}>
        <ClipboardList size={12} color="var(--p)"/>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>
          Create task — {studentName}
        </span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 2, display: 'flex', alignItems: 'center' }}>
          <X size={12}/>
        </button>
      </div>

      {saved ? (
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(5,150,105,.12)', border: '1.5px solid rgba(5,150,105,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px',
          }}>
            <Check size={16} color="#059669"/>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fu)' }}>Task created</div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 3 }}>It will appear in the peek drawer</div>
        </div>
      ) : (
        <div style={{ padding: '12px' }}>
          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
              Task title
            </label>
            <textarea
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate(); if (e.key === 'Escape') onClose(); }}
              style={{
                width: '100%', resize: 'none', boxSizing: 'border-box',
                padding: '7px 9px', borderRadius: 6,
                border: '1px solid var(--bd)', background: 'var(--s2)',
                color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--fu)',
                lineHeight: 1.5, outline: 'none', maxHeight: 80,
              }}
              onFocus={e => e.target.style.borderColor = 'var(--p)'}
              onBlur={e => e.target.style.borderColor = 'var(--bd)'}
            />
          </div>

          {/* Assignee + Priority row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {/* Assignee */}
            <div style={{ flex: 1, position: 'relative' }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
                Assign to
              </label>
              <button
                onClick={() => { setAssignOpen(o => !o); setPriorOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--bd)',
                  background: 'var(--s2)', color: 'var(--t1)', fontSize: 11,
                  fontFamily: 'var(--fu)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <User size={10} color="var(--t3)"/>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {assigneeName || 'Unassigned'}
                </span>
                <ChevronDown size={9} color="var(--t3)"/>
              </button>
              {assignOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: 'var(--s1)', border: '1px solid var(--bd)',
                  borderRadius: 7, boxShadow: '0 4px 16px rgba(10,20,50,.25)',
                  zIndex: 100001, overflow: 'hidden', maxHeight: 160, overflowY: 'auto',
                }}>
                  <button
                    onClick={() => { setAssigneeId(''); setAssigneeName(''); setAssignOpen(false); }}
                    style={{ width: '100%', padding: '7px 10px', border: 'none', background: 'transparent', color: 'var(--t3)', fontFamily: 'var(--fu)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Unassigned
                  </button>
                  {orgMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setAssigneeId(m.id); setAssigneeName(m.full_name); setAssignOpen(false); }}
                      style={{
                        width: '100%', padding: '7px 10px', border: 'none',
                        background: m.id === assigneeId ? 'var(--s3)' : 'transparent',
                        color: 'var(--t1)', fontFamily: 'var(--fu)', fontSize: 11,
                        cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = m.id === assigneeId ? 'var(--s3)' : 'transparent'}
                    >
                      {m.id === assigneeId && <Check size={9} color="var(--p)"/>}
                      {m.full_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority */}
            <div style={{ width: 90, position: 'relative' }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
                Priority
              </label>
              <button
                onClick={() => { setPriorOpen(o => !o); setAssignOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 8px', borderRadius: 6,
                  border: `1px solid ${priColor}44`, background: `${priColor}12`,
                  color: priColor, fontSize: 11, fontFamily: 'var(--fu)',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                <span style={{ flex: 1, textTransform: 'capitalize' }}>{priority}</span>
                <ChevronDown size={9}/>
              </button>
              {priorOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                  width: 110, background: 'var(--s1)', border: '1px solid var(--bd)',
                  borderRadius: 7, boxShadow: '0 4px 16px rgba(10,20,50,.25)',
                  zIndex: 100001, overflow: 'hidden',
                }}>
                  {PRIORITY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setPriority(opt.value); setPriorOpen(false); }}
                      style={{
                        width: '100%', padding: '7px 10px', border: 'none',
                        background: priority === opt.value ? 'var(--s3)' : 'transparent',
                        color: opt.color, fontFamily: 'var(--fu)', fontSize: 11,
                        cursor: 'pointer', textAlign: 'left', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = priority === opt.value ? 'var(--s3)' : 'transparent'}
                    >
                      {priority === opt.value && <Check size={9}/>}
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Due date */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
              Due date <span style={{ fontWeight: 400, opacity: .6 }}>(optional)</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--s2)' }}>
              <Calendar size={10} color="var(--t3)"/>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  color: dueDate ? 'var(--t1)' : 'var(--t3)',
                  fontSize: 11, fontFamily: 'var(--fu)', outline: 'none', cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* Source message chip */}
          <div style={{
            padding: '5px 8px', borderRadius: 5,
            background: 'rgba(29,107,232,.06)', border: '1px solid rgba(29,107,232,.12)',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--p)', fontFamily: 'var(--fu)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              From chat
            </div>
            <div style={{ fontSize: 10, color: 'var(--t2)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.content?.slice(0, 70)}{(msg.content?.length || 0) > 70 ? '…' : ''}
            </div>
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!title.trim() || saving}
            style={{
              width: '100%', padding: '8px', borderRadius: 7, border: 'none',
              background: title.trim() ? 'var(--p)' : 'var(--s3)',
              color: title.trim() ? '#fff' : 'var(--t3)',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--fu)',
              cursor: title.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background .12s',
            }}
          >
            {saving ? <Loader2 size={12} style={{ animation: 'spin .7s linear infinite' }}/> : <ClipboardList size={12}/>}
            {saving ? 'Creating…' : 'Create task'}
          </button>
          <div style={{ marginTop: 5, textAlign: 'center', fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            ⌘↵ to create
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

function TrayMsgRow({ msg, isMe, pal, grouped, onReply, onMakeTask }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{display:'flex',gap:5,alignItems:'flex-start',marginTop:grouped?2:8,flexDirection:isMe?'row-reverse':'row'}}
    >
      <div style={{width:22,flexShrink:0}}>
        {!grouped&&(
          <div style={{width:22,height:22,borderRadius:'50%',background:pal.bg,color:pal.color,fontWeight:700,fontSize:8,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${pal.color}33`,fontFamily:'var(--fh)'}}>
            {(msg.sender_name||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
          </div>
        )}
      </div>
      <div style={{maxWidth:'78%',display:'flex',flexDirection:'column',alignItems:isMe?'flex-end':'flex-start'}}>
        {!grouped&&(
          <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:2,flexDirection:isMe?'row-reverse':'row'}}>
            <span style={{fontSize:9,fontWeight:700,color:pal.color,fontFamily:'var(--fh)'}}>{isMe?'You':msg.sender_name}</span>
            <span style={{fontSize:8,color:'var(--t3)',fontFamily:'var(--fu)'}}>{fmtTrayTime(msg.created_at)}</span>
          </div>
        )}
        <div style={{padding:'5px 9px',borderRadius:grouped?(isMe?'7px 3px 3px 7px':'3px 7px 7px 3px'):(isMe?'7px 3px 7px 7px':'3px 7px 7px 7px'),background:isMe?'var(--p)':'var(--s2)',border:isMe?'none':'1px solid var(--bd)',color:isMe?'#fff':'var(--t1)',fontSize:11,fontFamily:'var(--fu)',lineHeight:1.5,wordBreak:'break-word',whiteSpace:'pre-wrap'}}>
          {(msg.content||'').split(/(#\w+|@\w+)/g).map((p,i)=>{
            if(/^#\w+/.test(p)) return <span key={i} style={{fontWeight:700,opacity:.85}}>{p}</span>;
            if(/^@/.test(p))    return <span key={i} style={{fontWeight:700,color:isMe?'rgba(255,255,255,.9)':'#1D6BE8',background:isMe?'rgba(255,255,255,.15)':'rgba(29,107,232,.1)',borderRadius:3,padding:'0 2px'}}>{p}</span>;
            return p;
          })}
        </div>
      </div>
      {/* Hover action buttons */}
      <div style={{display:'flex',gap:2,alignItems:'center',opacity:hover?1:0,transition:'opacity .15s',flexDirection:isMe?'row':'row-reverse',alignSelf:'center'}}>
        <button
          onClick={onReply}
          title="Reply"
          style={{width:24,height:24,borderRadius:5,border:'none',background:'var(--s3)',color:'var(--t3)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--s2)';}}
          onMouseLeave={e=>{e.currentTarget.style.background='var(--s3)';}}
        >
          <Reply size={11}/>
        </button>
        <button
          onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();onMakeTask(rect);}}
          title="Create task from this message"
          style={{width:24,height:24,borderRadius:5,border:'none',background:'var(--s3)',color:'var(--t3)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(29,107,232,.15)';e.currentTarget.style.color='var(--p)';}}
          onMouseLeave={e=>{e.currentTarget.style.background='var(--s3)';e.currentTarget.style.color='var(--t3)';}}
        >
          <ClipboardList size={11}/>
        </button>
      </div>
    </div>
  );
}

function ChatTrayThread({ caseId, studentName }) {
  const sessionRef = React.useRef(getOrgSession());
  const session    = sessionRef.current;
  const myId       = session?.member_id || null;
  const myName     = session?.full_name || session?.name || session?.email || 'You';

  const [messages,    setMessages]    = React.useState([]);
  const [loading,     setLoading]     = React.useState(true);
  const [sending,     setSending]     = React.useState(false);
  const [hasMore,     setHasMore]     = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [offset,      setOffset]      = React.useState(0);
  const [draft,       setDraft]       = React.useState('');
  const [replyTo,     setReplyTo]     = React.useState(null);

  // @mention state
  const [orgMembers,   setOrgMembers]   = React.useState([]);
  const [mentionQuery, setMentionQuery] = React.useState('');
  const [mentionOpen,  setMentionOpen]  = React.useState(false);
  const [mentionedIds, setMentionedIds] = React.useState([]);

  // task popover state: { msg, anchorRect } | null
  const [taskTarget,   setTaskTarget]   = React.useState(null);

  const bottomRef = React.useRef(null);
  const inputRef  = React.useRef(null);

  // Fetch members once
  React.useEffect(()=>{
    if(!session?.org_id) return;
    supabase.from('profiles').select('id,full_name')
      .eq('org_id',session.org_id).eq('is_active',true).neq('id',myId)
      .then(({data})=>{ if(data) setOrgMembers(data); });
  },[session?.org_id,myId]);

  const loadMessages = React.useCallback(async (fromOffset=0,append=false)=>{
    if(!caseId||!session?.org_id) return;
    if(fromOffset===0) setLoading(true); else setLoadingMore(true);
    const {data,error}=await supabase.from('chat_messages').select('*')
      .eq('case_id',caseId).eq('org_id',session.org_id)
      .order('created_at',{ascending:false}).range(fromOffset,fromOffset+TRAY_PAGE-1);
    if(!error&&data){
      const sorted=[...data].reverse();
      setMessages(prev=>append?[...sorted,...prev]:sorted);
      setHasMore(data.length===TRAY_PAGE);
      setOffset(fromOffset+data.length);
    }
    setLoading(false); setLoadingMore(false);
  },[caseId,session?.org_id]);

  React.useEffect(()=>{
    setMessages([]); setOffset(0); setHasMore(false);
    setDraft(''); setReplyTo(null); setMentionedIds([]); setMentionOpen(false);
    loadMessages(0,false);
    markRead();
  },[caseId,loadMessages]);

  React.useEffect(()=>{
    bottomRef.current?.scrollIntoView({behavior:'smooth'});
  },[messages.length]);

  React.useEffect(()=>{
    if(!caseId||!session?.org_id) return;
    const ch=supabase.channel(`tray-${caseId}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:`case_id=eq.${caseId}`},p=>{
        const msg=p.new; if(!msg?.id) return;
        setMessages(prev=>prev.some(m=>m.id===msg.id)?prev:[...prev,msg]);
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_messages',filter:`case_id=eq.${caseId}`},p=>{
        const u=p.new; if(!u?.id) return;
        setMessages(prev=>prev.map(m=>m.id===u.id?{...m,...u}:m));
      })
      .subscribe();
    return ()=>supabase.removeChannel(ch);
  },[caseId,session?.org_id]);

  async function markRead(){
    if(!caseId||!myId||!session?.org_id) return;
    try{ await supabase.from('chat_reads').upsert({
      case_id:caseId,org_id:session.org_id,member_id:myId,
      member_name:myName,last_read_at:new Date().toISOString(),
    },{onConflict:'case_id,member_id'}); }catch{}
  }

  async function grantMentionAccess(ids){
    if(!ids.length||!caseId||!session?.org_id) return;
    const now=new Date().toISOString();
    const rows=ids.map(memberId=>{
      const m=orgMembers.find(om=>om.id===memberId);
      return {case_id:caseId,org_id:session.org_id,member_id:memberId,
              member_name:m?.full_name||'',last_read_at:now,granted_access:true};
    });
    try{ await supabase.from('chat_reads').upsert(rows,{onConflict:'case_id,member_id'}); }catch{}
  }

  function resolveMentionIds(text){
    const matches=[...text.matchAll(/@([\w\s]+?)(?=\s@|\s#|$)/g)].map(m=>m[1].trim().toLowerCase());
    return orgMembers.filter(m=>matches.some(q=>m.full_name?.toLowerCase().startsWith(q))).map(m=>m.id);
  }

  async function handleSend(){
    const text=draft.trim();
    if(!text||!caseId||!session?.org_id||sending) return;
    setSending(true); setDraft(''); setReplyTo(null); setMentionOpen(false);
    const tags=extractTagsTray(text);
    const finalIds=[...new Set([...mentionedIds,...resolveMentionIds(text)])];
    const capturedReplyTo=replyTo; // capture before state clears
    const {data:insertedMsg}=await supabase.from('chat_messages').insert({
      case_id:caseId,org_id:session.org_id,sender_id:myId,sender_name:myName,
      sender_color:senderColorTray(myName).color,content:text,tags,
      reply_to_id:capturedReplyTo?.id||null,attachments:[],is_deleted:false,
      mentioned_ids:finalIds.length?finalIds:null,
    }).select('id').single();

    // ── Notify @mentioned members ────────────────────────────────────────
    if(finalIds.length){
      await grantMentionAccess(finalIds);
      const preview=text.length>80?text.slice(0,80)+'…':text;
      fetch(`${PROXY_URL}/api/notify`,{
        method:'POST', headers:getAuthHeaders(),
        body:JSON.stringify({
          recipient_ids: finalIds,
          sender_id:     myId,
          sender_name:   myName,
          type:          'mention',
          case_id:       caseId,
          case_name:     studentName,
          message_id:    insertedMsg?.id||null,
          body:          preview,
        }),
      }).catch(()=>{}); // fire-and-forget, never block UI
    }

    // ── Notify original sender on reply ─────────────────────────────────
    if(capturedReplyTo?.sender_id && capturedReplyTo.sender_id!==myId){
      const alreadyMentioned=finalIds.includes(capturedReplyTo.sender_id);
      if(!alreadyMentioned){
        const preview=text.length>80?text.slice(0,80)+'…':text;
        fetch(`${PROXY_URL}/api/notify`,{
          method:'POST', headers:getAuthHeaders(),
          body:JSON.stringify({
            recipient_ids: [capturedReplyTo.sender_id],
            sender_id:     myId,
            sender_name:   myName,
            type:          'reply',
            case_id:       caseId,
            case_name:     studentName,
            message_id:    insertedMsg?.id||null,
            body:          preview,
          }),
        }).catch(()=>{});
      }
    }

    setMentionedIds([]);
    setSending(false); markRead(); inputRef.current?.focus();
  }

  const mentionSuggestions=React.useMemo(()=>{
    if(!mentionQuery) return orgMembers.slice(0,8);
    const q=mentionQuery.toLowerCase();
    return orgMembers.filter(m=>m.full_name?.toLowerCase().startsWith(q)).slice(0,8);
  },[orgMembers,mentionQuery]);

  function handleDraftChange(e){
    const val=e.target.value; setDraft(val);
    const cursor=e.target.selectionStart;
    const textUpToCursor=val.slice(0,cursor);
    const atIdx=textUpToCursor.lastIndexOf('@');
    if(atIdx!==-1){
      const fragment=textUpToCursor.slice(atIdx+1);
      if(!/\s/.test(fragment)){ setMentionQuery(fragment); setMentionOpen(true); return; }
    }
    setMentionOpen(false); setMentionQuery('');
  }

  function selectMention(member){
    const cursor=inputRef.current?.selectionStart??draft.length;
    const textUpToCursor=draft.slice(0,cursor);
    const atIdx=textUpToCursor.lastIndexOf('@');
    const before=draft.slice(0,atIdx);
    const after=draft.slice(cursor);
    const inserted=`@${member.full_name} `;
    setDraft(before+inserted+after);
    setMentionedIds(prev=>[...new Set([...prev,member.id])]);
    setMentionOpen(false); setMentionQuery('');
    setTimeout(()=>{
      const newPos=before.length+inserted.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos,newPos);
    },0);
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'8px 10px',display:'flex',flexDirection:'column',gap:2}}>
        {hasMore&&(
          <button onClick={()=>loadMessages(offset,true)} disabled={loadingMore}
            style={{alignSelf:'center',padding:'3px 10px',borderRadius:5,background:'var(--s2)',border:'1px solid var(--bd)',color:'var(--t3)',fontSize:10,fontFamily:'var(--fu)',cursor:'pointer',marginBottom:4}}>
            {loadingMore?'Loading…':'Load earlier'}
          </button>
        )}
        {loading?(
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Loader2 size={16} color="var(--t3)" style={{animation:'spin .7s linear infinite'}}/>
          </div>
        ):messages.filter(m=>!m.is_deleted).length===0?(
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'24px 0'}}>
            <MessageSquare size={22} color="var(--s3)"/>
            <span style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--fu)'}}>Start the conversation</span>
          </div>
        ):(
          messages.map((msg,idx)=>{
            if(msg.is_deleted) return <div key={msg.id} style={{fontSize:10,color:'var(--t3)',fontStyle:'italic',padding:'1px 32px',fontFamily:'var(--fu)'}}>Message deleted</div>;
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
            const isMe=msg.sender_id===myId;
            const pal=senderColorTray(msg.sender_name||'');
            const prev=messages[idx-1];
            const grouped=prev&&prev.sender_id===msg.sender_id&&(new Date(msg.created_at)-new Date(prev.created_at))<120000;
            return(
              <TrayMsgRow key={msg.id} msg={msg} isMe={isMe} pal={pal} grouped={grouped}
                onReply={()=>setReplyTo({id:msg.id,sender_name:msg.sender_name,content:msg.content})}
                onMakeTask={rect=>setTaskTarget({msg,anchorRect:rect})}
              />
            );
          })
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Reply strip */}
      {replyTo&&(
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',background:'rgba(29,107,232,.06)',borderTop:'1px solid rgba(29,107,232,.15)',flexShrink:0}}>
          <Reply size={10} color="#1D6BE8"/>
          <div style={{flex:1,minWidth:0,fontSize:10,color:'var(--t3)',fontFamily:'var(--fu)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{replyTo.content?.slice(0,50)}</div>
          <button onClick={()=>setReplyTo(null)} style={{border:'none',background:'none',cursor:'pointer',color:'var(--t3)',padding:2}}><X size={10}/></button>
        </div>
      )}

      {/* Compose */}
      <div style={{padding:'6px 8px',borderTop:replyTo?'none':'1px solid var(--bd)',background:'var(--s2)',flexShrink:0,display:'flex',gap:5,alignItems:'flex-end',position:'relative'}}>
        {mentionOpen&&mentionSuggestions.length>0&&(
          <div style={{position:'absolute',bottom:'100%',left:8,right:40,background:'var(--s1)',border:'1px solid var(--bd)',borderRadius:8,boxShadow:'0 -4px 16px rgba(15,30,60,.18)',zIndex:310,marginBottom:4,overflow:'hidden'}}>
            <div style={{padding:'4px 10px',fontSize:9,fontWeight:700,color:'var(--t3)',fontFamily:'var(--fu)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--bd)'}}>
              Mention — grants chat access
            </div>
            {mentionSuggestions.map(m=>(
              <button key={m.id} onMouseDown={e=>{e.preventDefault();selectMention(m);}}
                style={{width:'100%',padding:'6px 10px',border:'none',background:'none',color:'var(--t1)',fontFamily:'var(--fu)',fontSize:11,cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:7}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}
              >
                <div style={{width:20,height:20,borderRadius:'50%',background:'rgba(29,107,232,.12)',border:'1.5px solid rgba(29,107,232,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,color:'#1D6BE8',flexShrink:0}}>
                  {(m.full_name||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
                </div>
                {m.full_name}
              </button>
            ))}
          </div>
        )}
        <textarea ref={inputRef} value={draft} onChange={handleDraftChange}
          onKeyDown={e=>{
            if(e.key==='Escape'){if(mentionOpen){setMentionOpen(false);return;}if(replyTo)setReplyTo(null);}
            if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}
          }}
          placeholder={`Message… (@ to mention)`}
          rows={1}
          style={{flex:1,resize:'none',padding:'6px 9px',borderRadius:6,border:'1px solid var(--bd)',background:'var(--s1)',color:'var(--t1)',fontSize:11,fontFamily:'var(--fu)',lineHeight:1.5,outline:'none',maxHeight:72,overflowY:'auto'}}
          onFocus={e=>e.target.style.borderColor='var(--p)'}
          onBlur={e=>e.target.style.borderColor='var(--bd)'}
          onInput={e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,72)+'px';}}
        />
        <button onClick={handleSend} disabled={!draft.trim()||sending}
          style={{width:30,height:30,borderRadius:6,border:'none',background:draft.trim()?'var(--p)':'var(--s3)',color:draft.trim()?'#fff':'var(--t3)',cursor:draft.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {sending?<Loader2 size={12} style={{animation:'spin .7s linear infinite'}}/>:<Send size={12}/>}
        </button>
      </div>
      {/* Task popover — portal-rendered above all tray windows */}
      {taskTarget && (
        <TaskPopover
          msg={taskTarget.msg}
          caseId={caseId}
          studentName={studentName}
          orgMembers={orgMembers}
          anchorRect={taskTarget.anchorRect}
          onClose={() => setTaskTarget(null)}
          onCreated={() => setTaskTarget(null)}
        />
      )}
    </div>
  );
}

function FloatingChatTray({ chats, onClose, onToggleMinimise, peekOpen }) {
  if(!chats.length) return null;
  // When peek drawer is open, shift the tray left so it doesn't sit behind it.
  // Drawer is min(440px,92vw) wide + 16px gap.
  const drawerOffset = peekOpen ? Math.min(440, window.innerWidth * 0.92) + 16 : 0;
  return (
    <div style={{position:'fixed',bottom:0,right:16 + drawerOffset,display:'flex',gap:8,alignItems:'flex-end',zIndex:600,pointerEvents:'none',transition:'right .2s ease'}}>
      {chats.map((chat, i) => (
        <div key={chat.caseId} style={{
          width:320,
          height: chat.minimised ? 48 : 'min(520px,76vh)',
          background:'var(--s1)',
          border:'1px solid var(--bd)',
          borderBottom:'none',
          borderRadius:'10px 10px 0 0',
          boxShadow:'0 -4px 32px rgba(15,30,60,.22)',
          display:'flex',flexDirection:'column',
          transition:'height .2s var(--eout)',
          overflow:'hidden',
          pointerEvents:'all',
          order: chats.length - i, // rightmost = most recently opened
        }}>
          {/* Title bar */}
          <div style={{display:'flex',alignItems:'center',gap:7,padding:'0 10px',height:48,flexShrink:0,background:'var(--s2)',borderBottom:chat.minimised?'none':'1px solid var(--bd)',cursor:'pointer',userSelect:'none'}}
            onClick={()=>onToggleMinimise(chat.caseId)}>
            <div style={{width:26,height:26,borderRadius:'50%',flexShrink:0,background:'rgba(29,107,232,.12)',border:'1.5px solid rgba(29,107,232,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#1D6BE8',fontFamily:'var(--fh)'}}>
              {(chat.studentName||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t1)',fontFamily:'var(--fh)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{chat.studentName}</div>
              <div style={{fontSize:9,color:'var(--t3)',fontFamily:'var(--fu)'}}>{chat.minimised?'Click to expand':'Case chat'}</div>
            </div>
            <button onClick={e=>{e.stopPropagation();onClose(chat.caseId);}}
              style={{width:24,height:24,borderRadius:5,border:'none',background:'var(--s3)',color:'var(--t2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <X size={11}/>
            </button>
          </div>
          {/* Thread body */}
          {!chat.minimised&&(
            <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
              <ChatTrayThread caseId={chat.caseId} studentName={chat.studentName}/>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── ACCEPT INVITE PAGE ─────────────────────────────────────────────── */
function AcceptInvitePage({ token, onDone }) {
  const [fullName,  setFullName]  = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [showPw,    setShowPw]    = useState(false);

  async function submit() {
    if (!password || password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      const resp = await fetch(`${PROXY_URL}/api/agency/accept-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, full_name: fullName.trim() || undefined }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) { setError(data.error || "Failed to activate account."); setLoading(false); return; }
      setSuccess(true);
      setTimeout(() => onDone?.(), 2500);
    } catch { setError("Connection error. Please try again."); setLoading(false); }
  }

  return (
    <div className="gate-wrap">
      <div className="gate-card">
        <div className="gate-logo">
          <div className="gate-logo-mark"><ShieldCheck size={22} color="#fff"/></div>
          <span className="gate-logo-name">VisaLens</span>
          <span className="gate-logo-tag">PRO</span>
        </div>
        {success ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <CheckCircle size={40} color="var(--ok)" style={{margin:"0 auto 12px",display:"block"}}/>
            <div className="gate-title" style={{fontSize:"1.1rem"}}>Account activated!</div>
            <div className="gate-sub">Redirecting to sign in…</div>
          </div>
        ) : (
          <>
            <div className="gate-title">Accept Your Invitation</div>
            <div className="gate-sub">Set up your VisaLens account to get started.</div>
            <div className="gate-field">
              <label className="gate-lbl">Full Name</label>
              <input className="gate-input" type="text" placeholder="Your full name"
                value={fullName} onChange={e => setFullName(e.target.value)} autoFocus />
            </div>
            <div className="gate-field" style={{position:"relative"}}>
              <label className="gate-lbl">Password</label>
              <input className="gate-input" type={showPw ? "text" : "password"} placeholder="Min. 8 characters"
                value={password} onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && submit()} style={{paddingRight:36}} />
              <button onClick={() => setShowPw(p => !p)}
                style={{position:"absolute",right:10,bottom:10,background:"none",border:"none",cursor:"pointer",color:"var(--t3)",padding:0}}>
                {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            <div className="gate-field">
              <label className="gate-lbl">Confirm Password</label>
              <input className="gate-input" type="password" placeholder="Repeat password"
                value={confirm} onChange={e => { setConfirm(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            {error && <div className="gate-err"><AlertCircle size={13} style={{flexShrink:0}}/>{error}</div>}
            <button className="gate-btn" onClick={submit} disabled={!password || !confirm || loading}>
              {loading ? <><Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/>Setting up…</>
                       : <><ShieldCheck size={16}/>Activate Account</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ROOT APP WRAPPER ───────────────────────────────────────────── */
function App() {
  const currentPath  = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);

  if (currentPath === '/admin') return <AdminPanel />;

  // ── Analytics route — role-gated to org_owner and branch_manager only ──
  if (currentPath === '/analytics') {
    const session = (() => {
      try { return JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null'); }
      catch { return null; }
    })();
    if (!['org_owner', 'branch_manager'].includes(session?.role)) {
      window.location.href = '/';
      return null;
    }
    return <AnalyticsDashboard orgSession={session} onLogout={() => {
      try { sessionStorage.removeItem('visalens_org_session'); } catch {}
      window.location.href = '/';
    }} />;
  }

  const inviteToken = searchParams.get('token');
  if (currentPath === '/invite' && inviteToken) {
    return (
      <AcceptInvitePage
        token={inviteToken}
        onDone={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}
      />
    );
  }

  // Check for public interview URLs
  const publicInterviewMatch = currentPath.match(/^\/interview\/([a-f0-9-]+)$/);
  if (publicInterviewMatch) {
    const interviewToken = publicInterviewMatch[1];
    return <PublicInterview token={interviewToken} />;
  }

  const [orgSession, setOrgSessionState] = useState(() => getOrgSession());

  function handleUnlock(sessionData) {
    setOrgSession(sessionData);
    setOrgSessionState(sessionData);
    // Set Supabase auth session immediately so RLS sees the correct auth.uid()
    if (sessionData?.access_token && sessionData?.refresh_token) {
      supabase.auth.setSession({
        access_token:  sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      }).catch(e => console.warn('[Auth] setSession on unlock failed:', e));
    }
  }

  function handleLogout() {
    clearOrgSession();
    setOrgSessionState(null);
  }

  if (!orgSession) return <LoginPage onUnlock={handleUnlock}/>;
  return <VisaLensApp orgSession={orgSession} onLogout={handleLogout}/>;
}

export default App;
