// Gestión privada (sólo superadmin): clientas y agendas. El acceso real lo controlan RLS y las funciones pro_admin_*.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET_LOGOS } from '../pro/js/config.js';
import { $, $$, esc, icono, toast, confirmar, abrirHoja, mensajeError, logoHTML, linkWhatsApp, hoyAR } from '../pro/js/comun.js?v=p4';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'agenda-nail-gestion-auth' },
});
const acceso = $('#acceso'), app = $('#app'), main = $('#contenido');
const G = { tab: 'clientas', agendas: [], clientas: [], email: '' };
const ESTADO_AGENDA = { pendiente: 'Pendiente', activa: 'Activa', pausada: 'Pausada' };
const ESTADO_CLIENTA = { activa: 'Activa', pausada: 'Pausada', prueba: 'Prueba' };
const TIPOS_LOGO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BASE_PRO = new URL('../pro/', location.href).href;
const linkAgenda = (slug) => `${BASE_PRO}r/?m=${encodeURIComponent(slug)}`;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

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

function pantalla(html) {
  app.hidden = true; acceso.hidden = false;
  acceso.innerHTML = `<div class="splash-contenido"><h1 class="splash-titulo">Gestión</h1><p class="splash-sub">Acceso privado</p>
    <div class="splash-form"><span class="splash-icono" aria-hidden="true">${icono('usuario')}</span>${html}</div></div>`;
}

function formLogin() {
  pantalla(`<form id="f-login" novalidate>
      <div class="campo"><label for="l-email">Correo</label><input id="l-email" type="email" autocomplete="email" required></div>
      <div class="campo"><label for="l-pass">Contraseña</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
      <p id="l-error" class="form-error-general" role="alert" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit">Ingresar</button></form>`);
  $('#f-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = $('#l-error'); e.hidden = true;
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = false;
    if (error) { e.textContent = /Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : mensajeError(error); e.hidden = false; return; }
    entrar();
  });
}

async function salir() { await sb.auth.signOut(); formLogin(); }

async function entrar() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return formLogin();
  G.email = user.email;
  const { data, error } = await sb.rpc('pro_admin_lista');
  if (error) {
    pantalla(`<h2 class="acceso-titulo">Sin acceso</h2><p>Esta cuenta (${esc(user.email)}) no tiene permiso para entrar aquí.</p>
      <button class="btn btn-primario btn-grande" id="g-salir">Salir</button>`);
    $('#g-salir').onclick = salir;
    return;
  }
  G.agendas = data;
  acceso.hidden = true; app.hidden = false;
  pintar();
}

function marco(contenido) {
  main.innerHTML = `<header class="cabecera"><div class="cabecera-textos"><p class="cabecera-pre">${esc(G.email)}</p><h1>Gestión</h1></div>
      <button class="btn btn-secundario btn-compacto" id="g-salir">Salir</button></header>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="clientas" aria-selected="${G.tab === 'clientas'}">Clientas</button>
      <button role="tab" data-tab="agendas" aria-selected="${G.tab === 'agendas'}">Agendas</button></div>
    <div id="g-cont">${contenido}</div>`;
  $('#g-salir').onclick = async () => { if (await confirmar({ titulo: '¿Cerrar sesión?', texto: 'Vas a tener que ingresar de nuevo.', si: 'Salir' })) salir(); };
  $$('.tabs [data-tab]').forEach((b) => b.onclick = () => { G.tab = b.dataset.tab; pintar(); });
}

let vistaTurno = 0; // evita que una vista lenta pise a la pestaña elegida después
function pintar() { return G.tab === 'clientas' ? vistaClientas() : vistaAgendas(); }

// ---------------- Clientas ----------------
const agendaDe = (c) => (c.profesional_id ? G.agendas.find((a) => a.id === c.profesional_id) : null);
async function vistaClientas() {
  const turno = ++vistaTurno;
  marco('<div class="cargando"><span class="spinner"></span> Cargando…</div>');
  await recargarAgendas();
  const { data, error } = await sb.from('admin_clientas').select('*').order('fecha_alta', { ascending: false }).order('created_at', { ascending: false });
  if (turno !== vistaTurno) return; // el usuario ya cambió de pestaña
  if (error) { $('#g-cont').innerHTML = `<p class="tarjeta vacio">${esc(mensajeError(error))}</p>`; return; }
  G.clientas = data;
  $('#g-cont').innerHTML = `<button class="btn btn-primario btn-grande" id="c-nueva">${icono('mas')}Agregar clienta</button>
    <div class="lista-gestion" style="margin-top:14px">${data.length ? data.map((c) => {
      const wa = c.whatsapp ? linkWhatsApp(c.whatsapp, `¡Hola ${c.nombre}!`) : '';
      return `<article class="tarjeta" data-id="${c.id}">
        <div class="fila-gestion"><div class="fila-gestion-info">
          <h3>${esc(c.nombre)}</h3>
          <p><span class="chip chip-${c.estado}">${ESTADO_CLIENTA[c.estado]}</span> · Alta ${esc(String(c.fecha_alta).split('-').reverse().join('/'))}</p>
          ${c.link ? `<p><a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">${esc(c.link)}</a></p>` : ''}
          ${c.whatsapp || c.instagram ? `<p>${wa ? `<a href="${wa}" target="_blank" rel="noopener">WhatsApp ${esc(c.whatsapp)}</a>` : ''}${wa && c.instagram ? ' · ' : ''}${c.instagram ? `<a href="https://www.instagram.com/${encodeURIComponent(c.instagram)}/" target="_blank" rel="noopener">@${esc(c.instagram)}</a>` : ''}</p>` : ''}
          ${c.notas ? `<p class="pedido-notas">${esc(c.notas)}</p>` : ''}
        </div></div>
        <div class="acciones-fila"><button class="btn btn-secundario btn-compacto" data-acc="editar">Editar</button>
          ${agendaDe(c) ? `<button class="btn btn-secundario btn-compacto" data-acc="pin">${agendaDe(c).tiene_pin ? 'Cambiar PIN' : 'Crear PIN'}</button>` : ''}
          <button class="btn btn-texto-peligro btn-compacto" data-acc="borrar">Eliminar</button></div></article>`;
    }).join('') : '<p class="tarjeta vacio">Todavía no hay clientas.</p>'}</div>`;
  $('#c-nueva').onclick = () => editarClienta(null);
  $('#g-cont').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const c = G.clientas.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (b.dataset.acc === 'editar') return editarClienta(c);
    if (b.dataset.acc === 'pin') return dialogoPin(agendaDe(c), vistaClientas);
    if (!await confirmar({ titulo: `¿Eliminar a ${c.nombre}?`, texto: 'Se borra sólo de esta lista de clientas (su agenda no se toca). No se puede deshacer.', si: 'Eliminar', peligro: true })) return;
    const { error: er } = await sb.from('admin_clientas').delete().eq('id', c.id);
    if (er) return toast(mensajeError(er), 'error');
    toast('Clienta eliminada.'); vistaClientas();
  });
}

function editarClienta(c) {
  const nueva = !c;
  const opcionesAgenda = G.agendas.map((a) => `<option value="${a.id}" ${c?.profesional_id === a.id ? 'selected' : ''}>${esc(a.nombre)} (${esc(a.slug)})</option>`).join('');
  const { capa, cerrar } = abrirHoja(nueva ? 'Nueva clienta' : 'Editar clienta', `<form id="f-cli" novalidate>
    <div class="campo"><label for="c-nombre">Nombre / marca</label><input id="c-nombre" maxlength="80" required value="${esc(c?.nombre || '')}"></div>
    <div class="campo"><label for="c-agenda">Agenda vinculada (opcional)</label><select id="c-agenda"><option value="">— Ninguna —</option>${opcionesAgenda}</select>
      <p class="ayuda">Si eliges una, el link se completa solo.</p></div>
    <div class="campo"><label for="c-link">Link de su agenda</label><input id="c-link" type="url" maxlength="300" value="${esc(c?.link || '')}" placeholder="https://…"></div>
    <div class="fila-2">
      <div class="campo"><label for="c-wa">WhatsApp</label><input id="c-wa" type="tel" maxlength="25" value="${esc(c?.whatsapp || '')}"></div>
      <div class="campo"><label for="c-ig">Instagram</label><input id="c-ig" maxlength="60" autocapitalize="none" value="${esc(c?.instagram || '')}"></div></div>
    <div class="fila-2">
      <div class="campo"><label for="c-estado">Estado</label><select id="c-estado">${Object.entries(ESTADO_CLIENTA).map(([k, v]) => `<option value="${k}" ${(c?.estado || 'prueba') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="campo"><label for="c-alta">Fecha de alta</label><input id="c-alta" type="date" value="${esc(c?.fecha_alta || hoyAR())}"></div></div>
    <div class="campo"><label for="c-notas">Notas (pagos, etc.)</label><textarea id="c-notas" maxlength="1000">${esc(c?.notas || '')}</textarea></div>
    <p id="c-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Guardar</button></form>`);
  $('#c-agenda', capa).addEventListener('change', (e) => {
    const a = G.agendas.find((x) => x.id === e.target.value); if (!a) return;
    $('#c-link', capa).value = linkAgenda(a.slug);
    if (!$('#c-nombre', capa).value) $('#c-nombre', capa).value = a.nombre;
    if (!$('#c-wa', capa).value && a.whatsapp) $('#c-wa', capa).value = a.whatsapp;
    if (!$('#c-ig', capa).value && a.instagram) $('#c-ig', capa).value = a.instagram;
  });
  $('#f-cli', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#c-error', capa); const falla = (m) => { err.textContent = m; err.hidden = false; };
    const fila = {
      nombre: $('#c-nombre', capa).value.trim(),
      profesional_id: $('#c-agenda', capa).value || null,
      link: $('#c-link', capa).value.trim() || null,
      whatsapp: $('#c-wa', capa).value.replace(/\D/g, '') || null,
      instagram: $('#c-ig', capa).value.trim().replace(/^@/, '') || null,
      estado: $('#c-estado', capa).value,
      fecha_alta: $('#c-alta', capa).value || hoyAR(),
      notas: $('#c-notas', capa).value.trim() || null,
    };
    if (!fila.nombre) return falla('Escribe el nombre.');
    if (fila.link && !/^https?:\/\//i.test(fila.link)) return falla('El link tiene que empezar con https://');
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = true;
    const { error } = nueva ? await sb.from('admin_clientas').insert(fila) : await sb.from('admin_clientas').update(fila).eq('id', c.id);
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = false;
    if (error) return falla(mensajeError(error));
    cerrar(); toast(nueva ? 'Clienta agregada.' : 'Cambios guardados.'); vistaClientas();
  });
}

// ---------------- Agendas ----------------
async function recargarAgendas() {
  const { data, error } = await sb.rpc('pro_admin_lista');
  if (error) { toast(mensajeError(error), 'error'); return false; }
  G.agendas = data; return true;
}

async function vistaAgendas() {
  const turno = ++vistaTurno;
  marco('<div class="cargando"><span class="spinner"></span> Cargando…</div>');
  if (!await recargarAgendas() || turno !== vistaTurno) return;
  const orden = { pendiente: 0, activa: 1, pausada: 2 };
  const lista = [...G.agendas].sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
  $('#g-cont').innerHTML = `<button class="btn btn-primario btn-grande" id="a-nueva">${icono('mas')}Crear agenda</button>
    <div class="lista-gestion" style="margin-top:14px">${lista.map((a) => `<article class="tarjeta" data-id="${a.id}">
      <div class="fila-gestion">${logoHTML(a, 52)}<div class="fila-gestion-info">
        <h3>${esc(a.nombre)}</h3>
        <p><span class="chip chip-${a.estado === 'pendiente' ? 'prueba' : a.estado}">${ESTADO_AGENDA[a.estado]}</span> · ${esc(a.slug)}</p>
        <p>Acceso: ${a.tiene_pin ? `PIN ✓ · entra con <b>${esc(a.slug)}</b>` : a.cuenta_email ? `correo ${esc(a.cuenta_email)} (sin PIN)` : '<i>sin PIN todavía</i>'}</p>
        <p>${a.servicios} servicios · ${a.pendientes} pedidos pendientes · alta ${esc(new Date(a.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }))}</p>
      </div></div>
      <div class="acciones-fila">
        <button class="btn btn-primario btn-compacto" data-acc="pin">${a.tiene_pin ? 'Cambiar PIN' : 'Crear PIN'}</button>
        ${a.estado === 'pendiente' ? '<button class="btn btn-primario btn-compacto" data-acc="activa">Activar</button>' : ''}
        ${a.estado === 'activa' ? '<button class="btn btn-secundario btn-compacto" data-acc="pausada">Pausar</button>' : ''}
        ${a.estado === 'pausada' ? '<button class="btn btn-primario btn-compacto" data-acc="activa">Reactivar</button>' : ''}
        <a class="btn btn-secundario btn-compacto" href="${esc(linkAgenda(a.slug))}" target="_blank" rel="noopener">Ver página</a>
        <label class="btn btn-secundario btn-compacto">Logo<input type="file" accept="image/png,image/jpeg,image/webp" class="oculto" data-logo></label>
        <button class="btn btn-secundario btn-compacto" data-acc="copiar">Copiar link</button>
        ${a.cuenta_email ? `<button class="btn btn-texto-peligro btn-compacto" data-acc="quitar">${a.tiene_pin ? 'Quitar acceso' : 'Quitar cuenta'}</button>` : '<button class="btn btn-secundario btn-compacto" data-acc="asignar">Asignar cuenta</button>'}
      </div></article>`).join('') || '<p class="tarjeta vacio">No hay agendas.</p>'}</div>`;
  $('#a-nueva').onclick = crearAgenda;
  const cont = $('#g-cont');
  const deTarjeta = (el) => G.agendas.find((x) => x.id === el.closest('[data-id]').dataset.id);
  cont.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-logo]')) return;
    const a = deTarjeta(e.target), f = e.target.files[0]; e.target.value = '';
    if (f) subirLogo(a, f);
  });
  cont.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const a = deTarjeta(b), acc = b.dataset.acc;
    if (acc === 'copiar') { try { await navigator.clipboard.writeText(linkAgenda(a.slug)); toast('Link copiado.'); } catch { toast(linkAgenda(a.slug)); } return; }
    if (acc === 'activa' || acc === 'pausada') {
      const t = acc === 'pausada' ? { titulo: `¿Pausar la agenda de ${a.nombre}?`, texto: 'Su página mostrará “Agenda no disponible por ahora” y no recibirá reservas. Ella no podrá usar el panel hasta que la reactives.', si: 'Pausar', peligro: true }
        : { titulo: `¿${a.estado === 'pausada' ? 'Reactivar' : 'Activar'} la agenda de ${a.nombre}?`, texto: 'Su página empezará a recibir reservas y podrá usar su panel.', si: a.estado === 'pausada' ? 'Reactivar' : 'Activar' };
      if (!await confirmar(t)) return;
      const { error } = await sb.rpc('pro_admin_estado', { p_id: a.id, p_estado: acc });
      if (error) return toast(mensajeError(error), 'error');
      toast(acc === 'pausada' ? 'Agenda pausada.' : 'Agenda activa.'); return vistaAgendas();
    }
    if (acc === 'quitar') {
      if (!await confirmar({ titulo: a.tiene_pin ? '¿Quitar el acceso con PIN?' : '¿Quitar la cuenta?', texto: `${a.tiene_pin ? 'Su PIN' : a.cuenta_email} ya no servirá para administrar la agenda de ${a.nombre}. La agenda y sus turnos se mantienen. Puedes crearle un PIN nuevo cuando quieras.`, si: 'Quitar', peligro: true })) return;
      const { error } = await sb.rpc('pro_admin_quitar_cuenta', { p_id: a.id });
      if (error) return toast(mensajeError(error), 'error');
      toast('Cuenta quitada.'); return vistaAgendas();
    }
    if (acc === 'asignar') return asignarCuenta(a);
    if (acc === 'pin') return dialogoPin(a, vistaAgendas);
  });
}

function asignarCuenta(a) {
  const { capa, cerrar } = abrirHoja(`Asignar cuenta · ${a.nombre}`, `<form id="f-asig" novalidate>
    <p class="texto-suave">Sólo para una cuenta con correo que ya exista en Supabase. Lo normal es usar “Crear PIN”.</p>
    <div class="campo"><label for="as-email">Correo de su cuenta</label><input id="as-email" type="email" required></div>
    <p id="as-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Asignar</button></form>`);
  $('#f-asig', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#as-email', capa).value.trim(), err = $('#as-error', capa);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Escribe un correo válido.'; err.hidden = false; return; }
    if (!await confirmar({ titulo: '¿Asignar la agenda?', texto: `${email} va a administrar la agenda de ${a.nombre}.`, si: 'Asignar' })) return;
    const { error } = await sb.rpc('pro_admin_asignar_cuenta', { p_id: a.id, p_email: email });
    if (error) { err.textContent = mensajeError(error); err.hidden = false; return; }
    cerrar(); toast('Cuenta asignada.'); vistaAgendas();
  });
}

function crearAgenda() {
  const { capa, cerrar } = abrirHoja('Nueva agenda', `<form id="f-crear" novalidate>
    <p class="texto-suave">Después le creas el PIN y ella entra al panel con el nombre de la agenda + ese PIN.</p>
    <div class="campo"><label for="n-slug">Nombre de la agenda (link)</label><input id="n-slug" maxlength="30" autocapitalize="none" spellcheck="false" required placeholder="sofi-nails">
      <p class="ayuda">Minúsculas, números y guiones. Es su link (…/r/?m=<b>sofi-nails</b>) y lo que escribe para entrar.</p></div>
    <div class="campo"><label for="n-nombre">Nombre / marca</label><input id="n-nombre" maxlength="60" required placeholder="Sofi Nails"></div>
    <div class="fila-2">
      <div class="campo"><label for="n-wa">WhatsApp</label><input id="n-wa" type="tel" maxlength="25" placeholder="3511234567"></div>
      <div class="campo"><label for="n-ig">Instagram</label><input id="n-ig" maxlength="31" autocapitalize="none" placeholder="@sofinails"></div></div>
    <div class="fila-2">
      <div class="campo"><label for="n-zona">Zona</label><input id="n-zona" maxlength="120" placeholder="Barrio, ciudad"></div>
      <div class="campo"><label for="n-estado">Estado</label><select id="n-estado">${Object.entries(ESTADO_AGENDA).map(([k, v]) => `<option value="${k}" ${k === 'activa' ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <p id="n-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Crear agenda</button></form>`);
  $('#f-crear', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#n-error', capa), falla = (m) => { err.textContent = m; err.hidden = false; };
    const slug = $('#n-slug', capa).value.trim().toLowerCase(), nombre = $('#n-nombre', capa).value.trim();
    const wa = $('#n-wa', capa).value.replace(/\D/g, ''), ig = $('#n-ig', capa).value.trim().replace(/^@/, '');
    if (!SLUG_RE.test(slug) || slug.includes('--')) return falla('El nombre de la agenda: de 3 a 30 minúsculas, números o guiones (sin empezar ni terminar con guion).');
    if (nombre.length < 2) return falla('Escribe el nombre o marca.');
    if (wa && !/^[0-9]{8,15}$/.test(wa)) return falla('El WhatsApp tiene que tener entre 8 y 15 números.');
    if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return falla('El Instagram sólo puede tener letras, números, puntos y guiones bajos.');
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = true;
    const { data: id, error } = await sb.rpc('pro_admin_crear_agenda', { p_slug: slug, p_nombre: nombre, p_whatsapp: wa || null,
      p_instagram: ig || null, p_zona: $('#n-zona', capa).value.trim() || null, p_estado: $('#n-estado', capa).value });
    (ev.submitter || ev.target.querySelector('[type=submit]')).disabled = false;
    if (error) return falla(mensajeError(error));
    cerrar(); toast('Agenda creada.');
    await recargarAgendas();
    const a = G.agendas.find((x) => x.id === id);
    if (G.tab === 'agendas') vistaAgendas();
    if (a && await confirmar({ titulo: '¿Crear su PIN ahora?', texto: `${a.nombre} va a entrar con “${a.slug}” y un PIN de 6 números.`, si: 'Crear PIN' })) dialogoPin(a, vistaAgendas);
  });
}

/** Crear / cambiar el PIN (6 números, dos veces). Lo guarda la Edge Function 'admin-pin'. */
function dialogoPin(a, alTerminar) {
  const cambiar = a.tiene_pin;
  const { capa, cerrar } = abrirHoja(`${cambiar ? 'Cambiar PIN' : 'Crear PIN'} · ${a.nombre}`, `<form id="f-pin" novalidate>
    <p class="texto-suave">Ella entra al panel con <b>${esc(a.slug)}</b> + este PIN.${cambiar ? ' El PIN anterior deja de funcionar y se cierran sus sesiones abiertas.' : ''}</p>
    <div class="campo"><label for="pin-1">PIN nuevo (6 números)</label><input id="pin-1" class="input-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></div>
    <div class="campo"><label for="pin-2">Repite el PIN</label><input id="pin-2" class="input-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></div>
    <label class="check-linea"><input type="checkbox" id="pin-ver"> Mostrar PIN</label>
    <p id="pin-error" class="form-error-general" role="alert" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">${cambiar ? 'Cambiar PIN' : 'Crear PIN'}</button></form>`);
  const p1 = $('#pin-1', capa), p2 = $('#pin-2', capa), err = $('#pin-error', capa);
  const falla = (m) => { err.textContent = m; err.hidden = !m; };
  [p1, p2].forEach((i) => i.addEventListener('input', () => { const v = i.value.replace(/\D/g, '').slice(0, 6); if (v !== i.value) i.value = v; falla(''); }));
  $('#pin-ver', capa).onchange = (e) => { p1.type = p2.type = e.target.checked ? 'text' : 'password'; };
  p1.focus();
  $('#f-pin', capa).addEventListener('submit', async (ev) => {
    ev.preventDefault(); falla('');
    const pin = p1.value;
    const motivo = problemaPin(pin);
    if (motivo) return falla(motivo);
    if (pin !== p2.value) return falla('Los dos PIN no coinciden.');
    if (!await confirmar({ titulo: `¿${cambiar ? 'Cambiar' : 'Crear'} el PIN de ${a.nombre}?`, texto: `Va a entrar con “${a.slug}” y el PIN que escribiste.`, si: cambiar ? 'Cambiar PIN' : 'Crear PIN' })) return;
    const b = ev.submitter || ev.target.querySelector('[type=submit]'); b.disabled = true;
    const { data, error } = await sb.functions.invoke('admin-pin', { body: { accion: 'pin', profesional_id: a.id, pin } });
    b.disabled = false;
    if (error || !data?.ok) {
      let m = 'No se pudo guardar el PIN. Intenta de nuevo.';
      try { const j = await error?.context?.json(); if (j?.mensaje) m = j.mensaje; } catch { /* respuesta sin JSON */ }
      return falla(m);
    }
    cerrar();
    toast(cambiar ? 'PIN cambiado.' : 'PIN creado.');
    avisoPin(a, pin);
    alTerminar?.();
  });
}

/** Resumen para pasarle a la manicurista (lo envía Agustin si quiere; aquí no se envía nada). */
function avisoPin(a, pin) {
  const panel = `${BASE_PRO}panel.html`;
  const texto = `¡Hola ${a.nombre}! Tu agenda ya está lista.\nEntra a ${panel}\nAgenda: ${a.slug}\nPIN: ${pin}\nTu link para clientas: ${linkAgenda(a.slug)}`;
  const wa = a.whatsapp ? linkWhatsApp(a.whatsapp, texto) : '';
  const { capa } = abrirHoja('PIN guardado', `<p>Agenda: <b>${esc(a.slug)}</b><br>PIN: <b>${esc(pin)}</b></p>
    <p class="texto-suave">Anótalo o pásaselo ahora: después no se puede volver a ver (sólo cambiarlo).</p>
    <div class="acciones-columna">
      <button class="btn btn-secundario btn-grande" id="pin-copiar">Copiar mensaje</button>
      ${wa ? `<a class="btn btn-primario btn-grande" href="${wa}" target="_blank" rel="noopener">Abrir WhatsApp con el mensaje</a>` : ''}</div>`);
  $('#pin-copiar', capa).onclick = async () => { try { await navigator.clipboard.writeText(texto); toast('Mensaje copiado.'); } catch { toast(texto); } };
}

async function subirLogo(a, f) {
  if (!TIPOS_LOGO[f.type]) return toast('El logo tiene que ser PNG, JPG o WEBP.', 'error');
  if (f.size > 2 * 1024 * 1024) return toast('La imagen pesa más de 2 MB.', 'error');
  if (!await confirmar({ titulo: `¿Cambiar el logo de ${a.nombre}?`, texto: `Archivo: ${f.name}`, si: 'Subir' })) return;
  const path = `${a.id}/logo-${Date.now()}.${TIPOS_LOGO[f.type]}`;
  const up = await sb.storage.from(BUCKET_LOGOS).upload(path, f, { contentType: f.type, cacheControl: '3600', upsert: false });
  if (up.error) return toast(mensajeError(up.error), 'error');
  const { error } = await sb.rpc('pro_admin_logo', { p_id: a.id, p_logo_path: path });
  if (error) { await sb.storage.from(BUCKET_LOGOS).remove([path]); return toast(mensajeError(error), 'error'); }
  if (a.logo_path && a.logo_path !== path) await sb.storage.from(BUCKET_LOGOS).remove([a.logo_path]);
  toast('Logo actualizado.'); vistaAgendas();
}

entrar();
