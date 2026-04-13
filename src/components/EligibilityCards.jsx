import React, { useState } from 'react';
import {
  AlertCircle, Check, CheckCircle, ChevronDown,
  DollarSign, Edit3, FileSpreadsheet, Flag, Globe,
  Info, RefreshCw, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { scoreBadge, scoreLabel } from '../utils/format';

// ─── DETECTED DOC META MAP ────────────────────────────────────────────────────
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

export function getDocMeta(type) {
  return DETECTED_DOC_META[type] || { icon: "📄", color: "var(--t2)", bg: "var(--s2)", bd: "var(--bd)" };
}

// ─── HELPER: isDocVal ─────────────────────────────────────────────────────────
export function isDocVal(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return !isNaN(val);
  if (Array.isArray(val)) return val.length > 0;
  return Boolean(val);
}

// ─── HELPER: deriveDetectedDocs ───────────────────────────────────────────────
export function deriveDetectedDocs(profileData, results, docs, docTypes, supabaseDocList) {
  const p   = profileData || {};
  const out = new Map();

  function add(key, entry) {
    if (!out.has(key)) out.set(key, entry);
  }

  // TIER 1: profileData field presence
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

  const englishTests = Array.isArray(p.englishTests) ? p.englishTests.filter(t => isDocVal(t.overallScore)) : [];
  if (englishTests.length > 0) {
    englishTests.forEach((t, i) => {
      const ttype = (t.type || 'english').toLowerCase().replace(/\s+/g, '_');
      add(ttype + '_' + i, {
        label: t.type || 'English Test', type: 'english_test',
        color: '#B45309', icon: '📝', source: 'ai',
        detail: t.overallScore ? `Score: ${t.overallScore}` : null, status: 'ok',
      });
    });
  } else if (isDocVal(p.ieltsScore)) {
    add('ielts', { label: 'IELTS', type: 'ielts', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.ieltsScore}`, status: 'ok' });
  } else if (isDocVal(p.toeflScore)) {
    add('toefl', { label: 'TOEFL', type: 'toefl', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.toeflScore}`, status: 'ok' });
  } else if (isDocVal(p.pteScore)) {
    add('pte', { label: 'PTE Academic', type: 'pte', color: '#B45309', icon: '📝', source: 'ai', detail: `Score: ${p.pteScore}`, status: 'ok' });
  }

  if (isDocVal(p.financialBalance) || isDocVal(p.financialHolder)) {
    add('bank_statement', {
      label: 'Bank Statement', type: 'bank_statement', color: '#059669', icon: '🏦', source: 'ai',
      detail: p.financialBalance && p.financialBalance !== 'Not found' ? `Balance: ${p.financialBalance}` : (p.financialHolder || null),
      status: isDocVal(p.financialBalance) ? 'ok' : 'partial',
    });
  }

  if (isDocVal(p.academicResult) || isDocVal(p.program) || isDocVal(p.university)) {
    add('transcript', {
      label: 'Academic Transcript', type: 'transcript', color: '#D97706', icon: '🎓', source: 'ai',
      detail: p.academicResult && p.academicResult !== 'Not found' ? p.academicResult : (p.program || null),
      status: isDocVal(p.academicResult) ? 'ok' : 'partial',
    });
  }

  if (isDocVal(p.cnicNumber) || isDocVal(p.cnicExpiry)) {
    add('cnic', {
      label: 'CNIC / National ID', type: 'cnic', color: '#0284C7', icon: '🪪', source: 'ai',
      detail: p.cnicNumber && p.cnicNumber !== 'Not found' ? p.cnicNumber : null,
      status: isDocVal(p.cnicNumber) ? 'ok' : 'partial',
    });
  }

  if (Array.isArray(p.offerLetters) && p.offerLetters.length > 0) {
    p.offerLetters.forEach((o, i) => {
      if (isDocVal(o.university) || isDocVal(o.status) || isDocVal(o.country)) {
        add('offer_' + i, {
          label: 'Offer Letter' + (p.offerLetters.length > 1 ? ` ${i+1}` : ''), type: 'offer_letter',
          color: '#7C3AED', icon: '✉️', source: 'ai',
          detail: o.university && o.university !== 'Not found' ? o.university : (o.country || null),
          status: isDocVal(o.status) ? 'ok' : 'partial',
        });
      }
    });
  }

  const hasCAS = (Array.isArray(p.casDocuments) && p.casDocuments.some(d => isDocVal(d.casNumber) || isDocVal(d.university)))
               || isDocVal(p.cas?.cas_number) || isDocVal(p.cas?.university);
  if (hasCAS) {
    const casNum = p.casDocuments?.[0]?.casNumber || p.cas?.cas_number || null;
    add('cas', {
      label: 'CAS / Pre-CAS', type: 'cas', color: '#0EA5E9', icon: '🏫', source: 'ai',
      detail: casNum && casNum !== 'Not found' ? casNum : null, status: 'ok',
    });
  }

  // TIER 2: detectedDocs
  if (Array.isArray(p.detectedDocs)) {
    p.detectedDocs.forEach((d, i) => {
      if (!d.type) return;
      const meta = getDocMeta(d.type);
      add('special_' + d.type + '_' + i, {
        label: d.type, type: 'special', color: meta.color, icon: meta.icon, source: 'ai',
        detail: d.reference || d.date || d.institution || null, status: 'ok',
      });
    });
  }

  // TIER 3: Supabase doc_list
  if (out.size === 0 && Array.isArray(supabaseDocList) && supabaseDocList.length > 0) {
    supabaseDocList.forEach((d, i) => {
      const t = d.type || 'other';
      const label = t === 'passport' ? 'Passport' : t === 'bank_statement' ? 'Bank Statement'
        : t === 'offer_letter' ? 'Offer Letter' : t === 'ielts' ? 'IELTS' : t === 'pte' ? 'PTE' : t === 'toefl' ? 'TOEFL'
        : t === 'cnic' ? 'CNIC' : t === 'transcript' ? 'Transcript' : t === 'degree' ? 'Degree'
        : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const color = t === 'passport' ? '#1D6BE8' : t === 'bank_statement' ? '#059669'
        : t === 'offer_letter' ? '#7C3AED' : (t === 'ielts' || t === 'pte' || t === 'toefl') ? '#B45309'
        : t === 'cnic' ? '#0284C7' : t === 'transcript' || t === 'degree' ? '#D97706' : '#64748B';
      add('db_' + t + '_' + i, { label, type: t, color, icon: '📄', source: 'db', detail: d.name || null, status: 'ok' });
    });
  }

  // TIER 4: uploaded docs[]
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
      add('file_' + (doc.id || i), { label, type: t, color, icon: '📄', source: 'file', detail: name, status: 'ok' });
    });
  }

  return Array.from(out.values());
}

// ─── EligSummaryCards ────────────────────────────────────────────────────────
export function EligSummaryCards({ text }) {
  if (!text) return null;

  const LABEL_META = {
    "STRONG FINANCIAL POSITION":  { icon: "💰", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "GOOD FINANCIAL POSITION":    { icon: "💰", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "WEAK FINANCIAL POSITION":    { icon: "💸", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "EXCELLENT ACADEMIC RECORD":  { icon: "🎓", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "GOOD ACADEMIC RECORD":       { icon: "🎓", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "WEAK ACADEMIC RECORD":       { icon: "📉", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "ENGLISH PROFICIENCY":        { icon: "🗣️", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "ENGLISH PROFICIENCY ABSENT": { icon: "🗣️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "IDENTITY VERIFIED":          { icon: "✅", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "IDENTITY INCOMPLETE":        { icon: "🪪", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "DOCUMENTS COMPLETE":         { icon: "📄", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "MISSING DOCUMENTS":          { icon: "📋", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "CRITICAL GAPS":              { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "GAPS IDENTIFIED":            { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "MODERATE CONCERNS":          { icon: "⚠️", color: "#B45309", bg: "rgba(245,158,11,.07)", bd: "rgba(245,158,11,.25)" },
    "MAJOR BLOCKER":              { icon: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "CRITICAL BLOCKER":           { icon: "🚫", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "HIGH RISK":                  { icon: "🔴", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "VISA REFUSAL RISK":          { icon: "🔴", color: "#DC2626", bg: "rgba(220,38,38,.07)",  bd: "rgba(220,38,38,.2)"  },
    "STRONG PROFILE":             { icon: "⭐", color: "#059669", bg: "rgba(5,150,105,.07)",  bd: "rgba(5,150,105,.2)"  },
    "OVERALL ASSESSMENT":         { icon: "📊", color: "#1D6BE8", bg: "rgba(29,107,232,.07)", bd: "rgba(29,107,232,.2)"  },
    "RECOMMENDATION":             { icon: "💡", color: "#1D6BE8", bg: "rgba(29,107,232,.07)", bd: "rgba(29,107,232,.2)"  },
  };

  const labels = Object.keys(LABEL_META).sort((a,b) => b.length - a.length);
  const re2 = new RegExp(`(${labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`, 'g');

  const matches = [];
  let m;
  while ((m = re2.exec(text)) !== null) {
    matches.push({ label: m[1], index: m.index });
  }

  if (!matches.length) {
    return <p className="elig-sum" style={{marginBottom:0}}>{text}</p>;
  }

  const segments = [];
  for (let i = 0; i < matches.length; i++) {
    const { label, index } = matches[i];
    const detailStart = index + label.length;
    const detailEnd   = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const detail = text.slice(detailStart, detailEnd).replace(/^[:\s\-–—]+/, '').trim();
    segments.push({ label, detail });
  }
  if (matches[0].index > 0) {
    const intro = text.slice(0, matches[0].index).trim();
    if (intro) segments.unshift({ label: null, detail: intro });
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:4}}>
      {segments.map((seg, i) => {
        if (!seg.label) {
          return <p key={i} className="elig-sum" style={{margin:0,paddingBottom:4}}>{seg.detail}</p>;
        }
        const meta = LABEL_META[seg.label] || { icon:"ℹ️", color:"#64748B", bg:"rgba(100,116,139,.07)", bd:"rgba(100,116,139,.2)" };
        return (
          <div key={i} style={{display:"flex",gap:10,padding:"9px 12px",background:meta.bg,border:`1px solid ${meta.bd}`,borderRadius:"var(--r2)",alignItems:"flex-start"}}>
            <span style={{fontSize:16,lineHeight:1,flexShrink:0,marginTop:1}}>{meta.icon}</span>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:meta.color,letterSpacing:".06em",textTransform:"uppercase",marginBottom:3}}>{seg.label}</div>
              <div style={{fontSize:12,color:"var(--t1)",lineHeight:1.5,fontFamily:"var(--fu)"}}>{seg.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── EligFindings ─────────────────────────────────────────────────────────────
export function EligFindings({ findings }) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return (
    <div style={{marginBottom:8}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".07em",textTransform:"uppercase",marginBottom:6,paddingBottom:5,borderBottom:"1px solid var(--bd)"}}>
        🔍 Notable Findings
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {findings.map((f, i) => (
          <div key={i} style={{display:"flex",gap:10,padding:"9px 12px",background:"rgba(29,107,232,.05)",border:"1px solid rgba(29,107,232,.15)",borderRadius:"var(--r2)",alignItems:"flex-start"}}>
            <span style={{fontSize:15,lineHeight:1,flexShrink:0,marginTop:1}}>🔍</span>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#1D6BE8",letterSpacing:".05em",textTransform:"uppercase",marginBottom:3,fontFamily:"var(--fh)"}}>{f.title || "Notable Finding"}</div>
              <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",lineHeight:1.55,fontFamily:"var(--fu)"}}>{f.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── EligCard ─────────────────────────────────────────────────────────────────
export function EligCard({ data, summary, findings: findingsProp, profile, isLive }) {
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
      <button className={`rc-hdr--btn rc-hdr--green${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><Globe size={14} color="#fff"/></div>
        <span className="rc-ttl">Visa Eligibility</span>
        <span className={`badge ${scoreBadge(data.overallScore)}`}><ShieldCheck size={10}/>{scoreLabel(data.overallScore)}</span>
        {isLive&&<span className="badge b-p" style={{fontSize:9,marginLeft:4}}><RefreshCw size={9}/>Live</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":""} open`}/>
      </button>

      {!collapsed && <div className="rc-body" style={{paddingTop:14}}>
        {isLive&&<div className="elig-live-note" style={{marginBottom:10}}><Edit3 size={11}/>Scores updated from profile edits · click Re-assess for full narrative update</div>}

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

        <div className="vl-elig-narrative">
          <EligSummaryCards text={summary || data.summary} />
          <EligFindings findings={findingsProp || data.findings} />
        </div>

        {data.notes?.length>0&&<div className="elig-notes">{data.notes.map((n,i)=><div key={i} className="en"><div className="en-dot"/><span>{n}</span></div>)}</div>}
      </div>}
    </div>
  );
}

// ─── RejectionsCard ───────────────────────────────────────────────────────────
export function RejectionsCard({ items }) {
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
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":""} open`}/>
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

// ─── MissingCard ─────────────────────────────────────────────────────────────
export function MissingCard({ items }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rc rc-orange">
      <button className={`rc-hdr--btn rc-hdr--orange${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><AlertCircle size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Gaps &amp; Concerns</span>
        {items.length===0?<span className="badge b-ok"><CheckCircle size={10}/>Nothing flagged</span>:<span className="badge b-warn"><AlertCircle size={10}/>{items.length} Item{items.length!==1?"s":""}</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":""} open`}/>
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

// ─── FlagsCard ───────────────────────────────────────────────────────────────
export function FlagsCard({ flags }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rc rc-flags">
      <button className={`rc-hdr--btn rc-hdr--red${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)}>
        <div className="rc-ico"><Flag size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Risk Flags</span>
        {flags.length===0?<span className="badge b-ok"><CheckCircle size={10}/>No Issues</span>:<span className="badge b-err"><XCircle size={10}/>{flags.length} Flag{flags.length!==1?"s":""}</span>}
        <ChevronDown size={14} className={`rc-collapse-chevron${collapsed?"":""} open`}/>
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

// ─── RisksCard ───────────────────────────────────────────────────────────────
export function RisksCard({ flags, missingItems, rejections }) {
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
      {/* LEFT: Notable Findings */}
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

      {/* RIGHT: Risk Flags */}
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

// ─── DetectedDocsCard ─────────────────────────────────────────────────────────
export function DetectedDocsCard({ profileData }) {
  const docs = Array.isArray(profileData?.detectedDocs) ? profileData.detectedDocs : [];
  const mismatches = Array.isArray(profileData?.nameMismatches) ? profileData.nameMismatches : [];

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
      {/* Mini sidebar */}
      <div style={{width:136,flexShrink:0,borderRight:"1px solid var(--bd)",background:"var(--s2)",display:"flex",flexDirection:"column",overflowY:"auto"}}>
        {docs.map((doc, i) => {
          const meta = getDocMeta(doc.type);
          const isTB = doc.type === "TB Certificate";
          const accentColor = isTB ? (doc.result === "Clear" ? "#059669" : doc.result ? "#DC2626" : meta.color) : meta.color;
          const isActive = activeIdx === i;
          return (
            <button key={i} onClick={()=>setActiveIdx(i)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"9px 10px",border:"none",cursor:"pointer",textAlign:"left",background: isActive ? "var(--bg)" : "transparent",borderLeft: isActive ? `3px solid ${accentColor}` : "3px solid transparent",borderBottom:"1px solid var(--bd)",transition:"background 120ms"}}>
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
            style={{display:"flex",alignItems:"center",gap:7,padding:"9px 10px",border:"none",cursor:"pointer",textAlign:"left",background: activeIdx === docs.length ? "var(--bg)" : "transparent",borderLeft: activeIdx === docs.length ? "3px solid #DC2626" : "3px solid transparent",borderBottom:"1px solid var(--bd)"}}>
            <span style={{fontSize:14,lineHeight:1,flexShrink:0}}>⚠️</span>
            <div style={{fontSize:10,fontWeight:700,color: activeIdx===docs.length ? "#DC2626" : "var(--t1)",fontFamily:"var(--fh)",lineHeight:1.3}}>
              Name Mismatches
              <div style={{fontSize:9,fontWeight:400,color:"var(--t3)",fontFamily:"var(--fm)",marginTop:1}}>{mismatches.length} found</div>
            </div>
          </button>
        )}
      </div>

      {/* Detail panel */}
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
