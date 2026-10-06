-- A shipment deletes both its documents and check runs. These dependent
-- document links must cascade as well; otherwise PostgreSQL can reject the
-- shipment deletion depending on constraint-processing order.

alter table public.check_run_documents
  drop constraint if exists check_run_documents_document_id_fkey;

alter table public.check_run_documents
  add constraint check_run_documents_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete cascade;

alter table public.extracted_fields
  drop constraint if exists extracted_fields_document_id_fkey;

alter table public.extracted_fields
  add constraint extracted_fields_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete cascade;

-- Remove only the disposable record created by the 2026-09-28 end-to-end
-- smoke test. Its Storage objects were already removed by the application
-- before the original database deletion was rejected.
delete from public.shipments
where name = '__SMOKE_TEST__ shipment'
  and reference = 'SMOKE-DELETE-ME';
