import React, { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import JSZip from 'jszip';
import {
  AlertCircle, ArrowUpRight, BarChart3, Bell, BookOpen, Building2, Check, CheckCircle,
  ChevronDown, Clock, Copy, CreditCard, DollarSign, Download, Edit3, Eye, EyeOff,
  File, FileSpreadsheet, FileText, Flag, FolderDown, FolderOpen, Globe, GraduationCap,
  Info, Languages, LayoutDashboard, ListChecks, Loader2, Mail, MessageSquare,
  Moon, Pencil, Plus, Printer, RefreshCw, Save, Search, Send, ShieldCheck, Star, Sun,
  Target, Trash2, TriangleAlert, Upload, User, X, XCircle, ZoomIn, Dot
} from 'lucide-react';
 
 import { createClient } from '@supabase/supabase-js';
const PROXY_URL = "/.netlify/functions/proxy";
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const DARK_VARS = {
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

// ── ORG ID ───────────────────────────────────────────────────────────────────
// Each deployed instance is tied to one org. Set VITE_ORG_ID in Netlify env vars
// (Site Settings → Environment Variables). Leave blank for dev/passthrough mode.
const ORG_ID = import.meta.env.VITE_ORG_ID || null;

// Helper: add org_id to every proxy request body
function withOrg(body) {
  if (ORG_ID) return { ...body, org_id: ORG_ID };
  return body;
}


// localStorage polyfill for window.storage API used in original artifact
window.storage = {
  get: async (k) => { const v = localStorage.getItem(k); return v !== null ? {value: v} : null; },
  set: async (k, v) => { localStorage.setItem(k, String(v)); return {key: k, value: v}; },
  delete: async (k) => { localStorage.removeItem(k); return {key: k, deleted: true}; },
  list: async (prefix) => { const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix)); return {keys}; }
};



/* ─── COUNTRY META LOOKUP ────────────────────────────────────────── */
const COUNTRY_META = {
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
function getCountryMeta(c) { return COUNTRY_META[c] || { flag:"🌍", visaType:`${c} Student Visa` }; }

/* ─── OFFER LETTER RESOLVER (3-tier hierarchy) ───────────────────────── */
// Tier 1: offerLetters[preferredIdx].country
// Tier 2: offerLetters[0].country (if no preference but data exists)
// Tier 3: standalone targetCountry (pre-application, no offer yet)
function resolveOffer(profile, preferredIdx = 0) {
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

/* ─── LEGACY OFFER LETTER MIGRATION ──────────────────────────────────── */
// Converts old flat offerLetter string → new offerLetters array.
// Called when loading cases saved before v8, or when the AI returns the old format.
function migrateOfferLetter(profile) {
  if (!profile) return profile;
  if (Array.isArray(profile.offerLetters)) return profile; // already new format
  const old = profile.offerLetter;
  if (!old || old === "Not found" || old === "") {
    const { offerLetter: _drop, ...rest } = profile;
    return { ...rest, offerLetters: [] };
  }
  // Parse "Full — University, Country" or "Conditional — University, Country"
  const m = old.match(/^(Full|Conditional)\s*[—\-–]\s*(.+?)(?:,\s*(.+))?$/i);
  const { offerLetter: _drop, ...rest } = profile;
  if (m) {
    return { ...rest, offerLetters: [{ status: m[1], university: (m[2]||"").trim(), country: (m[3]||profile.targetCountry||"Not found").trim(), program: "Not found", intakeSeason: "Not found", conditions: "" }] };
  }
  return { ...rest, offerLetters: [{ status: "Legacy", university: old, country: profile.targetCountry||"Not found", program: "Not found", intakeSeason: "Not found", conditions: "" }] };
}

/* ─── CURRENCY PARSER ──────────────────────────────────────────────── */
// Returns { amount: number|null, currency: string|null }
// Handles: £12,000  GBP 12,000  PKR 5,495,000  5.000.000 EUR  $18,000  Rs 500,000
function parseCurrencyAmount(str) {
  if (!str || str === "Not found" || str.trim() === "") return { amount: null, currency: null };
  const s = str.trim();

  // Detect currency — symbol wins over ISO code if both present
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

  // Strip everything except digits, commas, dots
  const numStr = s.replace(/[^0-9.,]/g, "").trim();
  if (!numStr) return { amount: null, currency };

  // Distinguish European notation (1.234.567,00) from UK/US (1,234,567.00)
  // Rule: if the string has both , and . — the last one is the decimal separator
  let normalised = numStr;
  const lastDot   = numStr.lastIndexOf(".");
  const lastComma = numStr.lastIndexOf(",");
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      // European: 1.234.567,00 → remove dots, replace comma with dot
      normalised = numStr.replace(/\./g, "").replace(",", ".");
    } else {
      // UK/US: 1,234,567.00 → remove commas
      normalised = numStr.replace(/,/g, "");
    }
  } else if (lastComma > -1 && lastDot === -1) {
    // Comma only — treat as thousands separator if >3 digits after it, else decimal
    const afterComma = numStr.slice(lastComma + 1);
    normalised = afterComma.length === 3 ? numStr.replace(/,/g, "") : numStr.replace(",", ".");
  } else if (lastDot > -1 && lastComma === -1) {
    // Dot only — treat as thousands separator if >3 digits after it, else decimal
    const afterDot = numStr.slice(lastDot + 1);
    normalised = afterDot.length === 3 && numStr.replace(/[^.]/g,"").length > 1
      ? numStr.replace(/\./g, "") : numStr;
  }

  const amount = parseFloat(normalised);
  return { amount: isNaN(amount) ? null : amount, currency };
}

/* ─── COUNTRY → CURRENCY MAP ────────────────────────────────────── */
const COUNTRY_CURRENCY = {
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

/* ─── AUTO-POPULATE FUNDS REQUIRED FROM UNIVERSITY DATA ───────────────── */
// Returns { value, amount, currency, label, source:"builtin"|"csv" } or null
function lookupFundsRequired(profile, preferredIdx, requirementsData) {
  if (!requirementsData) return null;
  const resolved = resolveOffer(profile, preferredIdx);
  const offerCountry = resolved.country;
  const offerUni     = resolved.university;
  const offerProg    = resolved.program;
  if (!offerCountry && !offerUni) return null;

  // Fuzzy country match
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

  // Fuzzy university match
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

  // Fuzzy programme match — fall back to first programme
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
  const label = `${uniKey} · ${prog.name}`;

  return { value, amount: prog.financial, currency, label, source };
}
const UNIVERSITY_DATA = {
  "United Kingdom": {
    flag:"🇬🇧", visaType:"UK Student Visa (Tier 4)",
    visaChecklist:[
      {item:"Valid Passport",note:"Must be valid for duration of course + 6 months",required:true},
      {item:"CAS Number",note:"Confirmation of Acceptance for Studies from university",required:true},
      {item:"Financial Proof",note:"£1,334/month in London or £1,023/month outside London",required:true},
      {item:"Academic Transcripts",note:"All previous degrees/qualifications",required:true},
      {item:"English Language Test",note:"IELTS UKVI, TOEFL or equivalent",required:true},
      {item:"Tuberculosis Test Result",note:"Required for applicants from certain countries (Pakistan, India etc.)",required:true},
      {item:"Bank Statements",note:"Last 28 days, showing required funds maintained",required:true},
      {item:"Passport Photos",note:"2 recent passport-sized photos",required:true},
      {item:"Immigration Health Surcharge",note:"£776/year (student), paid online before applying",required:true},
      {item:"Unconditional Offer Letter",note:"From a UKVI-licensed sponsor university",required:true},
    ],
    universities:{
      "University of Sheffield":{ranking:"QS #113",programs:[
        {name:"MA English Literature",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:18000,duration:"1 year",tuition:22000},
        {name:"MSc Data Science",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:20000,duration:"1 year",tuition:26000},
        {name:"MBA Business Administration",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:25000,duration:"1 year",tuition:32000,note:"2 years work experience recommended"},
        {name:"BSc Computer Science",level:"Undergraduate",ielts:6.0,gpa:2.8,financial:18000,duration:"3 years",tuition:24000},
      ]},
      "University of Leeds":{ranking:"QS #86",programs:[
        {name:"MA Linguistics",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:18000,duration:"1 year",tuition:21000},
        {name:"MSc Computer Science",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:20000,duration:"1 year",tuition:27000},
        {name:"MSc Finance",level:"Postgraduate",ielts:6.5,gpa:3.2,financial:22000,duration:"1 year",tuition:29000},
        {name:"BA International Relations",level:"Undergraduate",ielts:6.0,gpa:2.8,financial:18000,duration:"3 years",tuition:22000},
      ]},
      "University of Manchester":{ranking:"QS #32",programs:[
        {name:"MA Education",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:20000,duration:"1 year",tuition:23000},
        {name:"MSc Artificial Intelligence",level:"Postgraduate",ielts:7.0,gpa:3.5,financial:22000,duration:"1 year",tuition:31000},
        {name:"MSc Management",level:"Postgraduate",ielts:6.5,gpa:3.2,financial:22000,duration:"1 year",tuition:28000},
        {name:"BSc Biomedical Sciences",level:"Undergraduate",ielts:6.5,gpa:3.0,financial:20000,duration:"3 years",tuition:26000},
      ]},
      "Coventry University":{ranking:"QS #801-1000",programs:[
        {name:"BA Business Management",level:"Undergraduate",ielts:6.0,gpa:2.5,financial:15000,duration:"3 years",tuition:16500},
        {name:"MSc Engineering Management",level:"Postgraduate",ielts:6.5,gpa:2.8,financial:18000,duration:"1 year",tuition:18500},
        {name:"MSc International Business",level:"Postgraduate",ielts:6.5,gpa:2.8,financial:18000,duration:"1 year",tuition:17500},
      ]},
      "Anglia Ruskin University":{ranking:"QS #601-650",programs:[
        {name:"MSc Project Management",level:"Postgraduate",ielts:6.5,gpa:2.8,financial:16000,duration:"1 year",tuition:15000},
        {name:"BSc Nursing",level:"Undergraduate",ielts:7.0,gpa:3.0,financial:15000,duration:"3 years",tuition:14500},
        {name:"MA Creative Writing",level:"Postgraduate",ielts:6.0,gpa:2.5,financial:15000,duration:"1 year",tuition:14000},
      ]},
    }
  },
  "Finland":{
    flag:"🇫🇮", visaType:"Finland Student Residence Permit",
    visaChecklist:[
      {item:"Valid Passport",note:"Valid for entire study period + return",required:true},
      {item:"University Acceptance Letter",note:"Official admission letter from Finnish university",required:true},
      {item:"Proof of Financial Means",note:"€6,720/year minimum (€560/month)",required:true},
      {item:"Proof of Tuition Fee Payment",note:"Receipt of first year tuition payment",required:true},
      {item:"Health Insurance",note:"Valid for Finland, minimum €30,000 coverage",required:true},
      {item:"Academic Transcripts",note:"All previous degrees with certified translations",required:true},
      {item:"English Language Test",note:"IELTS 6.0+ or TOEFL 79+ for English-taught programmes",required:true},
      {item:"Passport Photos",note:"2 recent passport-sized photos (biometric)",required:true},
      {item:"Completed Application Form",note:"Online via EnterFinland.fi portal",required:true},
      {item:"Proof of Accommodation",note:"Student housing confirmation or rental agreement",required:false},
    ],
    universities:{
      "University of Helsinki":{ranking:"QS #107",programs:[
        {name:"MSc Computer Science",level:"Postgraduate",ielts:6.5,gpa:3.5,financial:10000,duration:"2 years",tuition:15000,note:"Acceptance rate 17% — highly competitive"},
        {name:"MSc Data Science",level:"Postgraduate",ielts:6.5,gpa:3.5,financial:10000,duration:"2 years",tuition:15000},
        {name:"MA Linguistics",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:9000,duration:"2 years",tuition:13000},
        {name:"MSc Ecology & Evolutionary Biology",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:9000,duration:"2 years",tuition:13000},
      ]},
      "Aalto University":{ranking:"QS #109",programs:[
        {name:"MSc Engineering (Mechanical)",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:14000,duration:"2 years",tuition:15000},
        {name:"MSc Business Administration",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:14000,duration:"2 years",tuition:15000},
        {name:"MSc Arts & Design",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:12000,duration:"2 years",tuition:12000},
        {name:"MSc Information Networks",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:14000,duration:"2 years",tuition:15000},
      ]},
      "Tampere University":{ranking:"QS #351-400",programs:[
        {name:"MSc Software Engineering",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:10000,duration:"2 years",tuition:12000},
        {name:"MSc Health Sciences",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:9000,duration:"2 years",tuition:10000},
        {name:"MSc Biomedical Engineering",level:"Postgraduate",ielts:6.5,gpa:3.2,financial:10000,duration:"2 years",tuition:12000},
      ]},
      "University of Turku":{ranking:"QS #401-450",programs:[
        {name:"MSc Bioinformatics",level:"Postgraduate",ielts:6.5,gpa:3.3,financial:10000,duration:"2 years",tuition:12000},
        {name:"MA Education",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:8000,duration:"2 years",tuition:10000},
        {name:"MSc Future Technologies",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:10000,duration:"2 years",tuition:11000},
      ]},
      "LUT University":{ranking:"QS #651-700",programs:[
        {name:"MSc Industrial Engineering",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:10000,duration:"2 years",tuition:10000},
        {name:"MSc Energy Technology",level:"Postgraduate",ielts:6.0,gpa:3.0,financial:10000,duration:"2 years",tuition:10000},
        {name:"MSc Business Analytics",level:"Postgraduate",ielts:6.5,gpa:3.0,financial:10000,duration:"2 years",tuition:10000},
      ]},
    }
  }
};

/* ─── VISA DOC TYPE REQUIREMENTS (per country, for DocPresenceChecker) ───── */
const VISA_DOC_TYPES = {
  "United Kingdom":[
    {item:"Valid Passport",            docType:"passport",       required:true},
    {item:"Offer Letter / CAS",        docType:"offer_letter",   required:true},
    {item:"Bank Statement",            docType:"bank_statement", required:true},
    {item:"Academic Transcripts",      docType:"transcript",     required:true},
    {item:"English Language Test",     docType:"language_test",  required:true},
    {item:"Financial / Sponsor Proof", docType:"financial_proof",required:true},
    {item:"Recommendation Letter",     docType:"recommendation", required:false},
  ],
  "Finland":[
    {item:"Valid Passport",            docType:"passport",       required:true},
    {item:"Acceptance Letter",         docType:"offer_letter",   required:true},
    {item:"Bank Statement",            docType:"bank_statement", required:true},
    {item:"Academic Transcripts",      docType:"transcript",     required:true},
    {item:"English Language Test",     docType:"language_test",  required:true},
    {item:"Financial Proof",           docType:"financial_proof",required:true},
    {item:"Recommendation Letter",     docType:"recommendation", required:false},
  ],
};
const GENERIC_VISA_DOCS = [
  {item:"Valid Passport",          docType:"passport",       required:true},
  {item:"Offer / Admission Letter",docType:"offer_letter",   required:true},
  {item:"Bank Statement",          docType:"bank_statement", required:true},
  {item:"Academic Transcripts",    docType:"transcript",     required:true},
  {item:"Language Test Result",    docType:"language_test",  required:true},
  {item:"Financial Proof",         docType:"financial_proof",required:true},
  {item:"Recommendation Letter",   docType:"recommendation", required:false},
];

/* ─── CSV TEMPLATE (downloadable) ────────────────────────────────── */
const TEMPLATE_CSV =
`Country,University,Ranking,Program,Level,Min_IELTS,Min_GPA,Min_Financial,Duration,Tuition,Notes
United Kingdom,London Metropolitan University,QS #1001+,MSc Information Technology,Postgraduate,6.0,2.5,15000,1 year,14000,Good entry point for lower GPA applicants
United Kingdom,University of Bedfordshire,QS #1001+,MBA,Postgraduate,6.0,2.5,14000,1 year,13500,Accepts students with gap years
Germany,Technical University of Munich,QS #37,MSc Computer Science,Postgraduate,7.0,3.5,12000,2 years,0,Tuition-free; proof of living costs required
Germany,RWTH Aachen University,QS #106,MSc Mechanical Engineering,Postgraduate,6.5,3.3,11000,2 years,0,
Canada,University of Toronto,QS #25,MSc Computer Science,Postgraduate,7.0,3.7,25000,2 years,30000,Very competitive — acceptance rate ~15%
Canada,York University,QS #451-500,MBA,Postgraduate,6.5,3.0,20000,2 years,22000,
Australia,University of Melbourne,QS #33,MSc Data Science,Postgraduate,6.5,3.3,30000,2 years,42000,
Australia,University of Sydney,QS #18,MSc Cybersecurity,Postgraduate,6.5,3.3,28000,1.5 years,45000,`;

/* ─── CSV PARSER ─────────────────────────────────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = []; let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h,i) => [h, (vals[i]||"").replace(/^"|"$/g,"").trim()]));
  });
}
function normaliseRow(row) {
  // Detect format by checking which keys exist, then map to a canonical shape
  const keys = Object.keys(row);
  const has = k => keys.some(x => x.toLowerCase().replace(/\s/g,"") === k.toLowerCase().replace(/\s/g,""));
  // Helper: get value by any of several possible key spellings
  const get = (...names) => {
    for (const n of names) {
      const found = keys.find(k => k.trim().toLowerCase() === n.trim().toLowerCase());
      if (found && row[found]?.trim()) return row[found].trim();
    }
    return "";
  };
  // Extract IELTS score from a mixed string like "6.5 IELTS / 58 PTE" or "3.0 GPA / 6.5 IELTS"
  function extractIELTS(str) {
    const m = str.match(/(\d+\.?\d*)\s*IELTS/i);
    return m ? parseFloat(m[1]) : NaN;
  }
  // Extract GPA score from a mixed string like "3.5 GPA / 120 DET"
  function extractGPA(str) {
    const m = str.match(/(\d+\.?\d*)\s*GPA/i);
    return m ? parseFloat(m[1]) : NaN;
  }
  // Extract numeric amount from strings like "£16500", "$45000 CAD", "€0 Tuition", "$1023/month"
  function extractNum(str) {
    const m = str.replace(/[,]/g,"").match(/(\d+\.?\d*)/);
    return m ? parseFloat(m[1]) : NaN;
  }

  const admReq = get("Admission Requirements", "Requirements");
  const country  = get("Country");
  const uni      = get("University Name", "University");
  const prog     = get("Courses", "Course", "Program", "Programme");
  const levelRaw = get("Level");
  const rankRaw  = get("Ranking");
  const intakeRaw= get("Intake");

  // IELTS: dedicated column wins, else parse from Admission Requirements
  let ielts = parseFloat(get("Min_IELTS", "IELTS"));
  if (isNaN(ielts) && admReq) ielts = extractIELTS(admReq);

  // GPA: dedicated column wins, else parse from Admission Requirements
  let gpa = parseFloat(get("Min_GPA", "GPA"));
  if (isNaN(gpa) && admReq) gpa = extractGPA(admReq);

  // Financial: dedicated column or Living Cost
  let fin = extractNum(get("Min_Financial", "Living Cost", "LivingCost"));

  // Tuition
  const tuitionRaw = get("Tuition", "Tution Fees", "Tuition Fees", "TuitionFees");
  let tuition = extractNum(tuitionRaw);

  // Notes: combine Notes + Intake if present
  const noteParts = [get("Notes"), intakeRaw ? `Intakes: ${intakeRaw}` : ""].filter(Boolean);

  return { country, uni, prog, levelRaw, rankRaw, admReq,
    ielts: isNaN(ielts) ? 6.0 : ielts,
    gpa:   isNaN(gpa)   ? 3.0 : gpa,
    financial: isNaN(fin)      ? 10000 : fin,
    tuition:   isNaN(tuition) ? 15000 : tuition,
    duration:  get("Duration") || "1 year",
    note:      noteParts.join(" | "),
  };
}
function csvToRequirements(rows) {
  const result = {};
  for (const row of rows) {
    const { country, uni, prog, levelRaw, rankRaw, ielts, gpa, financial, tuition, duration, note } = normaliseRow(row);
    if (!country || !uni || !prog) continue;
    const meta = getCountryMeta(country);
    if (!result[country]) result[country] = {
      flag: meta.flag,
      visaType: meta.visaType,
      visaChecklist: UNIVERSITY_DATA[country]?.visaChecklist || [],
      universities: {}
    };
    if (!result[country].universities[uni])
      result[country].universities[uni] = { ranking: rankRaw || "—", programs: [] };
    result[country].universities[uni].programs.push({
      name: prog,
      level: levelRaw || "Postgraduate",
      ielts, gpa, financial, duration, tuition, note,
    });
  }
  return result;
}
function downloadCSV(text, filename) {
  const b64     = btoa(unescape(encodeURIComponent(text)));
  const dataUrl = `data:text/csv;base64,${b64}`;
  const a       = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── MISC HELPERS ───────────────────────────────────────────────── */
function parseGPA(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
function parseIELTS(str) {
  if (!str || str === "Not found") return null;
  const m = str.match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
function parseFinancial(str) {
  if (!str || str === "Not found") return null;
  const m = str.replace(/,/g,"").match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null;
}
function daysUntilExpiry(dateStr) {
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
function scoreCol(s) { return s >= 70 ? "#059669" : s >= 45 ? "#B45309" : "#DC2626"; }
function scoreBadge(s) { return s >= 70 ? "b-ok" : s >= 45 ? "b-warn" : "b-err"; }
function scoreLabel(s) { return s >= 70 ? "Strong" : s >= 45 ? "Moderate" : "Weak"; }

/* ─── DOC TYPES ──────────────────────────────────────────────────── */
const DOC_TYPES = [
  // Identity
  {value:"passport",          label:"Passport / ID",                   Icon:CreditCard,  group:"Identity"},
  {value:"birth_certificate", label:"Birth Certificate",               Icon:FileText,    group:"Identity"},
  {value:"domicile",          label:"Domicile Certificate",            Icon:FileText,    group:"Identity"},
  {value:"marriage_certificate",label:"Marriage Certificate",          Icon:FileText,    group:"Identity"},
  {value:"police_clearance",  label:"Police Clearance Certificate",    Icon:ShieldCheck, group:"Identity"},
  // Academic
  {value:"transcript",        label:"Academic Transcript",             Icon:BookOpen,    group:"Academic"},
  {value:"degree_certificate",label:"Degree Certificate",              Icon:GraduationCap,group:"Academic"},
  {value:"experience_letter", label:"Experience / Employment Letter",  Icon:FileText,    group:"Academic"},
  {value:"gap_letter",        label:"Gap / Explanation Letter",        Icon:FileText,    group:"Academic"},
  // Applications
  {value:"offer_letter",      label:"Offer / Admission Letter",        Icon:GraduationCap,group:"Application"},
  {value:"scholarship_letter",label:"Scholarship / Funding Letter",    Icon:Mail,        group:"Application"},
  {value:"noc",               label:"No Objection Certificate (NOC)", Icon:FileText,    group:"Application"},
  // Financial
  {value:"bank_statement",    label:"Bank Statement",                  Icon:BarChart3,   group:"Financial"},
  {value:"financial_proof",   label:"Financial / Sponsor Letter",      Icon:DollarSign,  group:"Financial"},
  {value:"fee_receipt",       label:"Fee / Tuition Payment Receipt",   Icon:DollarSign,  group:"Financial"},
  // Language
  {value:"language_test",     label:"Language Test (IELTS/TOEFL/PTE)",Icon:Languages,   group:"Language"},
  // Visa
  {value:"ihs_receipt",       label:"IHS Payment Receipt (UK)",        Icon:FileText,    group:"Visa"},
  {value:"tb_test",           label:"TB Test Result",                  Icon:FileText,    group:"Visa"},
  {value:"medical_certificate",label:"Medical Certificate",            Icon:FileText,    group:"Visa"},
  // Supporting
  {value:"recommendation",    label:"Recommendation Letter",           Icon:Mail,        group:"Supporting"},
  // Rejections
  {value:"visa_rejection",    label:"Visa Rejection Letter",           Icon:XCircle,     group:"Rejections"},
  {value:"admission_rejection",label:"Admission / Deferment Letter",   Icon:XCircle,     group:"Rejections"},
  {value:"other",             label:"Other Document",                  Icon:File,        group:"Other"},
];
const getDT = v => DOC_TYPES.find(d => d.value === v) || DOC_TYPES[DOC_TYPES.length-1];

/* ─── SUB-TYPE DEFINITIONS ───────────────────────────────────────── */
const TRANSCRIPT_LEVELS = [
  {value:"",               label:"— select level —"},
  {value:"Matric",         label:"Matric / SSC / O-Levels"},
  {value:"Intermediate",   label:"Intermediate / FSc / A-Levels / HSC"},
  {value:"Bachelors",      label:"Bachelors / BA / BSc / BBA"},
  {value:"Masters",        label:"Masters / MSc / MBA / MA"},
  {value:"MPhil",          label:"MPhil"},
  {value:"PhD",            label:"PhD / Doctorate"},
  {value:"Diploma",        label:"Diploma / Certificate"},
  {value:"Other",          label:"Other"},
];
// Offer letter sub-type is a free-text university name field — no static list needed

function guessType(name) {
  const n = name.toLowerCase();
  if (n.includes("passport")||n.includes(" id "))               return "passport";
  if (n.includes("birth"))                                      return "birth_certificate";
  if (n.includes("domicile"))                                   return "domicile";
  if (n.includes("marriage")||n.includes("nikah"))              return "marriage_certificate";
  if (n.includes("police")||n.includes("pcc")||n.includes("clearance")) return "police_clearance";
  if (n.includes("transcript")||n.includes("grade")||n.includes("result")) return "transcript";
  if (n.includes("degree")||n.includes("certificate")&&!n.includes("birth")&&!n.includes("domicile")) return "degree_certificate";
  if (n.includes("experience")||n.includes("employment")||n.includes("noc")&&!n.includes("_noc")) return "experience_letter";
  if (n.includes("gap")||n.includes("explanation"))             return "gap_letter";
  if (n.includes("offer")||n.includes("admission"))             return "offer_letter";
  if (n.includes("scholarship")||n.includes("funding"))         return "scholarship_letter";
  if (n.includes("noc"))                                        return "noc";
  if (n.includes("bank")||n.includes("statement"))             return "bank_statement";
  if (n.includes("financial")||n.includes("sponsor")||n.includes("affidavit")) return "financial_proof";
  if (n.includes("fee")||n.includes("receipt")||n.includes("payment")&&!n.includes("ihs")) return "fee_receipt";
  if (n.includes("ielts")||n.includes("toefl")||n.includes("pte")||n.includes("language")) return "language_test";
  if (n.includes("ihs"))                                        return "ihs_receipt";
  if (n.includes("tb")||n.includes("tuberculosis"))             return "tb_test";
  if (n.includes("medical")||n.includes("health"))             return "medical_certificate";
  if (n.includes("recommend")||n.includes("reference"))        return "recommendation";
  return "other";
}

/* ─── PREVIEW MODAL ──────────────────────────────────────────────── */
function PreviewModal({ doc, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [text, setText] = useState(null);
  useEffect(() => {
    const isImg = doc.file.type.startsWith("image/");
    const isPDF = doc.file.type === "application/pdf";
    if (isImg || isPDF) { const url = URL.createObjectURL(doc.file); setBlobUrl(url); return () => URL.revokeObjectURL(url); }
    else { doc.file.text().then(t => setText(t.slice(0,3000))); }
  }, [doc]);
  useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const isImg = doc.file.type.startsWith("image/"), isPDF = doc.file.type === "application/pdf";
  const name = doc.renamed || doc.file.name;
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="modal-hdr"><div className="rc-ico"><File size={14}/></div><span className="modal-title">{name}</span><button className="btn-ico" onClick={onClose}><X size={14}/></button></div>
        <div className="modal-body">
          {isImg && blobUrl && <img src={blobUrl} alt={name} className="modal-img"/>}
          {isPDF && blobUrl && <iframe src={blobUrl} title={name} className="modal-pdf"/>}
          {!isImg && !isPDF && text !== null && <div className="modal-txt">{text || "(empty)"}</div>}
          {!isImg && !isPDF && text === null && <div className="skel" style={{width:"100%",height:200}}/>}
        </div>
      </div>
    </div>
  );
}

/* ─── THUMB IMG ──────────────────────────────────────────────────── */
function ThumbImg({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url); }, [file]);
  return src ? <img src={src} alt=""/> : <div className="skel" style={{width:"100%",height:"100%"}}/>;
}

/* ─── SCORE BAR ──────────────────────────────────────────────────── */
function ScoreBar({ label, score }) {
  return (
    <div className="sbar">
      <div className="sbar-lbl"><span className="sbar-nm">{label}</span><span className="sbar-num" style={{color:scoreCol(score)}}>{score}/100</span></div>
      <div className="sbar-tr"><div className="sbar-fl" style={{width:`${score}%`,background:scoreCol(score)}}/></div>
    </div>
  );
}

/* ─── EXPIRY ALERTS ──────────────────────────────────────────────── */
function ExpiryAlerts({ profile }) {
  const alerts = [];
  const days = daysUntilExpiry(profile.passportExpiry);
  if (days !== null) {
    if (days < 0)   alerts.push({type:"danger",label:"Passport Expired",detail:`Passport expired ${Math.abs(days)} days ago. A new passport is required immediately.`});
    else if (days < 90)  alerts.push({type:"danger",label:"Passport Expiring Soon",detail:`Passport expires in ${days} days. Most visas require 6 months validity beyond course end.`});
    else if (days < 180) alerts.push({type:"warn",label:"Passport Validity Warning",detail:`Passport expires in ${days} days. Check if this covers your full study period + 6 months.`});
  }
  if (!alerts.length) return null;
  return (
    <div style={{marginBottom:10}}>
      {alerts.map((a,i) => (
        <div key={i} className={`expiry-alert ${a.type}`}>
          <div className={`expiry-alert-icon ${a.type}`}><Bell size={14}/></div>
          <div><div className="expiry-title">{a.label}</div><div className="expiry-detail">{a.detail}</div></div>
        </div>
      ))}
    </div>
  );
}

/* ─── QUALITY CARD ───────────────────────────────────────────────── */
function QualityCard({ docs, qualities }) {
  const issues = docs.filter(d => { const q = qualities[d.id]; return q && (q.status==="warn"||q.status==="error"); });
  if (!issues.length) return null;
  return (
    <div className="qa-card">
      <div className="qa-hdr"><TriangleAlert size={15} color="#B45309"/><span className="qa-ttl">Document Quality Issues</span><span className="badge b-warn">{issues.length} file{issues.length!==1?"s":""}</span></div>
      <div className="qa-body">
        {issues.map(d => {
          const q = qualities[d.id], isErr = q.status==="error";
          return (
            <div key={d.id} className={`qa-item ${isErr?"err":"warn"}`}>
              <div className={`qa-ico ${isErr?"err":"warn"}`}>{isErr?<EyeOff size={15}/>:<Eye size={15}/>}</div>
              <div><div className="qa-n">{d.renamed||d.file.name}</div><div className="qa-d">{isErr?`Unreadable — ${q.detail||"File could not be processed."}`:`Low quality — ${q.detail||"Some data may be inaccurate."}`}</div></div>
            </div>
          );
        })}
        <div className="qa-tip"><Info size={13} style={{flexShrink:0,marginTop:1}}/><span>Re-upload clearer scans at 300 DPI+. Fields marked "Not found" may be caused by poor image quality.</span></div>
      </div>
    </div>
  );
}

/* ─── FUNDS SUFFICIENCY BANNER ───────────────────────────────────── */
function FundsSufficiencyBanner({ balance, required }) {
  const [convertedInput, setConvertedInput] = useState("");

  if (!balance || !required || balance.trim() === "" || required.trim() === "") return null;

  const parsed    = parseCurrencyAmount(balance);
  const reqParsed = parseCurrencyAmount(required);

  if (parsed.amount === null && reqParsed.amount === null) {
    return (
      <div className="fsb fsb-unclear">
        <Info size={13} style={{flexShrink:0,marginTop:1}}/>
        <div className="fsb-body">
          <div className="fsb-title">Cannot determine sufficiency</div>
          <div className="fsb-detail">Could not parse either amount — verify manually before submission.</div>
        </div>
      </div>
    );
  }

  const currenciesMatch =
    parsed.currency && reqParsed.currency &&
    parsed.currency === reqParsed.currency;

  if (!currenciesMatch) {
    // Try to resolve via manually entered conversion
    const converted = parseFloat(convertedInput.replace(/[^0-9.]/g,""));
    const hasConverted = !isNaN(converted) && converted > 0;
    const req = reqParsed.amount;
    const sym = reqParsed.currency || parsed.currency || "";

    if (hasConverted && req !== null) {
      const diff = converted - req;
      const sufficient = diff >= 0;
      const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return (
        <div className={`fsb ${sufficient ? "fsb-ok" : "fsb-fail"}`}>
          {sufficient ? <CheckCircle size={13} style={{flexShrink:0,marginTop:1}}/> : <AlertCircle size={13} style={{flexShrink:0,marginTop:1}}/>}
          <div className="fsb-body">
            <div className="fsb-title">
              {sufficient
                ? `Appears sufficient — ${sym} ${fmt(converted)} equivalent vs ${sym} ${fmt(req)} required (+${sym} ${fmt(diff)})`
                : `Apparent shortfall — ${sym} ${fmt(Math.abs(diff))} below requirement`
              }
            </div>
            <div className="fsb-detail" style={{display:"flex",alignItems:"center",gap:8,marginTop:4,flexWrap:"wrap"}}>
              <span>Based on your conversion. Verify live exchange rate before submission.</span>
              <button className="fsb-clear-btn" onClick={()=>setConvertedInput("")}>Change amount</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fsb fsb-convert">
        <DollarSign size={13} style={{flexShrink:0,marginTop:1,color:"var(--info)"}}/>
        <div className="fsb-body">
          <div className="fsb-title" style={{color:"var(--info)"}}>
            Currencies differ ({parsed.currency||"?"} available · {reqParsed.currency||"?"} required)
          </div>
          <div className="fsb-convert-row">
            <label className="fsb-convert-lbl">
              Enter {parsed.currency||"available"} equivalent in {reqParsed.currency||"required currency"}:
            </label>
            <div className="fsb-convert-input-wrap">
              <span className="fsb-convert-sym">{reqParsed.currency||""}</span>
              <input
                className="fsb-convert-input"
                type="number"
                min="0"
                placeholder="e.g. 18000"
                value={convertedInput}
                onChange={e => setConvertedInput(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Same currency
  const avail = parsed.amount;
  const req   = reqParsed.amount;
  const diff  = avail - req;
  const pct   = req > 0 ? ((avail / req) * 100).toFixed(0) : null;
  const sufficient = diff >= 0;
  const fmt   = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const sym   = parsed.currency;

  return (
    <div className={`fsb ${sufficient ? "fsb-ok" : "fsb-fail"}`}>
      {sufficient
        ? <CheckCircle size={13} style={{flexShrink:0,marginTop:1}}/>
        : <AlertCircle size={13} style={{flexShrink:0,marginTop:1}}/>
      }
      <div className="fsb-body">
        <div className="fsb-title">
          {sufficient
            ? `Appears sufficient — ${sym} ${fmt(avail)} available vs ${sym} ${fmt(req)} required (+${sym} ${fmt(diff)})`
            : `Apparent shortfall — ${sym} ${fmt(Math.abs(diff))} below requirement`
          }
        </div>
        <div className="fsb-detail">
          {sufficient
            ? `${pct}% of requirement met. Verify figure reflects current visa rules before submission.`
            : `Available ${sym} ${fmt(avail)} · Required ${sym} ${fmt(req)}. Additional funds or sponsor docs may be needed.`
          }
        </div>
      </div>
    </div>
  );
}

/* ─── OFFER LETTERS SECTION (inline in ProfileCard) ──────────────── */
function OfferLettersSection({ data, setData, preferredIdx, setPreferredIdx }) {
  const offers = Array.isArray(data.offerLetters) ? data.offerLetters : [];

  function updateOffer(i, field, val) {
    setData(p => {
      const next = [...(p.offerLetters||[])];
      next[i] = { ...next[i], [field]: val };
      return { ...p, offerLetters: next };
    });
  }
  function addOffer() {
    setData(p => ({ ...p, offerLetters: [...(p.offerLetters||[]), { status:"Full", university:"", country:"", program:"", intakeSeason:"", conditions:"" }] }));
  }
  function removeOffer(i) {
    setData(p => {
      const next = (p.offerLetters||[]).filter((_,j) => j !== i);
      return { ...p, offerLetters: next };
    });
    if (preferredIdx >= i && preferredIdx > 0) setPreferredIdx(preferredIdx - 1);
  }

  const statusBadge = s => {
    if (!s || s === "Not Found") return "b-neu";
    if (s === "Full") return "b-ok";
    if (s === "Conditional") return "b-warn";
    return "b-neu";
  };

  return (
    <div className="pgroup">
      <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
        Offer Letters
        <span className="badge b-neu" style={{fontSize:9,marginLeft:2}}>{offers.length} offer{offers.length!==1?"s":""}</span>
        <button className="offer-add-btn" onClick={addOffer} title="Add offer letter manually">+ Add</button>
      </div>
      {offers.length === 0 ? (
        <div className="offer-empty">No offer letters extracted — add one manually or re-analyse.</div>
      ) : (
        <div className="offer-list">
          {offers.map((offer, i) => (
            <div key={i} className={`offer-card${i === preferredIdx ? " preferred" : ""}`}>
              {/* Header row: preferred radio + status badge + remove */}
              <div className="offer-card-hdr">
                <button
                  className={`offer-star-btn${i === preferredIdx ? " on" : ""}`}
                  onClick={() => setPreferredIdx(i)}
                  title={i === preferredIdx ? "Preferred — drives University Checker & Checklists" : "Set as preferred"}
                >
                  <Star size={12} fill={i === preferredIdx ? "currentColor" : "none"}/>
                  {i === preferredIdx ? "Preferred" : "Set preferred"}
                </button>
                <select
                  className="offer-status-sel"
                  value={offer.status||"Full"}
                  onChange={e => updateOffer(i, "status", e.target.value)}
                >
                  <option value="Full">Full</option>
                  <option value="Conditional">Conditional</option>
                </select>
                <button className="offer-remove-btn" onClick={() => removeOffer(i)} title="Remove this offer"><X size={12}/></button>
              </div>
              {/* Fields grid */}
              <div className="offer-fields">
                <div className="offer-field s2">
                  <div className="plbl">University</div>
                  <input className="pval-input" value={offer.university||""} onChange={e=>updateOffer(i,"university",e.target.value)} placeholder="University name"/>
                </div>
                <div className="offer-field">
                  <div className="plbl">Country</div>
                  <input className="pval-input" value={offer.country||""} onChange={e=>updateOffer(i,"country",e.target.value)} placeholder="Country"/>
                </div>
                <div className="offer-field">
                  <div className="plbl">Intake</div>
                  <input className="pval-input" value={offer.intakeSeason||""} onChange={e=>updateOffer(i,"intakeSeason",e.target.value)} placeholder="e.g. Sep 2026"/>
                </div>
                <div className="offer-field s2">
                  <div className="plbl">Programme</div>
                  <input className="pval-input" value={offer.program||""} onChange={e=>updateOffer(i,"program",e.target.value)} placeholder="Programme name"/>
                </div>
                {offer.status === "Conditional" && (
                  <div className="offer-field s2">
                    <div className="plbl">Conditions</div>
                    <input className="pval-input" value={offer.conditions||""} onChange={e=>updateOffer(i,"conditions",e.target.value)} placeholder="e.g. IELTS 6.5 by August 2026"/>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── PROFILE CARD ───────────────────────────────────────────────── */
function ProfileCard({ data, setData, preferredOfferIndex, setPreferredOfferIndex, requirementsData }) {
  // Auto-populate fundsRequired from university data when preferred offer changes
  useEffect(() => {
    if (!requirementsData) return;
    // Only auto-populate if counsellor hasn't manually set it
    if (data.fundsRequiredSource === "manual" && data.fundsRequired) return;
    const lookup = lookupFundsRequired(data, preferredOfferIndex, requirementsData);
    if (lookup) {
      setData(p => ({ ...p, fundsRequired: lookup.value, fundsRequiredSource: "auto", fundsRequiredLabel: lookup.label, fundsRequiredDataSource: lookup.source }));
    } else {
      // Clear auto value if offer changes to one with no data
      if (data.fundsRequiredSource === "auto") {
        setData(p => ({ ...p, fundsRequired: "", fundsRequiredSource: null, fundsRequiredLabel: "", fundsRequiredDataSource: null }));
      }
    }
  }, [preferredOfferIndex, requirementsData]);

  const autoLookup   = requirementsData ? lookupFundsRequired(data, preferredOfferIndex, requirementsData) : null;
  const showFundsReq = !!(data.fundsRequired && data.fundsRequired.trim()) || !!autoLookup;

  const rows = [
    { group: "Personal Information", fields: [
      {k:"fullName",       l:"Full Name",        w:true},
      {k:"dob",            l:"Date of Birth"},
      {k:"nationality",    l:"Nationality"},
      {k:"passportNumber", l:"Passport No."},
      {k:"passportExpiry", l:"Passport Expiry"},
	  {k:"cnicNumber",     l:"CNIC Number"},
	  {k:"cnicExpiry",     l:"CNIC Expiry"},
    ]},
    { group: "Academic Background", fields: [
      {k:"program",        l:"Highest Qualification", w:true},
      {k:"yearOfPassing",  l:"Year of Passing"},
      {k:"university",     l:"University"},
      {k:"academicResult", l:"Academic Result / GPA",  w:true, multiline:true},
    ]},
    { group: "English Qualifications", fields: [
      {k:"ieltsScore",        l:"IELTS Score"},
      {k:"toeflScore",        l:"TOEFL Score"},
      {k:"pteScore",          l:"PTE Score"},
      {k:"otherEnglishTest",  l:"Other English Test / Certificate", w:true, multiline:true, placeholder:"No test/certification found"},
      {k:"mediumOfInstruction", l:"Medium of Instruction", w:true, multiline:true, placeholder:"Not found"},
    ]},
    { group: "Financial", fields: [
      {k:"financialHolder",  l:"Account Holder"},
      {k:"financialBalance", l:"Funds Available (from documents)"},
    ]},
  ];

  return (
    <div className="rc">
      <div className="rc-hdr"><div className="rc-ico"><User size={14} color="#4A5D7E"/></div><span className="rc-ttl">Student Profile</span><span className="badge b-ok"><CheckCircle size={10}/>Extracted</span></div>
      <div className="rc-body">
        <ExpiryAlerts profile={data}/>
        {data.studyGap && data.studyGap !== "Not found" && data.studyGap !== "" && (
          <div className="study-gap-alert">
            <Clock size={14} style={{flexShrink:0,marginTop:1}}/>
            <div>
              <div className="study-gap-title">Study Gap Detected</div>
              <div className="study-gap-detail">{data.studyGap}</div>
            </div>
          </div>
        )}
        <div className="edit-bar"><Edit3 size={13} color="#1D6BE8"/><span className="edit-hint">Click any field to edit or fill in missing info</span></div>
        {rows.map(row => (
          <div key={row.group} className="pgroup">
            <div className="pgroup-label">{row.group}</div>
            <div className="pgrid">
              {row.fields.map(f => (
                <div key={f.k} className={`pfield${f.w?" s2":""}`}>
                  <div className="plbl">{f.l}</div>
                  {f.multiline
                    ? <textarea className="pval-textarea" value={data[f.k]||""} onChange={e=>setData(p=>({...p,[f.k]:e.target.value}))} placeholder={f.placeholder||"Not found — click to add"} aria-label={f.l} rows={3}/>
                    : <input   className="pval-input"    value={data[f.k]||""} onChange={e=>setData(p=>({...p,[f.k]:e.target.value}))} placeholder={f.placeholder||"Not found — click to add"} aria-label={f.l}/>
                  }
                </div>
              ))}
            </div>

            {/* ── Funds Required — only shown when auto-populated or counsellor has entered a value ── */}
            {row.group === "Financial" && showFundsReq && (
              <div className="funds-req-wrap">
                <div className="funds-req-lbl-row">
                  <span className="plbl" style={{marginBottom:0}}>Funds Required</span>
                  {data.fundsRequiredSource === "auto" && data.fundsRequiredLabel && (
                    <span className="funds-req-badge funds-req-badge-auto">
                      {data.fundsRequiredDataSource === "csv" ? <FileSpreadsheet size={9}/> : <Info size={9}/>}
                      Auto · {data.fundsRequiredLabel}
                    </span>
                  )}
                  {data.fundsRequiredSource === "manual" && (
                    <span className="funds-req-badge funds-req-badge-manual"><Pencil size={9}/>Edited</span>
                  )}
                </div>
                <input
                  className="pval-input"
                  value={data.fundsRequired||""}
                  onChange={e => setData(p => ({
                    ...p,
                    fundsRequired: e.target.value,
                    fundsRequiredSource: e.target.value.trim() ? "manual" : (autoLookup ? "auto" : null),
                    fundsRequiredLabel:  e.target.value.trim() ? p.fundsRequiredLabel : (autoLookup?.label || ""),
                  }))}
                  placeholder="e.g. GBP 18,000"
                  aria-label="Funds Required"
                />
                {data.fundsRequiredSource === "auto" && (
                  <div className="funds-req-disclaimer">
                    From university data — verify this includes visa maintenance requirements before submission.
                  </div>
                )}
              </div>
            )}

            {row.group === "Financial" && (
              <div style={{marginTop:10}}>
                <FundsSufficiencyBanner balance={data.financialBalance} required={data.fundsRequired}/>
              </div>
            )}
          </div>
        ))}
        {/* Offer Letters */}
        <OfferLettersSection data={data} setData={setData} preferredIdx={preferredOfferIndex} setPreferredIdx={setPreferredOfferIndex}/>
             
	 {/* Detected Special Documents */}
{Array.isArray(data.detectedDocs) && data.detectedDocs.length > 0 && (
  <div className="pgroup">
    <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
      Detected Special Documents
      <span className="badge b-info" style={{fontSize:9}}>{data.detectedDocs.length} found</span>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {data.detectedDocs.map((doc, i) => (
        <div key={i} style={{background:"var(--s2)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:"10px 12px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--p)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
            {doc.type}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {doc.reference  && <div><div className="plbl">Reference</div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{doc.reference}</div></div>}
            {doc.amount     && <div><div className="plbl">Amount</div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{doc.amount}</div></div>}
            {doc.date       && <div><div className="plbl">Date</div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{doc.date}</div></div>}
            {doc.expiry     && <div><div className="plbl">Expiry</div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{doc.expiry}</div></div>}
            {doc.result     && <div><div className="plbl">Result</div><div style={{fontSize:12,fontWeight:600,color:doc.result==="Clear"?"var(--ok)":"var(--err)"}}>{doc.result}</div></div>}
            {doc.institution&& <div style={{gridColumn:"1/-1"}}><div className="plbl">Institution</div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{doc.institution}</div></div>}
            {doc.notes      && <div style={{gridColumn:"1/-1"}}><div className="plbl">Notes</div><div style={{fontSize:12,color:"var(--t2)",fontFamily:"var(--fm)"}}>{doc.notes}</div></div>}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
	{/* Name Mismatches */}
{Array.isArray(data.nameMismatches) && data.nameMismatches.length > 0 && (
  <div className="pgroup">
    <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
      Name Mismatches Detected
      <span className="badge b-err" style={{fontSize:9}}>{data.nameMismatches.length} mismatch{data.nameMismatches.length!==1?"es":""}</span>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {data.nameMismatches.map((m, i) => (
        <div key={i} style={{background:"rgba(220,38,38,.05)",border:"1px solid rgba(220,38,38,.2)",borderRadius:"var(--r1)",padding:"9px 12px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--err)",marginBottom:4}}>{m.doc}</div>
          <div style={{fontSize:12,color:"var(--t1)",fontWeight:600,marginBottom:2}}>Found: "{m.nameFound}"</div>
          <div style={{fontSize:11,color:"var(--t2)",fontFamily:"var(--fm)"}}>{m.issue}</div>
        </div>
      ))}
      <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:"var(--warng)",border:"1px solid rgba(180,83,9,.2)",borderRadius:"var(--r1)",fontSize:11,color:"var(--warn)",fontFamily:"var(--fm)",lineHeight:1.5}}>
        <span style={{flexShrink:0,marginTop:1}}>⚠️</span>
        <span>Name mismatches must be resolved before visa submission. A statutory declaration or affidavit may be required.</span>
      </div>
    </div>
  </div>
)}
    </div>
	</div>
  );
}
	

/* ─── SIDEBAR DOC CHECKLIST (hybrid: auto-detection from classifications + manual override) ── */
function SidebarDocChecklist({ profile, preferredOfferIndex, docs, docTypes }) {
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

  // Many-to-one map: checklist docType → all uploaded docTypes that satisfy it
  const CHECKLIST_ACCEPTS = {
    "passport":       ["passport"],
    "offer_letter":   ["offer_letter"],
    "bank_statement": ["bank_statement", "financial_proof", "fee_receipt"],
    "transcript":     ["transcript", "degree_certificate"],
    "language_test":  ["language_test"],
    "financial_proof":["financial_proof", "bank_statement", "fee_receipt"],
    "recommendation": ["recommendation"],
  };

  // Auto-detect: a checklist item is present if any uploaded doc maps to it
  function isAutoPresent(docType) {
    if (!docs || !docs.length) return false;
    const accepts = CHECKLIST_ACCEPTS[docType] || [docType];
    return docs.some(d => accepts.includes(docTypes[d.id] || d.type || "other"));
  }

  // An item is "ticked" if auto-detected OR manually ticked
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
                  <input
                    type="checkbox"
                    className="sb-checkbox"
                    checked={ticked}
                    onChange={() => {
                      // If auto-present, manual toggle has no effect (auto wins)
                      if (!auto) setManualTicked(p=>({...p,[r.docType]:!p[r.docType]}));
                    }}
                  />
                  <span className="sb-check-name">{r.item}</span>
                  {auto && (
                    <span className="badge b-ok" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Auto</span>
                  )}
                  {!auto && !r.required && (
                    <span className="badge b-neu" style={{fontSize:9,marginLeft:"auto",flexShrink:0}}>Optional</span>
                  )}
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
/* ─── UNIVERSITY CHECKER (v6: accepts requirementsData prop, fixes IELTS) ── */
function UniversityChecker({ profile, requirementsData, compact, preferredOfferIndex }) {
  const resolved    = resolveOffer(profile, preferredOfferIndex);
  const seedCountry = resolved.country   || "";
  const seedUni     = resolved.university || "";

  const [country, setCountry]   = useState(seedCountry);
  const [uniName, setUniName]   = useState(seedUni);
  const [progName, setProgName] = useState("");

  // Re-seed whenever the preferred offer changes
  useEffect(() => {
    const r = resolveOffer(profile, preferredOfferIndex);
    setCountry(r.country || "");
    setUniName(r.university || "");
    setProgName("");
  }, [preferredOfferIndex, profile]);
  const countries   = Object.keys(requirementsData);
  const countryData = country ? requirementsData[country] : null;
  const unis        = countryData ? Object.keys(countryData.universities) : [];
  const uniData     = (countryData && uniName) ? countryData.universities[uniName] : null;
  const progs       = uniData ? uniData.programs : [];
  const prog        = (progName && progs.length) ? progs.find(p => p.name === progName) || null : null;

  function handleCountryChange(val) { setCountry(val); setUniName(""); setProgName(""); }
  function handleUniChange(val)     { setUniName(val); setProgName(""); }
  function handleProgChange(val)    { setProgName(progs.find(p => p.name === val) ? val : ""); }

  // PTE Academic → IELTS band equivalent (standard conversion table)
  function pteToIelts(pte) {
    if (pte >= 79) return 9.0;
    if (pte >= 73) return 8.5;
    if (pte >= 65) return 7.5; // covers 7.0–7.5
    if (pte >= 59) return 7.0;
    if (pte >= 50) return 6.5;
    if (pte >= 43) return 6.0;
    if (pte >= 36) return 5.5;
    return 5.0;
  }
  // Best English score across IELTS, TOEFL (÷10 approximation), PTE (converted)
  function bestIeltsEquiv(profile) {
    const scores = [];
    const i = parseIELTS(profile.ieltsScore); if (i !== null) scores.push(i);
    const t = parseFloat(profile.toeflScore);  if (!isNaN(t))  scores.push(t / 14.5); // rough TOEFL→IELTS
    const p = parseFloat(profile.pteScore);    if (!isNaN(p))  scores.push(pteToIelts(p));
    return scores.length ? Math.max(...scores) : null;
  }

  function checkReq(val, req, type, profile) {
    if (type === "ielts") {
      const best = bestIeltsEquiv(profile || {});
      if (best !== null) return best >= req ? "pass" : "fail";
      // No IELTS/TOEFL/PTE — check if other English evidence exists
      const hasOther = (profile?.otherEnglishTest && profile.otherEnglishTest !== "Not found") ||
                       (profile?.mediumOfInstruction && profile.mediumOfInstruction !== "Not found");
      return hasOther ? "unknown" : "unknown"; // still unknown but label differs — handled in render
    }
    if (!val || val === "Not found" || req == null) return "unknown";
    if (type === "gpa")       { const v = parseGPA(val);       return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    if (type === "financial") { const v = parseFinancial(val); return v !== null ? (v >= req ? "pass" : "fail") : "unknown"; }
    return "unknown";
  }

  // Build a label showing which English score(s) the student has
  function englishScoreLabel(profile) {
    const parts = [];
    if (profile.ieltsScore && profile.ieltsScore !== "Not found") parts.push(`IELTS ${profile.ieltsScore}`);
    if (profile.toeflScore && profile.toeflScore !== "Not found") parts.push(`TOEFL ${profile.toeflScore}`);
    if (profile.pteScore   && profile.pteScore   !== "Not found") parts.push(`PTE ${profile.pteScore}`);
    if (profile.otherEnglishTest && profile.otherEnglishTest !== "Not found") parts.push(profile.otherEnglishTest);
    if (profile.mediumOfInstruction && profile.mediumOfInstruction !== "Not found") parts.push(`MOI: ${profile.mediumOfInstruction}`);
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

  // Detect if this country's data came from a custom CSV
  const BUILTIN_COUNTRIES = Object.keys(UNIVERSITY_DATA);
  const isCustomCountry = country && !BUILTIN_COUNTRIES.includes(country);

  return (
    <div className={compact ? "uni-sidebar-card" : "rc"}>
      <div className={compact ? "uni-sidebar-hdr" : "rc-hdr"}>
        <div className="rc-ico"><Building2 size={14} color="#4A5D7E"/></div>
        <span className={compact ? "uni-sidebar-ttl" : "rc-ttl"}>University Checker</span>
        {country && (
          <span className={`uni-src-badge ${isCustomCountry ? "custom" : "builtin"}`} style={{margin:0}}>
            {isCustomCountry ? <><FileSpreadsheet size={10}/>CSV</> : <><Info size={10}/>Built-in</>}
          </span>
        )}
      </div>
      <div className={compact ? "uni-sidebar-body" : "rc-body"}>
        {/* In compact (sidebar) mode, stack selects vertically */}
        <div className={compact ? "uni-selects-stack" : "uni-selects"}>
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
            <div className={`uni-verdict ${verdict}`}>
              <span className={`uni-verdict-txt ${verdict}`}>{verdictText}</span>
              <span className="badge b-neu">{uniData.ranking}</span>
            </div>
            <div className="uni-req-grid">
              {[
                {label:"Min GPA",            req:prog.gpa,       val:profile.academicResult,   type:"gpa",       fmt:v=>`${v}`},
                {label:"English Proficiency", req:prog.ielts,     val:englishScoreLabel(profile), type:"ielts",     fmt:v=>`IELTS ${v} equiv.`},
                {label:"Financial Req.",      req:prog.financial, val:profile.financialBalance,   type:"financial", fmt:v=>`${v.toLocaleString()}`},
              ].map(r => {
                const status = r.type === "ielts"
                  ? checkReq(null, r.req, "ielts", profile)
                  : checkReq(r.val, r.req, r.type);
                return (
                  <div key={r.label} className={`uni-req-item ${status}`}>
                    <div className={`uni-req-label ${status}`}>{r.label}</div>
                    <div className="uni-req-val">Req: {r.fmt(r.req)}</div>
                    <div className="uni-req-student">Student: {r.val||"Not found"}</div>
                    <div className="uni-req-need">{status==="pass"?"✓ Met":status==="fail"?"✗ Not met":"? Check profile"}</div>
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

/* ─── SIDEBAR VISA CHECKLIST (collapsible reference) ───────────────── */
function SidebarVisaChecklist({ profile, preferredOfferIndex }) {
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
/* ─── REQUIREMENTS MANAGER (v6 new) ────────────────────────────────── */
function RequirementsManager({ customRequirements, onLoad, onClear, csvText }) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const isCustom = !!customRequirements;
  const totalPrograms = isCustom
    ? Object.values(customRequirements).reduce((s, cd) => s + Object.values(cd.universities).reduce((ss, u) => ss + u.programs.length, 0), 0)
    : 0;
  const totalCountries = isCustom ? Object.keys(customRequirements).length : 0;

  // Build flat rows for preview table
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

  const columns = [
    {name:"Country",      desc:"Country name (must match exactly)"},
    {name:"University",   desc:"Full university name"},
    {name:"Ranking",      desc:'e.g. "QS #113"'},
    {name:"Program",      desc:"Programme name"},
    {name:"Level",        desc:"Postgraduate / Undergraduate"},
    {name:"Min_IELTS",    desc:"e.g. 6.5"},
    {name:"Min_GPA",      desc:"e.g. 3.3"},
    {name:"Min_Financial",desc:"Annual amount (e.g. 20000)"},
    {name:"Duration",     desc:'e.g. "1 year"'},
    {name:"Tuition",      desc:"Annual tuition (0 = free)"},
    {name:"Notes",        desc:"Optional — any extra info"},
  ];

  return (
    <div className="req-page">
      <div className={`req-status-bar ${isCustom?"custom":"builtin"}`}>
        {isCustom
          ? <><FileSpreadsheet size={16}/><strong>{totalPrograms} programmes</strong> across {totalCountries} {totalCountries===1?"country":"countries"} loaded from your CSV — University Checker is using this data.</>
          : <><Info size={16}/>Using built-in data (UK + Finland). Upload a CSV to add or override countries and universities.</>
        }
      </div>

      <div className="req-acts">
        <button className="btn-p" style={{width:"auto",height:38,paddingLeft:16,paddingRight:16,fontSize:13}}
          onClick={() => fileRef.current?.click()}>
          <Upload size={14}/>{isCustom ? "Replace CSV" : "Upload Requirements CSV"}
        </button>
        <button className="btn-s" onClick={() => downloadCSV(TEMPLATE_CSV, "visalens_requirements_template.csv")}>
          <Download size={14}/>Download Template
        </button>
        {isCustom && <button className="btn-danger" onClick={onClear}><Trash2 size={14}/>Clear CSV / Use Built-in</button>}
        {csvText && <button className="btn-s" onClick={() => downloadCSV(csvText, "visalens_requirements_loaded.csv")}>
          <Download size={14}/>Export Current CSV
        </button>}
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" style={{display:"none"}}
        onChange={e => { handleFile(e.target.files[0]); e.target.value=""; }}/>

      {/* Drag + drop zone when nothing loaded */}
      {!isCustom && (
        <div
          className={`req-upload-zone${dragOver?" over":""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0])}}
          role="button" tabIndex={0} onKeyDown={e=>e.key==="Enter"&&fileRef.current?.click()}
        >
          <div className="dz-ico" style={{margin:"0 auto 12px"}}><FileSpreadsheet size={20}/></div>
          <div className="dz-h">Drop your requirements CSV here</div>
          <div className="dz-s">or <span className="dz-link">browse files</span> · CSV format only</div>
        </div>
      )}

      {/* Column format guide */}
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

      {/* Preview table */}
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

/* ─── REPORT MODAL ───────────────────────────────────────────────── */
function ReportModal({ profile, results, onClose }) {
  const [mode, setMode] = useState("whatsapp");
  const [copied, setCopied] = useState(false);
  const wa = profile && results ? `🎓 *VisaLens Student Report*
━━━━━━━━━━━━━━━━━━
👤 *Student:* ${profile.fullName||"N/A"}
🌍 *Nationality:* ${profile.nationality||"N/A"}
📅 *DOB:* ${profile.dob||"N/A"}
🛂 *Passport:* ${profile.passportNumber||"N/A"} (Exp: ${profile.passportExpiry||"N/A"})${(()=>{const offers=Array.isArray(profile.offerLetters)?profile.offerLetters:[];return offers.length?"\n📄 *Offer Letter"+(offers.length>1?"s":"")+"*: "+offers.map((o,i)=>`${i===0?"★ ":""}${o.status||""}${o.university?` — ${o.university}`:""}${o.country?`, ${o.country}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}`).join(" | "):"";})()}

🎓 *Academic Background*
• Highest Qualification: ${profile.program||"N/A"}${profile.yearOfPassing&&profile.yearOfPassing!=="Not found"?` (${profile.yearOfPassing})`:""}
• University: ${profile.university||"N/A"}
• Result/GPA: ${profile.academicResult||"N/A"}
• IELTS: ${profile.ieltsScore||"N/A"} · TOEFL: ${profile.toeflScore||"N/A"} · PTE: ${profile.pteScore||"N/A"}${profile.otherEnglishTest&&profile.otherEnglishTest!=="Not found"?`\n• Other English: ${profile.otherEnglishTest}`:""}${profile.mediumOfInstruction&&profile.mediumOfInstruction!=="Not found"?`\n• Medium of Instruction: ${profile.mediumOfInstruction}`:""}${profile.studyGap&&profile.studyGap!=="Not found"?`\n⚠️ Study Gap: ${profile.studyGap}`:""}

💰 *Financial*
• Account Holder: ${profile.financialHolder||"N/A"}
• Funds Available: ${profile.financialBalance||"N/A"}${profile.fundsRequired?`\n• Required: ${profile.fundsRequired}`:""}${(()=>{if(!profile.fundsRequired||!profile.financialBalance)return"";const a=parseCurrencyAmount(profile.financialBalance),r=parseCurrencyAmount(profile.fundsRequired);if(a.amount===null||r.amount===null)return"\n• Sufficiency: Cannot parse — verify manually";if(a.currency!==r.currency)return"\n• Sufficiency: ⚠️ Currencies differ — verify manually";const d=a.amount-r.amount;return d>=0?`\n• Sufficiency: ✓ Sufficient (+${a.currency} ${d.toLocaleString()})`:`\n• Sufficiency: ✗ Shortfall of ${a.currency} ${Math.abs(d).toLocaleString()}`;})()}

📊 *Eligibility Scores*
• Overall: ${results.eligibility.overallScore}/100 (${scoreLabel(results.eligibility.overallScore)})
• Financial: ${results.eligibility.financialScore}/100
• Academic: ${results.eligibility.academicScore}/100
• Documents: ${results.eligibility.documentScore}/100

📋 *Summary*
${results.eligibility.summary||"N/A"}

⚠️ *Gaps &amp; Concerns:* ${results.missingDocuments?.length||0}
${results.missingDocuments?.map(d=>`• ${d.document}`).join("\n")||"Nothing flagged"}

🚩 *Risk Flags:* ${results.redFlags?.length||0}
${results.redFlags?.map(f=>`• [${f.severity.toUpperCase()}] ${f.flag}`).join("\n")||"None"}
${results.rejections?.length?`\n❌ *Rejections / Deferments:* ${results.rejections.length}\n${results.rejections.map(r=>`• ${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.university?`, ${r.university}`:""}${r.date?` (${r.date})`:""}${r.reason?`\n  ${r.reason}`:""}`).join("\n")}`:""}

━━━━━━━━━━━━━━━━━━
Generated by VisaLens — ${new Date().toLocaleDateString()}` : "No data available";

  const email = profile && results ? `Subject: Student Visa Assessment — ${profile.fullName||"Student"}

Dear [Counselor/Student Name],

Please find below the visa readiness assessment for:

STUDENT INFORMATION
—————————————————
Name: ${profile.fullName||"N/A"}
Date of Birth: ${profile.dob||"N/A"}
Nationality: ${profile.nationality||"N/A"}
Passport No.: ${profile.passportNumber||"N/A"}
Passport Expiry: ${profile.passportExpiry||"N/A"}${(()=>{const offers=Array.isArray(profile.offerLetters)?profile.offerLetters:[];return offers.length?"\nOffer Letter"+(offers.length>1?"s":"")+":\n"+offers.map((o,i)=>`  ${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` | Intake: ${o.intakeSeason}`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join("\n"):"";})()}

ACADEMIC BACKGROUND
—————————————————
Highest Qualification: ${profile.program||"N/A"}${profile.yearOfPassing&&profile.yearOfPassing!=="Not found"?` (${profile.yearOfPassing})`:""}
University: ${profile.university||"N/A"}
Academic Result/GPA: ${profile.academicResult||"N/A"}
IELTS Score: ${profile.ieltsScore||"N/A"}
TOEFL Score: ${profile.toeflScore||"N/A"}
PTE Score: ${profile.pteScore||"N/A"}${profile.otherEnglishTest&&profile.otherEnglishTest!=="Not found"?`\nOther English Test/Cert: ${profile.otherEnglishTest}`:""}${profile.mediumOfInstruction&&profile.mediumOfInstruction!=="Not found"?`\nMedium of Instruction: ${profile.mediumOfInstruction}`:""}${profile.studyGap&&profile.studyGap!=="Not found"?`\nStudy Gap: ${profile.studyGap}`:""}

FINANCIAL STATUS
—————————————————
Account Holder: ${profile.financialHolder||"N/A"}
Balance: ${profile.financialBalance||"N/A"}${profile.fundsRequired?`\nRequired: ${profile.fundsRequired}`:""}${(()=>{if(!profile.fundsRequired||!profile.financialBalance)return"";const a=parseCurrencyAmount(profile.financialBalance),r=parseCurrencyAmount(profile.fundsRequired);if(a.amount===null||r.amount===null)return"\nSufficiency: Cannot parse amounts — verify manually";if(a.currency!==r.currency)return"\nSufficiency: Currencies differ — manual conversion required";const d=a.amount-r.amount;return d>=0?`\nSufficiency: Sufficient — ${a.currency} ${a.amount.toLocaleString()} available vs ${r.amount.toLocaleString()} required`:`\nSufficiency: Shortfall — ${a.currency} ${Math.abs(d).toLocaleString()} below requirement`;})()}

ELIGIBILITY ASSESSMENT
—————————————————
Overall Score: ${results.eligibility.overallScore}/100 — ${scoreLabel(results.eligibility.overallScore)}
Financial Strength: ${results.eligibility.financialScore}/100
Academic Standing: ${results.eligibility.academicScore}/100
Document Completeness: ${results.eligibility.documentScore}/100

Summary: ${results.eligibility.summary||"N/A"}

GAPS & CONCERNS (${results.missingDocuments?.length||0})
—————————————————
${results.missingDocuments?.map(d=>`• ${d.document}: ${d.reason}`).join("\n")||"Nothing flagged"}

RISK FLAGS (${results.redFlags?.length||0})
—————————————————
${results.redFlags?.map(f=>`• [${f.severity.toUpperCase()}] ${f.flag}\n  ${f.detail}`).join("\n\n")||"No significant risk flags"}
${results.rejections?.length?`\nREJECTIONS / DEFERMENTS (${results.rejections.length})\n—————————————————\n${results.rejections.map(r=>`• ${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.university?`, ${r.university}`:""}${r.program?`, ${r.program}`:""}${r.date?` (${r.date})`:""}${r.reason?`\n  Reason: ${r.reason}`:""}`).join("\n")}`:""}

—————————————————
This report was generated by VisaLens on ${new Date().toLocaleDateString()}.
Please verify all information before submission.` : "No data available";

  function copy() { navigator.clipboard.writeText(mode==="whatsapp"?wa:email); setCopied(true); setTimeout(()=>setCopied(false),2000); }
  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="report-modal" role="dialog">
        <div className="modal-hdr"><div className="rc-ico"><Send size={14}/></div><span className="modal-title">Share Report</span><button className="btn-ico" onClick={onClose}><X size={14}/></button></div>
        <div className="report-body">
          <div className="report-tabs">
            <button className={`report-tab${mode==="whatsapp"?" on":""}`} onClick={()=>setMode("whatsapp")}><MessageSquare size={13}/>WhatsApp</button>
            <button className={`report-tab${mode==="email"?" on":""}`}    onClick={()=>setMode("email")}><Mail size={13}/>Email</button>
          </div>
          <div className="report-text">{mode==="whatsapp"?wa:email}</div>
          <button className={`copy-btn ${mode}`} onClick={copy}>
            {copied?<><Check size={15}/>Copied!</>:<><Copy size={15}/>Copy {mode==="whatsapp"?"for WhatsApp":"for Email"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── REJECTIONS CARD ────────────────────────────────────────────── */
function RejectionsCard({ items }) {
  if (!items || items.length === 0) return null;
  const typeLabel = t => {
    if (t === "visa")       return {label:"Visa Rejection",   cls:"high"};
    if (t === "admission")  return {label:"Admission Rejection",cls:"medium"};
    if (t === "deferment")  return {label:"Deferment",          cls:"low"};
    return                         {label:"Rejection",          cls:"medium"};
  };
  return (
    <div className="rc">
      <div className="rc-hdr">
        <div className="rc-ico"><XCircle size={14} color="#4A5D7E"/></div>
        <span className="rc-ttl">Rejections &amp; Deferments</span>
        <span className="badge b-err"><AlertCircle size={10}/>{items.length} Record{items.length!==1?"s":""}</span>
      </div>
      <div className="rc-body">
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
      </div>
    </div>
  );
}

/* ─── MISSING / ELIG / FLAGS / NOTES CARDS ───────────────────────── */
function MissingCard({ items }) {
  return (
    <div className="rc">
      <div className="rc-hdr"><div className="rc-ico"><AlertCircle size={14} color="#4A5D7E"/></div><span className="rc-ttl">Gaps &amp; Concerns</span>
        {items.length===0?<span className="badge b-ok"><CheckCircle size={10}/>Nothing flagged</span>:<span className="badge b-warn"><AlertCircle size={10}/>{items.length} Item{items.length!==1?"s":""}</span>}
      </div>
      <div className="rc-body">
        {items.length===0
          ? <div className="all-clear"><CheckCircle size={16}/>No document gaps, financial concerns, or missing evidence identified.</div>
          : <div className="miss-list">{items.map((it,i)=><div key={i} className="miss-item"><div className="miss-ico"><AlertCircle size={14}/></div><div><div className="miss-n">{it.document}</div><div className="miss-w">{it.reason}</div></div></div>)}</div>
        }
      </div>
    </div>
  );
}
function EligCard({ data, summary, profile, isLive }) {
  const hasSufficiency = profile?.fundsRequired && profile.fundsRequired.trim() !== "";
  return (
    <div className="rc">
      <div className="rc-hdr"><div className="rc-ico"><Globe size={14} color="#4A5D7E"/></div><span className="rc-ttl">Visa Eligibility — Executive Summary</span>
        <span className={`badge ${scoreBadge(data.overallScore)}`}><ShieldCheck size={10}/>{scoreLabel(data.overallScore)}</span>
        {isLive&&<span className="badge b-p" style={{fontSize:9,marginLeft:4}}><RefreshCw size={9}/>Live</span>}
      </div>
      <div className="rc-body">
        {isLive&&<div className="elig-live-note"><Edit3 size={11}/>Scores updated from profile edits · click Re-assess for full narrative update</div>}
        <p className="elig-sum">{summary || data.summary}</p>
        <ScoreBar label="Overall Eligibility"   score={data.overallScore}/>
        {hasSufficiency
          ? <div className="elig-fin-override">
              <DollarSign size={12} style={{flexShrink:0,marginTop:1}}/>
              <span>Financial assessment overridden by sufficiency calculator — see Profile card for result.</span>
            </div>
          : <ScoreBar label="Financial Strength" score={data.financialScore}/>
        }
        <ScoreBar label="Academic Standing"     score={data.academicScore}/>
        <ScoreBar label="Document Completeness" score={data.documentScore}/>
        {data.notes?.length>0&&<div className="elig-notes">{data.notes.map((n,i)=><div key={i} className="en"><div className="en-dot"/><span>{n}</span></div>)}</div>}
      </div>
    </div>
  );
}
function FlagsCard({ flags }) {
  return (
    <div className="rc">
      <div className="rc-hdr"><div className="rc-ico"><Flag size={14} color="#4A5D7E"/></div><span className="rc-ttl">Risk Flags</span>
        {flags.length===0?<span className="badge b-ok"><CheckCircle size={10}/>No Issues</span>:<span className="badge b-err"><XCircle size={10}/>{flags.length} Flag{flags.length!==1?"s":""}</span>}
      </div>
      <div className="rc-body">
        {flags.length===0
          ? <div className="all-clear"><CheckCircle size={16}/>No significant risk factors identified.</div>
          : <div className="flag-list">{flags.map((f,i)=><div key={i} className={`fi ${f.severity}`}><span className={`fsev ${f.severity}`}>{f.severity}</span><div><div className="fttl">{f.flag}</div><div className="fdet">{f.detail}</div></div></div>)}</div>
        }
      </div>
    </div>
  );
}
function NotesCard({ notes, setNotes, onSave, onSaveCase, savedMsg, counsellorName, setCounsellorName, cases }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const existingNames = [...new Set((cases||[]).map(c => c.counsellorName).filter(Boolean))];
  const suggestions = counsellorName.trim()
    ? existingNames.filter(n => n.toLowerCase().includes(counsellorName.toLowerCase()) && n !== counsellorName)
    : [];

  return (
    <div className="rc">
      <div className="rc-hdr"><div className="rc-ico"><FileText size={14} color="#4A5D7E"/></div><span className="rc-ttl">Counselor Notes</span></div>
      <div className="rc-body">
        <div style={{marginBottom:8,position:"relative"}}>
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Your Name</div>
          <input
            className="notes-input"
            style={{width:"100%",fontSize:13}}
            placeholder="e.g. Sara Ahmed"
            value={counsellorName}
            onChange={e => { setCounsellorName(e.target.value); setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onFocus={() => setShowSuggestions(true)}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg)",border:"1px solid var(--bdr)",borderRadius:6,zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
              {suggestions.map(name => (
                <div
                  key={name}
                  onMouseDown={() => { setCounsellorName(name); setShowSuggestions(false); }}
                  style={{padding:"8px 12px",fontSize:13,cursor:"pointer",borderBottom:"1px solid var(--bdr)"}}
                  onMouseEnter={e => e.currentTarget.style.background="var(--hover)"}
                  onMouseLeave={e => e.currentTarget.style.background=""}
                >
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
        <label style={{display:"block",fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)",marginBottom:8}}>Follow-up actions, concerns, next steps</label>
        <textarea className="notes-area" placeholder="Add notes…" value={notes} onChange={e=>setNotes(e.target.value)}/>
        <div className="notes-acts">
          {savedMsg&&<span className="saved-msg"><Check size={12}/>{savedMsg}</span>}
          <div className="notes-sp"/>
          <button className="btn-o" onClick={onSaveCase}><FolderOpen size={13}/>Save to History</button>
        </div>
      </div>
    </div>
  );
}

/* ─── SKELETON ───────────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {[1,2,3,4].map(i=>(
        <div key={i} className="skel-card">
          <div className="skel-hdr"><div className="skel" style={{width:28,height:28}}/><div className="skel" style={{width:120,height:12}}/></div>
          <div className="skel-body"><div className="skel skel-line"/><div className="skel skel-line m"/><div className="skel skel-line s"/></div>
        </div>
      ))}
    </div>
  );
}

/* ─── CASE HISTORY ───────────────────────────────────────────────── */
function CaseHistory({ cases, onLoad, onDelete, onRenameCounsellor }) {
  const [exp, setExp] = useState(null);
  const [search, setSearch] = useState("");
  const [counsellorFilter, setCounsellorFilter] = useState("All");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  const counsellorOptions = ["All", ...new Set(cases.map(c => c.counsellorName).filter(Boolean))];

  async function handleRename() {
    if (!renameVal.trim() || counsellorFilter === "All") return;
    await onRenameCounsellor(counsellorFilter, renameVal.trim());
    setCounsellorFilter("All");
    setRenaming(false);
    setRenameVal("");
  }
  const filtered = cases.filter(c => {
    const matchesCounsellor = counsellorFilter === "All" || c.counsellorName === counsellorFilter;
    if (!matchesCounsellor) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (c.profile?.fullName || '').toLowerCase();
    const country = (c.targetCountry || c.profile?.targetCountry || '').toLowerCase();
    const counsellor = (c.counsellorName || '').toLowerCase();
    return name.includes(q) || country.includes(q) || counsellor.includes(q);
  });
  
  return (
    <div>
      <div className="rc" style={{marginBottom:16,padding:"14px 16px"}}>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Filter by Counsellor</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <select
                className="notes-input"
                style={{flex:1,fontSize:13}}
                value={counsellorFilter}
                onChange={e => { setCounsellorFilter(e.target.value); setRenaming(false); setRenameVal(""); }}
              >
                {counsellorOptions.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {counsellorFilter !== "All" && !renaming && (
                <button className="btn-s" style={{whiteSpace:"nowrap"}} onClick={() => { setRenaming(true); setRenameVal(counsellorFilter); }}>
                  ✏️ Rename
                </button>
              )}
            </div>
            {renaming && (
              <div style={{display:"flex",gap:6,marginTop:6}}>
                <input
                  className="notes-input"
                  style={{flex:1,fontSize:13}}
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  placeholder="New name…"
                />
                <button className="btn-s" onClick={handleRename}>✓</button>
                <button className="btn-s" onClick={() => { setRenaming(false); setRenameVal(""); }}>✕</button>
              </div>
            )}
          </div>
          <div style={{flex:2,minWidth:200}}>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Search Cases</div>
            <div style={{position:"relative"}}>
              <Search size={13} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--t3)"}}/>
              <input
                className="notes-input"
                style={{width:"100%",fontSize:13,paddingLeft:30}}
                placeholder="Search by student name, country, counsellor…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {!filtered.length ? (
        <div className="no-cases">
          <FolderOpen size={36} color="#94A3B8" style={{margin:"0 auto 14px"}}/>
          <div style={{fontSize:"1.1rem",fontWeight:700,color:"var(--t2)",marginBottom:8}}>
            {cases.length ? "No cases match your search" : "No cases saved yet"}
          </div>
          <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)"}}>
            {cases.length ? "Try a different search term" : "Analyse documents → click \"Save to History\""}
          </div>
        </div>
      ) : (
        <div className="history">
          {filtered.map(c => {
            const profile = c.profile || c.results?.studentProfile || {};
            const score = c.overallScore || c.results?.eligibility?.overallScore || 0;
            const flags = c.results?.redFlags?.length || 0;
            const country = c.targetCountry || profile.targetCountry || '—';
            const offers = Array.isArray(profile.offerLetters) ? profile.offerLetters : [];
            const offerCountry = offers[0]?.country || country;
            return (
              <div key={c.id} className="case-card">
                <div className="case-hdr" onClick={() => setExp(exp === c.id ? null : c.id)} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && setExp(exp === c.id ? null : c.id)}>
                  <div className="case-av"><User size={18}/></div>
                  <div className="case-info">
                    <div className="case-name">{profile.fullName || 'Unknown Student'}</div>
                    <div className="case-meta">
                      {offerCountry} · {new Date(c.savedAt).toLocaleDateString()}
                      {c.counsellorName && <span style={{opacity:.6}}> · {c.counsellorName}</span>}
                    </div>
                  </div>
                  <div className="case-r">
                    <span className={`badge ${scoreBadge(score)}`}>{score}/100</span>
                    <ChevronDown size={14} className={`chev${exp === c.id ? " open" : ""}`}/>
                  </div>
                </div>
                {exp === c.id && (
                  <div className="case-body">
                    <div className="mini-grid">
                      {[
                        {l:"Passport", v:profile.passportNumber},
                        {l:"Expiry",   v:profile.passportExpiry},
                        {l:"IELTS",    v:profile.ieltsScore},
                        {l:"Balance",  v:profile.financialBalance},
                        {l:"Program",  v:profile.program},
                        {l:"Flags",    v:`${flags} issue${flags !== 1 ? 's' : ''}`},
                      ].map(f => (
                        <div key={f.l} className="mini-f">
                          <div className="mini-l">{f.l}</div>
                          <div className={`mini-v${!f.v || f.v === "Not found" ? " e" : ""}`}>{f.v || "—"}</div>
                        </div>
                      ))}
                    </div>
                    <div className="sec-lbl">Counsellor Notes</div>
                    {c.notes ? <div className="case-notes-txt">{c.notes}</div> : <div className="case-no-notes">No notes recorded.</div>}
                    <div className="case-acts">
                      <button className="btn-s" onClick={() => onLoad(c)}><ArrowUpRight size={13}/>Open Full Analysis</button>
                      <button className="btn-danger" onClick={() => onDelete(c.id)}><Trash2 size={13}/>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── DASHBOARD ──────────────────────────────────────────────────── */
function Dashboard({ cases, onLoad }) {
  const [counsellorFilter, setCounsellorFilter] = useState("All");
  const counsellorOptions = ["All", ...new Set(cases.map(c => c.counsellorName).filter(Boolean))];
  const filtered = counsellorFilter === "All" ? cases : cases.filter(c => c.counsellorName === counsellorFilter);

  if (!cases.length) return (
    <div className="no-dash">
      <LayoutDashboard size={36} color="#94A3B8" style={{margin:"0 auto 14px"}}/>
      <div style={{fontSize:"1.1rem",fontWeight:700,color:"var(--t2)",marginBottom:8}}>No students yet</div>
      <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)"}}>Cases you save will appear here with status tracking</div>
    </div>
  );
  const total   = filtered.length;
  const strong  = filtered.filter(c=>c.results.eligibility.overallScore>=70).length;
  const weak    = filtered.filter(c=>c.results.eligibility.overallScore<45).length;
  const flagged = filtered.filter(c=>c.results.redFlags?.length>0).length;
  return (
    <>
      {counsellorOptions.length > 1 && (
        <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Filter by Counsellor</div>
          <select
            className="notes-input"
            style={{fontSize:13,minWidth:180}}
            value={counsellorFilter}
            onChange={e => setCounsellorFilter(e.target.value)}
          >
            {counsellorOptions.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="dash-stats">
        <div className="stat-card"><div className="stat-num">{total}</div><div className="stat-lbl">Total Students</div></div>
        <div className="stat-card"><div className="stat-num" style={{color:"var(--ok)"}}>{strong}</div><div className="stat-lbl">Strong Eligibility</div></div>
        <div className="stat-card"><div className="stat-num" style={{color:"var(--err)"}}>{weak}</div><div className="stat-lbl">Needs Attention</div></div>
        <div className="stat-card"><div className="stat-num" style={{color:"var(--warn)"}}>{flagged}</div><div className="stat-lbl">With Risk Flags</div></div>
      </div>
      <div className="dash-table">
        <div className="dash-table-hdr">
          <div className="dash-col-hdr">Student</div>
          <div className="dash-col-hdr">Country</div>
          <div className="dash-col-hdr">Score</div>
          <div className="dash-col-hdr">Flags</div>
          <div className="dash-col-hdr">Saved</div>
        </div>
        {filtered.map(c=>{
          const name    = c.profile?.fullName||c.results.studentProfile.fullName||"Unknown";
          const prog    = c.profile?.program||c.results.studentProfile.program||"—";
          const country = c.profile?.targetCountry||c.results.studentProfile.targetCountry||"—";
          const score   = c.results.eligibility.overallScore;
          const flags   = c.results.redFlags?.length||0;
          return (
            <div key={c.id} className="dash-row" onClick={()=>onLoad(c)}>
              <div><div className="dash-name">{name}</div><div className="dash-sub">{prog}</div></div>
              <div className="dash-cell">{country}</div>
              <div><span className={`badge ${scoreBadge(score)}`}>{score}/100</span></div>
              <div className="dash-cell">{flags>0?<span className="badge b-warn">{flags} flag{flags!==1?"s":""}</span>:<span className="badge b-ok">Clean</span>}</div>
              <div className="dash-cell" style={{fontSize:11,fontFamily:"var(--fm)"}}>{new Date(c.savedAt).toLocaleDateString()}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── AI CHAT PANEL ──────────────────────────────────────────────── */
function buildChatContext(profileData, results, docs) {
  if (!profileData || !results) return null;
  const p = profileData;
  const e = results.eligibility || {};
  const lines = [
    "=== STUDENT PROFILE (extracted from documents) ===",
    `Name: ${p.fullName||"Not found"}`,
    `DOB: ${p.dob||"Not found"}`,
    `Nationality: ${p.nationality||"Not found"}`,
    `Passport: ${p.passportNumber||"Not found"} (expires ${p.passportExpiry||"Not found"})`,
    `Offer Letters: ${(()=>{const offers=Array.isArray(p.offerLetters)?p.offerLetters:[];return offers.length?offers.map((o,i)=>`${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join(" / "):"None found";})()}`,
    `Target Country (fallback): ${p.targetCountry||"Not found"}`,
    `Highest Qualification: ${p.program||"Not found"} (${p.yearOfPassing||"year unknown"})`,
    `Institution (highest qual): ${p.university||"Not found"}`,
    `Academic Results:\n${p.academicResult||"Not found"}`,
    `Study Gap: ${p.studyGap||"None > 24 months"}`,
    `IELTS: ${p.ieltsScore||"Not found"} | TOEFL: ${p.toeflScore||"Not found"} | PTE: ${p.pteScore||"Not found"}`,
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
      `- ${d.type}${d.reference ? ` | Ref: ${d.reference}` : ""}${d.amount ? ` | Amount: ${d.amount}` : ""}${d.date ? ` | Date: ${d.date}` : ""}${d.expiry ? ` | Expiry: ${d.expiry}` : ""}${d.result ? ` | Result: ${d.result}` : ""}${d.institution ? ` | Institution: ${d.institution}` : ""}${d.notes ? ` | Notes: ${d.notes}` : ""}`
    ).join("\n")
  : "None detected"),
	"",   
	"=== NAME MISMATCHES ===",
	(profileData?.nameMismatches?.length
	? profileData.nameMismatches.map(m =>
      `- ${m.doc}: Found "${m.nameFound}" — ${m.issue}`
    ).join("\n")
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")  // escape HTML first
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

function ChatPanel({ profileData, results, docs, messages, setMessages }) {
  const [input,       setInput]       = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const hasCtx = profileData && results && Object.keys(profileData).length > 0;
  const ctxString = hasCtx ? buildChatContext(profileData, results, docs) : null;
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
      const systemPrompt = `You are VisaLens AI, an expert student visa counselling assistant. You have been given a fully extracted student profile below — do NOT ask to see documents again; use only the data provided.\n\nAnswer counsellor questions concisely and accurately. When referencing requirements (IELTS, GPA, financials), state both the requirement AND the student's actual value. Use "Not found" context to flag gaps. Keep answers under 200 words unless a longer breakdown is genuinely needed.\n\n${ctxString}`;
      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: systemPrompt,
          messages: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        })),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
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
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
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
      <div className="chat-hdr">
        <div className="chat-hdr-ico"><MessageSquare size={15} color="var(--p)"/></div>
        <div style={{flex:1}}>
          <div className="chat-hdr-title">AI Counsellor Chat — {studentName}</div>
          <div className="chat-hdr-ctx"><span className="chat-ctx-pill"><CheckCircle size={9}/>Profile context loaded · no images re-sent</span></div>
        </div>
        
        {/* NEW BUTTONS HERE */}
        {messages.length > 0 && (
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="btn-s" style={{ height: "28px", padding: "0 10px", fontSize: "11px" }} onClick={copyChat}>
              {copied ? <><Check size={12}/>Copied</> : <><Copy size={12}/>Copy</>}
            </button>
            <button className="btn-s" style={{ height: "28px", padding: "0 10px", fontSize: "11px" }} onClick={exportChatPDF}>
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
                <div className={`chat-avatar ${m.role}`}>
                  {m.role === "user" ? "You" : <ShieldCheck size={13}/>}
                </div>
                <div
                  className={`chat-bubble ${m.role}`}
                  dangerouslySetInnerHTML={{ __html: formatBubble(m.content) }}
                />
              </div>
            ))}
            {chatLoading && (
              <div className="chat-msg assistant">
                <div className="chat-avatar assistant"><ShieldCheck size={13}/></div>
                <div className="chat-typing">
                  <div className="chat-dot"/><div className="chat-dot"/><div className="chat-dot"/>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </>
        )}
      </div>

      <div className="chat-footer">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={`Ask about ${studentName}'s application…`}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            rows={1}
            disabled={chatLoading}
          />
          <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() || chatLoading}>
            {chatLoading ? <Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/> : <Send size={15}/>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ZIP / FOLDER DOWNLOAD MODAL ────────────────────────────────── */
function ZipModal({ docs, studentName, offerLetters, docTypes, setDocTypes, subTypes, setSubTypes, personTags, setPersonTags, customLabels, setCustomLabels, spouseName, setSpouseName, onClose }) {
  const [name,          setName]          = useState(studentName || "");
  const [zipping,       setZipping]       = useState(false);
  const [done,          setDone]          = useState(false);
  const [error,         setError]         = useState("");
  const [selectedId,    setSelectedId]    = useState(docs[0]?.id || null);
  const [previewSrc,    setPreviewSrc]    = useState(null);
  const [previewKind,   setPreviewKind]   = useState(null);
  const [previewText,   setPreviewText]   = useState("");

  const selectedDoc    = docs.find(d => d.id === selectedId) || docs[0];
  const hasSpouseDocs  = Object.values(personTags).some(p => p === "spouse");

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
      const base64  = await zip.generateAsync({ type:"base64" });
      const a       = document.createElement("a");
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
                  const needsSubType = t === "transcript" || t === "offer_letter";

                  return (
                    <div key={doc.id}
                      className={`zip-doc-row${isSelected?" active":""}`}
                      onClick={()=>setSelectedId(doc.id)}
                    >
                      <div className="zip-doc-meta">
                        <div className="zip-doc-name" title={doc.file.name}>{doc.file.name}</div>
                        <div className="zip-doc-renamed">{finalName}</div>
                      </div>
                      <div className="zip-doc-controls" onClick={e=>e.stopPropagation()}>
                        <div className="zip-person-row">
                          {["primary","spouse","child"].map(p => (
                            <button key={p}
                              className={`zip-person-btn${person===p?" on":""}`}
                              onClick={()=>setPersonTags(prev=>({...prev,[doc.id]:p}))}
                            >{p==="primary"?"Student":p==="spouse"?"Spouse":"Child"}</button>
                          ))}
                        </div>

                        <select className="doc-sel" value={t}
                          onChange={e=>{
                            setDocTypes(p=>({...p,[doc.id]:e.target.value}));
                            setSubTypes(p=>({...p,[doc.id]:""}));
                          }}>
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
                            {TRANSCRIPT_LEVELS.map(l=>(
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
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
                  {previewKind==="image" && previewSrc && (
                    <img src={previewSrc} alt={selectedDoc.file.name} className="zip-preview-img"/>
                  )}
                  {previewKind==="image" && !previewSrc && (
                    <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>
                  )}
                  {previewKind==="pdf" && (
                    <div className="zip-preview-placeholder" style={{padding:24,textAlign:"center"}}>
                      <FileText size={36} color="var(--t3)"/>
                      <div style={{fontSize:12,color:"var(--t2)",marginTop:10,fontWeight:600}}>{selectedDoc.file.name}</div>
                      <div style={{fontSize:11,color:"var(--t3)",marginTop:6,fontFamily:"var(--fm)",lineHeight:1.5}}>PDF preview not available in this environment.<br/>File will be correctly included in the ZIP.</div>
                    </div>
                  )}
                  {previewKind==="text" && (
                    <pre className="zip-preview-text">{previewText||"Loading…"}</pre>
                  )}
                  {!previewKind && (
                    <div className="zip-preview-placeholder"><Loader2 size={24} color="var(--t3)" style={{animation:"spin .7s linear infinite"}}/></div>
                  )}
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

function smartQualifier(doc, allDocs, docTypes, customLabels, offerLetters, subTypes) {
  const t    = docTypes[doc.id] || "other";
  const same = allDocs.filter(d => (docTypes[d.id]||"other") === t);
  if (same.length < 2) return "";

  const idx = same.indexOf(doc);
  const explicitSub = subTypes ? (subTypes[doc.id]||"").trim() : "";
  if (explicitSub) return `-${explicitSub.replace(/\s+/g,"-")}`;

  const n = doc.file.name.toLowerCase();

  function hasKw(kws) {
    return kws.some(kw => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(n);
    });
  }

  if (t === "transcript") {
    if (hasKw(["phd","doctorate"]))                                          return "-PhD";
    if (hasKw(["mphil"]))                                                    return "-MPhil";
    if (hasKw(["masters","master's","msc","mba","postgrad","postgraduate"])) return "-Masters";
    if (hasKw(["bachelors","bachelor's","bsc","bca","bba","undergrad"]))     return "-Bachelors";
    if (hasKw(["intermediate","fsc","hssc","a-level","a level"]))            return "-Intermediate";
    if (hasKw(["matric","ssc","o-level","o level","secondary school"]))      return "-Matric";
    if (hasKw(["m.a","m.sc"]))                                               return "-Masters";
    if (hasKw(["b.a","b.sc"]))                                               return "-Bachelors";
  }

  if (t === "offer_letter") {
    const offers = Array.isArray(offerLetters) ? offerLetters : [];
    if (offers[idx]?.university) {
      const uni = offers[idx].university
        .replace(/university of /i,"").replace(/university/i,"")
        .trim().split(/\s+/)[0];
      if (uni) return `-${uni}`;
    }
  }

  return `-${idx + 1}`;
}

function deduplicateFilenames(docs, filenameFn) {
  const names  = {};
  const result = {};
  for (const doc of docs) {
    let name = filenameFn(doc);
    if (names[name] === undefined) {
      names[name] = 0;
    } else {
      names[name]++;
    }
    result[doc.id] = { name, collision: false };
  }
  const seen = {};
  for (const doc of docs) {
    const name = result[doc.id].name;
    if (!seen[name]) { seen[name] = []; }
    seen[name].push(doc.id);
  }
  const suffixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const [name, ids] of Object.entries(seen)) {
    if (ids.length > 1) {
      ids.forEach((id, i) => {
        const dot = name.lastIndexOf(".");
        result[id].name = dot > -1
          ? name.slice(0, dot) + `-${suffixes[i]||i+1}` + name.slice(dot)
          : name + `-${suffixes[i]||i+1}`;
      });
    }
  }
  return result;
}
/* ─── RESUME BUILDER ─────────────────────────────────────────────── */
function ResumeBuilder({ profileData, resume, setResume }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generateResume() {
    if (!profileData || !profileData.fullName || profileData.fullName === "Not found") {
      setError("Student profile is empty. Please analyse a document or load a case first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const prompt = `You are an expert career counsellor. Create a professional, ATS-friendly resume for the following student. 
      You MUST strictly follow the exact text template provided below. Do not deviate from this layout. Do not use markdown code blocks (\`\`\`), just output raw text. Do not include any introductory or concluding conversational text.

      Student Details:
      Name: ${profileData.fullName}
      Nationality: ${profileData.nationality}
      Highest Qualification: ${profileData.program} at ${profileData.university} (${profileData.yearOfPassing})
      Academic Result/GPA: ${profileData.academicResult}
      English Proficiency: IELTS ${profileData.ieltsScore} | TOEFL ${profileData.toeflScore} | PTE ${profileData.pteScore}
      Study Gap context: ${profileData.studyGap}

      REQUIRED TEMPLATE FORMAT:
      ${(profileData.fullName || 'STUDENT NAME').toUpperCase()}
      ${profileData.nationality ? profileData.nationality + ' National' : ''}
      Phone: [Phone Number] | Email: [Email Address] | LinkedIn: [LinkedIn Profile]

      PROFESSIONAL SUMMARY
      [Write a 3-4 sentence strong academic/career objective based on their profile. Focus on their highest qualification and language skills.]

      EDUCATION
      [Degree/Program Name]                                                    [Year]
      [University Name]
      [Result/CGPA]
      
      [Repeat the Education block for all other qualifications provided]

      CORE SKILLS
      • [Relevant Skill 1]
      • [Relevant Skill 2]
      • [Relevant Skill 3]
      • [Relevant Skill 4]
      • [Relevant Skill 5]
      • [Relevant Skill 6]

      PROFESSIONAL EXPERIENCE
      [If the study gap indicates work experience, add this block:]
      [Job Title]                                                              [Start Year - End Year]
      [Company Name]
      • [Placeholder for responsibility]
      • [Placeholder for achievement]
      [If no work experience is indicated, output: "[Please add your relevant work experience, internships, or volunteer positions here]"]

      ADDITIONAL INFORMATION
      • English Proficiency: [List scores here]
      • [Add 1-2 more bullet points based on study gaps or specific profile strengths]`;

      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }]
        }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      setResume(data.content?.map(b => b.text || "").join("") || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function printResume() {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><head><title>${profileData.fullName || "Student"} - Resume</title>
      <style>body{font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #111; max-width: 800px; margin: 40px auto; padding: 20px; white-space: pre-wrap;}</style>
      </head><body>${resume.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
  }

  function copyResume() {
    if (!resume) return;
    navigator.clipboard.writeText(resume);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function clearResume() {
    if (window.confirm("Are you sure you want to clear this resume draft?")) {
      setResume("");
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <div className="rc">
        <div className="rc-hdr">
          <div className="rc-ico"><FileText size={14} color="#4A5D7E"/></div>
          <span className="rc-ttl">AI Resume Builder</span>
        </div>
        <div className="rc-body">
          <div className="toolbar" style={{ justifyContent: "flex-start", marginBottom: 16, gap: "8px", flexWrap: "wrap" }}>
            <button className="btn-p" style={{ width: "auto", padding: "0 16px" }} onClick={generateResume} disabled={loading}>
              {loading ? <Loader2 size={14} style={{animation:"spin 1s linear infinite"}}/> : <FileText size={14}/>}
              {loading ? "Drafting Resume..." : resume ? "Regenerate Resume" : "Generate Resume"}
            </button>
            
            {resume && (
              <>
                <button className="btn-s" onClick={copyResume}>
                  {copied ? <><Check size={13}/> Copied!</> : <><Copy size={13}/> Copy Text</>}
                </button>
                <button className="btn-s" onClick={printResume}>
                  <Printer size={13}/> Print / PDF
                </button>
                <button className="btn-danger" onClick={clearResume}>
                  <Trash2 size={13}/> Clear
                </button>
              </>
            )}
          </div>
          
          {error && <div className="err-banner" style={{ margin: "0 0 16px 0" }}><AlertCircle size={14}/>{error}</div>}
          
          {!resume && !loading && !error && (
            <div className="empty" style={{ padding: "48px 20px" }}>
              <FileText size={36} color="var(--t3)" style={{marginBottom:10, margin:"0 auto"}}/>
              <div className="empty-ttl">No Resume Drafted</div>
              <div className="empty-sub">Click the button above to generate a professional resume based on the extracted student profile.</div>
            </div>
          )}

          {resume && (
            <textarea
              className="notes-area"
              style={{ minHeight: "600px", fontFamily: "var(--fu)", fontSize: "14px" }}
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="Resume text will appear here..."
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN APP ───────────────────────────────────────────────────── */
function VisaLensApp() {
  const [tab,               setTab]               = useState("analyze");
  const [chatMessages, 		setChatMessages] 	  = useState([]);
  const [resumeText, 		setResumeText] 		  = useState("");
  const [docs,              setDocs]              = useState([]);
  const [qualities,         setQualities]         = useState({});
  const [preview,           setPreview]           = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [results,           setResults]           = useState(null);
  const [profileData,       setProfileData]       = useState({});
  const [notes,             setNotes]             = useState("");
  const [savedMsg,          setSavedMsg]          = useState("");
  const [error,             setError]             = useState("");
  const [dragOver,          setDragOver]          = useState(false);
  const [cases,             setCases]             = useState([]);
  const [searchQuery,       setSearchQuery]       = useState("");
  const [searchResults,     setSearchResults]     = useState(null);
  const [searchLoading,     setSearchLoading]     = useState(false);
  const [renameSuggestion,  setRenameSuggestion]  = useState("");
  const [showReport,        setShowReport]        = useState(false);
  const [showZip,           setShowZip]           = useState(false);
  const [darkMode,          setDarkMode]          = useState(false);
  const [customRequirements,setCustomRequirements] = useState(null);
  const [reqsCsvText,       setReqsCsvText]       = useState("");
  const [conflictData,      setConflictData]      = useState(null);
  const [preferredOfferIndex, setPreferredOfferIndex] = useState(0);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [counsellorName, setCounsellorName] = useState("");
  const [docTypes,      setDocTypes]      = useState({});
  const [subTypes,      setSubTypes]      = useState({});
  const [personTags,    setPersonTags]    = useState({});
  const [customLabels,  setCustomLabels]  = useState({});
  const [docDepOpen,    setDocDepOpen]    = useState({});
  const [spouseName,    setSpouseName]    = useState("");
  const [profileDirty,      setProfileDirty]      = useState(false);
  const [reassessing,       setReassessing]       = useState(false);
  const [liveElig,          setLiveElig]          = useState(null); 
  const fileRef = useRef();
  const autoSaveTimer = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      Object.entries(DARK_VARS).forEach(([k,v]) => root.style.setProperty(k,v));
      document.body.classList.add("dm");
    } else {
      Object.keys(DARK_VARS).forEach(k => root.style.removeProperty(k));
      document.body.classList.remove("dm");
    }
  }, [darkMode]);

  useEffect(() => {
    (async () => { try { await window.storage.set("visalens_v14_dark", darkMode?"1":"0"); } catch {} })();
  }, [darkMode]);

  useEffect(() => {
    if (!profileDirty || !results) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try { await window.storage.set("visalens_v14_profile", JSON.stringify(profileData)); } catch {}
    }, 2000);
    return () => clearTimeout(autoSaveTimer.current);
  }, [profileData, profileDirty]);

  useEffect(() => {
    if (!results || !profileDirty) { setLiveElig(null); return; }
    const p = profileData;
    const requiredFields = ["fullName","passportNumber","passportExpiry","ieltsScore","financialBalance","academicResult"];
    const filledCount = requiredFields.filter(k => p[k] && p[k] !== "Not found" && p[k] !== "").length;
    const docScore = Math.round((filledCount / requiredFields.length) * 100);
    let finScore = results.eligibility.financialScore;
    if (p.financialBalance && p.fundsRequired) {
      const avail = parseCurrencyAmount(p.financialBalance);
      const req   = parseCurrencyAmount(p.fundsRequired);
      if (avail.amount !== null && req.amount !== null && avail.currency === req.currency) {
        const ratio = avail.amount / req.amount;
        finScore = ratio >= 1.1 ? 90 : ratio >= 1.0 ? 75 : ratio >= 0.8 ? 45 : 25;
      }
    }
    let acadScore = results.eligibility.academicScore;
    const gpa = parseGPA(p.academicResult || "");
    if (gpa !== null) {
      acadScore = gpa >= 3.5 ? 95 : gpa >= 3.0 ? 80 : gpa >= 2.5 ? 60 : 40;
    }
    const ielts = parseIELTS(p.ieltsScore || "");
    if (ielts !== null) {
      acadScore = Math.round((acadScore + (ielts >= 7.0 ? 95 : ielts >= 6.5 ? 80 : ielts >= 6.0 ? 65 : 50)) / 2);
    }
    const overallScore = Math.round(docScore * 0.3 + finScore * 0.35 + acadScore * 0.35);
    setLiveElig({ ...results.eligibility, overallScore, financialScore: finScore, academicScore: acadScore, documentScore: docScore, _liveComputed: true });
  }, [profileData, profileDirty, results]);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("visalens_v14_profile");
        if (r && r.value && results) {
          const saved = JSON.parse(r.value);
          setProfileData(saved); setProfileDirty(true);
        }
      } catch {}
    })();
  }, [results]);
 useEffect(() => {
  (async () => {
    const remoteCases = await loadCasesFromSupabase();
    if (remoteCases.length > 0) {
      setCases(remoteCases);
    } else {
      try {
        const r = await window.storage.get("visalens_v14");
        if (r) { const parsed = JSON.parse(r.value); setCases(Array.isArray(parsed) ? parsed : []); }
      } catch {}
    }
    try {
      const r = await window.storage.get("visalens_v14_reqs");
      if (r && r.value) {
        const rows = parseCSV(r.value);
        if (rows.length) { setCustomRequirements(csvToRequirements(rows)); setReqsCsvText(r.value); }
      }
    } catch {}
    try {
      const r = await window.storage.get("visalens_v14_dark");
      if (r && r.value === "1") setDarkMode(true);
    } catch {}
  })();
}, []);

async function persist(u) { try { await window.storage.set("visalens_v14", JSON.stringify(u)); } catch {} }

async function saveCaseToSupabase(profile, res, docList, notesText, prefIdx, counsellor) {
  if (!ORG_ID) return null;
  try {
    const resolved = resolveOffer(profile, prefIdx);
    const { data, error } = await supabase.from('cases').insert({
      org_id: ORG_ID,
      student_name: profile.fullName || 'Unknown',
      profile_data: profile,
      results: res,
      doc_list: docList.map(d => ({ name: d.renamed || d.file?.name, type: d.type })),
      notes: notesText || '',
      preferred_offer_index: prefIdx || 0,
      counsellor_name: counsellor || 'Unknown',
      overall_score: res?.eligibility?.overallScore || 0,
      target_country: resolved.country || profile.targetCountry || '',
    }).select('id').single();
    if (error) { console.error('Supabase save error:', error); return null; }
    return data?.id || null;
  } catch (e) { console.error('Supabase save error:', e); return null; }
}

async function loadCasesFromSupabase() {
  if (!ORG_ID) return [];
  try {
    const { data, error } = await supabase
      .from('cases')
      .select('id, created_at, student_name, profile_data, results, doc_list, notes, preferred_offer_index, counsellor_name, overall_score, target_country')
      .eq('org_id', ORG_ID)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error('Supabase load error:', error); return []; }
    return (data || []).map(r => ({
      id: r.id,
      savedAt: r.created_at,
      profile: r.profile_data,
      results: r.results,
      notes: r.notes || '',
      preferredOfferIndex: r.preferred_offer_index || 0,
      counsellorName: r.counsellor_name || '',
      overallScore: r.overall_score || 0,
      targetCountry: r.target_country || '',
      fromSupabase: true,
    }));
  } catch (e) { console.error('Supabase load error:', e); return []; }
}

async function deleteCaseFromSupabase(id) {
  if (!ORG_ID) return;
  try { await supabase.from('cases').delete().eq('id', id); }
  catch (e) { console.error('Supabase delete error:', e); }
}

  const mergedRequirements = customRequirements
    ? { ...UNIVERSITY_DATA, ...customRequirements }
    : UNIVERSITY_DATA;

  async function fileToBase64(file) {
    return new Promise((res,rej) => {
      const r = new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=()=>rej(); r.readAsDataURL(file);
    });
  }
  function parseJSON(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw.replace(/```json\s*|```\s*/g,"").trim()); } catch {}
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch {}
    try {
      const start = raw.indexOf("{");
      if (start !== -1) {
        let depth = 0, i = start;
        for (; i < raw.length; i++) {
          if (raw[i] === "{") depth++;
          else if (raw[i] === "}") { depth--; if (depth === 0) break; }
        }
        if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
      }
    } catch {}
    try {
      const s = raw.replace(/```json\s*|```\s*/g,"").trim();
      if (s.startsWith("{")) {
        let fixed = s;
        let braces = 0, brackets = 0, inStr = false, esc = false;
        for (const ch of fixed) {
          if (esc) { esc = false; continue; }
          if (ch === "\\" && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") braces++;
          else if (ch === "}") braces--;
          else if (ch === "[") brackets++;
          else if (ch === "]") brackets--;
        }
        fixed = fixed.replace(/,\s*$/, "");
        while (brackets > 0) { fixed += "]"; brackets--; }
        while (braces > 0)   { fixed += "}"; braces--; }
        return JSON.parse(fixed);
      }
    } catch {}
    return null;
  }

  async function checkQuality(doc) {
    if (!doc.file.type.startsWith("image/") || doc.file.size > 4*1024*1024) {
      setQualities(p=>({...p,[doc.id]:{status:"ok"}})); return;
    }
    try {
      const b64  = await fileToBase64(doc.file);
      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(withOrg({model:"claude-haiku-4-5-20251001",max_tokens:150,messages:[{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:doc.file.type,data:b64}},
          {type:"text",text:`Assess readability. Reply ONLY JSON: {"status":"ok|warn|error","detail":"one sentence if warn/error, empty if ok"}`}
        ]}]}))
      });
      const data   = await resp.json();
      const txt    = data.content?.map(b=>b.text||"").join("")||"";
      const parsed = parseJSON(txt);
      setQualities(p=>({...p,[doc.id]:parsed||{status:"ok"}}));
    } catch { setQualities(p=>({...p,[doc.id]:{status:"ok"}})); }
  }

  const addFiles = useCallback(files => {
    const newDocs = Array.from(files).map(f=>({id:Math.random().toString(36).slice(2),file:f,type:guessType(f.name),renamed:null}));
    setDocs(p=>[...p,...newDocs]);
    setConflictData(null);
    const newIds = newDocs.map(d => d.id);
    setDocTypes(p => ({ ...p, ...Object.fromEntries(newDocs.map(d=>[d.id, guessType(d.file.name)])) }));
    setPersonTags(p => ({ ...p, ...Object.fromEntries(newIds.map(id=>[id,"primary"])) }));
    setSubTypes(p => ({ ...p, ...Object.fromEntries(newIds.map(id=>[id,""])) }));
    setCustomLabels(p => ({ ...p, ...Object.fromEntries(newIds.map(id=>[id,""])) }));
    setDocDepOpen(p => ({ ...p, ...Object.fromEntries(newIds.map(id=>[id,false])) }));
    newDocs.forEach(d=>{ setQualities(p=>({...p,[d.id]:{status:"checking"}})); checkQuality(d); });
  }, []);

  function removeDocsByNames(fileNames) {
    const nameSet = new Set(fileNames.map(n => n.toLowerCase()));
    setDocs(prev => prev.filter(d => !nameSet.has((d.renamed||d.file.name).toLowerCase())));
  }

  function exportPDF() {
    if (!results || !profileData) return;
    const p = profileData, e = results.eligibility;
    const sc = s => s >= 70 ? "#059669" : s >= 45 ? "#B45309" : "#DC2626";
    const bar = (label, score) => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${label}</span><span style="font-weight:700;color:${sc(score)}">${score}/100</span>
        </div>
        <div style="height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${score}%;background:${sc(score)};border-radius:3px"></div>
        </div>
      </div>`;
    const row = (label, val) => val && val !== "Not found"
      ? `<tr><td style="padding:5px 8px;color:#64748B;font-size:12px;white-space:nowrap">${label}</td><td style="padding:5px 8px;font-size:13px;font-weight:500">${val}</td></tr>`
      : "";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>VisaLens Report — ${p.fullName||"Student"}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;color:#0F1E3C;margin:0;padding:32px;background:#fff}
  h1{font-size:22px;font-weight:700;color:#1D6BE8;margin:0 0 4px}
  .meta{font-size:12px;color:#94A3B8;margin-bottom:24px}
  .section{margin-bottom:22px;break-inside:avoid}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94A3B8;border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge-ok{background:#D1FAE5;color:#059669}
  .badge-warn{background:#FEF3C7;color:#B45309}
  .badge-err{background:#FEE2E2;color:#DC2626}
  .item{padding:8px 10px;border-radius:6px;margin-bottom:6px;font-size:13px}
  .item-warn{background:#FFFBEB;border:1px solid #FCD34D}
  .item-flag-high{background:#FEF2F2;border:1px solid #FCA5A5}
  .item-flag-med{background:#FFFBEB;border:1px solid #FCD34D}
  .item-flag-low{background:#EFF6FF;border:1px solid #BFDBFE}
  .item-title{font-weight:600;margin-bottom:2px}
  .item-detail{font-size:12px;color:#4A5D7E}
  .summary{font-size:13px;color:#4A5D7E;line-height:1.6;margin-bottom:14px}
  .gap-box{background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E;margin-bottom:14px}
  @media print{body{padding:16px}button{display:none}}
</style></head><body>
<h1>VisaLens Student Report</h1>
<div class="meta">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; VisaLens v15</div>

<div class="section">
  <div class="section-title">Personal Information</div>
  <table>
    ${row("Full Name", p.fullName)}${row("Date of Birth", p.dob)}${row("Nationality", p.nationality)}
    ${row("Passport No.", p.passportNumber)}${row("Passport Expiry", p.passportExpiry)}
    ${(()=>{const offers=Array.isArray(p.offerLetters)?p.offerLetters:[];return offers.map((o,i)=>`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px;white-space:nowrap">${i===0?"★ Preferred Offer":"Offer "+(i+1)}</td><td style="padding:5px 8px;font-size:13px;font-weight:500"><span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:600;background:${o.status==="Full"?"#D1FAE5":"#FEF3C7"};color:${o.status==="Full"?"#059669":"#B45309"};margin-right:6px">${o.status||""}</span>${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?` · ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` · ${o.intakeSeason}`:""}${o.conditions?`<br><span style="font-size:11px;color:#B45309">⚠️ Conditions: ${o.conditions}</span>`:""}</td></tr>`).join("");})()}
  </table>
</div>

<div class="section">
  <div class="section-title">Academic Background</div>
  <table>
    ${row("Highest Qualification", p.program + (p.yearOfPassing && p.yearOfPassing!=="Not found" ? ` (${p.yearOfPassing})` : ""))}
    ${row("University", p.university)}
  </table>
  ${p.studyGap && p.studyGap !== "Not found" ? `<div class="gap-box">⚠️ Study Gap: ${p.studyGap}</div>` : ""}
  ${p.academicResult && p.academicResult !== "Not found" ? `<div style="font-size:12px;color:#4A5D7E;white-space:pre-line;padding:8px 10px;background:#F8FAFC;border-radius:6px;border:1px solid #E2E8F0">${p.academicResult}</div>` : ""}
</div>

<div class="section">
  <div class="section-title">English Qualifications</div>
  <table>
    ${row("IELTS", p.ieltsScore)}${row("TOEFL", p.toeflScore)}${row("PTE", p.pteScore)}${p.otherEnglishTest&&p.otherEnglishTest!=="Not found"?row("Other English Test/Cert", p.otherEnglishTest):""}${p.mediumOfInstruction&&p.mediumOfInstruction!=="Not found"?row("Medium of Instruction", p.mediumOfInstruction):""}
  </table>
</div>

<div class="section">
  <div class="section-title">Financial</div>
  <table>${row("Account Holder", p.financialHolder)}${row("Funds Available", p.financialBalance)}${p.fundsRequired?row("Funds Required", p.fundsRequired):""}${(()=>{if(!p.fundsRequired||!p.financialBalance)return"";const a=parseCurrencyAmount(p.financialBalance),r=parseCurrencyAmount(p.fundsRequired);if(a.amount===null||r.amount===null)return`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEF3C7;color:#B45309;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">Cannot parse — verify manually</span></td></tr>`;if(a.currency!==r.currency)return`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEF3C7;color:#B45309;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">⚠️ Currency mismatch — manual check required</span></td></tr>`;const d=a.amount-r.amount;return d>=0?`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#D1FAE5;color:#059669;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">✓ Appears sufficient (+${a.currency} ${d.toLocaleString()})</span><br><span style="font-size:11px;color:#64748B">Verify this figure reflects current visa rules before submission.</span></td></tr>`:`<tr><td style="padding:5px 8px;color:#64748B;font-size:12px">Sufficiency</td><td style="padding:5px 8px;font-size:13px"><span style="background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">✗ Shortfall of ${a.currency} ${Math.abs(d).toLocaleString()}</span></td></tr>`;})()}</table>
</div>

<div class="section">
  <div class="section-title">Visa Eligibility — Executive Summary</div>
  <div class="summary">${e.summary||""}</div>
  ${bar("Overall Eligibility", e.overallScore)}
  ${bar("Financial Strength", e.financialScore)}
  ${bar("Academic Standing", e.academicScore)}
  ${bar("Document Completeness", e.documentScore)}
  ${e.notes?.length ? `<ul style="margin:10px 0 0;padding-left:18px">${e.notes.map(n=>`<li style="font-size:12px;color:#4A5D7E;margin-bottom:4px">${n}</li>`).join("")}</ul>` : ""}
</div>

${results.rejections?.length ? `<div class="section">
  <div class="section-title">Rejections &amp; Deferments</div>
  ${results.rejections.map(r=>`<div class="item item-flag-high">
    <div class="item-title">${r.type==="visa"?"Visa Rejection":r.type==="deferment"?"Deferment":"Admission Rejection"}${r.country?` — ${r.country}`:""}${r.date?` (${r.date})`:""}</div>
    ${r.university?`<div class="item-detail">${r.university}${r.program?`, ${r.program}`:""}</div>`:""}
    ${r.reason?`<div class="item-detail">${r.reason}</div>`:""}
  </div>`).join("")}
</div>` : ""}

${results.missingDocuments?.length ? `<div class="section">
  <div class="section-title">Gaps &amp; Concerns</div>
  ${results.missingDocuments.map(d=>`<div class="item item-warn">
    <div class="item-title">${d.document}</div>
    <div class="item-detail">${d.reason}</div>
  </div>`).join("")}
</div>` : ""}

${results.redFlags?.length ? `<div class="section">
  <div class="section-title">Risk Flags</div>
  ${results.redFlags.map(f=>`<div class="item item-flag-${f.severity==="high"?"high":f.severity==="medium"?"med":"low"}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
      <span class="badge badge-${f.severity==="high"?"err":f.severity==="medium"?"warn":"ok"}">${f.severity.toUpperCase()}</span>
      <span class="item-title">${f.flag}</span>
    </div>
    <div class="item-detail">${f.detail}</div>
  </div>`).join("")}
</div>` : ""}

${notes ? `<div class="section"><div class="section-title">Counselor Notes</div><div style="font-size:13px;color:#4A5D7E;white-space:pre-wrap;padding:10px;background:#F8FAFC;border-radius:6px;border:1px solid #E2E8F0">${notes}</div></div>` : ""}

</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  }

  async function buildContent(docList, prompt, personTagsMap = {}) {
    const content = [];
    const personLabel = t => t === "spouse" ? "Spouse (Dependant)" : t === "child" ? "Child (Dependant)" : "Student (Primary Applicant)";
    for (const doc of docList) {
      const ptag = personTagsMap[doc.id] || "primary";
      content.push({type:"text",text:`--- File: "${doc.renamed||doc.file.name}" | Type: ${getDT(doc.type).label} | Person: ${personLabel(ptag)} ---`});
      if (doc.file.type.startsWith("image/"))       content.push({type:"image",  source:{type:"base64",media_type:doc.file.type,data:await fileToBase64(doc.file)}});
      else if (doc.file.type==="application/pdf")   content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:await fileToBase64(doc.file)}});
      else content.push({type:"text",text:`[Content]: ${(await doc.file.text()).slice(0,2000)}`});
    }
    content.push({type:"text",text:prompt});
    return content;
  }

  async function callAPI(content, maxTokens=1500) {
    const resp = await fetch(PROXY_URL, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(withOrg({model:"claude-haiku-4-5-20251001",max_tokens:maxTokens,messages:[{role:"user",content}]}))
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message||"API error");
    return data.content?.map(b=>b.text||"").join("")||"";
  }

  async function analyze() {
    if (!docs.length) return;
    setLoading(true); setError(""); setResults(null); setProfileData({}); setNotes(""); setSavedMsg(""); setActiveCaseId(null); setSearchResults(null); setConflictData(null);
    try {
      const conflictContent = await buildContent(docs,
        `You are a document identity checker for a student visa counselling system.

DEPENDANT DOCUMENT TAGGING:
Each document is pre-tagged with a "Person:" label in its file header. Tags used:
- "Student (Primary Applicant)" — belongs to the student being assessed
- "Spouse (Dependant)" — belongs to the student's spouse / partner
- "Child (Dependant)" — belongs to a child dependant
IMPORTANT: Do NOT flag Spouse-tagged or Child-tagged identity documents as identity conflicts with the Student. Only check for identity conflicts WITHIN Student-tagged documents. If all Student-tagged identity-bearing docs show the same person → there is NO conflict, regardless of how many Spouse or Child docs are present.

DEFINITIONS:
- Identity-bearing documents: passport, national ID, birth certificate, academic transcript, degree certificate, offer letter, enrollment letter, IELTS/TOEFL result.
- Financial documents: bank statement, bank letter, sponsorship letter, affidavit of support, proof of funds.

SPONSOR EVIDENCE RULES — only classify a financial document's name as a "confirmed sponsor" if at least ONE of these is true:
1. Same surname as the student
2. A visible money transfer TO the student's account shown in the statement
3. Explicit "sponsor", "guardian", or "father/mother of" language in the document
If NONE of these apply → classify that person as "unrelated" not as a sponsor.

RICHNESS SCORING — for each identity found across identity-bearing documents only, score them:
- Passport: 4 pts
- National ID: 3 pts
- Academic transcript / degree: 2 pts each
- Offer letter / enrollment letter: 2 pts
- IELTS/TOEFL result: 1 pt
Use this to rank identities and suggest the most likely intended student (highest score = likelyStu).

Return ONLY valid JSON — no markdown, no explanation:
{
  "identityConflicts": [
    {
      "name": "Full name or Unknown",
      "identifiers": "e.g. passport no, DOB",
      "files": ["exact filename"],
      "richnessScore": 0,
      "likelyStu": true
    }
  ],
  "sponsorAdvisory": {
    "confirmed": true,
    "sponsors": [
      {
        "name": "Sponsor name",
        "evidenceBasis": "same surname | transfer to student | explicit language",
        "files": ["financial doc filenames"]
      }
    ],
    "unrelated": [
      {
        "name": "Unrelated person name",
        "files": ["filenames"],
        "reason": "No surname match, no transfer to student, no sponsorship language"
      }
    ]
  }
}

Rules:
- identityConflicts must list EVERY distinct person found on Student-tagged identity-bearing documents only. Ignore Spouse-tagged and Child-tagged documents for conflict detection.
- If only ONE person on Student-tagged identity-bearing docs → identityConflicts has one entry (no conflict).
- sponsorAdvisory.confirmed = true only if at least one confirmed sponsor exists.
- sponsorAdvisory.unrelated lists financial-doc names that could NOT be verified as sponsors.
- Always populate both fields even if empty arrays.`
      , personTags);
      const conflictRaw    = await callAPI(conflictContent, 900);
      const conflictParsed = parseJSON(conflictRaw);

      const identities = conflictParsed?.identityConflicts || [];
      const advisory   = conflictParsed?.sponsorAdvisory   || {};
      const hasConflict   = identities.length > 1;
      const hasAdvisory   = advisory.confirmed && advisory.sponsors?.length > 0;
      const hasUnrelated  = advisory.unrelated?.length > 0;

      if (hasConflict || hasUnrelated) {
        setConflictData({ identities, advisory, hasUnrelated, type: "conflict" });
        setLoading(false);
        return;
      }

      if (hasAdvisory) {
        setConflictData({ identities, advisory, type: "advisory" });
      }

      const content = await buildContent(docs, `You are an expert student visa counselor assistant. Analyse all documents and return ONLY valid JSON — no markdown, no explanation, no extra text. Use "Not found" for missing string fields and 0 for missing scores.
{"studentProfile":{"fullName":"","dob":"","nationality":"","passportNumber":"","passportExpiry":"","cnicNumber":"","cnicExpiry":"","program":"","yearOfPassing":"","university":"","targetCountry":"","offerLetters":[{"status":"Full|Conditional","university":"","country":"","program":"","intakeSeason":"","conditions":""}],"financialBalance":"","financialHolder":"","academicResult":"","studyGap":"","ieltsScore":"","toeflScore":"","pteScore":"","otherEnglishTest":"","mediumOfInstruction":"","detectedDocs":[], "nameMismatches":[]},"rejections":[{"type":"visa|admission|deferment","country":"","university":"","program":"","date":"","reason":""}],"missingDocuments":[{"document":"","reason":""}],"eligibility":{"overallScore":0,"financialScore":0,"academicScore":0,"documentScore":0,"summary":"","notes":[]},"redFlags":[{"flag":"","severity":"high|medium|low","detail":""}]}

DEPENDANT DOCUMENT HANDLING:
Each document is pre-tagged with a "Person:" label in its file header:
- "Student (Primary Applicant)" → use for ALL studentProfile field extraction (name, DOB, passport, academic, English, financial)
- "Spouse (Dependant)" → do NOT use for student name, DOB, passport number, academic qualifications, or English test scores; if spouse financial docs exist they belong to a dependant and should NOT be used to populate financialBalance/financialHolder unless the funds are explicitly shown as transferred to or held for the student; flag any concerns in missingDocuments or redFlags
- "Child (Dependant)" → ignore entirely for studentProfile extraction
Extract ALL studentProfile fields EXCLUSIVELY from Student-tagged documents.

Field extraction rules:
- program: the student's HIGHEST or most recent COMPLETED qualification (e.g. "Master of Arts in English").
- yearOfPassing: the year the highest qualification was completed/awarded (e.g. "2023"). "Not found" if absent.
- university: institution where that highest qualification was obtained.
- targetCountry: destination country if determinable from context (e.g. student mentions a country without a formal offer). "Not found" if absent. This is a low-priority fallback field — if offerLetters has entries, those take precedence.
- offerLetters: an ARRAY — one entry per offer/admission letter found. If NO offer letter is found, return an EMPTY ARRAY []. NEVER return "Not found" inside this array. Each entry: status = exactly "Full" or "Conditional"; university = exact institution name; country = country of the institution; program = specific programme the offer is for; intakeSeason = intake month/year or season (e.g. "September 2026", "Fall 2026") or "Not found"; conditions = any stated conditions (e.g. "IELTS 6.5 by August 2026", "subject to degree verification") or empty string "".
- cnicNumber: the 13-digit CNIC number if a Pakistani CNIC card is present (format: XXXXX-XXXXXXX-X). "Not found" if absent.
- cnicExpiry: the expiry date printed on the CNIC card. "Not found" if absent.
- financialHolder: full name of account holder as printed on bank statement. "Not found" if absent.
- financialBalance: balance/amount from financial document (e.g. "PKR 5,495,000"). "Not found" if absent.
- academicResult: list EACH qualification on a SEPARATE line. Format: "[Degree] ([Year if known]): [Result/Grade]".
- studyGap: Follow these steps exactly:
	(1) List every qualification with its completion year in chronological order.
	(2) Estimate the START year of each qualification using these standard durations:
    - Matric/O-Levels = 2 years
    - Intermediate/FSc/FA/A-Levels = 2 years
    - Bachelor's/BA/BS/BBA/BCS/BCom = 4 years (2 years if explicitly stated)
    - Master's/MA/MS/MBA/MCS/MCom = 2 years
    - PhD/doctorate = 4 years
    Estimated start year = completion year − standard duration.
	(3) For each consecutive pair of qualifications, calculate the gap between:
    PREVIOUS qualification's completion year → NEXT qualification's estimated start year.
    If this gap exceeds 24 months, flag it.
	(4) Calculate the gap between the MOST RECENT qualification's completion year and 2026. This step is MANDATORY even if there is only one qualification. If this gap exceeds 24 months, flag it.
	(5) Format each flagged gap as: "X year(s) gap between [Qualification A] ([Year]) and [Qualification B / present] ([Year])"  — use "present (2026)" for step 4.
	(6) If NO gap exceeds 24 months, output "Not found".
	IMPORTANT: Never assume a student was continuously studying just because two qualifications exist. Always verify using estimated start years.
- missingDocuments: flag (a) missing required documents with reasons, (b) unclear/insufficient financial evidence, (c) unverified sponsor documentation, AND (d) any study gap over 24 months as a separate concern item (e.g. {"document":"Study Gap","reason":"3-year gap between BA (2018) and MA enrolment (2021) — no explanation provided"}).
- ieltsScore, toeflScore, pteScore: numeric strings (e.g. "6.5", "95", "65"). "Not found" if absent.
- otherEnglishTest: ONLY populate if an actual test RESULT or CERTIFICATE document is present proving the student HAS taken the test and received a score/grade. If more than one test RESULT or CERTIFICATE document is present, list each one in a SEPARATE line. Format: "[Test Name] — [Score/Grade]" (e.g. "OET — Grade B", "Duolingo — 115"). Do NOT populate from offer letter requirements, university conditions, visa checklists, or any document that merely lists accepted tests or requests the student to provide one. "Not found" if no actual result document exists.
- nameMismatches: an ARRAY of name discrepancies found across identity and academic documents. Compare the full name as it appears on EACH document against the passport name. Even minor spelling differences count (e.g. "Maqbool" vs "Maqbol", "Muhammad" vs "Muhammed", missing middle name, different order of names). Format: [{"doc":"document type or filename","nameFound":"exact name as written","issue":"brief description of mismatch"}]. Return empty array [] if all names match or if only one identity document is present.
- mediumOfInstruction: if any document explicitly states or implies that the student's degree/programme was taught in English (e.g. "medium of instruction: English", "all courses taught in English", "English-medium university"), capture a brief description (e.g. "English — stated on degree certificate", "English — confirmed on transcript"). "Not found" if absent.
- rejections: all visa rejections, admission rejections, and deferments found. Empty array [] if none.
- detectedDocs: an ARRAY of special documents actually found. Only include entries where physical evidence exists in the uploaded documents. Each entry: {"type":"","reference":"","amount":"","date":"","expiry":"","result":"","institution":"","notes":""}. Document types to detect: "IHS Receipt" (UK Immigration Health Surcharge — extract reference number, expiry, amount), "TB Certificate" (extract result: Clear/Not Clear, date, clinic, expiry), "University Fee Receipt" (extract amount, date, university name), "Application Fee Receipt" (extract amount, date, institution), "Health Insurance Certificate" (extract provider, coverage amount, validity dates), "Visa Fee Receipt" (extract amount, date), "Accommodation Confirmation" (extract provider, address, dates). Leave unused fields as empty string "". Return empty array [] if none found.
Score 0-100. Keep summary and flag details concise. Return ONLY the JSON object.`, personTags);
      const raw    = await callAPI(content, 2500);
      const parsed = parseJSON(raw);
      if (!parsed) throw new Error("Could not parse analysis response — the AI returned an unexpected format. Please try again.");
      const safeArr = (v) => Array.isArray(v) ? v : [];
      parsed.rejections        = safeArr(parsed.rejections);
      parsed.missingDocuments  = safeArr(parsed.missingDocuments);
      parsed.redFlags          = safeArr(parsed.redFlags);
      if (parsed.eligibility) parsed.eligibility.notes = safeArr(parsed.eligibility?.notes);
      if (parsed.studentProfile) parsed.studentProfile.offerLetters = safeArr(parsed.studentProfile?.offerLetters);
      setResults(parsed);
      const migratedProfile = migrateOfferLetter({...parsed.studentProfile});
      setProfileData(migratedProfile);
      setProfileDirty(false);
      setLiveElig(null);
      setPreferredOfferIndex(0);
      const name = parsed.studentProfile.fullName;
      if (name && name!=="Not found") setRenameSuggestion(name.replace(/\s+/g,"_"));
    } catch(e) { setError(e.message||"Analysis failed."); }
    finally { setLoading(false); }
  }

  async function doSearch() {
    if (!searchQuery.trim()||!docs.length) return;
    setSearchLoading(true); setSearchResults(null);
    try {
      const content = await buildContent(docs, `Search query: "${searchQuery}"\nFor each document determine if it contains info related to this query. Return ONLY JSON array:\n[{"filename":"","found":true|false,"snippet":"short excerpt or empty"}]\nOne entry per document in order.`);
      const raw = await callAPI(content, 600);
      setSearchResults(parseJSON(raw)||[]);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }

  function clearAll() {
    setDocs([]); setQualities({}); setResults(null); setProfileData({});
    setNotes(""); setSavedMsg(""); setError(""); setActiveCaseId(null);  setSearchQuery("");
    setSearchResults(null); setRenameSuggestion(""); setConflictData(null);
    setPreferredOfferIndex(0);
    setDocTypes({}); setSubTypes({}); setPersonTags({}); setCustomLabels({}); setDocDepOpen({});
    setSpouseName(""); setProfileDirty(false); setLiveElig(null);
    setChatMessages([]); // <-- ADD THIS LINE
	setResumeText("");
    try { window.storage.delete("visalens_v14_profile"); } catch {}
  }

  function setProfileDataDirty(updater) {
    setProfileData(updater);
    setProfileDirty(true);
  }
  function applyRenameAll() {
    if (!renameSuggestion) return;
    setDocs(p=>p.map(d=>{ const t=getDT(d.type).label.replace(/\s*\/\s*/g,"-").replace(/\s+/g,"_").replace(/[()]/g,""); const ext=d.file.name.split(".").pop()||""; return {...d,renamed:`${renameSuggestion}_${t}.${ext}`}; }));
  }
  function applyRenameOne(id, type) {
    const t=getDT(type).label.replace(/\s*\/\s*/g,"-").replace(/\s+/g,"_").replace(/[()]/g,"");
    const ext=docs.find(d=>d.id===id)?.file.name.split(".").pop()||"";
    setDocs(p=>p.map(d=>d.id===id?{...d,renamed:`${renameSuggestion}_${t}.${ext}`}:d));
  }

  function handleSaveNotes() { setSavedMsg("Notes saved"); setTimeout(()=>setSavedMsg(""),2500); }
  async function handleSaveCase() {
  if (!results) return;
  setSavedMsg("Saving…");

  if (activeCaseId) {
    // ── Updating an existing case ──
    await updateCaseInSupabase(activeCaseId, notes, preferredOfferIndex);
    setCases(prev => prev.map(c =>
      c.id === activeCaseId ? { ...c, notes, preferredOfferIndex } : c
    ));
    setSavedMsg("Case updated ✓");
  } else {
    // ── Saving a brand new case ──
    const caseId = await saveCaseToSupabase(profileData, results, docs, notes, preferredOfferIndex, counsellorName);
    if (caseId) {
      setActiveCaseId(caseId);
      const remoteCases = await loadCasesFromSupabase();
      setCases(remoteCases);        // ← this line was missing
      setSavedMsg("Case saved ✓");
      setCounsellorName("");
    } else {
      const newId = Date.now().toString();
      const updated = [{ id: newId, savedAt: new Date().toISOString(), results, profile: profileData, notes, preferredOfferIndex }, ...cases];
      setActiveCaseId(newId);
      setCases(updated); persist(updated);
      setSavedMsg("Saved locally (no org_id)");
      setCounsellorName("");
    }
  }
  setTimeout(() => setSavedMsg(""), 2500);
}
  function handleLoadCase(c) {
    setActiveCaseId(c.id);
    setResults(c.results);
    const migratedProfile = migrateOfferLetter(c.profile||c.results.studentProfile||{});
    setProfileData(migratedProfile);
    setPreferredOfferIndex(c.preferredOfferIndex || 0);
    setNotes(c.notes||"");
    setProfileDirty(false); setLiveElig(null);
    setTab("analyze");
  }
	async function handleDeleteCase(id) {
	await deleteCaseFromSupabase(id);
	const u = cases.filter(c => c.id !== id);
	setCases(u); persist(u);
	}
	async function updateCaseInSupabase(id, notesText, prefIdx) {
  if (!ORG_ID) return;
  try {
    const { error } = await supabase.from('cases')
      .update({
        notes: notesText || '',
        preferred_offer_index: prefIdx || 0,
      })
      .eq('id', id);
    if (error) console.error('Supabase update error:', error);
  } catch (e) { console.error('Supabase update error:', e); }
}
async function renameCounsellorInSupabase(oldName, newName) {
  if (!ORG_ID) return;
  try {
    const { error } = await supabase.from('cases')
      .update({ counsellor_name: newName })
      .eq('counsellor_name', oldName)
      .eq('org_id', ORG_ID);
    if (error) console.error('Rename error:', error);
  } catch (e) { console.error('Rename error:', e); }
}
  async function reAssess() {
    if (!results || !profileDirty) return;
    setReassessing(true);
    try {
      const p = profileData;
      const offers = Array.isArray(p.offerLetters) ? p.offerLetters : [];
      const profileSummary = `
EDITED STUDENT PROFILE (manually updated by counsellor — use this as ground truth):
Name: ${p.fullName||"Not found"}
DOB: ${p.dob||"Not found"}
Nationality: ${p.nationality||"Not found"}
Passport: ${p.passportNumber||"Not found"} (expires ${p.passportExpiry||"Not found"})
Offer Letters: ${offers.length ? offers.map((o,i)=>`${i===0?"[Preferred] ":""}${o.status||""} — ${o.university||""}${o.country?`, ${o.country}`:""}${o.program&&o.program!=="Not found"?`, ${o.program}`:""}${o.intakeSeason&&o.intakeSeason!=="Not found"?` (${o.intakeSeason})`:""}${o.conditions?` | Conditions: ${o.conditions}`:""}`).join(" / ") : "None"}
Highest Qualification: ${p.program||"Not found"} (${p.yearOfPassing||"year unknown"})
University: ${p.university||"Not found"}
Academic Results: ${p.academicResult||"Not found"}
Study Gap: ${p.studyGap||"None"}
IELTS: ${p.ieltsScore||"Not found"} | TOEFL: ${p.toeflScore||"Not found"} | PTE: ${p.pteScore||"Not found"}
Other English Test/Cert: ${p.otherEnglishTest||"Not found"}
Medium of Instruction: ${p.mediumOfInstruction||"Not found"}
Financial Balance: ${p.financialBalance||"Not found"}
Financial Holder: ${p.financialHolder||"Not found"}
Funds Required: ${p.fundsRequired||"Not entered"}

ORIGINAL AI ASSESSMENT (for context only — update based on edited profile):
Overall Score: ${results.eligibility.overallScore}/100
Missing Docs: ${(results.missingDocuments||[]).map(m=>m.document).join(", ")||"None"}
Red Flags: ${(results.redFlags||[]).map(f=>`[${f.severity}] ${f.flag}`).join(", ")||"None"}
Rejections: ${(results.rejections||[]).length} found
`;
      const prompt = `${profileSummary}

Based on the EDITED profile above, return ONLY valid JSON updating the eligibility assessment. Do not re-read documents — use only the profile data above.

{"eligibility":{"overallScore":0,"financialScore":0,"academicScore":0,"documentScore":0,"summary":"","notes":[]},"missingDocuments":[{"document":"","reason":""}],"redFlags":[{"flag":"","severity":"high|medium|low","detail":""}]}

Rules: scores 0-100. Summary max 2 sentences. Reflect any improvements from edited fields. Return ONLY the JSON object.`;

      const resp = await fetch(PROXY_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(withOrg({ model:"claude-haiku-4-5-20251001", max_tokens:800,
          messages:[{role:"user",content:prompt}] }))
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const raw    = data.content?.map(b=>b.text||"").join("")||"";
      const parsed = parseJSON(raw);
      if (parsed) {
        const toArr = (v, fallback) => Array.isArray(v) ? v : fallback;
        setResults(prev => ({
          ...prev,
          eligibility:     parsed.eligibility     || prev.eligibility,
          missingDocuments:toArr(parsed.missingDocuments, prev.missingDocuments),
          redFlags:        toArr(parsed.redFlags,         prev.redFlags),
        }));
        setLiveElig(null); 
        setProfileDirty(false);
        setSavedMsg("Re-assessment complete"); setTimeout(()=>setSavedMsg(""),3000);
      }
    } catch(e) { setError("Re-assessment failed: " + (e.message||"Unknown error")); }
    finally { setReassessing(false); }
  }

  async function handleLoadRequirements(reqs, csvText) {
    setCustomRequirements(reqs);
    setReqsCsvText(csvText);
    try { await window.storage.set("visalens_v14_reqs", csvText); } catch {}
  }
  async function handleClearRequirements() {
    setCustomRequirements(null);
    setReqsCsvText("");
    try { await window.storage.delete("visalens_v14_reqs"); } catch {}
  }

  return (
    <>
      {preview    && <PreviewModal doc={preview} onClose={()=>setPreview(null)}/>}
      {showReport && <ReportModal profile={profileData} results={results} onClose={()=>setShowReport(false)}/>}
      {showZip    && docs.length > 0 && (
        <ZipModal
          docs={docs}
          studentName={profileData?.fullName && profileData.fullName !== "Not found" ? profileData.fullName : ""}
          offerLetters={profileData?.offerLetters || []}
          docTypes={docTypes}     setDocTypes={setDocTypes}
          subTypes={subTypes}     setSubTypes={setSubTypes}
          personTags={personTags} setPersonTags={setPersonTags}
          customLabels={customLabels} setCustomLabels={setCustomLabels}
          spouseName={spouseName} setSpouseName={setSpouseName}
          onClose={()=>setShowZip(false)}
        />
      )}

      <div className="app">
        <header className="hdr">
          <div className="logo">
            <div className="logo-mark"><ShieldCheck size={15}/></div>
            <span className="logo-name">VisaLens</span>
            <span className="logo-tag">v16</span>
          </div>
          <div className="hdr-r">
            <button className="dm-toggle" onClick={()=>setDarkMode(d=>!d)} title={darkMode?"Switch to Light Mode":"Switch to Dark Mode"}>
              {darkMode ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
            <div className="pip"/>AI Active
          </div>
        </header>

        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab==="analyze"}      className={`tab${tab==="analyze"?" on":""}`}      onClick={()=>setTab("analyze")}><FileText size={13}/>Analyse</button>
          <button role="tab" aria-selected={tab==="chat"}         className={`tab${tab==="chat"?" on":""}`}         onClick={()=>setTab("chat")}><MessageSquare size={13}/>AI Chat{results&&<span className="tab-ct">✓</span>}</button>
          <button role="tab" aria-selected={tab==="resume"} className={`tab${tab==="resume"?" on":""}`} onClick={()=>setTab("resume")}> <FileText size={13}/>Resume Builder</button>
		  <button role="tab" aria-selected={tab==="requirements"} className={`tab${tab==="requirements"?" on":""}`} onClick={()=>setTab("requirements")}>
            <FileSpreadsheet size={13}/>Requirements
            {customRequirements && <span className="tab-ct">CSV</span>}
          </button>
          <button role="tab" aria-selected={tab==="dashboard"}    className={`tab${tab==="dashboard"?" on":""}`}    onClick={()=>setTab("dashboard")}><LayoutDashboard size={13}/>Dashboard{cases.length>0&&<span className="tab-ct">{cases.length}</span>}</button>
          <button role="tab" aria-selected={tab==="history"}      className={`tab${tab==="history"?" on":""}`}      onClick={()=>setTab("history")}><FolderOpen size={13}/>Case History</button>
        </nav>

        <main className="main">

          {/* ── ANALYSE ── */}
          {tab==="analyze" && (
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Student Document <em>Analyser</em></h1>
                <p className="pg-sub">Upload documents · AI extracts profile, scores eligibility, checks requirements · doc presence checker included</p>
              </div>
              <div className="grid">
                <aside>
                  <div className="card">
                    <div className="card-hdr">
                      <span className="card-ttl"><Upload size={12}/>Documents</span>
                      {docs.length>0&&<span className="badge b-neu">{docs.length} file{docs.length!==1?"s":""}</span>}
                    </div>
                    <div className={`dz${dragOver?" over":""}`}
                      onClick={()=>fileRef.current?.click()}
                      onDragOver={e=>{e.preventDefault();setDragOver(true)}}
                      onDragLeave={()=>setDragOver(false)}
                      onDrop={e=>{e.preventDefault();setDragOver(false);addFiles(e.dataTransfer.files)}}
                      role="button" tabIndex={0} onKeyDown={e=>e.key==="Enter"&&fileRef.current?.click()}>
                      <div className="dz-ico"><Upload size={18}/></div>
                      <div className="dz-h">Drop files here</div>
                      <div className="dz-s">PDFs, images, text · <span className="dz-link">browse files</span></div>
                    </div>
                    <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.txt" style={{display:"none"}} onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>

                    {docs.length>0&&(
                      <>
                        {renameSuggestion&&(
                          <div className="rename-row">
                            <input className="rename-input" value={renameSuggestion} onChange={e=>setRenameSuggestion(e.target.value)} placeholder="Student name prefix…"/>
                            <button className="btn-rename" onClick={applyRenameAll}>Rename All</button>
                          </div>
                        )}
                        <div className="doc-list">
                          {docs.map(doc=>{
                            const t      = docTypes[doc.id] || doc.type || "other";
                            const {Icon} = getDT(t);
                            const q      = qualities[doc.id];
                            const rowCls = q?.status==="error"?" qerr":q?.status==="warn"?" qwarn":"";
                            const isImg  = doc.file.type.startsWith("image/");
                            const person = personTags[doc.id] || "primary";
                            const depOpen = !!docDepOpen[doc.id];
                            return (
                              <div key={doc.id} className={`doc-row${rowCls}`}>
                                <div className="doc-thumb" onClick={()=>setPreview(doc)} role="button">
                                  {isImg?<ThumbImg file={doc.file}/>:<Icon size={16} color="#4A5D7E"/>}
                                  <div className="thumb-ov"><ZoomIn size={12} color="#fff"/></div>
                                </div>
                                <div className="doc-meta">
                                  <div className="doc-fn">{doc.renamed||doc.file.name}</div>
                                  {doc.renamed&&<div className="doc-ren">↳ {doc.file.name}</div>}
                                  <select className="doc-sel" value={t}
                                    onChange={e=>{
                                      setDocTypes(p=>({...p,[doc.id]:e.target.value}));
                                      setSubTypes(p=>({...p,[doc.id]:""}));
                                    }}>
                                    {Object.entries(DOC_TYPES.reduce((a,dt)=>{if(!a[dt.group])a[dt.group]=[];a[dt.group].push(dt);return a},{})).map(([grp,items])=>(
                                      <optgroup key={grp} label={grp}>
                                        {items.map(dt=><option key={dt.value} value={dt.value}>{dt.label}</option>)}
                                      </optgroup>
                                    ))}
                                  </select>
                                  {t === "transcript" && (
                                    <select className="doc-sel doc-subsel"
                                      value={subTypes[doc.id]||""}
                                      onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}>
                                      {TRANSCRIPT_LEVELS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                  )}
                                  {t === "offer_letter" && (
                                    <input className="doc-subin"
                                      value={subTypes[doc.id]||""}
                                      onChange={e=>setSubTypes(p=>({...p,[doc.id]:e.target.value}))}
                                      placeholder="University (e.g. Sheffield)"/>
                                  )}
                                  {t === "other" && (
                                    <input className="doc-subin"
                                      value={customLabels[doc.id]||""}
                                      onChange={e=>setCustomLabels(p=>({...p,[doc.id]:e.target.value}))}
                                      placeholder="Describe document…"/>
                                  )}
                                  {person !== "primary" && (
                                    <div className="doc-person-active">
                                      {person === "spouse" ? "👫 Spouse" : "👶 Child"}
                                      <button className="doc-person-clear" onClick={()=>setPersonTags(p=>({...p,[doc.id]:"primary"}))}><X size={9}/></button>
                                    </div>
                                  )}
                                  {person === "primary" && (
                                    <button className="doc-dep-toggle" onClick={()=>setDocDepOpen(p=>({...p,[doc.id]:!depOpen}))}>
                                      {depOpen ? <><ChevronDown size={9} style={{transform:"rotate(180deg)"}}/> Hide</> : <>+ Dependant</>}
                                    </button>
                                  )}
                                  {depOpen && person === "primary" && (
                                    <div className="doc-dep-row">
                                      <button className="doc-dep-btn" onClick={()=>{setPersonTags(p=>({...p,[doc.id]:"spouse"}));setDocDepOpen(p=>({...p,[doc.id]:false}));}}>Spouse</button>
                                      <button className="doc-dep-btn" onClick={()=>{setPersonTags(p=>({...p,[doc.id]:"child"}));setDocDepOpen(p=>({...p,[doc.id]:false}));}}>Child</button>
                                    </div>
                                  )}
                                  {q?.status==="checking"&&<span className="doc-qb chk"><Loader2 size={9} style={{animation:"spin .7s linear infinite"}}/>Checking…</span>}
                                  {q?.status==="warn"&&<span className="doc-qb warn"><TriangleAlert size={9}/>Low quality</span>}
                                  {q?.status==="error"&&<span className="doc-qb err"><EyeOff size={9}/>Unreadable</span>}
                                </div>
                                <div className="doc-acts">
                                  <button className="btn-ico" onClick={()=>setPreview(doc)}><Eye size={12}/></button>
                                  {renameSuggestion&&<button className="btn-ico" onClick={()=>applyRenameOne(doc.id,t)}><Pencil size={12}/></button>}
                                  <button className="btn-ico d" onClick={()=>{
                                    setDocs(p=>p.filter(d=>d.id!==doc.id));
                                    setQualities(p=>{const n={...p};delete n[doc.id];return n;});
                                    setDocTypes(p=>{const n={...p};delete n[doc.id];return n;});
                                    setPersonTags(p=>{const n={...p};delete n[doc.id];return n;});
                                    setSubTypes(p=>{const n={...p};delete n[doc.id];return n;});
                                    setCustomLabels(p=>{const n={...p};delete n[doc.id];return n;});
                                    setDocDepOpen(p=>{const n={...p};delete n[doc.id];return n;});
                                  }}><X size={12}/></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {error&&<div className="err-banner"><AlertCircle size={14} style={{flexShrink:0,marginTop:1}}/><span>{error}</span></div>}
                    <div className="btn-wrap" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button className="btn-p" style={{flex:1}} disabled={!docs.length||loading} onClick={analyze}>
                        {loading?<><Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/>Checking documents…</>:<><ShieldCheck size={16}/>Analyse {docs.length>0?`${docs.length} `:""}Document{docs.length!==1?"s":""}</>}
                      </button>
                      {(docs.length>0||results)&&(
                        <button className="btn-clear-all" onClick={clearAll} title="Clear all documents and results">
                          <Trash2 size={14}/>Clear All
                        </button>
                      )}
                    </div>
                    {docs.length > 0 && (
                      <button className="btn-download-folder" onClick={()=>setShowZip(true)}>
                        <Download size={13}/>Download Organised Folder
                      </button>
                    )}

                    {docs.length>0&&(
                      <div className="search-panel">
                        <div className="card-ttl" style={{marginBottom:10}}><Search size={12}/>Search Documents</div>
                        <div className="search-row">
                          <input className="search-input" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()} placeholder="e.g. financial balance, IELTS score…"/>
                          {searchQuery&&(
                            <button className="btn-search-clear" onClick={()=>{setSearchQuery("");setSearchResults(null);}} title="Clear search">
                              <X size={12}/>
                            </button>
                          )}
                          <button className="btn-search" onClick={doSearch} disabled={!searchQuery.trim()||searchLoading}>
                            {searchLoading?<Loader2 size={13} style={{animation:"spin .7s linear infinite"}}/>:<Search size={13}/>}
                            {searchLoading?"…":"Search"}
                          </button>
                        </div>
                        {searchResults!==null&&(
                          searchResults.filter(r=>r.found).length===0
                            ? <div className="search-none">"{searchQuery}" not found in any document.</div>
                            : searchResults.filter(r=>r.found).map((r,i)=>(
                              <div key={i} className="sr">
                                <CheckCircle size={14} color="#1D6BE8" style={{flexShrink:0,marginTop:1}}/>
                                <div><div className="sr-name">{r.filename}</div><div className="sr-snip">{r.snippet}</div></div>
                              </div>
                            ))
                        )}
                      </div>
                    )}

                    {docs.length > 0 && (
                      <div className="sb-panels">
                        <SidebarDocChecklist profile={profileData} preferredOfferIndex={preferredOfferIndex} docs={docs} docTypes={docTypes}/>
                        <SidebarVisaChecklist profile={profileData} preferredOfferIndex={preferredOfferIndex}/>
                      </div>
                    )}
                  </div>
                </aside>

                <div>
                  {loading&&<Skeleton/>}

                  {!loading&&conflictData&&conflictData.type==="conflict"&&(
                    <div className="conflict-banner">
                      <div className="conflict-header">
                        <AlertCircle size={18} color="#DC2626" style={{flexShrink:0}}/>
                        <div>
                          <div className="conflict-title">
                            {conflictData.identities?.length > 1
                              ? `Profile Conflict — ${conflictData.identities.length} Identities Detected`
                              : "Unverified Document Name Detected"}
                          </div>
                          <div className="conflict-sub">
                            {conflictData.identities?.length > 1
                              ? conflictData.identities.length > 2
                                ? `${conflictData.identities.length} different individuals found across identity documents. The most likely intended student is highlighted. Remove the others to proceed.`
                                : "Documents from 2 different students were found. Remove the wrong student's files before analysing."
                              : "A financial document belongs to someone who could not be verified as a sponsor or family member."}
                          </div>
                        </div>
                      </div>

                      {conflictData.identities?.length > 1 && (
                        <div className="conflict-students">
                          {[...conflictData.identities]
                            .sort((a,b) => (b.richnessScore||0) - (a.richnessScore||0))
                            .map((s,i)=>(
                            <div key={i} className={`conflict-student${s.likelyStu?" conflict-likely":""}`}>
                              <div className="conflict-s-header">
                                <div className="conflict-s-name">
                                  {s.likelyStu
                                    ? <span className="conflict-s-badge likely-badge">★ Likely Student</span>
                                    : <span className="conflict-s-badge">Identity {i+1}</span>}
                                  {s.name}
                                </div>
                                <div className="conflict-s-ids">{s.identifiers}{s.richnessScore!=null ? ` · ${s.richnessScore} doc pts` : ""}</div>
                              </div>
                              <div className="conflict-files">
                                {s.files.map((f,j)=><span key={j} className="conflict-file-pill">{f}</span>)}
                              </div>
                              <div className="conflict-s-actions">
                                {!s.likelyStu && (
                                  <button className="conflict-this-is-my-btn" onClick={()=>{
                                    const othersFiles = conflictData.identities
                                      .filter(x => x.name !== s.name)
                                      .flatMap(x => x.files);
                                    removeDocsByNames(othersFiles);
                                  }}>
                                    <CheckCircle size={13}/>This is my student — remove others
                                  </button>
                                )}
                                <button className="conflict-remove-btn" onClick={()=>removeDocsByNames(s.files)}>
                                  <Trash2 size={13}/>Remove {s.files.length} file{s.files.length!==1?"s":""}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {conflictData.hasUnrelated && conflictData.advisory?.unrelated?.length > 0 && (
                        <div className="conflict-unrelated">
                          <div className="conflict-unrelated-ttl">
                            <AlertCircle size={13} color="#92400E"/>
                            Unverified Financial Document{conflictData.advisory.unrelated.length>1?"s":""}
                          </div>
                          {conflictData.advisory.unrelated.map((u,i)=>(
                            <div key={i} className="conflict-student" style={{borderColor:"#FCD34D",background:"#FFFBEB"}}>
                              <div className="conflict-s-header">
                                <div className="conflict-s-name">
                                  <span className="conflict-s-badge" style={{background:"#FEF3C7",color:"#92400E"}}>Unverified</span>
                                  {u.name}
                                </div>
                                <div className="conflict-s-ids">{u.reason}</div>
                              </div>
                              <div className="conflict-files">
                                {u.files.map((f,j)=><span key={j} className="conflict-file-pill" style={{background:"#FEF3C7",borderColor:"#FCD34D",color:"#92400E"}}>{f}</span>)}
                              </div>
                              <div className="conflict-s-actions">
                                <button className="conflict-remove-btn" style={{color:"#92400E",background:"#FEF3C7",borderColor:"#FCD34D"}} onClick={()=>removeDocsByNames(u.files)}>
                                  <Trash2 size={13}/>Remove this document
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="conflict-footer">
                        <div className="conflict-hint">
                          Remove all flagged documents above, then click the button to run analysis.
                        </div>
                        <button className="conflict-proceed-btn" onClick={()=>{ setConflictData(null); analyze(); }}>
                          <ShieldCheck size={14}/>All clear — Run Analysis
                        </button>
                      </div>
                    </div>
                  )}

                  {conflictData&&conflictData.type==="advisory"&&conflictData.advisory?.sponsors?.length>0&&(
                    <div className="advisory-banner">
                      <div className="advisory-header">
                        <Info size={15} color="#92400E" style={{flexShrink:0,marginTop:1}}/>
                        <div>
                          <div className="advisory-title">Sponsor / Parent Financial Documents Detected</div>
                          <div className="advisory-note">The following financial document{conflictData.advisory.sponsors.length>1?"s are":"is"} in a sponsor's name. This is normal — analysis has used the student's identity documents only.</div>
                        </div>
                      </div>
                      {conflictData.advisory.sponsors.map((sp,i)=>(
                        <div key={i} className="advisory-sponsor">
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                            <span className="advisory-sponsor-label">Sponsor:</span>
                            <strong>{sp.name}</strong>
                            {sp.evidenceBasis&&<span style={{fontSize:11,color:"#78350F",background:"#FEF3C7",padding:"2px 7px",borderRadius:6}}>✓ {sp.evidenceBasis}</span>}
                          </div>
                          {sp.files?.length>0&&(
                            <div className="conflict-files">
                              {sp.files.map((f,j)=><span key={j} className="advisory-file-pill">{f}</span>)}
                            </div>
                          )}
                        </div>
                      ))}
                      <button className="advisory-dismiss" onClick={()=>setConflictData(null)}>Dismiss</button>
                    </div>
                  )}

                  {!loading&&!conflictData&&!results&&(
                    <div className="empty">
                      <FileText size={40} className="empty-ico" color="#94A3B8"/>
                      <div className="empty-ttl">No analysis yet</div>
                      <div className="empty-sub">Upload student documents and click Analyse.<br/>Profile extraction, eligibility scoring, doc checklist + risk flags all appear here.</div>
                    </div>
                  )}
                  {results&&(
                    <>
                      <div className="toolbar">
                        <button className="btn-s" onClick={()=>setShowReport(true)}><Send size={13}/>Share Report</button>
                        <button className="btn-s" onClick={exportPDF}><Printer size={13}/>Export PDF</button>
                        {profileDirty&&(
                          <button className="btn-reassess" onClick={reAssess} disabled={reassessing}>
                            {reassessing
                              ? <><Loader2 size={13} style={{animation:"spin .7s linear infinite"}}/>Re-assessing…</>
                              : <><RefreshCw size={13}/>Re-assess with edits</>
                            }
                          </button>
                        )}
                        {profileDirty&&!reassessing&&(
                          <span className="toolbar-dirty-badge"><Edit3 size={10}/>Unsaved edits · auto-saving…</span>
                        )}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:14}}>
                        <QualityCard docs={docs} qualities={qualities}/>
                        <ProfileCard data={profileData} setData={setProfileDataDirty} preferredOfferIndex={preferredOfferIndex} setPreferredOfferIndex={setPreferredOfferIndex} requirementsData={mergedRequirements}/>
                        <UniversityChecker profile={profileData} requirementsData={mergedRequirements} preferredOfferIndex={preferredOfferIndex}/>
                        <RejectionsCard items={results.rejections||[]}/>
                        <EligCard data={liveElig||results.eligibility} summary={results.eligibility.summary} profile={profileData} isLive={!!liveElig}/>
                        <MissingCard items={results.missingDocuments||[]}/>
                        <FlagsCard flags={results.redFlags||[]}/>
						<NotesCard notes={notes} setNotes={setNotes} onSave={handleSaveNotes} onSaveCase={handleSaveCase} savedMsg={savedMsg} counsellorName={counsellorName} setCounsellorName={setCounsellorName} cases={cases}/>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── CHAT ── */}
          {tab==="chat"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">AI <em>Counsellor Chat</em></h1>
                <p className="pg-sub">Ask questions about the loaded student profile · uses extracted context, not raw images · fast &amp; cost-effective</p>
              </div>
              <ChatPanel 
                profileData={profileData} 
                results={results} 
                docs={docs} 
                messages={chatMessages} 
                setMessages={setChatMessages} 
              />
            </>
          )}

{/* ── RESUME ── */}
          {tab==="resume"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Resume <em>Builder</em></h1>
                <p className="pg-sub">Generate and edit a professional, ATS-friendly CV based on the student's extracted data</p>
              </div>
              {/* UPDATE THIS LINE TO PASS THE PROPS */}
              <ResumeBuilder profileData={profileData} resume={resumeText} setResume={setResumeText} />
            </>
          )}

          {/* ── REQUIREMENTS ── */}
          {tab==="requirements"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">University <em>Requirements</em></h1>
                <p className="pg-sub">Upload a CSV of university + programme requirements · data persists across sessions · University Checker uses this data</p>
              </div>
              <RequirementsManager
                customRequirements={customRequirements}
                csvText={reqsCsvText}
                onLoad={handleLoadRequirements}
                onClear={handleClearRequirements}
              />
            </>
          )}

          {/* ── DASHBOARD ── */}
          {tab==="dashboard"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Student <em>Dashboard</em></h1>
                <p className="pg-sub">Overview of all saved cases · click any row to open full analysis</p>
              </div>
			<Dashboard cases={cases} onLoad={c=>{handleLoadCase(c);setTab("analyze");}} key={cases.length}/>
            </>
          )}

          {/* ── HISTORY ── */}
          {tab==="history"&&(
            <>
              <div className="pg-hdr">
                <h1 className="pg-title">Case <em>History</em></h1>
                <p className="pg-sub">{cases.length} saved case{cases.length!==1?"s":""} · stored in Visalens cloud</p>
              </div>
<CaseHistory
  cases={cases}
  onLoad={handleLoadCase}
  onDelete={handleDeleteCase}
  onRenameCounsellor={async (oldName, newName) => {
    await renameCounsellorInSupabase(oldName, newName);
    const remoteCases = await loadCasesFromSupabase();
    setCases(remoteCases);
  }}
/>
            </>
          )}

        </main>
      </div>
    </>
  );
}

/* ─── INVITE GATE ────────────────────────────────────────────────── */
const DEMO_CODES = ["VISALENS-DEMO-2026", "VL-PREVIEW", "VL-ACCESS"];
const GATE_KEY   = "visalens_demo_auth";


function InviteGate({ onUnlock }) {
  const [code,    setCode]    = useState("");
  const [error,   setError]   = useState("");
  const [shake,   setShake]   = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function attempt() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setTimeout(() => {
      const valid = DEMO_CODES.some(c => c.toUpperCase() === trimmed);
      if (valid) {
        try { window.localStorage.setItem(GATE_KEY, trimmed); } catch {}
        onUnlock();
      } else {
        setError("Invalid access code. Contact us to request a demo.");
        setShake(true);
        setTimeout(() => setShake(false), 450);
        setLoading(false);
      }
    }, 600);
  }

  function handleKey(e) { if (e.key === "Enter") attempt(); }

  return (
    <>
      <div className="gate-wrap">
        <div className={`gate-card${shake?" shake":""}`}>
          <div className="gate-logo">
            <div className="gate-logo-mark"><ShieldCheck size={22} color="#fff"/></div>
            <span className="gate-logo-name">VisaLens</span>
            <span className="gate-logo-tag">DEMO</span>
          </div>

          <div className="gate-title">AI-Powered Student Visa Analysis</div>
          <div className="gate-sub">Enter your access code to begin<br/>your personalised demo session</div>

          <div className="gate-feature-list">
            {[
              "Instant document analysis & profile extraction",
              "Eligibility scoring across financial, academic & docs",
              "Auto document checklist + risk flag detection",
              "WhatsApp & email-ready reports in one click",
            ].map((f, i) => (
              <div key={i} className="gate-feature">
                <div className="gate-feature-dot"/>
                {f}
              </div>
            ))}
          </div>

          <div className="gate-divider"/>

          <div className="gate-field">
            <label className="gate-lbl">Access Code</label>
            <input
              ref={inputRef}
              className="gate-input"
              type="text"
              placeholder="e.g. VISALENS-DEMO-2026"
              value={code}
              onChange={e => { setCode(e.target.value); setError(""); }}
              onKeyDown={handleKey}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button className="gate-btn" onClick={attempt} disabled={!code.trim() || loading}>
            {loading
              ? <><Loader2 size={16} style={{animation:"spin .7s linear infinite"}}/>Verifying…</>
              : <><ShieldCheck size={16}/>Access Demo</>
            }
          </button>

          {error && (
            <div className="gate-err">
              <AlertCircle size={13} style={{flexShrink:0}}/>
              {error}
            </div>
          )}

          <div className="gate-footer">
            Don't have an access code?<br/>
            Contact us to arrange a personalised demo session.
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── ROOT APP WRAPPER ───────────────────────────────────────────── */
function App() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      const stored = window.localStorage.getItem(GATE_KEY);
      return stored ? DEMO_CODES.some(c => c.toUpperCase() === stored.toUpperCase()) : false;
    } catch { return false; }
  });

  if (!unlocked) return <InviteGate onUnlock={() => setUnlocked(true)}/>;
  return <VisaLensApp/>;
}

export default App;
