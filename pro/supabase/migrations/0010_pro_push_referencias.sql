-- Agenda Nail PRO · 0010: avisos push a la dueña por cada pedido nuevo + fotos de referencia de la clienta.
--
-- Push: cada dispositivo de la dueña guarda su suscripción en pro_push_subs (sólo ve/agrega/borra las suyas).
-- Al entrar un pedido online (estado 'pendiente', no cargado por ella misma) un trigger llama con pg_net a la Edge
-- Function 'notificar-turno' con un header secreto que vive sólo en Vault. La función marca el turno como avisado
-- (una sola vez) y manda el push. Las claves VAPID también viven en Vault: la privada nunca sale del servidor.
--
-- Fotos de referencia: hasta 3 por pedido, en el bucket PRIVADO 'pro-referencias'. pro_solicitar_turno recibe
-- cuántas fotos vienen y, si son 1-3, devuelve un token de un solo uso (en la base sólo queda su hash) que vence a
-- los 15 minutos. Con ese token la Edge Function 'referencias-turno' sube las fotos con service role a
-- <profesional_id>/<turno_id>/. Las clientas no pueden listar ni leer nada del bucket; la dueña lee las de su
-- carpeta con URLs firmadas.

create extension if not exists pg_net with schema extensions;

-- ---------- Suscripciones push ----------
create table public.pro_push_subs (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references public.profesionales(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,30}$'),
  user_agent text check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  unique (profesional_id, endpoint)
);
alter table public.pro_push_subs enable row level security;
create policy pro_push_subs_leer on public.pro_push_subs for select to authenticated
  using (profesional_id = (select private.pro_mi_id()));
create policy pro_push_subs_crear on public.pro_push_subs for insert to authenticated
  with check (profesional_id = (select private.pro_mi_id()));
create policy pro_push_subs_borrar on public.pro_push_subs for delete to authenticated
  using (profesional_id = (select private.pro_mi_id()));
revoke all on public.pro_push_subs from anon;
grant select, insert, delete on public.pro_push_subs to authenticated;

-- Como mucho 10 dispositivos por agenda: al pasar, se borran los más viejos.
create or replace function private.pro_push_subs_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pro_push_subs where id in (
    select id from public.pro_push_subs where profesional_id = new.profesional_id order by created_at desc offset 10);
  return null;
end $$;
create trigger pro_push_subs_limite after insert on public.pro_push_subs for each row execute function private.pro_push_subs_limite();

-- ---------- Columnas nuevas de pro_turnos (no editables por la dueña: sólo estado y notas lo son) ----------
alter table public.pro_turnos
  add column notificado_at timestamptz,
  add column ref_fotos text[],
  add column ref_fotos_esperadas smallint not null default 0 check (ref_fotos_esperadas between 0 and 3),
  add column ref_token_hash text,
  add constraint pro_turnos_ref_fotos_max check (ref_fotos is null or cardinality(ref_fotos) <= 3);

-- ---------- Secretos en Vault ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pro_notif_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'pro_notif_secret',
      'Header x-notif-secret del trigger de pedidos nuevos hacia la Edge Function notificar-turno');
  end if;
end $$;

-- Sólo service role (la Edge Function): secreto del trigger y claves VAPID.
create or replace function public.pro_push_config()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'pro_notif_secret'),
    'vapid_publica', (select decrypted_secret from vault.decrypted_secrets where name = 'pro_vapid_publica'),
    'vapid_privada', (select decrypted_secret from vault.decrypted_secrets where name = 'pro_vapid_privada'));
$$;
-- La primera vez la función genera el par VAPID y lo guarda acá (si ya existe, no lo pisa).
create or replace function public.pro_push_guardar_vapid(p_publica text, p_privada text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_publica !~ '^[A-Za-z0-9_-]{80,90}$' or p_privada !~ '^[A-Za-z0-9_-]{40,46}$' then raise exception 'DATOS_INVALIDOS'; end if;
  if exists (select 1 from vault.secrets where name in ('pro_vapid_publica', 'pro_vapid_privada')) then return; end if;
  perform vault.create_secret(p_publica, 'pro_vapid_publica', 'VAPID pública (Web Push de Agenda Nail PRO)');
  perform vault.create_secret(p_privada, 'pro_vapid_privada', 'VAPID privada (Web Push de Agenda Nail PRO)');
end $$;
revoke all on function public.pro_push_config() from public, anon, authenticated;
revoke all on function public.pro_push_guardar_vapid(text, text) from public, anon, authenticated;
grant execute on function public.pro_push_config() to service_role;
grant execute on function public.pro_push_guardar_vapid(text, text) to service_role;

-- ---------- Trigger: pedido online nuevo -> Edge Function ----------
create or replace function private.pro_turno_notificar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secreto text;
begin
  if new.estado <> 'pendiente' then return null; end if;
  -- Turno cargado por la dueña desde su panel (pro_turno_manual): no se avisa.
  if (select auth.uid()) is not null
     and exists (select 1 from public.profesionales p where p.id = new.profesional_id and p.user_id = (select auth.uid())) then
    return null;
  end if;
  if not exists (select 1 from public.pro_push_subs s where s.profesional_id = new.profesional_id) then return null; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'pro_notif_secret';
  if v_secreto is null then return null; end if;
  perform net.http_post(
    url := 'https://hznwnzqaymwjguwltnue.supabase.co/functions/v1/notificar-turno',
    body := jsonb_build_object('turno_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-secret', v_secreto),
    timeout_milliseconds := 5000);
  return null;
exception when others then
  return null; -- un problema con el aviso nunca debe impedir la reserva
end $$;
create trigger pro_turnos_notificar after insert on public.pro_turnos
  for each row execute function private.pro_turno_notificar();

-- ---------- Reserva online: + cantidad de fotos de referencia (token de un solo uso) ----------
drop function if exists public.pro_solicitar_turno(text, uuid, date, time, text, text, text);
create or replace function public.pro_solicitar_turno(
  p_slug text, p_servicio_id uuid, p_fecha date, p_hora time, p_nombre text, p_telefono text,
  p_notas text default null, p_fotos integer default 0)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy date := v_ahora::date;
  v_pro public.profesionales%rowtype;
  v_hor public.pro_horarios%rowtype;
  v_srv public.pro_servicios%rowtype;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fotos integer := coalesce(p_fotos, 0);
  v_token text;
  v_fin time;
  v_sena integer;
  v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel !~ '^[0-9]{8,15}$' or char_length(coalesce(p_telefono,'')) > 25 then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 300 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS: fecha'; end if;
  if v_fotos < 0 or v_fotos > 3 then raise exception 'DATOS_INVALIDOS: fotos'; end if;

  select * into v_pro from public.profesionales where slug = lower(btrim(coalesce(p_slug, '')));
  if not found or v_pro.estado <> 'activa' then raise exception 'AGENDA_NO_DISPONIBLE'; end if;
  select * into v_srv from public.pro_servicios where id = p_servicio_id and profesional_id = v_pro.id and activo and not es_extra;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;

  if p_fecha < v_hoy or p_fecha > v_hoy + v_pro.dias_reserva then raise exception 'FECHA_INVALIDA'; end if;
  if p_fecha + p_hora <= v_ahora then raise exception 'FECHA_INVALIDA'; end if;

  select * into v_hor from public.pro_horarios where profesional_id = v_pro.id and dia = extract(dow from p_fecha)::smallint;
  if not found or not v_hor.trabaja then raise exception 'FUERA_DE_HORARIO'; end if;
  if v_pro.modo_horario = 'fijo' then
    if not (p_hora = any (v_hor.horas_fijas)) then raise exception 'FUERA_DE_HORARIO'; end if;
    if extract(epoch from (time '23:59:59' - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  else
    if p_hora < v_hor.inicio or (extract(epoch from (p_hora - v_hor.inicio))::int / 60) % v_pro.intervalo_min <> 0 then
      raise exception 'FUERA_DE_HORARIO';
    end if;
    if extract(epoch from (v_hor.fin - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  end if;
  v_fin := p_hora + make_interval(mins => v_srv.duracion_min);
  v_sena := private.pro_sena(v_srv.precio, v_pro.sena_pct);

  -- Límites anti abuso (por agenda)
  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.clienta_telefono = v_tel
        and t.estado = 'pendiente' and t.fecha >= v_hoy) >= 3 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;
  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;

  if v_fotos > 0 then v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); end if;
  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, sena, fecha,
      hora_inicio, hora_fin, notas, estado, ref_fotos_esperadas, ref_token_hash)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, v_sena, p_fecha, p_hora, v_fin, v_notas, 'pendiente',
      v_fotos, case when v_token is null then null else encode(sha256(convert_to(v_token, 'UTF8')), 'hex') end)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'),
    'hora_fin', to_char(v_fin, 'HH24:MI'), 'servicio_nombre', v_srv.nombre, 'precio', v_srv.precio, 'sena', v_sena,
    'alias_pago', v_pro.alias_pago, 'estado', 'pendiente', 'ref_token', v_token);
end $$;
revoke all on function public.pro_solicitar_turno(text, uuid, date, time, text, text, text, integer) from public;
grant execute on function public.pro_solicitar_turno(text, uuid, date, time, text, text, text, integer) to anon, authenticated;

-- ---------- Bucket privado de fotos de referencia ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pro-referencias', 'pro-referencias', false, 409600, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Sólo lectura de la dueña sobre <su id>/...; nadie más (anon/authenticated) puede subir, listar ni borrar:
-- las fotos las sube la Edge Function con service role.
create policy pro_referencias_leer_duena on storage.objects for select to authenticated
  using (bucket_id = 'pro-referencias' and (storage.foldername(name))[1] = (select private.pro_mi_id())::text);
