-- Gestión privada de Agustin: sus clientas (manicuristas que compran la agenda).
-- Sólo un superadmin (tabla superadmins) puede leer o escribir. No toca tablas existentes.
create table public.admin_clientas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  link text check (link is null or (link ~ '^https?://' and char_length(link) <= 300)),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  instagram text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  estado text not null default 'prueba' check (estado in ('activa','pausada','prueba')),
  fecha_alta date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  notas text check (notas is null or char_length(notas) <= 1000),
  profesional_id uuid references public.profesionales(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index admin_clientas_prof_idx on public.admin_clientas (profesional_id);
create trigger admin_clientas_updated before update on public.admin_clientas for each row execute function private.tocar_updated_at();

alter table public.admin_clientas enable row level security;
create policy admin_clientas_superadmin on public.admin_clientas for all to authenticated
  using ((select private.pro_es_superadmin())) with check ((select private.pro_es_superadmin()));
revoke all on public.admin_clientas from anon, authenticated;
grant select, insert, update, delete on public.admin_clientas to authenticated;

-- Agustin (tavsoria4@gmail.com, ya registrado) como superadmin. No modifica su usuario: sólo agrega una fila.
insert into public.superadmins (user_id)
select id from auth.users where lower(email) = 'tavsoria4@gmail.com'
on conflict do nothing;

-- Primera clienta: Katia Ferrero Nails (versión actual, en la raíz del sitio).
insert into public.admin_clientas (nombre, link, whatsapp, instagram, estado, notas, profesional_id)
select 'Katia Ferrero Nails', 'https://soritahh.github.io/agenda-nail/', '3534125853', 'kaatii__nails', 'activa',
       'Primera clienta (beta).', (select id from public.profesionales where slug = 'katia')
where not exists (select 1 from public.admin_clientas where nombre = 'Katia Ferrero Nails');
