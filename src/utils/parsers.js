// ── src/utils/parsers.js ──────────────────────────────────────────────────────
// Data parsers: CSV ingestion, GPA, IELTS, financial amounts, currency.
// Extracted from App.jsx (Phase 1).
// Depends on: src/constants/countries.js (getCountryMeta, UNIVERSITY_DATA)
// -----------------------------------------------------------------------------

import { getCountryMeta, UNIVERSITY_DATA } from '../constants/countries';

// ── Simple value parsers ──────────────────────────────────────────────────────

export function parseGPA(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

export function parseIELTS(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

export function parseFinancial(str) {
  if (!str || str === "Not found") return null;
  const m = str.replace(/,/g, "").match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

// ── Currency parser ───────────────────────────────────────────────────────────
// Returns { amount: number|null, currency: string|null }
// Handles: £12,000  GBP 12,000  PKR 5,495,000  5.000.000 EUR  $18,000  Rs 500,000
export function parseCurrencyAmount(str) {
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
  ];

  let currency = null;
  for (const { re, iso } of SYMBOL_MAP) {
    if (re.test(s)) { currency = iso; break; }
  }

  const numStr = s.replace(/[^0-9.,]/g, "").trim();
  if (!numStr) return { amount: null, currency };

  const lastDot   = numStr.lastIndexOf(".");
  const lastComma = numStr.lastIndexOf(",");
  let normalised  = numStr;

  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      // European: 1.234.567,00 → remove dots, replace comma with dot
      normalised = numStr.replace(/\./g, "").replace(",", ".");
    } else {
      // UK/US: 1,234,567.00 → remove commas
      normalised = numStr.replace(/,/g, "");
    }
  } else if (lastComma > -1 && lastDot === -1) {
    const afterComma = numStr.slice(lastComma + 1);
    normalised = afterComma.length === 3
      ? numStr.replace(/,/g, "")
      : numStr.replace(",", ".");
  } else if (lastDot > -1 && lastComma === -1) {
    const afterDot = numStr.slice(lastDot + 1);
    normalised = afterDot.length === 3 && numStr.replace(/[^.]/g, "").length > 1
      ? numStr.replace(/\./g, "")
      : numStr;
  }

  const amount = parseFloat(normalised);
  return { amount: isNaN(amount) ? null : amount, currency };
}

// ── Token estimators ──────────────────────────────────────────────────────────

export function estimateTokens(docs) {
  const SYSTEM_TOKENS = 2500;
  let docTokens = 0;
  for (const doc of docs) {
    if (doc.tooLarge) continue;
    const type = doc.file.type;
    if (type === 'application/pdf') {
      const approxPages = Math.max(1, Math.round(doc.file.size / (200 * 1024)));
      docTokens += approxPages * 1800;
    } else if (type.startsWith('image/')) {
      docTokens += 1100;
    } else {
      docTokens += Math.round(doc.file.size / 4);
    }
  }
  return SYSTEM_TOKENS + docTokens;
}

export function tokenTierClient(tokens) {
  if (tokens <= 20000) return 1;
  if (tokens <= 40000) return 2;
  return 2 + Math.ceil((tokens - 40000) / 20000);
}

export function estimateTokensIfConverted(docs) {
  const SYSTEM_TOKENS = 2500;
  let docTokens = 0;
  for (const doc of docs) {
    if (doc.tooLarge) continue;
    const type = doc.file.type;
    if (type === 'application/pdf' && !doc._convertedFromPdf) {
      const approxPages = Math.max(1, Math.round(doc.file.size / (200 * 1024)));
      docTokens += approxPages * 1100;
    } else if (type.startsWith('image/')) {
      docTokens += 1100;
    } else {
      docTokens += Math.round(doc.file.size / 4);
    }
  }
  return SYSTEM_TOKENS + docTokens;
}

// ── CSV parser & normaliser ───────────────────────────────────────────────────

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = []; let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || "").replace(/^"|"$/g, "").trim()]));
  });
}

export function normaliseRow(row) {
  const keys = Object.keys(row);
  const get = (...names) => {
    for (const n of names) {
      const found = keys.find(k => k.trim().toLowerCase() === n.trim().toLowerCase());
      if (found && row[found]?.trim()) return row[found].trim();
    }
    return "";
  };

  function extractIELTS(str) { const m = str.match(/(\d+\.?\d*)\s*IELTS/i); return m ? parseFloat(m[1]) : NaN; }
  function extractGPA(str)   { const m = str.match(/(\d+\.?\d*)\s*GPA/i);   return m ? parseFloat(m[1]) : NaN; }
  function extractNum(str)   { const m = str.replace(/[,]/g, "").match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : NaN; }

  const admReq   = get("Admission Requirements", "Requirements");
  const country  = get("Country");
  const uni      = get("University Name", "University");
  const prog     = get("Courses", "Course", "Program", "Programme");
  const levelRaw = get("Level");
  const rankRaw  = get("Ranking");
  const intakeRaw = get("Intake");

  let ielts = parseFloat(get("Min_IELTS", "IELTS"));
  if (isNaN(ielts) && admReq) ielts = extractIELTS(admReq);

  let gpa = parseFloat(get("Min_GPA", "GPA"));
  if (isNaN(gpa) && admReq) gpa = extractGPA(admReq);

  let fin     = extractNum(get("Min_Financial", "Living Cost", "LivingCost"));
  let tuition = extractNum(get("Tuition", "Tution Fees", "Tuition Fees", "TuitionFees"));

  const noteParts = [get("Notes"), intakeRaw ? `Intakes: ${intakeRaw}` : ""].filter(Boolean);

  return {
    country, uni, prog, levelRaw, rankRaw, admReq,
    ielts:    isNaN(ielts)    ? 6.0   : ielts,
    gpa:      isNaN(gpa)      ? 3.0   : gpa,
    financial: isNaN(fin)     ? 10000 : fin,
    tuition:  isNaN(tuition)  ? 15000 : tuition,
    duration: get("Duration") || "1 year",
    note:     noteParts.join(" | "),
  };
}

export function csvToRequirements(rows) {
  const result = {};
  for (const row of rows) {
    const { country, uni, prog, levelRaw, rankRaw, ielts, gpa, financial, tuition, duration, note } = normaliseRow(row);
    if (!country || !uni || !prog) continue;
    const meta = getCountryMeta(country);
    if (!result[country]) result[country] = {
      flag: meta.flag,
      visaType: meta.visaType,
      visaChecklist: UNIVERSITY_DATA[country]?.visaChecklist || [],
      universities: {},
    };
    if (!result[country].universities[uni])
      result[country].universities[uni] = { ranking: rankRaw || "—", programs: [] };
    result[country].universities[uni].programs.push({
      name: prog, level: levelRaw || "Postgraduate",
      ielts, gpa, financial, duration, tuition, note,
    });
  }
  return result;
}

export function downloadCSV(text, filename) {
  const b64     = btoa(unescape(encodeURIComponent(text)));
  const dataUrl = `data:text/csv;base64,${b64}`;
  const a       = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── Offer letter helpers ──────────────────────────────────────────────────────

export function resolveOffer(profile, preferredIdx = 0) {
  const offers = profile?.offerLetters;
  if (Array.isArray(offers) && offers.length > 0) {
    const idx = (preferredIdx >= 0 && preferredIdx < offers.length) ? preferredIdx : 0;
    const o = offers[idx];
    return {
      country:      o.country      && o.country      !== "Not found" ? o.country      : null,
      university:   o.university   && o.university   !== "Not found" ? o.university   : null,
      status:       o.status       || null,
      program:      o.program      && o.program      !== "Not found" ? o.program      : null,
      intakeSeason: o.intakeSeason && o.intakeSeason !== "Not found" ? o.intakeSeason : null,
      conditions:   o.conditions   || null,
      hasOffer: true,
      idx,
    };
  }
  const fallback = profile?.targetCountry && profile.targetCountry !== "Not found" ? profile.targetCountry : null;
  return { country: fallback, university: null, status: null, program: null, intakeSeason: null, conditions: null, hasOffer: false, idx: 0 };
}

export function migrateOfferLetter(profile) {
  if (!profile) return profile;
  if (!Array.isArray(profile.offerLetters)) {
    const old = profile.offerLetter;
    if (!old || old === "Not found" || old === "") {
      const { offerLetter: _drop, ...rest } = profile;
      profile = { ...rest, offerLetters: [] };
    } else {
      const m = old.match(/^(Full|Conditional)\s*[—\-–]\s*(.+?)(?:,\s*(.+))?$/i);
      const { offerLetter: _drop, ...rest } = profile;
      if (m) {
        profile = { ...rest, offerLetters: [{ status: m[1], university: (m[2] || "").trim(), country: (m[3] || profile.targetCountry || "Not found").trim(), program: "Not found", intakeSeason: "Not found", conditions: "" }] };
      } else {
        profile = { ...rest, offerLetters: [{ status: "Legacy", university: old, country: profile.targetCountry || "Not found", program: "Not found", intakeSeason: "Not found", conditions: "" }] };
      }
    }
  }
  if (!Array.isArray(profile.englishTests) || profile.englishTests.length === 0) {
    const tests = [];
    if (profile.ieltsScore && profile.ieltsScore !== "Not found" && profile.ieltsScore !== "")
      tests.push({ type: "IELTS", overallScore: profile.ieltsScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    if (profile.toeflScore && profile.toeflScore !== "Not found" && profile.toeflScore !== "")
      tests.push({ type: "TOEFL iBT", overallScore: profile.toeflScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    if (profile.pteScore && profile.pteScore !== "Not found" && profile.pteScore !== "")
      tests.push({ type: "PTE Academic", overallScore: profile.pteScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    profile = { ...profile, englishTests: tests.length > 0 ? tests : [] };
  }
  return profile;
}

// ── Funds lookup ──────────────────────────────────────────────────────────────

import { COUNTRY_CURRENCY } from '../constants/countries';

export function lookupFundsRequired(profile, preferredIdx, requirementsData) {
  if (!requirementsData) return null;
  const resolved    = resolveOffer(profile, preferredIdx);
  const offerCountry = resolved.country;
  const offerUni    = resolved.university;
  const offerProg   = resolved.program;
  if (!offerCountry && !offerUni) return null;

  const countryKey = Object.keys(requirementsData).find(k =>
    k === offerCountry ||
    (offerCountry && (
      k.toLowerCase().includes(offerCountry.toLowerCase()) ||
      offerCountry.toLowerCase().includes(k.toLowerCase())
    ))
  );
  if (!countryKey) return null;
  const countryData = requirementsData[countryKey];
  if (!countryData?.universities) return null;

  const currency = COUNTRY_CURRENCY[countryKey] || null;
  const source   = Object.keys(UNIVERSITY_DATA).includes(countryKey) ? "builtin" : "csv";

  const uniKey = Object.keys(countryData.universities).find(k =>
    k === offerUni ||
    (offerUni && (
      k.toLowerCase().includes(offerUni.toLowerCase()) ||
      offerUni.toLowerCase().includes(k.toLowerCase())
    ))
  );
  if (!uniKey) return null;
  const uniData = countryData.universities[uniKey];
  if (!uniData?.programs?.length) return null;

  const prog = (offerProg && offerProg !== "Not found")
    ? (uniData.programs.find(p =>
        p.name === offerProg ||
        p.name.toLowerCase().includes(offerProg.toLowerCase()) ||
        offerProg.toLowerCase().includes(p.name.toLowerCase())
      ) || uniData.programs[0])
    : uniData.programs[0];

  if (!prog?.financial) return null;

  const value = currency
    ? `${currency} ${prog.financial.toLocaleString()}`
    : `${prog.financial.toLocaleString()}`;
  return { value, amount: prog.financial, currency, label: `${uniKey} · ${prog.name}`, source };
}
