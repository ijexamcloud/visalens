import React, { useState, useEffect } from 'react';
import {
  AlertCircle, BookOpen, Building2, Check, CheckCircle,
  Copy, FileText, Info, Loader2, Printer, RefreshCw,
  Save, ShieldCheck, Trash2,
} from 'lucide-react';
import { PROXY_URL } from '../constants/api';
import { getAuthHeaders, withOrg } from '../utils/session';
import { resolveOffer } from '../utils/parsers';

// ─── SOPTargetPicker ──────────────────────────────────────────────────────────
function SOPTargetPicker({ profileData, preferredOfferIndex, requirementsData, onTargetChange }) {
  const resolved  = resolveOffer(profileData, preferredOfferIndex);
  const fromOffer = !!(resolved.hasOffer && resolved.university);

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

// ─── SOPBuilder ───────────────────────────────────────────────────────────────
export default function SOPBuilder({ profileData, results, universitySop, visaSop, setUniversitySop, setVisaSop, onSaveSops, preferredOfferIndex, requirementsData }) {
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
    if (window.confirm("Clear both SOP drafts?")) { setSopVA(""); setSopVB(""); }
  }

  const activeText    = activeTab === "university" ? sopVA : sopVB;
  const setActiveText = activeTab === "university" ? setSopVA : setSopVB;
  const hasBoth       = sopVA && sopVB;

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

              {activeText && (
                <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:6}}>
                  {activeText.trim().split(/\s+/).filter(Boolean).length} words
                  {hasBoth && <span style={{marginLeft:12,color:"var(--t3)"}}>· Generate both versions, then Save to Case</span>}
                </div>
              )}

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
