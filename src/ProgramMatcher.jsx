/* ─────────────────────────────────────────────────────────────────────────────
   ProgramMatcher.jsx  — redesigned with flat table layout (v2)
   Drop this file alongside App.jsx and import it there.

   Usage in App.jsx:
     import ProgramMatcher from './ProgramMatcher';

   Wire into sidebar nav (after the "Data" divider, before Requirements):
     <button role="tab" aria-selected={tab==="match"} className={`sidebar-nav-item${tab==="match"?" on":""}`}
       onClick={()=>setTab("match")} title="Program Match">
       <span className="sidebar-nav-icon"><Target size={16}/></span>
       {sidebarOpen && <span className="sidebar-nav-label">Program Match</span>}
       {profileData?.fullName && profileData.fullName !== "Not found" &&
         <span className="sidebar-nav-badge">AI</span>}
     </button>

   Wire into the tab render block:
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
         />
       </>
     )}
───────────────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
  Target, X, Check, CheckCircle, AlertCircle, Info,
  TriangleAlert, Search, RefreshCw, MessageSquare,
  Loader2, ChevronDown, Copy, Send, FileSpreadsheet, Star
} from 'lucide-react';

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
const PROXY_URL_PM = "https://visalens-proxy.ijecloud.workers.dev";
const BRAND = "#5B21B6";

/* ─── LOCAL COPIES OF MODULE-LEVEL HELPERS ──────────────────────────────── */
function _parseGPA(str) {
  if (!str || str === "Not found") return null;
  const labeled = str.match(/(?:cgpa|gpa)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
  if (labeled) return parseFloat(labeled[1]);
  const frac = str.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const num = parseFloat(frac[1]), den = parseFloat(frac[2]);
    if (!isNaN(num) && !isNaN(den) && den > 0 && den <= 10) return num;
  }
  const pct = str.match(/\b(\d{2,3}(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const small = str.match(/\b([0-4]\.\d{1,2})\b/);
  if (small) return parseFloat(small[1]);
  return null;
}
function _parseFinancial(str) {
  if (!str || str === "Not found") return null;
  const { amount } = _parseCurrencyAmount(str);
  return amount;
}
function _parseIELTS(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
function _resolveOffer(profile, preferredIdx = 0) {
  const offers = profile?.offerLetters;
  if (Array.isArray(offers) && offers.length > 0) {
    const idx = (preferredIdx >= 0 && preferredIdx < offers.length) ? preferredIdx : 0;
    const o = offers[idx];
    return {
      country:    o.country    && o.country    !== "Not found" ? o.country    : null,
      university: o.university && o.university !== "Not found" ? o.university : null,
      program:    o.program    && o.program    !== "Not found" ? o.program    : null,
      status:     o.status     || null,
      hasOffer: true, idx,
    };
  }
  const fallback = profile?.targetCountry && profile.targetCountry !== "Not found" ? profile.targetCountry : null;
  return { country: fallback, university: null, program: null, status: null, hasOffer: false, idx: 0 };
}
function _getOrgSession() {
  try { const r = sessionStorage.getItem("visalens_org_session"); return r ? JSON.parse(r) : null; } catch { return null; }
}
function _withOrg(body) {
  const s = _getOrgSession(); return s?.org_id ? { ...body, org_id: s.org_id } : body;
}
function _supabase() {
  return window._supabaseInstance || null;
}

/* ─── CURRENCY PARSER (mirrors App.jsx parseCurrencyAmount) ─────────────── */
function _parseCurrencyAmount(str) {
  if (!str || str === "Not found" || str.trim() === "") return { amount: null, currency: null };
  const s = str.trim();
  const SYMBOL_MAP = [
    { re: /£/,                  iso: "GBP" },
    { re: /€/,                  iso: "EUR" },
    { re: /A\$|AUD/i,          iso: "AUD" },
    { re: /C\$|CAD/i,          iso: "CAD" },
    { re: /NZ\$|NZD/i,         iso: "NZD" },
    { re: /\$\s*(?!CAD|AUD)/i, iso: "USD" },
    { re: /¥|CNY|JPY/i,        iso: "CNY" },
    { re: /PKR|Rs\.?\s|₨/i,    iso: "PKR" },
    { re: /INR|₹/i,            iso: "INR" },
    { re: /EUR/i,              iso: "EUR" },
    { re: /GBP/i,              iso: "GBP" },
    { re: /USD/i,              iso: "USD" },
    { re: /MYR|RM/i,           iso: "MYR" },
    { re: /SGD/i,              iso: "SGD" },
    { re: /AED/i,              iso: "AED" },
  ];
  let currency = null;
  for (const { re, iso } of SYMBOL_MAP) {
    if (re.test(s)) { currency = iso; break; }
  }
  const numStr = s.replace(/[^0-9.,]/g, "").trim();
  if (!numStr) return { amount: null, currency };
  const lastDot = numStr.lastIndexOf(".");
  const lastComma = numStr.lastIndexOf(",");
  let normalised = numStr;
  if (lastDot > -1 && lastComma > -1) {
    normalised = lastComma > lastDot
      ? numStr.replace(/\./g, "").replace(",", ".")
      : numStr.replace(/,/g, "");
  } else if (lastComma > -1 && lastDot === -1) {
    const afterComma = numStr.slice(lastComma + 1);
    normalised = afterComma.length === 3 ? numStr.replace(/,/g, "") : numStr.replace(",", ".");
  } else if (lastDot > -1 && lastComma === -1) {
    const afterDot = numStr.slice(lastDot + 1);
    normalised = afterDot.length === 3 && numStr.replace(/[^.]/g,"").length > 1
      ? numStr.replace(/\./g, "") : numStr;
  }
  const amount = parseFloat(normalised);
  return { amount: isNaN(amount) ? null : amount, currency };
}

/* ─── CURRENCY → GBP RATES (approximate base conversion pivot) ──────────── */
const CURRENCY_TO_GBP = {
  GBP: 1,
  USD: 0.79, EUR: 0.85, AUD: 0.50, CAD: 0.57, NZD: 0.46,
  PKR: 0.0028, INR: 0.0095, MYR: 0.17, SGD: 0.59,
  AED: 0.22, CNY: 0.11, JPY: 0.0052, SEK: 0.073, NOK: 0.073,
};

/* ─── ISO → SYMBOL MAP ──────────────────────────────────────────────────── */
const ISO_SYMBOL = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$", NZD: "NZ$",
  PKR: "Rs ", INR: "₹", MYR: "RM", SGD: "S$", AED: "AED ",
  CNY: "¥", JPY: "¥", SEK: "kr", NOK: "kr",
};

/* ─── COUNTRY → CURRENCY FALLBACK ──────────────────────────────────────── */
const COUNTRY_TO_ISO = {
  "United Kingdom": "GBP", "UK": "GBP",
  "Australia": "AUD", "Canada": "CAD",
  "United States": "USD", "USA": "USD",
  "New Zealand": "NZD", "Ireland": "EUR",
  "Germany": "EUR", "France": "EUR", "Netherlands": "EUR",
  "Sweden": "SEK", "Norway": "NOK",
  "Pakistan": "PKR", "India": "INR",
  "UAE": "AED", "Malaysia": "MYR", "Singapore": "SGD",
};

function pteToIelts(pte) {
  if (pte >= 79) return 9.0; if (pte >= 73) return 8.5; if (pte >= 65) return 7.5;
  if (pte >= 59) return 7.0; if (pte >= 50) return 6.5; if (pte >= 43) return 6.0;
  if (pte >= 36) return 5.5; return 5.0;
}

/* ─── BEST IELTS EQUIVALENT FROM PROFILE ────────────────────────────────── */
function bestIeltsEquiv(profile) {
  const scores = [];
  const i = _parseIELTS(profile.ieltsScore); if (i !== null) scores.push(i);
  const t = parseFloat(profile.toeflScore);  if (!isNaN(t))  scores.push(t / 14.5);
  const p = parseFloat(profile.pteScore);    if (!isNaN(p))  scores.push(pteToIelts(p));
  for (const et of (profile.englishTests || [])) {
    const score = parseFloat(et.overallScore);
    if (isNaN(score)) continue;
    const tn = (et.type || "").toLowerCase();
    if      (tn.includes("ielts"))  scores.push(score);
    else if (tn.includes("toefl")) scores.push(score / 14.5);
    else if (tn.includes("pte"))   scores.push(pteToIelts(score));
  }
  return scores.length ? Math.max(...scores) : null;
}

/* ─── ENGLISH DISPLAY LABEL ──────────────────────────────────────────────── */
function englishLabel(profile) {
  const parts = [];
  if (Array.isArray(profile.englishTests) && profile.englishTests.length > 0) {
    for (const et of profile.englishTests) {
      if (et.overallScore && et.overallScore !== "Not found" && et.overallScore !== "")
        parts.push(`${et.type || "Test"} ${et.overallScore}`);
    }
  }
  if (parts.length === 0) {
    if (profile.ieltsScore && profile.ieltsScore !== "Not found") parts.push(`IELTS ${profile.ieltsScore}`);
    if (profile.toeflScore && profile.toeflScore !== "Not found") parts.push(`TOEFL ${profile.toeflScore}`);
    if (profile.pteScore   && profile.pteScore   !== "Not found") parts.push(`PTE ${profile.pteScore}`);
  }
  return parts.length ? parts.join(" / ") : null;
}

/* ─── CORE SCORING ENGINE ────────────────────────────────────────────────── */
function scoreProgram(profile, prog, uniName, country, offerLetters, wiOverride) {
  const effectiveIelts  = wiOverride.ielts  !== null ? wiOverride.ielts  : bestIeltsEquiv(profile);
  const effectiveGpa    = wiOverride.gpa    !== null ? wiOverride.gpa    : _parseGPA(profile.academicResult);

  // Parse student's funds and explicitly identify its currency
  const fundsRaw = profile.financialBalance || "";
  const { amount: parsedFundsAmount, currency: parsedFundsCurrency } = _parseCurrencyAmount(fundsRaw);
  const effectiveFunds  = wiOverride.funds  !== null ? wiOverride.funds  : parsedFundsAmount;

  // IMPORTANT: We ALWAYS evaluate the financial match in the program's native currency.
  const reqCurrency = COUNTRY_TO_ISO[country] || "GBP";

  // Convert the student's funds into the program's native currency via GBP pivot
  let fundsInReqCurrency = null;
  if (effectiveFunds !== null) {
    const fromISO = wiOverride.funds !== null ? "GBP" : (parsedFundsCurrency || null);
    if (fromISO && reqCurrency) {
      if (fromISO === reqCurrency) {
        fundsInReqCurrency = effectiveFunds;
      } else {
        const rateFrom = CURRENCY_TO_GBP[fromISO];
        const rateTo   = CURRENCY_TO_GBP[reqCurrency];
        if (rateFrom && rateTo) fundsInReqCurrency = Math.round(effectiveFunds * rateFrom / rateTo);
      }
    } else {
      fundsInReqCurrency = effectiveFunds; // fallback if currency couldn't be parsed
    }
  }

  // Parse tuition (tuition is assumed to already be in the program's native currency)
  let tuitionAmount = null;
  if (prog.tuition != null) {
    if (typeof prog.tuition === "number") {
      tuitionAmount = prog.tuition;
    } else {
      const { amount: ta } = _parseCurrencyAmount(String(prog.tuition));
      tuitionAmount = ta;
    }
  }
  prog = { ...prog, financial: tuitionAmount };

  // ── English ──
  const engTestLabel = englishLabel(profile);
  let engPoints = 15, engStatus = "unknown", engGap = null;
  let engHave = null, engReq = prog.ielts;
  let engSubLabel = "No English score on file";
  if (prog.ielts != null) {
    if (effectiveIelts !== null) {
      engHave = effectiveIelts;
      engStatus = effectiveIelts >= prog.ielts ? "pass" : "fail";
      engPoints = engStatus === "pass" ? 30 : 0;
      engGap    = engStatus === "fail" ? +(prog.ielts - effectiveIelts).toFixed(1) : null;
      const scoreStr = engTestLabel ? `${engTestLabel}` : `IELTS equiv. ${effectiveIelts.toFixed(1)}`;
      engSubLabel = `${scoreStr}${wiOverride.ielts !== null ? " (simulated)" : ""} · Required ${prog.ielts}`;
    } else {
      engSubLabel = "No English score on file · Required " + prog.ielts;
    }
  } else {
    engStatus = "unknown"; engPoints = 15;
    engSubLabel = engTestLabel ? `${engTestLabel} · No requirement set` : "No requirement set";
  }

  // ── GPA ──
  const gpaRaw = profile.academicResult || "";
  let gpaPoints = 15, gpaStatus = "unknown", gpaGap = null;
  let gpaHave = null, gpaReq = prog.gpa;
  let gpaSubLabel = "No academic result on file";
  if (prog.gpa != null) {
    if (effectiveGpa !== null) {
      gpaHave = effectiveGpa;
      gpaStatus = effectiveGpa >= prog.gpa ? "pass" : "fail";
      gpaPoints = gpaStatus === "pass" ? 30 : 0;
      gpaGap    = gpaStatus === "fail" ? +(prog.gpa - effectiveGpa).toFixed(2) : null;
      gpaSubLabel = `CGPA ${effectiveGpa.toFixed(2)}${wiOverride.gpa !== null ? " (simulated)" : ""} · Required ${prog.gpa}`;
    } else {
      gpaSubLabel = "No CGPA on file · Required " + prog.gpa;
    }
  } else {
    gpaStatus = "unknown"; gpaPoints = 15;
    gpaSubLabel = effectiveGpa !== null ? `CGPA ${effectiveGpa.toFixed(2)} · No requirement set` : "No requirement set";
  }

  // ── Funds ──
  let finPoints = 15, finStatus = "unknown", finGap = null;
  let finHave = null, finReq = prog.financial;
  let finSubLabel = "No funds information on file";
  let currencyWarning = false;
  let currencyWarningDetail = null;
  const sym = reqCurrency ? (ISO_SYMBOL[reqCurrency] || reqCurrency + " ") : "";

  if (prog.financial != null) {
    if (fundsInReqCurrency !== null) {
      finHave = fundsInReqCurrency;
      finStatus = fundsInReqCurrency >= prog.financial ? "pass" : "fail";
      finPoints = finStatus === "pass" ? 30 : 0;
      finGap    = finStatus === "fail" ? Math.round(prog.financial - fundsInReqCurrency) : null;
      const diff = fundsInReqCurrency - prog.financial;
      const diffStr = diff >= 0
        ? `+${sym}${Math.abs(diff).toLocaleString()} surplus`
        : `${sym}${Math.abs(diff).toLocaleString()} short`;
      const simTag = wiOverride.funds !== null ? " (simulated)" : "";
      finSubLabel = [
        `${sym}${fundsInReqCurrency.toLocaleString()}${simTag}`,
        `Required ${sym}${prog.financial.toLocaleString()}`,
        diffStr,
      ].join(" · ");
    } else {
      finSubLabel = `No funds on file · Required ${sym}${prog.financial.toLocaleString()}`;
    }
  } else {
    finStatus = "unknown"; finPoints = 15;
    finSubLabel = fundsRaw && fundsRaw !== "Not found" ? `${fundsRaw} · No requirement set` : "No requirement set";
  }

  let offerMatch = false, offerStatus = null;
  if (Array.isArray(offerLetters)) {
    for (const o of offerLetters) {
      const uniMatch = o.university && uniName &&
        (o.university.toLowerCase().includes(uniName.toLowerCase()) ||
         uniName.toLowerCase().includes(o.university.toLowerCase()));
      const cntMatch = o.country && country &&
        (o.country.toLowerCase().includes(country.toLowerCase()) ||
         country.toLowerCase().includes(o.country.toLowerCase()));
      if (uniMatch || cntMatch) { offerMatch = true; offerStatus = o.status || "Matched"; break; }
    }
  }

  const offerBonus = offerMatch ? 10 : 0;
  const rawScore = engPoints + gpaPoints + finPoints + offerBonus;
  const score    = Math.min(100, rawScore);
  const failCount    = [engStatus, gpaStatus, finStatus].filter(s => s === "fail").length;

  let status;
  if (score >= 80)                         status = "eligible";
  else if (score >= 50 && failCount <= 2)  status = "borderline";
  else                                     status = "ineligible";

  const gaps = [];
  if (engStatus === "fail" && engGap !== null) gaps.push(`Raise English score by ${engGap} band${engGap !== 1 ? "s" : ""} (need IELTS ${prog.ielts}, have ${effectiveIelts?.toFixed(1)})`);
  if (gpaStatus === "fail" && gpaGap !== null) gaps.push(`CGPA short by ${gpaGap} points (need ${prog.gpa}, have ${effectiveGpa?.toFixed(2)})`);
  if (finStatus === "fail" && finGap !== null) gaps.push(`Funds short by ${sym}${finGap.toLocaleString()} (need ${sym}${prog.financial.toLocaleString()})`);

  return {
    score, status, offerMatch, offerStatus, currencyWarning, currencyWarningDetail,
    checks: {
      english:  { status: engStatus,  subLabel: engSubLabel,  gap: engGap,  req: prog.ielts,     have: engHave,  testLabel: engTestLabel },
      gpa:      { status: gpaStatus,  subLabel: gpaSubLabel,  gap: gpaGap,  req: prog.gpa,       have: gpaHave  },
      financial:{ status: finStatus,  subLabel: finSubLabel,  gap: finGap,  req: prog.financial, have: finHave, currencyWarning },
    },
    gaps, failCount,
  };
}

/* ─── BUILD FLAT MATCH LIST ─────────────────────────────────────────────── */
function buildMatchList(profile, requirementsData, preferredOfferIndex, wiOverride) {
  const offers = Array.isArray(profile?.offerLetters) ? profile.offerLetters : [];
  const results = [];
  for (const [country, countryData] of Object.entries(requirementsData)) {
    const unis = countryData.universities || {};
    for (const [uniName, uniData] of Object.entries(unis)) {
      const progs = Array.isArray(uniData.programs) ? uniData.programs : [];
      for (const prog of progs) {
        const scored = scoreProgram(profile, prog, uniName, country, offers, wiOverride);
        results.push({
          country, flag: countryData.flag || "🌍", university: uniName,
          ranking: uniData.ranking || "", program: prog.name, level: prog.level || "",
          duration: prog.duration || "", tuition: prog.tuition, ...scored,
        });
      }
    }
  }
  const tierOrder = { eligible: 0, borderline: 1, ineligible: 2 };
  results.sort((a, b) => {
    if (b.offerMatch !== a.offerMatch) return b.offerMatch ? 1 : -1;
    const ta = tierOrder[a.status] ?? 3, tb = tierOrder[b.status] ?? 3;
    if (ta !== tb) return ta - tb;
    return b.score - a.score;
  });
  return results;
}

/* ─── BUILD MATCH AI SYSTEM PROMPT ─────────────────────────────────────── */
function buildMatchSystemPrompt(profile, requirementsData, matchList, wiOverride) {
  const p = profile || {};
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const wiParts = [];
  if (wiOverride.ielts  !== null) wiParts.push(`IELTS overridden to ${wiOverride.ielts}`);
  if (wiOverride.gpa    !== null) wiParts.push(`GPA overridden to ${wiOverride.gpa}`);
  if (wiOverride.funds  !== null) wiParts.push(`Funds overridden to ${wiOverride.funds.toLocaleString()}`);
  const wiNote = wiParts.length ? `\nSIMULATION ACTIVE: ${wiParts.join(", ")}` : "";
  const profileSection = `=== STUDENT PROFILE ===
Name: ${p.fullName || "Not found"}
Nationality: ${p.nationality || "Not found"}
English: ${englishLabel(p) || "Not found"}  Best IELTS equiv: ${bestIeltsEquiv(p) ?? "N/A"}
GPA / Academic: ${p.academicResult || "Not found"}
Funds Available: ${p.financialBalance || "Not found"}
Offer Letters: ${(Array.isArray(p.offerLetters) && p.offerLetters.length)
  ? p.offerLetters.map(o => `${o.status || ""} — ${o.university || ""}${o.country ? `, ${o.country}` : ""}${o.program && o.program !== "Not found" ? `, ${o.program}` : ""}`).join(" | ")
  : "None"}
Target Country: ${p.targetCountry || "Not found"}${wiNote}`;

  const visible = matchList.filter(m => m.status !== "ineligible").slice(0, 60);
  const programSection = `=== MATCHED PROGRAMS (eligible + borderline, sorted by score) ===
${visible.map(m => {
  const nativeISO = COUNTRY_TO_ISO[m.country] || "GBP";
  const sym = ISO_SYMBOL[nativeISO] || nativeISO + " ";
  const tuitStr = typeof m.tuition === 'number' ? `${sym}${m.tuition.toLocaleString()}` : m.tuition;
  return `[${m.status.toUpperCase()} ${m.score}%] ${m.flag} ${m.country} · ${m.university} · ${m.program} · ${m.level} · ${m.duration}${m.tuition ? ` · Tuition ${tuitStr}` : ""}${m.offerMatch ? " · ★ OFFER MATCH" : ""}${m.gaps.length ? ` · GAPS: ${m.gaps.join("; ")}` : ""}`;
}).join("\n")}
Total eligible: ${matchList.filter(m=>m.status==="eligible").length}
Total borderline: ${matchList.filter(m=>m.status==="borderline").length}
Total ineligible (hidden from list): ${matchList.filter(m=>m.status==="ineligible").length}`;

  return `You are VisaLens Match AI, a student counselling assistant specialised in program matching and eligibility analysis.

Today: ${today}

You have been given a student profile and a pre-computed list of program matches from the counsellor's loaded university database.

Your role:
- Answer counsellor questions about which programs the student is eligible or close to eligible for
- Explain gaps clearly and suggest what the student needs to improve
- Rank recommendations when asked
- Reference specific program names, requirements, and gaps from the data below
- Keep answers under 250 words unless a detailed breakdown is requested

DO NOT ask to see more documents. Use only the data below.

${profileSection}

${programSection}`;
}

/* ─── formatBubble ───────────────────────────────────────────────────────── */
function _formatBubble(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[-•*]\s+(.+)$/gm, "<div style='display:flex;gap:6px;margin:2px 0'><span>•</span><span>$1</span></div>")
    .replace(/\n\n/g, "<div style='margin-top:8px'></div>")
    .replace(/\n/g, "<br/>");
}

/* ─── MATCH AI CHAT PANEL ────────────────────────────────────────────────── */
const MATCH_SUGGESTIONS = [
  "Which programs is this student closest to qualifying for?",
  "What IELTS score would unlock the most new programs?",
  "Are there fully eligible postgraduate programs in Canada?",
  "Summarise the top 3 recommended programs with reasons.",
  "What's the fastest gap for this student to close?",
];

function MatchChatPanel({ profile, requirementsData, matchList, wiOverride, onCreditsUpdate, studentStorageKey }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const [chatPersisting, setChatPersisting] = useState(false);
  const bottomRef  = useRef(null);
  const textareaRef = useRef(null);
  const chatInitRef = useRef(false);
  const userIsChattingRef = useRef(false);

  const hasProfile = profile && profile.fullName && profile.fullName !== "Not found";
  const studentFirst = hasProfile ? (profile.fullName || "").split(" ")[0] : "the student";

  useEffect(() => {
    if (!studentStorageKey || !hasProfile) return;
    chatInitRef.current = false;
    const sb = _supabase();
    const org = _getOrgSession();
    if (!sb || !org?.org_id) return;
    sb.from("student_shortlists")
      .select("chat_history")
      .eq("org_id", org.org_id)
      .eq("student_key", studentStorageKey)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && Array.isArray(data?.chat_history) && data.chat_history.length > 0) {
          setMessages(data.chat_history);
        } else {
          setMessages([]);
        }
        chatInitRef.current = true;
      });
  }, [studentStorageKey, hasProfile]);

  useEffect(() => {
    if (!chatInitRef.current) return;
    if (!studentStorageKey) return;
    const sb = _supabase();
    const org = _getOrgSession();
    if (!sb || !org?.org_id) return;
    setChatPersisting(true);
    sb.from("student_shortlists")
      .upsert(
        { org_id: org.org_id, student_key: studentStorageKey, chat_history: messages, updated_at: new Date().toISOString() },
        { onConflict: "org_id,student_key" }
      )
      .then(({ error }) => {
        if (error) console.warn("Chat save error:", error.message);
        setChatPersisting(false);
      });
  }, [messages, studentStorageKey]);

  useEffect(() => {
    if (!userIsChattingRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  async function sendMessage(userText) {
    const text = (userText || input).trim();
    if (!text || loading || !hasProfile) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const newMessages = [...messages, { role: "user", content: text }];
    userIsChattingRef.current = true;
    setMessages(newMessages);
    setLoading(true);
    try {
      const systemPrompt = buildMatchSystemPrompt(profile, requirementsData, matchList, wiOverride);
      const resp = await fetch(PROXY_URL_PM, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Id": _getOrgSession()?.org_id || "" },
        body: JSON.stringify(_withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 700,
          system: systemPrompt,
          messages: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        })),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      if (typeof data.analyses_remaining === "number" && onCreditsUpdate)
        onCreditsUpdate(data.analyses_remaining);
      const reply = data.content?.map(b => b.text || "").join("") || "(no response)";
      setMessages(p => [...p, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(p => [...p, { role: "assistant", content: `⚠️ Error: ${e.message}` }]);
    } finally { setLoading(false); }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function copyChat() {
    if (!messages.length) return;
    const text = messages.map(m => `${m.role === "user" ? "Counsellor" : "Match AI"}:\n${m.content}`).join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!hasProfile) {
    return (
      <div className="chat-wrap">
        <div className="chat-no-ctx" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2.5rem 1.5rem",textAlign:"center",gap:10,flex:1}}>
          <div className="chat-empty-ico"><MessageSquare size={20} color="var(--p)"/></div>
          <div className="chat-empty-ttl">No profile loaded</div>
          <div className="chat-empty-sub">Load a student profile first to use Match AI.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      <div className="chat-hdr" style={{background:"var(--s2)"}}>
        <div className="chat-hdr-ico"><MessageSquare size={14} color="var(--p)"/></div>
        <div style={{flex:1}}>
          <div className="chat-hdr-title">Match AI</div>
          <div className="chat-hdr-ctx">
            <span className="chat-ctx-pill"><CheckCircle size={9}/> {profile.fullName || studentFirst}</span>
          </div>
        </div>
        {messages.length > 0 && (
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            {chatPersisting && <Loader2 size={10} style={{animation:"spin 1s linear infinite",opacity:.5,color:"var(--t3)"}}/>}
            <button className="btn-s" style={{height:26,padding:"0 8px",fontSize:10}} onClick={copyChat}>
              {copied ? <><Check size={10}/>Copied</> : <><Copy size={10}/>Copy</>}
            </button>
            <button
              className="btn-s"
              style={{height:26,padding:"0 8px",fontSize:10,background:"transparent",color:"var(--t3)",border:"1px solid var(--bd)"}}
              title="Clear chat history"
              onClick={() => {
                setMessages([]);
                chatInitRef.current = true;
                const sb = _supabase(); const org = _getOrgSession();
                if (sb && org?.org_id && studentStorageKey) {
                  sb.from("student_shortlists")
                    .upsert({ org_id: org.org_id, student_key: studentStorageKey, chat_history: [], updated_at: new Date().toISOString() }, { onConflict: "org_id,student_key" })
                    .then(({error}) => { if(error) console.warn("Chat clear error:", error.message); });
                }
              }}
            >
              <X size={10}/> Clear
            </button>
          </div>
        )}
      </div>
      <div className="chat-msgs">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-ico"><MessageSquare size={20} color="var(--p)"/></div>
            <div className="chat-empty-ttl">Ask about {studentFirst}'s matches</div>
            <div className="chat-empty-sub">
              Reason across {matchList.filter(m=>m.status!=="ineligible").length} eligible &amp; borderline programs.
            </div>
            <div className="chat-chips" style={{flexDirection:"column",alignItems:"stretch",marginTop:10,gap:5}}>
              {MATCH_SUGGESTIONS.map((s, i) => (
                <button key={i} className="chat-chip" style={{textAlign:"left"}} onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <div className={`chat-avatar ${m.role}`}>
                  {m.role === "user" ? (profile.fullName||"?").slice(0,2).toUpperCase() : "AI"}
                </div>
                <div className={`chat-bubble ${m.role}`} dangerouslySetInnerHTML={{ __html: _formatBubble(m.content) }}/>
              </div>
            ))}
            {loading && (
              <div className="chat-msg assistant">
                <div className="chat-avatar assistant">AI</div>
                <div className="chat-typing">
                  <div className="chat-dot"/><div className="chat-dot"/><div className="chat-dot"/>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef}/>
      </div>
      <div className="chat-footer">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            rows={1}
            placeholder="Ask about programs, gaps, or what-if scenarios…"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() || loading}>
            {loading ? <Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/> : <Send size={14}/>}
          </button>
        </div>
        <div style={{fontSize:10,color:"var(--t3)",fontFamily:"var(--fm)",textAlign:"center",marginTop:5,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Info size={9}/> Context: {studentFirst}'s profile + {matchList.length} programs from loaded CSV
        </div>
      </div>
    </div>
  );
}

/* ─── WHAT-IF MODAL ──────────────────────────────────────────────────────── */
function WhatIfModal({ profile, wiOverride, onChange, onClose }) {
  const [ielts, setIelts] = useState(wiOverride.ielts !== null ? String(wiOverride.ielts) : "");
  const [gpa,   setGpa]   = useState(wiOverride.gpa   !== null ? String(wiOverride.gpa)   : "");
  const [funds, setFunds] = useState(wiOverride.funds !== null ? String(wiOverride.funds)  : "");

  const actualIelts = bestIeltsEquiv(profile);
  const actualGpa   = _parseGPA(profile?.academicResult);
  const actualFunds = _parseFinancial(profile?.financialBalance);

  function apply() {
    onChange({
      ielts:  ielts.trim()  !== "" ? parseFloat(ielts)  : null,
      gpa:    gpa.trim()    !== "" ? parseFloat(gpa)    : null,
      funds:  funds.trim()  !== "" ? parseFloat(funds.replace(/[^0-9.]/g, "")) : null,
    });
    onClose();
  }
  function reset() { setIelts(""); setGpa(""); setFunds(""); }
  function handleOverlayClick(e) { if (e.target === e.currentTarget) onClose(); }

  const fieldStyle = {
    width:"100%",fontSize:13,padding:"8px 10px",borderRadius:8,
    border:"1px solid var(--bd)",background:"var(--s1)",color:"var(--t1)",
    fontFamily:"var(--fu)",outline:"none",boxSizing:"border-box",
  };
  const labelStyle = { fontSize:11,fontWeight:700,color:"var(--t3)",fontFamily:"var(--fh)",marginBottom:4,display:"block" };

  return (
    <div onClick={handleOverlayClick} style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,30,60,.38)"}}>
      <div style={{background:"var(--s1)",border:"1px solid var(--bd)",borderRadius:"var(--r3)",padding:"22px 22px 18px",width:340,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 32px rgba(15,30,60,.18)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{width:32,height:32,borderRadius:"var(--r2)",background:`${BRAND}18`,border:`1px solid ${BRAND}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <Target size={15} color={BRAND}/>
          </div>
          <div style={{flex:1,fontSize:14,fontWeight:700,color:"var(--t1)",fontFamily:"var(--fh)"}}>Simulate Offer</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:20,lineHeight:1,padding:0}}>×</button>
        </div>
        <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fu)",marginBottom:16,padding:"10px 12px",background:"var(--s2)",borderRadius:8,lineHeight:1.5}}>
          Override the student's scores to simulate how the match list would change with improved qualifications.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
          <div>
            <label style={labelStyle}>IELTS {actualIelts !== null && <span style={{color:"var(--t3)",fontWeight:400}}>(actual: {actualIelts.toFixed(1)})</span>}</label>
            <input type="number" step="0.5" min="0" max="9" placeholder={actualIelts !== null ? `e.g. ${Math.min(9, actualIelts + 0.5)}` : "e.g. 6.5"} value={ielts} onChange={e => setIelts(e.target.value)} style={fieldStyle}/>
          </div>
          <div>
            <label style={labelStyle}>CGPA {actualGpa !== null && <span style={{color:"var(--t3)",fontWeight:400}}>(actual: {actualGpa.toFixed(2)})</span>}</label>
            <input type="number" step="0.1" min="0" max="4" placeholder={actualGpa !== null ? `e.g. ${Math.min(4, actualGpa + 0.2).toFixed(1)}` : "e.g. 3.5"} value={gpa} onChange={e => setGpa(e.target.value)} style={fieldStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Funds {actualFunds !== null && <span style={{color:"var(--t3)",fontWeight:400}}>(actual: {actualFunds.toLocaleString()})</span>}</label>
            <input type="number" step="1000" min="0" placeholder={actualFunds !== null ? `e.g. ${(actualFunds + 5000).toLocaleString()}` : "e.g. 50000"} value={funds} onChange={e => setFunds(e.target.value)} style={fieldStyle}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={reset} style={{flex:1,height:36,borderRadius:8,border:"1px solid var(--bd)",background:"transparent",color:"var(--t2)",cursor:"pointer",fontFamily:"var(--fh)",fontSize:12,fontWeight:600}}>Reset</button>
          <button onClick={apply} style={{flex:2,height:36,borderRadius:8,border:"none",background:BRAND,color:"#fff",cursor:"pointer",fontFamily:"var(--fh)",fontSize:12,fontWeight:700}}>Apply simulation</button>
        </div>
      </div>
    </div>
  );
}

/* ─── CHECK CELL ─────────────────────────────────────────────────────────── */
function CheckCell({ check }) {
  const { status, gap, req } = check;
  const isPass = status === "pass";
  const isFail = status === "fail";

  if (isPass) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: "var(--fh)",
          color: "#fff", background: "#1D4ED8",
          border: "1px solid #1E40AF",
          padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap",
        }}>Met</span>
        {req != null && <span style={{ fontSize: 9, color: "var(--t3)", fontFamily: "var(--fm)", lineHeight: 1 }}>req {req}</span>}
      </div>
    );
  }
  if (isFail) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: "var(--fh)",
          color: "#fff", background: "#DC2626",
          border: "1px solid #B91C1C",
          padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap",
        }}>Unmet</span>
        {gap != null && <span style={{ fontSize: 9, color: "#DC2626", fontFamily: "var(--fm)", fontWeight: 700, lineHeight: 1 }}>−{gap}</span>}
      </div>
    );
  }
  // unknown
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
      <span style={{
        fontSize: 9, fontWeight: 600, fontFamily: "var(--fh)",
        color: "#6B7280", background: "var(--s2)",
        border: "1px solid var(--bd)",
        padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap",
      }}>—</span>
      {req != null && <span style={{ fontSize: 9, color: "var(--t3)", fontFamily: "var(--fm)", lineHeight: 1 }}>req {req}</span>}
    </div>
  );
}

/* ─── DETAIL MODAL ───────────────────────────────────────────────────────── */
function MatchDetailModal({ match, onClose, onCopySummary, isSaved, onToggleSave }) {
  const { status, score, offerMatch, offerStatus, checks, gaps, flag, country, university, ranking, program, level, duration, tuition, currencyWarning, currencyWarningDetail } = match;

  const checkRows = [
    { key:"english",   label:"English Proficiency", icon:"🗣", ...checks.english   },
    { key:"gpa",       label:"Academic Result (CGPA)", icon:"🎓", ...checks.gpa    },
    { key:"financial", label:"Financial Funds vs. Tuition", icon:"💰", ...checks.financial },
  ];

  // If currency warning triggered status downgrade, use amber colour scheme
  const displayStatus = status;
  const statusColor  = displayStatus === "eligible" ? "#16A34A" : displayStatus === "borderline" ? "#F97316" : "#6B7280";
  const statusBg     = displayStatus === "eligible" ? "#F0FDF4" : displayStatus === "borderline" ? "rgba(249,115,22,.08)" : "#F9FAFB";
  const statusBorder = displayStatus === "eligible" ? "#BBF7D0" : displayStatus === "borderline" ? "rgba(249,115,22,.3)" : "#E5E7EB";

  const nativeISO = COUNTRY_TO_ISO[country] || "GBP";
  const sym = ISO_SYMBOL[nativeISO] || nativeISO + " ";
  const displayTuition = typeof tuition === "number" ? `${sym}${tuition.toLocaleString()}` : tuition;

  React.useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.45)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--s1)",borderRadius:20,width:"100%",maxWidth:520,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,.22)",border:"1px solid var(--bd)"}}>

        {/* Header */}
        <div style={{padding:"24px 24px 20px",borderBottom:"1px solid var(--bd)",position:"relative"}}>
          <button onClick={onClose} style={{position:"absolute",top:16,right:16,width:28,height:28,borderRadius:"50%",border:"1px solid var(--bd)",background:"var(--s2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t3)"}}>
            <X size={13}/>
          </button>
          <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
            <span style={{fontSize:32,lineHeight:1,flexShrink:0}}>{flag}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:3}}>{university}{ranking ? ` · ${ranking}` : ""}</div>
              <div style={{fontSize:18,fontWeight:800,color:"var(--t1)",fontFamily:"var(--fh)",lineHeight:1.25,marginBottom:8}}>{program}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {level && <span className="pm-level-pill">{level}</span>}
                {duration && <span style={{fontSize:11,background:"var(--s2)",color:"var(--t2)",padding:"2px 9px",borderRadius:20,fontFamily:"var(--fm)"}}>{duration}</span>}
                {country && <span style={{fontSize:11,background:"var(--s2)",color:"var(--t2)",padding:"2px 9px",borderRadius:20,fontFamily:"var(--fm)"}}>{country}</span>}
                {offerMatch && <span style={{fontSize:11,background:BRAND,color:"#fff",padding:"2px 9px",borderRadius:20,fontFamily:"var(--fh)",fontWeight:700}}>★ {offerStatus || "Offer"}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{padding:"20px 24px"}}>

          {/* Score bar */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,padding:"14px 16px",background:statusBg,borderRadius:12,border:`1px solid ${statusBorder}`}}>
            <div>
              <div style={{fontSize:32,fontWeight:900,lineHeight:1,color:statusColor,fontFamily:"var(--fh)"}}>{score}%</div>
              <div style={{fontSize:10,fontWeight:700,color:statusColor,textTransform:"uppercase",letterSpacing:".08em",fontFamily:"var(--fh)"}}>Match score</div>
            </div>
            <div style={{flex:1}}>
              <div style={{height:8,borderRadius:8,background:"rgba(0,0,0,.08)",overflow:"hidden"}}>
                <div style={{width:`${score}%`,height:"100%",borderRadius:8,background:statusColor,transition:"width 600ms ease"}}/>
              </div>
              <div style={{fontSize:11,color:statusColor,fontWeight:700,marginTop:5,fontFamily:"var(--fh)"}}>
                {displayStatus === "eligible" ? "✓ Fully eligible" : displayStatus === "borderline" ? "⚡ Borderline — review required" : "✗ Currently ineligible"}
              </div>
            </div>
            {tuition && (
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",fontFamily:"var(--fh)"}}>{displayTuition}</div>
                <div style={{fontSize:9,color:"var(--t3)",fontFamily:"var(--fm)"}}>Tuition</div>
              </div>
            )}
          </div>

          {/* Eligibility checks */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--t3)",fontFamily:"var(--fh)",marginBottom:8}}>Eligibility checks</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {checkRows.map(c => {
                const isPas = c.status === "pass", isFail = c.status === "fail", isWarn = c.currencyWarning;
                const bg   = isPas && !isWarn ? "#F0FDF4" : isFail ? "#FFF1F2" : isWarn ? "rgba(249,115,22,.08)" : "var(--s2)";
                const col  = isPas && !isWarn ? "#16A34A" : isFail ? "#DC2626" : isWarn ? "#C2410C" : "#6B7280";
                const bord = isPas && !isWarn ? "#BBF7D0" : isFail ? "#FECDD3" : isWarn ? "rgba(249,115,22,.3)" : "var(--bd)";
                const icon = isPas && !isWarn ? "✓" : isFail ? "✗" : isWarn ? "!" : "?";
                return (
                  <div key={c.key} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,background:bg,border:`1px solid ${bord}`}}>
                    <span style={{width:22,height:22,borderRadius:"50%",background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",fontFamily:"var(--fh)",marginBottom:2}}>{c.icon} {c.label}</div>
                      {c.key === "financial" ? (() => {
                        // Parse structured info from subLabel: "HAVE · Required REQ · DIFF"
                        const parts = c.subLabel.split(" · ");
                        const havePart = parts[0] || "";
                        const reqPart  = parts[1] || "";
                        const diffPart = parts[2] || "";
                        const diffIsNeg = diffPart.toLowerCase().includes("short");
                        return (
                          <div style={{display:"flex",flexDirection:"column",gap:2,marginTop:2}}>
                            <div style={{fontSize:11,fontFamily:"var(--fm)",color:"var(--t2)"}}>
                              <span style={{color:"var(--t3)",fontSize:10}}>Available: </span>{havePart}
                            </div>
                            <div style={{fontSize:11,fontFamily:"var(--fm)",color:"var(--t2)"}}>
                              <span style={{color:"var(--t3)",fontSize:10}}>Required: </span>{reqPart.replace(/^Required\s*/i,"")}
                            </div>
                            {diffPart && (
                              <div style={{fontSize:11,fontFamily:"var(--fh)",fontWeight:700,color: diffIsNeg ? "#DC2626" : "#16A34A"}}>
                                {diffIsNeg ? "⬇ " : "⬆ "}{diffPart}
                              </div>
                            )}
                          </div>
                        );
                      })() : (
                        <div style={{fontSize:11,color:col,fontFamily:"var(--fm)",lineHeight:1.4,wordBreak:"break-word"}}>{c.subLabel}</div>
                      )}
                    </div>
                    {c.gap != null && c.key !== "financial" && (
                      <div style={{textAlign:"right",flexShrink:0,fontSize:11,fontFamily:"var(--fm)",color:col,fontWeight:700}}>
                        −{c.gap}
                        <div style={{fontSize:9,fontWeight:400,opacity:.8}}>gap</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gaps to close */}
          {gaps.length > 0 && (
            <div style={{background:"rgba(249,115,22,.08)",border:"1px solid rgba(249,115,22,.3)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#C2410C",fontFamily:"var(--fu)",lineHeight:1.6}}>
              <div style={{fontWeight:700,marginBottom:4,fontFamily:"var(--fh)"}}>⚡ Gaps to close</div>
              {gaps.map((g, i) => (
                <div key={i} style={{display:"flex",gap:6}}><span>•</span><span>{g}</span></div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button
              onClick={() => onToggleSave && onToggleSave(match)}
              style={{
                flex:1,height:38,padding:"0 16px",borderRadius:10,border:`1px solid ${isSaved ? BRAND : "var(--bd)"}`,
                cursor:"pointer",fontFamily:"var(--fh)",fontSize:12,fontWeight:700,
                display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all 150ms",
                background: isSaved ? BRAND : "transparent",
                color: isSaved ? "#fff" : "var(--t2)",
              }}
            >
              <Star size={13} fill={isSaved ? "#fff" : "none"} color={isSaved ? "#fff" : "var(--t2)"}/>
              {isSaved ? "Saved to shortlist" : "Save to shortlist"}
            </button>
            <button onClick={() => onCopySummary(match)} style={{height:38,padding:"0 16px",borderRadius:10,border:"1px solid var(--bd)",background:"transparent",cursor:"pointer",fontFamily:"var(--fh)",fontSize:12,fontWeight:600,color:"var(--t2)",display:"flex",alignItems:"center",gap:5}}>
              <Copy size={12}/> Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── STATUS PILL ────────────────────────────────────────────────────────── */
function StatusPill({ status }) {
  const cfg = {
    eligible:   { label: "Eligible",   color: "#ffffff", bg: "#15803D", border: "#166534" },
    borderline: { label: "Borderline", color: "#fff", bg: "#F97316", border: "#EA580C" },
    ineligible: { label: "Ineligible", color: "#9CA3AF", bg: "#F9FAFB", border: "#E5E7EB" },
  }[status] || { label: status, color: "#9CA3AF", bg: "#F9FAFB", border: "#E5E7EB" };

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 700, fontFamily: "var(--fh)",
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      padding: "3px 10px", borderRadius: 20,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

/* ─── TABLE ROW ──────────────────────────────────────────────────────────── */
function MatchRow({ match, isSaved, onToggleSave, onCopySummary }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { status, score, flag, country, university, ranking, program, level, duration, tuition, checks } = match;

  const rowBg = hovered ? "var(--s2)" : "transparent";
  const borderLeft = hovered ? `3px solid ${BRAND}` : "3px solid transparent";

  return (
    <>
      <tr
        onClick={() => setModalOpen(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          cursor: "pointer",
          background: rowBg,
          borderLeft,
          transition: "background 120ms, border-left-color 120ms",
        }}
      >
        {/* Program + University */}
        <td style={{ padding: "13px 16px 13px 14px", borderBottom: "1px solid var(--bd)", minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--fh)", lineHeight: 1.3, marginBottom: 2 }}>
            {program}
          </div>
          <div style={{ fontSize: 11, color: "var(--t2)", fontFamily: "var(--fu)", fontWeight: 500 }}>
            {university}{ranking ? ` · ${ranking}` : ""}
          </div>
        </td>

        {/* Country */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, borderRadius: "50%", overflow: "hidden",
              flexShrink: 0, border: "1px solid var(--bd)", background: "var(--s2)",
              fontSize: 13, lineHeight: 1,
            }}>{flag}</span>
            <span style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--fu)", fontWeight: 500 }}>{country}</span>
          </div>
        </td>

        {/* Level */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap" }}>
          {level && <span className="pm-level-pill">{level}</span>}
          {duration && (
            <div style={{ fontSize: 10, color: "var(--t3)", fontFamily: "var(--fu)", marginTop: 3 }}>{duration}</div>
          )}
        </td>

        {/* Tuition */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)" }}>
          {tuition != null ? (() => {
            const nativeISO = COUNTRY_TO_ISO[country] || "GBP";
            const sym = ISO_SYMBOL[nativeISO] || nativeISO + " ";
            let displayVal = typeof tuition === "number" ? `${sym}${tuition.toLocaleString()}` : tuition;
            return (
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--fh)", whiteSpace: "nowrap" }}>
                {displayVal}
              </span>
            );
          })() : (
            <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "var(--fm)" }}>—</span>
          )}
        </td>

        {/* English check */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 10, color: "var(--t2)", fontFamily: "var(--fu)", fontWeight: 600, letterSpacing: ".04em" }}>Eng</span>
            <CheckCell check={checks.english}/>
          </div>
        </td>

        {/* GPA check */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 10, color: "var(--t2)", fontFamily: "var(--fu)", fontWeight: 600, letterSpacing: ".04em" }}>GPA</span>
            <CheckCell check={checks.gpa}/>
          </div>
        </td>

        {/* Funds check */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 10, color: "var(--t2)", fontFamily: "var(--fu)", fontWeight: 600, letterSpacing: ".04em" }}>Funds</span>
            <CheckCell check={checks.financial}/>
          </div>
        </td>

        {/* Status */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap" }}>
          <StatusPill status={status}/>
        </td>

        {/* Score */}
        <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--bd)", textAlign: "right", whiteSpace: "nowrap" }}>
          <span className="pm-score-text">{score}%</span>
        </td>

        {/* Star shortlist */}
        <td style={{ padding: "13px 14px 13px 6px", borderBottom: "1px solid var(--bd)", textAlign: "center" }}>
          <button
            onClick={e => { e.stopPropagation(); onToggleSave && onToggleSave(match); }}
            title={isSaved ? "Remove from shortlist" : "Save to shortlist"}
            className={isSaved ? "pm-star-btn pm-star-btn--saved" : "pm-star-btn"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
              padding: isSaved ? "3px 8px" : "0",
              width: isSaved ? "auto" : 28, height: 28,
              borderRadius: isSaved ? 20 : "50%",
              border: "none", background: "transparent",
              cursor: "pointer", transition: "all 150ms",
            }}
          >
            <Star size={12} className={isSaved ? "pm-star-icon--saved" : ""} fill={isSaved ? "currentColor" : "none"} color="currentColor" strokeWidth={2}/>
            {isSaved && (
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--fh)", whiteSpace: "nowrap" }}>Saved</span>
            )}
          </button>
        </td>
      </tr>

      {modalOpen && ReactDOM.createPortal(
        <MatchDetailModal
          match={match}
          onClose={() => setModalOpen(false)}
          onCopySummary={onCopySummary}
          isSaved={isSaved}
          onToggleSave={onToggleSave}
        />,
        document.body
      )}
    </>
  );
}

/* ─── TABLE SECTION HEADER ROW ───────────────────────────────────────────── */
function SectionHeaderRow({ label, count, colSpan = 10 }) {
  const isBorderline = label.toLowerCase().startsWith("borderline");
  const labelColor = isBorderline ? "#C2410C" : "var(--t3)";
  const badgeBg    = isBorderline ? "rgba(249,115,22,.15)" : "var(--bd)";
  const badgeColor = isBorderline ? "#C2410C" : "var(--t3)";
  const rowBg      = isBorderline ? "rgba(249,115,22,.04)" : "var(--s2)";
  return (
    <tr>
      <td colSpan={colSpan} style={{
        padding: "10px 16px 6px 14px",
        borderBottom: "1px solid var(--bd)",
        background: rowBg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: ".1em", color: labelColor, fontFamily: "var(--fh)",
          }}>{label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, fontFamily: "var(--fh)",
            color: badgeColor, background: badgeBg,
            padding: "1px 7px", borderRadius: 20,
          }}>{count}</span>
        </div>
      </td>
    </tr>
  );
}

/* ─── COLUMN HEADER CELL ─────────────────────────────────────────────────── */
function TH({ children, align = "left", style: extra = {}, sortKey, sortState = {}, onSort }) {
  const isActive = sortState?.key === sortKey;
  const dir = isActive ? (sortState?.dir ?? null) : null;
  const canSort = !!sortKey && !!onSort;
  return (
    <th
      onClick={canSort ? () => onSort(sortKey) : undefined}
      style={{
        padding: "10px 12px",
        fontSize: 11, fontWeight: 700,
        color: "#fff", fontFamily: "var(--fh)",
        textAlign: align,
        textTransform: "uppercase",
        letterSpacing: ".06em",
        borderBottom: "2px solid rgba(255,255,255,.15)",
        whiteSpace: "nowrap",
        background: isActive ? "#4C1D95" : "#5B21B6",
        userSelect: "none",
        cursor: canSort ? "pointer" : "default",
        transition: "background 150ms",
        ...extra,
      }}
    >
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        {children}
        {canSort && (
          <span style={{ display:"inline-flex", flexDirection:"column", gap:1, opacity: isActive ? 1 : 0.4 }}>
            <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
              <path d="M3.5 0L7 5H0L3.5 0Z" fill={dir === "asc" ? "#fff" : "rgba(255,255,255,0.5)"}/>
            </svg>
            <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
              <path d="M3.5 5L0 0H7L3.5 5Z" fill={dir === "desc" ? "#fff" : "rgba(255,255,255,0.5)"}/>
            </svg>
          </span>
        )}
      </span>
    </th>
  );
}


/* ─── PAGINATION CONTROL ─────────────────────────────────────────────────── */
function Pagination({ page, totalPages, onPage, totalItems, pageSize }) {
  if (totalPages <= 1) return null;

  const btnStyle = (active, disabled) => ({
    minWidth: 32, height: 32, padding: "0 8px",
    borderRadius: 8, border: "1px solid",
    borderColor: active ? BRAND : "var(--bd)",
    background: active ? BRAND : "transparent",
    color: active ? "#fff" : disabled ? "var(--t3)" : "var(--t1)",
    fontFamily: "var(--fh)", fontSize: 12, fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    transition: "all 120ms",
  });

  const pages = [];
  const add = (n) => { if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n); };
  [1, 2].forEach(add);
  [page - 1, page, page + 1].forEach(add);
  [totalPages - 1, totalPages].forEach(add);
  pages.sort((a, b) => a - b);

  const items = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) items.push("...");
    items.push(pages[i]);
  }

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalItems);

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginTop:16, paddingTop:14, borderTop:"1px solid var(--bd)" }}>
      <span style={{ fontSize:11, color:"var(--t3)", fontFamily:"var(--fu)" }}>
        {from}–{to} of {totalItems} programs
      </span>
      <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap" }}>
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          style={btnStyle(false, page === 1)}
        >←</button>
        {items.map((item, i) =>
          item === "..."
            ? <span key={`ellipsis-${i}`} style={{ fontSize:12, color:"var(--t3)", padding:"0 2px" }}>…</span>
            : <button key={item} onClick={() => onPage(item)} style={btnStyle(item === page, false)}>{item}</button>
        )}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          style={btnStyle(false, page === totalPages)}
        >→</button>
      </div>
    </div>
  );
}

/* ─── MOBILE BREAKPOINT HOOK ─────────────────────────────────────────────── */
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

/* ─── PROGRAM CARD (mobile layout) ──────────────────────────────────────── */
function MatchCard({ match, isSaved, onToggleSave, onCopySummary }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { status, score, flag, country, university, ranking, program, level, duration, tuition, checks } = match;

  const statusColors = {
    eligible:   { bg: "#DCFCE7", color: "#166534", border: "#BBF7D0" },
    borderline: { bg: "#FFF7ED", color: "#9A3412", border: "#FED7AA" },
    ineligible: { bg: "#FEF2F2", color: "#991B1B", border: "#FECACA" },
  };
  const sc = statusColors[status] || statusColors.ineligible;

  const nativeISO = COUNTRY_TO_ISO[country] || "GBP";
  const sym = ISO_SYMBOL[nativeISO] || nativeISO + " ";
  let tuitionDisplay = null;
  if (tuition != null) {
    if (typeof tuition === "number") {
      tuitionDisplay = `${sym}${tuition.toLocaleString()}`;
    } else {
      tuitionDisplay = tuition;
    }
  }

  const checkIcon = (check) => {
    if (check.status === "pass")    return <span style={{ fontSize:13 }}>✅</span>;
    if (check.status === "fail")    return <span style={{ fontSize:13 }}>❌</span>;
    return <span style={{ fontSize:13, opacity:.4 }}>—</span>;
  };

  return (
    <>
      <div
        onClick={() => setModalOpen(true)}
        style={{
          border: "1px solid var(--bd)", borderRadius: 12,
          padding: "14px 14px 12px",
          background: "var(--bg)",
          cursor: "pointer",
          marginBottom: 8,
          position: "relative",
        }}
      >
        {/* Top row: program name + star */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:4 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"var(--t1)", fontFamily:"var(--fh)", lineHeight:1.3, flex:1 }}>
            {program}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onToggleSave && onToggleSave(match); }}
            style={{
              background:"transparent", border:"none", cursor:"pointer", padding:4, flexShrink:0,
              color: isSaved ? "#F59E0B" : "var(--t3)",
            }}
          >
            <Star size={16} fill={isSaved ? "currentColor" : "none"} strokeWidth={2}/>
          </button>
        </div>

        {/* University + ranking */}
        <div style={{ fontSize:12, color:"var(--t2)", fontFamily:"var(--fu)", marginBottom:8 }}>
          {university}{ranking ? ` · ${ranking}` : ""}
        </div>

        {/* Meta row: flag+country, level, duration, tuition */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 12px", marginBottom:10, fontSize:11, color:"var(--t2)", fontFamily:"var(--fu)" }}>
          <span>{flag} {country}</span>
          {level && <span style={{ background:"rgba(91,33,182,.1)", color:BRAND, fontWeight:600, padding:"1px 7px", borderRadius:20, fontSize:10 }}>{level}</span>}
          {duration && <span style={{ color:"var(--t3)" }}>{duration}</span>}
          {tuitionDisplay && <span style={{ fontWeight:700, color:"var(--t1)", fontFamily:"var(--fh)" }}>{tuitionDisplay}</span>}
        </div>

        {/* Checks row */}
        <div style={{ display:"flex", gap:16, marginBottom:10, alignItems:"center" }}>
          {[
            { label:"English", check: checks.english },
            { label:"GPA",     check: checks.gpa },
            { label:"Funds",   check: checks.financial },
          ].map(({ label, check }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:4 }}>
              {checkIcon(check)}
              <span style={{ fontSize:11, color:"var(--t2)", fontFamily:"var(--fu)" }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Status + score */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{
            fontSize:11, fontWeight:700, fontFamily:"var(--fh)",
            color: sc.color, background: sc.bg, border:`1px solid ${sc.border}`,
            padding:"3px 10px", borderRadius:20, textTransform:"capitalize",
          }}>
            {status}
          </span>
          <span style={{ fontSize:13, fontWeight:800, color: BRAND, fontFamily:"var(--fh)" }}>
            {score}%
          </span>
        </div>
      </div>

      {modalOpen && ReactDOM.createPortal(
        <MatchDetailModal
          match={match}
          onClose={() => setModalOpen(false)}
          onCopySummary={onCopySummary}
          isSaved={isSaved}
          onToggleSave={onToggleSave}
        />,
        document.body
      )}
    </>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────────── */
export default function ProgramMatcher({ profile, requirementsData, preferredOfferIndex, onCreditsUpdate, activeStudentId }) {
  const isMobile = useIsMobile(900);
  const [wiOverride, setWiOverride] = useState({ ielts: null, gpa: null, funds: null });
  const [wiModalOpen, setWiModalOpen] = useState(false);
  const wiActive = wiOverride.ielts !== null || wiOverride.gpa !== null || wiOverride.funds !== null;

  function matchKey(m) { return `${m.university}||${m.program}`; }

  const studentStorageKey = useMemo(() => {
    const id = profile?.passportNumber && profile.passportNumber !== "Not found"
      ? profile.passportNumber
      : (profile?.fullName || "unknown");
    return `visalens_shortlist_${id.replace(/\s+/g, "_").toLowerCase()}`;
  }, [profile?.passportNumber, profile?.fullName]);

  const [savedKeys, setSavedKeys] = useState(new Set());
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [existingTargets, setExistingTargets] = useState([]);

  const loadedKeysRef = useRef(null);

  useEffect(() => {
    if (!studentStorageKey) return;
    loadedKeysRef.current = null;
    setSavedKeys(new Set());
    const sb = _supabase();
    const org = _getOrgSession();
    if (!sb || !org?.org_id) {
      try {
        const raw = localStorage.getItem(studentStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        loadedKeysRef.current = JSON.stringify([...parsed].sort());
        setSavedKeys(new Set(parsed));
      } catch {
        loadedKeysRef.current = "[]";
        setSavedKeys(new Set());
      }
      return;
    }
    setShortlistLoading(true);
    sb.from("student_shortlists")
      .select("match_keys")
      .eq("org_id", org.org_id)
      .eq("student_key", studentStorageKey)
      .maybeSingle()
      .then(({ data, error }) => {
        const keys = (!error && Array.isArray(data?.match_keys) && data.match_keys.length > 0)
          ? data.match_keys : [];
        loadedKeysRef.current = JSON.stringify([...keys].sort());
        setSavedKeys(new Set(keys));
        setShortlistLoading(false);
      });
  }, [studentStorageKey]);

  useEffect(() => {
    const sb = _supabase();
    const org = _getOrgSession();
    if (!sb || !org?.org_id || !activeStudentId) { setExistingTargets([]); return; }
    sb.from('cases')
      .select('application_targets')
      .eq('id', activeStudentId)
      .eq('org_id', org.org_id)
      .maybeSingle()
      .then(({ data }) => {
        const t = Array.isArray(data?.application_targets) ? data.application_targets : [];
        setExistingTargets(t);
      });
  }, [activeStudentId]);

  useEffect(() => {
    if (loadedKeysRef.current === null) return; 
    const keysArray = [...savedKeys];
    const serialised = JSON.stringify(keysArray.slice().sort());
    if (serialised === loadedKeysRef.current) return;
    try { localStorage.setItem(studentStorageKey, JSON.stringify(keysArray)); } catch { }
    const sb = _supabase();
    const org = _getOrgSession();
    if (!sb || !org?.org_id) return;
    sb.from("student_shortlists")
      .upsert(
        { org_id: org.org_id, student_key: studentStorageKey, match_keys: keysArray, updated_at: new Date().toISOString() },
        { onConflict: "org_id,student_key" }
      ).then();
  }, [savedKeys, studentStorageKey]);

  const [showShortlist, setShowShortlist] = useState(false);

  async function toggleSave(m) {
    const k = matchKey(m);
    const nextTargets = (() => {
      const remove = (arr) => arr.filter(t => !((t?.university || t?.institution) === m.university && t?.program === m.program));
      const exists = existingTargets.some(t => ((t?.university || t?.institution) === m.university && t?.program === m.program));
      if (exists) return remove(existingTargets);
      const record = {
        university: m.university,
        program: m.program,
        country: m.country,
        level: m.level,
        status: m.offerMatch ? 'Offer' : 'Saved',
        has_offer: !!m.offerMatch,
        offer_letter: !!m.offerMatch,
        saved_at: new Date().toISOString(),
      };
      return [...existingTargets, record];
    })();

    setSavedKeys(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
    setExistingTargets(nextTargets);

    const sb = _supabase();
    const org = _getOrgSession();
    if (sb && org?.org_id && activeStudentId) {
      const ts = new Date().toISOString();
      const { error } = await sb.from('cases')
        .update({
          application_targets: nextTargets,
          updated_at: ts,
        })
        .eq('id', activeStudentId)
        .eq('org_id', org.org_id);
      if (error) console.warn('[ProgramMatcher] application_targets save error:', error.message || error);
    }
  }

  const [filterCountry, setFilterCountry] = useState("");
  const [filterLevel,   setFilterLevel]   = useState("");
  const [filterStatus,  setFilterStatus]  = useState("eligible+borderline");
  const [search,        setSearch]        = useState("");
  const [copiedId,      setCopiedId]      = useState(null);
  const [sortState,     setSortState]     = useState({ key: "score", dir: "desc" });
  const [page,          setPage]          = useState(1);
  const PAGE_SIZE = 25;

  const topRef = useRef(null);
  useEffect(() => {
    topRef.current?.closest(".main")?.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const handleRunMatch = useCallback(() => {
    setSearch("");
    setFilterCountry("");
    setFilterLevel("");
    setFilterStatus("eligible+borderline");
    setShowShortlist(false);
  }, []);

  useEffect(() => {
    if (profile?.student_name || profile?.fullName) {
      handleRunMatch();
    }
  }, [profile?.id, handleRunMatch]);

  function handleSort(key) {
    setSortState(prev =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "score" ? "desc" : "asc" }
    );
  }

  // To cleanly present the funds in the header box when filtered
  const viewISO = filterCountry ? COUNTRY_TO_ISO[filterCountry] : null;

  const matchList = useMemo(() => {
    if (!profile || !requirementsData) return [];
    return buildMatchList(profile, requirementsData, preferredOfferIndex, wiOverride);
  }, [profile, requirementsData, preferredOfferIndex, wiOverride]);

  const countEligible   = matchList.filter(m => m.status === "eligible").length;
  const countBorderline = matchList.filter(m => m.status === "borderline").length;
  const countIneligible = matchList.filter(m => m.status === "ineligible").length;
  const savedMatches    = matchList.filter(m => savedKeys.has(matchKey(m)));
  const countries       = useMemo(() => [...new Set(matchList.map(m => m.country))].sort(), [matchList]);

  const visible = useMemo(() => {
    const filtered = matchList.filter(m => {
      if (filterCountry && m.country !== filterCountry) return false;
      if (filterLevel) {
        const lvl = (m.level || "").toLowerCase();
        const fil = filterLevel.toLowerCase();
        const LEVEL_ALIASES = {
          "pathways/foundation": ["pathway", "foundation", "pre-university", "diploma"],
          "undergraduate":       ["undergraduate", "bachelor", "ba ", "bsc", "b.sc", "beng", "b.eng", "ug"],
          "masters":             ["master", "postgraduate", "msc", "m.sc", "mba", "meng", "m.eng", "pg", "graduate"],
          "doctorate":           ["doctor", "phd", "ph.d", "doctoral", "dba"],
        };
        const aliases = LEVEL_ALIASES[fil] || [fil];
        const matched = aliases.some(a => lvl.includes(a)) || lvl === fil;
        if (!matched) return false;
      }
      if (filterStatus === "eligible+borderline" && m.status === "ineligible") return false;
      if (filterStatus === "eligible"   && m.status !== "eligible")   return false;
      if (filterStatus === "borderline" && m.status !== "borderline") return false;
      if (search) {
        const q = search.toLowerCase();
        if (!m.program.toLowerCase().includes(q) &&
            !m.university.toLowerCase().includes(q) &&
            !m.country.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const { key, dir } = sortState;
    const mult = dir === "asc" ? 1 : -1;
    const SORT_FNS = {
      program:   (a, b) => (a.program   || "").localeCompare(b.program   || ""),
      country:   (a, b) => (a.country   || "").localeCompare(b.country   || ""),
      level:     (a, b) => (a.level     || "").localeCompare(b.level     || ""),
      tuition:   (a, b) => ((a.tuition  ?? -1) - (b.tuition  ?? -1)),
      english:   (a, b) => ((a.checks?.english?.have  ?? -1) - (b.checks?.english?.have  ?? -1)),
      gpa:       (a, b) => ((a.checks?.gpa?.have       ?? -1) - (b.checks?.gpa?.have       ?? -1)),
      funds:     (a, b) => ((a.checks?.financial?.have ?? -1) - (b.checks?.financial?.have ?? -1)),
      status:    (a, b) => {
        const ORDER = { eligible: 0, borderline: 1, ineligible: 2 };
        return (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3);
      },
      score:     (a, b) => (a.score - b.score),
    };
    const fn = SORT_FNS[key];
    return fn ? [...filtered].sort((a, b) => fn(a, b) * mult) : filtered;
  }, [matchList, filterCountry, filterLevel, filterStatus, search, sortState]);

  useEffect(() => { setPage(1); }, [filterCountry, filterLevel, filterStatus, search, sortState]);

  const totalPages  = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const pageStart   = (safePage - 1) * PAGE_SIZE;
  const paged       = visible.slice(pageStart, pageStart + PAGE_SIZE);

  const offerMatches = paged.filter(m => m.offerMatch);
  const eligible     = paged.filter(m => !m.offerMatch && m.status === "eligible");
  const borderlines  = paged.filter(m => !m.offerMatch && m.status === "borderline");
  const ineligible   = paged.filter(m => m.status === "ineligible");

  function copySummary(match) {
    const key = `${match.university}-${match.program}`;
    const studentName = profile?.fullName || "Student";
    const lines = [
      `VisaLens Program Match — ${studentName}`,
      `Program: ${match.program}`,
      `University: ${match.university}${match.ranking ? ` (${match.ranking})` : ""}`,
      `Country: ${match.country} · Level: ${match.level} · Duration: ${match.duration}`,
      match.tuition ? `Tuition: ${match.tuition.toLocaleString()}` : null,
      `Match Score: ${match.score}% — ${match.status.charAt(0).toUpperCase() + match.status.slice(1)}`,
      match.offerMatch ? `Offer Letter: ${match.offerStatus}` : null,
      ``,
      `Eligibility checks:`,
      `  English: ${match.checks.english.label} [${match.checks.english.status}]`,
      `  GPA:     ${match.checks.gpa.label} [${match.checks.gpa.status}]`,
      `  Funds:   ${match.checks.financial.label} [${match.checks.financial.status}]`,
      match.gaps.length ? `\nGaps to close:\n${match.gaps.map(g => `  • ${g}`).join("\n")}` : null,
      ``,
      `Generated by VisaLens · ${new Date().toLocaleDateString('en-GB')}`,
    ].filter(l => l !== null).join("\n");
    navigator.clipboard.writeText(lines);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const hasProfile = profile && profile.fullName && profile.fullName !== "Not found";
  if (!hasProfile) {
    return (
      <div style={{textAlign:"center",padding:"4rem 1rem",color:"var(--t3)"}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:"var(--s2)",border:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
          <Target size={24} color="var(--t3)"/>
        </div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t2)",fontFamily:"var(--fh)",marginBottom:6}}>No student profile loaded</div>
        <div style={{fontSize:13,color:"var(--t3)",fontFamily:"var(--fu)"}}>
          Upload and analyse a student's documents first, then return here to match against university programs.
        </div>
      </div>
    );
  }

  const actualIelts    = bestIeltsEquiv(profile);
  const actualGpa      = _parseGPA(profile?.academicResult);

  const selStyle = {
    fontSize:12, padding:"6px 10px", height:32, borderRadius:8,
    border:"1px solid var(--bd)", background:"var(--s1)", color:"var(--t1)",
    fontFamily:"var(--fu)", outline:"none", cursor:"pointer",
  };

  return (
    <>
      <div ref={topRef} style={{ position:"absolute", top:0, pointerEvents:"none", height:0 }}/>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 340px", gap:20, alignItems:"start" }}>

        {/* ── LEFT: Table ── */}
        <div>

          {/* ── Profile header box ── */}
          <div style={{
            marginBottom: 16,
            background: "var(--s1)", border: "1px solid var(--bd)", borderRadius: 12,
            overflow: "hidden",
          }}>
            {/* Top row: avatar + name + stats */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
              padding: "14px 18px",
              borderBottom: "1px solid var(--bd)",
            }}>
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: BRAND, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, fontFamily: "var(--fh)", flexShrink: 0,
              }}>
                {(profile.fullName || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase()}
              </div>

              {/* Name */}
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--fh)", lineHeight: 1.2 }}>
                  {profile.fullName}
                </div>
                <div style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--fu)", marginTop: 2 }}>
                  {matchList.length} programs scanned
                </div>
              </div>

              {/* Stat counts — Total first */}
              <div style={{ display: "flex", gap: 0, borderLeft: "1px solid var(--bd)", paddingLeft: 14 }}>
                {[
                  { n: matchList.length,  label: "Total",      c: "var(--t1)" },
                  { n: countEligible,     label: "Eligible",   c: "#16A34A"   },
                  { n: countBorderline,   label: "Borderline", c: "#F97316"   },
                  { n: countIneligible,   label: "Ineligible", c: "var(--t3)" },
                ].map((s, i, arr) => (
                  <div key={s.label} style={{ textAlign: "center", padding: "0 12px", borderRight: i < arr.length - 1 ? "1px solid var(--bd)" : "none" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.c, fontFamily: "var(--fh)", lineHeight: 1 }}>{s.n}</div>
                    <div style={{ fontSize: 10, color: "var(--t3)", fontFamily: "var(--fu)", fontWeight: 600, marginTop: 2, textTransform: "uppercase", letterSpacing: ".04em" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Middle row: English · CGPA · Funds · Offer letters */}
            <div style={{
              display: "flex", alignItems: "stretch", gap: 0,
              flexWrap: "wrap",
              borderBottom: "1px solid var(--bd)",
            }}>
              {/* English */}
              <div style={{ padding: "10px 18px", borderRight: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--t3)", fontFamily: "var(--fh)" }}>English Proficiency</span>
                {englishLabel(profile)
                  ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", fontFamily: "var(--fu)" }}>
                      {englishLabel(profile)}
                      {wiOverride.ielts !== null && <span style={{ color: BRAND, marginLeft: 5, fontSize: 11 }}>→ sim {wiOverride.ielts}</span>}
                    </span>
                  : <span style={{ fontSize: 11, color: "#F97316", fontFamily: "var(--fu)", fontStyle: "italic" }}>⚠ Not on file</span>
                }
              </div>
              {/* CGPA */}
              <div style={{ padding: "10px 18px", borderRight: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--t3)", fontFamily: "var(--fh)" }}>CGPA</span>
                {actualGpa !== null
                  ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", fontFamily: "var(--fu)" }}>
                      {actualGpa.toFixed(2)}
                      {wiOverride.gpa !== null && <span style={{ color: BRAND, marginLeft: 5, fontSize: 11 }}>→ sim {wiOverride.gpa}</span>}
                    </span>
                  : <span style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--fu)", fontStyle: "italic" }}>Not found</span>
                }
              </div>
              {/* Funds */}
              {(() => {
                const { amount: rawAmt, currency: rawISO } = _parseCurrencyAmount(
                  wiOverride.funds !== null ? String(wiOverride.funds) : (profile.financialBalance || "")
                );
                const fromISO = wiOverride.funds !== null ? "GBP" : rawISO;
                
                let displayAmt = rawAmt;
                let displayISO = fromISO;
                if (rawAmt !== null && fromISO && viewISO && fromISO !== viewISO) {
                  const rFrom = CURRENCY_TO_GBP[fromISO];
                  const rTo   = CURRENCY_TO_GBP[viewISO];
                  if (rFrom && rTo) { displayAmt = Math.round(rawAmt * rFrom / rTo); displayISO = viewISO; }
                } else if (viewISO) {
                  displayISO = viewISO;
                }
                const sym = displayISO ? (ISO_SYMBOL[displayISO] || displayISO + " ") : "";
                const isConverted = fromISO && displayISO && fromISO !== displayISO;
                return (
                  <div style={{ padding: "10px 18px", borderRight: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--t3)", fontFamily: "var(--fh)" }}>
                      Funds {viewISO && <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, opacity: .7 }}>· in {viewISO}</span>}
                    </span>
                    {rawAmt !== null ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {isConverted && (
                          <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "var(--fu)", fontStyle: "italic" }}>
                            {profile.financialBalance}{wiOverride.funds !== null ? ` → sim ${wiOverride.funds.toLocaleString()}` : ""}
                          </span>
                        )}
                        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--t1)", fontFamily: "var(--fh)", letterSpacing: "-.01em" }}>
                          {isConverted && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--t2)", fontFamily: "var(--fu)", marginRight: 3, verticalAlign: "middle" }}>approx.</span>}
                          {sym}{displayAmt !== null ? displayAmt.toLocaleString() : "—"}
                          {!isConverted && wiOverride.funds !== null && <span style={{ color: BRAND, marginLeft: 5, fontSize: 11 }}>sim</span>}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--fu)", fontStyle: "italic" }}>Not found</span>
                    )}
                  </div>
                );
              })()}
              {/* Offer letters */}
              {Array.isArray(profile.offerLetters) && profile.offerLetters.length > 0 && (
                <div style={{ padding: "10px 18px", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--t3)", fontFamily: "var(--fh)" }}>Offer Letters</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {profile.offerLetters.map((o, i) => o.university && o.university !== "Not found" ? (
                      <span key={i} className="pm-offer-pill">
                        <Star size={9} className="pm-offer-pill-icon"/> {o.university}{o.status && o.status !== "Not found" ? ` · ${o.status}` : ""}
                      </span>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom row: Simulate Offer button */}
            <div style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setWiModalOpen(true)}
                style={{
                  display:"flex", alignItems:"center", gap:6, fontSize:12, fontWeight:700,
                  padding:"7px 16px", borderRadius:8, cursor:"pointer", fontFamily:"var(--fh)",
                  flexShrink: 0, transition:"all 150ms",
                  background: BRAND,
                  border: `1px solid ${BRAND}`,
                  color: "#fff",
                }}
              >
                {wiActive ? <><Check size={12}/> Simulation on</> : <>✦ Simulate Offer</>}
              </button>
              {wiActive && (
                <button
                  onClick={() => setWiOverride({ ielts: null, gpa: null, funds: null })}
                  style={{ background:"transparent", border:"none", color:"var(--t3)", cursor:"pointer", fontSize:11, fontFamily:"var(--fu)", padding:"0 2px", display:"flex", alignItems:"center", gap:3 }}
                >
                  <X size={10}/> Clear simulation
                </button>
              )}
            </div>
          </div>

          {/* ── Shortlist panel ── */}
          {(savedKeys.size > 0 || shortlistLoading) && (
            <div className="pm-shortlist-panel" style={{ marginBottom:14, borderRadius:10, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", cursor:"pointer" }} onClick={() => setShowShortlist(v => !v)}>
                <Star size={13} className="pm-shortlist-star"/>
                <span className="pm-shortlist-title" style={{ flex:1, fontSize:12, fontWeight:700, fontFamily:"var(--fh)", display:"flex", alignItems:"center", gap:6 }}>
                  Shortlist — {shortlistLoading ? "loading…" : `${savedKeys.size} program${savedKeys.size !== 1 ? "s" : ""} saved`}
                  {shortlistLoading && <Loader2 size={11} style={{ animation:"spin 1s linear infinite", opacity:.6 }}/>}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); setSavedKeys(new Set()); }}
                  style={{ background:"transparent", border:"none", fontSize:10, color:"var(--t3)", cursor:"pointer", fontFamily:"var(--fu)" }}
                >
                  Clear all
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const studentName = profile?.fullName || "Student";
                    const lines = [`VisaLens Shortlist — ${studentName}`, `Generated: ${new Date().toLocaleDateString('en-GB')}`, ``];
                    savedMatches.forEach((m, i) => {
                      lines.push(`${i+1}. ${m.program}`);
                      lines.push(`   University: ${m.university} · ${m.country}`);
                      lines.push(`   Level: ${m.level} · Score: ${m.score}% (${m.status})`);
                      if (m.tuition) lines.push(`   Tuition: ${m.tuition.toLocaleString()}`);
                      lines.push(``);
                    });
                    navigator.clipboard.writeText(lines.join("\n"));
                  }}
                  style={{ background:"transparent", border:"none", fontSize:10, color:"var(--t3)", cursor:"pointer", fontFamily:"var(--fu)", display:"flex", alignItems:"center", gap:3 }}
                >
                  <Copy size={10}/> Copy
                </button>
                <ChevronDown size={13} className="pm-shortlist-chevron" style={{ transform: showShortlist ? "rotate(180deg)" : "none", transition:"transform 200ms" }}/>
              </div>
              {showShortlist && savedMatches.length > 0 && (
                <div className="pm-shortlist-body" style={{ overflowX: isMobile ? "visible" : "auto", padding: isMobile ? "8px 0 0" : 0 }}>
                  {isMobile
                    ? savedMatches.map((m, i) => (
                        <MatchCard key={`sl-${i}`} match={m} isSaved={true} onToggleSave={toggleSave} onCopySummary={copySummary} />
                      ))
                    : <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <tbody>
                          {savedMatches.map((m, i) => (
                            <MatchRow key={`sl-${i}`} match={m} isSaved={true} onToggleSave={toggleSave} onCopySummary={copySummary} />
                          ))}
                        </tbody>
                      </table>
                  }
                </div>
              )}
            </div>
          )}

          {/* ── Filters row ── */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12, alignItems:"center", flexDirection: isMobile ? "column" : "row" }}>
            <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} style={selStyle}>
              <option value="">All countries</option>
              {countries.map(c => {
                const el = matchList.filter(m => m.country === c && m.status === "eligible").length;
                const bl = matchList.filter(m => m.country === c && m.status === "borderline").length;
                const il = matchList.filter(m => m.country === c && m.status === "ineligible").length;
                const flag = requirementsData[c]?.flag || "";
                const label = el + bl > 0
                  ? `${flag} ${c} · ${el + bl} eligible/borderline${il > 0 ? ` · ${il} ineligible` : ""}`
                  : `${flag} ${c} · ${il} ineligible only`;
                return <option key={c} value={c}>{label}</option>;
              })}
            </select>
            <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} style={selStyle}>
              <option value="">All levels</option>
              <option value="Pathways/Foundation">Pathways/Foundation</option>
              <option value="Undergraduate">Undergraduate</option>
              <option value="Masters">Masters</option>
              <option value="Doctorate">Doctorate</option>
              <option value="Foundation">Foundation</option>
              <option value="Postgraduate">Postgraduate</option>
              <option value="Graduate">Graduate</option>
              <option value="Doctoral">Doctoral</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
              <option value="eligible+borderline">Eligible + Borderline</option>
              <option value="eligible">Eligible only</option>
              <option value="borderline">Borderline only</option>
              <option value="all">Show all incl. ineligible</option>
            </select>

            {/* Search */}
            <div style={{ flex:1, minWidth:160, position:"relative", display:"flex", alignItems:"center" }}>
              <Search size={13} color="var(--t3)" style={{ position:"absolute", left:9, flexShrink:0, pointerEvents:"none" }}/>
              <input
                type="text"
                placeholder="Search program or university…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...selStyle, width:"100%", paddingLeft:28 }}
                onFocus={e  => e.target.style.borderColor = BRAND}
                onBlur={e   => e.target.style.borderColor = "var(--bd)"}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ position:"absolute", right:7, background:"transparent", border:"none", cursor:"pointer", color:"var(--t3)", padding:0, display:"flex", alignItems:"center" }}>
                  <X size={12}/>
                </button>
              )}
            </div>

            <span style={{ fontSize:11, color:"var(--t3)", fontFamily:"var(--fm)", marginLeft:4, whiteSpace:"nowrap" }}>
              {visible.length} programs
              {filterStatus !== "all" && countIneligible > 0 && ` · ${countIneligible} hidden`}
            </span>
          </div>

          {/* ── Table ── */}
          {(() => {
            const hiddenByStatus = filterStatus !== "all"
              ? matchList.filter(m => {
                  if (filterCountry && m.country !== filterCountry) return false;
                  if (filterLevel) {
                    const lvl = (m.level || "").toLowerCase();
                    const fil = filterLevel.toLowerCase();
                    const LEVEL_ALIASES = {
                      "pathways/foundation": ["pathway","foundation","pre-university","diploma"],
                      "undergraduate":       ["undergraduate","bachelor","ba ","bsc","b.sc","beng","b.eng","ug"],
                      "masters":             ["master","postgraduate","msc","m.sc","mba","meng","m.eng","pg","graduate"],
                      "doctorate":           ["doctor","phd","ph.d","doctoral","dba"],
                    };
                    const aliases = LEVEL_ALIASES[fil] || [fil];
                    if (!aliases.some(a => lvl.includes(a)) && lvl !== fil) return false;
                  }
                  if (search) {
                    const q = search.toLowerCase();
                    if (!m.program.toLowerCase().includes(q) && !m.university.toLowerCase().includes(q) && !m.country.toLowerCase().includes(q)) return false;
                  }
                  return m.status === "ineligible";
                }).length
              : 0;
            const isStatusBlocking = visible.length === 0 && hiddenByStatus > 0;
            const countryLabel = filterCountry || "the current selection";
            if (isStatusBlocking) return (
              <div style={{ padding:"3rem 1.5rem", textAlign:"center", border:"1px solid var(--bd)", borderRadius:12, background:"var(--s1)" }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"rgba(249,115,22,.1)", border:"1px solid rgba(249,115,22,.25)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
                  <TriangleAlert size={20} color="#F97316"/>
                </div>
                <div style={{ fontSize:14, fontWeight:700, color:"var(--t1)", fontFamily:"var(--fh)", marginBottom:6 }}>
                  {hiddenByStatus} program{hiddenByStatus !== 1 ? "s" : ""} found for {countryLabel} — all hidden by status filter
                </div>
                <div style={{ fontSize:12, color:"var(--t3)", fontFamily:"var(--fu)", maxWidth:340, margin:"0 auto 18px" }}>
                  The student doesn't currently meet the eligibility threshold for {filterCountry ? `any ${countryLabel}` : "these"} programs.
                  You can still review them to identify which gaps are closest to closing.
                </div>
                <button
                  onClick={() => setFilterStatus("all")}
                  style={{ background:BRAND, color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:12, fontWeight:700, fontFamily:"var(--fh)", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 }}
                >
                  <RefreshCw size={12}/> Show all {hiddenByStatus} programs
                </button>
              </div>
            );
            if (visible.length === 0) return (
              <div style={{ padding:"3rem 1rem", textAlign:"center", color:"var(--t3)", border:"1px solid var(--bd)", borderRadius:12 }}>
                <Search size={22} style={{ margin:"0 auto 10px", opacity:.4, display:"block" }}/>
                <div style={{ fontSize:14, fontWeight:600, color:"var(--t2)", fontFamily:"var(--fh)", marginBottom:4 }}>No programs match</div>
                <div style={{ fontSize:12, fontFamily:"var(--fu)" }}>Try broadening the filters or clearing the search.</div>
              </div>
            );
            /* ── Mobile: card list ── */
            if (isMobile) {
              const renderCards = (list) => list.map((m, i) => (
                <MatchCard key={i} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
              ));
              const isDefaultSort = sortState.key === "score" && sortState.dir === "desc";
              return (
                <div>
                  {/* Sort pills for mobile */}
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                    {[["score","Score"],["program","Program"],["tuition","Tuition"],["status","Status"]].map(([key, label]) => {
                      const active = sortState.key === key;
                      return (
                        <button key={key} onClick={() => handleSort(key)} style={{
                          fontSize:11, fontWeight:700, fontFamily:"var(--fh)",
                          padding:"4px 10px", borderRadius:20, border:"1px solid",
                          borderColor: active ? BRAND : "var(--bd)",
                          background: active ? BRAND : "transparent",
                          color: active ? "#fff" : "var(--t2)",
                          cursor:"pointer",
                        }}>
                          {label} {active ? (sortState.dir === "desc" ? "↓" : "↑") : ""}
                        </button>
                      );
                    })}
                  </div>
                  {!isDefaultSort
                    ? renderCards(paged)
                    : <>
                        {offerMatches.length > 0 && renderCards(offerMatches)}
                        {eligible.length > 0 && (
                          <>
                            <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".1em", fontFamily:"var(--fh)", padding:"8px 2px 4px" }}>
                              Fully eligible · {eligible.length}
                            </div>
                            {renderCards(eligible)}
                          </>
                        )}
                        {borderlines.length > 0 && (
                          <>
                            <div style={{ fontSize:10, fontWeight:700, color:"#C2410C", textTransform:"uppercase", letterSpacing:".1em", fontFamily:"var(--fh)", padding:"8px 2px 4px" }}>
                              Borderline · {borderlines.length}
                            </div>
                            {renderCards(borderlines)}
                          </>
                        )}
                        {ineligible.length > 0 && filterStatus === "all" && (
                          <>
                            <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".1em", fontFamily:"var(--fh)", padding:"8px 2px 4px" }}>
                              Ineligible · {ineligible.length}
                            </div>
                            {renderCards(ineligible)}
                          </>
                        )}
                      </>
                  }
                </div>
              );
            }

            /* ── Desktop: table ── */
            return (
            <div style={{ border:"1px solid var(--bd)", borderRadius:12, overflow:"hidden", overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                <colgroup>
                  <col style={{width:"25%"}}/>
                  <col style={{width:"10%"}}/>
                  <col style={{width:"10%"}}/>
                  <col style={{width:"10%"}}/>
                  <col style={{width:"6%"}}/>
                  <col style={{width:"6%"}}/>
                  <col style={{width:"6%"}}/>
                  <col style={{width:"11%"}}/>
                  <col style={{width:"6%"}}/>
                  <col style={{width:"5%"}}/>
                </colgroup>
                <thead>
                  <tr>
                    <TH extra={{paddingLeft:14}} sortKey="program" sortState={sortState} onSort={handleSort}>Program</TH>
                    <TH sortKey="country" sortState={sortState} onSort={handleSort}>Country</TH>
                    <TH sortKey="level"   sortState={sortState} onSort={handleSort}>Level</TH>
                    <TH sortKey="tuition" sortState={sortState} onSort={handleSort}>Tuition</TH>
                    <TH align="center" sortKey="english" sortState={sortState} onSort={handleSort}>English</TH>
                    <TH align="center" sortKey="gpa"     sortState={sortState} onSort={handleSort}>GPA</TH>
                    <TH align="center" sortKey="funds"   sortState={sortState} onSort={handleSort}>Funds</TH>
                    <TH sortKey="status" sortState={sortState} onSort={handleSort}>Status</TH>
                    <TH align="right" sortKey="score" sortState={sortState} onSort={handleSort}>Score</TH>
                    <TH align="center"></TH>
                  </tr>
                </thead>
                <tbody>
                  {sortState.key !== "score" || sortState.dir !== "desc"
                    /* ── Custom sort active: flat list, no section headers ── */
                    ? visible.map((m, i) => (
                        <MatchRow key={`sort-${i}`} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
                      ))
                    /* ── Default sort: grouped by status ── */
                    : <>
                        {offerMatches.length > 0 && (
                          <>
                            {offerMatches.map((m, i) => (
                              <MatchRow key={`offer-${i}`} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
                            ))}
                          </>
                        )}
                        {eligible.length > 0 && (
                          <>
                            <SectionHeaderRow label="Fully eligible" count={eligible.length}/>
                            {eligible.map((m, i) => (
                              <MatchRow key={`el-${i}`} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
                            ))}
                          </>
                        )}
                        {borderlines.length > 0 && (
                          <>
                            <SectionHeaderRow label="Borderline — 1–2 gaps to close" count={borderlines.length}/>
                            {borderlines.map((m, i) => (
                              <MatchRow key={`bl-${i}`} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
                            ))}
                          </>
                        )}
                        {ineligible.length > 0 && filterStatus === "all" && (
                          <>
                            <SectionHeaderRow label="Ineligible" count={ineligible.length}/>
                            {ineligible.map((m, i) => (
                              <MatchRow key={`in-${i}`} match={m} isSaved={savedKeys.has(matchKey(m))} onToggleSave={toggleSave} onCopySummary={copySummary} />
                            ))}
                          </>
                        )}
                      </>
                  }
                </tbody>
              </table>
            </div>
            );
          })()}
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPage={p => { setPage(p); topRef.current?.closest(".main")?.scrollTo({ top: 0, behavior: "smooth" }); }}
            totalItems={visible.length}
            pageSize={PAGE_SIZE}
          />
        </div>

        {/* ── RIGHT: Chat panel ── */}
        <div style={{ position:"sticky", top:16 }}>
          <MatchChatPanel
            profile={profile}
            requirementsData={requirementsData}
            matchList={matchList}
            wiOverride={wiOverride}
            onCreditsUpdate={onCreditsUpdate}
            studentStorageKey={studentStorageKey}
          />
        </div>
      </div>

      {/* What-if modal */}
      {wiModalOpen && (
        <WhatIfModal
          profile={profile}
          wiOverride={wiOverride}
          onChange={setWiOverride}
          onClose={() => setWiModalOpen(false)}
        />
      )}
    </>
  );
}