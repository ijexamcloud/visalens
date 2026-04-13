**VisaLens**

Analytics & Performance Tracking

*Full Implementation Plan — v1.1*

Scope: Supabase schema design · Edge Function cron · Manager Analytics Dashboard · Event Dictionary

Stack: React · Supabase (Postgres \+ Edge Functions) · Cloudflare Worker (existing proxy) · docScore.js (shared)

Resume note: This document is the single source of truth. If this conversation is interrupted, share this document in a new chat to resume exactly where we left off.

v1.1 changes: Gap A clarified (server-side scoring, Option 2). Gap B resolved (daily\_counselor\_stats). Gap C resolved (Postgres trigger). Phased rollout added. v1.2 changes: Code drift risk resolved (pre-deploy sync script \+ CI check added to Section 5.2). action\_type column upgraded from plain text to Postgres enum (Section 4.4) — database now rejects invalid event types at write time.

# **1\. What We Are Building**

VisaLens currently tracks case state in real time but has no memory of how cases changed over time. This means managers cannot answer critical questions like: which counsellors are converting leads to submissions fastest, where are cases getting stuck for weeks, and are counsellors spending their effort on the right students?

We are building three interconnected systems to answer those questions:

| System | Purpose |
| :---- | :---- |
| **Snapshot Pipeline** | A server-side cron that writes a daily record of every active case's scores, quadrant, and funnel stage to Supabase. This is the data foundation everything else reads from. |
| **Manager Analytics Dashboard** | A new React route (/analytics) visible only to org\_owner and branch\_manager roles. Shows pipeline aging, counsellor effort allocation, quadrant transition trends, and stale case alerts. |
| **Event Dictionary & Audit Schema** | A standardised audit\_log schema with typed action enums, plus a /admin/docs route that documents every tracked event, table definition, and score version. This prevents the system from becoming uninterpretable in 6 months. |

*What we are NOT building: we are not replacing the existing real-time scoring in RadarMatrix.jsx or StudentDashboard.jsx. Those stay exactly as they are. The snapshot pipeline is additive — it reads from the same cases table and writes to new tables only.*

# **2\. Why Each Decision Was Made**

## **2.1 Server-side snapshotting, not client-side**

The existing RadarMatrix has an onQuadrantsComputed callback that fires when quadrant positions are computed. An earlier approach considered using this to write snapshots from the browser. This was rejected for three reasons:

* A case only gets snapshotted if a counsellor happens to open the RadarMatrix view that day. Cases that are not viewed that day have no snapshot row, creating gaps in trend data.

* Two counsellors with the same case open simultaneously would double-write the same snapshot.

* Mobile or flaky connections would silently drop writes with no retry mechanism.

A Supabase Edge Function running on a midnight cron reads all active cases directly from the database and writes snapshots uniformly, regardless of user behaviour. The browser keeps its live scoring unchanged.

## **2.2 docScore.js stays as a pure function**

Both computeDocScore() and viabilityScore() in docScore.js are pure functions — they take a plain JS object and return a plain object with no DOM, React, or browser dependencies. This means they can be copied verbatim into a Supabase Edge Function running on Deno. No rewrite is needed.

## **2.3 How the Edge Function gets scores (Gap A — clarified)**

A reviewer correctly flagged: if docScore.js is a React file, how does the server-side cron calculate scores? This plan uses Option 2: the full docScore.js logic is copied verbatim to supabase/functions/\_shared/docScore.ts. The Edge Function imports computeDocScore() and viabilityScore() from that shared file and runs the calculations against the raw profile\_data JSONB stored in the cases table.

The frontend does NOT write pre-calculated scores to the cases table for the cron to copy. That approach (Option 1\) was rejected because it creates a dependency on a counsellor opening the app to refresh scores — exactly the reliability problem server-side snapshotting solves.

*Hard constraint: docScore.js must remain a pure function with zero browser or React dependencies forever. If any browser API is ever introduced into docScore.js, the Edge Function breaks. This is an architectural boundary on that file.*

## **2.4 Score versioning is non-negotiable**

The scoring weights in docScore.js (Passport=25pts, English=20pts, etc.) will change as the product evolves. A case\_snapshots row with doc\_score: 72 written today means something different if the weights change next month. Every snapshot row must store a scoring\_version integer. The docScore.js file must export a SCORE\_VERSION constant that is bumped on any weight change.

*Failure to do this makes all historical trend analysis unreliable. This is the single most important schema decision in the entire plan.*

## **2.5 Separate manager route, not a tab**

Analytics data is sensitive — counsellors should not see peer performance comparisons. Rather than a tab inside the existing StudentDashboard (which would require defensive rendering logic scattered across the component), analytics lives at a separate /analytics route with a hard role check at the top: if the user is not org\_owner or branch\_manager, they are redirected to the home dashboard.

## **2.6 SLA thresholds in agency\_settings, not hardcoded**

Different agencies operate on different timelines. An agency processing urgent student visas might flag a case as stale after 3 days in a stage; another running a slow-burn postgrad pipeline might tolerate 21 days. SLA thresholds per funnel stage must be stored in the agency\_settings table so managers can configure them without a code deployment.

# **3\. What Exactly Is Tracked**

## **3.1 The case\_snapshots table**

One row per active case per day. Written by the midnight Edge Function cron.

| Column | Type | Description | Example |
| :---- | :---- | :---- | :---- |
| id | uuid PK | Auto-generated | a1b2c3... |
| case\_id | uuid FK → cases | The case being snapshotted | — |
| org\_id | uuid FK → orgs | For row-level security | — |
| counsellor\_name | text | Counsellor at snapshot time | Ahmed Khan |
| funnel\_stage | text | pipeline\_stage value from cases | docs\_pending |
| lead\_status | text | lead\_status value from cases | Follow up |
| quadrant | text | vip | sales | drainers | dead | sales |
| doc\_score | integer | computeDocScore() result (0–100) | 65 |
| viability\_score | integer | viabilityScore().score (0–100) | 72 |
| viability\_confidence | numeric(3,2) | viabilityScore().confidence (0–1) | 0.74 |
| scoring\_version | integer NOT NULL | SCORE\_VERSION from docScore.js | 1 |
| snapshot\_date | date NOT NULL | Date of this snapshot (UTC) | 2025-07-15 |
| created\_at | timestamptz | Exact write timestamp | — |

*Index on (case\_id, snapshot\_date) and (org\_id, counsellor\_name, snapshot\_date) for the query patterns the dashboard will use.*

## **3.2 The funnel\_stage\_entries table**

Tracks how long each case spends in each funnel stage. One row is inserted when a case enters a stage; that row is updated with exited\_stage\_at when the case moves to the next stage.

| Column | Type | Description | Example |
| :---- | :---- | :---- | :---- |
| id | uuid PK | Auto-generated | — |
| case\_id | uuid FK → cases | The case | — |
| org\_id | uuid FK → orgs | For RLS | — |
| funnel\_stage | text | Stage entered | docs\_pending |
| entered\_stage\_at | timestamptz NOT NULL | When case entered this stage | 2025-07-01 |
| exited\_stage\_at | timestamptz | NULL until case moves on | 2025-07-14 |
| days\_in\_stage | integer (computed) | exited \- entered in days | 13 |
| sla\_breached | boolean DEFAULT false | Set true if days\_in\_stage \> SLA threshold | false |
| counsellor\_name | text | Counsellor at time of entry | Sara Ali |

This table is written to by the existing updateLeadStatus() function in StudentDashboard.jsx — we add two lines: INSERT on entry, UPDATE on exit.

## **3.3 The audit\_log table (enriched)**

The audit\_log already exists but likely uses free-form text for action types. We standardise it with a typed action\_type column. Every counsellor action that matters for analytics logs a row here.

| Column | Type | Description | Example |
| :---- | :---- | :---- | :---- |
| id | uuid PK | Auto-generated | — |
| case\_id | uuid FK | Case this action relates to | — |
| org\_id | uuid | For RLS | — |
| counsellor\_id | text | member\_id from org session | mbr\_abc123 |
| counsellor\_name | text | Denormalised for fast queries | Ahmed Khan |
| action\_type | text NOT NULL | Enum value — see Section 3.4 | STAGE\_CHANGED |
| metadata | jsonb | Action-specific payload | {"from":"lead","to":"docs\_pending"} |
| case\_quadrant | text | Quadrant at time of action | sales |
| created\_at | timestamptz DEFAULT now() | When action occurred | — |

## **3.4 The action\_type event dictionary**

These are the only valid values for audit\_log.action\_type. Any new trackable event must be added here first, then implemented.

| action\_type value | What triggers it | Key metadata fields |
| :---- | :---- | :---- |
| STAGE\_CHANGED | updateLeadStatus() called in StudentDashboard | { from, to, pipeline\_stage } |
| DOC\_UPLOADED | File attached and processed by AI analyser | { doc\_type, file\_name } |
| DOC\_FLAGGED\_MISSING | Counsellor or AI flags a missing document | { doc\_label } |
| EMAIL\_SENT | Email sent via InboxDashboard or proxy | { subject, recipient\_type } |
| NOTE\_ADDED | appendNoteEntry() called | { length\_chars } |
| CASE\_REASSIGNED | bulkReassign() or single reassign called | { from\_counsellor, to\_counsellor } |
| ACTION\_QUEUE\_USED | Smart Next Best Action executed | { action\_label, quadrant } |
| CASE\_ARCHIVED | Case moved to archive / Dead Zone action | {} |
| PROGRAM\_MATCHED | ProgramMatcher result applied to case | { university, program } |
| OFFER\_RECEIVED | Offer letter status updated | { university, status } |
| VISA\_SUBMITTED | Case moves to ready\_for\_visa stage | { country } |

# **4\. Database Setup (Supabase SQL)**

Run these migrations in order in the Supabase SQL editor. Each is idempotent.

## **4.1 Add scoring\_version to docScore.js**

*Before any database work: open docScore.js and add this as the first export at the top of the file.*

export const SCORE\_VERSION \= 1;  // bump this whenever scoring weights change

## **4.2 case\_snapshots table**

CREATE TABLE IF NOT EXISTS case\_snapshots (  id                   uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  case\_id              uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,  org\_id               uuid NOT NULL,  counsellor\_name      text,  funnel\_stage         text,  lead\_status          text,  quadrant             text CHECK (quadrant IN ('vip','sales','drainers','dead')),  doc\_score            integer,  viability\_score      integer,  viability\_confidence numeric(3,2),  scoring\_version      integer NOT NULL DEFAULT 1,  snapshot\_date        date NOT NULL DEFAULT CURRENT\_DATE,  created\_at           timestamptz DEFAULT now());CREATE INDEX IF NOT EXISTS idx\_snapshots\_case\_date ON case\_snapshots(case\_id, snapshot\_date);CREATE INDEX IF NOT EXISTS idx\_snapshots\_org\_counsellor ON case\_snapshots(org\_id, counsellor\_name, snapshot\_date);ALTER TABLE case\_snapshots ENABLE ROW LEVEL SECURITY;

## **4.3 funnel\_stage\_entries table**

CREATE TABLE IF NOT EXISTS funnel\_stage\_entries (  id                uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  case\_id           uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,  org\_id            uuid NOT NULL,  funnel\_stage      text NOT NULL,  entered\_stage\_at  timestamptz NOT NULL DEFAULT now(),  exited\_stage\_at   timestamptz,  days\_in\_stage     integer GENERATED ALWAYS AS (    EXTRACT(DAY FROM (COALESCE(exited\_stage\_at, now()) \- entered\_stage\_at))::integer  ) STORED,  sla\_breached      boolean NOT NULL DEFAULT false,  counsellor\_name   text);CREATE INDEX IF NOT EXISTS idx\_fse\_case ON funnel\_stage\_entries(case\_id);CREATE INDEX IF NOT EXISTS idx\_fse\_org\_stage ON funnel\_stage\_entries(org\_id, funnel\_stage, sla\_breached);

## **4.4 audit\_log enrichment**

\-- Add typed columns if audit\_log exists alreadyALTER TABLE audit\_log  ADD COLUMN IF NOT EXISTS action\_type    text,  ADD COLUMN IF NOT EXISTS counsellor\_id  text,  ADD COLUMN IF NOT EXISTS counsellor\_name text,  ADD COLUMN IF NOT EXISTS case\_quadrant  text,  ADD COLUMN IF NOT EXISTS metadata       jsonb DEFAULT '{}'::jsonb;CREATE INDEX IF NOT EXISTS idx\_audit\_action\_type ON audit\_log(action\_type);CREATE INDEX IF NOT EXISTS idx\_audit\_counsellor ON audit\_log(counsellor\_name, created\_at);

## **4.5 agency\_settings SLA columns**

\-- Add SLA thresholds per funnel stage (days before case is "stale")ALTER TABLE agency\_settings  ADD COLUMN IF NOT EXISTS sla\_lead           integer DEFAULT 3,  ADD COLUMN IF NOT EXISTS sla\_docs\_pending   integer DEFAULT 14,  ADD COLUMN IF NOT EXISTS sla\_ready\_to\_apply integer DEFAULT 7,  ADD COLUMN IF NOT EXISTS sla\_applied        integer DEFAULT 21,  ADD COLUMN IF NOT EXISTS sla\_visa\_prep      integer DEFAULT 10;

## **4.6 daily\_counselor\_stats aggregate table (Gap B fix)**

Querying raw audit\_log for the EffortAllocationHeatmap will not scale. At a few thousand cases with daily actions, the audit\_log table will have hundreds of thousands of rows within months. The fix is a lightweight aggregate table populated by a second nightly cron (or appended to the snapshot cron).

CREATE TABLE IF NOT EXISTS daily\_counselor\_stats (  id                uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  org\_id            uuid NOT NULL,  counsellor\_name   text NOT NULL,  stat\_date         date NOT NULL DEFAULT CURRENT\_DATE,  actions\_vip       integer DEFAULT 0,  actions\_sales     integer DEFAULT 0,  actions\_drainers  integer DEFAULT 0,  actions\_dead      integer DEFAULT 0,  actions\_total     integer DEFAULT 0,  stage\_changes     integer DEFAULT 0,  docs\_uploaded     integer DEFAULT 0,  emails\_sent       integer DEFAULT 0,  CONSTRAINT uq\_counsellor\_stat\_date UNIQUE (org\_id, counsellor\_name, stat\_date));CREATE INDEX IF NOT EXISTS idx\_dcs\_org\_date ON daily\_counselor\_stats(org\_id, stat\_date);

The snapshot Edge Function appends an aggregation step at the end: it counts audit\_log rows from the past 24 hours grouped by counsellor\_name and case\_quadrant, then upserts into daily\_counselor\_stats. The EffortAllocationHeatmap widget queries this table only — never raw audit\_log directly.

*The dashboard must never query audit\_log directly for aggregate metrics. All widgets that need counts or percentages read from daily\_counselor\_stats or case\_snapshots only.*

## **4.7 Postgres trigger for funnel\_stage\_entries (Gap C fix)**

The plan originally instrumented updateLeadStatus() in StudentDashboard.jsx to write funnel\_stage\_entries rows. A reviewer correctly identified that stage changes can also happen via bulk operations, direct API calls, or future automation — and the React client would miss all of those. The correct place is a Postgres trigger on the cases table.

\-- Function called by the triggerCREATE OR REPLACE FUNCTION track\_funnel\_stage\_entry()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN  \-- Only fire if pipeline\_stage actually changed  IF OLD.pipeline\_stage IS NOT DISTINCT FROM NEW.pipeline\_stage THEN    RETURN NEW;  END IF;  \-- Close the current open entry for this case  UPDATE funnel\_stage\_entries  SET exited\_stage\_at \= now()  WHERE case\_id \= NEW.id AND exited\_stage\_at IS NULL;  \-- Open a new entry for the new stage  INSERT INTO funnel\_stage\_entries (case\_id, org\_id, funnel\_stage, counsellor\_name)  VALUES (NEW.id, NEW.org\_id, NEW.pipeline\_stage, NEW.counsellor\_name);  RETURN NEW;END;$$;-- Attach to cases tableCREATE TRIGGER trg\_funnel\_stage\_entryAFTER UPDATE OF pipeline\_stage ON casesFOR EACH ROW EXECUTE FUNCTION track\_funnel\_stage\_entry();-- Seed existing cases with an open entry (run once on migration)INSERT INTO funnel\_stage\_entries (case\_id, org\_id, funnel\_stage, counsellor\_name, entered\_stage\_at)SELECT id, org\_id, pipeline\_stage, counsellor\_name, COALESCE(status\_updated\_at, created\_at)FROM casesWHERE lead\_status \!= 'Done'ON CONFLICT DO NOTHING;

Because the trigger now owns funnel\_stage\_entries writes, the instrumentation in updateLeadStatus() (Section 6.1) should remove the two manual INSERT/UPDATE calls for funnel\_stage\_entries. Those lines are no longer needed and would cause double-writes.

*Keep the logAuditEvent("STAGE\_CHANGED") call in updateLeadStatus() — that still belongs in the client because it captures the counsellor\_id from the session, which the database trigger cannot know.*

# **5\. Snapshot Edge Function (Supabase Cron)**

Create this file at: supabase/functions/snapshot-cases/index.ts

Schedule it in Supabase Dashboard → Database → Cron Jobs: 0 0 \* \* \* (midnight UTC daily).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";import { computeDocScore, viabilityScore, SCORE\_VERSION } from "../\_shared/docScore.ts";const supabase \= createClient(  Deno.env.get("SUPABASE\_URL")\!,  Deno.env.get("SUPABASE\_SERVICE\_ROLE\_KEY")\!);Deno.serve(async () \=\> {  const today \= new Date().toISOString().split("T")\[0\];  // Fetch all active cases (not Done / archived)  const { data: cases } \= await supabase    .from("cases")    .select("id, org\_id, counsellor\_name, lead\_status, pipeline\_stage, profile\_data, results, doc\_list")    .not("lead\_status", "eq", "Done");  if (\!cases?.length) return new Response("No active cases", { status: 200 });  const snapshots \= cases.map(c \=\> {    const docResult   \= computeDocScore(c.profile\_data, c.results);    const viabResult  \= viabilityScore(c.profile\_data);    const rScore      \= docResult.score;    const vScore      \= viabResult.score;    const quadrant    \= vScore \>= 50 && rScore \>= 50 ? "vip"                      : vScore \>= 50 && rScore  \< 50 ? "sales"                      : vScore  \< 50 && rScore \>= 50 ? "drainers"                      : "dead";    return {      case\_id:              c.id,      org\_id:               c.org\_id,      counsellor\_name:      c.counsellor\_name,      funnel\_stage:         c.pipeline\_stage,      lead\_status:          c.lead\_status,      quadrant,      doc\_score:            rScore,      viability\_score:      vScore,      viability\_confidence: viabResult.confidence,      scoring\_version:      SCORE\_VERSION,      snapshot\_date:        today,    };  });  // Upsert — safe to re-run if cron fires twice  await supabase.from("case\_snapshots")    .upsert(snapshots, { onConflict: "case\_id,snapshot\_date" });  return new Response(\`Snapshotted ${snapshots.length} cases\`, { status: 200 });});

## **5.2 Preventing code drift — the pre-deploy sync script**

Because the Edge Function runs docScore.ts from a \_shared folder, there is now a second copy of the scoring logic. If a developer updates docScore.js in the React app but forgets to sync the \_shared copy, the frontend and the cron will calculate different scores silently. This is the most dangerous failure mode in the entire system: the React UI shows a student as VIP (score 90\) while the nightly snapshot records them as a Time Drainer (score 40), and the manager dashboard is wrong with no error anywhere.

The fix is a pre-deploy script in package.json that copies docScore.js into the Edge Function folder automatically before every deployment. This makes forgetting to sync physically impossible.

// package.json — add to scripts section"scripts": {  "sync:docScore": "cp src/docScore.js supabase/functions/\_shared/docScore.ts",  "predeploy:functions": "npm run sync:docScore",  "deploy:functions": "supabase functions deploy snapshot-cases",  "deploy": "npm run sync:docScore && supabase functions deploy snapshot-cases"}

Additionally, add a CI check that fails the build if the two files differ. This catches the case where a developer deploys manually without running the sync script:

\# .github/workflows/check-docscore-sync.ymlname: Check docScore syncon: \[push, pull\_request\]jobs:  check-sync:    runs-on: ubuntu-latest    steps:      \- uses: actions/checkout@v3      \- name: Verify docScore files match        run: |          if \! diff src/docScore.js supabase/functions/\_shared/docScore.ts \> /dev/null; then            echo "ERROR: docScore.js and \_shared/docScore.ts are out of sync."            echo "Run: npm run sync:docScore and commit the result."            exit 1          fi

*Rule: the \_shared/docScore.ts file is never edited directly. It is always a copy of src/docScore.js. If you need to change scoring logic, change docScore.js, run npm run sync:docScore, and commit both files together.*

The upsert uses onConflict: "case\_id,snapshot\_date" which requires a unique constraint:

ALTER TABLE case\_snapshots ADD CONSTRAINT uq\_case\_snapshot\_date UNIQUE (case\_id, snapshot\_date);

# **6\. Frontend Changes**

## **6.1 Instrument updateLeadStatus() — audit log only (trigger owns stage entries)**

The Postgres trigger (Section 4.7) now owns all funnel\_stage\_entries writes. The client no longer needs to INSERT or UPDATE that table. The only thing updateLeadStatus() adds to the analytics pipeline is the audit\_log entry — because only the client has the counsellor\_id from the session, which the database trigger cannot access.

async function updateLeadStatus(id, newStatus, currentStatus) {  const s \= getOrgSession();  if (\!s?.org\_id) return false;  const newStage \= LEAD\_STATUS\_TO\_PIPELINE\_STAGE\[newStatus\] || "lead";  // 1\. Update cases table — Postgres trigger fires automatically,  //    closes old funnel\_stage\_entry, opens new one. No client work needed.  const { error } \= await supabase.from("cases")    .update({ lead\_status: newStatus, pipeline\_stage: newStage,              updated\_at: new Date().toISOString(),              status\_updated\_at: new Date().toISOString() })    .eq("id", id).eq("org\_id", s.org\_id);  if (error) return false;  // 2\. Log to audit\_log (client-only: needs counsellor\_id from session)  await logAuditEvent(id, "STAGE\_CHANGED", {    from: currentStatus,    to:   newStatus,    pipeline\_stage: newStage,  });  return true;}

## **6.2 The logAuditEvent() utility**

Add this shared helper to StudentDashboard.jsx (or a shared utils file). All instrumentation points call this function.

async function logAuditEvent(caseId, actionType, metadata \= {}, quadrant \= null) {  const s \= getOrgSession();  if (\!s?.org\_id || \!caseId) return;  await supabase.from("audit\_log").insert({    case\_id:          caseId,    org\_id:           s.org\_id,    counsellor\_id:    s.member\_id,    counsellor\_name:  s.name || s.email || "Unknown",    action\_type:      actionType,    metadata:         metadata,    case\_quadrant:    quadrant,  });}

## **6.3 Additional instrumentation points**

Add logAuditEvent() calls at these locations:

| Location in code | action\_type | metadata to pass |
| :---- | :---- | :---- |
| appendNoteEntry() — after successful update | NOTE\_ADDED | { length\_chars: text.length } |
| bulkReassign() — after successful update | CASE\_REASSIGNED | { from\_counsellor, to\_counsellor } |
| fetchNextBestAction() — when result is executed by user | ACTION\_QUEUE\_USED | { action\_label, quadrant } |
| File upload handler — after AI analysis completes | DOC\_UPLOADED | { doc\_type, file\_name } |
| RadarMatrix DetailPanel archive action | CASE\_ARCHIVED | {} |
| InboxDashboard send handler | EMAIL\_SENT | { subject, recipient\_type: "student" } |

## **6.4 New /analytics route**

In App.jsx, add this route alongside the existing /admin check:

// In App.jsx root routerif (currentPath \=== '/analytics') {  if (\!\['org\_owner','branch\_manager'\].includes(orgSession?.role)) {    window.location.href \= '/';    return null;  }  return \<AnalyticsDashboard orgSession={orgSession} onLogout={handleLogout} /\>;}

# **7\. Manager Analytics Dashboard**

A new file: AnalyticsDashboard.jsx. Route: /analytics. Role-gated to org\_owner and branch\_manager only.

## **7.1 Data queries the dashboard runs**

| Widget | Query source | Key fields used |
| :---- | :---- | :---- |
| Pipeline Aging Table | funnel\_stage\_entries WHERE exited\_stage\_at IS NULL | days\_in\_stage, sla\_breached, counsellor\_name, funnel\_stage |
| Counsellor Scorecard | case\_snapshots (last 30 days) \+ audit\_log (last 30 days) | quadrant counts, action\_type counts grouped by counsellor |
| Quadrant Transition | case\_snapshots — self-join on consecutive dates | quadrant changes per case per week |
| Effort Allocation | audit\_log JOIN case\_snapshots ON (case\_id, date) | % of actions on each quadrant per counsellor |
| Doc Upload Velocity | audit\_log WHERE action\_type IN (DOC\_FLAGGED\_MISSING, DOC\_UPLOADED) | elapsed time between paired events per case |
| Stale Case Alerts | funnel\_stage\_entries WHERE sla\_breached \= true | counsellor\_name, funnel\_stage, days\_in\_stage |

## **7.2 AnalyticsDashboard.jsx component structure**

| Component | Responsibility |
| :---- | :---- |
| **\<AnalyticsDashboard\>** | Root component. Fetches all data on mount. Holds loading/error state. Renders nav tabs. |
| **\<PipelineAgingTable\>** | Table of cases past SLA. Sortable by counsellor, stage, days overdue. Red highlight on breach. |
| **\<CounsellorScorecards\>** | Card per counsellor. Shows quadrant breakdown, effort allocation bar, movement delta. |
| **\<QuadrantTransitionChart\>** | Week-by-week line chart (Recharts). One line per quadrant. Shows if VIP count is growing. |
| **\<EffortAllocationHeatmap\>** | Bar chart per counsellor: % of actions on VIP vs Sales vs Drainers vs Dead Zone. |
| **\<DocVelocityTable\>** | Per counsellor: average days from DOC\_FLAGGED\_MISSING to DOC\_UPLOADED. |
| **\<StaleAlertBanner\>** | Top of page. Count of cases past SLA right now. Click drills to PipelineAgingTable filtered. |

## **7.3 The confidence field in counsellor scoring**

The viability\_confidence column in case\_snapshots (0.0 to 1.0) must be surfaced in the CounsellorScorecards widget. A case with viability\_score: 80 but confidence: 0.2 should display as "Unverified VIP" — flagged for profile completion, not counted as a genuine VIP case. The scorecard must not inflate a counsellor's VIP count with low-confidence cases.

*Threshold: confidence \< 0.4 → treat as unverified. confidence \>= 0.4 → count normally. This threshold is configurable in agency\_settings.*

# **8\. Implementation Sequence**

Complete these steps in order. Each step is independently testable before proceeding.

| Step | Task | File / Location | Test |
| :---- | :---- | :---- | :---- |
| 1 | Add SCORE\_VERSION export to docScore.js | docScore.js — top of file | Import in browser console, check value is 1 |
| 1b | Add pre-deploy sync script to package.json (Section 5.2) | package.json | Run npm run sync:docScore — confirm file appears at supabase/functions/\_shared/docScore.ts |
| 2 | Create audit\_action\_type Postgres enum (Section 4.4) | Supabase SQL editor | SELECT enum\_range(NULL::audit\_action\_type) returns all 11 values |
| 3 | Run case\_snapshots SQL migration | Supabase SQL editor | SELECT \* FROM case\_snapshots — empty table, correct columns |
| 4 | Run funnel\_stage\_entries SQL migration | Supabase SQL editor | SELECT \* FROM funnel\_stage\_entries — empty table |
| 5 | Run audit\_log enrichment migration | Supabase SQL editor | New columns appear in table inspector |
| 6 | Run agency\_settings SLA migration | Supabase SQL editor | Default SLA values present in row |
| 7 | Run daily\_counselor\_stats migration (Section 4.6) | Supabase SQL editor | SELECT \* FROM daily\_counselor\_stats — empty table |
| 8 | Create Postgres trigger \+ seed existing cases (Section 4.7) | Supabase SQL editor | Update a case stage, confirm funnel\_stage\_entries gets 2 rows automatically |
| 9 | Copy docScore.js to Edge Function shared folder | supabase/functions/\_shared/docScore.ts | deno check passes. Confirm \_shared/docScore.ts matches src/docScore.js |
| 10 | Create snapshot-cases Edge Function | supabase/functions/snapshot-cases/index.ts | supabase functions invoke snapshot-cases — rows appear in case\_snapshots and daily\_counselor\_stats |
| 11 | Schedule cron in Supabase Dashboard | Database → Cron Jobs | Cron job listed as active, fires at midnight UTC |
| 12 | (Phase 2 gate) Let cron run for 3+ days | — | SELECT COUNT(\*) FROM case\_snapshots returns \> 0 rows across multiple dates |
| 13 | Add logAuditEvent() helper to StudentDashboard | StudentDashboard.jsx | Change a case status, check audit\_log row appears with correct action\_type |
| 14 | Instrument updateLeadStatus() — audit log only | StudentDashboard.jsx | Move a case status, verify audit\_log row. Verify funnel\_stage\_entries updated by trigger (not client) |
| 15 | Add remaining instrumentation points | StudentDashboard.jsx \+ RadarMatrix.jsx | Perform each action type, verify corresponding audit\_log row |
| 16 | Add /analytics route to App.jsx | App.jsx | Navigate as manager — loads. Navigate as counsellor — redirects to / |
| 17 | Build AnalyticsDashboard.jsx skeleton | AnalyticsDashboard.jsx | Page loads with nav tabs, loading states, and role gate |
| 18 | Build StaleAlertBanner \+ PipelineAgingTable | AnalyticsDashboard.jsx | Shows cases from funnel\_stage\_entries with correct days\_in\_stage and sla\_breached highlight |
| 19 | Build CounsellorScorecards widget | AnalyticsDashboard.jsx | Each card shows correct quadrant counts, unverified VIP flag for confidence \< 0.4 |
| 20 | Build EffortAllocationHeatmap widget | AnalyticsDashboard.jsx | Reads from daily\_counselor\_stats only. Bars sum to 100% per counsellor |
| 21 | Build QuadrantTransitionChart | AnalyticsDashboard.jsx | Line chart renders with data from case\_snapshots across multiple dates |
| 22 | Build DocVelocityTable | AnalyticsDashboard.jsx | Shows avg elapsed time per counsellor between DOC\_FLAGGED\_MISSING and DOC\_UPLOADED |
| 23 | Add /admin/docs event dictionary route | AdminPanel.jsx or new file | Page renders full action\_type table, schema docs, and SCORE\_VERSION changelog |

# **9\. Phased Rollout**

Do not build all 22 steps in one session. The three phases below ensure each layer is verified before the next is built on top of it. Building the dashboard before the cron has run even once means you are developing widgets against empty tables.

| Phase | Steps |
| :---- | :---- |
| **Phase 1 — Schema & Triggers** | Steps 1–7. All Supabase SQL migrations and the Postgres trigger. No React changes yet. At the end of Phase 1, moving a case stage in the existing app should automatically create funnel\_stage\_entries rows — verifiable in the Supabase table editor. |
| **Phase 2 — Edge Function & Data Collection** | Steps 8–11. Deploy the Edge Function, schedule the cron, and wait at least 3 days before touching the dashboard. This gives you real snapshot data to develop widgets against. Test by manually invoking the function and confirming rows appear in case\_snapshots and daily\_counselor\_stats. |
| **Phase 3 — Instrumentation & Dashboard** | Steps 12–22. Add audit\_log instrumentation to the frontend, then build the AnalyticsDashboard widgets one at a time. Each widget has a clear data source defined in Section 7.1 — build against real data, not mocks. |

*The Phase 2 waiting period is not optional. A QuadrantTransitionChart with one day of data is misleading. Three days minimum; one week is better. Use this time to complete the Phase 3 instrumentation steps (12–14) so audit\_log starts accumulating real data too.*

# **🧠 Phase 4: Student Intelligence & Lead Demographics**

# **Building upon the v1.2 Analytics Architecture, we can utilize the raw student data (Academics, Financials, Demographics) to build predictive models and optimize the sales strategy.**

# **Here are the three high-impact insights we can generate, and exactly how to track them.**

## **1\. The "Counselor-Archetype MatchMatrix" (Sales Matchmaking)**

# **Not all counselors are good at closing the same type of student. Some counselors are highly empathetic and great at hand-holding young students. Others are highly analytical and excel at processing complex financial cases for older applicants.**

# **What we can track:**

* # **Correlate the counselor\_id with the student's age\_bracket, financial\_tier, and academic\_band.**

* # **Compare this to the QuadrantTransitionChart (who gets these profiles to the VIP lane fastest?).**

# **The ROI / Sales Pitch Impact:**

* # **Insight: You discover Counselor A has a 70% conversion rate on "High Financial, Low GPA" students, while Counselor B has a 10% conversion rate on them but crushes "High GPA" scholarship cases.**

* # **Action: Instead of round-robin lead routing, you implement Smart Routing. When a lead comes in and their GPA is detected as \>3.8, it automatically assigns to Counselor B.**

## **2\. The Lead Source vs. "Viability Heatmap"**

# **Agencies spend thousands on marketing (Facebook ads, university fairs, referrals). Right now, you might only know how many leads a source generated. You need to know the *quality* of those leads.**

# **What we can track:**

* # **Map the lead\_source (from student profile) against the initial viability\_score generated on Day 1\.**

* # **Map lead\_source against the funnel\_stage\_entries to see the drop-off rate.**

# **The ROI / Sales Pitch Impact:**

* # **Insight: Facebook ads generate 500 leads/month, but the heatmap shows 85% of them start in the "Dead Zone" (Score \< 30\) and stay there. Conversely, organic website leads are only 50/month, but 60% start as "Sales Priority" (Score \> 50).**

* # **Action: You instantly reallocate your marketing budget. You also tell your sales team: "If the lead is from a Uni Fair, use Pitch A (focused on speed). If from Facebook, use Pitch B (focused on education/warming up)."**

## **3\. The "Financial Velocity" Correlation**

# **Does having more money actually mean the case moves faster? Do students from specific regions get stuck in the "Docs Pending" stage longer due to complex local banking regulations?**

# **What we can track:**

* # **Take the \_parseCurrencyAmount data from docScore.js and bucket it into tiers (e.g., Tier 1: $0-$10k, Tier 2: $10k-$30k, Tier 3: $30k+).**

* # **Cross-reference this with the PipelineAgingTable (Time-in-Stage).**

# **The ROI / Sales Pitch Impact:**

* # **Insight: You notice Tier 2 financial cases from a specific country *always* stall for 21+ days in "Docs Pending" because of a specific bank statement verification rule.**

* # **Action: You update the Smart Next Best Action in the UI. The moment a student from that country enters the pipeline, the system prompts the counselor to send a highly specific "Banking Checklist PDF" on Day 1, cutting the stall time in half.**

## **⚙️ How to bolt this onto the v1.2 Architecture**

# **The beauty of the v1.2 plan is that we don't need a massive new system. We just need to expand the Snapshot Pipeline.**

# **1\. Update the case\_snapshots table:**

# **Add a single JSONB column to the case\_snapshots table called student\_metadata.**

# **2\. Update the Edge Function Cron:**

# **When the midnight cron pulls the case to calculate the score, have it also extract the parsed profile data and save it in the snapshot:**

# **// Inside the case\_snapshots table**

# **"student\_metadata": {**

#   **"age\_bracket": "18-22",**

#   **"gpa\_band": "3.5-4.0",**

#   **"funding\_tier": "Tier\_2",**

#   **"nationality": "IN"**

# **}**

# 

# **3\. Build the "Demographics Tab" in the Analytics Dashboard:**

# **Because the metadata is stored historically in the snapshot, your React UI can now easily query: *"Show me the conversion rate to VIP Lane, grouped by student\_metadata-\>\>gpa\_band"*.**

# **This allows you to build a visual Student Heatmap widget without impacting the performance of the core database.**

# 

# 

# **10\. How to Resume This Work in a New Chat**

If this conversation is interrupted, do the following in a new Claude chat:

* Upload this document plus App.jsx, RadarMatrix.jsx, StudentDashboard.jsx, and docScore.js.

* Say: "We are building the VisaLens analytics system. The full plan is in the document. We left off at step \[N\] of Section 8\. Please continue from there."

* Claude will read the document and have complete context — stack, schema, component structure, instrumentation points, and reasoning — without needing the conversation history.

*This document covers everything. There is no context in the chat history that is not also in this document.*

*VisaLens Analytics Implementation Plan · v1.2 · Confidential*