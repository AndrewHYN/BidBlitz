-- Aggregates only; no file paths, customer identifiers, message bodies or addresses.
create or replace function public.infrastructure_health_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'measuredAt', now(),
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects where metadata->>'size' ~ '^[0-9]+$'),0),
    'buckets', coalesce((select jsonb_agg(to_jsonb(b) order by b.bucket) from (
      select bucket_id as bucket, count(*) as files,
        coalesce(sum((metadata->>'size')::bigint),0) as bytes,
        coalesce(round(avg((metadata->>'size')::bigint)),0) as average_bytes,
        coalesce(max((metadata->>'size')::bigint),0) as largest_bytes,
        count(*) filter (where (metadata->>'size')::bigint > 350000 and bucket_id='auction-images') as large_listing_files
      from storage.objects where metadata->>'size' ~ '^[0-9]+$' group by bucket_id
    ) b),'[]'::jsonb),
    'email', (select jsonb_build_object(
      'sentToday',count(*) filter(where status='SENT' and sent_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
      'sentMonth',count(*) filter(where status='SENT' and sent_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'),
      'queued',count(*) filter(where status='QUEUED'),
      'failed',count(*) filter(where status='FAILED'),
      'sending',count(*) filter(where status='SENDING')
    ) from public.email_outbox)
  );
$$;
revoke all on function public.infrastructure_health_snapshot() from public, anon, authenticated;
grant execute on function public.infrastructure_health_snapshot() to service_role;
