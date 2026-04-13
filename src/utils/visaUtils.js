// ─────────────────────────────────────────────────────────────────────────────
// visaUtils.js  —  Shared constants, Supabase singleton, auth helpers,
//                  and pure utility functions for VisaLens.
// Import from this file instead of App.jsx in all extracted components.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

/* ─── PROXY ──────────────────────────────────────────────────────────────── */
export const PROXY_URL = "https://visalens-proxy.ijecloud.workers.dev";

/* ─── SUPABASE SINGLETON ─────────────────────────────────────────────────── */
// window._supabaseInstance guard prevents duplicate GoTrueClient warnings on HMR
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
export const supabase = window._supabaseInstance;

/* ─── SESSION ────────────────────────────────────────────────────────────── */
export const ORG_SESSION_KEY = "visalens_org_session";

export function getOrgSession() {
  try {
    const raw = sessionStorage.getItem(ORG_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setOrgSession(data) {
  try { sessionStorage.setItem(ORG_SESSION_KEY, JSON.stringify(data)); } catch {}
}

export function clearOrgSession() {
  try { sessionStorage.removeItem(ORG_SESSION_KEY); } catch {}
}

/* ─── AUTH HEADERS ───────────────────────────────────────────────────────── */
// JWT sessions (RBAC) use Bearer token; legacy access-code sessions use X-Org-Id.
export function getAuthHeaders() {
  const session = getOrgSession();
  if (!session) return { "Content-Type": "application/json" };
  if (session.access_token) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    };
  }
  return {
    "Content-Type": "application/json",
    "X-Org-Id": session.org_id || "",
  };
}

/* ─── TOKEN REFRESH ──────────────────────────────────────────────────────── */
export function isTokenExpiringSoon() {
  const s = getOrgSession();
  if (!s?.access_token) return false;
  try {
    if (s.expires_at) return (s.expires_at - Math.floor(Date.now() / 1000)) < 300;
    const payload = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return (payload.exp - Math.floor(Date.now() / 1000)) < 300;
  } catch { return false; }
}

let _refreshPromise = null;
export async function refreshTokenIfNeeded() {
  const s = getOrgSession();
  if (!s?.access_token || !s?.refresh_token) return;
  if (!isTokenExpiringSoon()) return;
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token:  s.access_token,
        refresh_token: s.refresh_token,
      });
      if (error) throw error;
      if (data?.session) {
        setOrgSession({
          ...s,
          access_token:  data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at:    data.session.expires_at,
        });
      }
    } catch (e) {
      console.warn('[VisaLens] Token refresh failed:', e.message);
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

export async function authedFetch(url, options = {}, _isRetry = false) {
  await refreshTokenIfNeeded();
  const res = await fetch(url, { ...options, headers: { ...getAuthHeaders(), ...(options.headers || {}) } });
  if (res.status === 401 && !_isRetry) {
    const s = getOrgSession();
    if (s?.refresh_token) {
      try {
        const { data } = await supabase.auth.setSession({
          access_token:  s.access_token,
          refresh_token: s.refresh_token,
        });
        if (data?.session) {
          setOrgSession({ ...s, access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
        }
      } catch {}
    }
    return authedFetch(url, options, true);
  }
  return res;
}

/* ─── ORG BODY HELPER ────────────────────────────────────────────────────── */
export function withOrg(body) {
  const session = getOrgSession();
  if (session?.org_id) return { ...body, org_id: session.org_id };
  return body;
}

/* ─── COUNTRY META ───────────────────────────────────────────────────────── */
export const COUNTRY_META = {
  "United Kingdom": { flag:"🇬🇧", visaType:"UK Student Visa (Tier 4)" },
  "Finland":        { flag:"🇫🇮", visaType:"Finland Student Residence Permit" },
  "Germany":        { flag:"🇩🇪", visaType:"Germany Student Visa (Nationales Visum)" },
  "Canada":         { flag:"🇨🇦", visaType:"Canada Study Permit" },
  "Australia":      { flag:"🇦🇺", visaType:"Australia Student Visa (Subclass 500)" },
  "United States":  { flag:"🇺🇸", visaType:"USA F-1 Student Visa" },
  "Netherlands":    { flag:"🇳🇱", visaType:"Netherlands MVV Student Visa" },
  "Sweden":         { flag:"🇸🇪", visaType:"Sweden Residence Permit for Studies" },
  "Ireland":        { flag:"🇮🇪", visaType:"Ireland Student Visa" },
  "New Zealand":    { flag:"🇳🇿", visaType:"New Zealand Student Visa" },
};
export function getCountryMeta(c) { return COUNTRY_META[c] || { flag:"🌍", visaType:`${c} Student Visa` }; }

/* ─── COUNTRY ISO-2 MAP ──────────────────────────────────────────────────── */
export const COUNTRY_ISO2 = {
  "United Kingdom":       "GB",
  "Canada":               "CA",
  "Australia":            "AU",
  "United States":        "US",
  "Germany":              "DE",
  "Finland":              "FI",
  "Netherlands":          "NL",
  "Sweden":               "SE",
  "Ireland":              "IE",
  "New Zealand":          "NZ",
  "France":               "FR",
  "Italy":                "IT",
  "Spain":                "ES",
  "Denmark":              "DK",
  "Norway":               "NO",
  "Portugal":             "PT",
  "Malaysia":             "MY",
  "Singapore":            "SG",
  "Japan":                "JP",
  "South Korea":          "KR",
  "United Arab Emirates": "AE",
};

/* ─── COUNTRY → CURRENCY MAP ─────────────────────────────────────────────── */
export const COUNTRY_CURRENCY = {
  "United Kingdom": "GBP",
  "Finland":        "EUR",
  "Germany":        "EUR",
  "Canada":         "CAD",
  "Australia":      "AUD",
  "United States":  "USD",
  "Netherlands":    "EUR",
  "Sweden":         "SEK",
  "Ireland":        "EUR",
  "New Zealand":    "NZD",
};

/* ─── CASE SERIAL HELPERS ────────────────────────────────────────────────── */
export function _slugify(str, maxLen = 6) {
  return (str || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, maxLen) || "ORG";
}
export function _initials(fullName, maxLen = 3) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "XX";
  return parts.slice(0, maxLen).map(p => p[0].toUpperCase()).join("");
}
export function _isoDate(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
}

/* ─── OFFER LETTER RESOLVER ──────────────────────────────────────────────── */
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
        profile = { ...rest, offerLetters: [{ status: m[1], university: (m[2]||"").trim(), country: (m[3]||profile.targetCountry||"Not found").trim(), program: "Not found", intakeSeason: "Not found", conditions: "" }] };
      } else {
        profile = { ...rest, offerLetters: [{ status: "Legacy", university: old, country: profile.targetCountry||"Not found", program: "Not found", intakeSeason: "Not found", conditions: "" }] };
      }
    }
  }
  if (!Array.isArray(profile.englishTests) || profile.englishTests.length === 0) {
    const tests = [];
    if (profile.ieltsScore && profile.ieltsScore !== "Not found" && profile.ieltsScore !== "") {
      tests.push({ type: "IELTS", overallScore: profile.ieltsScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    }
    if (profile.toeflScore && profile.toeflScore !== "Not found" && profile.toeflScore !== "") {
      tests.push({ type: "TOEFL iBT", overallScore: profile.toeflScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    }
    if (profile.pteScore && profile.pteScore !== "Not found" && profile.pteScore !== "") {
      tests.push({ type: "PTE Academic", overallScore: profile.pteScore, testDate: "", urn: "", subScores: { listening: "", reading: "", writing: "", speaking: "" } });
    }
    profile = { ...profile, englishTests: tests.length > 0 ? tests : [] };
  }
  return profile;
}

/* ─── CURRENCY PARSER ────────────────────────────────────────────────────── */
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
  let normalised = numStr;
  const lastDot   = numStr.lastIndexOf(".");
  const lastComma = numStr.lastIndexOf(",");
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

/* ─── FUNDS REQUIRED LOOKUP ──────────────────────────────────────────────── */
// Kept here so SOPBuilder / UniversityChecker can import it without touching App.jsx
// Note: UNIVERSITY_DATA is still in App.jsx — pass requirementsData as a prop.
export function lookupFundsRequired(profile, preferredIdx, requirementsData) {
  if (!requirementsData) return null;
  const resolved = resolveOffer(profile, preferredIdx);
  const offerCountry = resolved.country;
  const offerUni     = resolved.university;
  if (!offerCountry && !offerUni) return null;
  const countryKey = Object.keys(requirementsData).find(k =>
    k === offerCountry ||
    (offerCountry && (k.toLowerCase().includes(offerCountry.toLowerCase()) || offerCountry.toLowerCase().includes(k.toLowerCase())))
  );
  if (!countryKey) return null;
  const countryData = requirementsData[countryKey];
  if (!countryData?.universities) return null;
  const currency = COUNTRY_CURRENCY[countryKey] || null;
  const uniKey = Object.keys(countryData.universities).find(k =>
    k === offerUni ||
    (offerUni && (k.toLowerCase().includes(offerUni.toLowerCase()) || offerUni.toLowerCase().includes(k.toLowerCase())))
  );
  if (!uniKey) return null;
  const uniData = countryData.universities[uniKey];
  if (!uniData?.fundsRequired) return null;
  const raw = uniData.fundsRequired;
  return { value: `${currency || ""} ${raw}`.trim(), amount: raw, currency, label: uniData.fundsLabel || "Funds Required", source: "requirementsData" };
}

/* ─── SCORE DISPLAY HELPERS ──────────────────────────────────────────────── */
export function scoreCol(s)   { return s >= 70 ? "#059669" : s >= 45 ? "#B45309" : "#DC2626"; }
export function scoreBadge(s) { return s >= 70 ? "b-ok"    : s >= 45 ? "b-warn"  : "b-err"; }
export function scoreLabel(s) { return s >= 70 ? "Strong"  : s >= 45 ? "Moderate": "Weak"; }

/* ─── PARSE HELPERS ──────────────────────────────────────────────────────── */
export function parseGPA(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
export function parseIELTS(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
export function parseFinancial(str) {
  if (!str || str === "Not found") return null;
  const m = str.replace(/,/g,"").match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
export function daysUntilExpiry(dateStr) {
  if (!dateStr || dateStr === "Not found") return null;
  const formats = [/(\d{2})\.(\d{2})\.(\d{4})/,/(\d{4})-(\d{2})-(\d{2})/,/(\d{2})\/(\d{2})\/(\d{4})/,/(\d{2})-(\d{2})-(\d{4})/];
  let date = null;
  for (const fmt of formats) {
    const m = dateStr.match(fmt);
    if (m) { date = fmt === formats[1] ? new Date(`${m[1]}-${m[2]}-${m[3]}`) : new Date(`${m[3]}-${m[2]}-${m[1]}`); break; }
  }
  if (!date || isNaN(date)) return null;
  return Math.floor((date - new Date()) / 86400000);
}

/* ─── FILE VALIDATION ────────────────────────────────────────────────────── */
export const ALLOWED_EXTENSIONS     = new Set(["pdf", "jpg", "jpeg", "png", "txt", "docx"]);
export const ALLOWED_MIME_TYPES     = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/jpg", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const UNSUPPORTED_BUT_COMMON = new Set(["odt", "doc", "xls", "xlsx", "ppt", "pptx"]);

/* ─── DARK MODE VARS ─────────────────────────────────────────────────────── */
export const DARK_VARS = {
  "--bg":   "#0F1E3C",
  "--s1":   "#162444",
  "--s2":   "#1C2E52",
  "--s3":   "#223460",
  "--bd":   "#2A3F6F",
  "--bdem": "#3A5080",
  "--t1":   "#E8EEF8",
  "--t2":   "#94A3B8",
  "--t3":   "#4A5D7E",
};

/* ─── WINDOW STORAGE POLYFILL ────────────────────────────────────────────── */
// localStorage shim for the window.storage API used throughout the app.
// Call this once at app startup (already called in App.jsx — keep it there,
// or move this call to main.jsx if you prefer a single entry point).
export function initStoragePolyfill() {
  window.storage = {
    get:    async (k)    => { const v = localStorage.getItem(k); return v !== null ? { value: v } : null; },
    set:    async (k, v) => { localStorage.setItem(k, String(v)); return { key: k, value: v }; },
    delete: async (k)    => { localStorage.removeItem(k); return { key: k, deleted: true }; },
    list:   async (prefix) => {
      const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
      return { keys };
    },
  };
}
