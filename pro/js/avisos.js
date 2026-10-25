// Notificaciones push para la dueña (pedido nuevo). Android: Chrome/Edge/Firefox. iPhone/iPad: iOS 16.4 o más y
// SOLO con la agenda instalada en la pantalla de inicio (Safari no ofrece push en una pestaña común).
import { sb, DEMO } from './comun.js?v=p7';
import { VAPID_PUBLICA, FUNCIONES_URL, SUPABASE_KEY } from './config.js?v=p7';

export const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hayAPI = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function claveBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sinRelleno = (s) => String(s || '').replace(/=+$/, '');

async function registro() {
  const reg = await navigator.serviceWorker.getRegistration('./') || await navigator.serviceWorker.register('./sw.js');
  return reg.active ? reg : navigator.serviceWorker.ready;
}

async function guardarSub(proId, sub) {
  const j = sub.toJSON();
  const { error } = await sb.from('pro_push_subs').insert({
    profesional_id: proId, endpoint: sub.endpoint, p256dh: sinRelleno(j.keys.p256dh), auth: sinRelleno(j.keys.auth),
    user_agent: navigator.userAgent.slice(0, 400),
  });
  if (error && error.code !== '23505') throw error; // 23505: este dispositivo ya estaba guardado
}

/**
 * 'demo' | 'ios-instalar' | 'ios-viejo' | 'no-compatible' | 'bloqueadas' | 'activadas' | 'apagadas'
 * Si el navegador tiene la suscripción pero no está en la base (p. ej. se borró), la vuelve a guardar.
 */
export async function estadoAvisos(proId) {
  if (DEMO) return 'demo';
  if (!hayAPI()) return esIOS() ? (instalada() ? 'ios-viejo' : 'ios-instalar') : 'no-compatible';
  if (Notification.permission === 'denied') return 'bloqueadas';
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub || Notification.permission !== 'granted') return 'apagadas';
    const { data } = await sb.from('pro_push_subs').select('id').eq('profesional_id', proId).eq('endpoint', sub.endpoint).maybeSingle();
    if (!data) await guardarSub(proId, sub);
    return 'activadas';
  } catch { return 'apagadas'; }
}

/** Pide permiso, se suscribe y guarda el dispositivo. Llamar directo desde el toque del botón. */
export async function activarAvisos(proId) {
  if (DEMO || !hayAPI()) return estadoAvisos(proId);
  const permiso = await Notification.requestPermission();
  if (permiso === 'denied') return 'bloqueadas';
  if (permiso !== 'granted') return 'apagadas';
  const reg = await registro();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && b64u(sub.options.applicationServerKey) !== VAPID_PUBLICA) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(VAPID_PUBLICA) });
  await guardarSub(proId, sub);
  return 'activadas';
}

/** Deja de avisar en ESTE dispositivo (también al cerrar sesión). */
export async function desactivarAvisos(proId) {
  if (DEMO || !hayAPI()) return;
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  if (proId) await sb.from('pro_push_subs').delete().eq('profesional_id', proId).eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

/** Notificación de prueba a todos los dispositivos de la dueña. */
export async function probarAvisos() {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${FUNCIONES_URL}/notificar-turno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ accion: 'probar' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.mensaje || 'No se pudo enviar la prueba.');
  return j;
}
