// Panel de cada manicurista (versión PRO): acceso con PIN, agenda del día, próximos, turno manual y ajustes.
import { aplicarTema } from './tema.js?v=p8';
import {
  sb, $, $$, esc, pesos, precioTexto, icono, iconoServicio, parsePesos, pesosInput, hoyAR, sumarDias, parseFecha, fechaISO, diaSemana, DIAS, MESES,
  fechaLarga, fechaCorta, fechaRelativa, capitalizar, duracionTexto, hora5, linkWhatsApp, toast, confirmar, abrirHoja,
  mensajeError, registrarSW, logoHTML, aplicarColor, COLOR_BASE, horariosLibres, normalizarTelefono,
  DEMO, bannerDemo, reiniciarDemo, senaDe, urlFoto, abrirFotos, comprimirFoto, fotoRefDemo,
} from './comun.js?v=p7';
import { BUCKET_LOGOS, BUCKET_SERVICIOS, BUCKET_REFERENCIAS } from './config.js?v=p7';
import { estadoAvisos, activarAvisos, desactivarAvisos, probarAvisos, esIOS } from './avisos.js?v=p7';

const acceso = $('#acceso'), app = $('#app'), main = $('#contenido');
const P = { pro: null, user: null, mesAgenda: hoyAR().slice(0, 7), diaAgenda: hoyAR() };
const ESTADOS = { pendiente: 'Por confirmar', aprobado: 'Confirmado', rechazado: 'Rechazado', cancelado: 'Cancelado' };

// ---------------- Acceso (nombre de la agenda + PIN de 6 dígitos) ----------------
// Cada agenda tiene un usuario de Supabase Auth con correo sintético <slug>@pin.agenda-nail.invalid y el PIN como
// contraseña. La primera vez ella activa su agenda con el código de un solo uso que le da Agustin y elige su PIN
// (Edge Function 'admin-pin'); después lo puede cambiar en Ajustes. Nunca se envían correos.
const DOMINIO_PIN = 'pin.agenda-nail.invalid';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const CLAVE_ULTIMA = 'agenda-nail-pro-ultima-agenda';
const CLAVE_INTENTOS = 'agenda-nail-pro-intentos';
const MAX_INTENTOS = 5;
const linkPublico = (slug) => new URL(`r/?m=${encodeURIComponent(slug)}`, location.href.split('#')[0]).href;

/** Acepta "sofi-nails", "@Sofi-Nails " o el link completo de reservas (…/r/?m=sofi-nails). */
function leerSlug(t) {
  let v = String(t || '').trim();
  const m = v.match(/[?&]m=([^&#\s]+)/);
  if (m) v = decodeURIComponent(m[1]);
  return v.replace(/^@/, '').toLowerCase();
}

// Freno local tras varios PIN incorrectos (el límite real lo pone Supabase Auth por IP).
function leerIntentos() {
  try { return JSON.parse(localStorage.getItem(CLAVE_INTENTOS)) || { n: 0, hasta: 0 }; } catch { return { n: 0, hasta: 0 }; }
}
function anotarFallo() {
  const i = leerIntentos(); i.n += 1;
  if (i.n >= MAX_INTENTOS) i.hasta = Date.now() + Math.min(60_000 * 2 ** (i.n - MAX_INTENTOS), 15 * 60_000);
  try { localStorage.setItem(CLAVE_INTENTOS, JSON.stringify(i)); } catch { /* sin almacenamiento */ }
  return i;
}
/** Mismo criterio que la Edge Function 'admin-pin' (que es la que manda). null = PIN válido. */
function problemaPin(pin) {
  if (!/^\d{6}$/.test(pin)) return 'El PIN tiene que tener exactamente 6 números.';
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return 'Ese PIN es muy fácil de adivinar (todos los números iguales).';
  const paso = d[1] - d[0];
  if (Math.abs(paso) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === paso)) return 'Ese PIN es muy fácil de adivinar (números seguidos).';
  if (pin.slice(0, 3) === pin.slice(3) || pin.slice(0, 2).repeat(3) === pin) return 'Ese PIN es muy fácil de adivinar (se repite).';
  if (['112233', '123321', '102030', '159753', '147258', '258369', '789456', '456123', '131313', '010101'].includes(pin)) return 'Ese PIN es muy fácil de adivinar. Elige otro.';
  return null;
}
/** Solo números, máximo 6, en cada campo de PIN. */
function soloDigitos(...inputs) {
  inputs.forEach((i) => i.addEventListener('input', () => { const v = i.value.replace(/\D/g, '').slice(0, 6); if (v !== i.value) i.value = v; }));
}
const campoPin = (id, label, auto = 'new-password') => `<div class="campo"><label for="${id}">${label}</label>
  <input id="${id}" class="input-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="${auto}" placeholder="••••••"></div>`;
/** Lee el JSON de error de la Edge Function. */
async function mensajeFuncion(error, porDefecto) {
  try { const j = await error?.context?.json(); if (j?.mensaje) return j.mensaje; } catch { /* sin JSON */ }
  return porDefecto;
}

function limpiarIntentos() { try { localStorage.removeItem(CLAVE_INTENTOS); } catch { /* nada */ } }

function pantallaAcceso(html, { titulo = '¡Hola!', sub = 'Tu agenda de turnos online', pie = true } = {}) {
  app.hidden = true; acceso.hidden = false; aplicarColor(null);
  acceso.innerHTML = `<div class="splash-contenido">
    <img src="icons/icono-pro.svg" alt="" class="logo" width="112" height="112">
    <h1 class="splash-titulo">${esc(titulo)}</h1>
    <p class="splash-sub">${esc(sub)}</p>
    <div class="splash-form"><span class="splash-icono" aria-hidden="true">${icono('usuario')}</span>${html}</div>
    ${pie ? '<p class="splash-pie"><a href="./">¿Qué es Agenda Nail?</a></p>' : ''}</div>`;
}

function formPin() {
  let ultima = ''; try { ultima = localStorage.getItem(CLAVE_ULTIMA) || ''; } catch { /* nada */ }
  pantallaAcceso(`
    <h2 class="acceso-titulo">Entrar a tu agenda</h2>
    <p class="acceso-sub">Con el nombre de tu agenda y tu PIN de 6 números.</p>
    <form id="f-pin" novalidate>
      <div class="campo"><label for="a-slug">Tu agenda</label>
        <input id="a-slug" maxlength="300" required autocapitalize="none" autocomplete="username" spellcheck="false" value="${esc(ultima)}" placeholder="ej.: sofi-nails">
        <p class="ayuda">Es lo que va después de <b>?m=</b> en tu link de reservas.</p></div>
      <div class="campo"><label for="a-pin">PIN</label>
        <input id="a-pin" class="input-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="current-password" placeholder="••••••"></div>
      <p id="a-error" class="form-error-general" role="alert" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit" id="a-entrar">Entrar</button>
    </form>
    <div class="separador" aria-hidden="true">✦</div>
    <button type="button" class="btn btn-secundario btn-grande acceso-alterno" id="a-activar">Activar mi agenda (primera vez)</button>
    <p class="texto-suave acceso-olvide">¿Olvidaste tu PIN? Pídele a Agustin un código nuevo y vuelve a activarla.</p>`,
  { titulo: '¡Hola de nuevo!' });
  const fSlug = $('#a-slug'), fPin = $('#a-pin'), bEntrar = $('#a-entrar'), e = $('#a-error');
  const err = (m) => { e.textContent = m; e.hidden = !m; };
  $('#a-activar').onclick = () => formActivar(leerSlug(fSlug.value));
  (ultima ? fPin : fSlug).focus();
  let reloj = 0;
  const frenar = () => {
    clearInterval(reloj);
    const tick = () => {
      const falta = Math.ceil((leerIntentos().hasta - Date.now()) / 1000);
      if (falta <= 0) { clearInterval(reloj); bEntrar.disabled = false; bEntrar.textContent = 'Entrar'; return; }
      bEntrar.disabled = true;
      bEntrar.textContent = `Espera ${falta >= 60 ? `${Math.floor(falta / 60)}:${String(falta % 60).padStart(2, '0')}` : `${falta} s`}`;
    };
    tick(); reloj = setInterval(tick, 1000);
  };
  if (leerIntentos().hasta > Date.now()) { err('Hubo varios PIN incorrectos. Espera un momento antes de probar de nuevo.'); frenar(); }
  fPin.addEventListener('input', () => {
    const v = fPin.value.replace(/\D/g, '').slice(0, 6);
    if (v !== fPin.value) fPin.value = v;
    if (v.length === 6 && fSlug.value.trim() && !bEntrar.disabled) $('#f-pin').requestSubmit();
  });
  $('#f-pin').addEventListener('submit', async (ev) => {
    ev.preventDefault(); err('');
    if (leerIntentos().hasta > Date.now()) return frenar();
    const slug = leerSlug(fSlug.value), pin = fPin.value;
    if (!SLUG_RE.test(slug) || slug.includes('--')) return err('Escribe el nombre de tu agenda (minúsculas, números y guiones, como en tu link).');
    if (!/^\d{6}$/.test(pin)) return err('El PIN tiene 6 números.');
    bEntrar.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: `${slug}@${DOMINIO_PIN}`, password: pin });
      if (error) throw error;
      limpiarIntentos();
      try { localStorage.setItem(CLAVE_ULTIMA, slug); } catch { /* nada */ }
      await entrar();
    } catch (x) {
      const m = String(x?.message || ''), st = x?.status;
      fPin.value = '';
      if (/Invalid login credentials/i.test(m) || st === 400) {
        const i = anotarFallo();
        if (i.hasta > Date.now()) { err('Agenda o PIN incorrectos. Por seguridad, espera un momento antes de probar de nuevo.'); return frenar(); }
        const quedan = MAX_INTENTOS - i.n;
        err(`Agenda o PIN incorrectos.${quedan <= 2 ? (quedan === 1 ? ' Te queda 1 intento antes de una pausa.' : ` Te quedan ${quedan} intentos antes de una pausa.`) : ' Revisa e intenta de nuevo.'}`);
        fPin.focus();
      } else if (/rate limit|too many/i.test(m) || st === 429) err('Demasiados intentos. Espera unos minutos e intenta de nuevo.');
      else err(mensajeError(x));
    } finally { if (!(leerIntentos().hasta > Date.now())) bEntrar.disabled = false; }
  });
}

/** Primera vez (o después de que Agustin le dio un código nuevo): agenda + código + PIN elegido por ella. */
function formActivar(slugInicial = '') {
  pantallaAcceso(`
    <h2 class="acceso-titulo">Activar mi agenda</h2>
    <p class="acceso-sub">Escribe el código que te pasó Agustin y elige tu PIN de 6 números.</p>
    <form id="f-activar" novalidate>
      <div class="campo"><label for="v-slug">Tu agenda</label>
        <input id="v-slug" maxlength="300" required autocapitalize="none" autocomplete="username" spellcheck="false" value="${esc(slugInicial)}" placeholder="ej.: sofi-nails"></div>
      <div class="campo"><label for="v-codigo">Código de activación</label>
        <input id="v-codigo" class="input-codigo" maxlength="12" required autocapitalize="characters" autocomplete="one-time-code" spellcheck="false" placeholder="XXXX-XXXX"></div>
      ${campoPin('v-pin1', 'Elige tu PIN (6 números)')}
      ${campoPin('v-pin2', 'Repite tu PIN')}
      <p class="ayuda">No uses fechas ni números fáciles como 123456. Con tu agenda y este PIN vas a entrar siempre.</p>
      <p id="v-error" class="form-error-general" role="alert" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit" id="v-enviar">Activar y entrar</button>
    </form>
    <div class="separador" aria-hidden="true">✦</div>
    <button type="button" class="btn-chico" id="v-volver">Ya tengo PIN: entrar</button>`,
  { titulo: '¡Bienvenida!' });
  const e = $('#v-error'), err = (m) => { e.textContent = m; e.hidden = !m; };
  const fSlug = $('#v-slug'), fCod = $('#v-codigo'), p1 = $('#v-pin1'), p2 = $('#v-pin2'), b = $('#v-enviar');
  soloDigitos(p1, p2);
  [fSlug, fCod, p1, p2].forEach((i) => i.addEventListener('input', () => err('')));
  fCod.addEventListener('input', () => {
    const v = fCod.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const f = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
    if (f !== fCod.value) fCod.value = f;
  });
  $('#v-volver').onclick = formPin;
  (slugInicial ? fCod : fSlug).focus();
  $('#f-activar').addEventListener('submit', async (ev) => {
    ev.preventDefault(); err('');
    const slug = leerSlug(fSlug.value), codigo = fCod.value.replace(/[^A-Z0-9]/gi, '').toUpperCase(), pin = p1.value;
    if (!SLUG_RE.test(slug) || slug.includes('--')) return err('Escribe el nombre de tu agenda (minúsculas, números y guiones, como en tu link).');
    if (codigo.length !== 8) return err('El código tiene 8 letras y números (por ejemplo ABCD-2345).');
    const motivo = problemaPin(pin);
    if (motivo) return err(motivo);
    if (pin !== p2.value) return err('Los dos PIN no coinciden.');
    b.disabled = true; b.textContent = 'Activando…';
    try {
      const { data, error } = await sb.functions.invoke('admin-pin', { body: { accion: 'activar', slug, codigo, pin } });
      if (error || !data?.ok) return err(await mensajeFuncion(error, 'No se pudo activar. Intenta de nuevo.'));
      const { error: e2 } = await sb.auth.signInWithPassword({ email: `${slug}@${DOMINIO_PIN}`, password: pin });
      if (e2) { toast('Tu PIN quedó guardado. Entra con tu agenda y tu PIN.'); return formPin(); }
      limpiarIntentos();
      try { localStorage.setItem(CLAVE_ULTIMA, slug); } catch { /* nada */ }
      history.replaceState(null, '', location.pathname);
      toast('¡Listo! Tu PIN quedó guardado.');
      await entrar();
    } catch (x) { err(mensajeError(x)); } finally { b.disabled = false; b.textContent = 'Activar y entrar'; }
  });
}

/** Ajustes → Cambiar PIN: PIN actual + nuevo (dos veces). */
function cambiarPin() {
  const { capa, cerrar } = abrirHoja('Cambiar mi PIN', `<form id="f-cpin" novalidate>
    ${campoPin('c-actual', 'PIN actual', 'current-password')}
    ${campoPin('c-pin1', 'PIN nuevo (6 números)')}
    ${campoPin('c-pin2', 'Repite el PIN nuevo')}
    <p class="texto-suave">Se cierra la sesión en tus otros teléfonos.</p>
    <p id="c-error" class="form-error-general" role="alert" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit" id="c-guardar">Cambiar PIN</button></form>`);
  const e = $('#c-error', capa), err = (m) => { e.textContent = m; e.hidden = !m; };
  const actual = $('#c-actual', capa), p1 = $('#c-pin1', capa), p2 = $('#c-pin2', capa), b = $('#c-guardar', capa);
  soloDigitos(actual, p1, p2);
  [actual, p1, p2].forEach((i) => i.addEventListener('input', () => err('')));
  actual.focus();
  $('#f-cpin', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault(); err('');
    if (!/^\d{6}$/.test(actual.value)) return err('Escribe tu PIN actual (6 números).');
    const motivo = problemaPin(p1.value);
    if (motivo) return err(motivo);
    if (p1.value !== p2.value) return err('Los dos PIN nuevos no coinciden.');
    if (p1.value === actual.value) return err('El PIN nuevo tiene que ser distinto del actual.');
    b.disabled = true;
    try {
      const { data, error } = await sb.functions.invoke('admin-pin', { body: { accion: 'cambiar', pin_actual: actual.value, pin: p1.value } });
      if (error || !data?.ok) return err(await mensajeFuncion(error, 'No se pudo cambiar el PIN. Intenta de nuevo.'));
      // El cambio cierra todas las sesiones: volvemos a entrar con el PIN nuevo.
      const { error: e2 } = await sb.auth.signInWithPassword({ email: `${P.pro.slug}@${DOMINIO_PIN}`, password: p1.value });
      cerrar();
      if (e2) { toast('PIN cambiado. Entra de nuevo con tu PIN nuevo.'); return salir(); }
      toast('PIN cambiado.');
    } catch (x) { err(mensajeError(x)); } finally { b.disabled = false; }
  });
}

function pantallaSinAgenda() {
  pantallaAcceso(`<h2 class="acceso-titulo">Este acceso no tiene agenda</h2>
    <p>Pídele a Agustin un código de activación para tu agenda.</p>
    <button class="btn btn-primario btn-grande" id="a-salir">Volver</button>`, { pie: false });
  $('#a-salir').onclick = salir;
}

function pantallaEstado(estado) {
  const pendiente = estado === 'pendiente';
  pantallaAcceso(`<h2 class="acceso-titulo">${pendiente ? 'Tu agenda todavía no está activa' : 'Tu agenda está pausada'}</h2>
    <p>${pendiente ? 'Agustin la está terminando de preparar. Prueba de nuevo en un rato.' : 'Por ahora tu agenda no recibe reservas. Escríbele a Agustin para reactivarla.'}</p>
    <p class="texto-suave">Agenda: ${esc(P.pro?.slug || '')}</p>
    <button class="btn btn-primario btn-grande" id="a-recargar">Actualizar</button>
    <div class="separador" aria-hidden="true">✦</div><button class="btn-chico" id="a-salir">Salir</button>`,
  { titulo: P.pro?.nombre || 'Agenda Nail', sub: pendiente ? 'Ya casi está lista' : 'Agenda en pausa', pie: false });
  $('#a-salir').onclick = salir;
  $('#a-recargar').onclick = entrar;
}

async function cargarPerfil(userId) {
  const { data, error } = await sb.from('profesionales').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  P.pro = data;
  return data;
}

async function entrar() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return formPin();
  P.user = user;
  try {
    const pro = await cargarPerfil(user.id);
    if (!pro) return pantallaSinAgenda();
    if (pro.estado !== 'activa') return pantallaEstado(pro.estado);
  } catch (e) {
    toast(mensajeError(e), 'error');
    return formPin();
  }
  acceso.hidden = true; app.hidden = false;
  bannerDemo({ enlace: 'r/?m=demo', texto: 'Ver página de reservas' });
  colorPanel();
  actualizarBadge();
  router();
}

async function salir() {
  // Este dispositivo deja de recibir avisos de la agenda al cerrar sesión.
  try { await desactivarAvisos(P.pro?.id); } catch { /* sin conexión: igual se cierra la sesión */ }
  await sb.auth.signOut();
  P.pro = null; P.user = null;
  history.replaceState(null, '', location.pathname + (DEMO ? location.search : ''));
  iniciarAcceso();
}

async function iniciarAcceso() {
  const activar = new URLSearchParams(location.search).get('activar');
  if (activar !== null && !DEMO) return formActivar(leerSlug(activar));
  const { data: { session } } = await sb.auth.getSession();
  if (session) return entrar();
  formPin();
}

// ---------------- Datos ----------------
async function actualizarBadge() {
  const { count, error } = await sb.from('pro_turnos').select('id', { count: 'exact', head: true }).eq('profesional_id', P.pro.id).eq('estado', 'pendiente');
  if (!error) pintarBadge(count);
}
function pintarBadge(count) {
  const b = $('#badge-pedidos');
  b.textContent = count > 99 ? '99+' : String(count || 0);
  b.hidden = !count;
  b.setAttribute('aria-label', `${count || 0} pedidos pendientes`);
}

async function cambiarEstado(t, estado) {
  const { error } = await sb.from('pro_turnos').update({ estado }).eq('id', t.id).eq('profesional_id', P.pro.id);
  if (error) { toast(mensajeError(error), 'error'); return false; }
  return true;
}

function mensajeParaClienta(t, tipo) {
  const firma = P.pro?.nombre || '';
  const cuando = `${fechaRelativa(t.fecha)} a las ${hora5(t.hora_inicio)} h`;
  if (tipo === 'aprobado') return `¡Hola ${t.clienta_nombre}! Te confirmo tu turno de ${t.servicio_nombre} ${cuando}. ¡Te espero! ${firma}`;
  if (tipo === 'rechazado') return `¡Hola ${t.clienta_nombre}! Te escribo de ${firma}. No puedo tomar tu turno de ${t.servicio_nombre} ${cuando}. ¿Te sirve otro horario?`;
  if (tipo === 'cancelado') return `¡Hola ${t.clienta_nombre}! Te escribo de ${firma}. Tuve que cancelar tu turno de ${t.servicio_nombre} ${cuando}. ¿Coordinamos otro?`;
  return `¡Hola ${t.clienta_nombre}! Te escribo de ${firma} por tu pedido de turno de ${t.servicio_nombre} ${cuando}.`;
}

function botonWhatsApp(t, tipo) {
  const link = t.clienta_telefono ? linkWhatsApp(t.clienta_telefono, mensajeParaClienta(t, tipo)) : '';
  return link ? `<a class="btn btn-whatsapp btn-compacto" href="${link}" target="_blank" rel="noopener">${icono('whatsapp')}WhatsApp</a>` : '';
}

function tarjetaTurno(t, { acciones, sinFecha = false }) {
  const pasado = t.fecha < hoyAR();
  return `<article class="pedido estado-${t.estado}" data-id="${t.id}">
    <div class="pedido-cabecera">
      <div class="pedido-cuando">${sinFecha ? `<strong>${hora5(t.hora_inicio)} h</strong><span>hasta las ${hora5(t.hora_fin)} h</span>`
        : `<strong>${esc(capitalizar(fechaLarga(t.fecha)))}</strong><span>${hora5(t.hora_inicio)} a ${hora5(t.hora_fin)} h</span>`}</div>
      <span class="chip chip-${t.estado}">${ESTADOS[t.estado]}</span>
    </div>
    <p class="pedido-clienta">${esc(t.clienta_nombre)}</p>
    <p class="pedido-servicio">${esc(t.servicio_nombre)}${t.precio == null ? '' : ` · <b>${pesos(t.precio)}</b>`}</p>
    ${t.sena ? `<p class="pedido-sena">Seña: <b>${pesos(t.sena)}</b></p>` : ''}
    ${t.clienta_telefono ? `<a class="enlace-tel" href="tel:${esc(t.clienta_telefono)}">${esc(t.clienta_telefono)}</a>` : ''}
    ${t.notas ? `<p class="pedido-notas">“${esc(t.notas)}”</p>` : ''}
    ${t.ref_fotos?.length ? `<div class="pedido-refs"><span class="pedido-refs-txt">${icono('camara')}${t.ref_fotos.length === 1 ? 'Foto del diseño' : `${t.ref_fotos.length} fotos del diseño`}</span>
      <div class="pedido-refs-minis">${t.ref_fotos.map((r, i) => `<button type="button" class="ref-mini-panel" data-ref="${i}" aria-label="Ver foto ${i + 1} del diseño"><img alt="" data-ruta="${esc(r)}"></button>`).join('')}</div></div>` : ''}
    ${pasado && t.estado === 'pendiente' ? '<p class="ayuda ayuda-error">Esta fecha ya pasó.</p>' : ''}
    <div class="pedido-acciones">${acciones}</div>
  </article>`;
}

// ---------------- Vistas ----------------
// Estructura (inspirada en un panel de turnos probado en barberías): Agenda del día, Próximos con filtros,
// Nuevo turno manual y Ajustes en una sola pantalla. Diseño propio de Agenda Nail.
function cabecera() {
  return `<header class="barra-panel">
    ${logoHTML(P.pro || {}, 44)}
    <div class="barra-panel-textos"><strong>${esc(P.pro?.nombre || '')}${DEMO ? '<span class="etiqueta-demo">Demo</span>' : ''}</strong><span>Tu agenda de turnos</span></div>
    <button class="btn-link-top" id="btn-link" aria-label="Tu link para clientas">${icono('enlace')}Link</button>
  </header>`;
}

function hojaLink() {
  const link = linkPublico(P.pro.slug);
  const { capa } = abrirHoja('Tu link para clientas', `
    <p class="texto-suave">Compártelo en tu Instagram, tus estados o por WhatsApp. Ahí tus clientas eligen servicio, día y horario.</p>
    <div class="fila-link"><input id="link-res" readonly value="${esc(link)}" aria-label="Tu link"></div>
    <div class="acciones-fila acciones-3">
      <button class="btn btn-secundario btn-compacto" id="copiar">Copiar</button>
      <button class="btn btn-primario btn-compacto" id="compartir">Compartir</button>
      <a class="btn btn-secundario btn-compacto" href="${esc(link)}" target="_blank" rel="noopener">Ver mi página</a>
    </div>`);
  $('#copiar', capa).onclick = () => copiarLink(link, $('#link-res', capa));
  $('#compartir', capa).onclick = () => compartirLink(link);
}
async function copiarLink(link, input) {
  try { await navigator.clipboard.writeText(link); toast('Link copiado.'); } catch { input?.select(); document.execCommand?.('copy'); toast('Link copiado.'); }
}
async function compartirLink(link) {
  const texto = `¡Reserva tu turno en ${P.pro.nombre}! ✨`;
  if (navigator.share) { try { await navigator.share({ title: P.pro.nombre, text: texto, url: link }); } catch { /* cancelado */ } return; }
  open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${link}`)}`, '_blank', 'noopener');
}
function enlazarCabecera() { $('#btn-link')?.addEventListener('click', hojaLink); }

async function cargarHorarios() {
  if (P.horarios) return P.horarios;
  const { data, error } = await sb.from('pro_horarios').select('*').eq('profesional_id', P.pro.id).order('dia');
  if (error) throw error;
  P.horarios = data;
  return data;
}

/** Botones según el estado del turno. */
function accionesTurno(t) {
  const futuro = t.fecha >= hoyAR();
  if (t.estado === 'pendiente') return `<button class="btn btn-primario btn-compacto" data-acc="aprobar">Confirmar</button>
    <button class="btn btn-secundario btn-compacto" data-acc="rechazar">Rechazar</button>${botonWhatsApp(t, 'pendiente')}`;
  if (t.estado === 'aprobado') return `${botonWhatsApp(t, 'aprobado')}${futuro ? '<button class="btn btn-texto-peligro btn-compacto" data-acc="cancelar">Cancelar turno</button>' : ''}`;
  return botonWhatsApp(t, t.estado);
}

/** Maneja Confirmar / Rechazar / Cancelar dentro de una lista de tarjetas. */
function enlazarAcciones(cont, turnos, recargar) {
  cargarRefs(cont);
  cont.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-ref]');
    if (r) {
      const t = turnos.find((x) => x.id === r.closest('.pedido').dataset.id);
      const urls = $$('img', r.parentElement).map((im) => im.src).filter(Boolean);
      if (urls.length) abrirFotos(urls, `Diseño · ${t?.clienta_nombre || ''}`, Math.min(+r.dataset.ref, urls.length - 1));
      return;
    }
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const t = turnos.find((x) => x.id === b.closest('.pedido').dataset.id); if (!t) return;
    const quien = `${t.clienta_nombre} · ${t.servicio_nombre}, ${fechaLarga(t.fecha)} a las ${hora5(t.hora_inicio)} h.`;
    const conf = {
      aprobar: { estado: 'aprobado', titulo: '¿Confirmar este turno?', texto: `${quien} Después puedes avisarle por WhatsApp.`, si: 'Confirmar', ok: 'Turno confirmado.' },
      rechazar: { estado: 'rechazado', titulo: '¿Rechazar este pedido?', texto: `${quien} El horario vuelve a quedar libre.`, si: 'Rechazar', peligro: true, ok: 'Pedido rechazado.' },
      cancelar: { estado: 'cancelado', titulo: '¿Cancelar este turno?', texto: `${quien} El horario vuelve a quedar libre. Recuerda avisarle a la clienta.`, si: 'Cancelar turno', no: 'Volver', peligro: true, ok: 'Turno cancelado.' },
    }[b.dataset.acc];
    if (!conf || !await confirmar(conf)) return;
    b.disabled = true;
    if (await cambiarEstado(t, conf.estado)) { toast(conf.ok); actualizarBadge(); recargar(); } else b.disabled = false;
  });
}

/** Miniaturas de las fotos de referencia: bucket privado, URLs firmadas por 1 hora (en la demo, del navegador). */
async function cargarRefs(cont) {
  const imgs = $$('img[data-ruta]', cont);
  if (!imgs.length) return;
  let urls = {};
  if (DEMO) imgs.forEach((im) => { urls[im.dataset.ruta] = fotoRefDemo(im.dataset.ruta); });
  else {
    const { data, error } = await sb.storage.from(BUCKET_REFERENCIAS).createSignedUrls([...new Set(imgs.map((im) => im.dataset.ruta))], 3600);
    if (error) return;
    data.forEach((d) => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
  imgs.forEach((im) => {
    if (urls[im.dataset.ruta]) im.src = urls[im.dataset.ruta];
    else im.closest('.ref-mini-panel')?.classList.add('ref-sin');
  });
}

// ---------------- Notificaciones ----------------
const CLAVE_AVISO_OCULTO = 'agenda-nail-pro-aviso-notif-oculto';
const PASOS_IOS = 'En iPhone: toca <b>Compartir</b> → <b>Agregar a inicio</b>, abre la agenda desde el ícono y vuelve a tocar <b>Activar</b>.';
const TEXTO_ESTADO = {
  activadas: ['ok', 'Activadas'], apagadas: ['apagado', 'Desactivadas'], bloqueadas: ['error', 'Bloqueadas'],
  'ios-instalar': ['apagado', 'Falta instalar'], 'ios-viejo': ['error', 'No compatible'], 'no-compatible': ['error', 'No compatible'], demo: ['apagado', 'Demo'],
};

/** Aviso suave en la Agenda si este dispositivo todavía no recibe notificaciones. */
async function bannerAvisos(sigue) {
  if (DEMO) return;
  try { if (localStorage.getItem(CLAVE_AVISO_OCULTO)) return; } catch { /* nada */ }
  const est = await estadoAvisos(P.pro.id);
  if (!sigue() || !['apagadas', 'ios-instalar'].includes(est)) return;
  const caja = $('#aviso-notif'); if (!caja) return;
  caja.innerHTML = `<div class="aviso-notif" role="note">${icono('campana')}
    <span>${est === 'ios-instalar' ? 'Para recibir un aviso con cada pedido nuevo, agrega tu agenda a la pantalla de inicio.' : 'Activa las notificaciones y entérate al instante de cada pedido nuevo.'}</span>
    <a class="btn-chico" href="#/ajustes/notificaciones">${est === 'ios-instalar' ? 'Ver cómo' : 'Activar'}</a>
    <button type="button" class="aviso-notif-cerrar" aria-label="No mostrar más"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>`;
  $('.aviso-notif-cerrar', caja).onclick = () => { try { localStorage.setItem(CLAVE_AVISO_OCULTO, '1'); } catch { /* nada */ } caja.innerHTML = ''; };
}

async function pintarNotif(estado) {
  const cont = $('#notif-cont'); if (!cont) return;
  const est = estado || await estadoAvisos(P.pro.id);
  if (!$('#notif-cont')) return;
  const [cls, txt] = TEXTO_ESTADO[est] || TEXTO_ESTADO.apagadas;
  const botonActivar = (dis = false) => `<button type="button" class="btn btn-primario" id="notif-activar" ${dis ? 'disabled' : ''}>${icono('campana')}Activar notificaciones</button>`;
  const cuerpo = {
    demo: `${botonActivar(true)}<p class="ayuda">En la demo no hay notificaciones.</p>`,
    'ios-instalar': `<p class="pasos-ios">${PASOS_IOS}</p>${botonActivar(true)}<p class="ayuda">Necesitas iOS 16.4 o más nuevo.</p>`,
    'ios-viejo': '<p class="ayuda">Tu iPhone necesita iOS 16.4 o más nuevo para recibir notificaciones. Actualízalo en Ajustes → General → Actualización de software.</p>',
    'no-compatible': `<p class="ayuda">Este navegador no permite notificaciones. Usa Chrome en Android${esIOS() ? '' : ' o en la computadora'}; en iPhone, agrega la agenda a tu pantalla de inicio (iOS 16.4 o más).</p>`,
    bloqueadas: `<p class="ayuda">Las bloqueaste para esta página. Para volver a permitirlas: toca el candado o los tres puntos junto a la dirección → <b>Permisos</b> / <b>Configuración del sitio</b> → <b>Notificaciones</b> → <b>Permitir</b>. Después vuelve a tocar Activar.</p>${botonActivar()}`,
    apagadas: `${botonActivar()}<p class="ayuda">Tu teléfono te va a preguntar si permites notificaciones: toca <b>Permitir</b>.</p>`,
    activadas: `<p class="ayuda">Este dispositivo recibe un aviso con cada pedido nuevo.</p>
      <div class="acciones-fila"><button type="button" class="btn btn-secundario btn-compacto" id="notif-probar">Probar notificación</button>
      <button type="button" class="btn btn-texto-peligro btn-compacto" id="notif-desactivar">Desactivar</button></div>`,
  }[est];
  cont.innerHTML = `<p class="estado-notif"><span class="chip-notif chip-notif-${cls}">${esc(txt)}</span></p>${cuerpo}`;
  $('#notif-activar', cont)?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Activando…';
    try {
      const nuevo = await activarAvisos(P.pro.id);
      if (nuevo === 'activadas') { toast('¡Listo! Te vamos a avisar cada pedido nuevo.'); try { localStorage.removeItem(CLAVE_AVISO_OCULTO); } catch { /* nada */ } }
      else if (nuevo === 'bloqueadas') toast('Las notificaciones quedaron bloqueadas. Mira cómo permitirlas.', 'error');
      pintarNotif(nuevo);
    } catch (x) {
      toast(/denied|permission/i.test(String(x?.message)) ? 'No se dio permiso para notificaciones.' : 'No se pudieron activar. Intenta de nuevo.', 'error');
      pintarNotif();
    }
  });
  $('#notif-probar', cont)?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await probarAvisos();
      toast(r.enviadas ? `Prueba enviada${r.enviadas > 1 ? ` a ${r.enviadas} dispositivos` : ''}. Debería llegarte en unos segundos.` : 'No se pudo entregar la prueba. Desactiva y vuelve a activar.', r.enviadas ? undefined : 'error');
    } catch (x) { toast(x.message || 'No se pudo enviar la prueba.', 'error'); }
    setTimeout(() => { b.disabled = false; }, 4000);
  });
  $('#notif-desactivar', cont)?.addEventListener('click', async () => {
    try { await desactivarAvisos(P.pro.id); toast('Notificaciones desactivadas en este dispositivo.'); } catch (x) { toast(mensajeError(x), 'error'); }
    pintarNotif();
  });
}

const DIAS_TIRA = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const ACTIVOS = ['pendiente', 'aprobado'];

async function vistaAgenda(param) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(param || '')) P.diaAgenda = param;
  const sel = P.diaAgenda, hoy = hoyAR();
  const desde = sumarDias(sel, -2), hasta = sumarDias(sel, 18);
  main.innerHTML = cabecera() + `
    <div class="dia-nav">
      <button class="btn-icono" id="dia-ant" aria-label="Día anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="dia-nav-titulo"><h1>${esc(capitalizar(DIAS[diaSemana(sel)]))} ${fechaCorta(sel)}</h1>
        ${sel === hoy ? '<span>Hoy</span>' : '<button class="btn-chico" id="ir-hoy">Ir a hoy</button>'}</div>
      <button class="btn-icono" id="dia-sig" aria-label="Día siguiente"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <div class="tira-agenda" id="tira"><span class="texto-suave">Cargando…</span></div>
    <div id="aviso-pend"></div>
    <div id="aviso-notif"></div>
    <div class="contadores" id="contadores"></div>
    <div id="dia" class="lista-pedidos"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>
    <a class="btn-agregar-dia" href="#/nuevo/${sel}">${icono('mas')}Agregar turno este día</a>`;
  enlazarCabecera();
  const ir = (f) => { P.diaAgenda = f; vistaAgenda(); };
  $('#dia-ant').onclick = () => ir(sumarDias(sel, -1));
  $('#dia-sig').onclick = () => ir(sumarDias(sel, 1));
  $('#ir-hoy')?.addEventListener('click', () => ir(hoy));
  const sigue = vigente();
  bannerAvisos(sigue);
  let hs, data, pend;
  try {
    [hs, { data }, pend] = await Promise.all([
      cargarHorarios(),
      sb.from('pro_turnos').select('*').eq('profesional_id', P.pro.id).gte('fecha', desde).lte('fecha', hasta).order('hora_inicio').throwOnError(),
      sb.from('pro_turnos').select('id', { count: 'exact', head: true }).eq('profesional_id', P.pro.id).eq('estado', 'pendiente').gte('fecha', hoy),
    ]);
  } catch (e) { if (sigue()) $('#dia').innerHTML = `<div class="tarjeta"><p class="vacio">${esc(mensajeError(e))}</p></div>`; return; }
  if (!sigue()) return;
  const dias = Array.from({ length: 21 }, (_, i) => sumarDias(desde, i));
  $('#tira').innerHTML = dias.map((f) => {
    const h = hs.find((x) => x.dia === diaSemana(f));
    const n = data.filter((t) => t.fecha === f && ACTIVOS.includes(t.estado)).length;
    const cerrado = !(h && h.trabaja);
    return `<button class="tira-dia${f === sel ? ' sel' : ''}${cerrado ? ' cerrado' : ''}" data-f="${f}" aria-label="${esc(fechaLarga(f))}: ${cerrado && !n ? 'no atiendes' : `${n} turnos`}">
      <span class="tira-nombre">${f === hoy ? 'HOY' : DIAS_TIRA[diaSemana(f)]}</span><span class="tira-num">${+f.slice(8)}</span>
      <span class="tira-estado">${n ? `<b>${n}</b>` : cerrado ? 'cerrado' : '–'}</span></button>`;
  }).join('');
  $$('#tira .tira-dia').forEach((b) => b.onclick = () => ir(b.dataset.f));
  const s = $('#tira .sel'); if (s) $('#tira').scrollLeft = s.offsetLeft - 8 - (s.offsetWidth + 8) * 2;
  if (pend.count) {
    $('#aviso-pend').innerHTML = `<a class="aviso-pendientes" href="#/proximos/pendientes">${icono('reloj')}<span>Tienes <b>${pend.count}</b> ${pend.count === 1 ? 'pedido' : 'pedidos'} por confirmar</span><span aria-hidden="true">›</span></a>`;
  }
  pintarBadge(pend.count);
  const delDia = data.filter((t) => t.fecha === sel);
  const activos = delDia.filter((t) => ACTIVOS.includes(t.estado));
  $('#contadores').innerHTML = `<div class="contador"><b>${activos.length}</b><span>Turnos</span></div>
    <div class="contador"><b>${activos.filter((t) => t.estado === 'pendiente').length}</b><span>Por confirmar</span></div>`;
  const h = hs.find((x) => x.dia === diaSemana(sel));
  const orden = [...activos, ...delDia.filter((t) => !ACTIVOS.includes(t.estado))];
  $('#dia').innerHTML = orden.length ? orden.map((t) => tarjetaTurno(t, { acciones: accionesTurno(t), sinFecha: true })).join('')
    : `<div class="tarjeta"><p class="vacio">${h && h.trabaja ? `Sin turnos. Atiendes de ${hora5(h.inicio)} a ${hora5(h.fin)} h.` : 'Este día no atiendes.'}</p></div>`;
  enlazarAcciones($('#dia'), delDia, vistaAgenda);
}

const FILTROS = {
  activos: ['Activos', (q) => q.in('estado', ACTIVOS)],
  pendientes: ['Por confirmar', (q) => q.eq('estado', 'pendiente')],
  confirmados: ['Confirmados', (q) => q.eq('estado', 'aprobado')],
  cancelados: ['Cancelados', (q) => q.in('estado', ['rechazado', 'cancelado'])],
  todos: ['Todos', (q) => q],
};
async function vistaProximos(param) {
  const filtro = FILTROS[param] ? param : 'activos';
  main.innerHTML = cabecera() + `
    <h1 class="titulo-vista">Próximos turnos</h1>
    <div class="chips-filtro" role="tablist">${Object.entries(FILTROS).map(([k, [n]]) =>
      `<a role="tab" class="chip-filtro${k === filtro ? ' sel' : ''}" aria-selected="${k === filtro}" href="#/proximos/${k}">${n}</a>`).join('')}</div>
    <div id="lista" class="lista-pedidos"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>`;
  enlazarCabecera();
  const sel = $('.chip-filtro.sel'); if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  const sigue = vigente();
  const { data, error } = await FILTROS[filtro][1](sb.from('pro_turnos').select('*').eq('profesional_id', P.pro.id).gte('fecha', hoyAR()))
    .order('fecha').order('hora_inicio').limit(200);
  if (!sigue()) return;
  const lista = $('#lista');
  if (error) { lista.innerHTML = `<div class="tarjeta"><p class="vacio">${esc(mensajeError(error))}</p></div>`; return; }
  if (filtro === 'activos' || filtro === 'pendientes') pintarBadge(filtro === 'pendientes' ? data.length : data.filter((t) => t.estado === 'pendiente').length);
  lista.innerHTML = data.length ? data.map((t) => tarjetaTurno(t, { acciones: accionesTurno(t) })).join('')
    : `<div class="tarjeta"><p class="vacio">${filtro === 'pendientes' ? 'No tienes pedidos por confirmar.<br>Cuando una clienta reserve, aparecerá aquí.' : 'No hay turnos para mostrar.'}</p></div>`;
  enlazarAcciones(lista, data, () => vistaProximos(filtro));
}

async function vistaNuevo(param) {
  const hoy = hoyAR();
  const fecha0 = /^\d{4}-\d{2}-\d{2}$/.test(param || '') && param >= sumarDias(hoy, -30) ? param : hoy;
  main.innerHTML = cabecera() + `<h1 class="titulo-vista">Nuevo turno</h1>
    <p class="cabecera-sub">Para clientas que te escriben, te llaman o vienen sin turno.</p>
    <div id="n-cont"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>`;
  enlazarCabecera();
  const sigue = vigente();
  let hs, srvs;
  try {
    [hs, { data: srvs }] = await Promise.all([cargarHorarios(),
      sb.from('pro_servicios').select('*').eq('profesional_id', P.pro.id).eq('activo', true).order('created_at').throwOnError()]);
    srvs = srvs.filter((s) => !s.es_extra);
  } catch (e) { if (sigue()) $('#n-cont').innerHTML = `<p class="tarjeta vacio">${esc(mensajeError(e))}</p>`; return; }
  if (!sigue()) return;
  if (!srvs.length) {
    $('#n-cont').innerHTML = '<div class="tarjeta"><p class="vacio">Primero agrega al menos un servicio.</p><a class="btn btn-primario btn-grande" href="#/ajustes/servicios">Ir a Servicios</a></div>';
    return;
  }
  $('#n-cont').innerHTML = `<form id="f-nuevo" novalidate class="tarjeta">
    <div class="campo"><label for="n-nombre">Clienta</label><input id="n-nombre" maxlength="80" autocomplete="off" placeholder="Nombre y apellido"></div>
    <div class="campo"><label for="n-tel">WhatsApp (opcional)</label><input id="n-tel" type="tel" inputmode="tel" maxlength="25" placeholder="Ej.: 353 412 3456"></div>
    <div class="campo"><label for="n-srv">Servicio</label><select id="n-srv">${srvs.map((s) =>
      `<option value="${s.id}">${esc(s.nombre)} · ${s.precio == null ? 'Consultar precio' : pesos(s.precio)} · ${duracionTexto(s.duracion_min)}</option>`).join('')}</select></div>
    <div class="campo"><label for="n-fecha">Día</label><input id="n-fecha" type="date" value="${fecha0}" min="${sumarDias(hoy, -30)}"></div>
    <div class="campo"><span class="label">Horarios libres</span><div id="n-libres" class="grilla-horas"></div></div>
    <div class="campo"><label for="n-hora">Hora</label><input id="n-hora" type="time" step="300"></div>
    <div class="campo"><span class="label">Estado</span><div class="segmentado">
      <label><input type="radio" name="n-estado" value="aprobado" checked><span>Confirmado</span></label>
      <label><input type="radio" name="n-estado" value="pendiente"><span>Por confirmar</span></label></div></div>
    <div class="campo"><label for="n-notas">Nota (opcional)</label><textarea id="n-notas" maxlength="300" placeholder="Ej.: trae diseño de referencia"></textarea></div>
    <p id="n-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Guardar turno</button>
  </form>`;
  const pintarLibres = async () => {
    const f = $('#n-fecha').value, caja = $('#n-libres');
    if (!f) { caja.innerHTML = ''; return; }
    caja.innerHTML = '<span class="texto-suave">Buscando…</span>';
    const srv = srvs.find((s) => s.id === $('#n-srv').value);
    const { data, error } = await sb.from('pro_turnos').select('fecha,hora_inicio,hora_fin').eq('profesional_id', P.pro.id).eq('fecha', f).in('estado', ACTIVOS);
    if (f !== $('#n-fecha').value) return;
    if (error) { caja.innerHTML = `<span class="texto-suave">${esc(mensajeError(error))}</span>`; return; }
    const libres = horariosLibres({ fecha: f, horario: hs.find((x) => x.dia === diaSemana(f)), intervalo: P.pro.intervalo_min, duracion: srv.duracion_min, modo: P.pro.modo_horario,
      ocupados: data.map((o) => ({ fecha: o.fecha, hora_inicio: hora5(o.hora_inicio), hora_fin: hora5(o.hora_fin) })) });
    caja.innerHTML = libres.length ? libres.map((t) => `<button type="button" class="hora${t === $('#n-hora').value ? ' sel' : ''}" data-h="${t}">${t}</button>`).join('')
      : '<span class="texto-suave">No quedan horarios libres en tu grilla ese día. Igual puedes cargar otra hora abajo.</span>';
    $$('.hora', caja).forEach((b) => b.onclick = () => { $('#n-hora').value = b.dataset.h; $$('.hora', caja).forEach((x) => x.classList.toggle('sel', x === b)); });
  };
  $('#n-fecha').addEventListener('change', pintarLibres);
  $('#n-srv').addEventListener('change', pintarLibres);
  $('#n-hora').addEventListener('input', () => $$('#n-libres .hora').forEach((x) => x.classList.toggle('sel', x.dataset.h === $('#n-hora').value)));
  pintarLibres();
  $('#f-nuevo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#n-error'); err.hidden = true;
    const falla = (m) => { err.textContent = m; err.hidden = false; };
    const nombre = $('#n-nombre').value.trim(), telTxt = $('#n-tel').value.trim(), tel = normalizarTelefono(telTxt);
    const fecha = $('#n-fecha').value, hora = $('#n-hora').value;
    if (nombre.length < 2) return falla('Escribe el nombre de la clienta.');
    if (telTxt && !tel) return falla('Revisa el WhatsApp: código de área + número, sin 0 ni 15.');
    if (!fecha) return falla('Elige el día.');
    if (!hora) return falla('Elige un horario libre o escribe la hora.');
    const b = ev.submitter; b.disabled = true;
    const { error } = await sb.rpc('pro_turno_manual', { p_servicio_id: $('#n-srv').value, p_fecha: fecha, p_hora: hora, p_nombre: nombre,
      p_telefono: tel || null, p_notas: $('#n-notas').value.trim() || null, p_estado: $('input[name=n-estado]:checked').value });
    b.disabled = false;
    if (error) return falla(/HORARIO_OCUPADO/.test(error.message) ? 'Ya tienes un turno en ese horario. Elige otra hora.'
      : /FUERA_DE_HORARIO/.test(error.message) ? 'El turno tiene que terminar antes de la medianoche.' : mensajeError(error));
    toast('Turno guardado.');
    P.diaAgenda = fecha; actualizarBadge();
    location.hash = '#/agenda';
  });
}

// Agendas con tema (plantilla estudio): color dorado y clase de tema. Las demás siguen con su color de siempre.
function colorPanel() {
  if (P.pro?.tema?.plantilla === 'estudio') { aplicarTema(P.pro.tema); document.body.classList.add('panel-estudio'); aplicarColor(P.pro.tema.colores?.oro || null); }
  else aplicarColor(P.pro?.color);
}
const TEMA = () => (P.pro?.tema?.plantilla === 'estudio' ? P.pro.tema : null);

function camposEstudio(s) {
  const t = TEMA(); if (!t) return '';
  const todos = (P.servicios || []).filter((x) => x.id !== s?.id && !x.es_extra && !(x.combo_ids || []).length);
  const ids = new Set(s?.combo_ids || []), ops = new Set(s?.combo_opciones || []);
  const cats = (t.categorias || []).map((k) => `<option value="${esc(k.id)}" ${s?.categoria === k.id ? 'selected' : ''}>${esc(k.nombre)}</option>`).join('');
  return `<div class="campo"><label for="s-cat">Categoría</label><select id="s-cat"><option value="">Sin categoría</option>${cats}</select></div>
    <label class="interruptor"><input type="checkbox" id="s-prox" ${s?.proximamente ? 'checked' : ''}><span>Próximamente (se ve, pero no se puede reservar)</span></label>
    <label class="interruptor"><input type="checkbox" id="s-desde" ${s?.precio_desde ? 'checked' : ''}><span>Mostrar precio como “desde”</span></label>
    <div class="solo-extra"><div class="fila-2">
      <div class="campo"><label for="s-xmin">Suma minutos</label><input id="s-xmin" inputmode="numeric" value="${s?.extra_min ?? 0}"></div>
      <label class="interruptor" style="align-self:end"><input type="checkbox" id="s-xuni" ${s?.extra_por_unidad ? 'checked' : ''}><span>Precio por unidad (elige cantidad)</span></label>
    </div></div>
    <details class="combo-ed" ${ids.size ? 'open' : ''}><summary><b>Combo</b>: armar con otros servicios</summary>
      <p class="ayuda">Tildá los servicios incluidos. La duración del combo se calcula sola (suma).</p>
      <div class="combo-lista">${todos.map((x) => `<label class="interruptor"><input type="checkbox" class="s-comp" value="${x.id}" ${ids.has(x.id) ? 'checked' : ''}><span>${esc(x.nombre)} · ${duracionTexto(x.duracion_min)}</span></label>`).join('')}</div>
      <p class="ayuda"><b>“Elegí uno”</b> (opcional, mínimo 2): la clienta elige una de estas opciones.</p>
      <div class="combo-lista">${todos.map((x) => `<label class="interruptor"><input type="checkbox" class="s-op" value="${x.id}" ${ops.has(x.id) ? 'checked' : ''}><span>${esc(x.nombre)}</span></label>`).join('')}</div>
    </details>`;
}
function leerEstudio(capa) {
  if (!TEMA()) return {};
  const comp = $$('.s-comp:checked', capa).map((i) => i.value), op = $$('.s-op:checked', capa).map((i) => i.value).filter((v) => !comp.includes(v));
  const xmin = Math.max(0, Math.min(240, parseInt($('#s-xmin', capa).value, 10) || 0));
  return { categoria: $('#s-cat', capa).value || null, proximamente: $('#s-prox', capa).checked, precio_desde: $('#s-desde', capa).checked,
    extra_min: xmin, extra_por_unidad: $('#s-xuni', capa).checked, combo_ids: comp, combo_opciones: comp.length && op.length >= 2 ? op : [] };
}

function editarCategorias() {
  const t = TEMA(); if (!t) return;
  const { capa, cerrar } = abrirHoja('Categorías', `<form id="f-cats" novalidate>
    ${(t.categorias || []).map((k, i) => `<fieldset class="tarjeta" style="margin-bottom:10px"><div class="campo"><label>Nombre</label><input data-i="${i}" data-k="nombre" maxlength="30" value="${esc(k.nombre)}"></div>
      <div class="campo"><label>Texto corto</label><input data-i="${i}" data-k="sub" maxlength="60" value="${esc(k.sub || '')}"></div></fieldset>`).join('')}
    <div class="campo"><label for="c-ben">Beneficios exclusivos</label><textarea id="c-ben" rows="3" maxlength="200">${esc(t.beneficios?.texto || '')}</textarea></div>
    <p id="c-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Guardar</button></form>`);
  $('#f-cats', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nt = structuredClone(t);
    $$('[data-i]', capa).forEach((inp) => { const v = inp.value.trim(); if (inp.dataset.k === 'nombre' && !v) return; nt.categorias[+inp.dataset.i][inp.dataset.k] = v; });
    nt.beneficios = { ...(nt.beneficios || { titulo: 'Beneficios exclusivos' }), texto: $('#c-ben', capa).value.trim() };
    const r = await sb.from('profesionales').update({ tema: nt }).eq('id', P.pro.id).select('*').single();
    if (r.error) { const e = $('#c-error', capa); e.textContent = mensajeError(r.error); e.hidden = false; return; }
    P.pro = r.data; cerrar(); toast('Categorías guardadas.');
  });
}

function editarServicio(s) {
  const nuevo = !s;
  let fotos = [...(s?.fotos || [])];
  const { capa, cerrar } = abrirHoja(nuevo ? 'Nuevo servicio' : 'Editar servicio', `
    <form id="f-srv" novalidate>
      <div class="campo"><label for="s-nombre">Nombre</label><input id="s-nombre" maxlength="80" required value="${esc(s?.nombre || '')}" placeholder="Ej.: Semipermanente"></div>
      <div class="fila-2">
        <div class="campo"><label for="s-precio">Precio (opcional)</label><div class="input-pesos"><span>$</span><input id="s-precio" inputmode="numeric" value="${pesosInput(s?.precio ?? '')}" placeholder="15.000"></div></div>
        <div class="campo"><label for="s-dur">Duración</label><select id="s-dur">${(TEMA() ? [...new Set([15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 210, 240, ...(s?.duracion_min ? [s.duracion_min] : [])])] : [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240]).sort((a, b) => a - b).map((d) => `<option value="${d}" ${(s?.duracion_min || 60) === d ? 'selected' : ''}>${duracionTexto(d)}</option>`).join('')}</select></div>
      </div>
      <p class="ayuda" style="margin:-6px 0 12px">Si dejas el precio vacío, tus clientas verán “Consultar precio”.</p>
      <div class="campo"><label for="s-desc">Descripción (opcional)</label><textarea id="s-desc" maxlength="200" rows="2" placeholder="Ej.: Incluye deco en 2 uñas">${esc(s?.descripcion || '')}</textarea></div>
      <label class="interruptor"><input type="checkbox" id="s-extra" ${s?.es_extra ? 'checked' : ''}><span>Es un extra (no se reserva aparte)</span></label>
      <p class="ayuda" style="margin:-4px 0 12px">Los extras se muestran como nota debajo de los servicios. Ej.: diseño en todas las uñas.</p>
      ${nuevo ? '<p class="ayuda">Después de guardar, toca el servicio para sumarle fotos.</p>' : `<label class="interruptor"><input type="checkbox" id="s-activo" ${s.activo ? 'checked' : ''}><span>Visible para reservar</span></label>
      <div class="campo"><span class="label">Fotos (hasta 2)</span><div class="fotos-srv" id="s-fotos"></div>
        <p class="ayuda">Se achican solas para que carguen rápido. Se guardan al momento.</p></div>`}
      ${camposEstudio(s)}
      <p id="s-error" class="form-error-general" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit">Guardar</button>
    </form>`);
  const precio = $('#s-precio', capa);
  precio.addEventListener('input', () => { const n = parsePesos(precio.value); precio.value = n === null ? '' : pesosInput(n); });

  // Fotos: se suben a pro-servicios/<id de la agenda>/servicios/ y se guardan en el servicio al momento.
  const guardarFotos = async (nuevas) => {
    const r = await sb.from('pro_servicios').update({ fotos: nuevas }).eq('id', s.id).eq('profesional_id', P.pro.id).select('fotos').single();
    if (r.error) throw r.error;
    fotos = r.data?.fotos || nuevas; s.fotos = fotos;
  };
  const pintarFotos = () => {
    const caja = $('#s-fotos', capa); if (!caja) return;
    caja.innerHTML = fotos.map((f, i) => `<div class="foto-srv">
        <button type="button" class="foto-srv-ver" data-i="${i}" aria-label="Ver foto ${i + 1}"><img src="${esc(urlFoto(f))}" alt=""></button>
        <div class="foto-srv-acc">
          <label class="btn btn-secundario btn-compacto">Cambiar<input type="file" accept="image/*" class="oculto" data-cambiar="${i}"></label>
          <button type="button" class="btn btn-texto-peligro btn-compacto" data-quitar="${i}">Quitar</button>
        </div></div>`).join('')
      + (fotos.length < 2 ? `<label class="foto-srv-agregar">${icono('mas')}<span>Agregar foto</span><input type="file" accept="image/*" class="oculto" data-agregar></label>` : '');
    $$('.foto-srv-ver', caja).forEach((b) => b.onclick = () => abrirFotos(fotos.map(urlFoto), s.nombre, Number(b.dataset.i)));
    $$('input[type=file]', caja).forEach((inp) => inp.addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const i = inp.dataset.cambiar != null ? Number(inp.dataset.cambiar) : fotos.length;
      caja.classList.add('subiendo'); caja.insertAdjacentHTML('beforeend', '<p class="texto-suave foto-srv-estado"><span class="spinner"></span> Subiendo foto…</p>');
      let path;
      try {
        const { blob, tipo, ext } = await comprimirFoto(f);
        path = `${P.pro.id}/servicios/${s.id.slice(0, 8)}-${Date.now()}.${ext}`;
        const up = await sb.storage.from(BUCKET_SERVICIOS).upload(path, blob, { contentType: tipo, cacheControl: '31536000', upsert: false });
        if (up.error) throw up.error;
        const vieja = fotos[i], nuevas = [...fotos]; nuevas[i] = path;
        try { await guardarFotos(nuevas); } catch (err) { await sb.storage.from(BUCKET_SERVICIOS).remove([path]); throw err; }
        if (vieja) await sb.storage.from(BUCKET_SERVICIOS).remove([vieja]);
        toast(vieja ? 'Foto cambiada.' : 'Foto agregada.'); pintarServicios();
      } catch (err) { toast(mensajeError(err), 'error'); }
      caja.classList.remove('subiendo'); pintarFotos();
    }));
    $$('[data-quitar]', caja).forEach((b) => b.onclick = async () => {
      if (!await confirmar({ titulo: '¿Quitar esta foto?', texto: 'Tus clientas dejarán de verla.', si: 'Quitar', peligro: true })) return;
      const i = Number(b.dataset.quitar), vieja = fotos[i];
      try {
        await guardarFotos(fotos.filter((_, j) => j !== i));
        await sb.storage.from(BUCKET_SERVICIOS).remove([vieja]);
        toast('Foto quitada.'); pintarServicios();
      } catch (err) { toast(mensajeError(err), 'error'); }
      pintarFotos();
    });
  };
  pintarFotos();

  $('#f-srv', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = $('#s-nombre', capa).value.trim(), p = parsePesos(precio.value);
    const err = $('#s-error', capa);
    if (!nombre) { err.textContent = 'Escribe el nombre del servicio.'; err.hidden = false; return; }
    const fila = { nombre, precio: p, duracion_min: Number($('#s-dur', capa).value), descripcion: $('#s-desc', capa).value.trim() || null, es_extra: $('#s-extra', capa).checked };
    if (!nuevo) fila.activo = $('#s-activo', capa).checked;
    Object.assign(fila, leerEstudio(capa));
    const b = ev.submitter; b.disabled = true;
    const { error } = nuevo ? await sb.from('pro_servicios').insert({ ...fila, profesional_id: P.pro.id }) : await sb.from('pro_servicios').update(fila).eq('id', s.id).eq('profesional_id', P.pro.id);
    b.disabled = false;
    if (error) { err.textContent = mensajeError(error); err.hidden = false; return; }
    cerrar(); toast(nuevo ? 'Servicio agregado.' : 'Servicio guardado.'); pintarServicios();
  });
}

const COLORES = [
  ['#e23f8c', 'Fucsia'], ['#d6336c', 'Frambuesa'], ['#c2185b', 'Cereza'], ['#b5651d', 'Nude tostado'],
  ['#a0522d', 'Canela'], ['#9c27b0', 'Violeta'], ['#7e57c2', 'Lavanda'], ['#e0607e', 'Coral'], ['#1f8a8a', 'Turquesa'], ['#333333', 'Negro'],
];
const TIPOS_LOGO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };


async function vistaAjustes(param) {
  const c = P.pro, link = linkPublico(c.slug), orden = [1, 2, 3, 4, 5, 6, 0];
  main.innerHTML = cabecera() + `<h1 class="titulo-vista">Ajustes</h1>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Link para clientas</h2></div>
      <div class="fila-link"><input id="p-link" readonly value="${esc(link)}" aria-label="Tu link público"></div>
      <div class="acciones-fila acciones-3">
        <button class="btn btn-secundario btn-compacto" id="p-copiar">Copiar</button>
        <button class="btn btn-primario btn-compacto" id="p-compartir">Compartir</button>
        <a class="btn btn-secundario btn-compacto" href="${esc(link)}" target="_blank" rel="noopener">Ver mi página</a>
      </div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Tus datos</h2></div>
      <div class="campo"><label for="p-nombre">Nombre de tu marca</label><input id="p-nombre" maxlength="60" required value="${esc(c.nombre)}"></div>
      <div class="campo"><label for="p-wa">WhatsApp (opcional)</label><input id="p-wa" type="tel" inputmode="tel" maxlength="25" value="${esc(c.whatsapp || '')}" placeholder="Ej.: 353 412 5853">
        <p class="ayuda">Con código de área, sin 0 ni 15. Aparece en tu página para que te escriban.</p></div>
      <div class="campo"><label for="p-ig">Instagram (opcional)</label><input id="p-ig" maxlength="60" autocapitalize="none" value="${esc(c.instagram || '')}" placeholder="tu_usuario"></div>
      <div class="campo"><label for="p-zona">Zona (opcional)</label><input id="p-zona" maxlength="120" value="${esc(c.zona || '')}" placeholder="Ej.: Tío Pujio, Córdoba"></div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Logo</h2></div>
      <div class="perfil-logo">
        <div id="p-logo-vista">${logoHTML(c, 96)}</div>
        <div class="perfil-logo-acciones">
          <label class="btn btn-secundario btn-compacto" for="p-logo">${c.logo_path ? 'Cambiar logo' : 'Subir logo'}</label>
          <input id="p-logo" type="file" accept="image/png,image/jpeg,image/webp" class="oculto">
          ${c.logo_path ? '<button type="button" class="btn btn-texto-peligro btn-compacto" id="p-quitar-logo">Quitar</button>' : ''}
          <p class="ayuda">PNG, JPG o WEBP de hasta 2 MB. Mejor cuadrado.</p>
        </div>
      </div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Color de tu página</h2></div>
      <div class="colores" role="radiogroup" aria-label="Color de tu página">${COLORES.map(([hex, n]) =>
        `<button type="button" class="color-op" role="radio" data-color="${hex}" style="--c:${hex}" aria-label="${n}" title="${n}"></button>`).join('')}
        <label class="color-op color-libre" title="Elegir otro color"><input type="color" id="p-color" value="${esc(c.color || COLOR_BASE)}" aria-label="Elegir otro color"></label>
      </div>
      <p class="ayuda">El fucsia es el color por defecto.</p>
    </section>
    <section class="tarjeta" id="sec-sena">
      <div class="tarjeta-titulo"><h2>Seña</h2></div>
      <div class="fila-2">
        <div class="campo"><label for="p-sena">Seña para reservar</label><select id="p-sena">${[0, 10, 20, 25, 30, 40, 50, 100].map((n) => `<option value="${n}" ${(Number(c.sena_pct) || 0) === n ? 'selected' : ''}>${n ? `${n}% del precio` : 'Sin seña'}</option>`).join('')}</select></div>
        <div class="campo"><label for="p-alias">Alias para transferir</label><input id="p-alias" maxlength="60" autocapitalize="none" autocomplete="off" value="${esc(c.alias_pago || '')}" placeholder="tu.alias.mp"></div>
      </div>
      <p class="ayuda">Tus clientas ven cuánto es la seña y tu alias al pedir el turno, y te mandan el comprobante por WhatsApp. La app no cobra nada.</p>
    </section>
    <section class="tarjeta" id="sec-horarios">
      <div class="tarjeta-titulo"><h2>Horarios de atención</h2></div>
      <div class="segmentado" id="h-modo" role="radiogroup" aria-label="Tipo de horario">
        <label><input type="radio" name="h-modo" value="rango" ${c.modo_horario === 'fijo' ? '' : 'checked'}><span>De corrido</span></label>
        <label><input type="radio" name="h-modo" value="fijo" ${c.modo_horario === 'fijo' ? 'checked' : ''}><span>Horarios fijos</span></label></div>
      <p class="ayuda" id="h-modo-ayuda"></p>
      <div class="lista-horarios" id="h-cont"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Turnos</h2></div>
      <div class="fila-2">
        <div class="campo"><label for="c-int">Cada cuánto empieza un turno</label><select id="c-int">${[15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${c.intervalo_min === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div>
        <div class="campo"><label for="c-dias">Días para reservar</label><select id="c-dias">${[7, 14, 21, 30, 45, 60].map((n) => `<option value="${n}" ${c.dias_reserva === n ? 'selected' : ''}>${n} días</option>`).join('')}</select></div>
      </div>
    </section>
    <p id="p-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="button" id="guardar-ajustes">Guardar ajustes</button>
    <section class="tarjeta" id="sec-servicios">
      <div class="tarjeta-titulo"><h2>Servicios y precios</h2></div>
      <p class="ayuda">Toca un servicio para cambiar nombre, precio o duración. Se guarda al momento.</p>
      <ul class="lista-servicios" id="lista-srv"><li class="cargando"><span class="spinner"></span> Cargando…</li></ul>
      <button type="button" class="btn-agregar" id="nuevo-srv">${icono('mas')}Agregar servicio</button>
    </section>
    <section class="tarjeta" id="sec-notif">
      <div class="tarjeta-titulo"><h2>Notificaciones</h2></div>
      <p class="texto-suave">Un aviso en este teléfono cada vez que una clienta pide un turno.</p>
      <div id="notif-cont"><div class="cargando"><span class="spinner"></span> Revisando…</div></div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Tu cuenta</h2></div>
      ${DEMO ? `<p class="texto-suave">Estás viendo la demo: los cambios se guardan solo en este dispositivo. En la demo no hace falta PIN; tu agenda real se abre con su nombre y un PIN de 6 números.</p>
      <button type="button" class="btn btn-texto-peligro" id="cerrar-sesion">Reiniciar demo</button>` : `<p class="texto-suave">Entras con tu agenda <b>${esc(P.pro?.slug || '')}</b> y tu PIN.</p>
      <button type="button" class="btn btn-secundario" id="cambiar-pin">Cambiar mi PIN</button>
      <button type="button" class="btn btn-texto-peligro" id="cerrar-sesion">Cerrar sesión</button>`}
    </section>
    <p class="pie">Agenda Nail · ${esc(c.nombre)}</p>`;
  enlazarCabecera();
  pintarNotif();
  if (param === 'notificaciones') requestAnimationFrame(() => $('#sec-notif')?.scrollIntoView({ block: 'start' }));
  $('#p-copiar').onclick = () => copiarLink(link, $('#p-link'));
  $('#p-compartir').onclick = () => compartirLink(link);
  $('#nuevo-srv').onclick = () => editarServicio(null);
  if (TEMA()) { $('#nuevo-srv').insertAdjacentHTML('afterend', `<button type="button" class="btn-agregar" id="editar-cats">${icono('lapiz')}Categorías y beneficios</button>`); $('#editar-cats').onclick = editarCategorias; }
  if (DEMO) $('#cerrar-sesion').onclick = async () => { if (await confirmar({ titulo: '¿Reiniciar la demo?', texto: 'Se borran los turnos y cambios de prueba de este dispositivo.', si: 'Reiniciar', peligro: true })) { reiniciarDemo(); location.reload(); } };
  if (!DEMO) $('#cambiar-pin').onclick = cambiarPin;
  if (!DEMO) $('#cerrar-sesion').onclick = async () => { if (await confirmar({ titulo: '¿Cerrar sesión?', texto: 'Para volver a entrar vas a necesitar el nombre de tu agenda y tu PIN.', si: 'Cerrar sesión' })) salir(); };

  // Color (vista previa en vivo; se guarda con "Guardar ajustes")
  let color = c.color || null;
  const marcar = () => $$('.color-op[data-color]').forEach((b) => b.setAttribute('aria-checked', String((color || COLOR_BASE).toLowerCase() === b.dataset.color)));
  marcar();
  $$('.color-op[data-color]').forEach((b) => b.onclick = () => { color = b.dataset.color === COLOR_BASE ? null : b.dataset.color; $('#p-color').value = b.dataset.color; aplicarColor(color); marcar(); });
  $('#p-color').addEventListener('input', (e) => { color = e.target.value.toLowerCase() === COLOR_BASE ? null : e.target.value.toLowerCase(); aplicarColor(color); marcar(); });

  // Logo (se guarda al momento)
  $('#p-logo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!TIPOS_LOGO[f.type]) return toast('El logo tiene que ser una imagen PNG, JPG o WEBP.', 'error');
    if (f.size > 2 * 1024 * 1024) return toast('La imagen pesa más de 2 MB. Elige una más liviana.', 'error');
    const lbl = $('label[for=p-logo]'); lbl.classList.add('cargando-btn'); lbl.textContent = 'Subiendo…';
    try {
      const path = `${P.pro.id}/logo-${Date.now()}.${TIPOS_LOGO[f.type]}`;
      const up = await sb.storage.from(BUCKET_LOGOS).upload(path, f, { contentType: f.type, cacheControl: '3600', upsert: false });
      if (up.error) throw up.error;
      const viejo = P.pro.logo_path;
      const r = await sb.from('profesionales').update({ logo_path: path }).eq('id', P.pro.id).select('*').single();
      if (r.error) { await sb.storage.from(BUCKET_LOGOS).remove([path]); throw r.error; }
      P.pro = { ...P.pro, logo_path: r.data.logo_path };
      if (viejo && viejo !== path) await sb.storage.from(BUCKET_LOGOS).remove([viejo]);
      toast('Logo actualizado.');
      pintarLogo();
    } catch (err) { toast(mensajeError(err), 'error'); lbl.textContent = 'Subir logo'; lbl.classList.remove('cargando-btn'); }
  });
  const pintarLogo = () => {
    $('#p-logo-vista').innerHTML = logoHTML(P.pro, 96);
    $('.barra-panel .logo')?.replaceWith(document.createRange().createContextualFragment(logoHTML(P.pro, 44)));
    const acc = $('.perfil-logo-acciones');
    $('label[for=p-logo]', acc).textContent = P.pro.logo_path ? 'Cambiar logo' : 'Subir logo';
    $('label[for=p-logo]', acc).classList.remove('cargando-btn');
    $('#p-quitar-logo')?.remove();
    if (P.pro.logo_path) { $('#p-logo', acc).insertAdjacentHTML('afterend', '<button type="button" class="btn btn-texto-peligro btn-compacto" id="p-quitar-logo">Quitar</button>'); $('#p-quitar-logo').onclick = quitarLogo; }
  };
  const quitarLogo = async () => {
    if (!await confirmar({ titulo: '¿Quitar tu logo?', texto: 'Tu página mostrará tus iniciales en su lugar.', si: 'Quitar', peligro: true })) return;
    const viejo = P.pro.logo_path;
    const r = await sb.from('profesionales').update({ logo_path: null }).eq('id', P.pro.id).select('*').single();
    if (r.error) return toast(mensajeError(r.error), 'error');
    P.pro = { ...P.pro, logo_path: null };
    if (viejo) await sb.storage.from(BUCKET_LOGOS).remove([viejo]);
    toast('Logo quitado.'); pintarLogo();
  };
  if ($('#p-quitar-logo')) $('#p-quitar-logo').onclick = quitarLogo;

  const sigue = vigente();
  // Horarios
  const fijo = () => $('input[name=h-modo]:checked')?.value === 'fijo';
  let hs;
  try { P.horarios = null; hs = await cargarHorarios(); } catch (e) { if (sigue()) $('#h-cont').innerHTML = `<p class="vacio">${esc(mensajeError(e))}</p>`; return; }
  if (!sigue()) return;
  $('#h-cont').innerHTML = orden.map((d) => { const h = hs.find((x) => x.dia === d); return `
    <div class="fila-horario" data-dia="${d}">
      <label class="interruptor"><input type="checkbox" class="h-trabaja" ${h.trabaja ? 'checked' : ''}><span>${capitalizar(DIAS[d])}</span></label>
      <div class="horas-rango"${h.trabaja && !fijo() ? '' : ' hidden'}>
        <input type="time" class="h-ini" value="${hora5(h.inicio)}" step="900" aria-label="Desde">
        <span>a</span>
        <input type="time" class="h-fin" value="${hora5(h.fin)}" step="900" aria-label="Hasta"></div>
      <div class="horas-fijas"${h.trabaja && fijo() ? '' : ' hidden'}>
        <div class="chips-horas">${chipsHoras((h.horas_fijas || []).map(hora5))}</div>
        <div class="hf-agregar"><input type="time" class="hf-nueva" step="300" aria-label="Agregar hora de inicio (${DIAS[d]})"><button type="button" class="btn btn-secundario btn-compacto hf-mas">Agregar</button>
        <button type="button" class="btn btn-texto btn-compacto hf-copiar">Copiar a los demás días</button></div>
      </div>
      <span class="texto-suave h-cerrado"${h.trabaja ? ' hidden' : ''}>No atiendo</span>
    </div>`; }).join('');
  const visibilidad = () => {
    $('#h-modo-ayuda').textContent = fijo() ? 'Tus clientas sólo pueden elegir estas horas de inicio. Si un turno se pisa con otro, ese horario se bloquea solo.'
      : 'Tus clientas eligen entre la hora de inicio y la de fin, cada tantos minutos (lo eliges en “Turnos”).';
    $$('.fila-horario').forEach((f) => {
      const t = $('.h-trabaja', f).checked;
      $('.horas-rango', f).hidden = !t || fijo(); $('.horas-fijas', f).hidden = !t || !fijo(); $('.h-cerrado', f).hidden = t;
    });
  };
  const horasDe = (f) => $$('.chip-hora', f).map((x) => x.dataset.h);
  const enlazarChips = (f) => $$('.chip-hora button', f).forEach((x) => x.onclick = () => { x.closest('.chip-hora').remove(); });
  $$('.fila-horario').forEach((f) => {
    $('.h-trabaja', f).addEventListener('change', visibilidad);
    enlazarChips(f);
    const agregar = () => {
      const v = $('.hf-nueva', f).value; if (!v) return toast('Elige una hora para agregar.', 'error');
      const hs2 = [...new Set([...horasDe(f), v])].sort();
      if (hs2.length > 24) return toast('Puedes cargar hasta 24 horarios por día.', 'error');
      $('.chips-horas', f).innerHTML = chipsHoras(hs2); enlazarChips(f); $('.hf-nueva', f).value = '';
    };
    $('.hf-mas', f).onclick = agregar;
    $('.hf-nueva', f).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
    $('.hf-copiar', f).onclick = () => {
      const hs2 = horasDe(f);
      $$('.fila-horario').forEach((g) => { if (g !== f && $('.h-trabaja', g).checked) { $('.chips-horas', g).innerHTML = chipsHoras(hs2); enlazarChips(g); } });
      toast('Copiado a los días que atiendes.');
    };
  });
  $$('input[name=h-modo]').forEach((x) => x.addEventListener('change', visibilidad));
  visibilidad();
  pintarServicios();
  if (param === 'servicios') $('#sec-servicios').scrollIntoView({ block: 'start' });

  $('#guardar-ajustes').addEventListener('click', async (ev) => {
    const err = $('#p-error'); err.hidden = true;
    const falla = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    const nombre = $('#p-nombre').value.trim();
    const wa = $('#p-wa').value.replace(/\D/g, '').replace(/^0/, '');
    const ig = $('#p-ig').value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    if (!nombre) return falla('Escribe el nombre de tu marca.');
    if (wa && !/^[0-9]{8,15}$/.test(wa)) return falla('Revisa el número de WhatsApp.');
    if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return falla('Revisa tu usuario de Instagram.');
    const alias = $('#p-alias').value.trim().replace(/\s+/g, ''), senaPct = Number($('#p-sena').value);
    if (alias && !/^[A-Za-z0-9._-]{3,60}$/.test(alias)) return falla('Revisa el alias: sólo letras, números, puntos o guiones.');
    const modo = fijo() ? 'fijo' : 'rango';
    const filas = $$('.fila-horario').map((f) => ({ dia: Number(f.dataset.dia), trabaja: $('.h-trabaja', f).checked, inicio: $('.h-ini', f).value, fin: $('.h-fin', f).value, horas_fijas: horasDe(f) }));
    if (modo === 'fijo') {
      const vacia = filas.find((h) => h.trabaja && !h.horas_fijas.length);
      if (vacia) return falla(`Agrega al menos un horario para el ${DIAS[vacia.dia]}, o márcalo como día que no atiendes.`);
    }
    const mala = modo === 'rango' && filas.find((h) => h.trabaja && (!h.inicio || !h.fin || h.fin <= h.inicio));
    if (mala) return falla(`Revisa el horario del ${DIAS[mala.dia]}: la hora de fin tiene que ser posterior a la de inicio.`);
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await sb.from('profesionales').update({ nombre, whatsapp: wa || null, instagram: ig || null, zona: $('#p-zona').value.trim() || null, color,
        intervalo_min: Number($('#c-int').value), dias_reserva: Number($('#c-dias').value),
        sena_pct: senaPct, alias_pago: alias || null, modo_horario: modo }).eq('id', P.pro.id).select('*').single();
      if (r.error) throw r.error;
      P.pro = r.data; colorPanel();
      for (const h of filas) {
        const fila = { trabaja: h.trabaja, horas_fijas: h.horas_fijas };
        if (h.inicio && h.fin && h.fin > h.inicio) { fila.inicio = h.inicio; fila.fin = h.fin; }
        const r2 = await sb.from('pro_horarios').update(fila).eq('profesional_id', P.pro.id).eq('dia', h.dia);
        if (r2.error) throw r2.error;
      }
      P.horarios = null;
      $('.barra-panel-textos strong').textContent = P.pro.nombre;
      toast('Ajustes guardados.');
    } catch (e) { falla(mensajeError(e)); } finally { b.disabled = false; b.textContent = 'Guardar ajustes'; }
  });
}

function chipsHoras(hs) {
  return hs.length ? hs.map((t) => `<span class="chip-hora" data-h="${t}">${t}<button type="button" aria-label="Quitar ${t}">×</button></span>`).join('')
    : '<span class="texto-suave">Sin horarios cargados</span>';
}

async function pintarServicios() {
  const ul = $('#lista-srv'); if (!ul) return;
  const { data, error } = await sb.from('pro_servicios').select('*').eq('profesional_id', P.pro.id).order('activo', { ascending: false }).order('created_at');
  if (!$('#lista-srv')) return;
  if (error) { ul.innerHTML = `<li class="vacio">${esc(mensajeError(error))}</li>`; return; }
  P.servicios = data;
  ul.innerHTML = data.length ? data.map((s) => `<li><button type="button" class="fila-servicio${s.activo ? '' : ' inactivo'}" data-id="${s.id}">
      <span class="miniatura${s.fotos?.length ? ' miniatura-foto' : ''}" aria-hidden="true">${s.fotos?.length ? `<img src="${esc(urlFoto(s.fotos[0]))}" alt="" loading="lazy">` : iconoServicio(s.nombre)}</span>
      <div class="fila-servicio-info"><strong>${esc(s.nombre)}</strong><small>${s.es_extra ? '<b>Extra</b> · ' : ''}${s.combo_ids?.length ? '<b>Combo</b> · ' : ''}${s.proximamente ? '<b>Próximamente</b> · ' : ''}${duracionTexto(s.duracion_min)}${s.fotos?.length ? ` · ${s.fotos.length} ${s.fotos.length > 1 ? 'fotos' : 'foto'}` : ''}${s.activo ? '' : ' · <b>Oculto</b>'}</small></div>
      <span class="fila-servicio-precio${s.precio == null ? ' sin-precio' : ''}">${s.precio == null ? 'Sin precio' : pesos(s.precio)}</span>${icono('lapiz', 'editar')}</button></li>`).join('')
    : '<li class="vacio">Todavía no cargaste servicios. Agrega al menos uno para que tus clientas puedan reservar.</li>';
  $$('#lista-srv .fila-servicio').forEach((b) => b.onclick = () => editarServicio(data.find((s) => s.id === b.dataset.id)));
}

// ---------------- Router ----------------
const VISTAS = { agenda: vistaAgenda, proximos: vistaProximos, nuevo: vistaNuevo, ajustes: vistaAjustes };
let generacion = 0;
/** Devuelve una función que dice si la vista sigue siendo la actual (evita pintar vistas viejas). */
const vigente = () => { const g = ++generacion; return () => g === generacion; };
function router() {
  if (app.hidden || !P.pro) return;
  // Si se salió de Ajustes sin guardar, se restaura su color.
  if (!/^#\/ajustes/.test(location.hash)) colorPanel();
  const [, ruta, param] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/) || [];
  const vista = VISTAS[ruta] ? ruta : 'agenda';
  $$('.nav-inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.nav === vista));
  document.body.dataset.vista = vista;
  VISTAS[vista](param);
  main.focus({ preventScroll: true }); scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !app.hidden) actualizarBadge(); });
// Mensajes del service worker: llegó un pedido (actualizar el contador) o abrir Próximos al tocar la notificación.
navigator.serviceWorker?.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.tipo === 'pedido' && !app.hidden && P.pro) { actualizarBadge(); if (/^#\/(agenda|proximos)/.test(location.hash) || !location.hash) router(); }
  if (m.tipo === 'ir' && typeof m.url === 'string' && new URL(m.url, location.href).origin === location.origin) location.href = m.url;
});

registrarSW();
iniciarAcceso();
