-- Additive rollout: old dispatchers continue to work until v2 is deployed.
alter table public.email_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.email_outbox add column if not exists claimed_at timestamptz;
alter table public.email_outbox add column if not exists first_attempt_at timestamptz;
alter table public.email_outbox add column if not exists delivery_uncertain boolean not null default false;

create or replace function public.claim_email_jobs_v2(p_limit integer default 1, p_job_id uuid default null)
returns setof public.email_outbox
language plpgsql security definer set search_path = ''
as $$
begin
  -- A stale claim may have reached Resend. Never automatically replay after its
  -- 24-hour idempotency window or if the original claim time is unknown.
  update public.email_outbox
    set status='FAILED', last_error='delivery uncertain: reconcile with provider before retry'
    where status='SENDING' and (claimed_at is null or claimed_at < now()-interval '10 minutes')
      and (first_attempt_at is null or first_attempt_at < now()-interval '23 hours' or attempts>=6);
  update public.email_outbox
    set status='FAILED', last_error='delivery uncertain: reconcile with provider before retry'
    where status='QUEUED' and delivery_uncertain
      and (first_attempt_at is null or first_attempt_at < now()-interval '23 hours' or attempts>=6);
  update public.email_outbox set status='FAILED',last_error='retry limit reached'
    where status='QUEUED' and attempts>=6;
  return query
  update public.email_outbox e
    set status='SENDING', attempts=e.attempts+1, claimed_at=now(),
      first_attempt_at=case when e.delivery_uncertain or e.status='SENDING'
                           then coalesce(e.first_attempt_at,now()) else now() end,
      delivery_uncertain=e.delivery_uncertain or e.status='SENDING'
    where e.id in (
      select q.id from public.email_outbox q
      where (p_job_id is null or q.id=p_job_id) and q.attempts<6
        and ((q.status='QUEUED' and q.next_attempt_at<=now())
          or (q.status='SENDING' and q.claimed_at<now()-interval '10 minutes'
              and q.first_attempt_at>=now()-interval '23 hours'))
      order by q.created_at,q.id
      limit least(greatest(coalesce(p_limit,1),1),5)
      for update skip locked)
    returning e.*;
end;
$$;
revoke all on function public.claim_email_jobs_v2(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_email_jobs_v2(integer,uuid) to service_role;
-- Exact server-only lookup: no first-page scan or guessing user preferences.
create or replace function public.email_recipient_id(p_email text)
returns uuid language sql stable security definer set search_path=''
as $$ select id from auth.users where lower(email)=lower(p_email) and email_confirmed_at is not null limit 1 $$;
revoke all on function public.email_recipient_id(text) from public,anon,authenticated;
grant execute on function public.email_recipient_id(text) to service_role;

