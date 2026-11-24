-- Listing contact numbers only. Payout validation and contact RLS remain unchanged.
set local lock_timeout = '5s';
alter table public.listing_contacts
  drop constraint listing_contacts_phone_e164_check,
  add constraint listing_contacts_phone_e164_check
    check (phone_e164 ~ '^[+][1-9][0-9]{6,14}$');
