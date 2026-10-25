// Panel de cada manicurista (versión PRO): registro, agenda del día, próximos, turno manual y ajustes.
import {
  sb, $, $$, esc, pesos, precioTexto, icono, iconoServicio, parsePesos, pesosInput, hoyAR, sumarDias, parseFecha, fechaISO, diaSemana, DIAS, MESES,
  fechaLarga, fechaCorta, fechaRelativa, capitalizar, duracionTexto, hora5, linkWhatsApp, toast, confirmar, abrirHoja,
  mensajeError, registrarSW, logoHTML, aplicarColor, COLOR_BASE, horariosLibres, normalizarTelefono,
} from './comun.js';
import { BUCKET_LOGOS } from './config.js';

const acceso = $('#acceso'), app = $('#app'), main = $('#contenido');
const P = { pro: null, user: null, mesAgenda: hoyAR().slice(0, 7), diaAgenda: hoyAR() };
const ESTADOS = { pendiente: 'Por confirmar', aprobado: 'Confirmado', rechazado: 'Rechazado', cancelado: 'Cancelado' };

// ---------------- Acceso ----------------
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const linkPublico = (slug) => new URL(`r/?m=${encodeURIComponent(slug)}`, location.href.split('#')[0]).href;
const aSlug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 30).replace(/-+$/, '');

function pantallaAcceso(html, { titulo = '¡Bienvenida!', sub = 'Tu agenda de turnos online', pie = true } = {}) {
  app.hidden = true; acceso.hidden = false; aplicarColor(null);
  acceso.innerHTML = `<div class="splash-contenido">
    <img src="icons/icono-pro.svg" alt="" class="logo" width="112" height="112">
    <h1 class="splash-titulo">${esc(titulo)}</h1>
    <p class="splash-sub">${esc(sub)}</p>
    <div class="splash-form"><span class="splash-icono" aria-hidden="true">${icono('usuario')}</span>${html}</div>
    ${pie ? '<p class="splash-pie"><a href="./">¿Qué es Agenda Nail?</a></p>' : ''}</div>`;
}

/** Campos nombre + link, con chequeo de disponibilidad. Devuelve () => {nombre, slug} | null */
function camposAgenda(prefijo, { nombre = '', slug = '' } = {}) {
  return `<div class="campo"><label for="${prefijo}-nombre">Nombre de tu marca</label>
      <input id="${prefijo}-nombre" maxlength="60" required value="${esc(nombre)}" placeholder="Ej.: Sofi Nails"></div>
    <div class="campo"><label for="${prefijo}-slug">Tu link</label>
      <div class="input-slug"><span>…/r/?m=</span><input id="${prefijo}-slug" maxlength="30" required autocapitalize="none" autocomplete="off" spellcheck="false" value="${esc(slug)}" placeholder="sofi-nails"></div>
      <p class="ayuda" id="${prefijo}-slug-ayuda">Minúsculas, números y guiones. Es el link que vas a compartir.</p></div>`;
}
function enlazarCamposAgenda(prefijo) {
  const n = $(`#${prefijo}-nombre`), sl = $(`#${prefijo}-slug`), ay = $(`#${prefijo}-slug-ayuda`);
  let tocado = !!sl.value, t = 0;
  const revisar = () => {
    clearTimeout(t);
    const v = sl.value;
    if (!v) { ay.textContent = 'Minúsculas, números y guiones. Es el link que vas a compartir.'; ay.className = 'ayuda'; return; }
    if (!SLUG_RE.test(v) || v.includes('--')) { ay.textContent = 'Usa de 3 a 30 letras minúsculas, números o guiones (sin empezar ni terminar con guion).'; ay.className = 'ayuda ayuda-error'; return; }
    ay.textContent = 'Revisando…'; ay.className = 'ayuda';
    t = setTimeout(async () => {
      const { data, error } = await sb.rpc('pro_slug_disponible', { p_slug: v });
      if (sl.value !== v) return;
      if (error) { ay.textContent = ''; return; }
      ay.textContent = data ? '✓ Disponible' : 'Ese link ya está en uso o no se puede usar. Prueba con otro.';
      ay.className = data ? 'ayuda ayuda-ok' : 'ayuda ayuda-error';
    }, 350);
  };
  n.addEventListener('input', () => { if (!tocado) { sl.value = aSlug(n.value); revisar(); } });
  sl.addEventListener('input', () => { tocado = true; const v = aSlug(sl.value.replace(/\s/g, '-')); if (v !== sl.value && !sl.value.endsWith('-')) sl.value = v; revisar(); });
  if (sl.value) revisar();
  return () => {
    const nombre = n.value.trim(), slug = sl.value.trim().replace(/-+$/, '');
    if (!nombre) return { error: 'Escribe el nombre de tu marca.' };
    if (!SLUG_RE.test(slug) || slug.includes('--')) return { error: 'Revisa tu link: de 3 a 30 letras minúsculas, números o guiones.' };
    return { nombre, slug };
  };
}

function formCuenta({ modo }) {
  const registro = modo === 'registro';
  pantallaAcceso(`
    <h2 class="acceso-titulo">${registro ? 'Crea tu agenda' : 'Ingresar'}</h2>
    <p class="acceso-sub">${registro ? 'Regístrate gratis. Revisamos tu cuenta y te avisamos cuando tu agenda esté activa.' : 'Entra para ver y confirmar tus turnos.'}</p>
    <form id="f-acceso" novalidate>
      ${registro ? camposAgenda('r') : ''}
      <div class="campo"><label for="a-email">Correo electrónico</label>
        <input id="a-email" type="email" autocomplete="email" required maxlength="120" placeholder="tu@correo.com"></div>
      <div class="campo"><label for="a-pass">Contraseña</label>
        <input id="a-pass" type="password" autocomplete="${registro ? 'new-password' : 'current-password'}" required minlength="8" maxlength="72" placeholder="${registro ? 'Mínimo 8 caracteres' : ''}"></div>
      ${registro ? `<div class="campo"><label for="a-pass2">Repite la contraseña</label>
        <input id="a-pass2" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></div>` : ''}
      <p id="a-error" class="form-error-general" role="alert" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit">${registro ? 'Crear mi cuenta' : 'Ingresar'}</button>
    </form>
    <div class="separador" aria-hidden="true">✦</div>
    ${registro ? '<button class="btn-chico" id="a-cambiar">Ya tengo cuenta, quiero ingresar</button>'
    : '<button class="btn-chico" id="a-olvide">Olvidé mi contraseña</button><button class="btn-chico" id="a-cambiar">Todavía no tengo cuenta, quiero registrarme</button>'}`,
  { titulo: registro ? 'Tu agenda de turnos' : '¡Hola de nuevo!' });
  const datosAgenda = registro ? enlazarCamposAgenda('r') : null;
  const err = (m) => { const e = $('#a-error'); e.textContent = m; e.hidden = !m; };
  $('#a-cambiar')?.addEventListener('click', () => formCuenta({ modo: registro ? 'login' : 'registro' }));
  $('#a-olvide')?.addEventListener('click', olvideContrasena);
  $('#f-acceso').addEventListener('submit', async (ev) => {
    ev.preventDefault(); err('');
    const email = $('#a-email').value.trim(), pass = $('#a-pass').value;
    let agenda = null;
    if (registro) { agenda = datosAgenda(); if (agenda.error) return err(agenda.error); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Escribe un correo válido.');
    if (pass.length < 8) return err('La contraseña debe tener al menos 8 caracteres.');
    if (registro && pass !== $('#a-pass2').value) return err('Las contraseñas no coinciden.');
    const b = ev.submitter || $('#f-acceso button[type=submit]'); b.disabled = true;
    try {
      if (registro) {
        const { data: libre } = await sb.rpc('pro_slug_disponible', { p_slug: agenda.slug });
        if (libre === false) throw new Error('SLUG_EN_USO');
        const { data, error } = await sb.auth.signUp({ email, password: pass,
          options: { emailRedirectTo: location.href.split('#')[0], data: { pro_nombre: agenda.nombre, pro_slug: agenda.slug } } });
        if (error) throw error;
        if (!data.session) {
          pantallaAcceso(`<h2 class="acceso-titulo">Revisa tu correo</h2>
            <p>Te enviamos un enlace a <b>${esc(email)}</b> para confirmar tu cuenta. Ábrelo y después vuelve a esta página para entrar.</p>
            <p class="texto-suave">Si no lo ves, busca en la carpeta de spam o promociones.</p>
            <button class="btn btn-primario btn-grande" id="a-ir-login">Ya confirmé, quiero ingresar</button>`);
          $('#a-ir-login').onclick = () => formCuenta({ modo: 'login' });
          return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
      await entrar();
    } catch (e) {
      const m = String(e?.message || '');
      if (/Invalid login credentials/i.test(m)) err('Correo o contraseña incorrectos.');
      else if (/Email not confirmed/i.test(m)) err('Todavía no confirmaste tu correo. Revisa tu bandeja de entrada.');
      else if (/already registered|already been registered/i.test(m)) err('Ese correo ya tiene cuenta. Entra con tu contraseña.');
      else if (/rate limit/i.test(m)) err('Demasiados intentos. Espera unos minutos e intenta de nuevo.');
      else if (/SLUG_/.test(m)) err(mensajeError(e));
      else if (/weak|password/i.test(m)) err('La contraseña es muy débil. Usa una más larga o con números.');
      else err(mensajeError(e));
    } finally { b.disabled = false; }
  });
}

async function olvideContrasena() {
  const email = ($('#a-email')?.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Escribe tu correo arriba y vuelve a tocar “Olvidé mi contraseña”.', 'aviso'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  if (error) toast(mensajeError(error), 'error');
  else toast('Si el correo tiene cuenta, te llegará un enlace para cambiar la contraseña.');
}

function formNuevaContrasena() {
  pantallaAcceso(`<h2 class="acceso-titulo">Nueva contraseña</h2>
    <form id="f-nueva" novalidate>
      <div class="campo"><label for="n-pass">Contraseña nueva</label><input id="n-pass" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
      <button class="btn btn-primario btn-grande" type="submit">Guardar</button></form>`);
  $('#f-nueva').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = $('#n-pass').value;
    if (p.length < 8) return toast('Mínimo 8 caracteres.', 'error');
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return toast(mensajeError(error), 'error');
    toast('Contraseña actualizada.'); entrar();
  });
}

/** La cuenta existe pero todavía no tiene agenda (p. ej. el link elegido ya se usó). */
function formCompletarRegistro(user, aviso = '') {
  const md = user?.user_metadata || {};
  pantallaAcceso(`<h2 class="acceso-titulo">Completa tu registro</h2>
    <p class="acceso-sub">Elige el nombre de tu marca y tu link.</p>
    <form id="f-completar" novalidate>${camposAgenda('c', { nombre: md.pro_nombre || '', slug: md.pro_slug || '' })}
      <p id="c-error" class="form-error-general" role="alert"${aviso ? '' : ' hidden'}>${esc(aviso)}</p>
      <button class="btn btn-primario btn-grande" type="submit">Crear mi agenda</button></form>
    <div class="separador" aria-hidden="true">✦</div><button class="btn-chico" id="a-salir">Salir</button>`, { pie: false });
  const datos = enlazarCamposAgenda('c');
  $('#a-salir').onclick = salir;
  $('#f-completar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = $('#c-error'), d = datos();
    if (d.error) { e.textContent = d.error; e.hidden = false; return; }
    ev.submitter.disabled = true;
    const { error } = await sb.rpc('pro_registrar', { p_nombre: d.nombre, p_slug: d.slug });
    ev.submitter.disabled = false;
    if (error) { e.textContent = mensajeError(error); e.hidden = false; return; }
    entrar();
  });
}

function pantallaEstado(estado, email) {
  const pendiente = estado === 'pendiente';
  pantallaAcceso(`<h2 class="acceso-titulo">${pendiente ? '¡Gracias por registrarte!' : 'Tu agenda está pausada'}</h2>
    <p>${pendiente ? 'Tu cuenta está en revisión, te avisamos cuando esté activa.' : 'Por ahora tu agenda no recibe reservas. Escríbenos para reactivarla.'}</p>
    <p class="texto-suave">Cuenta: ${esc(email || '')}</p>
    <button class="btn btn-primario btn-grande" id="a-recargar">Actualizar</button>
    <div class="separador" aria-hidden="true">✦</div><button class="btn-chico" id="a-salir">Salir</button>`,
  { titulo: P.pro?.nombre || '¡Gracias!', sub: pendiente ? 'Ya casi está lista' : 'Agenda en pausa', pie: false });
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
  if (!user) return formCuenta({ modo: 'login' });
  P.user = user;
  try {
    let pro = await cargarPerfil(user.id);
    if (!pro) {
      const md = user.user_metadata || {};
      if (!md.pro_nombre || !md.pro_slug) return formCompletarRegistro(user);
      const { error } = await sb.rpc('pro_registrar', { p_nombre: md.pro_nombre, p_slug: md.pro_slug });
      if (error) return formCompletarRegistro(user, mensajeError(error));
      pro = await cargarPerfil(user.id);
      if (!pro) return formCompletarRegistro(user);
    }
    if (pro.estado !== 'activa') return pantallaEstado(pro.estado, user.email);
  } catch (e) {
    toast(mensajeError(e), 'error');
    return formCuenta({ modo: 'login' });
  }
  acceso.hidden = true; app.hidden = false;
  aplicarColor(P.pro.color);
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/agenda');
  actualizarBadge();
  router();
}

async function salir() {
  await sb.auth.signOut();
  P.pro = null; P.user = null;
  history.replaceState(null, '', location.pathname);
  iniciarAcceso();
}

async function iniciarAcceso() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return entrar();
  formCuenta({ modo: new URLSearchParams(location.search).has('registro') ? 'registro' : 'login' });
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
    ${t.clienta_telefono ? `<a class="enlace-tel" href="tel:${esc(t.clienta_telefono)}">${esc(t.clienta_telefono)}</a>` : ''}
    ${t.notas ? `<p class="pedido-notas">“${esc(t.notas)}”</p>` : ''}
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
    <div class="barra-panel-textos"><strong>${esc(P.pro?.nombre || '')}</strong><span>Tu agenda de turnos</span></div>
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
  cont.addEventListener('click', async (e) => {
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
    <div class="contadores" id="contadores"></div>
    <div id="dia" class="lista-pedidos"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>
    <a class="btn-agregar-dia" href="#/nuevo/${sel}">${icono('mas')}Agregar turno este día</a>`;
  enlazarCabecera();
  const ir = (f) => { P.diaAgenda = f; vistaAgenda(); };
  $('#dia-ant').onclick = () => ir(sumarDias(sel, -1));
  $('#dia-sig').onclick = () => ir(sumarDias(sel, 1));
  $('#ir-hoy')?.addEventListener('click', () => ir(hoy));
  const sigue = vigente();
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
    const libres = horariosLibres({ fecha: f, horario: hs.find((x) => x.dia === diaSemana(f)), intervalo: P.pro.intervalo_min, duracion: srv.duracion_min,
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

function editarServicio(s) {
  const nuevo = !s;
  const { capa, cerrar } = abrirHoja(nuevo ? 'Nuevo servicio' : 'Editar servicio', `
    <form id="f-srv" novalidate>
      <div class="campo"><label for="s-nombre">Nombre</label><input id="s-nombre" maxlength="80" required value="${esc(s?.nombre || '')}" placeholder="Ej.: Semipermanente"></div>
      <div class="fila-2">
        <div class="campo"><label for="s-precio">Precio (opcional)</label><div class="input-pesos"><span>$</span><input id="s-precio" inputmode="numeric" value="${pesosInput(s?.precio ?? '')}" placeholder="15.000"></div></div>
        <div class="campo"><label for="s-dur">Duración</label><select id="s-dur">${[15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240].map((d) => `<option value="${d}" ${(s?.duracion_min || 60) === d ? 'selected' : ''}>${duracionTexto(d)}</option>`).join('')}</select></div>
      </div>
      <p class="ayuda" style="margin:-6px 0 12px">Si dejas el precio vacío, tus clientas verán “Consultar precio”.</p>
      ${nuevo ? '' : `<label class="interruptor"><input type="checkbox" id="s-activo" ${s.activo ? 'checked' : ''}><span>Visible para reservar</span></label>`}
      <p id="s-error" class="form-error-general" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit">Guardar</button>
    </form>`);
  const precio = $('#s-precio', capa);
  precio.addEventListener('input', () => { const n = parsePesos(precio.value); precio.value = n === null ? '' : pesosInput(n); });
  $('#f-srv', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = $('#s-nombre', capa).value.trim(), p = parsePesos(precio.value);
    const err = $('#s-error', capa);
    if (!nombre) { err.textContent = 'Escribe el nombre del servicio.'; err.hidden = false; return; }
    const fila = { nombre, precio: p, duracion_min: Number($('#s-dur', capa).value) };
    if (!nuevo) fila.activo = $('#s-activo', capa).checked;
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
    <section class="tarjeta" id="sec-horarios">
      <div class="tarjeta-titulo"><h2>Horarios de atención</h2></div>
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
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Tu cuenta</h2></div>
      <p class="texto-suave">Sesión: ${esc(P.user?.email || '')}</p>
      <button type="button" class="btn btn-texto-peligro" id="cerrar-sesion">Cerrar sesión</button>
    </section>
    <p class="pie">Agenda Nail · ${esc(c.nombre)}</p>`;
  enlazarCabecera();
  $('#p-copiar').onclick = () => copiarLink(link, $('#p-link'));
  $('#p-compartir').onclick = () => compartirLink(link);
  $('#nuevo-srv').onclick = () => editarServicio(null);
  $('#cerrar-sesion').onclick = async () => { if (await confirmar({ titulo: '¿Cerrar sesión?', texto: 'Vas a tener que ingresar de nuevo con tu correo y contraseña.', si: 'Cerrar sesión' })) salir(); };

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
  let hs;
  try { P.horarios = null; hs = await cargarHorarios(); } catch (e) { if (sigue()) $('#h-cont').innerHTML = `<p class="vacio">${esc(mensajeError(e))}</p>`; return; }
  if (!sigue()) return;
  $('#h-cont').innerHTML = orden.map((d) => { const h = hs.find((x) => x.dia === d); return `
    <div class="fila-horario" data-dia="${d}">
      <label class="interruptor"><input type="checkbox" class="h-trabaja" ${h.trabaja ? 'checked' : ''}><span>${capitalizar(DIAS[d])}</span></label>
      <div class="horas-rango"${h.trabaja ? '' : ' hidden'}>
        <input type="time" class="h-ini" value="${hora5(h.inicio)}" step="900" aria-label="Desde">
        <span>a</span>
        <input type="time" class="h-fin" value="${hora5(h.fin)}" step="900" aria-label="Hasta"></div>
      <span class="texto-suave h-cerrado"${h.trabaja ? ' hidden' : ''}>No atiendo</span>
    </div>`; }).join('');
  $$('.fila-horario').forEach((f) => $('.h-trabaja', f).addEventListener('change', (e) => {
    $('.horas-rango', f).hidden = !e.target.checked; $('.h-cerrado', f).hidden = e.target.checked;
  }));
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
    const filas = $$('.fila-horario').map((f) => ({ dia: Number(f.dataset.dia), trabaja: $('.h-trabaja', f).checked, inicio: $('.h-ini', f).value, fin: $('.h-fin', f).value }));
    const mala = filas.find((h) => h.trabaja && (!h.inicio || !h.fin || h.fin <= h.inicio));
    if (mala) return falla(`Revisa el horario del ${DIAS[mala.dia]}: la hora de fin tiene que ser posterior a la de inicio.`);
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await sb.from('profesionales').update({ nombre, whatsapp: wa || null, instagram: ig || null, zona: $('#p-zona').value.trim() || null, color,
        intervalo_min: Number($('#c-int').value), dias_reserva: Number($('#c-dias').value) }).eq('id', P.pro.id).select('*').single();
      if (r.error) throw r.error;
      P.pro = r.data; aplicarColor(P.pro.color);
      for (const h of filas) {
        const fila = { trabaja: h.trabaja };
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

async function pintarServicios() {
  const ul = $('#lista-srv'); if (!ul) return;
  const { data, error } = await sb.from('pro_servicios').select('*').eq('profesional_id', P.pro.id).order('activo', { ascending: false }).order('created_at');
  if (!$('#lista-srv')) return;
  if (error) { ul.innerHTML = `<li class="vacio">${esc(mensajeError(error))}</li>`; return; }
  ul.innerHTML = data.length ? data.map((s) => `<li><button type="button" class="fila-servicio${s.activo ? '' : ' inactivo'}" data-id="${s.id}">
      <span class="miniatura" aria-hidden="true">${iconoServicio(s.nombre)}</span>
      <div class="fila-servicio-info"><strong>${esc(s.nombre)}</strong><small>${duracionTexto(s.duracion_min)}${s.activo ? '' : ' · <b>Oculto</b>'}</small></div>
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
  if (!/^#\/ajustes/.test(location.hash)) aplicarColor(P.pro.color);
  const [, ruta, param] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/) || [];
  const vista = VISTAS[ruta] ? ruta : 'agenda';
  $$('.nav-inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.nav === vista));
  document.body.dataset.vista = vista;
  VISTAS[vista](param);
  main.focus({ preventScroll: true }); scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !app.hidden) actualizarBadge(); });

sb.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') setTimeout(formNuevaContrasena, 0);
});

registrarSW();
iniciarAcceso();
