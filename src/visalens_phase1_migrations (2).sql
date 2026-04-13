-- ═══════════════════════════════════════════════════════════════════════════════
-- VisaLens Analytics — Phase 1 SQL Migrations
-- Steps 2–8 of the implementation plan (v1.3)
-- Run in the Supabase SQL editor, top to bottom, in one go.
-- Every statement is idempotent — safe to re-run without side effects.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 2 — audit_action_type Postgres enum
-- Replaces free-form text in audit_log.action_type with a typed enum.
-- The database will now reject any INSERT with an unrecognised action_type value.
-- To add a new event type in future: ALTER TYPE audit_action_type ADD VALUE 'NEW_VALUE';
-- ───────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_type') THEN
    CREATE TYPE audit_action_type AS ENUM (
      'STAGE_CHANGED',
      'DOC_UPLOADED',
      'DOC_FLAGGED_MISSING',
      'EMAIL_SENT',
      'NOTE_ADDED',
      'CASE_REASSIGNED',
      'ACTION_QUEUE_USED',
      'CASE_ARCHIVED',
      'PROGRAM_MATCHED',
      'OFFER_RECEIVED',
      'VISA_SUBMITTED'
    );
  END IF;
END
$$;

-- Verify: SELECT enum_range(NULL::audit_action_type);
-- Should return all 11 values above.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 3 — case_snapshots table
-- One row per active case per day. Written exclusively by the Edge Function cron.
-- The unique constraint on (case_id, snapshot_date) makes the nightly upsert safe
-- to re-run if the cron fires more than once in a day.
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS case_snapshots (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  org_id               uuid        NOT NULL,
  counsellor_name      text,
  funnel_stage         text,
  lead_status          text,
  quadrant             text        CHECK (quadrant IN ('vip', 'sales', 'drainers', 'dead')),
  doc_score            integer,
  viability_score      integer,
  viability_confidence numeric(3,2),
  scoring_version      integer     NOT NULL DEFAULT 1,
  snapshot_date        date        NOT NULL DEFAULT CURRENT_DATE,
  -- Phase 4: student demographic snapshot for counsellor-archetype matching,
  -- lead source heatmap, and financial velocity analysis. Populated by cron.
  student_metadata     jsonb,
  created_at           timestamptz DEFAULT now()
);

-- Unique constraint enables upsert in the Edge Function (onConflict: "case_id,snapshot_date")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_case_snapshot_date'
  ) THEN
    ALTER TABLE case_snapshots
      ADD CONSTRAINT uq_case_snapshot_date UNIQUE (case_id, snapshot_date);
  END IF;
END
$$;

-- Index for per-case trend queries (QuadrantTransitionChart)
CREATE INDEX IF NOT EXISTS idx_snapshots_case_date
  ON case_snapshots(case_id, snapshot_date);

-- Index for per-org per-counsellor queries (CounsellorScorecards, EffortAllocationHeatmap)
CREATE INDEX IF NOT EXISTS idx_snapshots_org_counsellor
  ON case_snapshots(org_id, counsellor_name, snapshot_date);

-- Index for Phase 4 lead-source heatmap queries
CREATE INDEX IF NOT EXISTS idx_snapshots_org_date
  ON case_snapshots(org_id, snapshot_date);

ALTER TABLE case_snapshots ENABLE ROW LEVEL SECURITY;

-- Verify: SELECT * FROM case_snapshots; — should return empty table with correct columns.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 4 — funnel_stage_entries table
-- Tracks dwell time per case per stage. Rows are written by the Postgres trigger
-- (Step 8 below) — NOT by the React client. days_in_stage is set by the trigger
-- when a case exits a stage. For open entries, compute elapsed days on the fly.
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funnel_stage_entries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  org_id            uuid        NOT NULL,
  funnel_stage      text        NOT NULL,
  entered_stage_at  timestamptz NOT NULL DEFAULT now(),
  exited_stage_at   timestamptz,
  -- Set by the trigger when a case exits this stage. For open (current) entries,
  -- compute elapsed days on the fly: EXTRACT(DAY FROM now() - entered_stage_at).
  days_in_stage     integer,
  sla_breached      boolean     NOT NULL DEFAULT false,
  counsellor_name   text
);

CREATE INDEX IF NOT EXISTS idx_fse_case
  ON funnel_stage_entries(case_id);

-- Used by PipelineAgingTable: open entries per org, filtered by sla_breached
CREATE INDEX IF NOT EXISTS idx_fse_org_stage
  ON funnel_stage_entries(org_id, funnel_stage, sla_breached);

-- Used by StaleAlertBanner: open breached entries per org
CREATE INDEX IF NOT EXISTS idx_fse_open_breached
  ON funnel_stage_entries(org_id, sla_breached)
  WHERE exited_stage_at IS NULL;

-- Verify: SELECT * FROM funnel_stage_entries; — empty table, correct columns.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 5 — audit_log enrichment
-- Adds typed analytics columns to the existing audit_log table.
-- Uses ADD COLUMN IF NOT EXISTS — safe if columns already exist.
-- The action_type column intentionally stays as TEXT here (not the enum) because
-- we cannot guarantee the existing audit_log rows are clean enum values.
-- The Edge Function and logAuditEvent() always write valid enum strings.
-- ───────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS action_type     text,
  ADD COLUMN IF NOT EXISTS counsellor_id   text,
  ADD COLUMN IF NOT EXISTS counsellor_name text,
  ADD COLUMN IF NOT EXISTS case_quadrant   text,
  ADD COLUMN IF NOT EXISTS metadata        jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_action_type
  ON audit_log(action_type);

-- Used by DocVelocityTable: counsellor action history ordered by time
CREATE INDEX IF NOT EXISTS idx_audit_counsellor
  ON audit_log(counsellor_name, created_at);

-- Used by daily aggregation: actions per org in a date range
CREATE INDEX IF NOT EXISTS idx_audit_org_created
  ON audit_log(org_id, created_at);

-- Verify: New columns appear in the Supabase table inspector for audit_log.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 6 — agency_settings SLA thresholds
-- Default values represent typical timelines. Managers update these in-app
-- without a code deployment. The SLA breach check in the Edge Function reads
-- these values at runtime.
-- ───────────────────────────────────────────────────────────────────────────────

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS sla_lead            integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS sla_docs_pending    integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS sla_ready_to_apply  integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sla_applied         integer DEFAULT 21,
  ADD COLUMN IF NOT EXISTS sla_visa_prep       integer DEFAULT 10,
  -- Phase 4: confidence threshold below which a VIP case is flagged "Unverified"
  -- in CounsellorScorecards. Default 0.4 per plan Section 7.3.
  ADD COLUMN IF NOT EXISTS viability_confidence_threshold numeric(3,2) DEFAULT 0.40;

-- Verify: SELECT sla_lead, sla_docs_pending, sla_ready_to_apply,
--                sla_applied, sla_visa_prep, viability_confidence_threshold
--         FROM agency_settings LIMIT 1;
-- All six columns should return their default values.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 7 — daily_counselor_stats aggregate table
-- Pre-aggregated counts so the EffortAllocationHeatmap widget never queries
-- raw audit_log directly. Populated nightly by the snapshot Edge Function.
-- The UNIQUE constraint on (org_id, counsellor_name, stat_date) enables upserts.
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_counselor_stats (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid    NOT NULL,
  counsellor_name  text    NOT NULL,
  stat_date        date    NOT NULL DEFAULT CURRENT_DATE,
  actions_vip      integer DEFAULT 0,
  actions_sales    integer DEFAULT 0,
  actions_drainers integer DEFAULT 0,
  actions_dead     integer DEFAULT 0,
  actions_total    integer DEFAULT 0,
  stage_changes    integer DEFAULT 0,
  docs_uploaded    integer DEFAULT 0,
  emails_sent      integer DEFAULT 0,
  CONSTRAINT uq_counsellor_stat_date UNIQUE (org_id, counsellor_name, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_dcs_org_date
  ON daily_counselor_stats(org_id, stat_date);

-- Verify: SELECT * FROM daily_counselor_stats; — empty table, correct columns.


-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 8a — Postgres trigger function
-- Called automatically whenever cases.pipeline_stage changes.
-- Closes the current open funnel_stage_entries row and opens a new one.
-- This replaces any client-side funnel_stage_entries writes — do NOT also write
-- from updateLeadStatus() in the React client (that would double-write).
-- The trigger cannot know counsellor_id — that stays in the client audit_log call.
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION track_funnel_stage_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Guard: only fire when pipeline_stage actually changed
  IF OLD.pipeline_stage IS NOT DISTINCT FROM NEW.pipeline_stage THEN
    RETURN NEW;
  END IF;

  -- Close the current open entry for this case and record elapsed days
  UPDATE funnel_stage_entries
  SET exited_stage_at = now(),
      days_in_stage   = EXTRACT(DAY FROM now() - entered_stage_at)::integer
  WHERE case_id = NEW.id
    AND exited_stage_at IS NULL;

  -- Open a new entry for the incoming stage
  INSERT INTO funnel_stage_entries (case_id, org_id, funnel_stage, counsellor_name)
  VALUES (NEW.id, NEW.org_id, NEW.pipeline_stage, NEW.counsellor_name);

  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 8b — Attach trigger to cases table
-- ───────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_funnel_stage_entry ON cases;

CREATE TRIGGER trg_funnel_stage_entry
  AFTER UPDATE OF pipeline_stage ON cases
  FOR EACH ROW EXECUTE FUNCTION track_funnel_stage_entry();

-- ───────────────────────────────────────────────────────────────────────────────
-- STEP 8c — Seed existing active cases with an open funnel_stage_entries row
-- Run once on migration. ON CONFLICT DO NOTHING makes it safe to re-run.
-- Uses status_updated_at as entered_stage_at so the days_in_stage count is
-- accurate from the real date the case entered its current stage.
-- ───────────────────────────────────────────────────────────────────────────────

INSERT INTO funnel_stage_entries (
  case_id,
  org_id,
  funnel_stage,
  counsellor_name,
  entered_stage_at
)
SELECT
  id,
  org_id,
  pipeline_stage,
  counsellor_name,
  COALESCE(status_updated_at, created_at)
FROM cases
WHERE lead_status != 'Done'
  AND pipeline_stage IS NOT NULL
ON CONFLICT DO NOTHING;

-- Verify Step 8:
--   1. Run: SELECT * FROM funnel_stage_entries; — should have rows for all active cases.
--   2. In the app, move any case to a different status.
--   3. Run: SELECT * FROM funnel_stage_entries WHERE case_id = '<that case id>'
--      You should see TWO rows: one with exited_stage_at set, one with it NULL.
--      If you see two rows, the trigger is working correctly.


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF PHASE 1 MIGRATIONS
-- All Steps 2–8 complete. Before proceeding to Phase 2 (Edge Function):
--   ✓ case_snapshots table exists and is empty
--   ✓ funnel_stage_entries table exists with rows for all active cases
--   ✓ audit_log has new typed columns
--   ✓ agency_settings has SLA threshold columns
--   ✓ daily_counselor_stats table exists and is empty
--   ✓ Postgres trigger fires on pipeline_stage changes
-- ═══════════════════════════════════════════════════════════════════════════════
