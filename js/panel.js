// Panel privado de la profesional: pedidos, agenda, servicios y horarios.
import {
  sb, $, $$, esc, pesos, parsePesos, pesosInput, hoyAR, sumarDias, parseFecha, fechaISO, diaSemana, DIAS, MESES,
  fechaLarga, fechaCorta, fechaRelativa, capitalizar, duracionTexto, hora5, linkWhatsApp, toast, confirmar, abrirHoja,
  mensajeError, registrarSW,
} from './comun.js';

const acceso = $('#acceso'), app = $('#app'), main = $('#contenido');
const P = { config: null, mesAgenda: hoyAR().slice(0, 7), diaAgenda: hoyAR() };
const ESTADOS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', cancelado: 'Cancelado' };

// ---------------- Acceso ----------------
function pantallaAcceso(html) {
  app.hidden = true; acceso.hidden = false;
  acceso.innerHTML = `<div class="splash-contenido">
    <img src="icons/icono.svg" alt="" class="splash-logo" width="88" height="88">
    <h1 class="splash-titulo">Agenda Nail</h1>
    <p class="splash-sub">Panel de la profesional</p>
    <div class="splash-form">${html}</div>
    <p class="splash-pie"><a href="./">Ver la página de reservas</a></p></div>`;
}

function formCuenta({ modo }) {
  const registro = modo === 'registro';
  pantallaAcceso(`
    <h2 class="acceso-titulo">${registro ? 'Crear tu cuenta de profesional' : 'Entrar al panel'}</h2>
    ${registro ? '<p class="texto-suave">Todavía no hay una profesional registrada. La primera cuenta que se cree será la dueña del panel.</p>' : ''}
    <form id="f-acceso" novalidate>
      <div class="campo"><label for="a-email">Correo electrónico</label>
        <input id="a-email" type="email" autocomplete="email" required maxlength="120" placeholder="tu@correo.com"></div>
      <div class="campo"><label for="a-pass">Contraseña</label>
        <input id="a-pass" type="password" autocomplete="${registro ? 'new-password' : 'current-password'}" required minlength="8" maxlength="72" placeholder="${registro ? 'Mínimo 8 caracteres' : ''}"></div>
      ${registro ? `<div class="campo"><label for="a-pass2">Repite la contraseña</label>
        <input id="a-pass2" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></div>` : ''}
      <p id="a-error" class="form-error-general" role="alert" hidden></p>
      <button class="btn btn-primario btn-grande" type="submit">${registro ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    ${registro ? '<button class="btn-chico" id="a-cambiar">Ya tengo cuenta, quiero entrar</button>'
    : '<button class="btn-chico" id="a-olvide">Olvidé mi contraseña</button>'}`);
  const err = (m) => { const e = $('#a-error'); e.textContent = m; e.hidden = !m; };
  $('#a-cambiar')?.addEventListener('click', () => formCuenta({ modo: 'login' }));
  $('#a-olvide')?.addEventListener('click', olvideContrasena);
  $('#f-acceso').addEventListener('submit', async (ev) => {
    ev.preventDefault(); err('');
    const email = $('#a-email').value.trim(), pass = $('#a-pass').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Escribe un correo válido.');
    if (pass.length < 8) return err('La contraseña debe tener al menos 8 caracteres.');
    if (registro && pass !== $('#a-pass2').value) return err('Las contraseñas no coinciden.');
    const b = ev.submitter || $('#f-acceso button[type=submit]'); b.disabled = true;
    try {
      if (registro) {
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.href.split('#')[0] } });
        if (error) throw error;
        if (!data.session) {
          pantallaAcceso(`<h2 class="acceso-titulo">Revisa tu correo</h2>
            <p>Te enviamos un enlace a <b>${esc(email)}</b> para confirmar tu cuenta. Ábrelo y después vuelve a esta página para entrar.</p>
            <p class="texto-suave">Si no lo ves, busca en la carpeta de spam o promociones.</p>
            <button class="btn btn-primario btn-grande" id="a-ir-login">Ya confirmé, quiero entrar</button>`);
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

async function entrar() {
  const { data, error } = await sb.rpc('reclamar_profesional');
  if (error) { toast(mensajeError(error), 'error'); return formCuenta({ modo: 'login' }); }
  if (!data) {
    pantallaAcceso(`<h2 class="acceso-titulo">Sin acceso</h2>
      <p>Esta cuenta no tiene permiso para usar el panel. Solo la profesional dueña de la agenda puede entrar.</p>
      <button class="btn btn-primario btn-grande" id="a-salir">Salir</button>`);
    $('#a-salir').onclick = salir;
    return;
  }
  acceso.hidden = true; app.hidden = false;
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/pedidos');
  await cargarConfig();
  actualizarBadge();
  router();
}

async function salir() {
  await sb.auth.signOut();
  location.hash = '';
  iniciarAcceso();
}

async function iniciarAcceso() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return entrar();
  const { data: hay, error } = await sb.rpc('hay_profesional');
  if (error) return pantallaAcceso(`<p class="form-error-general">${esc(mensajeError(error))}</p>`);
  formCuenta({ modo: hay ? 'login' : 'registro' });
}

// ---------------- Datos ----------------
async function cargarConfig() {
  const { data } = await sb.from('config').select('*').eq('id', 1).single();
  P.config = data;
}

async function actualizarBadge() {
  const { count, error } = await sb.from('turnos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  if (!error) pintarBadge(count);
}
function pintarBadge(count) {
  const b = $('#badge-pedidos');
  b.textContent = count > 99 ? '99+' : String(count || 0);
  b.hidden = !count;
  b.setAttribute('aria-label', `${count || 0} pedidos pendientes`);
}

async function cambiarEstado(t, estado) {
  const { error } = await sb.from('turnos').update({ estado }).eq('id', t.id);
  if (error) { toast(mensajeError(error), 'error'); return false; }
  return true;
}

function mensajeParaClienta(t, tipo) {
  const salon = P.config?.nombre_salon || 'el salón';
  const cuando = `${fechaRelativa(t.fecha)} a las ${hora5(t.hora_inicio)} h`;
  if (tipo === 'aprobado') return `¡Hola ${t.clienta_nombre}! Te confirmo tu turno de ${t.servicio_nombre} ${cuando} en ${salon}. ¡Te espero!`;
  if (tipo === 'rechazado') return `¡Hola ${t.clienta_nombre}! Te escribo de ${salon}. No puedo tomar tu turno de ${t.servicio_nombre} ${cuando}. ¿Te sirve otro horario?`;
  if (tipo === 'cancelado') return `¡Hola ${t.clienta_nombre}! Te escribo de ${salon}. Tuve que cancelar tu turno de ${t.servicio_nombre} ${cuando}. ¿Coordinamos otro?`;
  return `¡Hola ${t.clienta_nombre}! Te escribo de ${salon} por tu pedido de turno de ${t.servicio_nombre} ${cuando}.`;
}

function botonWhatsApp(t, tipo) {
  const link = t.clienta_telefono ? linkWhatsApp(t.clienta_telefono, mensajeParaClienta(t, tipo)) : '';
  return link ? `<a class="btn btn-whatsapp btn-compacto" href="${link}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : '';
}

function tarjetaTurno(t, { acciones }) {
  const pasado = t.fecha < hoyAR();
  return `<article class="pedido estado-${t.estado}" data-id="${t.id}">
    <div class="pedido-cabecera">
      <div class="pedido-cuando"><strong>${esc(capitalizar(fechaLarga(t.fecha)))}</strong>
        <span>${hora5(t.hora_inicio)} a ${hora5(t.hora_fin)} h</span></div>
      <span class="chip chip-${t.estado}">${ESTADOS[t.estado]}</span>
    </div>
    <p class="pedido-clienta">${esc(t.clienta_nombre)}</p>
    <p class="pedido-servicio">${esc(t.servicio_nombre)} · <b>${pesos(t.precio)}</b></p>
    ${t.clienta_telefono ? `<a class="enlace-tel" href="tel:${esc(t.clienta_telefono)}">${esc(t.clienta_telefono)}</a>` : ''}
    ${t.notas ? `<p class="pedido-notas">“${esc(t.notas)}”</p>` : ''}
    ${pasado && t.estado === 'pendiente' ? '<p class="ayuda ayuda-error">Esta fecha ya pasó.</p>' : ''}
    <div class="pedido-acciones">${acciones}</div>
  </article>`;
}

// ---------------- Vistas ----------------
function cabecera(titulo, sub = '') {
  return `<header class="cabecera cabecera-accion">
    <div><p class="cabecera-pre">${esc(P.config?.nombre_salon || 'Agenda Nail')}</p><h1>${esc(titulo)}</h1>
    ${sub ? `<p class="cabecera-sub">${sub}</p>` : ''}</div>
    <button class="btn-icono btn-volver" id="btn-menu" aria-label="Más opciones"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg></button>
  </header>`;
}

function enlazarMenu() {
  $('#btn-menu')?.addEventListener('click', async () => {
    const { data: { user } } = await sb.auth.getUser();
    const linkReservas = new URL('./', location.href).href;
    const { capa, cerrar } = abrirHoja('Opciones', `
      <p class="texto-suave">Sesión: ${esc(user?.email || '')}</p>
      <div class="campo"><span class="label">Link para tus clientas</span>
        <div class="fila-link"><input id="link-res" readonly value="${esc(linkReservas)}"><button class="btn btn-secundario btn-compacto" id="copiar">Copiar</button></div></div>
      <div class="acciones-columna">
        <a class="btn btn-secundario btn-grande" href="./" target="_blank" rel="noopener">Ver página de reservas</a>
        <button class="btn btn-texto-peligro" id="cerrar-sesion">Cerrar sesión</button></div>`);
    $('#copiar', capa).onclick = async () => {
      try { await navigator.clipboard.writeText(linkReservas); toast('Link copiado.'); } catch { $('#link-res', capa).select(); }
    };
    $('#cerrar-sesion', capa).onclick = () => { cerrar(); salir(); };
  });
}

async function vistaPedidos() {
  main.innerHTML = cabecera('Pedidos', 'Turnos que esperan tu respuesta') + '<div id="lista" class="lista-pedidos"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>';
  enlazarMenu();
  const sigue = vigente();
  const { data, error } = await sb.from('turnos').select('*').eq('estado', 'pendiente').order('fecha').order('hora_inicio');
  if (!sigue()) return;
  const lista = $('#lista');
  if (!error) pintarBadge(data.length);
  if (error) { lista.innerHTML = `<div class="tarjeta"><p class="vacio">${esc(mensajeError(error))}</p></div>`; return; }
  if (!data.length) {
    lista.innerHTML = `<div class="tarjeta"><p class="vacio">No tienes pedidos pendientes.<br>Cuando una clienta reserve, aparecerá aquí.</p>
      <button class="btn-chico" id="recargar">Actualizar</button></div>`;
    $('#recargar').onclick = () => { actualizarBadge(); vistaPedidos(); };
    return;
  }
  lista.innerHTML = data.map((t) => tarjetaTurno(t, {
    acciones: `<button class="btn btn-primario btn-compacto" data-acc="aprobar">Aprobar</button>
      <button class="btn btn-secundario btn-compacto" data-acc="rechazar">Rechazar</button>
      ${botonWhatsApp(t, 'pendiente')}`,
  })).join('') + '<button class="btn-chico" id="recargar">Actualizar</button>';
  $('#recargar').onclick = () => { actualizarBadge(); vistaPedidos(); };
  lista.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const card = b.closest('.pedido'); const t = data.find((x) => x.id === card.dataset.id);
    if (b.dataset.acc === 'rechazar') {
      const ok = await confirmar({ titulo: '¿Rechazar este pedido?', texto: `${t.clienta_nombre} · ${t.servicio_nombre}, ${fechaLarga(t.fecha)} a las ${hora5(t.hora_inicio)} h. El horario vuelve a quedar libre.`, si: 'Rechazar', peligro: true });
      if (!ok) return;
    }
    $$('button', card).forEach((x) => { x.disabled = true; });
    const estado = b.dataset.acc === 'aprobar' ? 'aprobado' : 'rechazado';
    if (await cambiarEstado(t, estado)) {
      t.estado = estado;
      card.outerHTML = tarjetaTurno(t, { acciones: `${botonWhatsApp(t, estado)}<span class="texto-suave">${estado === 'aprobado' ? 'Aprobado. Puedes avisarle por WhatsApp.' : 'Rechazado.'}</span>` });
      toast(estado === 'aprobado' ? 'Turno aprobado.' : 'Pedido rechazado.');
      actualizarBadge();
    } else $$('button', card).forEach((x) => { x.disabled = false; });
  });
}

async function vistaAgenda() {
  const [y, m] = P.mesAgenda.split('-').map(Number);
  const primero = `${P.mesAgenda}-01`;
  const ultimo = fechaISO(new Date(Date.UTC(y, m, 0, 12)));
  main.innerHTML = cabecera('Agenda') + `<section class="tarjeta">
      <div class="cal-cabecera">
        <button class="btn-icono" id="mes-ant" aria-label="Mes anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <h2>${capitalizar(MESES[m - 1])} ${y}</h2>
        <button class="btn-icono" id="mes-sig" aria-label="Mes siguiente"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="cal-grilla cal-semana">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grilla" id="cal"></div>
      <p class="cal-leyenda"><span class="punto punto-aprobado"></span> Aprobado <span class="punto punto-pendiente"></span> Pendiente</p>
    </section>
    <section class="tarjeta" id="dia"></section>`;
  enlazarMenu();
  const mover = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1, 12)); P.mesAgenda = fechaISO(d).slice(0, 7); P.diaAgenda = P.mesAgenda === hoyAR().slice(0, 7) ? hoyAR() : `${P.mesAgenda}-01`; vistaAgenda(); };
  $('#mes-ant').onclick = () => mover(-1);
  $('#mes-sig').onclick = () => mover(1);

  const sigue = vigente();
  const { data, error } = await sb.from('turnos').select('*').in('estado', ['pendiente', 'aprobado'])
    .gte('fecha', primero).lte('fecha', ultimo).order('fecha').order('hora_inicio');
  if (!sigue()) return;
  if (error) { $('#dia').innerHTML = `<p class="vacio">${esc(mensajeError(error))}</p>`; return; }
  if (!P.diaAgenda.startsWith(P.mesAgenda)) P.diaAgenda = primero;

  const dibujarCal = () => {
    const offset = (diaSemana(primero) + 6) % 7, hoy = hoyAR(), celdas = [];
    for (let i = 0; i < offset; i++) celdas.push('<span></span>');
    for (let f = primero; f <= ultimo; f = sumarDias(f, 1)) {
      const del = data.filter((t) => t.fecha === f);
      const pts = [...new Set(del.map((t) => t.estado))].map((e) => `<i class="punto punto-${e}"></i>`).join('');
      celdas.push(`<button class="cal-dia${f === hoy ? ' hoy' : ''}${f === P.diaAgenda ? ' seleccionado' : ''}" data-f="${f}" aria-label="${fechaLarga(f)}, ${del.length} turnos">${+f.slice(8)}<span class="puntos">${pts}</span></button>`);
    }
    $('#cal').innerHTML = celdas.join('');
    $$('#cal .cal-dia').forEach((b) => b.onclick = () => { P.diaAgenda = b.dataset.f; dibujarCal(); dibujarDia(); });
  };
  const dibujarDia = () => {
    const del = data.filter((t) => t.fecha === P.diaAgenda);
    $('#dia').innerHTML = `<div class="tarjeta-titulo"><h2>${esc(capitalizar(fechaLarga(P.diaAgenda)))}</h2></div>` +
      (del.length ? `<div class="lista-pedidos">${del.map((t) => tarjetaTurno(t, {
        acciones: `${t.estado === 'pendiente' ? '<button class="btn btn-primario btn-compacto" data-acc="aprobar">Aprobar</button>' : ''}
          <button class="btn btn-texto-peligro btn-compacto" data-acc="cancelar">${t.estado === 'pendiente' ? 'Rechazar' : 'Cancelar turno'}</button>
          ${botonWhatsApp(t, t.estado)}`,
      })).join('')}</div>` : '<p class="vacio">No hay turnos este día.</p>');
  };
  $('#dia').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const t = data.find((x) => x.id === b.closest('.pedido').dataset.id);
    let estado = 'aprobado';
    if (b.dataset.acc === 'cancelar') {
      estado = t.estado === 'pendiente' ? 'rechazado' : 'cancelado';
      const ok = await confirmar({
        titulo: estado === 'cancelado' ? '¿Cancelar este turno?' : '¿Rechazar este pedido?',
        texto: `${t.clienta_nombre} · ${t.servicio_nombre}, ${fechaLarga(t.fecha)} a las ${hora5(t.hora_inicio)} h. El horario vuelve a quedar libre. Recuerda avisarle a la clienta.`,
        si: estado === 'cancelado' ? 'Cancelar turno' : 'Rechazar', no: 'Volver', peligro: true,
      });
      if (!ok) return;
    }
    b.disabled = true;
    if (await cambiarEstado(t, estado)) {
      toast(estado === 'aprobado' ? 'Turno aprobado.' : estado === 'cancelado' ? 'Turno cancelado.' : 'Pedido rechazado.');
      actualizarBadge(); vistaAgenda();
    } else b.disabled = false;
  });
  dibujarCal(); dibujarDia();
}

async function vistaServicios() {
  main.innerHTML = cabecera('Servicios', 'Lo que tus clientas pueden reservar') + `<section class="tarjeta">
    <ul class="lista-servicios" id="lista"><li class="cargando"><span class="spinner"></span> Cargando…</li></ul>
    <button class="btn btn-primario btn-grande" id="nuevo">Agregar servicio</button></section>`;
  enlazarMenu();
  $('#nuevo').onclick = () => editarServicio(null);
  const sigue = vigente();
  const { data, error } = await sb.from('servicios').select('*').order('activo', { ascending: false }).order('created_at');
  if (!sigue()) return;
  if (error) { $('#lista').innerHTML = `<li class="vacio">${esc(mensajeError(error))}</li>`; return; }
  $('#lista').innerHTML = data.length ? data.map((s) => `<li><button class="fila-servicio${s.activo ? '' : ' inactivo'}" data-id="${s.id}">
      <div class="fila-servicio-info"><strong>${esc(s.nombre)}</strong><small>${duracionTexto(s.duracion_min)}${s.activo ? '' : ' · <b>Desactivado</b>'}</small></div>
      <span class="fila-servicio-precio">${pesos(s.precio)}</span></button></li>`).join('')
    : '<li class="vacio">Todavía no cargaste servicios. Agrega al menos uno para que tus clientas puedan reservar.</li>';
  $$('#lista .fila-servicio').forEach((b) => b.onclick = () => editarServicio(data.find((s) => s.id === b.dataset.id)));
}

function editarServicio(s) {
  const nuevo = !s;
  const { capa, cerrar } = abrirHoja(nuevo ? 'Nuevo servicio' : 'Editar servicio', `
    <form id="f-srv" novalidate>
      <div class="campo"><label for="s-nombre">Nombre</label><input id="s-nombre" maxlength="80" required value="${esc(s?.nombre || '')}" placeholder="Ej.: Esmaltado semipermanente"></div>
      <div class="fila-2">
        <div class="campo"><label for="s-precio">Precio</label><div class="input-pesos"><span>$</span><input id="s-precio" inputmode="numeric" value="${pesosInput(s?.precio ?? '')}" placeholder="12.500"></div></div>
        <div class="campo"><label for="s-dur">Duración</label><select id="s-dur">${[15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240].map((d) => `<option value="${d}" ${(s?.duracion_min || 60) === d ? 'selected' : ''}>${duracionTexto(d)}</option>`).join('')}</select></div>
      </div>
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
    if (p === null) { err.textContent = 'Escribe el precio.'; err.hidden = false; return; }
    const fila = { nombre, precio: p, duracion_min: Number($('#s-dur', capa).value) };
    if (!nuevo) fila.activo = $('#s-activo', capa).checked;
    const b = ev.submitter; b.disabled = true;
    const { error } = nuevo ? await sb.from('servicios').insert(fila) : await sb.from('servicios').update(fila).eq('id', s.id);
    b.disabled = false;
    if (error) { err.textContent = mensajeError(error); err.hidden = false; return; }
    cerrar(); toast(nuevo ? 'Servicio agregado.' : 'Servicio guardado.'); vistaServicios();
  });
}

async function vistaHorarios() {
  main.innerHTML = cabecera('Horarios', 'Cuándo pueden reservar tus clientas') + '<div id="h-cont"><div class="cargando"><span class="spinner"></span> Cargando…</div></div>';
  enlazarMenu();
  const sigue = vigente();
  await cargarConfig();
  const { data: hs, error } = await sb.from('horarios').select('*').order('dia');
  if (!sigue()) return;
  if (error) { $('#h-cont').innerHTML = `<p class="tarjeta vacio">${esc(mensajeError(error))}</p>`; return; }
  const c = P.config;
  const orden = [1, 2, 3, 4, 5, 6, 0];
  $('#h-cont').innerHTML = `<form id="f-hor" novalidate>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Tu salón</h2></div>
      <div class="campo"><label for="c-nombre">Nombre del salón</label><input id="c-nombre" maxlength="60" required value="${esc(c.nombre_salon)}"></div>
      <div class="campo"><label for="c-wa">Tu WhatsApp (opcional)</label><input id="c-wa" type="tel" inputmode="tel" maxlength="25" value="${esc(c.whatsapp || '')}" placeholder="Ej.: 11 2345 6789">
        <p class="ayuda">Se muestra a la clienta después de pedir el turno, para que pueda escribirte.</p></div>
      <div class="campo"><label for="c-dir">Dirección o zona (opcional)</label><input id="c-dir" maxlength="120" value="${esc(c.direccion || '')}" placeholder="Ej.: Palermo, CABA"></div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-titulo"><h2>Días y horarios</h2></div>
      <div class="lista-horarios">${orden.map((d) => { const h = hs.find((x) => x.dia === d); return `
        <div class="fila-horario" data-dia="${d}">
          <label class="interruptor"><input type="checkbox" class="h-trabaja" ${h.trabaja ? 'checked' : ''}><span>${capitalizar(DIAS[d])}</span></label>
          <div class="horas-rango"${h.trabaja ? '' : ' hidden'}>
            <input type="time" class="h-ini" value="${hora5(h.inicio)}" step="900" aria-label="Desde">
            <span>a</span>
            <input type="time" class="h-fin" value="${hora5(h.fin)}" step="900" aria-label="Hasta"></div>
          <span class="texto-suave h-cerrado"${h.trabaja ? ' hidden' : ''}>No atiendo</span>
        </div>`; }).join('')}</div>
      <div class="fila-2">
        <div class="campo"><label for="c-int">Turnos cada</label><select id="c-int">${[15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${c.intervalo_min === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div>
        <div class="campo"><label for="c-dias">Reservas hasta</label><select id="c-dias">${[7, 14, 21, 30, 45, 60].map((n) => `<option value="${n}" ${c.dias_reserva === n ? 'selected' : ''}>${n} días</option>`).join('')}</select></div>
      </div>
    </section>
    <p id="h-error" class="form-error-general" hidden></p>
    <button class="btn btn-primario btn-grande" type="submit">Guardar cambios</button>
  </form>`;
  $$('.fila-horario').forEach((f) => $('.h-trabaja', f).addEventListener('change', (e) => {
    $('.horas-rango', f).hidden = !e.target.checked; $('.h-cerrado', f).hidden = e.target.checked;
  }));
  $('#f-hor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#h-error'); err.hidden = true;
    const nombre = $('#c-nombre').value.trim();
    const waTxt = $('#c-wa').value.replace(/\D/g, '').replace(/^0/, '');
    if (!nombre) { err.textContent = 'Escribe el nombre del salón.'; err.hidden = false; return; }
    if (waTxt && !/^[0-9]{8,15}$/.test(waTxt)) { err.textContent = 'Revisa el número de WhatsApp.'; err.hidden = false; return; }
    const filas = $$('.fila-horario').map((f) => ({ dia: Number(f.dataset.dia), trabaja: $('.h-trabaja', f).checked, inicio: $('.h-ini', f).value, fin: $('.h-fin', f).value }));
    const mala = filas.find((h) => h.trabaja && (!h.inicio || !h.fin || h.fin <= h.inicio));
    if (mala) { err.textContent = `Revisa el horario del ${DIAS[mala.dia]}: la hora de fin tiene que ser posterior a la de inicio.`; err.hidden = false; return; }
    const b = ev.submitter; b.disabled = true;
    try {
      const r1 = await sb.from('config').update({ nombre_salon: nombre, whatsapp: waTxt || null, direccion: $('#c-dir').value.trim() || null,
        intervalo_min: Number($('#c-int').value), dias_reserva: Number($('#c-dias').value) }).eq('id', 1);
      if (r1.error) throw r1.error;
      for (const h of filas) {
        const fila = { trabaja: h.trabaja };
        if (h.inicio && h.fin && h.fin > h.inicio) { fila.inicio = h.inicio; fila.fin = h.fin; }
        const r = await sb.from('horarios').update(fila).eq('dia', h.dia);
        if (r.error) throw r.error;
      }
      toast('Horarios guardados.');
      await cargarConfig();
    } catch (e) { err.textContent = mensajeError(e); err.hidden = false; } finally { b.disabled = false; }
  });
}

// ---------------- Router ----------------
const VISTAS = { pedidos: vistaPedidos, agenda: vistaAgenda, servicios: vistaServicios, horarios: vistaHorarios };
let generacion = 0;
/** Devuelve una función que dice si la vista sigue siendo la actual (evita pintar vistas viejas). */
const vigente = () => { const g = ++generacion; return () => g === generacion; };
function router() {
  if (app.hidden) return;
  const ruta = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const vista = VISTAS[ruta] ? ruta : 'pedidos';
  $$('.nav-inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.nav === vista));
  document.body.dataset.vista = vista;
  VISTAS[vista]();
  main.focus({ preventScroll: true }); scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !app.hidden) actualizarBadge(); });

sb.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') setTimeout(formNuevaContrasena, 0);
});

registrarSW();
iniciarAcceso();
