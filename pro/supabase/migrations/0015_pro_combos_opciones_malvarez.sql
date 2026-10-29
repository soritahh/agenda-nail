-- 0015 · Combos con opción "elegí uno" + combos reales de Malvarez Studio (reemplazan a los de ejemplo, sin borrar filas).
alter table public.pro_servicios add column if not exists combo_opciones uuid[] not null default '{}';
alter table public.pro_servicios add column if not exists imagen text;
alter table public.pro_servicios drop constraint if exists pro_servicios_imagen_ok;
alter table public.pro_servicios add constraint pro_servicios_imagen_ok check (imagen is null or imagen ~ '^icons/clientes/[a-z0-9-]+\.(jpg|png|webp)$');
grant insert (combo_opciones), update (combo_opciones) on public.pro_servicios to authenticated;

create or replace function private.pro_combo_antes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_n int; v_suma int; v_no int; v_max int;
begin
  if coalesce(cardinality(new.combo_ids), 0) = 0 then
    if coalesce(cardinality(new.combo_opciones), 0) > 0 then raise exception 'DATOS_INVALIDOS: opciones sin combo'; end if;
    return new;
  end if;
  if new.es_extra then raise exception 'DATOS_INVALIDOS: un combo no puede ser extra'; end if;
  select count(*), coalesce(sum(s.duracion_min), 0) into v_n, v_suma
  from unnest(new.combo_ids) u(id) join public.pro_servicios s on s.id = u.id
  where s.profesional_id = new.profesional_id and not s.es_extra and cardinality(s.combo_ids) = 0 and s.id <> new.id;
  if v_n <> cardinality(new.combo_ids) then raise exception 'DATOS_INVALIDOS: servicios del combo'; end if;
  if cardinality(new.combo_opciones) > 0 then
    if cardinality(new.combo_opciones) < 2 or new.combo_opciones && new.combo_ids then raise exception 'DATOS_INVALIDOS: opciones del combo'; end if;
    select count(*), coalesce(max(s.duracion_min), 0) into v_no, v_max
    from unnest(new.combo_opciones) u(id) join public.pro_servicios s on s.id = u.id
    where s.profesional_id = new.profesional_id and not s.es_extra and cardinality(s.combo_ids) = 0 and s.id <> new.id;
    if v_no <> cardinality(new.combo_opciones) then raise exception 'DATOS_INVALIDOS: opciones del combo'; end if;
    v_suma := v_suma + v_max;
  end if;
  new.duracion_min := v_suma;
  return new;
end $$;

create or replace function private.pro_combo_despues()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.combo_ids) = 0 and new.duracion_min is distinct from old.duracion_min then
    update public.pro_servicios c set duracion_min = c.duracion_min   -- el trigger "antes" recalcula
    where c.profesional_id = new.profesional_id and (c.combo_ids @> array[new.id] or c.combo_opciones @> array[new.id]);
  end if;
  return null;
end $$;
revoke all on function private.pro_combo_antes() from public, anon, authenticated;
revoke all on function private.pro_combo_despues() from public, anon, authenticated;

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
                                                               'combo_ids', s.combo_ids, 'combo_opciones', s.combo_opciones, 'imagen', s.imagen, 'proximamente', s.proximamente, 'precio_desde', s.precio_desde)
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
  v_op public.pro_servicios%rowtype;
  v_elegido boolean := false;
  v_max int;
begin
  select * into v_srv from public.pro_servicios s
   where s.id = p_servicio_id and s.profesional_id = p_pro and s.activo and not s.es_extra and not s.proximamente;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;
  duracion := v_srv.duracion_min; precio := v_srv.precio; nombre := v_srv.nombre; detalle := null;
  select array_agg(distinct s.categoria) into v_cats from public.pro_servicios s
   where s.profesional_id = p_pro and (s.id = v_srv.id or s.id = any (v_srv.combo_ids) or s.id = any (v_srv.combo_opciones));
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then p_extras := '[]'; end if;
  if jsonb_array_length(p_extras) > 6 then raise exception 'DATOS_INVALIDOS: extras'; end if;
  -- Opción "elegí uno" del combo: {"opcion": <id>} reemplaza a la más larga del grupo (que es la usada en duracion_min).
  if cardinality(v_srv.combo_opciones) > 0 then
    select count(*) into v_cant from jsonb_array_elements(p_extras) e where e ? 'opcion';
    if v_cant <> 1 then raise exception 'DATOS_INVALIDOS: elegí una opción del combo'; end if;
    begin
      select s.* into v_op from jsonb_array_elements(p_extras) e join public.pro_servicios s on s.id = (e->>'opcion')::uuid
       where e ? 'opcion' and s.id = any (v_srv.combo_opciones) and s.profesional_id = p_pro;
    exception when others then raise exception 'DATOS_INVALIDOS: opcion'; end;
    if v_op.id is null then raise exception 'DATOS_INVALIDOS: opcion'; end if;
    select max(s.duracion_min) into v_max from public.pro_servicios s where s.id = any (v_srv.combo_opciones);
    duracion := duracion - v_max + v_op.duracion_min;
    nombre := left(nombre || ' (' || v_op.nombre || ')', 80);
  elsif exists (select 1 from jsonb_array_elements(p_extras) e where e ? 'opcion') then
    raise exception 'DATOS_INVALIDOS: opcion';
  end if;
  for v_e in select * from jsonb_array_elements(p_extras) e where not (e ? 'opcion') loop
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

-- Combos reales (se actualizan las 4 filas de ejemplo; ninguna se borra).
do $$
declare v uuid; ps uuid; esc_ uuid; cap uuid; soft uuid; lt uuid; lc uuid; per uuid; lam uuid; ids uuid[];
begin
  select id into v from public.profesionales where slug = 'malvarez';
  if v is null then return; end if;
  select id into ps from public.pro_servicios where profesional_id = v and nombre = 'Esmaltado semipermanente en pies';
  select id into esc_ from public.pro_servicios where profesional_id = v and nombre = 'Esculpidas Poligel en manos liso';
  select id into cap from public.pro_servicios where profesional_id = v and nombre = 'Capping Poligel en manos liso';
  select id into soft from public.pro_servicios where profesional_id = v and nombre = 'Extensión Soft Gel en manos liso';
  select id into lt from public.pro_servicios where profesional_id = v and nombre = 'Lifting tradicional';
  select id into lc from public.pro_servicios where profesional_id = v and nombre = 'Lifting coreano';
  select id into per from public.pro_servicios where profesional_id = v and nombre = 'Perfilado de cejas';
  select id into lam from public.pro_servicios where profesional_id = v and nombre = 'Laminado de cejas';
  select array_agg(id order by orden) into ids from public.pro_servicios where profesional_id = v and categoria = 'combos' and cardinality(combo_ids) > 0;
  if cardinality(ids) <> 4 then raise exception 'se esperaban 4 combos de ejemplo'; end if;
  update public.pro_servicios set nombre = 'Egreso Premium', precio = 55000, orden = 1, combo_ids = array[ps, esc_], combo_opciones = '{}',
    descripcion = 'Pies semipermanente + Esculpidas Poligel en manos.', imagen = 'icons/clientes/malvarez-combo-egreso-premium.jpg' where id = ids[1];
  update public.pro_servicios set nombre = 'Egreso Clasic', precio = 47000, orden = 2, combo_ids = array[ps], combo_opciones = array[cap, soft],
    descripcion = 'Pies semipermanente + Capping Poligel o Extensión Soft Gel en manos (elegís uno).', imagen = 'icons/clientes/malvarez-combo-egreso-clasic.jpg' where id = ids[2];
  update public.pro_servicios set nombre = 'Full Egreso', precio = 70000, orden = 3, combo_ids = array[ps, lt, per], combo_opciones = array[cap, soft],
    descripcion = 'Pies semipermanente + Capping Poligel o Extensión Soft Gel en manos (elegís uno) + Lash Lifting + Perfilado de cejas.', imagen = 'icons/clientes/malvarez-combo-full-egreso.jpg' where id = ids[3];
  update public.pro_servicios set nombre = 'Mirada de Reina', precio = 35000, orden = 4, combo_ids = array[lc, per, lam], combo_opciones = '{}',
    descripcion = 'Lash Lifting coreano + Perfilado de cejas + Laminado de cejas.', imagen = 'icons/clientes/malvarez-combo-mirada-de-reina.jpg' where id = ids[4];
end $$;

-- Horarios reales de Mili: turnos fijos por día (lun–vie), sáb y dom cerrados. Instagram del perfil.
do $$
declare v uuid;
begin
  select id into v from public.profesionales where slug = 'malvarez';
  if v is null then return; end if;
  update public.profesionales set modo_horario = 'fijo', instagram = 'Malvarez.StudioNails' where id = v;
  update public.pro_horarios set trabaja = dia between 1 and 5, inicio = '08:30', fin = '20:00',
    horas_fijas = case dia
      when 1 then array['09:30','13:00','15:00','17:00','19:00']::time[]
      when 2 then array['08:30','10:30','13:00','15:00','17:00','19:00']::time[]
      when 3 then array['09:30','17:30']::time[]
      when 4 then array['08:30','10:30','13:00','15:00','17:00','19:00']::time[]
      when 5 then array['09:30','13:00','15:00','17:00','19:00']::time[]
      else '{}'::time[] end
  where profesional_id = v;
end $$;
