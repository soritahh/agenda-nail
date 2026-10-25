-- 0009 (PRO): descripción y "extra" por servicio, seña % + alias de pago por agenda, horarios fijos por día.
-- Sólo objetos PRO; no toca la app raíz.

-- Servicios: descripción corta y extras (se muestran como agregado, no se reservan solos).
alter table public.pro_servicios add column if not exists descripcion text;
alter table public.pro_servicios add column if not exists es_extra boolean not null default false;
alter table public.pro_servicios drop constraint if exists pro_servicios_descripcion_ok;
alter table public.pro_servicios add constraint pro_servicios_descripcion_ok check (descripcion is null or char_length(descripcion) <= 200);
grant insert (descripcion, es_extra) on public.pro_servicios to authenticated;
grant update (descripcion, es_extra) on public.pro_servicios to authenticated;

-- Agenda: seña y modo de horarios.
alter table public.profesionales add column if not exists sena_pct smallint not null default 0;
alter table public.profesionales add column if not exists alias_pago text;
alter table public.profesionales add column if not exists modo_horario text not null default 'rango';
alter table public.profesionales drop constraint if exists profesionales_sena_ok;
alter table public.profesionales add constraint profesionales_sena_ok check (sena_pct between 0 and 100);
alter table public.profesionales drop constraint if exists profesionales_alias_ok;
alter table public.profesionales add constraint profesionales_alias_ok check (alias_pago is null or char_length(alias_pago) between 3 and 60);
alter table public.profesionales drop constraint if exists profesionales_modo_horario_ok;
alter table public.profesionales add constraint profesionales_modo_horario_ok check (modo_horario in ('rango', 'fijo'));
grant update (sena_pct, alias_pago, modo_horario) on public.profesionales to authenticated;

-- Horarios fijos por día (se usan cuando modo_horario = 'fijo').
alter table public.pro_horarios add column if not exists horas_fijas time[] not null default '{}';
alter table public.pro_horarios drop constraint if exists pro_horarios_fijas_ok;
alter table public.pro_horarios add constraint pro_horarios_fijas_ok check (coalesce(cardinality(horas_fijas), 0) <= 24);
grant update (horas_fijas) on public.pro_horarios to authenticated;

-- Seña guardada en cada turno (monto al momento del pedido).
alter table public.pro_turnos add column if not exists sena integer;

create or replace function private.pro_sena(p_precio integer, p_pct smallint)
returns integer language sql immutable set search_path = '' as $$
  select case when p_precio is null or coalesce(p_pct, 0) <= 0 then null else round(p_precio * p_pct / 100.0)::integer end;
$$;

-- Página pública.
create or replace function public.pro_pagina(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then json_build_object('existe', false, 'disponible', false)
    when p.estado <> 'activa' then json_build_object('existe', true, 'disponible', false, 'nombre', p.nombre)
    else json_build_object(
      'existe', true, 'disponible', true, 'slug', p.slug, 'nombre', p.nombre, 'logo_path', p.logo_path, 'color', p.color,
      'whatsapp', p.whatsapp, 'instagram', p.instagram, 'zona', p.zona,
      'intervalo_min', p.intervalo_min, 'dias_reserva', p.dias_reserva,
      'modo_horario', p.modo_horario, 'sena_pct', p.sena_pct, 'alias_pago', p.alias_pago,
      'horarios', (select coalesce(json_agg(json_build_object('dia', h.dia, 'trabaja', h.trabaja, 'inicio', h.inicio, 'fin', h.fin,
                                                              'horas_fijas', h.horas_fijas) order by h.dia), '[]')
                   from public.pro_horarios h where h.profesional_id = p.id),
      'servicios', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'duracion_min', s.duracion_min,
                                                               'descripcion', s.descripcion, 'fotos', s.fotos) order by s.created_at), '[]')
                    from public.pro_servicios s where s.profesional_id = p.id and s.activo and not s.es_extra),
      'extras', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'descripcion', s.descripcion)
                                          order by s.created_at), '[]')
                 from public.pro_servicios s where s.profesional_id = p.id and s.activo and s.es_extra))
  end
  from (select 1) x left join public.profesionales p on p.slug = lower(btrim(p_slug));
$$;

-- Pedido de la clienta: valida horarios fijos y guarda la seña.
create or replace function public.pro_solicitar_turno(p_slug text, p_servicio_id uuid, p_fecha date, p_hora time, p_nombre text, p_telefono text, p_notas text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy date := v_ahora::date;
  v_pro public.profesionales%rowtype;
  v_hor public.pro_horarios%rowtype;
  v_srv public.pro_servicios%rowtype;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fin time;
  v_sena integer;
  v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel !~ '^[0-9]{8,15}$' or char_length(coalesce(p_telefono,'')) > 25 then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 300 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS: fecha'; end if;

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

  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, sena, fecha, hora_inicio, hora_fin, notas, estado)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, v_sena, p_fecha, p_hora, v_fin, v_notas, 'pendiente')
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'),
    'hora_fin', to_char(v_fin, 'HH24:MI'), 'servicio_nombre', v_srv.nombre, 'precio', v_srv.precio, 'sena', v_sena,
    'alias_pago', v_pro.alias_pago, 'estado', 'pendiente');
end $$;

-- Turno cargado por la dueña: también guarda la seña (sin validar horario, como antes).
create or replace function public.pro_turno_manual(p_servicio_id uuid, p_fecha date, p_hora time, p_nombre text, p_telefono text default null, p_notas text default null, p_estado text default 'aprobado')
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
  select * into v_srv from public.pro_servicios where id = p_servicio_id and profesional_id = v_pro.id and not es_extra;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;
  if extract(epoch from (time '23:59:59' - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  v_fin := p_hora + make_interval(mins => v_srv.duracion_min);
  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, sena, fecha, hora_inicio, hora_fin, notas, estado)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, private.pro_sena(v_srv.precio, v_pro.sena_pct), p_fecha, p_hora, v_fin, v_notas, p_estado)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;
  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'), 'hora_fin', to_char(v_fin, 'HH24:MI'));
end $$;
