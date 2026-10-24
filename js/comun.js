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
  if (m.includes('DEMASIADOS_PEDIDOS')) return 'Ya tienes varios pedidos pendientes. Espera la confirmación o escribe al salón.';
  if (m.includes('DATOS_INVALIDOS')) return 'Revisa tu nombre y teléfono.';
  if (m.includes('turnos_sin_superposicion')) return 'Ese horario se pisa con otro turno activo.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No hay conexión. Revisa tu internet e intenta de nuevo.';
  return 'Algo salió mal. Intenta de nuevo en un momento.';
}

export function registrarSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
