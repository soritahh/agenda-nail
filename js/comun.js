// Utilidades compartidas por la página de reservas y el panel.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, ZONA } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** $ 12.500 */
export function pesos(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '-' : ''}$ ${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
/** Precio o "Consultar precio" si la profesional no lo cargó. */
export function precioTexto(n) {
  return n === null || n === undefined || n === '' ? 'Consultar precio' : pesos(n);
}
export function parsePesos(t) {
  const l = String(t ?? '').replace(/[^\d]/g, '');
  return l === '' ? null : parseInt(l, 10);
}
export function pesosInput(n) {
  if (n === null || n === undefined || n === '') return '';
  return Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------- Fechas en hora de Argentina ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function hoyAR() { return fmtFecha.format(new Date()); }
export function minutosAhoraAR() { const [h, m] = fmtHora.format(new Date()).split(':').map(Number); return h * 60 + m; }

export function parseFecha(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); }
export function fechaISO(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function sumarDias(iso, n) { const d = parseFecha(iso); d.setUTCDate(d.getUTCDate() + n); return fechaISO(d); }
export function diaSemana(iso) { return parseFecha(iso).getUTCDay(); }

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function capitalizar(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
export function fechaLarga(iso) { const d = parseFecha(iso); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; }
export function fechaCorta(iso) { const d = parseFecha(iso); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; }
export function fechaRelativa(iso) {
  const hoy = hoyAR();
  if (iso === hoy) return 'hoy';
  if (iso === sumarDias(hoy, 1)) return 'mañana';
  return `el ${fechaLarga(iso)}`;
}

export function aMin(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; }
export function aHora(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
export function hora5(t) { return String(t).slice(0, 5); }
export function duracionTexto(min) {
  min = Number(min) || 0; const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} h ${m} min`; if (h) return `${h} h`; return `${m} min`;
}

/** Horarios de inicio libres para un día. */
export function horariosLibres({ fecha, horario, intervalo, duracion, ocupados }) {
  if (!horario || !horario.trabaja) return [];
  const ini = aMin(horario.inicio), fin = aMin(horario.fin);
  const esHoy = fecha === hoyAR(), ahora = minutosAhoraAR();
  const busy = ocupados.filter((o) => o.fecha === fecha).map((o) => [aMin(o.hora_inicio), aMin(o.hora_fin)]);
  const libres = [];
  for (let t = ini; t + duracion <= fin; t += intervalo) {
    if (esHoy && t <= ahora) continue;
    if (busy.some(([s, e]) => t < e && t + duracion > s)) continue;
    libres.push(aHora(t));
  }
  return libres;
}

// ---------- Teléfonos ----------
/** Deja sólo dígitos y saca el 0 inicial. Devuelve '' si no es válido. */
export function normalizarTelefono(t) {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  return /^[0-9]{8,15}$/.test(d) ? d : '';
}
/** Número para wa.me (Argentina: 549 + código de área + número). */
export function numeroWhatsApp(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) return '549' + d.slice(2);
  if (d.length === 10) return '549' + d;
  return d;
}
export function linkWhatsApp(tel, mensaje) {
  const n = numeroWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}` : '';
}

// ---------- Toast y hojas ----------
let toastTimer;
export function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast visible ${tipo}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 3600);
}

/** Hoja modal de confirmación. Resuelve true/false. */
export function confirmar({ titulo, texto, si = 'Sí', no = 'Volver', peligro = false }) {
  return new Promise((resolve) => {
    const capa = document.createElement('div');
    capa.className = 'sheet-capa';
    capa.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="conf-t">
      <div class="sheet-cabecera"><h2 id="conf-t">${esc(titulo)}</h2></div>
      <p class="confirmar-texto">${esc(texto)}</p>
      <div class="acciones-fila"><button class="btn btn-secundario" data-r="0">${esc(no)}</button>
      <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-r="1">${esc(si)}</button></div></div>`;
    document.body.appendChild(capa);
    requestAnimationFrame(() => capa.classList.add('abierta'));
    const cerrar = (r) => { capa.remove(); resolve(r); };
    capa.addEventListener('click', (e) => {
      if (e.target === capa) return cerrar(false);
      const b = e.target.closest('[data-r]'); if (b) cerrar(b.dataset.r === '1');
    });
    capa.querySelector('[data-r="1"]').focus();
  });
}

/** Hoja modal genérica con contenido HTML. Devuelve { capa, cerrar }. */
export function abrirHoja(titulo, html) {
  const capa = document.createElement('div');
  capa.className = 'sheet-capa';
  capa.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-cabecera"><h2>${esc(titulo)}</h2>
    <button class="btn-icono" data-cerrar aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${html}</div>`;
  document.body.appendChild(capa);
  requestAnimationFrame(() => capa.classList.add('abierta'));
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa || e.target.closest('[data-cerrar]')) cerrar(); });
  return { capa, cerrar };
}

/** Traduce errores de la base a mensajes claros. */
export function mensajeError(err) {
  const m = String(err?.message || err || '');
  if (m.includes('HORARIO_OCUPADO')) return 'Ese horario se acaba de ocupar. Elige otro, por favor.';
  if (m.includes('FUERA_DE_HORARIO')) return 'Ese horario ya no está disponible. Elige otro.';
  if (m.includes('FECHA_INVALIDA')) return 'Esa fecha u hora ya no se puede reservar. Elige otra.';
  if (m.includes('SERVICIO_NO_DISPONIBLE')) return 'Ese servicio ya no está disponible. Recarga la página.';
  if (m.includes('DEMASIADOS_PEDIDOS')) return 'Ya tienes varios pedidos pendientes. Espera la confirmación o escríbeme por WhatsApp.';
  if (m.includes('DATOS_INVALIDOS')) return 'Revisa tu nombre y teléfono.';
  if (m.includes('turnos_sin_superposicion')) return 'Ese horario se pisa con otro turno activo.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No hay conexión. Revisa tu internet e intenta de nuevo.';
  return 'Algo salió mal. Intenta de nuevo en un momento.';
}

export function registrarSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ---------- Íconos ---------- */
const I = {
  esmalte: '<path d="M10 3h4v4h-4z"/><path d="M9 7h6l1.5 3v8.5A2.5 2.5 0 0 1 14 21h-4a2.5 2.5 0 0 1-2.5-2.5V10z"/><path d="M8 13.5h8"/>',
  una: '<path d="M8 21V10a4 4 0 0 1 8 0v11"/><path d="M10 9.5a2 2 0 0 1 4 0v4.5h-4z"/><circle cx="12" cy="17.3" r=".6"/>',
  larga: '<path d="M9.5 21v-9.5C9.5 7 10.5 3 12 3s2.5 4 2.5 8.5V21"/><path d="M11 10.5c0-2 .4-4.2 1-5.2.6 1 1 3.2 1 5.2"/><path d="M8 21h8"/>',
  pie: '<path d="M7 21c-1.5-3-1.5-6 0-9 1-2 1.2-4 1-6.5C8 4 9 3 10.5 3S13 4.5 12.8 7c-.2 2.5.7 4 1.7 6 1.3 2.7.8 6.4-1.6 8z"/><circle cx="16" cy="5" r="1"/><circle cx="18.3" cy="7.4" r=".9"/><circle cx="19.4" cy="10.4" r=".8"/>',
  ojo: '<path d="M3 12c2.5-3.6 5.6-5.4 9-5.4s6.5 1.8 9 5.4c-2.5 3.6-5.6 5.4-9 5.4S5.5 15.6 3 12z"/><circle cx="12" cy="12" r="2.6"/><path d="M5.5 8.5 4 6.5M9 6.9 8.3 4.5M15 6.9l.7-2.4M18.5 8.5 20 6.5"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".7"/>',
  whatsapp: '<path d="M4 20l1.2-3.7A8 8 0 1 1 8 19z"/><path d="M9 8.6c.2 2.8 3.4 6 6.4 6.4l1.1-1.4-2-1-1 .8a5 5 0 0 1-2.6-2.6l.8-1-1-2z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  luna: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  usuario: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  chispa: '<path d="M12 2c.7 5.3 4.7 9.3 10 10-5.3.7-9.3 4.7-10 10-.7-5.3-4.7-9.3-10-10 5.3-.7 9.3-4.7 10-10z"/>',
};
export function icono(nombre, cls = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${I[nombre] || ''}</svg>`;
}
/** Ícono ilustrado según el nombre del servicio. */
export function iconoServicio(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/pesta|lifting|ceja|mirada/.test(n)) return icono('ojo');
  if (/pie|pedic|podo/.test(n)) return icono('pie');
  if (/esculp|soft|gel|acr|extens|kapping|capping/.test(n)) return icono(/kapping|capping/.test(n) ? 'una' : 'larga');
  return icono('esmalte');
}
