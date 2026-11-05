-- Plak dit in Supabase onder SQL Editor en klik op Run.
-- Iedere gebruiker kan alleen zijn eigen artikelen lezen en wijzigen.

create table public.artikelen (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  gewijzigd timestamptz not null,
  verwijderd boolean not null default false,
  server_tijd timestamptz not null default clock_timestamp()
);

create index artikelen_sync on public.artikelen (user_id, server_tijd);

-- De serverklok bepaalt wat er nieuw is, zodat een verkeerd ingestelde telefoon geen wijzigingen mist.
create function public.zet_server_tijd() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_tijd := clock_timestamp();
  return new;
end;
$$;

create trigger artikelen_server_tijd
before insert or update on public.artikelen
for each row execute function public.zet_server_tijd();

alter table public.artikelen enable row level security;

create policy "eigen artikelen lezen" on public.artikelen
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "eigen artikelen toevoegen" on public.artikelen
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "eigen artikelen wijzigen" on public.artikelen
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.artikelen from anon;
grant select, insert, update on public.artikelen to authenticated;
