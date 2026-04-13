import React, { useState, useEffect, useRef } from 'react';
import {
  Building2, Check, CheckCircle, ChevronDown, Clock,
  Download, FileSpreadsheet, Info, ListChecks, RefreshCw,
  ShieldCheck, Trash2, Upload,
} from 'lucide-react';

import { parseIELTS, parseGPA, parseFinancial, parseCSV, csvToRequirements, downloadCSV } from '../utils/parsers';
import { resolveOffer } from '../utils/parsers';
import { VISA_DOC_TYPES, GENERIC_VISA_DOCS, UNIVERSITY_DATA, TEMPLATE_CSV } from '../constants/countries';
import { getCountryMeta } from '../constants/countries';

// ─── SidebarDocChecklist ──────────────────────────────────────────────────────
export function SidebarDocChecklist({ profile, preferredOfferIndex, docs, docTypes }) {
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

  function isAutoPresent(docType) {
    if (!docs || !docs.length) return false;
    const accepts = CHECKLIST_ACCEPTS[docType] || [docType];
    return docs.some(d => accepts.includes(docTypes[d.id] || d.type || "other"));
  }

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
                  <input type="checkbox" className="sb-checkbox" checked={ticked}
                    onChange={() => { if (!auto) setManualTicked(p=>({...p,[r.docType]:!p[r.docType]})); }}
                  />
                  <span className="sb-check-name">{r.item}</span>
                  {auto && <span className="badge b-ok" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Auto</span>}
                  {!auto && !r.required && <span className="badge b-neu" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Optional</span>}
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

// ─── UniversityChecker ────────────────────────────────────────────────────────
export function UniversityChecker({ profile, requirementsData, compact, preferredOfferIndex }) {
  const resolved    = resolveOffer(profile, preferredOfferIndex);
  const seedCountry = resolved.country   || "";
  const seedUni     = resolved.university || "";

  const [country, setCountry]   = useState(seedCountry);
  const [uniName, setUniName]   = useState(seedUni);
  const [progName, setProgName] = useState("");

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

  function pteToIelts(pte) {
    if (pte >= 79) return 9.0; if (pte >= 73) return 8.5; if (pte >= 65) return 7.5;
    if (pte >= 59) return 7.0; if (pte >= 50) return 6.5; if (pte >= 43) return 6.0;
    if (pte >= 36) return 5.5; return 5.0;
  }

  function bestIeltsEquiv(profile) {
    const scores = [];
    const i = parseIELTS(profile.ieltsScore); if (i !== null) scores.push(i);
    const t = parseFloat(profile.toeflScore);  if (!isNaN(t))  scores.push(t / 14.5);
    const p = parseFloat(profile.pteScore);    if (!isNaN(p))  scores.push(pteToIelts(p));
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
      const hasOther = (profile?.otherEnglishTest && profile.otherEnglishTest !== "Not found") ||
                       (profile?.mediumOfInstruction && profile.mediumOfInstruction !== "Not found");
      return "unknown";
    }
    if (!val || val === "Not found" || req == null) return "unknown";
    if (type === "gpa")       { const v = parseGPA(val);       return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    if (type === "financial") { const v = parseFinancial(val); return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    return "unknown";
  }

  function englishScoreLabel(profile) {
    const parts = [];
    if (Array.isArray(profile.englishTests) && profile.englishTests.length > 0) {
      for (const et of profile.englishTests) {
        if (et.overallScore && et.overallScore !== "Not found" && et.overallScore !== "") {
          parts.push(`${et.type||"Test"} ${et.overallScore}`);
        }
      }
    }
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

  const BUILTIN_COUNTRIES = Object.keys(UNIVERSITY_DATA);
  const isCustomCountry = country && !BUILTIN_COUNTRIES.includes(country);

  return (
    <div className={compact ? "uni-sidebar-card" : "rc rc-blue vl-uni-card"}>
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
            <div className={`vl-uni-verdict-bar ${verdict}`} style={{marginBottom:10}}>
              <span style={{fontSize:13}}>{verdict==="eligible"?"✓":verdict==="ineligible"?"✗":"⚠️"}</span>
              <span style={{flex:1}}>{verdictText}</span>
              <span className="badge b-neu" style={{flexShrink:0}}>{uniData.ranking}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
              {[
                {label:"Min GPA",            req:prog.gpa,       val:profile.academicResult,   type:"gpa",       fmt:v=>`GPA ${v}`},
                {label:"English Proficiency", req:prog.ielts,     val:englishScoreLabel(profile), type:"ielts",     fmt:v=>`IELTS ${v}+`},
                {label:"Financial Req.",      req:prog.financial, val:profile.financialBalance,   type:"financial", fmt:v=>`${v.toLocaleString()}`},
              ].map(r => {
                const status = r.type === "ielts" ? checkReq(null, r.req, "ielts", profile) : checkReq(r.val, r.req, r.type);
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

// ─── SidebarVisaChecklist ─────────────────────────────────────────────────────
export function SidebarVisaChecklist({ profile, preferredOfferIndex }) {
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

// ─── RequirementsManager ──────────────────────────────────────────────────────
export function RequirementsManager({ customRequirements, onLoad, onClear, csvText }) {
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
