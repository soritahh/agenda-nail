-- 0011: el aviso push sale sólo para pedidos del link público (marca de transacción), no según quién tenga sesión.
create or replace function private.pro_turno_notificar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secreto text;
begin
  if new.estado <> 'pendiente' then return null; end if;
  -- Sólo los pedidos hechos desde el link público (pro_solicitar_turno marca la transacción). Los turnos que carga la
  -- dueña (pro_turno_manual) o cualquier otro insert no avisan, aunque ella pruebe su propio link con la sesión abierta.
  if coalesce(current_setting('agenda_nail.origen', true), '') <> 'reserva_online' then return null; end if;
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
  perform set_config('agenda_nail.origen', 'reserva_online', true);
  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, sena, fecha,
      hora_inicio, hora_fin, notas, estado, ref_fotos_esperadas, ref_token_hash)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, v_sena, p_fecha, p_hora, v_fin, v_notas, 'pendiente',
      v_fotos, case when v_token is null then null else encode(sha256(convert_to(v_token, 'UTF8')), 'hex') end)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;
  perform set_config('agenda_nail.origen', '', true);

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'),
    'hora_fin', to_char(v_fin, 'HH24:MI'), 'servicio_nombre', v_srv.nombre, 'precio', v_srv.precio, 'sena', v_sena,
    'alias_pago', v_pro.alias_pago, 'estado', 'pendiente', 'ref_token', v_token);
end $$;
revoke all on function public.pro_solicitar_turno(text, uuid, date, time, text, text, text, integer) from public;
grant execute on function public.pro_solicitar_turno(text, uuid, date, time, text, text, text, integer) to anon, authenticated;
