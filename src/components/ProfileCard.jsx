import React, { useState, useEffect } from 'react';
import {
  AlertCircle, Check, CheckCircle, ChevronDown, Clock,
  Edit3, FileSpreadsheet, Info, Pencil, TriangleAlert,
  X, XCircle,
} from 'lucide-react';

import { lookupFundsRequired } from '../utils/parsers';
import { validatePassportNumber } from '../utils/mrz';
import ExpiryAlerts from './ExpiryAlerts';
import CopyBtn from './CopyBtn';
import FundsSufficiencyBanner from './FundsSufficiencyBanner';
import OfferLettersSection from './OfferLettersSection';
import CasDocumentsSection from './CasDocumentsSection';

export default function ProfileCard({ data, setData, preferredOfferIndex, setPreferredOfferIndex, requirementsData }) {
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
