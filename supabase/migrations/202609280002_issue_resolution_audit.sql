alter table public.issues
  add column if not exists resolution_method text null
    check (resolution_method in (
      'recheck_cleared',
      'recheck_persisted',
      'accepted_exception'
    )),
  add column if not exists reviewed_by uuid null
    references auth.users(id) on delete set null;

comment on column public.issues.resolution_method is
  'How this issue snapshot ended: cleared by re-check, superseded by a recurring issue, or accepted by a reviewer.';

comment on column public.issues.reviewed_by is
  'Authenticated user who most recently reviewed or accepted this issue.';
