# Agenda Nail PRO · Agenda de turnos para manicuristas

Versión para varias manicuristas de Agenda Nail. Cada manicurista tiene su propia página de reservas, con su logo, su color, sus servicios y sus horarios. La clienta pide el turno y la dueña de la agenda lo confirma. Sin estadísticas ni ganancias.

Esta versión vive en la carpeta `pro/` del repositorio y **no toca** la agenda original de la raíz (sus archivos, tablas y funciones siguen igual).

- Inicio: <https://soritahh.github.io/agenda-nail/pro/>
- Página de reservas de cada manicurista: `https://soritahh.github.io/agenda-nail/pro/r/?m=<slug>`. Ejemplo: <https://soritahh.github.io/agenda-nail/pro/r/?m=katia>
- Panel de la manicurista: <https://soritahh.github.io/agenda-nail/pro/panel.html>

## Cómo es para la manicurista

1. Entra al panel y se registra con su correo, una contraseña, el nombre de su marca y el link que quiere (por ejemplo `mi-marca`).
2. La cuenta queda **en revisión**: ve "Tu cuenta está en revisión, te avisamos cuando esté activa". Su página de reservas muestra "Agenda no disponible por ahora".
3. Cuando la cuenta está activa, el panel tiene cuatro pestañas:
   - **Agenda**: el día elegido, con flechas para cambiar de día, una tira de días con la cantidad de turnos de cada uno (o "cerrado"), un aviso si hay pedidos por confirmar, dos contadores (turnos del día y por confirmar), la lista de turnos y un botón *Agregar turno este día*.
   - **Próximos**: los turnos de hoy en adelante, con filtros *Activos*, *Por confirmar*, *Confirmados*, *Cancelados* y *Todos*. Cada pedido tiene *Confirmar*, *Rechazar* (con confirmación) y *WhatsApp*, que abre un chat con un mensaje ya escrito. **El mensaje no se envía solo.** Un turno confirmado se puede cancelar (con confirmación).
   - **Nuevo**: para cargar a mano un turno de una clienta que escribió, llamó o vino sin turno. Muestra los horarios libres del día y deja elegir el estado (*Confirmado* o *Por confirmar*). El WhatsApp de la clienta es opcional.
   - **Ajustes**: link para clientas (*Copiar*, *Compartir*, *Ver mi página*), datos (marca, WhatsApp, Instagram, zona), logo (PNG, JPG o WEBP de hasta 2 MB), color de la página, horarios de atención, cada cuánto empieza un turno, cuántos días se puede reservar, servicios y precios, y cerrar sesión.
4. El botón **Link** de la cabecera abre el link de la página de reservas para copiarlo o compartirlo.

El precio de un servicio es opcional. Si queda vacío, la clienta ve "Consultar precio". Los precios se muestran en pesos, por ejemplo `$ 12.500`. La zona horaria es la de Argentina (`America/Argentina/Buenos_Aires`).

## Cómo funciona por dentro

- Sitio estático (HTML, CSS y JavaScript sin compilación) publicado con GitHub Pages. GitHub Pages no reescribe rutas, por eso la manicurista se elige con `?m=<slug>` y las pestañas del panel usan `#/agenda`, `#/proximos`, `#/nuevo` y `#/ajustes`.
- Datos en Supabase, en el mismo proyecto que la agenda original, con tablas nuevas. El frontend usa solo la clave pública (*publishable*) de `js/config.js`. La seguridad la dan las reglas RLS.
- `supabase/migrations/0003_pro_multi_manicuristas.sql`:
  - tablas `superadmins`, `profesionales`, `pro_horarios`, `pro_servicios` y `pro_turnos`, todas con RLS;
  - cada manicurista solo lee y edita sus propios datos. No puede cambiar su propio estado;
  - las clientas no leen `pro_turnos`. Reservan con `pro_solicitar_turno`, que valida todo y crea el turno como pendiente. `pro_horarios_ocupados` devuelve solo los rangos ocupados;
  - una restricción de exclusión impide turnos superpuestos (pendientes o aprobados) de una misma manicurista;
  - bucket público `pro-logos` (solo imágenes, hasta 2 MB). Cada manicurista solo puede escribir en su carpeta `<id de la manicurista>/`;
  - carga a Katia Ferrero Nails (`katia`, activa, sin cuenta asignada).
- `0004_admin_clientas.sql`: tabla `admin_clientas` (ficha comercial de cada clienta), que solo leen y editan los superadmins.
- `0005_pro_turno_manual.sql`: el teléfono del turno pasa a ser opcional y se agrega la función `pro_turno_manual` para la pestaña *Nuevo*. Solo la usa una manicurista activa sobre sus propios servicios y valida la fecha, la hora y que no se superponga con otro turno.

## Superadmin

Un superadmin activa, pausa o reactiva agendas y puede subir el logo de cualquier manicurista. **No se puede crear desde la web.** Se crea solo desde el editor SQL de Supabase, con la cuenta ya registrada:

```sql
insert into public.superadmins (user_id)
select id from auth.users where email = 'correo@ejemplo.com';
```

Para quitarlo: `delete from public.superadmins where user_id = (select id from auth.users where email = 'correo@ejemplo.com');`

## Asignar la agenda de Katia a su cuenta

La agenda `katia` existe y está activa, pero no tiene dueña. Para que Katia la maneje desde el panel:

1. Katia crea su cuenta en el panel (con cualquier link libre, por ejemplo `katia-ferrero`). Queda una cuenta en revisión, vacía.
2. Un superadmin le asigna la agenda `katia` a ese correo desde su página de gestión (opción *Asignar cuenta*). Si la cuenta tenía una agenda en revisión sin turnos, esa agenda vacía se borra.

También se puede hacer desde el editor SQL de Supabase:

```sql
delete from public.profesionales
where user_id = (select id from auth.users where email = 'correo-de-katia@ejemplo.com')
  and slug <> 'katia' and estado = 'pendiente';
update public.profesionales
set user_id = (select id from auth.users where email = 'correo-de-katia@ejemplo.com')
where slug = 'katia';
```

## Probar en tu computadora

Copia la carpeta como `pro/` dentro de una copia del repositorio y sirve la raíz:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080/pro/`. La copia local usa la misma base de Supabase que el sitio publicado.

## Configuración pendiente en Supabase

- **Correo (Authentication → SMTP Settings)**: el servidor de correo por defecto de Supabase tiene un límite muy bajo. Durante las pruebas, el registro devolvió "Demasiados intentos" (error 429). Configura un SMTP propio antes de abrir el registro a muchas manicuristas.
- **Authentication → URL Configuration**: agrega `https://soritahh.github.io/agenda-nail/pro/panel.html` en *Redirect URLs*.
- **Authentication → Attack Protection**: activa la protección contra contraseñas filtradas.
