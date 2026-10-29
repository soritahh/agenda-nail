# Agenda Nail PRO · Agenda de turnos para manicuristas

Versión para varias manicuristas de Agenda Nail. Cada manicurista tiene su propia página de reservas, con su logo, su color, sus servicios y sus horarios. La clienta pide el turno y la dueña de la agenda lo confirma. Sin estadísticas ni ganancias.

Esta versión vive en la carpeta `pro/` del repositorio y **no toca** la agenda original de la raíz (sus archivos, tablas y funciones siguen igual).

- Inicio: <https://soritahh.github.io/agenda-nail/pro/>
- Página de reservas de cada manicurista: `https://soritahh.github.io/agenda-nail/pro/r/?m=<slug>`. Ejemplo: <https://soritahh.github.io/agenda-nail/pro/r/?m=katia>
- Panel de la manicurista: <https://soritahh.github.io/agenda-nail/pro/panel.html>

## Cómo es para la manicurista

1. No hay registro público. Un superadmin crea la agenda (link, marca, WhatsApp, Instagram, zona y estado) y le pasa un **código de activación** de 8 caracteres (sirve una sola vez y vence en 7 días).
2. La primera vez, en el panel toca *Activar mi agenda*, escribe el nombre de su agenda (lo que va después de `?m=` en su link, por ejemplo `mi-marca`) y el código, y **elige ella su PIN de 6 números** (dos veces). Después entra siempre con su agenda y su PIN. **No usa correo.** Puede cambiar el PIN en *Ajustes → Cambiar mi PIN* (pide el PIN actual). Si lo olvida, Agustin le genera un código nuevo: el PIN anterior deja de servir y ella elige otro.
3. Con la agenda activa, el panel tiene cuatro pestañas:
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
- `0006_pro_acceso_pin.sql`: entrada con PIN. Quita el registro público (`pro_registrar` ya no se puede llamar desde la web), agrega `pro_admin_crear_agenda` (solo superadmins) y dos funciones internas que solo puede usar la Edge Function.
- `0007_pro_codigo_activacion.sql`: tabla `pro_activaciones` con los códigos de activación (solo se guarda un hash, nadie la puede leer desde la web) y el vencimiento del código en `pro_admin_lista`.
- `supabase/functions/admin-pin`: Edge Function con tres acciones:
  - `codigo`: solo superadmins (si no, 403). Genera el código de activación y, si ya tenía PIN, lo anula y cierra sus sesiones.
  - `activar`: la manicurista, con su agenda + código + el PIN que elige. Crea o reactiva su cuenta con un correo interno que no existe (`<slug>@pin.agenda-nail.invalid`) y el PIN como contraseña. El código se borra al usarse. Nunca se manda un correo.
  - `cambiar`: la manicurista con sesión abierta, con su PIN actual + uno nuevo. Cierra sus otras sesiones.
  Rechaza PIN fáciles (`000000`, `123456`, `121212`…). La clave de servicio solo vive en las variables de la función, no en el repositorio.
- `0005_pro_turno_manual.sql`: el teléfono del turno pasa a ser opcional y se agrega la función `pro_turno_manual` para la pestaña *Nuevo*. Solo la usa una manicurista activa sobre sus propios servicios y valida la fecha, la hora y que no se superponga con otro turno.

## Superadmin

Un superadmin activa, pausa o reactiva agendas y puede subir el logo de cualquier manicurista. **No se puede crear desde la web.** Se crea solo desde el editor SQL de Supabase, con la cuenta ya registrada:

```sql
insert into public.superadmins (user_id)
select id from auth.users where email = 'correo@ejemplo.com';
```

Para quitarlo: `delete from public.superadmins where user_id = (select id from auth.users where email = 'correo@ejemplo.com');`

## Darle acceso a Katia

La agenda `katia` existe y está activa, pero todavía no tiene PIN. Un superadmin le genera un código de activación desde su página de gestión (*Agendas → Código de activación*) y se lo pasa. Katia abre el panel, toca *Activar mi agenda*, escribe `katia`, el código y elige su PIN.

## Contra los intentos al azar

- Supabase Auth limita los intentos de inicio de sesión por IP (*Authentication → Rate Limits*).
- El panel pide una pausa en ese dispositivo después de 5 intentos fallidos (1 minuto, que se duplica hasta 15 minutos). Esta pausa ayuda, pero se puede saltar cambiando de navegador: la protección real es la de Supabase.
- Un PIN de 6 números tiene un millón de combinaciones, y no se aceptan los fáciles de adivinar.
- El código de activación sirve una sola vez, vence en 7 días y se anula después de 5 intentos equivocados. Solo se guarda su hash.

## Demo para mostrar

- Página de reservas: `https://soritahh.github.io/agenda-nail/pro/r/?m=demo`
- Panel de la dueña (sin cuenta): `https://soritahh.github.io/agenda-nail/pro/panel.html?demo=1`

La demo usa la marca de ejemplo "Tu Marca Nails". Todo se guarda en el navegador (`localStorage`) del dispositivo: no toca la base de datos ni se mezcla con agendas reales. Un turno pedido en la demo aparece en el panel demo del mismo dispositivo. El botón *Reiniciar* vuelve a los datos de ejemplo. El código está en `js/demo.js`.

## Probar en tu computadora

Copia la carpeta como `pro/` dentro de una copia del repositorio y sirve la raíz:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080/pro/`. La copia local usa la misma base de Supabase que el sitio publicado.

## Configuración opcional en Supabase

- **Authentication → Rate Limits**: revisa el límite de inicios de sesión por IP si quieres que sea más estricto.
- Las manicuristas ya no usan correo. El SMTP y las *Redirect URLs* solo importan para la agenda original de la raíz.

## Plantilla "estudio" (Malvarez Studio)
- Se activa sólo si `profesionales.tema.plantilla = 'estudio'` (Katia y el resto no tienen tema: sin cambios).
- Reserva: `js/estudio.js` + `css/estudio.css` + `js/tema.js`. Combos con grupo "Elegí uno" (`combo_opciones`, migración 0015).
- Panel: con tema muestra categoría, próximamente, "desde", minutos/precio por unidad de extras, editor de combos y de categorías.
- Imágenes de combos: estáticas en `icons/clientes/` (columna `imagen`).
