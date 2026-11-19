-- Peer ratings refer to real marketplace interactions even when payment occurs offline.
alter table public.reviews alter column transaction_id drop not null;
alter table public.reviews add column hidden_at timestamptz;
create unique index reviews_one_chat_rating_per_peer on public.reviews(reviewer_id,reviewee_id)
where transaction_id is null;

drop policy reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using(hidden_at is null);
drop policy reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated with check (
  reviewer_id=(select auth.uid()) and hidden_at is null and exists (
    select 1 from public.transactions t where t.id=reviews.transaction_id and t.auction_id=reviews.auction_id
    and ((t.buyer_id=reviews.reviewer_id and t.seller_id=reviews.reviewee_id)
      or (t.seller_id=reviews.reviewer_id and t.buyer_id=reviews.reviewee_id)))
);

create or replace function private.sync_review_rating() returns trigger
language plpgsql security definer set search_path='' as $$
declare peer uuid;
begin
  for peer in select distinct peer_id from unnest(array[
    case when tg_op <> 'INSERT' then old.reviewee_id end,
    case when tg_op <> 'DELETE' then new.reviewee_id end
  ]) as ids(peer_id) where peer_id is not null order by peer_id loop
    perform 1 from public.profiles where id=peer for update;
    update public.profiles set (rating_sum,rating_count)=(
      select coalesce(sum(rating),0),count(*) from public.reviews where reviewee_id=peer and hidden_at is null
    ), updated_at=clock_timestamp() where id=peer;
  end loop;
  return null;
end;
$$;

create function public.chat_review_context(p_peer uuid)
returns table(listing_id uuid,already_reviewed boolean)
language sql stable security definer set search_path='' as $$
  select c.listing_id, exists(select 1 from public.reviews r where r.transaction_id is null
    and r.reviewer_id=auth.uid() and r.reviewee_id=p_peer)
  from public.listing_conversations c
  where ((c.buyer_id=auth.uid() and c.seller_id=p_peer) or (c.seller_id=auth.uid() and c.buyer_id=p_peer))
    and not exists(select 1 from public.profiles p where p.id in(auth.uid(),p_peer) and p.is_banned)
    and exists(select 1 from public.listing_messages m where m.conversation_id=c.id and m.sender_id=auth.uid())
    and exists(select 1 from public.listing_messages m where m.conversation_id=c.id and m.sender_id=p_peer)
  order by c.last_message_at desc,c.id limit 1;
$$;

create function public.submit_chat_review(p_peer uuid,p_rating integer,p_comment text)
returns void language plpgsql security definer set search_path='' as $$
declare item uuid;
begin
  if auth.uid() is null or p_rating is null or p_rating not between 1 and 5 or char_length(p_comment)>1000 then
    raise exception 'invalid_review';
  end if;
  select listing_id into item from public.chat_review_context(p_peer);
  if item is null then raise exception 'exchange_required'; end if;
  insert into public.reviews(auction_id,reviewer_id,reviewee_id,rating,comment)
  values(item,auth.uid(),p_peer,p_rating,nullif(btrim(p_comment),''));
end;
$$;

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check(target_type in ('auction','user','message','review'));
drop policy reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
with check(reporter_id=(select auth.uid()) and target_type in ('auction','user'));

-- Only trusted functions capture and release a reported excerpt. The rest of the thread remains participant-only.
create table private.report_evidence (
  report_id uuid primary key references public.reports(id) on delete cascade,
  author_id uuid not null,
  excerpt text not null,
  decision_by uuid,
  decided_at timestamptz
);
revoke all on private.report_evidence from public,anon,authenticated;

create function public.report_marketplace_content(p_kind text,p_target uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare
  author uuid;
  excerpt text;
  report uuid;
begin
  if auth.uid() is null or p_reason is null or char_length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'invalid_report';
  end if;
  if p_kind='message' then
    select m.sender_id,m.body into author,excerpt from public.listing_messages m
    join public.listing_conversations c on c.id=m.conversation_id
    where m.id=p_target and auth.uid() in(c.buyer_id,c.seller_id);
  elsif p_kind='review' then
    select r.reviewer_id,concat(r.rating,'/5 ',r.comment) into author,excerpt from public.reviews r
    where r.id=p_target and r.hidden_at is null;
  end if;
  if author is null or author=auth.uid() then raise exception 'invalid_target'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1982));
  if (select count(*) from public.reports where reporter_id=auth.uid() and created_at>now()-interval '1 hour')>=20
    then raise exception 'too_many_reports'; end if;
  insert into public.reports(reporter_id,target_type,target_id,reason)
    values(auth.uid(),p_kind,p_target,btrim(p_reason)) returning id into report;
  insert into private.report_evidence(report_id,author_id,excerpt) values(report,author,excerpt);
end;
$$;

create function public.marketplace_moderation_queue()
returns table(report_id uuid,kind text,reason text,excerpt text,username text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.id,r.target_type,r.reason,e.excerpt,p.username,r.created_at
  from private.report_evidence e join public.reports r on r.id=e.report_id
  left join public.profiles p on p.id=e.author_id
  where public.has_permission(auth.uid(),'reports.view') and r.status in ('OPEN','REVIEWING')
  order by r.created_at,r.id limit 50;
$$;

create function public.decide_marketplace_report(p_report uuid,p_decision text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reports%rowtype;
begin
  if p_decision is null or p_decision not in ('dismiss','resolve','hide') or auth.uid() is null
    or not public.has_permission(auth.uid(),case when p_decision='dismiss' then 'reports.dismiss' else 'reports.resolve' end)
    then raise exception 'decision_refused'; end if;
  select * into r from public.reports where id=p_report and target_type in ('review','message')
    and status in ('OPEN','REVIEWING') for update;
  if not found then raise exception 'report_closed'; end if;
  if p_decision='hide' then
    if r.target_type <> 'review' then raise exception 'invalid_decision'; end if;
    update public.reviews set hidden_at=clock_timestamp() where id=r.target_id and hidden_at is null;
  end if;
  update private.report_evidence set decision_by=auth.uid(),decided_at=clock_timestamp() where report_id=r.id;
  update public.reports set status=case when p_decision='dismiss' then 'DISMISSED' else 'RESOLVED' end,
    resolution=p_decision,resolved_at=clock_timestamp() where id=r.id;
end;
$$;

revoke all on function public.chat_review_context(uuid), public.submit_chat_review(uuid,integer,text),
public.report_marketplace_content(text,uuid,text),public.marketplace_moderation_queue(),public.decide_marketplace_report(uuid,text)
from public,anon,authenticated;
grant execute on function public.chat_review_context(uuid), public.submit_chat_review(uuid,integer,text),
public.report_marketplace_content(text,uuid,text),public.marketplace_moderation_queue(),public.decide_marketplace_report(uuid,text)
to authenticated;
