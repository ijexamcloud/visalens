import React, { useState } from 'react';
import {
  AlertCircle, BarChart3, CheckCircle, Info,
  Loader2, Plus, ShieldCheck, Trash2, Users, X, XCircle,
} from 'lucide-react';
import { getDT } from '../utils/docMeta';

// ─── Relation metadata ────────────────────────────────────────────────────────
export const RELATION_OPTIONS = [
  { value: "student",  label: "Student",          emoji: "🎓", color: "#1D6BE8", bg: "rgba(29,107,232,.1)"  },
  { value: "father",   label: "Father",            emoji: "👨", color: "#059669", bg: "rgba(5,150,105,.1)"   },
  { value: "mother",   label: "Mother",            emoji: "👩", color: "#059669", bg: "rgba(5,150,105,.1)"   },
  { value: "spouse",   label: "Spouse",            emoji: "💍", color: "#7C3AED", bg: "rgba(124,58,237,.1)"  },
  { value: "sibling",  label: "Sibling",           emoji: "👫", color: "#B45309", bg: "rgba(180,83,9,.1)"    },
  { value: "child",    label: "Child",             emoji: "🧒", color: "#0284C7", bg: "rgba(2,132,199,.1)"   },
  { value: "other",    label: "Other / Unknown",   emoji: "👤", color: "#94A3B8", bg: "rgba(148,163,184,.1)" },
  { value: "unknown",  label: "Unknown — Exclude", emoji: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.1)"   },
];

// Relations whose data must NEVER contribute to the student profile
export const EXCLUDED_RELATIONS = new Set(["unknown", "other"]);

// ─── AnalysisReadinessCheck ───────────────────────────────────────────────────
export const PRIORITY_TYPES_SET = new Set([
  "passport", "bank_statement", "financial_proof", "offer_letter",
  "transcript", "degree_certificate", "language_test", "cas",
  "birth_certificate", "domicile", "family_reg_cert", "marriage_reg_cert"
]);

export function AnalysisReadinessCheck({ docs, docTypes, selection, onSelectionChange, onConfirm, onCancel }) {
  const THRESHOLD    = 3.8 * 1024 * 1024;
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
            const t      = docTypes[doc.id] || doc.type || "other";
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
              const t       = docTypes[doc.id] || doc.type || "other";
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

// ─── PersonClarificationUI ────────────────────────────────────────────────────
export default function PersonClarificationUI({ preScanData, onConfirm, onSkip, loading, onRemoveDocs }) {
  const [people, setPeople] = useState(() =>
    (preScanData?.people || []).map(p => ({
      ...p,
      relation: (p.suggestedRelation === "other" || !p.suggestedRelation) ? "unknown" : p.suggestedRelation,
    }))
  );

  const triggerReasons = preScanData?.triggerReasons || [];
  const studentCount   = people.filter(p => p.relation === "student").length;
  const hasStudent     = studentCount >= 1;
  const twoStudents    = studentCount > 1;

  function setRelation(idx, val) {
    setPeople(prev => prev.map((p, i) => i === idx ? { ...p, relation: val } : p));
  }

  const relMeta = r => RELATION_OPTIONS.find(o => o.value === r) || RELATION_OPTIONS[RELATION_OPTIONS.length - 1];

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
          margin:"0 0 12px",padding:"8px 12px",
          background:"rgba(29,107,232,.06)",border:"1px solid rgba(29,107,232,.2)",
          borderRadius:"var(--r1)",display:"flex",alignItems:"flex-start",gap:8,
        }}>
          <Info size={13} color="#1D6BE8" style={{flexShrink:0,marginTop:1}}/>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#1D6BE8",marginBottom:3}}>Why am I seeing this?</div>
            <div style={{fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)",lineHeight:1.5}}>
              {triggerReasons.join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div className="prescan-people">
        {people.map((person, idx) => {
          const meta       = relMeta(person.relation);
          const isFirst    = idx === 0;
          const isExcluded = EXCLUDED_RELATIONS.has(person.relation);
          const shared     = isExcluded && isSharedFile(person);
          const canRemove  = isExcluded && !shared && (person.files || []).length > 0;

          return (
            <div key={idx} className={`prescan-card${person.relation === "student" ? " prescan-card--student" : ""}${isExcluded ? " prescan-card--excluded" : ""}${mergedIndices.has(idx) ? " prescan-card--merged" : ""}`}>
              <div className="prescan-card-top">
                <div className="prescan-avatar" style={{background:meta.bg,color:meta.color}}>
                  {meta.emoji}
                </div>
                <div className="prescan-card-info">
                  <div className="prescan-name">{person.name || "Unknown"}</div>
                  {person.identifiers && (
                    <div className="prescan-identifiers">{person.identifiers}</div>
                  )}
                  {person.richnessScore > 0 && (
                    <div className="prescan-score">
                      <span style={{background:meta.bg,color:meta.color,borderRadius:6,padding:"1px 7px",fontSize:10,fontWeight:700}}>
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
                    style={{borderColor:meta.color,color:meta.color}}
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
                  marginTop:8,padding:"8px 10px",
                  background:mergedIndices.has(idx) ? "rgba(5,150,105,.06)" : "rgba(29,107,232,.06)",
                  border:`1px solid ${mergedIndices.has(idx) ? "rgba(5,150,105,.3)" : "rgba(29,107,232,.2)"}`,
                  borderRadius:"var(--r1)",display:"flex",alignItems:"center",gap:8,
                }}>
                  <Info size={13} color={mergedIndices.has(idx) ? "#059669" : "#1D6BE8"} style={{flexShrink:0}}/>
                  <div style={{flex:1,fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)",lineHeight:1.5}}>
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
                    <span className="prescan-file-pill" style={{background:"rgba(29,107,232,.08)",color:"var(--t3)",fontStyle:"italic"}}>
                      {person.pagesFound.length} page{person.pagesFound.length !== 1 ? "s" : ""} scanned
                    </span>
                  )}
                </div>
              )}

              {/* ── Unknown/excluded person actions ── */}
              {isExcluded && (
                <div style={{marginTop:8,padding:"8px 10px",background:"rgba(220,38,38,.06)",border:"1px solid rgba(220,38,38,.2)",borderRadius:"var(--r1)",display:"flex",alignItems:"flex-start",gap:8}}>
                  <XCircle size={13} color="#DC2626" style={{flexShrink:0,marginTop:1}}/>
                  <div style={{flex:1}}>
                    {shared ? (
                      <div style={{fontSize:11,color:"#DC2626",fontWeight:600,marginBottom:3}}>
                        Data from this person is inside a shared document
                      </div>
                    ) : (
                      <div style={{fontSize:11,color:"#DC2626",fontWeight:600,marginBottom:3}}>
                        This person's documents will be excluded from analysis
                      </div>
                    )}
                    <div style={{fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)",lineHeight:1.4}}>
                      {shared
                        ? "Their personal, academic and English test data will be explicitly excluded from the student profile. Only financial data may be used if they are a confirmed sponsor."
                        : "Their identity, academic records and English test scores will not be used. Remove their document to prevent any data from being sent to the AI."}
                    </div>
                    {canRemove && (
                      <button
                        style={{marginTop:8,fontSize:11,fontWeight:700,color:"#fff",background:"#DC2626",border:"none",borderRadius:"var(--r1)",padding:"4px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}
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
          <AlertCircle size={13} style={{flexShrink:0,marginTop:1,color:"var(--warn)"}}/>
          <span><strong>Two students detected.</strong> Each student must be analysed in a separate session. Mark one as "Student" and set the other to "Unknown — Exclude" to continue. Their documents will not mix.</span>
        </div>
      )}

      {!hasStudent && !twoStudents && (
        <div className="prescan-warn">
          <AlertCircle size={13} style={{flexShrink:0,marginTop:1}}/>
          <span>No one is marked as "Student". At least one person must be the student.</span>
        </div>
      )}

      <div className="prescan-footer">
        <button className="btn-s" onClick={onSkip} disabled={loading} title="Skip person identification and run analysis with current document tags">
          Skip — Analyse as-is
        </button>
        <button
          className="btn-p"
          style={{flex:1,maxWidth:280}}
          disabled={!hasStudent || (twoStudents && mergedIndices.size === 0) || loading}
          onClick={handleConfirm}
        >
          {loading
            ? <><Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/>Analysing…</>
            : <><ShieldCheck size={14}/>Confirm &amp; Analyse</>
          }
        </button>
      </div>
    </div>
  );
}
