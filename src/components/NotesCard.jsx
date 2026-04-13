import React, { useState } from 'react';
import {
  ArrowUpRight, Check, ChevronDown, Clock, Dot,
  GraduationCap, Plus, Save, TriangleAlert, User, X,
} from 'lucide-react';
import { COUNTRY_META, UNIVERSITY_DATA } from '../constants/countries';

// ─── Constants ────────────────────────────────────────────────────────────────
const INTAKE_SEASONS = ["Fall (Aug/Sept)", "Spring (Jan)", "Summer (May)", "Annual"];
const INTAKE_YEARS   = ["2026", "2027", "2028"];
export const LEAD_STATUSES = [
  "None", "New Lead", "Follow up", "Ready to Apply",
  "Application Started", "Application Paid", "Application Submitted",
  "Application Accepted", "Ready for Visa", "Done",
];

const COUNTRY_FLAGS = Object.fromEntries(
  Object.entries({...COUNTRY_META, ...Object.fromEntries(
    Object.entries(UNIVERSITY_DATA).map(([k,v]) => [k, {flag: v.flag}])
  )}).map(([k,v]) => [k, v.flag || "🌍"])
);

// ─── makeEmptyTarget ──────────────────────────────────────────────────────────
export function makeEmptyTarget() {
  return { country: "", countryOther: "", university: "", universityOther: "", programme: "", programmeOther: "", intakeYear: "", intakeSeason: "", deferred: false, deferredDate: "" };
}

// ─── makeTargetsFromOffers ────────────────────────────────────────────────────
export function makeTargetsFromOffers(offerLetters, requirementsData) {
  if (!Array.isArray(offerLetters) || !offerLetters.length) return [];

  const knownCountries = Object.keys(requirementsData || {});

  function normaliseSeason(raw) {
    if (!raw || raw === "Not found") return "";
    const r = raw.toLowerCase();
    if (r.includes("sep") || r.includes("aug") || r.includes("fall") || r.includes("autumn")) return "Fall (Aug/Sept)";
    if (r.includes("jan") || r.includes("spring") || r.includes("winter"))                    return "Spring (Jan)";
    if (r.includes("may") || r.includes("summer"))                                             return "Summer (May)";
    if (r.includes("annual") || r.includes("rolling") || r.includes("any"))                   return "Annual";
    return "";
  }

  function extractYear(raw) {
    if (!raw) return "";
    const m = raw.match(/\b(20\d{2})\b/);
    return m ? m[1] : "";
  }

  function matchCountry(raw) {
    if (!raw || raw === "Not found") return { country: "", countryOther: "" };
    if (knownCountries.includes(raw)) return { country: raw, countryOther: "" };
    const lower = raw.toLowerCase();
    const found = knownCountries.find(c => c.toLowerCase() === lower);
    if (found) return { country: found, countryOther: "" };
    return { country: "Other", countryOther: raw };
  }

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
    .filter(o => o && (o.country || o.university))
    .map(o => {
      const { country, countryOther } = matchCountry(o.country);
      const { university, universityOther } = matchUniversity(o.university, country, requirementsData);
      const uniKey = university !== "Other" ? university : "";
      const { programme, programmeOther } = matchProgramme(o.program, country, uniKey, requirementsData);
      return {
        country, countryOther, university, universityOther,
        programme, programmeOther,
        intakeSeason: normaliseSeason(o.intakeSeason),
        intakeYear:   extractYear(o.intakeSeason) || extractYear(o.intakeYear),
        deferred: false, deferredDate: "",
        _fromOffer: true,
        _offerProgram: o.program || "",
      };
    });
}

// ─── TargetCard ───────────────────────────────────────────────────────────────
export function TargetCard({ target, idx, total, requirementsData, profileData, preferredOfferIndex, onChange, onRemove, collapsed, onToggleCollapse }) {
  const isPrimary = idx === 0;
  const countries = Object.keys(requirementsData);

  const unis = target.country && target.country !== "Other" && requirementsData[target.country]
    ? Object.keys(requirementsData[target.country].universities || {})
    : [];
  const showUniDropdown = unis.length > 0;

  const resolvedUniKey = (target.university && target.university !== "Other") ? target.university : null;
  const programmes = resolvedUniKey && target.country && target.country !== "Other"
    ? (requirementsData[target.country]?.universities?.[resolvedUniKey]?.programs || []).map(p => p.name)
    : [];
  const showProgDropdown = programmes.length > 0;

  const offerCountries = (Array.isArray(profileData?.offerLetters) ? profileData.offerLetters : [])
    .map(o => o.country).filter(c => c && c !== "Not found");
  const resolvedCountry = target.country === "Other" ? target.countryOther.trim() : target.country;
  const countryConflict = resolvedCountry && offerCountries.length > 0 &&
    !offerCountries.some(c => c.toLowerCase() === resolvedCountry.toLowerCase());

  const offerYears = (Array.isArray(profileData?.offerLetters) ? profileData.offerLetters : [])
    .map(o => (o.intakeSeason || "").match(/(20\d{2})/)?.[1]).filter(Boolean);
  const yearConflict = target.intakeYear && offerYears.length > 0 && !offerYears.includes(target.intakeYear);

  const flag = resolvedCountry ? (COUNTRY_FLAGS[resolvedCountry] || "🌍") : null;
  const accentColor = isPrimary ? "var(--p)" : "var(--t2)";
  const accentBg    = isPrimary ? "var(--pg)" : "var(--s3)";
  const accentBd    = isPrimary ? "rgba(29,107,232,.25)" : "var(--bd)";
  const resolvedProg = target.programme === "Other" ? target.programmeOther : target.programme;

  return (
    <div style={{background:"var(--s1)",border:`1px solid ${isPrimary?"rgba(29,107,232,.3)":"var(--bd)"}`,borderRadius:"var(--r2)",overflow:"hidden",boxShadow:isPrimary?"0 2px 8px rgba(29,107,232,.08)":"var(--sh1)",transition:"box-shadow var(--base)"}}>
      {/* Card header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",background:isPrimary?"rgba(29,107,232,.04)":"var(--s2)",borderBottom:collapsed?"none":`1px solid ${isPrimary?"rgba(29,107,232,.12)":"var(--bd)"}`,cursor:"pointer"}} onClick={onToggleCollapse}>
        <div style={{width:22,height:22,borderRadius:"var(--r1)",flexShrink:0,background:accentBg,border:`1px solid ${accentBd}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <GraduationCap size={12} color={accentColor}/>
        </div>
        <div style={{flex:1,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",minWidth:0}}>
          <span style={{fontFamily:"var(--fh)",fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:accentColor}}>
            {isPrimary ? "Primary Target" : `Target ${idx + 1}`}
          </span>
          {isPrimary && <span style={{fontSize:9,fontWeight:700,fontFamily:"var(--fm)",textTransform:"uppercase",letterSpacing:".06em",background:"var(--pg)",color:"var(--p)",border:"1px solid rgba(29,107,232,.2)",borderRadius:4,padding:"1px 5px"}}>Sets target country</span>}
          {target._fromOffer && <span style={{fontSize:9,fontWeight:700,fontFamily:"var(--fm)",textTransform:"uppercase",letterSpacing:".06em",background:"rgba(5,150,105,.08)",color:"var(--ok)",border:"1px solid rgba(5,150,105,.2)",borderRadius:4,padding:"1px 5px"}}>From offer letter</span>}
          {collapsed && resolvedCountry && (
            <span style={{fontSize:10,color:"var(--t2)",fontFamily:"var(--fu)",display:"flex",alignItems:"center",gap:4,minWidth:0,overflow:"hidden"}}>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {flag} {resolvedCountry}{resolvedProg?` · ${resolvedProg}`:""}{target.intakeYear?` · ${target.intakeYear}`:""}{target.intakeSeason?` · ${target.intakeSeason.split(" ")[0]}`:""}{target.deferred?" · ⏳":""}
              </span>
            </span>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          {total > 1 && (
            <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove target"
              style={{width:20,height:20,borderRadius:"var(--r1)",border:"1px solid var(--bd)",background:"var(--s2)",color:"var(--t3)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all var(--fast)"}}
              onMouseEnter={e=>{e.currentTarget.style.background="var(--errg)";e.currentTarget.style.borderColor="var(--err)";e.currentTarget.style.color="var(--err)"}}
              onMouseLeave={e=>{e.currentTarget.style.background="var(--s2)";e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--t3)"}}>
              <X size={10}/>
            </button>
          )}
          <ChevronDown size={13} color="var(--t3)" style={{transform:collapsed?"rotate(-90deg)":"none",transition:"transform var(--fast)"}}/>
        </div>
      </div>

      {!collapsed && (
        <div style={{padding:"12px 12px 14px"}}>
          <div className="uni-select-wrap" style={{marginBottom:10}}>
            <label className="uni-select-lbl">Destination Country</label>
            <select className="uni-select" value={target.country}
              onChange={e=>onChange({...target,country:e.target.value,countryOther:"",university:"",universityOther:"",programme:"",programmeOther:""})}>
              <option value="">Select country…</option>
              {countries.map(c=><option key={c} value={c}>{requirementsData[c]?.flag||"🌍"} {c}</option>)}
              <option value="Other">🌍 Other…</option>
            </select>
            {target.country==="Other" && (
              <input className="uni-select" style={{marginTop:6}} placeholder="Type country name…"
                value={target.countryOther} onChange={e=>onChange({...target,countryOther:e.target.value})}/>
            )}
            {countryConflict && (
              <div style={{marginTop:5,fontSize:11,color:"var(--warn)",display:"flex",alignItems:"flex-start",gap:5,lineHeight:1.4}}>
                <TriangleAlert size={11} style={{flexShrink:0,marginTop:1}}/><span>Differs from extracted offer letter country ({offerCountries[0]}). This entry takes precedence.</span>
              </div>
            )}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">University</label>
              {showUniDropdown ? (
                <>
                  <select className="uni-select" value={target.university}
                    onChange={e=>onChange({...target,university:e.target.value,universityOther:"",programme:"",programmeOther:""})}
                    disabled={!target.country}>
                    <option value="">Select university…</option>
                    {unis.map(u=><option key={u} value={u}>{u}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {target.university==="Other" && (
                    <input className="uni-select" style={{marginTop:6}} placeholder="Type university name…"
                      value={target.universityOther} onChange={e=>onChange({...target,universityOther:e.target.value})}/>
                  )}
                </>
              ) : (
                <input className="uni-select"
                  placeholder={target.country&&target.country!=="Other"?"No data — type name…":"Type university name…"}
                  value={target.universityOther} onChange={e=>onChange({...target,universityOther:e.target.value})}/>
              )}
            </div>

            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Programme</label>
              {showProgDropdown ? (
                <>
                  <select className="uni-select" value={target.programme}
                    onChange={e=>onChange({...target,programme:e.target.value,programmeOther:""})}>
                    <option value="">Select programme…</option>
                    {programmes.map(p=><option key={p} value={p}>{p}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {target.programme==="Other" && (
                    <input className="uni-select" style={{marginTop:6}} placeholder="Type programme name…"
                      value={target.programmeOther} onChange={e=>onChange({...target,programmeOther:e.target.value})}/>
                  )}
                </>
              ) : (
                <input className="uni-select"
                  placeholder={resolvedUniKey?"No programmes on file — type name…":"Select university first or type…"}
                  value={target.programmeOther} onChange={e=>onChange({...target,programme:"Other",programmeOther:e.target.value})}/>
              )}
              {target.programme==="Other" && !target.programmeOther && target._offerProgram && (
                <button style={{marginTop:5,fontSize:10,color:"var(--p)",background:"var(--pg)",border:"1px solid rgba(29,107,232,.2)",borderRadius:"var(--r1)",padding:"2px 8px",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,fontFamily:"var(--fu)"}}
                  onClick={()=>onChange({...target,programmeOther:target._offerProgram})}>
                  <ArrowUpRight size={10}/>Use offer: "{target._offerProgram}"
                </button>
              )}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Intake Year</label>
              <select className="uni-select" value={target.intakeYear} onChange={e=>onChange({...target,intakeYear:e.target.value})}>
                <option value="">Year…</option>
                {INTAKE_YEARS.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              {yearConflict && (
                <div style={{marginTop:4,fontSize:10,color:"var(--warn)",display:"flex",gap:4,alignItems:"flex-start"}}>
                  <TriangleAlert size={10} style={{flexShrink:0,marginTop:1}}/><span>Offer shows {offerYears[0]}</span>
                </div>
              )}
            </div>
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Intake Season</label>
              <select className="uni-select" value={target.intakeSeason} onChange={e=>onChange({...target,intakeSeason:e.target.value})}>
                <option value="">Season…</option>
                {INTAKE_SEASONS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",fontSize:12,fontFamily:"var(--fu)",color:"var(--t2)",marginBottom:target.deferred?8:0}}>
            <input type="checkbox" checked={target.deferred}
              onChange={e=>onChange({...target,deferred:e.target.checked,deferredDate:e.target.checked?target.deferredDate:""})}
              style={{width:14,height:14,accentColor:"var(--p)",cursor:"pointer"}}/>
            <span>Deferred</span>
          </label>
          {target.deferred && (
            <div className="uni-select-wrap">
              <label className="uni-select-lbl">Deferred Until</label>
              <input type="date" className="uni-select" value={target.deferredDate} onChange={e=>onChange({...target,deferredDate:e.target.value})}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NotesCard ────────────────────────────────────────────────────────────────
export default function NotesCard({
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
      <div className="vl-cp-hdr">
        <div className="rc-ico" style={{background:"rgba(255,255,255,.18)",borderRadius:8,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <User size={14} color="#fff"/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",fontFamily:"var(--fh)"}}>Counsellor Panel</div>
          {activeCaseSerial && <div style={{fontSize:10,fontFamily:"var(--fm)",color:"rgba(255,255,255,0.65)",marginTop:1}}>{activeCaseSerial}</div>}
        </div>
        {leadStatus && leadStatus !== "None" && (
          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:9,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",background:sc.bg,color:sc.color,border:`1px solid ${sc.bd}`,borderRadius:4,padding:"2px 7px",flexShrink:0}}>{leadStatus}</span>
        )}
        <button className="rc-hdr--btn-collapse" onClick={() => setCollapsed(c => !c)}
          style={{background:"none",border:"none",cursor:"pointer",padding:4,color:"rgba(255,255,255,0.8)",display:"flex",alignItems:"center",marginLeft:4}}>
          <ChevronDown size={14} style={{transition:"transform 200ms",transform:collapsed?"none":"rotate(180deg)"}}/>
        </button>
      </div>

      <div style={collapsed ? { display: "none" } : {}}>
        {/* Pipeline timeline */}
        <div className="vl-pipeline" style={{padding:"12px 16px 0"}}>
          <div className="vl-pipeline-track">
            {PIPELINE_LABELS.map((label, i) => {
              const done   = i < pIdx;
              const active = i === pIdx;
              return (
                <div key={i} className="vl-pipeline-step">
                  {i < PIPELINE_LABELS.length - 1 && <div className={`vl-pipeline-line${done||active?" done":""}`}/>}
                  <div className={`vl-pipeline-dot${done?" done":active?" active":""}`}>
                    {done ? <Check size={8}/> : active ? <Dot size={10}/> : null}
                  </div>
                  <div className={`vl-pipeline-label${active?" active":""}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Static info row */}
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

        {/* Counsellor + Lead Status row */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"10px 16px 0"}}>
          <div style={{position:"relative"}}>
            <label className="uni-select-lbl">Counsellor</label>
            {activeCaseId ? (
              <>
                <div className="uni-select" style={{background:"var(--s3)",opacity:0.7,cursor:"not-allowed",display:"flex",alignItems:"center"}}>{counsellorName || "—"}</div>
                <div style={{fontSize:10,color:"var(--t3)",marginTop:3,fontFamily:"var(--fm)"}}>🔒 Locked — saved</div>
              </>
            ) : (
              <select className="uni-select" value={counsellorName} onChange={e=>setCounsellorName(e.target.value)}>
                <option value="">Select counsellor…</option>
                {memberNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="uni-select-lbl">Lead Status</label>
            <select className="uni-select" value={leadStatus} onChange={e=>setLeadStatus(e.target.value)}
              style={{background:sc.bg,color:sc.color,border:`1px solid ${sc.bd}`,fontWeight:600}}>
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Tab strip */}
        <div className="vl-cp-tabs">
          <button className={`vl-cptab${notesTab==="notes"?" on":""}`} onClick={()=>setNotesTab("notes")}>Notes</button>
          <button className={`vl-cptab${notesTab==="targets"?" on":""}`} onClick={()=>setNotesTab("targets")}>
            Targets
            {hasAnyTarget && <span className="vl-cptab-count">{applicationTargets.length}</span>}
          </button>
        </div>

        {/* Notes tab */}
        {notesTab === "notes" && (
          <div style={{padding:"12px 16px 0"}}>
            <textarea className="notes-area" placeholder="Add a new note…" value={draftNote}
              onChange={e=>setDraftNote(e.target.value)} style={{marginBottom:6}}/>
            <button onClick={commitDraft} disabled={!draftNote.trim()}
              style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",padding:"7px 0",marginBottom:10,fontSize:12,fontWeight:700,fontFamily:"var(--fh)",background:draftNote.trim()?"var(--p)":"var(--s3)",color:draftNote.trim()?"#fff":"var(--t3)",border:"none",borderRadius:"var(--r1)",cursor:draftNote.trim()?"pointer":"not-allowed",transition:"background 150ms"}}>
              <Plus size={12}/>Add Note
            </button>
            {noteEntries.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:260,overflowY:"auto",paddingBottom:4}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:2}}>Note History</div>
                {noteEntries.map((entry,i)=>(
                  <div key={i} style={{background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r1)",padding:"8px 10px"}}>
                    {entry.ts && <div style={{fontSize:9,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:4,display:"flex",alignItems:"center",gap:4}}><Clock size={9}/>{entry.ts}</div>}
                    <div style={{fontSize:11,color:"var(--t1)",fontFamily:"var(--fu)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{entry.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Targets tab */}
        {notesTab === "targets" && (
          <div style={{padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <GraduationCap size={13} color="var(--p)"/>
                <span style={{fontFamily:"var(--fh)",fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--t1)"}}>Application Targets</span>
                <span style={{fontFamily:"var(--fm)",fontSize:10,color:"var(--t3)"}}>({applicationTargets.length}/4)</span>
              </div>
              {applicationTargets.length < 4 && (
                <button onClick={addTarget} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontFamily:"var(--fu)",fontWeight:600,color:"var(--p)",background:"var(--pg)",border:"1px solid rgba(29,107,232,.2)",borderRadius:"var(--r1)",padding:"4px 10px",cursor:"pointer"}}>
                  <Plus size={11}/>Add Target
                </button>
              )}
            </div>
            {applicationTargets.length === 0 ? (
              <div style={{border:"1.5px dashed var(--bd)",borderRadius:"var(--r2)",padding:"20px 16px",textAlign:"center",background:"var(--s2)"}}>
                <GraduationCap size={22} color="var(--t3)" style={{margin:"0 auto 8px"}}/>
                <div style={{fontSize:12,fontFamily:"var(--fu)",color:"var(--t2)",fontWeight:600,marginBottom:4}}>No application targets yet</div>
                <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fu)",marginBottom:12}}>Add up to 4 countries &amp; universities this student is applying to</div>
                <button onClick={addTarget} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,fontFamily:"var(--fu)",fontWeight:600,color:"#fff",background:"var(--p)",border:"none",borderRadius:"var(--r1)",padding:"6px 14px",cursor:"pointer"}}>
                  <Plus size={12}/>Add First Target
                </button>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
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

        {/* Save button */}
        <div style={{borderTop:"1px solid var(--bd)",padding:"12px 16px 14px",marginTop:4}}>
          {savedMsg && (
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--ok)",fontFamily:"var(--fm)",marginBottom:8}}>
              <Check size={12}/>{savedMsg}
            </div>
          )}
          <button onClick={onSaveCase}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,width:"100%",padding:"9px 0",fontSize:12,fontWeight:700,fontFamily:"var(--fh)",letterSpacing:".04em",background:"#3B0764",color:"#fff",border:"none",borderRadius:"var(--r1)",cursor:"pointer",transition:"opacity 150ms"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=".85"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
            <Save size={13}/>Save to History
          </button>
        </div>
      </div>
    </div>
  );
}
