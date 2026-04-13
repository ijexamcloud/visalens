import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  AlertCircle, CheckCircle, Eye, FileText,
  FolderDown, FolderOpen, Loader2, Plus, X,
} from 'lucide-react';
import { DOC_TYPES, getDT, TRANSCRIPT_LEVELS } from '../utils/docMeta';

// ─── smartQualifier — copied from App.jsx ─────────────────────────────────────
function smartQualifier(doc, allDocs, docTypes, customLabels, offerLetters, subTypes) {
  const t = docTypes[doc.id] || "other";
  const sameType = allDocs.filter(d => (docTypes[d.id] || "other") === t);
  const idx      = sameType.indexOf(doc);

  if (t === "transcript") {
    const level = subTypes?.[doc.id] || "";
    if (level) return `-${level.replace(/\s+/g, "-")}`;
    return sameType.length > 1 ? `-${idx + 1}` : "";
  }
  if (t === "offer_letter") {
    const uniHint = subTypes?.[doc.id]?.trim();
    if (uniHint) return `-${uniHint.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 30)}`;
    const offers = Array.isArray(offerLetters) ? offerLetters : [];
    if (offers[idx]?.university) return `-${offers[idx].university.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 30)}`;
    return sameType.length > 1 ? `-${idx + 1}` : "";
  }
  if (t === "bank_statement" || t === "financial_proof") {
    return sameType.length > 1 ? `-${idx + 1}` : "";
  }
  return sameType.length > 1 ? `-${idx + 1}` : "";
}

// ─── deduplicateFilenames — copied from App.jsx ───────────────────────────────
function deduplicateFilenames(docs, filenameFn) {
  const counts = {};
  const result = {};
  for (const doc of docs) {
    const name = filenameFn(doc);
    counts[name] = (counts[name] || 0) + 1;
  }
  const seen = {};
  for (const doc of docs) {
    const name = filenameFn(doc);
    if (counts[name] > 1) {
      seen[name] = (seen[name] || 0) + 1;
      const ext = name.includes(".") ? "." + name.split(".").pop() : "";
      const base = ext ? name.slice(0, -ext.length) : name;
      result[doc.id] = { name: `${base}-${seen[name]}${ext}`, isDuplicate: true };
    } else {
      result[doc.id] = { name, isDuplicate: false };
    }
  }
  return result;
}

// ─── ZipModal ─────────────────────────────────────────────────────────────────
export default function ZipModal({ docs, studentName, offerLetters, docTypes, setDocTypes, subTypes, setSubTypes, personTags, setPersonTags, customLabels, setCustomLabels, spouseName, setSpouseName, onClose }) {
  const [name,        setName]        = useState(studentName || "");
  const [zipping,     setZipping]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState("");
  const [selectedId,  setSelectedId]  = useState(docs[0]?.id || null);
  const [previewSrc,  setPreviewSrc]  = useState(null);
  const [previewKind, setPreviewKind] = useState(null);
  const [previewText, setPreviewText] = useState("");

  const selectedDoc   = docs.find(d => d.id === selectedId) || docs[0];
  const hasSpouseDocs = Object.values(personTags).some(p => p === "spouse");

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
      const base64 = await zip.generateAsync({ type:"base64" });
      const a      = document.createElement("a");
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
                  return (
                    <div key={doc.id} className={`zip-doc-row${isSelected?" active":""}`} onClick={()=>setSelectedId(doc.id)}>
                      <div className="zip-doc-meta">
                        <div className="zip-doc-name" title={doc.file.name}>{doc.file.name}</div>
                        <div className="zip-doc-renamed">{finalName}</div>
                      </div>
                      <div className="zip-doc-controls" onClick={e=>e.stopPropagation()}>
                        <div className="zip-person-row">
                          {["primary","spouse","child"].map(p => (
                            <button key={p} className={`zip-person-btn${person===p?" on":""}`}
                              onClick={()=>setPersonTags(prev=>({...prev,[doc.id]:p}))}>
                              {p==="primary"?"Student":p==="spouse"?"Spouse":"Child"}
                            </button>
                          ))}
                        </div>
                        <select className="doc-sel" value={t}
                          onChange={e=>{setDocTypes(p=>({...p,[doc.id]:e.target.value}));setSubTypes(p=>({...p,[doc.id]:""}));}}>
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
                            {TRANSCRIPT_LEVELS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}
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
                  {previewKind==="image" && previewSrc && <img src={previewSrc} alt={selectedDoc.file.name} className="zip-preview-img"/>}
                  {previewKind==="image" && !previewSrc && <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>}
                  {previewKind==="pdf" && (
                    <div className="zip-preview-placeholder" style={{padding:24,textAlign:"center"}}>
                      <FileText size={36} color="var(--t3)"/>
                      <div style={{fontSize:12,color:"var(--t2)",marginTop:10,fontWeight:600}}>{selectedDoc.file.name}</div>
                      <div style={{fontSize:11,color:"var(--t3)",marginTop:6,fontFamily:"var(--fm)",lineHeight:1.5}}>PDF preview not available in this environment.<br/>File will be correctly included in the ZIP.</div>
                    </div>
                  )}
                  {previewKind==="text" && <pre className="zip-preview-text">{previewText||"Loading…"}</pre>}
                  {!previewKind && <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>}
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
