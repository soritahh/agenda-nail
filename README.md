# Katia Ferrero Nails · Agenda de turnos

Agenda de turnos online de **Katia Ferrero Nails** (Tío Pujio, Córdoba · Instagram [@kaatii__nails](https://www.instagram.com/kaatii__nails/)). La clienta pide el turno y Katia lo confirma. Nada más: sin estadísticas ni ganancias.

- **Página de reservas** (`index.html`): la clienta elige servicio, día y horario libre, deja su nombre y WhatsApp y envía el pedido. El pedido queda **pendiente** hasta que la profesional lo confirme.
- **Panel de la profesional** (`panel.html`): la profesional entra con su correo y contraseña y aprueba o rechaza los pedidos, ve su agenda y carga sus servicios y horarios.

Sitio publicado: <https://soritahh.github.io/agenda-nail/>
Panel: <https://soritahh.github.io/agenda-nail/panel.html>

## Primer uso (profesional)

1. Abre `panel.html`. Si todavía no hay una profesional registrada, verás **Crear tu cuenta**.
2. Crea la cuenta con tu correo y una contraseña de 8 caracteres o más. Supabase te envía un correo para confirmarla. Ábrelo y vuelve a entrar.
3. **La primera cuenta que entra queda como dueña del panel.** Las cuentas que se creen después no tienen acceso.
4. En **Horarios**, revisa tu nombre o marca, tu WhatsApp, tu zona (opcional), los días y horarios de atención, cada cuántos minutos empiezan los turnos y con cuánta anticipación se puede reservar.
5. En **Servicios**, toca un servicio para cambiar nombre, precio o duración, o agrega uno nuevo. El precio es opcional: si lo dejas vacío, la clienta ve “Consultar precio”.
6. Comparte el link de reservas con tus clientas. Lo puedes copiar desde el menú ⋮ del panel.

## Qué hace el panel

- **Pedidos**: la lista de pedidos pendientes, con botones *Aprobar* y *Rechazar* (rechazar pide confirmación). El botón *Abrir WhatsApp* abre un chat con la clienta y un mensaje ya escrito. **El mensaje no se envía solo**: tú lo envías desde WhatsApp. El número sobre *Pedidos* en la barra inferior indica cuántos hay pendientes.
- **Agenda**: un calendario mensual con puntos para los turnos aprobados y los pendientes. Al tocar un día ves sus turnos y puedes cancelarlos (con confirmación).
- **Servicios**: agregar, editar o desactivar servicios. Un servicio desactivado no se muestra a las clientas.
- **Horarios**: tus datos (nombre o marca, WhatsApp, zona) y el horario semanal.

Al rechazar o cancelar un turno, ese horario vuelve a quedar libre para reservar.

## Qué hace la página de reservas

Los pasos son: 1) servicio, 2) día, 3) horario (separado en mañana y tarde) y 4) datos. La barra inferior muestra el resumen y el botón *Pedir turno*. Solo aparecen los horarios libres, calculados con la duración del servicio. Al terminar, la clienta ve un resumen del pedido y, si la profesional cargó su WhatsApp, un botón para escribirle.

La clienta **no** ve los nombres ni los teléfonos de otras clientas: la página solo recibe qué rangos de horario están ocupados.

## Cómo funciona por dentro

- Es un sitio estático (HTML, CSS y JavaScript sin compilación), publicado con GitHub Pages.
- Los datos están en **Supabase**, en el proyecto `agenda-nail`. El frontend usa solo la clave pública (*publishable*) en `js/config.js`. Esa clave puede ser pública: la seguridad la dan las reglas RLS de la base.
- El esquema está en `supabase/migrations/0001_esquema_inicial.sql`:
  - tablas `config`, `horarios`, `servicios`, `turnos` y `admins`, todas con RLS;
  - las clientas no pueden leer la tabla `turnos`. Para reservar usan la función `solicitar_turno`, que valida los datos, el horario de atención y la anticipación, limita los pedidos repetidos y siempre crea el turno como *pendiente*;
  - una restricción de exclusión en la base impide que dos turnos pendientes o aprobados se superpongan, incluso si dos clientas reservan al mismo tiempo;
  - `horarios_ocupados` devuelve solo fecha y hora de los rangos ocupados;
  - `reclamar_profesional` registra como dueña a la primera cuenta y rechaza a las demás.
- `supabase/migrations/0002_katia_ferrero_precio_opcional.sql` hace el precio opcional (servicios y turnos), carga los datos de Katia (nombre, WhatsApp 3534125853, Tío Pujio, Córdoba) y sus servicios: Semipermanente, Kapping, Esculpidas / Soft gel, Pies y Lifting y tinte de pestañas. **Los precios cargados ($ 15.000, $ 18.000, $ 25.000, $ 14.000 y $ 16.000) son de prueba para la beta**; Katia los cambia desde el panel.
- La columna interna `config.nombre_salon` guarda el nombre que se muestra ("Katia Ferrero Nails").
- El logo (`icons/logo-kf.svg`) y los íconos de la app son SVG con el texto convertido a trazos, así se ven igual sin fuentes web.
- El service worker (`sw.js`) usa la estrategia "primero la red": siempre carga la versión más nueva y usa la copia guardada solo si no hay conexión.

## Probar en tu computadora

```bash
cd agenda-nail
python3 -m http.server 8080
```

Abre `http://localhost:8080`. La copia local usa la misma base de Supabase que el sitio publicado.

## Configuración pendiente en Supabase (desde el panel web de Supabase)

- **Authentication → URL Configuration**: pon `https://soritahh.github.io/agenda-nail/panel.html` como *Site URL* y agrégala en *Redirect URLs*. Así los enlaces de confirmación y de recuperación de contraseña vuelven al panel.
- **Correo**: el servidor de correo que trae Supabase por defecto tiene un límite muy bajo y puede enviar solo a direcciones del equipo del proyecto. Para que la profesional reciba el correo de confirmación, agrega su correo al equipo de la organización o configura un SMTP propio (*Authentication → SMTP Settings*).

## Versión anterior

La primera versión guardaba los datos solo en el navegador (IndexedDB). El sitio publicado ya no la usa. Hay una copia completa de esa versión en `agenda-nail-v1-respaldo/`, fuera del repositorio.
