CREATE OR REPLACE FUNCTION public.staff_decide_listing_review(p_review_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if a.seller_id=v_uid then
  if p_decision <> 'APPROVED' or not exists (
    select 1 from public.staff_assignments s where s.user_id=v_uid and s.role_key='OWNER' and s.status='ACTIVE'
  ) then raise exception 'self_review_forbidden' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'owner_override_reason_required' using errcode='22023';
  end if;
 end if;
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
   reason=nullif(btrim(coalesce(p_reason,'')),''),reviewed_at=clock_timestamp(),
   risk_flags=case when a.seller_id=v_uid then coalesce(r.risk_flags,'{}'::jsonb) || jsonb_build_object('owner_override',true) else r.risk_flags end where id=r.id;
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
end $function$
;
