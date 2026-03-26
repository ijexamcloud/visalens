-- ============================================================
-- VisaLens B2B Billing Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── ORGANIZATIONS TABLE ─────────────────────────────────────
-- One row per paying client (counselling agency / business)

create table if not exists organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text unique not null,
  plan              text not null default 'starter',    -- starter | pro | enterprise
  credits_remaining integer not null default 100,
  credits_total     integer not null default 100,       -- total ever purchased (for stats)
  is_active         boolean not null default true,
  access_code       text unique,                        -- the DEMO code clients enter in the gate
  notes             text,                               -- internal notes (billing, contact etc.)
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

-- ── USAGE LOG TABLE ─────────────────────────────────────────
-- Every API call is logged here for billing audit trail

create table if not exists usage_log (
  id            bigserial primary key,
  org_id        uuid references organizations(id) on delete cascade,
  model         text,
  input_tokens  integer default 0,
  output_tokens integer default 0,
  credits_used  integer default 1,
  endpoint      text default 'proxy',
  created_at    timestamptz not null default now()
);

-- ── INDEXES ─────────────────────────────────────────────────
create index if not exists idx_usage_log_org_id    on usage_log(org_id);
create index if not exists idx_usage_log_created   on usage_log(created_at desc);
create index if not exists idx_orgs_access_code    on organizations(access_code);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
-- Only the service_role key (used by proxy) can read/write
-- The anon key (used by frontend) has NO access

alter table organizations enable row level security;
alter table usage_log      enable row level security;

-- Service role bypasses RLS by default in Supabase — no policy needed
-- This means the anon key cannot query these tables at all (safe)

-- ── HELPER VIEWS ────────────────────────────────────────────
-- Quick dashboard view: org stats with usage totals

create or replace view org_dashboard as
select
  o.id,
  o.name,
  o.email,
  o.plan,
  o.credits_remaining,
  o.credits_total,
  o.is_active,
  o.access_code,
  o.created_at,
  o.last_used_at,
  coalesce(u.calls_today, 0)    as calls_today,
  coalesce(u.calls_this_month, 0) as calls_this_month,
  coalesce(u.total_calls, 0)    as total_calls,
  coalesce(u.total_tokens, 0)   as total_tokens
from organizations o
left join lateral (
  select
    count(*) filter (where created_at >= current_date)                          as calls_today,
    count(*) filter (where created_at >= date_trunc('month', now()))             as calls_this_month,
    count(*)                                                                     as total_calls,
    sum(input_tokens + output_tokens)                                            as total_tokens
  from usage_log
  where org_id = o.id
) u on true;

-- ── STORED PROCEDURE: top up credits ────────────────────────
-- Call this from Supabase dashboard or your billing webhook

create or replace function topup_credits(
  p_org_id uuid,
  p_credits integer,
  p_notes text default null
) returns void
language plpgsql
security definer
as $$
begin
  update organizations
  set
    credits_remaining = credits_remaining + p_credits,
    credits_total     = credits_total + p_credits,
    notes = case when p_notes is not null then
              coalesce(notes, '') || e'\n' || now()::text || ': Topped up ' || p_credits || ' credits. ' || p_notes
            else notes end
  where id = p_org_id;

  if not found then
    raise exception 'Organization % not found', p_org_id;
  end if;
end;
$$;

-- ── SAMPLE DATA ─────────────────────────────────────────────
-- Insert a test org to verify everything works
-- Delete or update this before going live

insert into organizations (name, email, plan, credits_remaining, credits_total, access_code, notes)
values (
  'Demo Agency',
  'demo@visalens.io',
  'starter',
  500,
  500,
  'VISALENS-DEMO-2026',
  'Initial demo org — update with real client details'
)
on conflict (email) do nothing;

-- ── VERIFY ──────────────────────────────────────────────────
-- Run this to confirm setup worked:
-- select * from org_dashboard;
