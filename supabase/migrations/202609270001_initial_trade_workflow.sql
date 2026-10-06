create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  reference text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'checking', 'action_required', 'ready_for_review')),
  latest_check_run_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  document_type text not null default 'other'
    check (document_type in (
      'commercial_invoice', 'packing_list', 'bill_of_lading',
      'certificate_of_origin', 'other'
    )),
  original_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null unique,
  checksum_sha256 text null,
  version integer not null default 1 check (version > 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'ready', 'error', 'superseded', 'deleted')),
  replaces_document_id uuid null references public.documents(id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index documents_active_by_shipment
  on public.documents(shipment_id, uploaded_at desc)
  where status not in ('superseded', 'deleted');

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  run_number integer not null check (run_number > 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  agent_run_id uuid null,
  issue_count integer not null default 0 check (issue_count >= 0),
  must_fix_count integer not null default 0 check (must_fix_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  result jsonb null,
  failure jsonb null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (shipment_id, run_number)
);

alter table public.shipments
  add constraint shipments_latest_check_run_fk
  foreign key (latest_check_run_id) references public.check_runs(id) on delete set null;

create table public.check_run_documents (
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  primary key (check_run_id, document_id)
);

create table public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  field_key text not null,
  normalized_value jsonb null,
  raw_value jsonb null,
  page_number integer null check (page_number is null or page_number > 0),
  source_quote text null,
  source_unit text null,
  confidence numeric(4,3) null check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (check_run_id, document_id, field_key)
);

create table public.validation_results (
  id uuid primary key default gen_random_uuid(),
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  field_key text not null,
  field_kind text not null check (field_kind in ('core', 'extra', 'cross_field')),
  status text not null check (status in ('passed', 'display', 'review', 'must_fix')),
  message text null,
  values_by_document jsonb not null default '{}'::jsonb,
  outlier_document_ids uuid[] not null default '{}',
  reference_value jsonb null,
  created_at timestamptz not null default now()
);

create index validation_results_by_run
  on public.validation_results(check_run_id, status);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  validation_result_id uuid null references public.validation_results(id) on delete set null,
  previous_issue_id uuid null references public.issues(id) on delete set null,
  resolved_by_check_run_id uuid null references public.check_runs(id) on delete set null,
  fingerprint text not null,
  field_key text not null,
  severity text not null check (severity in ('review', 'must_fix')),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'resolved')),
  needs_human_review boolean not null default false,
  message text not null,
  values_by_document jsonb not null default '{}'::jsonb,
  evidence_by_document jsonb not null default '{}'::jsonb,
  outlier_document_ids uuid[] not null default '{}',
  resolution_note text null,
  reviewed_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_active_by_shipment
  on public.issues(shipment_id, status, created_at desc);
create index issues_fingerprint_history
  on public.issues(shipment_id, fingerprint, created_at desc);

create table public.agent_run_events (
  id bigint generated always as identity primary key,
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  run_id uuid not null,
  sequence integer not null check (sequence >= 0),
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (check_run_id, sequence)
);

create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger issues_set_updated_at
before update on public.issues
for each row execute function public.set_updated_at();

alter table public.shipments enable row level security;
alter table public.documents enable row level security;
alter table public.check_runs enable row level security;
alter table public.check_run_documents enable row level security;
alter table public.extracted_fields enable row level security;
alter table public.validation_results enable row level security;
alter table public.issues enable row level security;
alter table public.agent_run_events enable row level security;

create policy shipments_owner_all on public.shipments
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy documents_owner_all on public.documents
for all to authenticated
using (
  exists (
    select 1 from public.shipments s
    where s.id = documents.shipment_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.shipments s
    where s.id = documents.shipment_id and s.owner_id = auth.uid()
  )
);

create policy check_runs_owner_all on public.check_runs
for all to authenticated
using (
  exists (
    select 1 from public.shipments s
    where s.id = check_runs.shipment_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.shipments s
    where s.id = check_runs.shipment_id and s.owner_id = auth.uid()
  )
);

create policy check_run_documents_owner_all on public.check_run_documents
for all to authenticated
using (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = check_run_documents.check_run_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = check_run_documents.check_run_id and s.owner_id = auth.uid()
  )
);

create policy extracted_fields_owner_all on public.extracted_fields
for all to authenticated
using (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = extracted_fields.check_run_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = extracted_fields.check_run_id and s.owner_id = auth.uid()
  )
);

create policy validation_results_owner_all on public.validation_results
for all to authenticated
using (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = validation_results.check_run_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = validation_results.check_run_id and s.owner_id = auth.uid()
  )
);

create policy issues_owner_all on public.issues
for all to authenticated
using (
  exists (
    select 1 from public.shipments s
    where s.id = issues.shipment_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.shipments s
    where s.id = issues.shipment_id and s.owner_id = auth.uid()
  )
);

create policy agent_run_events_owner_all on public.agent_run_events
for all to authenticated
using (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = agent_run_events.check_run_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.check_runs r
    join public.shipments s on s.id = r.shipment_id
    where r.id = agent_run_events.check_run_id and s.owner_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shipment-documents',
  'shipment-documents',
  false,
  4194304,
  array['application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy shipment_documents_owner_select on storage.objects
for select to authenticated
using (
  bucket_id = 'shipment-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shipment_documents_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'shipment-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shipment_documents_owner_update on storage.objects
for update to authenticated
using (
  bucket_id = 'shipment-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'shipment-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shipment_documents_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'shipment-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);
