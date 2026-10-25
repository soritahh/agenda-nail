-- 0008: hasta 2 fotos por servicio (PRO). Sólo agrega objetos PRO; no toca la app raíz.
-- Las fotos viven en el bucket público 'pro-servicios' bajo <id de la manicurista>/servicios/<archivo>.
-- La columna guarda las rutas (la primera es la principal).

create or replace function private.pro_fotos_validas(p_pro uuid, p_fotos text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_fotos), 0) <= 2
     and not exists (select 1 from unnest(p_fotos) f where f !~ ('^' || p_pro::text || '/servicios/[A-Za-z0-9_-]+\.(jpg|webp)$'));
$$;

alter table public.pro_servicios add column if not exists fotos text[] not null default '{}';
alter table public.pro_servicios drop constraint if exists pro_servicios_fotos_ok;
alter table public.pro_servicios add constraint pro_servicios_fotos_ok check (private.pro_fotos_validas(profesional_id, fotos));

grant update (fotos) on public.pro_servicios to authenticated;

-- Página pública: suma las fotos de cada servicio.
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
      'servicios', (select coalesce(json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'duracion_min', s.duracion_min,
                                                               'fotos', s.fotos) order by s.created_at), '[]')
                    from public.pro_servicios s where s.profesional_id = p.id and s.activo))
  end
  from (select 1) x left join public.profesionales p on p.slug = lower(btrim(p_slug));
$$;

-- ---------- Storage: fotos de servicios ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pro-servicios', 'pro-servicios', true, 409600, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy pro_srvfotos_leer_propios on storage.objects for select to authenticated
  using (bucket_id = 'pro-servicios' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_srvfotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'pro-servicios' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_srvfotos_editar on storage.objects for update to authenticated
  using (bucket_id = 'pro-servicios' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())))
  with check (bucket_id = 'pro-servicios' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
create policy pro_srvfotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'pro-servicios' and ((storage.foldername(name))[1] = (select private.pro_mi_id())::text or (select private.pro_es_superadmin())));
