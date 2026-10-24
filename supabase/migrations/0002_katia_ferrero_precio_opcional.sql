-- Agenda Nail · Katia Ferrero Nails
-- 1) El precio de un servicio pasa a ser opcional: si está vacío, la página muestra "Consultar precio".
-- 2) Datos iniciales reales: nombre/marca, WhatsApp, zona y los servicios de su bio.
--    Los precios cargados son PRECIOS DE PRUEBA para la beta; la dueña los edita desde el panel.
-- No cambia RLS, permisos, funciones ni la regla de no superposición.

alter table public.servicios alter column precio drop not null;
alter table public.servicios alter column precio drop default;
alter table public.turnos alter column precio drop not null;

alter table public.config alter column nombre_salon set default 'Katia Ferrero Nails';
update public.config
   set nombre_salon = 'Katia Ferrero Nails', whatsapp = '3534125853', direccion = 'Tío Pujio, Córdoba'
 where id = 1;

-- Servicios de su bio (se cargan sólo si todavía no hay servicios). created_at escalonado = orden en pantalla.
insert into public.servicios (nombre, precio, duracion_min, created_at)
select v.nombre, v.precio, v.duracion, now() + make_interval(secs => v.orden)
from (values
  (1, 'Semipermanente', 15000, 60),
  (2, 'Kapping', 18000, 90),
  (3, 'Esculpidas / Soft gel', 25000, 120),
  (4, 'Pies', 14000, 60),
  (5, 'Lifting y tinte de pestañas', 16000, 60)
) as v(orden, nombre, precio, duracion)
where not exists (select 1 from public.servicios);
