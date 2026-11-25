-- Add full indexes for foreign keys lacking a covering valid index.
set local lock_timeout = '3s';
set local statement_timeout = '45s';
do $$
declare r record;
begin
  for r in
    select n.nspname as ns, c.relname as tab, con.conname,
      string_agg(quote_ident(a.attname), ', ' order by u.ord) as cols
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral unnest(con.conkey) with ordinality u(attnum,ord)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=u.attnum
    where con.contype='f' and n.nspname='public'
      and not exists (select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid join pg_am am on am.oid=ix.relam
        where i.indrelid=c.oid and i.indisvalid and i.indisready and i.indpred is null and i.indexprs is null and am.amname='btree'
          and i.indnkeyatts>=cardinality(con.conkey)
          and (select array_agg(k.attnum order by k.attnum) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord) where k.ord<=cardinality(con.conkey))=(select array_agg(z order by z) from unnest(con.conkey) z))
    group by 1,2,3 order by 2,3
  loop
    execute format('create index if not exists %I on %I.%I (%s)', 'bb_fk_' || md5(r.ns || '.' || r.tab || '.' || r.cols),r.ns,r.tab,r.cols);
  end loop;
end $$;
-- Preserve policy commands, roles, and access predicates; cache only current caller identity.
do $$
declare r record;
begin
  for r in select schemaname,tablename,policyname,qual from pg_policies
  where schemaname='public' and cmd='SELECT' and qual like '%auth.uid()%' and qual not like '%SELECT auth.uid()%'
    and policyname in ('company_cost_events_read','company_operating_costs_read','dispute_ops_cases_read','dispute_ops_events_read','external_seller_payout_claims_staff_read','external_seller_payout_events_staff_read','marketing_campaign_events_read','marketing_campaigns_read','payout_approval_events_read','payout_approval_requests_read','referral_codes_read_own','seller_payout_reconciliation_staff_select','support_staff_notes_scope','support_ticket_events_scope','support_messages_scope','support_tickets_scope')
  loop
    execute format('alter policy %I on %I.%I using (%s)',r.policyname,r.schemaname,r.tablename,replace(r.qual,'auth.uid()','(select auth.uid())'));
  end loop;
end $$;
