// Service worker de Agenda Nail PRO. Alcance: sólo /agenda-nail/pro/ (está dentro de /pro/).
// Caché propio con prefijo 'agenda-nail-pro-': nunca borra los cachés de la app de la raíz.
const PREFIJO = 'agenda-nail-pro-';
const VERSION = PREFIJO + 'v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith(PREFIJO) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDN y fuentes van directo a la red.
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  // Primero la red (turnos al día); la copia guardada sólo sin conexión.
  ev.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      })
      .catch(() => caches.match(req).then((r) => r || new Response('Sin conexión', { status: 503 })))
  );
});
