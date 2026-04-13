// ── src/constants/countries.js ────────────────────────────────────────────────
// Country-level metadata, ISO codes, currencies, visa doc requirements,
// the built-in university dataset, and the downloadable CSV template.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------

/* ─── COUNTRY META LOOKUP ─────────────────────────────────────────── */
export const COUNTRY_META = {
  "United Kingdom": { flag: "🇬🇧", visaType: "UK Student Visa (Tier 4)" },
  "Finland":        { flag: "🇫🇮", visaType: "Finland Student Residence Permit" },
  "Germany":        { flag: "🇩🇪", visaType: "Germany Student Visa (Nationales Visum)" },
  "Canada":         { flag: "🇨🇦", visaType: "Canada Study Permit" },
  "Australia":      { flag: "🇦🇺", visaType: "Australia Student Visa (Subclass 500)" },
  "United States":  { flag: "🇺🇸", visaType: "USA F-1 Student Visa" },
  "Netherlands":    { flag: "🇳🇱", visaType: "Netherlands MVV Student Visa" },
  "Sweden":         { flag: "🇸🇪", visaType: "Sweden Residence Permit for Studies" },
  "Ireland":        { flag: "🇮🇪", visaType: "Ireland Student Visa" },
  "New Zealand":    { flag: "🇳🇿", visaType: "New Zealand Student Visa" },
};
export function getCountryMeta(c) {
  return COUNTRY_META[c] || { flag: "🌍", visaType: `${c} Student Visa` };
}

/* ─── COUNTRY ISO-2 MAP ───────────────────────────────────────────── */
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

/* ─── COUNTRY → CURRENCY MAP ──────────────────────────────────────── */
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

/* ─── VISA DOC TYPE REQUIREMENTS ─────────────────────────────────── */
export const VISA_DOC_TYPES = {
  "United Kingdom": [
    { item: "Valid Passport",             docType: "passport",          required: true },
    { item: "Offer Letter / CAS",         docType: "offer_letter",      required: true },
    { item: "Bank Statement",             docType: "bank_statement",    required: true },
    { item: "Academic Transcripts",       docType: "transcript",        required: true },
    { item: "English Language Test",      docType: "language_test",     required: true },
    { item: "Financial / Sponsor Proof",  docType: "financial_proof",   required: true },
    { item: "Recommendation Letter",      docType: "recommendation",    required: false },
    { item: "Family Registration Cert",   docType: "family_reg_cert",   required: false },
    { item: "Marriage Registration Cert", docType: "marriage_reg_cert", required: false },
  ],
  "Finland": [
    { item: "Valid Passport",             docType: "passport",          required: true },
    { item: "Acceptance Letter",          docType: "offer_letter",      required: true },
    { item: "Bank Statement",             docType: "bank_statement",    required: true },
    { item: "Academic Transcripts",       docType: "transcript",        required: true },
    { item: "English Language Test",      docType: "language_test",     required: true },
    { item: "Financial Proof",            docType: "financial_proof",   required: true },
    { item: "Recommendation Letter",      docType: "recommendation",    required: false },
    { item: "Family Registration Cert",   docType: "family_reg_cert",   required: false },
    { item: "Marriage Registration Cert", docType: "marriage_reg_cert", required: false },
  ],
};

export const GENERIC_VISA_DOCS = [
  { item: "Valid Passport",           docType: "passport",          required: true },
  { item: "Offer / Admission Letter", docType: "offer_letter",      required: true },
  { item: "Bank Statement",           docType: "bank_statement",    required: true },
  { item: "Academic Transcripts",     docType: "transcript",        required: true },
  { item: "Language Test Result",     docType: "language_test",     required: true },
  { item: "Financial Proof",          docType: "financial_proof",   required: true },
  { item: "Recommendation Letter",    docType: "recommendation",    required: false },
  { item: "Family Registration Cert",   docType: "family_reg_cert",   required: false },
  { item: "Marriage Registration Cert", docType: "marriage_reg_cert", required: false },
];

/* ─── UNIVERSITY DATA ─────────────────────────────────────────────── */
export const UNIVERSITY_DATA = {
  "United Kingdom": {
    flag: "🇬🇧", visaType: "UK Student Visa (Tier 4)",
    visaChecklist: [
      { item: "Valid Passport",              note: "Must be valid for duration of course + 6 months",              required: true },
      { item: "CAS Number",                  note: "Confirmation of Acceptance for Studies from university",       required: true },
      { item: "Financial Proof",             note: "£1,334/month in London or £1,023/month outside London",        required: true },
      { item: "Academic Transcripts",        note: "All previous degrees/qualifications",                          required: true },
      { item: "English Language Test",       note: "IELTS UKVI, TOEFL or equivalent",                             required: true },
      { item: "Tuberculosis Test Result",    note: "Required for applicants from certain countries (Pakistan, India etc.)", required: true },
      { item: "Bank Statements",             note: "Last 28 days, showing required funds maintained",              required: true },
      { item: "Passport Photos",             note: "2 recent passport-sized photos",                               required: true },
      { item: "Immigration Health Surcharge",note: "£776/year (student), paid online before applying",             required: true },
      { item: "Unconditional Offer Letter",  note: "From a UKVI-licensed sponsor university",                     required: true },
    ],
    universities: {
      "University of Sheffield": { ranking: "QS #113", programs: [
        { name: "MA English Literature",              level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 18000, duration: "1 year",  tuition: 22000 },
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 18000, duration: "1 year",  tuition: 26000 },
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 18000, duration: "1 year",  tuition: 27000 },
        { name: "MBA",                                level: "Postgraduate", ielts: 6.5, gpa: 3.2, financial: 18000, duration: "1 year",  tuition: 32000 },
        { name: "MSc Civil Engineering",              level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 18000, duration: "1 year",  tuition: 25000 },
      ]},
      "University of Manchester": { ranking: "QS #32", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 20000, duration: "1 year",  tuition: 29000 },
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 20000, duration: "1 year",  tuition: 30000 },
        { name: "MBA",                                level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 20000, duration: "1 year",  tuition: 46000 },
        { name: "MSc Electrical Engineering",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 20000, duration: "1 year",  tuition: 26000 },
        { name: "MSc Finance",                        level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 20000, duration: "1 year",  tuition: 31000 },
      ]},
      "University of Birmingham": { ranking: "QS #84", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 23000 },
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 23000 },
        { name: "MSc Mechanical Engineering",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 24000 },
        { name: "MBA",                                level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 16000, duration: "1 year",  tuition: 38000 },
      ]},
      "University of Leeds": { ranking: "QS #75", programs: [
        { name: "MSc Data Science & Analytics",       level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 25000 },
        { name: "MSc Civil Engineering",              level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 24000 },
        { name: "MSc International Business",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 26000 },
      ]},
      "University of Exeter": { ranking: "QS #150", programs: [
        { name: "MSc Business Analytics",             level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 23000 },
        { name: "MSc Climate Change",                 level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 16000, duration: "1 year",  tuition: 21000 },
      ]},
      "University of Sussex": { ranking: "QS #201-250", programs: [
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 2.8, financial: 15000, duration: "1 year",  tuition: 21000 },
        { name: "MSc International Relations",        level: "Postgraduate", ielts: 6.0, gpa: 2.8, financial: 15000, duration: "1 year",  tuition: 20000 },
      ]},
      "University of Portsmouth": { ranking: "QS #601-650", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 13000, duration: "1 year",  tuition: 16500 },
        { name: "MBA",                                level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 13000, duration: "1 year",  tuition: 16000 },
      ]},
      "University of Wolverhampton": { ranking: "QS #1001+", programs: [
        { name: "MSc Information Technology",         level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 12000, duration: "1 year",  tuition: 13500, note: "Accepts 2.5 GPA; good safety option" },
        { name: "MBA",                                level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 12000, duration: "1 year",  tuition: 13000 },
      ]},
      "London Metropolitan University": { ranking: "QS #1001+", programs: [
        { name: "MSc Information Technology",         level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 15000, duration: "1 year",  tuition: 14000 },
        { name: "MBA",                                level: "Postgraduate", ielts: 6.0, gpa: 2.5, financial: 15000, duration: "1 year",  tuition: 13500 },
      ]},
    },
  },

  "Germany": {
    flag: "🇩🇪", visaType: "Germany Student Visa (Nationales Visum)",
    visaChecklist: [
      { item: "Valid Passport",               note: "Valid for entire study duration",                                    required: true },
      { item: "University Admission Letter",  note: "Zulassungsbescheid from a German university",                       required: true },
      { item: "Blocked Account (Sperrkonto)", note: "€11,208/year (€934/month) as of 2024, e.g. via Deutsche Bank or Fintiba", required: true },
      { item: "Academic Transcripts",         note: "Degree certificates + transcripts with certified translations",      required: true },
      { item: "German/English Proficiency",   note: "TestDaF / DSH for German programmes; IELTS 6.5+ for English programmes", required: true },
      { item: "Health Insurance",             note: "German statutory (gesetzliche) health insurance, e.g. TK, AOK",     required: true },
      { item: "Passport Photos",              note: "Biometric photos, 35×45mm",                                         required: true },
      { item: "Proof of Accommodation",       note: "Student dormitory or rental agreement",                              required: false },
    ],
    universities: {
      "Technical University of Munich": { ranking: "QS #37", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 11208, duration: "2 years", tuition: 0,    note: "Tuition-free; proof of living costs required" },
        { name: "MSc Mechanical Engineering",         level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 11208, duration: "2 years", tuition: 0 },
        { name: "MSc Data Engineering & Analytics",   level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 11208, duration: "2 years", tuition: 0 },
      ]},
      "RWTH Aachen University": { ranking: "QS #106", programs: [
        { name: "MSc Mechanical Engineering",         level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 11208, duration: "2 years", tuition: 0 },
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 11208, duration: "2 years", tuition: 0 },
      ]},
      "University of Stuttgart": { ranking: "QS #301-350", programs: [
        { name: "MSc Electrical Engineering",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 11208, duration: "2 years", tuition: 1500 },
        { name: "MSc Infrastructure Planning",        level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 11208, duration: "2 years", tuition: 1500 },
      ]},
    },
  },

  "Canada": {
    flag: "🇨🇦", visaType: "Canada Study Permit",
    visaChecklist: [
      { item: "Valid Passport",               note: "Must be valid for entire study duration",                            required: true },
      { item: "Acceptance Letter",            note: "From a IRCC-designated learning institution (DLI)",                 required: true },
      { item: "Proof of Financial Support",   note: "CAD 10,000/year (first year) + tuition fees",                      required: true },
      { item: "Academic Transcripts",         note: "All previous education records",                                    required: true },
      { item: "English/French Proficiency",   note: "IELTS 6.5+ or TOEFL 83+ for English programmes",                  required: true },
      { item: "Passport Photos",              note: "2 recent passport photos",                                          required: true },
      { item: "Statement of Purpose",         note: "Explaining why you want to study in Canada",                        required: false },
      { item: "Medical Exam",                 note: "Required if from certain countries or course > 6 months",           required: false },
    ],
    universities: {
      "University of Toronto": { ranking: "QS #25", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 7.0, gpa: 3.7, financial: 25000, duration: "2 years", tuition: 30000, note: "Very competitive — acceptance rate ~15%" },
        { name: "MBA",                                level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 25000, duration: "2 years", tuition: 90000 },
      ]},
      "University of British Columbia": { ranking: "QS #34", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.5, financial: 22000, duration: "2 years", tuition: 25000 },
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.5, financial: 22000, duration: "1 year",  tuition: 26000 },
      ]},
      "York University": { ranking: "QS #451-500", programs: [
        { name: "MBA",                                level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 20000, duration: "2 years", tuition: 22000 },
        { name: "MSc Information Technology",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 20000, duration: "2 years", tuition: 18000 },
      ]},
    },
  },

  "Australia": {
    flag: "🇦🇺", visaType: "Australia Student Visa (Subclass 500)",
    visaChecklist: [
      { item: "Valid Passport",               note: "Must be valid for entire study period",                              required: true },
      { item: "Confirmation of Enrolment (CoE)", note: "From a CRICOS-registered institution",                           required: true },
      { item: "Genuine Temporary Entrant (GTE)", note: "Statement demonstrating intent to return after studies",          required: true },
      { item: "Financial Proof",              note: "AUD 29,710/year living costs + tuition fees",                       required: true },
      { item: "English Proficiency",          note: "IELTS 6.0+ (overall); some courses require 6.5",                   required: true },
      { item: "Health Insurance (OSHC)",      note: "Overseas Student Health Cover for entire visa period",              required: true },
      { item: "Academic Transcripts",         note: "All previous degrees with certified translations if needed",         required: true },
      { item: "Passport Photos",              note: "Recent biometric-quality photos",                                    required: true },
    ],
    universities: {
      "University of Melbourne": { ranking: "QS #33", programs: [
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 30000, duration: "2 years", tuition: 42000 },
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 30000, duration: "2 years", tuition: 43000 },
      ]},
      "University of Sydney": { ranking: "QS #18", programs: [
        { name: "MSc Cybersecurity",                  level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 28000, duration: "1.5 years", tuition: 45000 },
        { name: "MSc Engineering",                    level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 28000, duration: "2 years",   tuition: 47000 },
      ]},
      "University of Queensland": { ranking: "QS #40", programs: [
        { name: "MSc Information Technology",         level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 28000, duration: "2 years", tuition: 39000 },
        { name: "MSc Renewable Energy Engineering",   level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 30000, duration: "2 years", tuition: 51000 },
      ]},
      "Australian National University": { ranking: "QS #30", programs: [
        { name: "Master of International Relations",  level: "Postgraduate", ielts: 7.0, gpa: 3.5, financial: 30000, duration: "2 years", tuition: 48000 },
        { name: "MSc Environment",                    level: "Postgraduate", ielts: 6.5, gpa: 3.2, financial: 30000, duration: "2 years", tuition: 49000 },
      ]},
      "Monash University": { ranking: "QS #37", programs: [
        { name: "Master of Cybersecurity",            level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 30000, duration: "2 years", tuition: 49000 },
        { name: "Bachelor of Nursing",                level: "Undergraduate", ielts: 7.0, gpa: 3.0, financial: 30000, duration: "3 years", tuition: 43000 },
      ]},
    },
  },

  "Finland": {
    flag: "🇫🇮", visaType: "Finland Student Residence Permit",
    visaChecklist: [
      { item: "Valid Passport",               note: "Valid for entire study period + return",                             required: true },
      { item: "University Acceptance Letter", note: "Official admission letter from Finnish university",                  required: true },
      { item: "Proof of Financial Means",     note: "€6,720/year minimum (€560/month)",                                  required: true },
      { item: "Proof of Tuition Fee Payment", note: "Receipt of first year tuition payment",                             required: true },
      { item: "Health Insurance",             note: "Valid for Finland, minimum €30,000 coverage",                       required: true },
      { item: "Academic Transcripts",         note: "All previous degrees with certified translations",                  required: true },
      { item: "English Language Test",        note: "IELTS 6.0+ or TOEFL 79+ for English-taught programmes",            required: true },
      { item: "Passport Photos",              note: "2 recent passport-sized photos (biometric)",                        required: true },
      { item: "Completed Application Form",   note: "Online via EnterFinland.fi portal",                                 required: true },
      { item: "Proof of Accommodation",       note: "Student housing confirmation or rental agreement",                  required: false },
    ],
    universities: {
      "University of Helsinki": { ranking: "QS #107", programs: [
        { name: "MSc Computer Science",               level: "Postgraduate", ielts: 6.5, gpa: 3.5, financial: 10000, duration: "2 years", tuition: 15000, note: "Acceptance rate 17% — highly competitive" },
        { name: "MSc Data Science",                   level: "Postgraduate", ielts: 6.5, gpa: 3.5, financial: 10000, duration: "2 years", tuition: 15000 },
        { name: "MA Linguistics",                     level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 9000,  duration: "2 years", tuition: 13000 },
        { name: "MSc Ecology & Evolutionary Biology", level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 9000,  duration: "2 years", tuition: 13000 },
      ]},
      "Aalto University": { ranking: "QS #109", programs: [
        { name: "MSc Engineering (Mechanical)",       level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 14000, duration: "2 years", tuition: 15000 },
        { name: "MSc Business Administration",        level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 14000, duration: "2 years", tuition: 15000 },
        { name: "MSc Arts & Design",                  level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 12000, duration: "2 years", tuition: 12000 },
        { name: "MSc Information Networks",           level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 14000, duration: "2 years", tuition: 15000 },
      ]},
      "Tampere University": { ranking: "QS #351-400", programs: [
        { name: "MSc Software Engineering",           level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 10000, duration: "2 years", tuition: 12000 },
        { name: "MSc Health Sciences",                level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 9000,  duration: "2 years", tuition: 10000 },
        { name: "MSc Biomedical Engineering",         level: "Postgraduate", ielts: 6.5, gpa: 3.2, financial: 10000, duration: "2 years", tuition: 12000 },
      ]},
      "University of Turku": { ranking: "QS #401-450", programs: [
        { name: "MSc Bioinformatics",                 level: "Postgraduate", ielts: 6.5, gpa: 3.3, financial: 10000, duration: "2 years", tuition: 12000 },
        { name: "MA Education",                       level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 8000,  duration: "2 years", tuition: 10000 },
        { name: "MSc Future Technologies",            level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 10000, duration: "2 years", tuition: 11000 },
      ]},
      "LUT University": { ranking: "QS #651-700", programs: [
        { name: "MSc Industrial Engineering",         level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 10000, duration: "2 years", tuition: 10000 },
        { name: "MSc Energy Technology",              level: "Postgraduate", ielts: 6.0, gpa: 3.0, financial: 10000, duration: "2 years", tuition: 10000 },
        { name: "MSc Business Analytics",             level: "Postgraduate", ielts: 6.5, gpa: 3.0, financial: 10000, duration: "2 years", tuition: 10000 },
      ]},
    },
  },
};

/* ─── CSV TEMPLATE (downloadable) ────────────────────────────────── */
export const TEMPLATE_CSV =
`Country,University,Ranking,Program,Level,Min_IELTS,Min_GPA,Min_Financial,Duration,Tuition,Notes
United Kingdom,London Metropolitan University,QS #1001+,MSc Information Technology,Postgraduate,6.0,2.5,15000,1 year,14000,Good entry point for lower GPA applicants
United Kingdom,University of Bedfordshire,QS #1001+,MBA,Postgraduate,6.0,2.5,14000,1 year,13500,Accepts students with gap years
Germany,Technical University of Munich,QS #37,MSc Computer Science,Postgraduate,7.0,3.5,12000,2 years,0,Tuition-free; proof of living costs required
Germany,RWTH Aachen University,QS #106,MSc Mechanical Engineering,Postgraduate,6.5,3.3,11000,2 years,0,
Canada,University of Toronto,QS #25,MSc Computer Science,Postgraduate,7.0,3.7,25000,2 years,30000,Very competitive — acceptance rate ~15%
Canada,York University,QS #451-500,MBA,Postgraduate,6.5,3.0,20000,2 years,22000,
Australia,University of Melbourne,QS #33,MSc Data Science,Postgraduate,6.5,3.3,30000,2 years,42000,
Australia,University of Sydney,QS #18,MSc Cybersecurity,Postgraduate,6.5,3.3,28000,1.5 years,45000,`;
