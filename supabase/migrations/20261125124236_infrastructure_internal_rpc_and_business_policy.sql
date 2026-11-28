-- The helper is called only by SECURITY DEFINER team-management functions.
revoke execute on function public.staff_sync_is_admin(uuid) from public, anon, authenticated;
-- Preserve public read for visitors and combine the existing authenticated rules.
alter policy business_sellers_public_read on public.business_sellers to anon;
alter policy business_sellers_owner_staff_read on public.business_sellers
  using (status = 'ACTIVE'::text or owner_id = (select auth.uid()) or (select public.has_permission(auth.uid(), 'admin.access'::text)));
