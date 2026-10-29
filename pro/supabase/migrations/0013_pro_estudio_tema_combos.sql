-- 0013 (PRO): agendas con "plantilla estudio" (opt-in por agenda): tema visual, categorías, extras con tiempo,
-- combos (duración = suma de servicios), "próximamente", disponibilidad sólo con horarios libres y reserva
-- que valida duración/superposición en el servidor. Las agendas sin tema (Katia) siguen igual.

-- ---------- Columnas nuevas ----------
alter table public.profesionales add column if not exists tema jsonb;
alter table public.profesionales drop constraint if exists profesionales_tema_ok;
alter table public.profesionales add constraint profesionales_tema_ok
  check (tema is null or (jsonb_typeof(tema) = 'object' and pg_column_size(tema) <= 16000));
grant update (tema) on public.profesionales to authenticated;

alter table public.pro_servicios add column if not exists categoria text;
alter table public.pro_servicios add column if not exists orden smallint not null default 0;
alter table public.pro_servicios add column if not exists combo_ids uuid[] not null default '{}';
alter table public.pro_servicios add column if not exists proximamente boolean not null default false;
alter table public.pro_servicios add column if not exists extra_min smallint not null default 0;
alter table public.pro_servicios add column if not exists extra_por_unidad boolean not null default false;
alter table public.pro_servicios add column if not exists precio_desde boolean not null default false;
alter table public.pro_servicios drop constraint if exists pro_servicios_estudio_ok;
alter table public.pro_servicios add constraint pro_servicios_estudio_ok check (
  (categoria is null or char_length(categoria) between 1 and 40)
  and extra_min between 0 and 240 and cardinality(combo_ids) <= 6);
grant insert (categoria, orden, combo_ids, proximamente, extra_min, extra_por_unidad, precio_desde) on public.pro_servicios to authenticated;
grant update (categoria, orden, combo_ids, proximamente, extra_min, extra_por_unidad, precio_desde) on public.pro_servicios to authenticated;

-- ---------- Combos: validar componentes y calcular la duración (suma) ----------
create or replace function private.pro_combo_antes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_n int; v_suma int;
begin
  if coalesce(cardinality(new.combo_ids), 0) = 0 then return new; end if;
  if new.es_extra then raise exception 'DATOS_INVALIDOS: un combo no puede ser extra'; end if;
  select count(*), coalesce(sum(s.duracion_min), 0) into v_n, v_suma
  from unnest(new.combo_ids) u(id) join public.pro_servicios s on s.id = u.id
  where s.profesional_id = new.profesional_id and not s.es_extra and cardinality(s.combo_ids) = 0 and s.id <> new.id;
  if v_n <> cardinality(new.combo_ids) then raise exception 'DATOS_INVALIDOS: servicios del combo'; end if;
  new.duracion_min := v_suma;
  return new;
end $$;

create or replace function private.pro_combo_despues()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.combo_ids) = 0 and new.duracion_min is distinct from old.duracion_min then
    update public.pro_servicios c set duracion_min = c.duracion_min   -- el trigger "antes" recalcula la suma
    where c.profesional_id = new.profesional_id and c.combo_ids @> array[new.id];
  end if;
  return null;
end $$;
revoke all on function private.pro_combo_antes() from public, anon, authenticated;
revoke all on function private.pro_combo_despues() from public, anon, authenticated;

drop trigger if exists pro_servicios_combo_antes on public.pro_servicios;
create trigger pro_servicios_combo_antes before insert or update on public.pro_servicios
  for each row execute function private.pro_combo_antes();
drop trigger if exists pro_servicios_combo_despues on public.pro_servicios;
create trigger pro_servicios_combo_despues after update of duracion_min on public.pro_servicios
  for each row execute function private.pro_combo_despues();

-- ---------- Página pública: agrega tema y campos nuevos (claves extra; las agendas sin tema no las usan) ----------
create or replace function public.pro_pagina(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then json_build_object('existe', false, 'disponible', false)
    when p.estado <> 'activa' then json_build_object('existe', true, 'disponible', false, 'nombre', p.nombre)
    else json_build_object(
      'existe', true, 'disponible', true, 'slug', p.slug, 'nombre', p.nombre, 'logo_path', p.logo_path, 'color', p.color,
      'whatsapp', p.whatsapp, 'instagram', p.instagram, 'zona', p.zona,
      'intervalo_min', p.intervalo_min, 'dias_reserva', p.dias_reserva,
      'modo_horario', p.modo_horario, 'sena_pct', p.sena_pct, 'alias_pago', p.alias_pago, 'tema', p.tema,
      'horarios', (select coalesce(json_agg(json_build_object('dia', h.dia, 'trabaja', h.trabaja, 'inicio', h.inicio, 'fin', h.fin,
                                                              'horas_fijas', h.horas_fijas) order by h.dia), '[]')
                   from public.pro_horarios h where h.profesional_id = p.id),
      'servicios', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'duracion_min', s.duracion_min,
                                                               'descripcion', s.descripcion, 'fotos', s.fotos, 'categoria', s.categoria, 'orden', s.orden,
                                                               'combo_ids', s.combo_ids, 'proximamente', s.proximamente, 'precio_desde', s.precio_desde)
                                            order by s.created_at), '[]')
                    from public.pro_servicios s where s.profesional_id = p.id and s.activo and not s.es_extra
                      and (p.tema is not null or not s.proximamente)),
      'extras', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'descripcion', s.descripcion,
                                                            'categoria', s.categoria, 'extra_min', s.extra_min, 'extra_por_unidad', s.extra_por_unidad,
                                                            'precio_desde', s.precio_desde, 'orden', s.orden)
                                          order by s.created_at), '[]')
                 from public.pro_servicios s where s.profesional_id = p.id and s.activo and s.es_extra))
  end
  from (select 1) x left join public.profesionales p on p.slug = lower(btrim(p_slug));
$$;

-- ---------- Cálculo de duración y precio de una reserva (servicio/combo + extras) ----------
create or replace function private.pro_calcular_reserva(p_pro uuid, p_servicio_id uuid, p_extras jsonb)
returns table(duracion int, precio int, nombre text, detalle text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_srv public.pro_servicios%rowtype;
  v_cats text[];
  v_ext public.pro_servicios%rowtype;
  v_e jsonb;
  v_cant int;
  v_ids uuid[] := '{}';
begin
  select * into v_srv from public.pro_servicios s
   where s.id = p_servicio_id and s.profesional_id = p_pro and s.activo and not s.es_extra and not s.proximamente;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;
  duracion := v_srv.duracion_min; precio := v_srv.precio; nombre := v_srv.nombre; detalle := null;
  select array_agg(distinct s.categoria) into v_cats from public.pro_servicios s
   where s.profesional_id = p_pro and (s.id = v_srv.id or s.id = any (v_srv.combo_ids));
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then p_extras := '[]'; end if;
  if jsonb_array_length(p_extras) > 5 then raise exception 'DATOS_INVALIDOS: extras'; end if;
  for v_e in select * from jsonb_array_elements(p_extras) loop
    begin v_cant := coalesce((v_e->>'cantidad')::int, 1); exception when others then raise exception 'DATOS_INVALIDOS: extras'; end;
    select * into v_ext from public.pro_servicios s
     where s.id = (v_e->>'id')::uuid and s.profesional_id = p_pro and s.activo and s.es_extra
       and (s.categoria is null or s.categoria = any (v_cats));
    if not found or (v_ext.id = any (v_ids)) then raise exception 'DATOS_INVALIDOS: extras'; end if;
    v_ids := v_ids || v_ext.id;
    if v_cant < 1 or v_cant > (case when v_ext.extra_por_unidad then 10 else 1 end) then raise exception 'DATOS_INVALIDOS: extras'; end if;
    duracion := duracion + v_ext.extra_min * (case when v_ext.extra_por_unidad then v_cant else 1 end);
    if v_ext.precio is not null then precio := coalesce(precio, 0) + v_ext.precio * v_cant; end if;
    detalle := concat_ws(', ', detalle, v_ext.nombre || case when v_ext.extra_por_unidad then ' x' || v_cant else '' end);
  end loop;
  if detalle is not null then nombre := left(nombre || ' + ' || detalle, 80); end if;
  if duracion > 600 then raise exception 'DATOS_INVALIDOS: duracion'; end if;
  return next;
end $$;
revoke all on function private.pro_calcular_reserva(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------- Disponibilidad pública: SOLO horas de inicio libres (sin nombres ni turnos) ----------
create or replace function public.pro_disponibilidad(p_slug text, p_servicio_id uuid, p_extras jsonb default '[]', p_desde date default null, p_hasta date default null)
returns table(fecha date, hora text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_pro public.profesionales%rowtype;
  v_dur int;
  v_desde date; v_hasta date;
begin
  select * into v_pro from public.profesionales p where p.slug = lower(btrim(coalesce(p_slug, '')));
  if not found or v_pro.estado <> 'activa' then raise exception 'AGENDA_NO_DISPONIBLE'; end if;
  select c.duracion into v_dur from private.pro_calcular_reserva(v_pro.id, p_servicio_id, p_extras) c;
  v_desde := greatest(coalesce(p_desde, v_ahora::date), v_ahora::date);
  v_hasta := least(coalesce(p_hasta, v_ahora::date + v_pro.dias_reserva), v_ahora::date + v_pro.dias_reserva, v_desde + 62);
  return query
  with dias as (
    select d::date as f from generate_series(v_desde, v_hasta, interval '1 day') d
  ), cand as (
    select dd.f, x.t
    from dias dd join public.pro_horarios h on h.profesional_id = v_pro.id and h.dia = extract(dow from dd.f)::smallint and h.trabaja
    cross join lateral (
      select g::time as t from generate_series(dd.f + h.inicio, dd.f + h.fin - make_interval(mins => v_dur), make_interval(mins => v_pro.intervalo_min)) g
      where v_pro.modo_horario = 'rango'
      union
      select hf from unnest(h.horas_fijas) hf
      where v_pro.modo_horario = 'fijo' and extract(epoch from (time '23:59:59' - hf)) / 60 >= v_dur
    ) x
  )
  select c.f, to_char(c.t, 'HH24:MI')
  from cand c
  where c.f + c.t > v_ahora
    and not exists (select 1 from public.pro_turnos t where t.profesional_id = v_pro.id and t.estado in ('pendiente','aprobado')
                    and t.fecha = c.f and t.hora_inicio < c.t + make_interval(mins => v_dur) and t.hora_fin > c.t)
  order by 1, 2;
end $$;
revoke all on function public.pro_disponibilidad(text, uuid, jsonb, date, date) from public;
grant execute on function public.pro_disponibilidad(text, uuid, jsonb, date, date) to anon, authenticated;

-- ---------- Reserva de la clienta (plantilla estudio): duración completa validada en el servidor ----------
create or replace function public.pro_reservar(p_slug text, p_servicio_id uuid, p_extras jsonb, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_notas text default null, p_fotos integer default 0)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy date := v_ahora::date;
  v_pro public.profesionales%rowtype;
  v_hor public.pro_horarios%rowtype;
  v_calc record;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fotos integer := coalesce(p_fotos, 0);
  v_token text; v_fin time; v_sena integer; v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel !~ '^[0-9]{8,15}$' or char_length(coalesce(p_telefono,'')) > 25 then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 240 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS: fecha'; end if;
  if v_fotos < 0 or v_fotos > 3 then raise exception 'DATOS_INVALIDOS: fotos'; end if;

  select * into v_pro from public.profesionales where slug = lower(btrim(coalesce(p_slug, '')));
  if not found or v_pro.estado <> 'activa' then raise exception 'AGENDA_NO_DISPONIBLE'; end if;
  select * into v_calc from private.pro_calcular_reserva(v_pro.id, p_servicio_id, p_extras);

  if p_fecha < v_hoy or p_fecha > v_hoy + v_pro.dias_reserva then raise exception 'FECHA_INVALIDA'; end if;
  if p_fecha + p_hora <= v_ahora then raise exception 'FECHA_INVALIDA'; end if;

  select * into v_hor from public.pro_horarios where profesional_id = v_pro.id and dia = extract(dow from p_fecha)::smallint;
  if not found or not v_hor.trabaja then raise exception 'FUERA_DE_HORARIO'; end if;
  if v_pro.modo_horario = 'fijo' then
    if not (p_hora = any (v_hor.horas_fijas)) then raise exception 'FUERA_DE_HORARIO'; end if;
    if extract(epoch from (time '23:59:59' - p_hora)) / 60 < v_calc.duracion then raise exception 'FUERA_DE_HORARIO'; end if;
  else
    if p_hora < v_hor.inicio or (extract(epoch from (p_hora - v_hor.inicio))::int / 60) % v_pro.intervalo_min <> 0 then raise exception 'FUERA_DE_HORARIO'; end if;
    if extract(epoch from (v_hor.fin - p_hora)) / 60 < v_calc.duracion then raise exception 'FUERA_DE_HORARIO'; end if;
  end if;
  v_fin := p_hora + make_interval(mins => v_calc.duracion);
  if exists (select 1 from public.pro_turnos t where t.profesional_id = v_pro.id and t.estado in ('pendiente','aprobado')
             and t.fecha = p_fecha and t.hora_inicio < v_fin and t.hora_fin > p_hora) then
    raise exception 'HORARIO_OCUPADO';
  end if;
  v_sena := private.pro_sena(v_calc.precio, v_pro.sena_pct);

  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.clienta_telefono = v_tel
        and t.estado = 'pendiente' and t.fecha >= v_hoy) >= 3 then raise exception 'DEMASIADOS_PEDIDOS'; end if;
  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'DEMASIADOS_PEDIDOS'; end if;

  if v_calc.detalle is not null then v_notas := left(concat_ws(' · ', 'Extras: ' || v_calc.detalle, v_notas), 300); end if;
  if v_fotos > 0 then v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); end if;
  perform set_config('agenda_nail.origen', 'reserva_online', true);
  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, sena, fecha,
      hora_inicio, hora_fin, notas, estado, ref_fotos_esperadas, ref_token_hash)
    values (v_pro.id, v_nombre, v_tel, p_servicio_id, v_calc.nombre, v_calc.precio, v_sena, p_fecha, p_hora, v_fin, v_notas, 'pendiente',
      v_fotos, case when v_token is null then null else encode(sha256(convert_to(v_token, 'UTF8')), 'hex') end)
    returning id into v_id;
  exception when exclusion_violation then raise exception 'HORARIO_OCUPADO';
  end;
  perform set_config('agenda_nail.origen', '', true);

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'), 'hora_fin', to_char(v_fin, 'HH24:MI'),
    'duracion_min', v_calc.duracion, 'servicio_nombre', v_calc.nombre, 'precio', v_calc.precio, 'sena', v_sena,
    'alias_pago', v_pro.alias_pago, 'estado', 'pendiente', 'ref_token', v_token);
end $$;
revoke all on function public.pro_reservar(text, uuid, jsonb, date, time, text, text, text, integer) from public;
grant execute on function public.pro_reservar(text, uuid, jsonb, date, time, text, text, text, integer) to anon, authenticated;

-- ---------- Reserva clásica (Katia): igual que antes, sólo rechaza servicios "próximamente" ----------
CREATE OR REPLACE FUNCTION public.pro_solicitar_turno(p_slug text, p_servicio_id uuid, p_fecha date, p_hora time without time zone, p_nombre text, p_telefono text, p_notas text DEFAULT NULL::text, p_fotos integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select * into v_srv from public.pro_servicios where id = p_servicio_id and profesional_id = v_pro.id and activo and not es_extra and not proximamente;
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
end $function$
;
