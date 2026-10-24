// Service worker: guarda la app para que funcione sin conexión.
const VERSION = 'agenda-nail-v1';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/app.js',
  './js/db.js',
  './js/datos.js',
  './js/estado.js',
  './js/util.js',
  './js/inicio.js',
  './js/agenda.js',
  './js/turnos.js',
  './js/clientas.js',
  './js/servicios.js',
  './js/ajustes.js',
  './icons/icono.svg',
  './icons/icono-192.png',
  './icons/icono-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fuentes de Google: se guardan la primera vez que se descargan (si no hay, se usan las del sistema).
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith(
      caches.open(VERSION).then((c) => c.match(req).then((guardada) => guardada || fetch(req).then((r) => {
        if (r.ok || r.type === 'opaque') c.put(req, r.clone());
        return r;
      }).catch(() => new Response('', { status: 503 }))))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Archivos propios: primero la red (para recibir actualizaciones), si no hay conexión, la copia guardada.
  ev.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok) caches.open(VERSION).then((c) => c.put(req, r.clone()));
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 }))))
  );
});
