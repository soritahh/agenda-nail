-- 0007: la manicurista elige su propio PIN.
-- Gestión genera un código de activación de un solo uso (se guarda sólo su hash, vence a los 7 días).
-- Con su agenda + ese código, ella elige su PIN en el panel (Edge Function 'admin-pin', acción 'activar').
-- La tabla no tiene políticas RLS: sólo la usa la Edge Function con la service role. No toca la app raíz.

create table if not exists public.pro_activaciones (
  profesional_id uuid primary key references public.profesionales(id) on delete cascade,
  codigo_hash text not null,
  expira timestamptz not null,
  intentos int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pro_activaciones enable row level security;
revoke all on table public.pro_activaciones from public, anon, authenticated;
grant all on table public.pro_activaciones to service_role;

-- Lista de gestión: suma el vencimiento del código pendiente (si hay).
drop function if exists public.pro_admin_lista();
create function public.pro_admin_lista()
returns table (id uuid, slug text, nombre text, estado text, logo_path text, color text, whatsapp text, instagram text,
               zona text, created_at timestamptz, cuenta_email text, tiene_pin boolean, codigo_expira timestamptz,
               servicios bigint, pendientes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  return query
    select p.id, p.slug, p.nombre, p.estado, p.logo_path, p.color, p.whatsapp, p.instagram, p.zona, p.created_at,
           u.email::text,
           coalesce(u.email like '%@pin.agenda-nail.invalid', false),
           (select a.expira from public.pro_activaciones a where a.profesional_id = p.id and a.expira > now()),
           (select count(*) from public.pro_servicios s where s.profesional_id = p.id and s.activo),
           (select count(*) from public.pro_turnos t where t.profesional_id = p.id and t.estado = 'pendiente')
    from public.profesionales p left join auth.users u on u.id = p.user_id
    order by p.created_at;
end $$;
revoke all on function public.pro_admin_lista() from public, anon, authenticated;
grant execute on function public.pro_admin_lista() to authenticated;
