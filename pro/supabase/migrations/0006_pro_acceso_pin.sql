-- 0006: las dueñas de agenda (PRO) entran con el nombre de su agenda + un PIN de 6 dígitos.
-- Cada agenda tiene un usuario de Supabase Auth con un correo sintético que nunca recibe mails
-- (<slug>@pin.agenda-nail.invalid) y el PIN como contraseña. Lo crea/cambia la Edge Function
-- 'admin-pin' (sólo superadmin, con la service role dentro de la función). RLS no cambia (sigue por auth.uid()).
-- Sólo agrega/ajusta objetos PRO; no toca la app raíz.

-- Lista de gestión: suma tiene_pin.
drop function if exists public.pro_admin_lista();
create function public.pro_admin_lista()
returns table (id uuid, slug text, nombre text, estado text, logo_path text, color text, whatsapp text, instagram text,
               zona text, created_at timestamptz, cuenta_email text, tiene_pin boolean, servicios bigint, pendientes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  return query
    select p.id, p.slug, p.nombre, p.estado, p.logo_path, p.color, p.whatsapp, p.instagram, p.zona, p.created_at,
           u.email::text,
           coalesce(u.email like '%@pin.agenda-nail.invalid', false),
           (select count(*) from public.pro_servicios s where s.profesional_id = p.id and s.activo),
           (select count(*) from public.pro_turnos t where t.profesional_id = p.id and t.estado = 'pendiente')
    from public.profesionales p left join auth.users u on u.id = p.user_id
    order by p.created_at;
end $$;

-- Alta completa de una agenda desde gestión (reemplaza el auto-registro público).
create or replace function public.pro_admin_crear_agenda(p_slug text, p_nombre text, p_whatsapp text, p_instagram text,
                                                         p_zona text, p_estado text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_wa text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  v_ig text := nullif(regexp_replace(btrim(coalesce(p_instagram, '')), '^@', ''), '');
  v_zona text := nullif(btrim(coalesce(p_zona, '')), '');
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 60 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if not private.pro_slug_valido(v_slug) then raise exception 'SLUG_INVALIDO'; end if;
  if coalesce(p_estado, '') not in ('pendiente','activa','pausada') then raise exception 'DATOS_INVALIDOS: estado'; end if;
  begin
    insert into public.profesionales (slug, nombre, whatsapp, instagram, zona, estado)
    values (v_slug, v_nombre, v_wa, v_ig, v_zona, p_estado) returning id into v_id;
  exception when unique_violation then raise exception 'SLUG_EN_USO';
  end;
  perform private.pro_horarios_iniciales(v_id);
  return v_id;
end $$;
revoke all on function public.pro_admin_lista(), public.pro_admin_crear_agenda(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pro_admin_lista(), public.pro_admin_crear_agenda(text, text, text, text, text, text) to authenticated;

-- Sin auto-registro: nadie puede crearse una agenda desde el frontend.
revoke execute on function public.pro_registrar(text, text) from authenticated;

-- Ayudas para la Edge Function (sólo service_role).
create or replace function public.pro_srv_usuario_por_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;
create or replace function public.pro_srv_cerrar_sesiones(p_uid uuid)
returns void language sql volatile security definer set search_path = '' as $$
  delete from auth.sessions where user_id = p_uid;
$$;
revoke all on function public.pro_srv_usuario_por_email(text), public.pro_srv_cerrar_sesiones(uuid) from public, anon, authenticated;
grant execute on function public.pro_srv_usuario_por_email(text), public.pro_srv_cerrar_sesiones(uuid) to service_role;
