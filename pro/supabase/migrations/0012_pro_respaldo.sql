-- 0012: Respaldo de datos (solo lectura). No modifica tablas ni datos.
-- private.respaldo_json(): todas las filas de las tablas de Agenda Nail (PRO + v1)
-- SIN secretos: no incluye pro_activaciones (hashes de códigos), ni endpoint/claves de
-- pro_push_subs, ni ref_token_hash de pro_turnos, ni vault ni tablas auth.
-- Incluye solo la lista de rutas de archivos de storage (no el contenido).

create or replace function private.respaldo_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'app', 'Agenda Nail PRO',
    'version', 1,
    'fecha', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
    'fecha_utc', now(),
    'excluido', jsonb_build_array(
      'pro_activaciones (hashes de códigos de activación)',
      'pro_push_subs.endpoint/p256dh/auth (claves de avisos push)',
      'pro_turnos.ref_token_hash',
      'vault', 'auth.*', 'contenido de archivos de storage'),
    'tablas', jsonb_build_object(
      'profesionales',  coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.profesionales t), '[]'::jsonb),
      'pro_servicios',  coalesce((select jsonb_agg(to_jsonb(t) order by t.profesional_id, t.created_at, t.id) from public.pro_servicios t), '[]'::jsonb),
      'pro_horarios',   coalesce((select jsonb_agg(to_jsonb(t) order by t.profesional_id, t.dia) from public.pro_horarios t), '[]'::jsonb),
      'pro_turnos',     coalesce((select jsonb_agg(to_jsonb(t) - 'ref_token_hash' order by t.profesional_id, t.fecha, t.hora_inicio, t.id) from public.pro_turnos t), '[]'::jsonb),
      'pro_push_subs',  coalesce((select jsonb_agg(to_jsonb(t) - 'endpoint' - 'p256dh' - 'auth' order by t.created_at, t.id) from public.pro_push_subs t), '[]'::jsonb),
      'admin_clientas', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.admin_clientas t), '[]'::jsonb),
      'superadmins',    coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.superadmins t), '[]'::jsonb),
      'admins',         coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.admins t), '[]'::jsonb),
      'v1_config',      coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.config t), '[]'::jsonb),
      'v1_horarios',    coalesce((select jsonb_agg(to_jsonb(t) order by t.dia) from public.horarios t), '[]'::jsonb),
      'v1_servicios',   coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.servicios t), '[]'::jsonb),
      'v1_turnos',      coalesce((select jsonb_agg(to_jsonb(t) order by t.fecha, t.hora_inicio, t.id) from public.turnos t), '[]'::jsonb)
    ),
    'storage', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bucket', o.bucket_id, 'ruta', o.name,
               'tamano', o.metadata->>'size', 'tipo', o.metadata->>'mimetype',
               'creado', o.created_at)
             order by o.bucket_id, o.name)
      from storage.objects o
      where o.bucket_id in (select b.id from storage.buckets b)), '[]'::jsonb)
  );
$$;

revoke all on function private.respaldo_json() from public, anon, authenticated;

-- RPC para la página de gestión: solo el admin (admins + superadmins).
create or replace function public.admin_respaldo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (coalesce(private.es_admin(), false) and coalesce(private.pro_es_superadmin(), false)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.respaldo_json();
end;
$$;

revoke all on function public.admin_respaldo() from public, anon;
grant execute on function public.admin_respaldo() to authenticated;
