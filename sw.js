// Service worker v2 (reservas online). Siempre primero la red: los turnos tienen que estar al día.
// Al activarse borra los cachés viejos (incluida la versión local v1).
const VERSION = 'agenda-nail-v3-kf';

self.addEventListener('install', () => self.skipWaiting());

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
  if (url.origin !== self.location.origin) return; // Supabase, CDN y fuentes van directo a la red.

  ev.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || new Response('Sin conexión', { status: 503 })))
  );
});
