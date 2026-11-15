-- Remove table-level operations that bypass RLS or are never needed by
-- public browser clients. Standard RLS-scoped SELECT/INSERT/UPDATE/DELETE
-- continue to work; service role, database owner and internal triggers remain.
revoke truncate, references, trigger on all tables in schema public
  from public, anon, authenticated;

-- Also protect future tables created by the migration owner.
alter default privileges in schema public revoke truncate, references, trigger
  on tables from public, anon, authenticated;

comment on schema public is
  'Client roles may access row-level APIs as explicitly granted. TRUNCATE, REFERENCES and TRIGGER table privileges are not available to public clients.';
