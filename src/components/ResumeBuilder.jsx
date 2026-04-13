import React, { useState } from 'react';
import {
  AlertCircle, Check, Copy, FileText, Loader2, Printer, Save, Trash2,
} from 'lucide-react';
import { PROXY_URL } from '../constants/api';
import { getAuthHeaders, withOrg } from '../utils/session';

export default function ResumeBuilder({ profileData, results, resume, setResume, onSaveResume }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [copied,  setCopied]  = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function generateResume() {
    if (!profileData || !profileData.fullName || profileData.fullName === "Not found") {
      setError("Student profile is empty. Please analyse a document or load a case first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Static template instructions → system (cached). Dynamic student data → user message.
      const RESUME_SYSTEM = `You are a professional resume writer specialising in international student applications. Your output will be used by a visa consultant and edited further — write content that is accurate, specific, and easy to customise. Output raw text only — no markdown code blocks, no triple backticks, no introductory or concluding text outside the resume itself.

CRITICAL RULES:
- Use only information explicitly provided. Never invent a phone number, email, company name, or specific achievement.
- Where information is missing, write a clear editorial placeholder in [square brackets] so the consultant knows exactly what to fill in. Example: [Insert phone number] or [Insert LinkedIn URL].
- All dates must be after TODAY'S DATE provided in the student data. Never write a past date as a future event.
- The Professional Summary must reference the target programme and university if provided — this is the single biggest quality improvement you can make.
- Skills must be derived from the student's field of study and qualifications — not generic. A CS student gets technical skills. A business student gets analytical/management skills. Do not mix them up.
- The Education section must list ALL qualifications found in academicResult in reverse chronological order (most recent first).
- If the study gap field describes a period of work or professional activity, write a structured Experience entry for it with placeholder bullets. If there is genuinely no work experience, write the placeholder message.
- Never use the phrase "results-driven", "dynamic professional", "passionate about", or "detail-oriented".

REQUIRED FORMAT (follow spacing exactly):

[STUDENT FULL NAME IN CAPS]
[Nationality] National | DOB: [Date of Birth]
Phone: [phone or INSERT PLACEHOLDER] | Email: [email or INSERT PLACEHOLDER] | LinkedIn: [INSERT PLACEHOLDER]

─────────────────────────────────────────────
PROFESSIONAL SUMMARY
─────────────────────────────────────────────
[3-4 sentences. Sentence 1: current academic level and field. Sentence 2: specific skills or strengths relevant to target programme. Sentence 3: career direction tied to target programme/university if provided. Sentence 4: English proficiency and readiness for postgraduate study abroad. Be specific, not generic.]

─────────────────────────────────────────────
EDUCATION
─────────────────────────────────────────────
[For EACH qualification in reverse chronological order:]
[Degree / Programme Name] | [Year of Completion]
[Institution Name]
Grade / Result: [Result]

─────────────────────────────────────────────
CORE COMPETENCIES
─────────────────────────────────────────────
[3-column layout, 6-9 bullet points total. Derive from field of study:]
• [Field-specific technical or analytical skill]    • [Transferable skill]    • [Tool or methodology]
• [Field-specific skill]                            • [Research or soft skill] • [Additional strength]
• [Field-specific skill]                            • [Communication/language]

─────────────────────────────────────────────
PROFESSIONAL EXPERIENCE
─────────────────────────────────────────────
[If study gap describes work or professional activity:]
[Job Title — be specific based on gap description]                    [Start Year – End Year]
[Company / Organisation Name — use placeholder if unknown]
• [Key responsibility relevant to target field — use placeholder if specifics unknown]
• [Achievement or contribution — quantify if possible, otherwise use placeholder]
• [Additional responsibility or learning outcome]

[If no work experience identified:]
[This section requires input from the student. Please add relevant work experience, internships, volunteer work, or freelance projects here.]

─────────────────────────────────────────────
ENGLISH LANGUAGE PROFICIENCY
─────────────────────────────────────────────
[List each test on its own line:]
[Test Name]: [Overall Score] (Listening: [L] | Reading: [R] | Writing: [W] | Speaking: [S]) — [Test Date if available]

─────────────────────────────────────────────
ADDITIONAL INFORMATION
─────────────────────────────────────────────
• Passport Validity: [Expiry date if provided, else INSERT PLACEHOLDER]
• Target Programme: [Programme name and university if provided, else omit this line]
• [Any other relevant detail from the profile — financial readiness, medium of instruction if English, rejection history if relevant to explain gap, etc. Add only what is substantiated by the data.]`;

      const englishTestsSummary = Array.isArray(profileData.englishTests) && profileData.englishTests.length > 0
        ? profileData.englishTests.map(t =>
            `${t.type}: ${t.overallScore}${t.testDate ? ` (${t.testDate})` : ""}` +
            (t.subScores ? ` — L:${t.subScores.listening||"?"} R:${t.subScores.reading||"?"} W:${t.subScores.writing||"?"} S:${t.subScores.speaking||"?"}` : "")
          ).join("\n")
        : [
            profileData.ieltsScore && profileData.ieltsScore !== "Not found" ? `IELTS: ${profileData.ieltsScore}` : null,
            profileData.toeflScore && profileData.toeflScore !== "Not found" ? `TOEFL: ${profileData.toeflScore}` : null,
            profileData.pteScore   && profileData.pteScore   !== "Not found" ? `PTE: ${profileData.pteScore}`   : null,
          ].filter(Boolean).join("\n") || "Not found";

      const offerSummary = Array.isArray(profileData.offerLetters) && profileData.offerLetters.length > 0
        ? profileData.offerLetters.map(o =>
            `${o.status} offer — ${o.program || "Programme not specified"} at ${o.university || "University not specified"}, ${o.country || ""} (${o.intakeSeason || "intake not specified"})`
          ).join("\n")
        : "No offer letter on file";

      const studentData = `TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
All future dates must fall after this date. Do not reference any past date as a future event.

=== STUDENT PROFILE ===
Full Name: ${profileData.fullName}
Date of Birth: ${profileData.dob || "Not found"}
Nationality: ${profileData.nationality || "Not found"}
Passport Number: ${profileData.passportNumber || "Not found"}
Passport Expiry: ${profileData.passportExpiry || "Not found"}

=== QUALIFICATIONS (academicResult field — list ALL of these in Education section) ===
${profileData.academicResult || "Not found"}

Highest Qualification Title: ${profileData.program || "Not found"}
Institution: ${profileData.university || "Not found"}
Year of Completion: ${profileData.yearOfPassing || "Not found"}

=== STUDY GAP ===
${profileData.studyGap && profileData.studyGap !== "Not found" ? profileData.studyGap : "No study gap identified"}

=== ENGLISH PROFICIENCY ===
${englishTestsSummary}
Medium of Instruction: ${profileData.mediumOfInstruction || "Not specified"}

=== TARGET / OFFER ===
${offerSummary}

=== FINANCIAL ===
Available Funds: ${profileData.financialBalance || "Not found"}
Sponsor: ${profileData.financialHolder || "Not specified"}

=== RISK FLAGS (for context only — do not include in resume) ===
${(results?.redFlags || []).map(f => `[${f.severity}] ${f.flag}`).join("\n") || "None"}`;

      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(withOrg({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: RESUME_SYSTEM,
          messages: [{ role: "user", content: studentData }],
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
      <div className="rc rc-purple">
        <div className="rc-hdr rc-hdr--purple">
          <div className="rc-ico"><FileText size={14} color="#ffffff"/></div>
          <span className="rc-ttl">AI Resume Builder</span>
        </div>
        <div className="rc-body">
          <div className="toolbar" style={{ justifyContent: "flex-start", marginBottom: 16, gap: "8px", flexWrap: "wrap" }}>
            <button className="btn-p btn-generate" style={{ width: "auto", padding: "0 16px" }} onClick={generateResume} disabled={loading}>
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
                <button className="btn-p" style={{width:"auto",padding:"0 14px",marginLeft:"auto"}} onClick={async () => { await onSaveResume(); setSaveMsg("Saved ✓"); setTimeout(()=>setSaveMsg(""),2500); }}>
                  <Save size={13}/> Save to Case
                </button>
              </>
            )}
          </div>

          {saveMsg && <div style={{fontSize:12,color:"var(--ok)",fontFamily:"var(--fm)",marginBottom:8,display:"flex",alignItems:"center",gap:5}}><Check size={12}/>{saveMsg}</div>}

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
