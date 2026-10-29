-- 0014 (PRO): alta de la agenda Malvarez Studio (slug malvarez, dueña Mili). Activa, sin PIN todavía.
-- Sólo inserta filas nuevas de esta agenda; no toca otras agendas. Idempotente (no hace nada si ya existe).
do $$
declare
  v_id uuid; t0 timestamptz := now();
  m_semi uuid; m_capping uuid; p_semi uuid; c_lam uuid; e_coreano uuid;
  n int := 0;
begin
  if exists (select 1 from public.profesionales where slug = 'malvarez') then return; end if;
  insert into public.profesionales (slug, nombre, estado, zona, whatsapp, instagram, intervalo_min, dias_reserva, modo_horario, sena_pct, tema)
  values ('malvarez', 'Malvarez Studio', 'activa', null, null, null, 30, 30, 'rango', 0, jsonb_build_object(
    'plantilla', 'estudio',
    'logo', 'icons/clientes/malvarez-logo.jpg',
    'titulo', 'MALVAREZ', 'subtitulo', 'STUDIO', 'lema', 'Tu momento, tu belleza.',
    'colores', jsonb_build_object('fondo', '#0e0c09', 'oro', '#c9a45c', 'oro_claro', '#e6cd94', 'marfil', '#faf6ee', 'beige', '#ede4d3', 'texto', '#211b14'),
    'fuente_titulos', 'Cormorant Garamond',
    'categorias', jsonb_build_array(
      jsonb_build_object('id', 'manos', 'nombre', 'Manos', 'sub', 'Uñas cuidadas y diseños únicos', 'icono', 'mano'),
      jsonb_build_object('id', 'pies', 'nombre', 'Pies', 'sub', 'Semipermanente y reconstrucción', 'icono', 'pie'),
      jsonb_build_object('id', 'pestanas', 'nombre', 'Pestañas', 'sub', 'Lifting y extensiones', 'icono', 'ojo'),
      jsonb_build_object('id', 'cejas', 'nombre', 'Cejas', 'sub', 'Perfilado y laminado', 'icono', 'ceja'),
      jsonb_build_object('id', 'combos', 'nombre', 'Combos especiales', 'sub', 'Varios servicios en un solo turno', 'icono', 'regalo')),
    'beneficios', jsonb_build_object('titulo', 'Beneficios exclusivos',
      'texto', 'Combos con varios servicios en un solo turno, atención personalizada y productos de primera calidad.')))
  returning id into v_id;
  perform private.pro_horarios_iniciales(v_id);
  update public.pro_horarios set trabaja = (dia between 1 and 6), inicio = '09:00', fin = case when dia = 6 then '13:00'::time else '20:00'::time end
   where profesional_id = v_id;

  -- Servicios (orden = como se muestran)
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Esmaltado semipermanente en manos liso', 22000, 40, 'manos', 1, t0 + interval '1 s') returning id into m_semi;
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Capping Poligel en manos liso', 28000, 90, 'manos', 2, t0 + interval '2 s') returning id into m_capping;
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Extensión Soft Gel en manos liso', 30000, 90, 'manos', 3, t0 + interval '3 s'),
    (v_id, 'Esculpidas Poligel en manos liso', 36000, 90, 'manos', 4, t0 + interval '4 s');
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Esmaltado semipermanente en pies', 25000, 40, 'pies', 1, t0 + interval '5 s') returning id into p_semi;
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Lifting tradicional', 25000, 90, 'pestanas', 1, t0 + interval '6 s');
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Lifting coreano', 27000, 120, 'pestanas', 2, t0 + interval '7 s') returning id into e_coreano;
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, proximamente, created_at) values
    (v_id, 'Extensiones pelo por pelo', null, 120, 'pestanas', 3, true, t0 + interval '8 s');
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Laminado de cejas', 15000, 30, 'cejas', 1, t0 + interval '9 s') returning id into c_lam;
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, created_at) values
    (v_id, 'Perfilado de cejas', 10000, 45, 'cejas', 2, t0 + interval '10 s');

  -- Extras (se eligen al reservar)
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, es_extra, extra_min, precio_desde, descripcion, created_at) values
    (v_id, 'Diseño a mano alzada', 2000, 20, 'manos', 1, true, 20, true, 'De $2.000 a $3.000 según el diseño. Suma 20 min.', t0 + interval '11 s');
  insert into public.pro_servicios (profesional_id, nombre, precio, duracion_min, categoria, orden, es_extra, extra_min, extra_por_unidad, descripcion, created_at) values
    (v_id, 'Reconstrucción de uñas', 1500, 10, 'pies', 2, true, 0, true, 'Precio por uña.', t0 + interval '12 s');

  -- Combos de EJEMPLO (precio = suma; editables desde el panel)
  insert into public.pro_servicios (profesional_id, nombre, precio, categoria, orden, combo_ids, descripcion, created_at) values
    (v_id, 'Manos + Pies semipermanente', 47000, 'combos', 1, array[m_semi, p_semi], 'Combo de ejemplo (editable).', t0 + interval '13 s'),
    (v_id, 'Manos semipermanente + Laminado de cejas', 37000, 'combos', 2, array[m_semi, c_lam], 'Combo de ejemplo (editable).', t0 + interval '14 s'),
    (v_id, 'Capping Poligel + Pies semipermanente', 53000, 'combos', 3, array[m_capping, p_semi], 'Combo de ejemplo (editable).', t0 + interval '15 s'),
    (v_id, 'Lifting coreano + Laminado de cejas', 42000, 'combos', 4, array[e_coreano, c_lam], 'Combo de ejemplo (editable).', t0 + interval '16 s');
end $$;
