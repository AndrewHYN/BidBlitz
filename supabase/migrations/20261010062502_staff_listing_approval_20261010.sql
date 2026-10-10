-- Dedicated listing reviewer path with least privilege; does not grant full admin.
insert into public.staff_role_permissions(role_key,permission_key)
select role_key,permission_key from (values
 ('OPERATIONS','listings.approve'),('OPERATIONS','listings.reject'),
 ('OPERATIONS','listings.request_changes')
) v(role_key,permission_key)
join public.staff_permissions p on p.key=v.permission_key
join public.staff_roles r on r.key=v.role_key
on conflict (role_key,permission_key) do nothing;

create or replace function public.staff_listing_review_queue(p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
 if v_uid is null or not public.has_permission(v_uid,'listings.review') then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_limit<1 or p_limit>100 then raise exception 'invalid_limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_result
 from (
  select r.id as "reviewId",r.created_at as "submittedAt",
    a.id as "auctionId",a.title,a.description,
    a.status,a.condition,a.starting_bid_minor::text as "startingMinor",
    a.duration_seconds as "durationSeconds",
    a.location,coalesce(p.display_name,p.username,'Seller') as "sellerName"
  from public.listing_reviews r
  join public.auctions a on a.id=r.auction_id
  left join public.profiles p on p.id=a.seller_id
  where r.status='PENDING' and a.status='PENDING_REVIEW'
  order by r.created_at asc,r.id asc limit p_limit
 ) q;
 return v_result;
end $$;
revoke all on function public.staff_listing_review_queue(integer) from public,anon;
grant execute on function public.staff_listing_review_queue(integer) to authenticated;

create or replace function public.staff_decide_listing_review(
 p_review_id uuid,p_decision text,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
 r public.listing_reviews%rowtype;
 a public.auctions%rowtype;
 v_start timestamptz;
 v_permission text;
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501';end if;
 v_permission:=case p_decision
  when 'APPROVED' then 'listings.approve'
  when 'REJECTED' then 'listings.reject'
  when 'CHANGES_REQUESTED' then 'listings.request_changes'
  else null end;
 if v_permission is null or not public.has_permission(v_uid,v_permission) then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_decision<>'APPROVED' and char_length(btrim(coalesce(p_reason,'')))<5 then
  raise exception 'reason_required' using errcode='22023';
 end if;
 if char_length(coalesce(p_reason,''))>1000 then
  raise exception 'reason_too_long' using errcode='22023';
 end if;
 select * into r from public.listing_reviews where id=p_review_id for update;
 if not found or r.status<>'PENDING' then
  raise exception 'review_no_longer_pending' using errcode='P0001';
 end if;
 select * into a from public.auctions where id=r.auction_id for update;
 if not found or a.status<>'PENDING_REVIEW' then
  raise exception 'listing_not_under_review' using errcode='P0001';
 end if;
 if a.seller_id=v_uid then raise exception 'self_review_forbidden' using errcode='42501';end if;
 if p_decision='APPROVED' then
  v_start:=clock_timestamp();
  update public.auctions set
   status=case when a.starts_at is not null and a.starts_at>v_start
     then 'SCHEDULED'::public.auction_status_t else 'LIVE'::public.auction_status_t end,
   starts_at=case when a.starts_at is not null and a.starts_at>v_start
     then a.starts_at else v_start end,
   ends_at=(case when a.starts_at is not null and a.starts_at>v_start
     then a.starts_at else v_start end)+make_interval(secs=>a.duration_seconds),
   updated_at=v_start where id=a.id;
  update public.listing_reviews set status='APPROVED',reviewer_id=v_uid,
   reason=nullif(btrim(coalesce(p_reason,'')),''),reviewed_at=clock_timestamp() where id=r.id;
  insert into public.notifications(user_id,type,auction_id,payload)
  values(a.seller_id,'REVIEW_APPROVED',a.id,
    jsonb_build_object('title',a.title));
 else
  update public.auctions set status='DRAFT',updated_at=clock_timestamp() where id=a.id;
  update public.listing_reviews set status=p_decision,reviewer_id=v_uid,
   reason=btrim(p_reason),reviewed_at=clock_timestamp() where id=r.id;
  insert into public.notifications(user_id,type,auction_id,payload)
  values(a.seller_id,case when p_decision='REJECTED' then 'REVIEW_REJECTED'
   else 'REVIEW_CHANGES_REQUESTED' end,a.id,
   jsonb_build_object('title',a.title,'reason',btrim(p_reason)));
 end if;
 return jsonb_build_object('ok',true,'decision',p_decision,'reviewId',r.id);
end $$;
revoke all on function public.staff_decide_listing_review(uuid,text,text) from public,anon;
grant execute on function public.staff_decide_listing_review(uuid,text,text) to authenticated;
