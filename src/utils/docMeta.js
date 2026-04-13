// ── src/utils/docMeta.js ──────────────────────────────────────────────────────
// Document-type definitions, filename-based type guesser, and subtype lists.
// Depends on Lucide icons — import the same set your app already uses.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------

import {
  BarChart3, BookOpen, CreditCard, DollarSign, File, FileText,
  GraduationCap, Languages, Mail, ShieldCheck, Users, XCircle,
} from 'lucide-react';

export const DOC_TYPES = [
  // Identity
  { value: "passport",           label: "Passport / ID",                    Icon: CreditCard,    group: "Identity" },
  { value: "birth_certificate",  label: "Birth Certificate",                Icon: FileText,      group: "Identity" },
  { value: "domicile",           label: "Domicile Certificate",             Icon: FileText,      group: "Identity" },
  { value: "marriage_certificate", label: "Marriage Certificate",           Icon: FileText,      group: "Identity" },
  { value: "marriage_reg_cert",  label: "Marriage Registration Cert (MRC)", Icon: FileText,      group: "Identity" },
  { value: "family_reg_cert",    label: "Family Registration Cert (FRC)",   Icon: Users,         group: "Identity" },
  { value: "police_clearance",   label: "Police Clearance Certificate",     Icon: ShieldCheck,   group: "Identity" },
  // Academic
  { value: "transcript",         label: "Academic Transcript",              Icon: BookOpen,      group: "Academic" },
  { value: "degree_certificate", label: "Degree Certificate",               Icon: GraduationCap, group: "Academic" },
  { value: "experience_letter",  label: "Experience / Employment Letter",   Icon: FileText,      group: "Academic" },
  { value: "gap_letter",         label: "Gap / Explanation Letter",         Icon: FileText,      group: "Academic" },
  // Applications
  { value: "offer_letter",       label: "Offer / Admission Letter",         Icon: GraduationCap, group: "Application" },
  { value: "pre_cas",            label: "Pre-CAS / CAS Request Letter",     Icon: FileText,      group: "Application" },
  { value: "cas",                label: "CAS (Confirmation of Acceptance)", Icon: ShieldCheck,   group: "Application" },
  { value: "scholarship_letter", label: "Scholarship / Funding Letter",     Icon: Mail,          group: "Application" },
  { value: "noc",                label: "No Objection Certificate (NOC)",   Icon: FileText,      group: "Application" },
  // Financial
  { value: "bank_statement",     label: "Bank Statement",                   Icon: BarChart3,     group: "Financial" },
  { value: "financial_proof",    label: "Financial / Sponsor Letter",       Icon: DollarSign,    group: "Financial" },
  { value: "fee_receipt",        label: "Fee / Tuition Payment Receipt",    Icon: DollarSign,    group: "Financial" },
  // Language
  { value: "language_test",      label: "Language Test (IELTS/TOEFL/PTE)", Icon: Languages,     group: "Language" },
  // Visa
  { value: "ihs_receipt",        label: "IHS Payment Receipt (UK)",         Icon: FileText,      group: "Visa" },
  { value: "tb_test",            label: "TB Test Result",                   Icon: FileText,      group: "Visa" },
  { value: "medical_certificate",label: "Medical Certificate",              Icon: FileText,      group: "Visa" },
  // Supporting
  { value: "recommendation",     label: "Recommendation Letter",            Icon: Mail,          group: "Supporting" },
  // Rejections
  { value: "visa_rejection",     label: "Visa Rejection Letter",            Icon: XCircle,       group: "Rejections" },
  { value: "admission_rejection",label: "Admission / Deferment Letter",     Icon: XCircle,       group: "Rejections" },
  // Catch-all
  { value: "other",              label: "Other Document",                   Icon: File,          group: "Other" },
];

/** Lookup a DOC_TYPE entry by value; falls back to the "other" entry. */
export const getDT = v => DOC_TYPES.find(d => d.value === v) || DOC_TYPES[DOC_TYPES.length - 1];

/** Transcript level options (used in SubType dropdown). */
export const TRANSCRIPT_LEVELS = [
  { value: "",             label: "— select level —" },
  { value: "Matric",       label: "Matric / SSC / O-Levels" },
  { value: "Intermediate", label: "Intermediate / FSc / A-Levels / HSC" },
  { value: "Bachelors",    label: "Bachelors / BA / BSc / BBA" },
  { value: "Masters",      label: "Masters / MSc / MBA / MA" },
  { value: "MPhil",        label: "MPhil" },
  { value: "PhD",          label: "PhD / Doctorate" },
  { value: "Diploma",      label: "Diploma / Certificate" },
  { value: "Other",        label: "Other" },
];

/**
 * Guesses a document type from a filename.
 * Returns one of the `value` strings from DOC_TYPES.
 */
export function guessType(name) {
  const n = name.toLowerCase();
  if (n.includes("passport") || n.includes(" id "))                                              return "passport";
  if (n.includes("birth"))                                                                        return "birth_certificate";
  if (n.includes("domicile"))                                                                     return "domicile";
  if (n.includes("marriage") || n.includes("nikah"))                                             return "marriage_certificate";
  if (n.includes("mrc") || n.includes("marriage reg"))                                           return "marriage_reg_cert";
  if (n.includes("frc") || n.includes("family reg") || n.includes("family registration"))        return "family_reg_cert";
  if (n.includes("police") || n.includes("pcc") || n.includes("clearance"))                      return "police_clearance";
  if (n.includes("transcript") || n.includes("grade") || n.includes("result"))                   return "transcript";
  if (n.includes("degree") || (n.includes("certificate") && !n.includes("birth") && !n.includes("domicile"))) return "degree_certificate";
  if (n.includes("experience") || n.includes("employment") || (n.includes("noc") && !n.includes("_noc")))     return "experience_letter";
  if (n.includes("gap") || n.includes("explanation"))                                             return "gap_letter";
  if (n.includes("offer") || n.includes("admission"))                                            return "offer_letter";
  if (n.includes("pre-cas") || n.includes("pre_cas") || n.includes("precas") || n.includes("cas request") || n.includes("cas letter")) return "pre_cas";
  if (n.includes(" cas ") || n.includes("_cas_") || n.includes("-cas-") || n.startsWith("cas") || n.endsWith("cas") || (n.includes("cas") && n.includes("confirm"))) return "cas";
  if (n.includes("scholarship") || n.includes("funding"))                                        return "scholarship_letter";
  if (n.includes("noc"))                                                                          return "noc";
  if (n.includes("bank") || n.includes("statement"))                                             return "bank_statement";
  if (n.includes("financial") || n.includes("sponsor") || n.includes("affidavit"))              return "financial_proof";
  if (n.includes("fee") || n.includes("receipt") || (n.includes("payment") && !n.includes("ihs"))) return "fee_receipt";
  if (n.includes("ielts") || n.includes("toefl") || n.includes("pte") || n.includes("language")) return "language_test";
  if (n.includes("ihs"))                                                                          return "ihs_receipt";
  if (n.includes("tb") || n.includes("tuberculosis"))                                            return "tb_test";
  if (n.includes("medical") || n.includes("health"))                                             return "medical_certificate";
  if (n.includes("recommend") || n.includes("reference"))                                        return "recommendation";
  return "other";
}

/** File upload allowlists. */
export const ALLOWED_EXTENSIONS   = new Set(["pdf", "jpg", "jpeg", "png", "txt", "docx"]);
export const ALLOWED_MIME_TYPES   = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const UNSUPPORTED_BUT_COMMON = new Set(["odt", "doc", "xls", "xlsx", "ppt", "pptx"]);
