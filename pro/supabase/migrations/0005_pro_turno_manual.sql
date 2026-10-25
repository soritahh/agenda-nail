-- Agenda Nail PRO · 0005: la dueña puede cargar turnos a mano (clientas que escriben, llaman o vienen sin turno).
-- El WhatsApp pasa a ser opcional sólo para estos turnos manuales (la reserva online lo sigue exigiendo).
alter table public.pro_turnos alter column clienta_telefono drop not null;

create or replace function public.pro_turno_manual(
  p_servicio_id uuid, p_fecha date, p_hora time, p_nombre text,
  p_telefono text default null, p_notas text default null, p_estado text default 'aprobado')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_pro public.profesionales%rowtype;
  v_srv public.pro_servicios%rowtype;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g'), '');
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fin time;
  v_id uuid;
begin
  select * into v_pro from public.profesionales where user_id = (select auth.uid());
  if not found then raise exception 'SIN_PERMISO'; end if;
  if v_pro.estado <> 'activa' then raise exception 'AGENDA_NO_DISPONIBLE'; end if;
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel is not null and v_tel !~ '^[0-9]{8,15}$' then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 300 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_estado not in ('aprobado', 'pendiente') then raise exception 'DATOS_INVALIDOS: estado'; end if;
  if p_fecha is null or p_hora is null or p_fecha < v_hoy - 30 or p_fecha > v_hoy + 365 then raise exception 'FECHA_INVALIDA'; end if;
  select * into v_srv from public.pro_servicios where id = p_servicio_id and profesional_id = v_pro.id;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;
  if extract(epoch from (time '23:59:59' - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  v_fin := p_hora + make_interval(mins => v_srv.duracion_min);
  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, fecha, hora_inicio, hora_fin, notas, estado)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, p_fecha, p_hora, v_fin, v_notas, p_estado)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;
  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'), 'hora_fin', to_char(v_fin, 'HH24:MI'));
end $$;

revoke all on function public.pro_turno_manual(uuid, date, time, text, text, text, text) from public, anon;
grant execute on function public.pro_turno_manual(uuid, date, time, text, text, text, text) to authenticated;
