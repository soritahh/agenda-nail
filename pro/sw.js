// Service worker de Agenda Nail PRO. Alcance: sólo /agenda-nail/pro/ (está dentro de /pro/).
// Caché propio con prefijo 'agenda-nail-pro-': nunca borra los cachés de la app de la raíz.
const PREFIJO = 'agenda-nail-pro-';
const VERSION = PREFIJO + 'v7';

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

// ---------- Avisos push a la dueña (pedido nuevo) ----------
self.addEventListener('push', (ev) => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = { body: ev.data ? ev.data.text() : '' }; }
  const icono = new URL('icons/icono-pro-192.png', self.registration.scope).href;
  self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'pedido', title: d.title, body: d.body, tag: d.tag })));
  ev.waitUntil(self.registration.showNotification(d.title || 'Nuevo turno 💅', {
    body: d.body || 'Tienes un pedido nuevo para confirmar.',
    icon: d.icon || icono,
    badge: icono,
    tag: d.tag || 'pedido',
    renotify: true,
    data: { url: new URL(d.url || 'panel.html#/proximos/pendientes', self.registration.scope).href },
  }));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const destino = (ev.notification.data && ev.notification.data.url) || new URL('panel.html#/proximos/pendientes', self.registration.scope).href;
  ev.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const panel = ventanas.find((c) => new URL(c.url).pathname.endsWith('/panel.html'));
    if (panel) {
      await panel.focus();
      try { await panel.navigate(destino); } catch { panel.postMessage({ tipo: 'ir', url: destino }); }
      return;
    }
    await self.clients.openWindow(destino);
  })());
});
