-- Agenda Nail PRO: versión para muchas manicuristas en el mismo proyecto.
-- SOLO AGREGA objetos nuevos (prefijo pro_ / profesionales / superadmins). No toca config, horarios,
-- servicios, turnos, admins ni sus funciones (versión de Katia en la raíz del sitio).

-- ---------- Tablas ----------
create table public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profesionales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' and slug !~ '--'),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 60),
  logo_path text,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  instagram text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  zona text check (zona is null or char_length(zona) <= 120),
  intervalo_min smallint not null default 30 check (intervalo_min between 10 and 120),
  dias_reserva smallint not null default 30 check (dias_reserva between 1 and 90),
  estado text not null default 'pendiente' check (estado in ('pendiente','activa','pausada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- El logo sólo puede estar dentro de la carpeta de la propia manicurista en el bucket pro-logos.
  constraint profesionales_logo_propio check (logo_path is null or (logo_path like id::text || '/%' and logo_path !~ '\.\.' and char_length(logo_path) <= 200))
);

create table public.pro_horarios (
  profesional_id uuid not null references public.profesionales(id) on delete cascade,
  dia smallint not null check (dia between 0 and 6), -- 0 = domingo
  trabaja boolean not null default false,
  inicio time not null default '09:00',
  fin time not null default '18:00',
  primary key (profesional_id, dia),
  check (fin > inicio)
);

create table public.pro_servicios (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references public.profesionales(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  precio integer check (precio is null or precio between 0 and 100000000),
  duracion_min smallint not null default 60 check (duracion_min between 10 and 480),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index pro_servicios_prof_idx on public.pro_servicios (profesional_id);

create table public.pro_turnos (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references public.profesionales(id) on delete cascade,
  clienta_nombre text not null check (char_length(clienta_nombre) between 2 and 80),
  clienta_telefono text not null check (clienta_telefono ~ '^[0-9]{8,15}$'),
  servicio_id uuid references public.pro_servicios(id) on delete set null,
  servicio_nombre text not null check (char_length(servicio_nombre) <= 80),
  precio integer check (precio is null or precio >= 0),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  notas text check (notas is null or char_length(notas) <= 300),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado','cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  rango tsrange generated always as (tsrange(fecha + hora_inicio, fecha + hora_fin, '[)')) stored,
  -- Dos turnos activos de la MISMA manicurista nunca se pisan (atómico, en la base).
  constraint pro_turnos_sin_superposicion exclude using gist (profesional_id with =, rango with &&)
    where (estado in ('pendiente','aprobado'))
);
create index pro_turnos_prof_fecha_idx on public.pro_turnos (profesional_id, fecha);
create index pro_turnos_servicio_idx on public.pro_turnos (servicio_id);
create index pro_turnos_tel_idx on public.pro_turnos (profesional_id, clienta_telefono);

-- ---------- Ayudantes (schema private, ya existe) ----------
create or replace function private.pro_es_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.superadmins s where s.user_id = (select auth.uid()));
$$;
create or replace function private.pro_mi_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profesionales p where p.user_id = (select auth.uid());
$$;
revoke all on function private.pro_es_superadmin(), private.pro_mi_id() from public;
grant execute on function private.pro_es_superadmin(), private.pro_mi_id() to authenticated;

create trigger profesionales_updated before update on public.profesionales for each row execute function private.tocar_updated_at();
create trigger pro_turnos_updated before update on public.pro_turnos for each row execute function private.tocar_updated_at();

-- ---------- RLS ----------
alter table public.superadmins enable row level security;
alter table public.profesionales enable row level security;
alter table public.pro_horarios enable row level security;
alter table public.pro_servicios enable row level security;
alter table public.pro_turnos enable row level security;

create policy superadmins_leer_propio on public.superadmins for select to authenticated using (user_id = (select auth.uid()));

create policy profesionales_leer on public.profesionales for select to authenticated
  using (user_id = (select auth.uid()) or (select private.pro_es_superadmin()));
create policy profesionales_editar on public.profesionales for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy pro_horarios_leer on public.pro_horarios for select to authenticated
  using (profesional_id = (select private.pro_mi_id()));
create policy pro_horarios_editar on public.pro_horarios for update to authenticated
  using (profesional_id = (select private.pro_mi_id())) with check (profesional_id = (select private.pro_mi_id()));

create policy pro_servicios_leer on public.pro_servicios for select to authenticated
  using (profesional_id = (select private.pro_mi_id()));
create policy pro_servicios_crear on public.pro_servicios for insert to authenticated
  with check (profesional_id = (select private.pro_mi_id()));
create policy pro_servicios_editar on public.pro_servicios for update to authenticated
  using (profesional_id = (select private.pro_mi_id())) with check (profesional_id = (select private.pro_mi_id()));
create policy pro_servicios_borrar on public.pro_servicios for delete to authenticated
  using (profesional_id = (select private.pro_mi_id()));

create policy pro_turnos_leer on public.pro_turnos for select to authenticated
  using (profesional_id = (select private.pro_mi_id()));
create policy pro_turnos_editar on public.pro_turnos for update to authenticated
  using (profesional_id = (select private.pro_mi_id())) with check (profesional_id = (select private.pro_mi_id()));

-- Permisos de tabla mínimos. anon no tiene NINGÚN acceso directo: usa las RPC públicas.
revoke all on public.superadmins, public.profesionales, public.pro_horarios, public.pro_servicios, public.pro_turnos from anon, authenticated;
grant select on public.superadmins to authenticated;
grant select on public.profesionales to authenticated;
-- slug, estado y user_id sólo cambian por RPC (registro / superadmin).
grant update (nombre, logo_path, color, whatsapp, instagram, zona, intervalo_min, dias_reserva) on public.profesionales to authenticated;
grant select on public.pro_horarios to authenticated;
grant update (trabaja, inicio, fin) on public.pro_horarios to authenticated;
grant select, delete on public.pro_servicios to authenticated;
grant insert (profesional_id, nombre, precio, duracion_min, activo) on public.pro_servicios to authenticated;
grant update (nombre, precio, duracion_min, activo) on public.pro_servicios to authenticated;
grant select on public.pro_turnos to authenticated;
grant update (estado, notas) on public.pro_turnos to authenticated;

-- ---------- Funciones internas ----------
create or replace function private.pro_slug_valido(p_slug text)
returns boolean language sql immutable set search_path = '' as $$
  select p_slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' and p_slug !~ '--'
     and p_slug not in ('admin','panel','pro','api','www','r','app','login','registro','soporte','ayuda','agenda','demo','test','gestion');
$$;

create or replace function private.pro_horarios_iniciales(p_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.pro_horarios (profesional_id, dia, trabaja, inicio, fin)
  select p_id, d, d between 1 and 5, '09:00', case when d = 6 then '13:00'::time else '18:00'::time end
  from generate_series(0, 6) as d
  on conflict do nothing;
$$;
revoke all on function private.pro_slug_valido(text), private.pro_horarios_iniciales(uuid) from public;

-- ---------- RPC públicas (página de reservas) ----------
create or replace function public.pro_slug_disponible(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.pro_slug_valido(lower(btrim(p_slug)))
     and not exists (select 1 from public.profesionales where slug = lower(btrim(p_slug)));
$$;

-- Datos públicos de una agenda. Si no está activa devuelve sólo {disponible:false}.
create or replace function public.pro_pagina(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then json_build_object('existe', false, 'disponible', false)
    when p.estado <> 'activa' then json_build_object('existe', true, 'disponible', false, 'nombre', p.nombre)
    else json_build_object(
      'existe', true, 'disponible', true, 'slug', p.slug, 'nombre', p.nombre, 'logo_path', p.logo_path, 'color', p.color,
      'whatsapp', p.whatsapp, 'instagram', p.instagram, 'zona', p.zona,
      'intervalo_min', p.intervalo_min, 'dias_reserva', p.dias_reserva,
      'horarios', (select coalesce(json_agg(json_build_object('dia', h.dia, 'trabaja', h.trabaja, 'inicio', h.inicio, 'fin', h.fin) order by h.dia), '[]')
                   from public.pro_horarios h where h.profesional_id = p.id),
      'servicios', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'duracion_min', s.duracion_min) order by s.created_at), '[]')
                    from public.pro_servicios s where s.profesional_id = p.id and s.activo))
  end
  from (select 1) x left join public.profesionales p on p.slug = lower(btrim(p_slug));
$$;

-- Sólo rangos ocupados (sin nombres ni teléfonos) de una agenda activa.
create or replace function public.pro_horarios_ocupados(p_slug text, p_desde date, p_hasta date)
returns table (fecha date, hora_inicio time, hora_fin time)
language sql stable security definer set search_path = '' as $$
  select t.fecha, t.hora_inicio, t.hora_fin
  from public.pro_turnos t join public.profesionales p on p.id = t.profesional_id
  where p.slug = lower(btrim(p_slug)) and p.estado = 'activa'
    and t.estado in ('pendiente','aprobado')
    and t.fecha between p_desde and least(p_hasta, p_desde + 92)
  order by t.fecha, t.hora_inicio;
$$;

create or replace function public.pro_solicitar_turno(
  p_slug text, p_servicio_id uuid, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_notas text default null)
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
  v_fin time;
  v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if v_tel !~ '^[0-9]{8,15}$' or char_length(coalesce(p_telefono,'')) > 25 then raise exception 'DATOS_INVALIDOS: telefono'; end if;
  if v_notas is not null and char_length(v_notas) > 300 then raise exception 'DATOS_INVALIDOS: notas'; end if;
  if p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS: fecha'; end if;

  select * into v_pro from public.profesionales where slug = lower(btrim(coalesce(p_slug, '')));
  if not found or v_pro.estado <> 'activa' then raise exception 'AGENDA_NO_DISPONIBLE'; end if;
  select * into v_srv from public.pro_servicios where id = p_servicio_id and profesional_id = v_pro.id and activo;
  if not found then raise exception 'SERVICIO_NO_DISPONIBLE'; end if;

  if p_fecha < v_hoy or p_fecha > v_hoy + v_pro.dias_reserva then raise exception 'FECHA_INVALIDA'; end if;
  if p_fecha + p_hora <= v_ahora then raise exception 'FECHA_INVALIDA'; end if;

  select * into v_hor from public.pro_horarios where profesional_id = v_pro.id and dia = extract(dow from p_fecha)::smallint;
  if not found or not v_hor.trabaja then raise exception 'FUERA_DE_HORARIO'; end if;
  if p_hora < v_hor.inicio or (extract(epoch from (p_hora - v_hor.inicio))::int / 60) % v_pro.intervalo_min <> 0 then
    raise exception 'FUERA_DE_HORARIO';
  end if;
  if extract(epoch from (v_hor.fin - p_hora)) / 60 < v_srv.duracion_min then raise exception 'FUERA_DE_HORARIO'; end if;
  v_fin := p_hora + make_interval(mins => v_srv.duracion_min);

  -- Límites anti abuso (por agenda)
  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.clienta_telefono = v_tel
        and t.estado = 'pendiente' and t.fecha >= v_hoy) >= 3 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;
  if (select count(*) from public.pro_turnos t where t.profesional_id = v_pro.id and t.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;

  begin
    insert into public.pro_turnos (profesional_id, clienta_nombre, clienta_telefono, servicio_id, servicio_nombre, precio, fecha, hora_inicio, hora_fin, notas, estado)
    values (v_pro.id, v_nombre, v_tel, v_srv.id, v_srv.nombre, v_srv.precio, p_fecha, p_hora, v_fin, v_notas, 'pendiente')
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_OCUPADO';
  end;

  return json_build_object('id', v_id, 'fecha', p_fecha, 'hora_inicio', to_char(p_hora, 'HH24:MI'),
    'hora_fin', to_char(v_fin, 'HH24:MI'), 'servicio_nombre', v_srv.nombre, 'precio', v_srv.precio, 'estado', 'pendiente');
end $$;

-- ---------- RPC de la manicurista ----------
-- Registro: crea SU perfil en estado 'pendiente' (la activa el superadmin).
create or replace function public.pro_registrar(p_nombre text, p_slug text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADA'; end if;
  select id into v_id from public.profesionales where user_id = v_uid;
  if found then return json_build_object('id', v_id, 'ya_existia', true); end if;
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 60 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if not private.pro_slug_valido(v_slug) then raise exception 'SLUG_INVALIDO'; end if;
  if (select count(*) from public.profesionales where created_at > now() - interval '1 hour' and estado = 'pendiente') >= 30 then
    raise exception 'DEMASIADOS_PEDIDOS';
  end if;
  begin
    insert into public.profesionales (user_id, slug, nombre, estado) values (v_uid, v_slug, v_nombre, 'pendiente') returning id into v_id;
  exception when unique_violation then
    raise exception 'SLUG_EN_USO';
  end;
  perform private.pro_horarios_iniciales(v_id);
  return json_build_object('id', v_id, 'ya_existia', false);
end $$;

-- ---------- RPC del superadmin (cada una verifica superadmins) ----------
create or replace function public.pro_admin_lista()
returns table (id uuid, slug text, nombre text, estado text, logo_path text, color text, whatsapp text, instagram text,
               zona text, created_at timestamptz, cuenta_email text, servicios bigint, pendientes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  return query
    select p.id, p.slug, p.nombre, p.estado, p.logo_path, p.color, p.whatsapp, p.instagram, p.zona, p.created_at,
           u.email::text,
           (select count(*) from public.pro_servicios s where s.profesional_id = p.id and s.activo),
           (select count(*) from public.pro_turnos t where t.profesional_id = p.id and t.estado = 'pendiente')
    from public.profesionales p left join auth.users u on u.id = p.user_id
    order by p.created_at;
end $$;

create or replace function public.pro_admin_estado(p_id uuid, p_estado text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  if p_estado not in ('pendiente','activa','pausada') then raise exception 'DATOS_INVALIDOS'; end if;
  update public.profesionales set estado = p_estado where id = p_id;
  if not found then raise exception 'NO_ENCONTRADA'; end if;
end $$;

create or replace function public.pro_admin_crear(p_nombre text, p_slug text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) < 2 then raise exception 'DATOS_INVALIDOS: nombre'; end if;
  if not private.pro_slug_valido(v_slug) then raise exception 'SLUG_INVALIDO'; end if;
  begin
    insert into public.profesionales (slug, nombre, estado) values (v_slug, btrim(p_nombre), 'pendiente') returning id into v_id;
  exception when unique_violation then raise exception 'SLUG_EN_USO';
  end;
  perform private.pro_horarios_iniciales(v_id);
  return v_id;
end $$;

-- Vincula la cuenta (ya registrada) de una manicurista con un perfil existente, por correo.
-- Si esa cuenta ya había creado su propio perfil 'pendiente' SIN turnos, ese perfil vacío se borra.
create or replace function public.pro_admin_asignar_cuenta(p_id uuid, p_email text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid; v_otro public.profesionales%rowtype;
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_uid is null then raise exception 'CUENTA_NO_ENCONTRADA'; end if;
  if not exists (select 1 from public.profesionales where id = p_id) then raise exception 'NO_ENCONTRADA'; end if;
  select * into v_otro from public.profesionales where user_id = v_uid and id <> p_id;
  if found then
    if v_otro.estado = 'pendiente' and not exists (select 1 from public.pro_turnos t where t.profesional_id = v_otro.id) then
      delete from public.profesionales where id = v_otro.id;
    else
      raise exception 'CUENTA_CON_OTRA_AGENDA';
    end if;
  end if;
  update public.profesionales set user_id = v_uid where id = p_id;
end $$;

create or replace function public.pro_admin_quitar_cuenta(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  update public.profesionales set user_id = null where id = p_id;
end $$;

-- El superadmin puede cargar el logo de cualquier manicurista (sube el archivo a pro-logos/<id>/...).
create or replace function public.pro_admin_logo(p_id uuid, p_logo_path text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.pro_es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  update public.profesionales set logo_path = nullif(btrim(coalesce(p_logo_path, '')), '') where id = p_id;
  if not found then raise exception 'NO_ENCONTRADA'; end if;
end $$;

revoke all on function public.pro_slug_disponible(text), public.pro_pagina(text),
  public.pro_horarios_ocupados(text, date, date), public.pro_solicitar_turno(text, uuid, date, time, text, text, text),
  public.pro_registrar(text, text), public.pro_admin_lista(), public.pro_admin_estado(uuid, text),
  public.pro_admin_crear(text, text), public.pro_admin_asignar_cuenta(uuid, text), public.pro_admin_quitar_cuenta(uuid),
  public.pro_admin_logo(uuid, text)
  from public, anon, authenticated;
grant execute on function public.pro_slug_disponible(text), public.pro_pagina(text),
  public.pro_horarios_ocupados(text, date, date), public.pro_solicitar_turno(text, uuid, date, time, text, text, text)
  to anon, authenticated;
grant execute on function public.pro_registrar(text, text), public.pro_admin_lista(), public.pro_admin_estado(uuid, text),
  public.pro_admin_crear(text, text), public.pro_admin_asignar_cuenta(uuid, text), public.pro_admin_quitar_cuenta(uuid),
  public.pro_admin_logo(uuid, text)
  to authenticated;

-- ---------- Storage: logos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pro-logos', 'pro-logos', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Cada manicurista escribe sólo en pro-logos/<su id>/...; el superadmin en cualquier carpeta.
create policy pro_logos_leer_propios on storage.objects for select to authenticated
  using (bucket_id = 'pro-logos' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_logos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'pro-logos' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_logos_editar on storage.objects for update to authenticated
  using (bucket_id = 'pro-logos' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())))
  with check (bucket_id = 'pro-logos' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_logos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'pro-logos' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));

-- ---------- Datos iniciales: Katia Ferrero Nails (sin cuenta vinculada todavía) ----------
with k as (
  insert into public.profesionales (slug, nombre, whatsapp, instagram, zona, intervalo_min, estado)
  values ('katia', 'Katia Ferrero Nails', '3534125853', 'kaatii__nails', 'Tío Pujio, Córdoba', 30, 'activa')
  on conflict (slug) do nothing
  returning id
), h as (
  insert into public.pro_horarios (profesional_id, dia, trabaja, inicio, fin)
  select k.id, d, d between 1 and 5, '09:00', '18:00' from k, generate_series(0, 6) d
)
insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, created_at)
select k.id, v.nombre, v.precio, v.duracion, now() + make_interval(secs => v.orden)
from k, (values
  (1, 'Semipermanente', 15000, 60),
  (2, 'Kapping', 18000, 90),
  (3, 'Esculpidas / Soft gel', 25000, 120),
  (4, 'Pies', 14000, 60),
  (5, 'Lifting y tinte de pestañas', 16000, 60)
) as v(orden, nombre, precio, duracion);
