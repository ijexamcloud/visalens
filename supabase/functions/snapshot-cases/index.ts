// ═══════════════════════════════════════════════════════════════════════════════
// VisaLens — snapshot-cases Edge Function
// File: supabase/functions/snapshot-cases/index.ts
//
// Schedule: 0 0 * * * (midnight UTC daily) via Supabase Cron Jobs
//
// What this function does (in order):
//   1. Fetches all active cases from the database
//   2. Runs computeDocScore() + viabilityScore() on each case's profile_data
//   3. Upserts one row into case_snapshots per case (safe to re-run)
//   4. Reads org SLA thresholds from organizations table
//   5. Marks funnel_stage_entries rows as sla_breached where overdue
//   6. Aggregates yesterday's audit_log into daily_counselor_stats
//
// IMPORTANT: The _shared/docScore.ts file must always be a verbatim copy of
// src/docScore.js in the React app. Never edit _shared/docScore.ts directly.
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeDocScore,
  viabilityScore,
  SCORE_VERSION,
} from "../_shared/docScore.ts";

// ── Supabase client (service role — bypasses RLS for server-side reads/writes) ──
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Helper: derive quadrant from doc_score and viability_score ──────────────────
function deriveQuadrant(docScore: number, vScore: number): string {
  if (vScore >= 50 && docScore >= 50) return "vip";
  if (vScore >= 50 && docScore < 50)  return "sales";
  if (vScore < 50  && docScore >= 50) return "drainers";
  return "dead";
}

// ── Helper: bucket financial amount into Phase 4 funding tier ───────────────────
function fundingTier(financialBalance: string | null): string {
  if (!financialBalance) return "unknown";
  const numMatch = String(financialBalance).match(/[\d,]+\.?\d*/);
  if (!numMatch) return "unknown";
  const amount = parseFloat(numMatch[0].replace(/,/g, ""));
  if (amount >= 30000) return "Tier_3";
  if (amount >= 10000) return "Tier_2";
  if (amount > 0)      return "Tier_1";
  return "unknown";
}

// ── Helper: bucket GPA into academic band for Phase 4 counsellor matching ───────
function gpaBand(academicResult: string | null): string {
  if (!academicResult || academicResult === "Not found") return "unknown";
  const str = String(academicResult).toLowerCase();
  const match = str.match(/(\d+\.?\d*)\s*\/?\s*4\.?\d*/);
  const numMatch = str.match(/(\d+\.?\d*)/);
  const raw = match ? parseFloat(match[1]) : numMatch ? parseFloat(numMatch[1]) : null;
  if (raw === null) return "unknown";
  const gpa = raw > 4.0 ? raw / 10 : raw;
  if (gpa >= 3.5) return "3.5-4.0";
  if (gpa >= 3.0) return "3.0-3.5";
  if (gpa >= 2.5) return "2.5-3.0";
  return "below_2.5";
}

// ── Helper: calculate age bracket from dob for Phase 4 demographics ─────────────
function ageBracket(dob: string | null): string {
  if (!dob || dob === "Not found") return "unknown";
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return "unknown";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age--;
  if (age < 18) return "under_18";
  if (age <= 22) return "18-22";
  if (age <= 27) return "23-27";
  if (age <= 35) return "28-35";
  return "over_35";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async () => {
  const today = new Date().toISOString().split("T")[0];
  const errors: string[] = [];

  console.log(`[snapshot-cases] Starting run for ${today}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1 — Fetch all active cases
  // ─────────────────────────────────────────────────────────────────────────────
  const { data: cases, error: casesError } = await supabase
    .from("cases")
    .select(
      "id, org_id, counsellor_name, lead_status, pipeline_stage, " +
      "profile_data, results, doc_list, referral_source"
    )
    .not("lead_status", "eq", "Done");

  if (casesError) {
    console.error("[snapshot-cases] Failed to fetch cases:", casesError.message);
    return new Response(`Error fetching cases: ${casesError.message}`, { status: 500 });
  }

  if (!cases?.length) {
    console.log("[snapshot-cases] No active cases found. Exiting.");
    return new Response("No active cases", { status: 200 });
  }

  console.log(`[snapshot-cases] Processing ${cases.length} active cases`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2 — Build snapshot rows
  // ─────────────────────────────────────────────────────────────────────────────
  const snapshots = cases.map((c: any) => {
    const docResult  = computeDocScore(c.profile_data, c.results);
    const viabResult = viabilityScore(c.profile_data);
    const dScore     = docResult.score;
    const vScore     = viabResult.score;
    const p          = c.profile_data || {};

    // Phase 4: student_metadata JSONB — stored alongside each daily snapshot
    // so the analytics dashboard can query demographics without touching profile_data
    const student_metadata = {
      age_bracket:   ageBracket(p.dob ?? null),
      gpa_band:      gpaBand(p.academicResult ?? null),
      funding_tier:  fundingTier(p.financialBalance ?? null),
      nationality:   p.nationality ?? null,
      lead_source:   c.referral_source ?? null,
    };

    return {
      case_id:              c.id,
      org_id:               c.org_id,
      counsellor_name:      c.counsellor_name,
      funnel_stage:         c.pipeline_stage,
      lead_status:          c.lead_status,
      quadrant:             deriveQuadrant(dScore, vScore),
      doc_score:            dScore,
      viability_score:      vScore,
      viability_confidence: viabResult.confidence,
      scoring_version:      SCORE_VERSION,
      snapshot_date:        today,
      student_metadata,
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3 — Upsert snapshots
  // onConflict: "case_id,snapshot_date" means re-running today is always safe
  // ─────────────────────────────────────────────────────────────────────────────
  const { error: snapshotError } = await supabase
    .from("case_snapshots")
    .upsert(snapshots, { onConflict: "case_id,snapshot_date" });

  if (snapshotError) {
    console.error("[snapshot-cases] Snapshot upsert failed:", snapshotError.message);
    errors.push(`snapshot_upsert: ${snapshotError.message}`);
  } else {
    console.log(`[snapshot-cases] Upserted ${snapshots.length} snapshot rows`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4 — SLA breach check
  // Fetch org SLA thresholds from organizations, then mark overdue open entries
  // ─────────────────────────────────────────────────────────────────────────────
  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select(
      "id, sla_lead, sla_docs_pending, sla_ready_to_apply, sla_applied, sla_visa_prep"
    );

  if (orgsError) {
    console.error("[snapshot-cases] Failed to fetch org SLA settings:", orgsError.message);
    errors.push(`sla_fetch: ${orgsError.message}`);
  } else if (orgs?.length) {
    // Build a lookup map: org_id → SLA thresholds per stage
    const slaMap: Record<string, Record<string, number>> = {};
    for (const org of orgs) {
      slaMap[org.id] = {
        lead:            org.sla_lead            ?? 3,
        docs_pending:    org.sla_docs_pending    ?? 14,
        ready_to_apply:  org.sla_ready_to_apply  ?? 7,
        applied:         org.sla_applied         ?? 21,
        visa_prep:       org.sla_visa_prep       ?? 10,
      };
    }

    // Fetch all open funnel_stage_entries (cases still in a stage)
    const { data: openEntries, error: entriesError } = await supabase
      .from("funnel_stage_entries")
      .select("id, org_id, funnel_stage, entered_stage_at")
      .is("exited_stage_at", null);

    if (entriesError) {
      errors.push(`sla_entries_fetch: ${entriesError.message}`);
    } else if (openEntries?.length) {
      const now = new Date();
      const breachedIds: string[] = [];

      for (const entry of openEntries) {
        const threshold = slaMap[entry.org_id]?.[entry.funnel_stage];
        if (threshold == null) continue; // no SLA defined for this stage

        const enteredAt  = new Date(entry.entered_stage_at);
        const daysInStage = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24);

        if (daysInStage > threshold) {
          breachedIds.push(entry.id);
        }
      }

      if (breachedIds.length > 0) {
        const { error: breachError } = await supabase
          .from("funnel_stage_entries")
          .update({ sla_breached: true })
          .in("id", breachedIds);

        if (breachError) {
          errors.push(`sla_breach_update: ${breachError.message}`);
        } else {
          console.log(`[snapshot-cases] Marked ${breachedIds.length} entries as SLA breached`);
        }
      } else {
        console.log("[snapshot-cases] No new SLA breaches found");
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5 — Aggregate yesterday's audit_log into daily_counselor_stats
  // This is what the EffortAllocationHeatmap widget reads — never raw audit_log.
  // We aggregate the previous UTC day so the full day's data is always complete.
  // ─────────────────────────────────────────────────────────────────────────────
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const { data: auditRows, error: auditError } = await supabase
    .from("audit_log")
    .select("org_id, counsellor_name, action_type, case_quadrant")
    .gte("created_at", `${yesterdayStr}T00:00:00Z`)
    .lt("created_at",  `${today}T00:00:00Z`)
    .not("counsellor_name", "is", null);

  if (auditError) {
    console.error("[snapshot-cases] Failed to fetch audit_log:", auditError.message);
    errors.push(`audit_fetch: ${auditError.message}`);
  } else if (auditRows?.length) {
    // Aggregate by org_id + counsellor_name
    const statsMap: Record<string, any> = {};

    for (const row of auditRows) {
      if (!row.counsellor_name || !row.org_id) continue;
      const key = `${row.org_id}::${row.counsellor_name}`;

      if (!statsMap[key]) {
        statsMap[key] = {
          org_id:          row.org_id,
          counsellor_name: row.counsellor_name,
          stat_date:       yesterdayStr,
          actions_vip:      0,
          actions_sales:    0,
          actions_drainers: 0,
          actions_dead:     0,
          actions_total:    0,
          stage_changes:    0,
          docs_uploaded:    0,
          emails_sent:      0,
        };
      }

      const s = statsMap[key];
      s.actions_total += 1;

      // Quadrant breakdown
      if (row.case_quadrant === "vip")      s.actions_vip      += 1;
      if (row.case_quadrant === "sales")    s.actions_sales    += 1;
      if (row.case_quadrant === "drainers") s.actions_drainers += 1;
      if (row.case_quadrant === "dead")     s.actions_dead     += 1;

      // Action type breakdown
      if (row.action_type === "STAGE_CHANGED")  s.stage_changes  += 1;
      if (row.action_type === "DOC_UPLOADED")   s.docs_uploaded  += 1;
      if (row.action_type === "EMAIL_SENT")     s.emails_sent    += 1;
    }

    const statsRows = Object.values(statsMap);

    if (statsRows.length > 0) {
      const { error: statsError } = await supabase
        .from("daily_counselor_stats")
        .upsert(statsRows, { onConflict: "org_id,counsellor_name,stat_date" });

      if (statsError) {
        errors.push(`stats_upsert: ${statsError.message}`);
        console.error("[snapshot-cases] daily_counselor_stats upsert failed:", statsError.message);
      } else {
        console.log(`[snapshot-cases] Upserted ${statsRows.length} daily_counselor_stats rows for ${yesterdayStr}`);
      }
    }
  } else {
    console.log(`[snapshot-cases] No audit_log rows found for ${yesterdayStr} — skipping stats aggregation`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Done
  // ─────────────────────────────────────────────────────────────────────────────
  const summary = {
    date:       today,
    cases:      cases.length,
    snapshots:  snapshots.length,
    errors:     errors.length > 0 ? errors : null,
  };

  console.log("[snapshot-cases] Run complete:", JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    status: errors.length > 0 ? 207 : 200,
    headers: { "Content-Type": "application/json" },
  });
});