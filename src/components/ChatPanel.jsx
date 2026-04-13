import React, { useState, useRef, useEffect } from 'react';
import {
  Check, CheckCircle, Copy, Loader2, MessageSquare,
  Printer, Send, ShieldCheck, Trash2,
} from 'lucide-react';
import { PROXY_URL } from '../constants/api';
import { getAuthHeaders, withOrg } from '../utils/session';
import { parseCurrencyAmount } from '../utils/parsers';

// ─── buildChatContext ─────────────────────────────────────────────────────────
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
          `- ${d.type}${d.reference?` | Ref: ${d.reference}`:""}${d.amount?` | Amount: ${d.amount}`:""}${d.date?` | Date: ${d.date}`:""}${d.expiry?` | Expiry: ${d.expiry}`:""}${d.result?` | Result: ${d.result}`:""}${d.institution?` | Institution: ${d.institution}`:""}${d.notes?` | Notes: ${d.notes}`:""}`
        ).join("\n")
      : "None detected"),
    "",
    "=== NAME MISMATCHES ===",
    (profileData?.nameMismatches?.length
      ? profileData.nameMismatches.map(m=>`- ${m.doc}: Found "${m.nameFound}" — ${m.issue}`).join("\n")
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
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

// ─── ChatPanel ────────────────────────────────────────────────────────────────
export default function ChatPanel({ profileData, results, docs, messages, setMessages, onCreditsUpdate }) {
  const [input,       setInput]       = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  const hasCtx = profileData && results && Object.keys(profileData).length > 0;
  const ctxString  = hasCtx ? buildChatContext(profileData, results, docs) : null;
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
      const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const systemPrompt = `You are VisaLens AI, an expert student visa counselling assistant. You have been given a fully extracted student profile below — do NOT ask to see documents again; use only the data provided.\n\nToday's date: ${todayStr}. When referencing timelines, deadlines, or dates, use this as the current date.\n\nAnswer counsellor questions concisely and accurately. When referencing requirements (IELTS, GPA, financials), state both the requirement AND the student's actual value. Use "Not found" context to flag gaps. Keep answers under 200 words unless a longer breakdown is genuinely needed.\n\n${ctxString}`;
      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: systemPrompt,
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
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 250); }
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
      <div className="chat-hdr rc-hdr--purple">
        <div className="chat-hdr-ico"><MessageSquare size={15} color="#fff"/></div>
        <div style={{flex:1}}>
          <div className="chat-hdr-title">AI Counsellor Chat — {studentName}</div>
          <div className="chat-hdr-ctx">
            <span className="chat-ctx-pill"><CheckCircle size={9} color="#fff"/>Profile context loaded</span>
          </div>
        </div>
        {messages.length > 0 && (
          <div style={{display:"flex",gap:"6px"}}>
            <button className="btn-s" style={{height:"28px",padding:"0 10px",fontSize:"11px"}} onClick={copyChat}>
              {copied ? <><Check size={12}/>Copied</> : <><Copy size={12}/>Copy</>}
            </button>
            <button className="btn-s" style={{height:"28px",padding:"0 10px",fontSize:"11px"}} onClick={exportChatPDF}>
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
                <div className={`chat-avatar ${m.role}`}>{m.role === "user" ? "You" : <ShieldCheck size={13}/>}</div>
                <div className={`chat-bubble ${m.role}`} dangerouslySetInnerHTML={{ __html: formatBubble(m.content) }}/>
              </div>
            ))}
            {chatLoading && (
              <div className="chat-msg assistant">
                <div className="chat-avatar assistant"><ShieldCheck size={13}/></div>
                <div className="chat-typing"><div className="chat-dot"/><div className="chat-dot"/><div className="chat-dot"/></div>
              </div>
            )}
            <div ref={bottomRef}/>
          </>
        )}
      </div>

      <div className="chat-footer">
        <div className="chat-input-row">
          <textarea ref={textareaRef} className="chat-input"
            placeholder={`Ask about ${studentName}'s application…`}
            value={input} onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey} rows={1} disabled={chatLoading}/>
          <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() || chatLoading}>
            {chatLoading ? <Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/> : <Send size={15}/>}
          </button>
        </div>
      </div>
    </div>
  );
}
