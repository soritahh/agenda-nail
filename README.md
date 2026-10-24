# Agenda Nail

App de turnos para manicuras independientes (primera versión esencial). Funciona en el navegador del celular, la tablet o la computadora, y se puede instalar como app (PWA). Los datos se guardan **solo en el dispositivo** (IndexedDB); no hay cuentas, sincronización ni notificaciones todavía.

## Cómo abrirla

La app necesita un servidor web estático (abrir `index.html` con doble clic no alcanza, porque usa módulos JavaScript y service worker).

```bash
cd agenda-nail
python3 -m http.server 8080
```

Luego abre `http://localhost:8080` en el navegador. Para probarla en el celular dentro de la misma red Wi-Fi, usa la IP de la computadora (por ejemplo `http://192.168.0.10:8080`). Ten en cuenta que la instalación como app y el modo sin conexión requieren `https` o `localhost`.

## Qué incluye

- **Bienvenida** (solo la primera vez): pide tu nombre o el de tu salón.
- **Inicio**: saludo, fecha de hoy, cantidad de turnos y lista de turnos del día. Botón grande *Nuevo turno*.
- **Agenda**: calendario mensual con puntitos en los días con turnos, lista del día elegido, navegación por mes y por día. Toca un turno para ver el detalle, cambiar el estado (pendiente, confirmado, completado, cancelado), reprogramar/editar, cancelar o eliminar (con confirmación).
- **Nuevo turno**: busca una clienta o escribe un nombre nuevo (se crea sola), elige el servicio (completa precio y duración, que puedes cambiar), fecha, hora, seña opcional y notas. Calcula el saldo pendiente. No permite turnos superpuestos con otros no cancelados del mismo día. El turno guarda el nombre y el precio del servicio de ese momento.
- **Clientas**: lista con búsqueda por nombre o teléfono, alta y edición, historial de turnos de cada una.
- **Servicios**: alta, edición y borrado (con confirmación). Botón opcional *Cargar servicios sugeridos* (aparecen sin precio para que pongas el tuyo).
- **Ajustes**: nombre de la profesional o del salón.

## Archivos

```
index.html          Estructura y navegación inferior
css/estilos.css     Estilos (mobile-first)
js/app.js           Arranque, bienvenida y ruteo
js/db.js            Envoltorio de IndexedDB
js/datos.js         Reglas: clientas, servicios, turnos, superposición, saldo
js/estado.js        Estado compartido y navegación
js/util.js          Formato de pesos y fechas, hojas modales, avisos, validación
js/inicio.js, agenda.js, turnos.js, clientas.js, servicios.js, ajustes.js   Pantallas
manifest.json, sw.js, icons/   PWA e íconos
capturas/           Capturas de pantalla de la prueba
```

## Cómo probarla rápido

1. Abre la app, escribe tu nombre y toca *Empezar*.
2. Ve a *Servicios*, toca *Cargar servicios sugeridos* y ponle precio a alguno (o agrega uno propio).
3. En *Inicio*, toca *Nuevo turno*, escribe una clienta nueva, elige el servicio y la hora, y guarda.
4. Recarga la página: el turno sigue ahí.
5. Intenta crear otro turno que se pise con el anterior: la app lo bloquea y te dice con quién choca.
6. En *Agenda*, toca el turno y cámbiale el estado.
7. En *Clientas*, abre la clienta y mira su historial.

## Para más adelante (no incluido)

Horarios de trabajo, módulo de ganancias, recordatorios/notificaciones, respaldo o sincronización entre dispositivos.
