-- Agenda Nail: esquema inicial (reservas online con aprobación de la profesional)
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- ---------- Tablas ----------
create table public.config (
  id smallint primary key default 1 check (id = 1),
  nombre_salon text not null default 'Agenda Nail' check (char_length(nombre_salon) between 1 and 60),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  direccion text check (direccion is null or char_length(direccion) <= 120),
  intervalo_min smallint not null default 30 check (intervalo_min between 10 and 120),
  dias_reserva smallint not null default 30 check (dias_reserva between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.config (id) values (1);

create table public.horarios (
  dia smallint primary key check (dia between 0 and 6), -- 0 = domingo
  trabaja boolean not null default false,
  inicio time not null default '09:00',
  fin time not null default '18:00',
  check (fin > inicio)
);
insert into public.horarios (dia, trabaja, inicio, fin) values
  (0, false, '09:00', '18:00'), (1, true, '09:00', '18:00'), (2, true, '09:00', '18:00'),
  (3, true, '09:00', '18:00'), (4, true, '09:00', '18:00'), (5, true, '09:00', '18:00'),
  (6, false, '09:00', '13:00');

create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  precio integer not null default 0 check (precio between 0 and 100000000),
  duracion_min smallint not null default 60 check (duracion_min between 10 and 480),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  clienta_nombre text not null check (char_length(clienta_nombre) between 2 and 80),
  clienta_telefono text not null check (clienta_telefono ~ '^[0-9]{8,15}$'),
  servicio_id uuid references public.servicios(id) on delete set null,
  servicio_nombre text not null check (char_length(servicio_nombre) <= 80),
  precio integer not null check (precio >= 0),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  notas text check (notas is null or char_length(notas) <= 300),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado','cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  rango tsrange generated always as (tsrange(fecha + hora_inicio, fecha + hora_fin, '[)')) stored,
  -- Dos turnos activos (pendiente/aprobado) nunca se pueden pisar: lo garantiza la base de forma atómica.
  constraint turnos_sin_superposicion exclude using gist (rango with &&) where (estado in ('pendiente','aprobado'))
);
create index turnos_fecha_idx on public.turnos (fecha);
create index turnos_servicio_idx on public.turnos (servicio_id);
create index turnos_estado_idx on public.turnos (estado);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Ayudantes ----------
create or replace function private.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function private.es_admin() from public;
grant execute on function private.es_admin() to anon, authenticated;

-- ---------- RLS ----------
alter table public.config enable row level security;
alter table public.horarios enable row level security;
alter table public.servicios enable row level security;
alter table public.turnos enable row level security;
alter table public.admins enable row level security;

create policy config_leer on public.config for select to anon, authenticated using (true);
create policy config_editar on public.config for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));

create policy horarios_leer on public.horarios for select to anon, authenticated using (true);
create policy horarios_editar on public.horarios for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));

create policy servicios_leer on public.servicios for select to anon, authenticated
  using (activo or (select private.es_admin()));
create policy servicios_crear on public.servicios for insert to authenticated with check ((select private.es_admin()));
create policy servicios_editar on public.servicios for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy servicios_borrar on public.servicios for delete to authenticated using ((select private.es_admin()));

create policy turnos_leer on public.turnos for select to authenticated using ((select private.es_admin()));
create policy turnos_editar on public.turnos for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy turnos_borrar on public.turnos for delete to authenticated using ((select private.es_admin()));

create policy admins_leer_propio on public.admins for select to authenticated using (user_id = (select auth.uid()));

-- Permisos de tabla mínimos (además de RLS)
revoke all on public.config, public.horarios, public.servicios, public.turnos, public.admins from anon, authenticated;
grant select on public.config, public.horarios, public.servicios to anon, authenticated;
grant update (nombre_salon, whatsapp, direccion, intervalo_min, dias_reserva, updated_at) on public.config to authenticated;
grant update (trabaja, inicio, fin) on public.horarios to authenticated;
grant insert, update, delete on public.servicios to authenticated;
grant select, delete on public.turnos to authenticated;
grant update (estado, notas, updated_at) on public.turnos to authenticated;
grant select on public.admins to authenticated;

-- ---------- RPC públicas ----------
-- ¿Ya existe la cuenta de la profesional?
create or replace function public.hay_profesional()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins);
$$;

-- La primera cuenta que lo pida se convierte en la profesional; después nadie más.
create or replace function public.reclamar_profesional()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NO_AUTENTICADA'; end if;
  lock table public.admins in exclusive mode;
  if exists (select 1 from public.admins where user_id = v_uid) then return true; end if;
  if exists (select 1 from public.admins) then return false; end if;
  insert into public.admins (user_id) values (v_uid);
  return true;
end $$;

-- Solo rangos ocupados (sin nombres ni teléfonos).
create or replace function public.horarios_ocupados(p_desde date, p_hasta date)
returns table (fecha date, hora_inicio time, hora_fin time)
language sql stable security definer set search_path = '' as $$
  select t.fecha, t.hora_inicio, t.hora_fin
  from public.turnos t
  where t.estado in ('pendiente','aprobado')
    and t.fecha between p_desde and least(p_hasta, p_desde + 92)
  order by t.fecha, t.hora_inicio;
$$;

create or replace function public.solicitar_turno(
  p_servicio_id uuid, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_notas text default null)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy date := v_ahora::date;
  v_cfg public.config%rowtype;
  v_hor public.horarios%rowtype;
  v_srv public.servicios%rowtype;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fin time;
  v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel !~ '^[0-9]{8,15}$' or char_length(coalesce(p_telefono,'')) > 25 then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 300 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS: fecha'; end if;

  select * into v_cfg from public.config where id = 1;
  select * into v_srv from public.servicios where id = p_servicio_id and activo;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;

  if p_fecha < v_hoy or p_fecha > v_hoy + v_cfg.dias_reserva then raise exception 'FECHA_INVALIDA'; end if;
  if p_fecha + p_hora <= v_ahora then raise exception 'FECHA_INVALIDA'; end if;

  select * into v_hor from public.horarios where dia = extract(dow from p_fecha)::smallint;
  if not found or not v_hor.trabaja then raise exception 'FUERA_DE_HORARIO'; end if;
  if p_hora < v_hor.inicio or (extract(epoch from (p_hora - v_hor.inicio))::int / 60) % v_cfg.intervalo_min <> 0 then
    raise exception 'FUERA_DE_HORARIO';
  end if;
  if extract(epoch from (v_hor.fin - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  v_fin := p_hora + make_interval(mins => v_srv.duracion_min);

  -- Límites anti abuso
  if (select count(*) from public.turnos t where t.clienta_telefono = v_tel and t.estado = 'pendiente' and t.fecha >= v_hoy) >= 3 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;
  if (select count(*) from public.turnos t where t.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;

  begin
    insert into public.turnos (clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, fecha, hora_inicio, hora_fin, notas, estado)
    values (v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, p_fecha, p_hora, v_fin, v_notas, 'pendiente')
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'),
    'hora_fin', to_char(v_fin, 'HH24:MI'), 'servicio_nombre', v_srv.nombre, 'precio', v_srv.precio, 'estado', 'pendiente');
end $$;

revoke all on function public.hay_profesional(), public.reclamar_profesional(),
  public.horarios_ocupados(date, date), public.solicitar_turno(uuid, date, time, text, text, text) from public, anon, authenticated;
grant execute on function public.hay_profesional() to anon, authenticated;
grant execute on function public.reclamar_profesional() to authenticated;
grant execute on function public.horarios_ocupados(date, date) to anon, authenticated;
grant execute on function public.solicitar_turno(uuid, date, time, text, text, text) to anon, authenticated;

-- updated_at automático
create or replace function private.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger turnos_updated before update on public.turnos for each row execute function private.tocar_updated_at();
create trigger config_updated before update on public.config for each row execute function private.tocar_updated_at();
