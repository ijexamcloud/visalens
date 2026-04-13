// ─── SHARED DOC SCORE ENGINE ──────────────────────────────────────────────────
// Single source of truth — imported by both StudentDashboard.jsx and ExpiryCard.jsx.
// Previously duplicated in two places with a "keep in sync" comment; now canonical here.
//
// CHANGELOG
//   - Extracted from StudentDashboard.jsx / ExpiryCard.jsx into shared module
//   - Fixed partial detection: all 6 non-passport categories now compute partial
//     properly instead of hardcoding `false`. A category is "partial" when the
//     primary identifying field is absent but at least one related field is present,
//     meaning the document may have been partially processed or only one side uploaded.
//   - v1.3: Added SCORE_VERSION export for analytics snapshot pipeline.
//     RULE: bump this integer whenever any scoring weight changes. Every
//     case_snapshots row stores this value so historical trends remain comparable.

// ─── SCORE VERSION ─────────────────────────────────────────────────────────────
// Bump this integer any time scoring weights change in computeDocScore() or
// viabilityScore(). The snapshot cron writes this into every case_snapshots row.
// Never remove or rename this export — the Edge Function depends on it.
export const SCORE_VERSION = 1;

export function isDocVal(v) {
  return v != null && v !== '' && String(v).trim() !== '' && String(v).trim() !== 'Not found';
}

export function computeDocScore(profileData, results) {
  const p  = profileData || {};
  const md = ((results || {}).missingDocuments || []).map(d => (d.document || '').toLowerCase());

  // ── Passport ────────────────────────────────────────────────────────────────
  const passportNum    = isDocVal(p.passportNumber);
  const passportExpiry = isDocVal(p.passportExpiry);
  const passportExpired = (() => {
    if (!passportExpiry) return false;
    const parts = (p.passportExpiry || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    let iso = null;
    if (parts) { const m = months[parts[2].toLowerCase().slice(0,3)]; if (m) iso = `${parts[3]}-${String(m).padStart(2,'0')}-${parts[1].padStart(2,'0')}`; }
    if (!iso) iso = p.passportExpiry;
    return iso ? new Date(iso) < new Date() : false;
  })();
  const passportAI  = md.some(m => m.includes('passport'));
  const passportOk  = passportNum && passportExpiry && !passportExpired && !passportAI;
  const passportPts = passportOk ? 25 : (passportNum || passportExpiry) ? 10 : 0;

  // ── English test ─────────────────────────────────────────────────────────────
  const hasEnglish = (Array.isArray(p.englishTests) && p.englishTests.some(t => isDocVal(t.overallScore)))
                  || isDocVal(p.ieltsScore) || isDocVal(p.toeflScore) || isDocVal(p.pteScore);
  // AI flags should only suppress a score when the field itself is also absent.
  // If the student has a real value on file, a stale missingDocuments entry must not zero it out.
  const englishAI  = !hasEnglish && md.some(m => m.includes('ielts') || m.includes('english') || m.includes('toefl') || m.includes('pte') || m.includes('language') || m.includes('proficiency'));
  const englishPts = hasEnglish ? 20 : 0; // englishAI already guarantees !hasEnglish; guard removed (was redundant)
  // Partial: a test entry exists in the array but overallScore is blank
  const englishPartial = !hasEnglish && Array.isArray(p.englishTests) && p.englishTests.length > 0;

  // ── Financial evidence ───────────────────────────────────────────────────────
  const finHas     = isDocVal(p.financialBalance);
  const finAI      = !finHas && md.some(m => m.includes('financial') || m.includes('bank') || m.includes('funds') || m.includes('statement'));
  const finPts     = finHas && !finAI ? 15 : 0;
  // Partial: account holder name extracted but balance not yet found
  const finPartial = !finHas && isDocVal(p.financialHolder);

  // ── Academic result ──────────────────────────────────────────────────────────
  const acadHas     = isDocVal(p.academicResult);
  const acadAI      = !acadHas && md.some(m => m.includes('transcript') || m.includes('academic') || m.includes('degree') || m.includes('certificate') || m.includes('result'));
  const acadPts     = acadHas && !acadAI ? 15 : 0;
  // Partial: a program/university was extracted but no result/grade yet
  const acadPartial = !acadHas && (isDocVal(p.program) || isDocVal(p.university));

  // ── CNIC / National ID ───────────────────────────────────────────────────────
  const cnicHas     = isDocVal(p.cnicNumber);
  const cnicAI      = !cnicHas && md.some(m => m.includes('cnic') || m.includes('national id') || m.includes('identity card'));
  const cnicPts     = cnicHas && !cnicAI ? 10 : 0;
  // Partial: CNIC expiry found (back side scanned) but number not yet extracted
  const cnicPartial = !cnicHas && isDocVal(p.cnicExpiry);

  // ── Offer Letter ─────────────────────────────────────────────────────────────
  const hasOffer     = Array.isArray(p.offerLetters) && p.offerLetters.some(o => isDocVal(o.university) || isDocVal(o.status));
  const offerAI      = !hasOffer && md.some(m => m.includes('offer') || m.includes('admission') || m.includes('acceptance'));
  const offerPts     = hasOffer && !offerAI ? 10 : 0;
  // Partial: offerLetters array exists and has entries, but none have university or status
  const offerPartial = !hasOffer && Array.isArray(p.offerLetters) && p.offerLetters.length > 0;

  // ── CAS / Pre-CAS ────────────────────────────────────────────────────────────
  // casDocuments[] → Analyzer / manual entry; cas{} → email-auto-detection (worker.js)
  const hasCAS     = (Array.isArray(p.casDocuments) && p.casDocuments.some(d => isDocVal(d.casNumber) || isDocVal(d.university)))
                  || isDocVal(p.cas?.cas_number) || isDocVal(p.cas?.university);
  const casAI      = !hasCAS && md.some(m => m.includes('cas') || m.includes('confirmation of acceptance'));
  const casPts     = hasCAS && !casAI ? 5 : 0;
  // Partial: casDocuments array exists and has entries but key fields are blank
  const casPartial = !hasCAS && Array.isArray(p.casDocuments) && p.casDocuments.length > 0;

  const score = passportPts + englishPts + finPts + acadPts + cnicPts + offerPts + casPts;

  const items = [
    { label: 'Passport',           pts: passportPts, max: 25, present: passportOk,  partial: !passportOk && (passportNum || passportExpiry) },
    { label: 'English test',       pts: englishPts,  max: 20, present: hasEnglish,  partial: englishPartial },
    { label: 'Financial evidence', pts: finPts,      max: 15, present: finHas,      partial: finPartial     },
    { label: 'Academic result',    pts: acadPts,     max: 15, present: acadHas,     partial: acadPartial    },
    { label: 'CNIC / National ID', pts: cnicPts,     max: 10, present: cnicHas,     partial: cnicPartial    },
    { label: 'Offer Letter',       pts: offerPts,    max: 10, present: hasOffer,    partial: offerPartial   },
    { label: 'CAS / Pre-CAS',      pts: casPts,      max:  5, present: hasCAS,      partial: casPartial     },
  ];

  const present   = items.filter(i => i.present).map(i => i.label);
  const missing   = items.filter(i => !i.present && !i.partial).map(i => i.label);
  const partial   = items.filter(i => i.partial).map(i => i.label);
  const breakdown = Object.fromEntries(items.map(i => [i.label, { pts: i.pts, max: i.max, present: i.present, partial: i.partial }]));

  return { score, present, missing, partial, breakdown };
}

// ─── VIABILITY SCORING ENGINE ───────────────────────────────────────────────────
// Scores applicant profile strength based on academic, financial, and visa risk factors
// Returns overall viability score (0-100), confidence (0-1), and detailed breakdown

export function viabilityScore(profileData) {
  const p = profileData || {};
  
  // ── CONFIDENCE SCORE ─────────────────────────────────────────────────────────────
  // Simple field count: (fieldsPresent / totalExpectedFields)
  const expectedFields = [
    'fullName', 'dob', 'nationality', 'passportNumber', 'passportExpiry',
    'academicResult', 'program', 'university', 'financialBalance', 'financialHolder',
    'ieltsScore', 'toeflScore', 'pteScore', 'englishTests',
    'offerLetters', 'cnicNumber', 'cnicExpiry', 'casDocuments', 'cas',
    'studyGap', 'maritalStatus', 'pastRejections'
  ];
  
  const fieldsPresent = expectedFields.filter(field => {
    const value = p[field];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return String(value).trim() !== '' && String(value).trim() !== 'Not found';
  }).length;
  
  const confidence = fieldsPresent / expectedFields.length;
  
  // ── HARDCODED THRESHOLDS ───────────────────────────────────────────────────────
  // Phase 1: Uniform thresholds (country-specific weighting in Phase 2)
  const THRESHOLDS = {
    academic: {
      cgpa: { excellent: 3.5, good: 3.0, average: 2.5, poor: 2.0 },
      interMatric: { excellent: 80, good: 70, average: 60, poor: 50 },
      studyGap: { ideal: 0, acceptable: 24, concerning: 48, critical: 72 }
    },
    financial: {
      funds: { maximum: 50000, high: 30000, medium: 20000, low: 10000 }
    },
    visaRisk: {
      age: { ideal: { min: 18, max: 28 }, acceptable: { min: 16, max: 32 }, concerning: { min: 15, max: 35 } },
      pastRejections: { ideal: 0, acceptable: 1, critical: 2 }
    }
  };
  
  // ── ACADEMIC SCORING (40 points total) ─────────────────────────────────────────
  let academicScore = 0;
  const academicFactors = {};
  
  // CGPA (15 points)
  const cgpa = _parseGPA(p.academicResult);
  if (cgpa !== null) {
    if (cgpa >= THRESHOLDS.academic.cgpa.excellent) {
      academicScore += 15;
      academicFactors.cgpa = { score: 15, status: 'excellent', value: cgpa };
    } else if (cgpa >= THRESHOLDS.academic.cgpa.good) {
      academicScore += 12;
      academicFactors.cgpa = { score: 12, status: 'good', value: cgpa };
    } else if (cgpa >= THRESHOLDS.academic.cgpa.average) {
      academicScore += 8;
      academicFactors.cgpa = { score: 8, status: 'average', value: cgpa };
    } else if (cgpa >= THRESHOLDS.academic.cgpa.poor) {
      academicScore += 4;
      academicFactors.cgpa = { score: 4, status: 'poor', value: cgpa };
    } else {
      academicFactors.cgpa = { score: 0, status: 'critical', value: cgpa };
    }
  } else {
    academicFactors.cgpa = { score: 0, status: 'missing', value: null };
  }
  
  // Inter/Matric (10 points) - simplified: use academic result if available
  if (p.academicResult && p.academicResult !== 'Not found') {
    // Assume good if we have academic result
    academicScore += 10;
    academicFactors.interMatric = { score: 10, status: 'present', value: 'N/A' };
  } else {
    academicFactors.interMatric = { score: 0, status: 'missing', value: null };
  }
  
  // Study Gap (10 points)
  const studyGap = p.studyGap ? parseInt(String(p.studyGap).replace(/\D/g, '')) : 0;
  if (studyGap <= THRESHOLDS.academic.studyGap.ideal) {
    academicScore += 10;
    academicFactors.studyGap = { score: 10, status: 'ideal', value: studyGap };
  } else if (studyGap <= THRESHOLDS.academic.studyGap.acceptable) {
    academicScore += 6;
    academicFactors.studyGap = { score: 6, status: 'acceptable', value: studyGap };
  } else if (studyGap <= THRESHOLDS.academic.studyGap.concerning) {
    academicScore += 3;
    academicFactors.studyGap = { score: 3, status: 'concerning', value: studyGap };
  } else {
    academicFactors.studyGap = { score: 0, status: 'critical', value: studyGap };
  }
  
  // Degree Level (5 points) - bonus for bachelors/masters
  const degreeLevel = (p.program || '').toLowerCase();
  if (degreeLevel.includes('bachelor') || degreeLevel.includes('master') || degreeLevel.includes('ms') || degreeLevel.includes('m.sc')) {
    academicScore += 5;
    academicFactors.degreeLevel = { score: 5, status: 'ideal', value: p.program };
  } else if (degreeLevel.includes('phd') || degreeLevel.includes('doctor')) {
    academicScore += 3;
    academicFactors.degreeLevel = { score: 3, status: 'good', value: p.program };
  } else {
    academicFactors.degreeLevel = { score: 0, status: 'unknown', value: p.program };
  }
  
  // ── FINANCIAL SCORING (35 points total) ───────────────────────────────────────
  let financialScore = 0;
  const financialFactors = {};
  
  // Funds (30 points)
  const { amount: fundsAmount } = _parseCurrencyAmount(p.financialBalance || "");
  if (fundsAmount !== null) {
    if (fundsAmount >= THRESHOLDS.financial.funds.maximum) {
      financialScore += 30;
      financialFactors.funds = { score: 30, status: 'maximum', value: fundsAmount };
    } else if (fundsAmount >= THRESHOLDS.financial.funds.high) {
      financialScore += 25;
      financialFactors.funds = { score: 25, status: 'high', value: fundsAmount };
    } else if (fundsAmount >= THRESHOLDS.financial.funds.medium) {
      financialScore += 18;
      financialFactors.funds = { score: 18, status: 'medium', value: fundsAmount };
    } else if (fundsAmount >= THRESHOLDS.financial.funds.low) {
      financialScore += 10;
      financialFactors.funds = { score: 10, status: 'low', value: fundsAmount };
    } else {
      financialFactors.funds = { score: 0, status: 'insufficient', value: fundsAmount };
    }
  } else {
    financialFactors.funds = { score: 0, status: 'missing', value: null };
  }
  
  // Financial Holder (5 points)
  if (p.financialHolder && p.financialHolder !== 'Not found') {
    financialScore += 5;
    financialFactors.financialHolder = { score: 5, status: 'present', value: p.financialHolder };
  } else {
    financialFactors.financialHolder = { score: 0, status: 'missing', value: null };
  }
  
  // ── VISA RISK SCORING (25 points total) ────────────────────────────────────────
  let visaRiskScore = 0;
  const visaRiskFactors = {};
  
  // Age (10 points)
  const age = _calculateAge(p.dob);
  if (age !== null) {
    if (age >= THRESHOLDS.visaRisk.age.ideal.min && age <= THRESHOLDS.visaRisk.age.ideal.max) {
      visaRiskScore += 10;
      visaRiskFactors.age = { score: 10, status: 'ideal', value: age };
    } else if (age >= THRESHOLDS.visaRisk.age.acceptable.min && age <= THRESHOLDS.visaRisk.age.acceptable.max) {
      visaRiskScore += 7;
      visaRiskFactors.age = { score: 7, status: 'acceptable', value: age };
    } else if (age >= THRESHOLDS.visaRisk.age.concerning.min && age <= THRESHOLDS.visaRisk.age.concerning.max) {
      visaRiskScore += 4;
      visaRiskFactors.age = { score: 4, status: 'concerning', value: age };
    } else {
      visaRiskFactors.age = { score: 0, status: 'critical', value: age };
    }
  } else {
    visaRiskFactors.age = { score: 0, status: 'missing', value: null };
  }
  
  // Marital Status (8 points)
  const maritalStatus = (p.maritalStatus || '').toLowerCase();
  if (maritalStatus === 'single' || maritalStatus === 'unmarried') {
    visaRiskScore += 8;
    visaRiskFactors.maritalStatus = { score: 8, status: 'ideal', value: p.maritalStatus };
  } else if (maritalStatus === 'married') {
    visaRiskScore += 5;
    visaRiskFactors.maritalStatus = { score: 5, status: 'acceptable', value: p.maritalStatus };
  } else {
    visaRiskFactors.maritalStatus = { score: 0, status: 'unknown', value: p.maritalStatus };
  }
  
  // Past Rejections (7 points)
  const pastRejections = p.pastRejections ? parseInt(String(p.pastRejections)) : 0;
  if (pastRejections === THRESHOLDS.visaRisk.pastRejections.ideal) {
    visaRiskScore += 7;
    visaRiskFactors.pastRejections = { score: 7, status: 'ideal', value: pastRejections };
  } else if (pastRejections === THRESHOLDS.visaRisk.pastRejections.acceptable) {
    visaRiskScore += 4;
    visaRiskFactors.pastRejections = { score: 4, status: 'acceptable', value: pastRejections };
  } else if (pastRejections < THRESHOLDS.visaRisk.pastRejections.critical) {
    visaRiskScore += 2;
    visaRiskFactors.pastRejections = { score: 2, status: 'concerning', value: pastRejections };
  } else {
    visaRiskFactors.pastRejections = { score: 0, status: 'critical', value: pastRejections };
  }
  
  // ── OVERALL SCORE ─────────────────────────────────────────────────────────────
  const overallScore = academicScore + financialScore + visaRiskScore;
  
  return {
    score: overallScore,
    confidence: confidence,
    breakdown: {
      academic: {
        score: academicScore,
        max: 40,
        factors: academicFactors
      },
      financial: {
        score: financialScore,
        max: 35,
        factors: financialFactors
      },
      visaRisk: {
        score: visaRiskScore,
        max: 25,
        factors: visaRiskFactors
      }
    }
  };
}

// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────────

function _parseGPA(academicResult) {
  if (!academicResult || academicResult === 'Not found') return null;
  const str = String(academicResult).toLowerCase();
  // Extract CGPA from patterns like "CGPA: 3.5", "3.5/4.0", "3.5", etc.
  const match = str.match(/(\d+\.?\d*)\s*\/?\s*4\.?\d*/);
  if (match) {
    const gpa = parseFloat(match[1]);
    return gpa <= 4.0 ? gpa : gpa / 10; // Normalize if out of 10
  }
  // Try simple number extraction
  const numMatch = str.match(/(\d+\.?\d*)/);
  return numMatch ? parseFloat(numMatch[1]) : null;
}

function _parseCurrencyAmount(amountStr) {
  if (!amountStr || amountStr === 'Not found') return { amount: null, currency: null };
  const str = String(amountStr);
  const numMatch = str.match(/[\d,]+\.?\d*/);
  const amount = numMatch ? parseFloat(numMatch[0].replace(/,/g, '')) : null;
  const currencyMatch = str.match(/[A-Z]{3}|[\$\€\£\₹]/);
  const currency = currencyMatch ? currencyMatch[0] : null;
  return { amount, currency };
}

function _calculateAge(dob) {
  if (!dob || dob === 'Not found') return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}