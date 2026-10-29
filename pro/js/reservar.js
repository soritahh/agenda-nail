// Página pública de UNA manicurista (r/?m=<slug>): la clienta elige servicio, día y horario, y envía su pedido.
import {
  sb, $, $$, esc, precioTexto, icono, iconoServicio, hoyAR, sumarDias, diaSemana, DIAS_CORTOS, fechaLarga, capitalizar, fechaRelativa,
  duracionTexto, horariosLibres, aMin, normalizarTelefono, linkWhatsApp, toast, mensajeError, registrarSW, hora5,
  logoHTML, aplicarColor, DEMO, bannerDemo, pesos, senaDe, urlFoto, abrirFotos, comprimirFoto, guardarReferenciasDemo,
} from './comun.js?v=p7';
import { FUNCIONES_URL, SUPABASE_KEY } from './config.js?v=p7';

const MAX_REFS = 3;
const S = { refs: [], config: null, horarios: [], servicios: [], extras: [], ocupados: [], listo: false, servicio: null, fecha: null, hora: null, enviando: false };
const app = $('#app'), barra = $('#barra'), btn = $('#btn-reservar');
const DIAS_VISTA = 21;
const SLUG = (new URLSearchParams(location.search).get('m') || (location.hash.match(/^#\/?([a-z0-9-]+)/) || [])[1] || '').toLowerCase().trim();
const CLAVE_CLIENTA = 'agenda-nail-pro-clienta';

async function iniciar() {
  registrarSW('../sw.js');
  if (!/^[a-z0-9-]{3,30}$/.test(SLUG)) return noDisponible('No encontramos esta agenda. Revisa el link que te pasaron.');
  try {
    const { data, error } = await sb.rpc('pro_pagina', { p_slug: SLUG });
    if (error) throw error;
    if (!data.existe) return noDisponible('No encontramos esta agenda. Revisa el link que te pasaron.');
    if (!data.disponible) return noDisponible('Agenda no disponible por ahora. Vuelve a intentarlo más adelante.', data.nombre);
    if (data.tema?.plantilla === 'estudio') return (await import('./estudio.js?v=p8')).iniciarEstudio(data, SLUG); // sólo agendas con tema
    S.config = { ...data, nombre_salon: data.nombre, direccion: data.zona };
    S.horarios = data.horarios.map((h) => ({ ...h, inicio: hora5(h.inicio), fin: hora5(h.fin), horas_fijas: (h.horas_fijas || []).map(hora5) }));
    S.servicios = data.servicios.map((v) => ({ ...v, fotos: v.fotos || [] }));
    S.extras = data.extras || [];
  } catch (e) {
    return fallo(mensajeError(e));
  }
  aplicarColor(S.config.color);
  bannerDemo({ enlace: '../panel.html?demo=1', texto: 'Ver panel de la dueña' });
  document.title = `Reserva tu turno · ${S.config.nombre_salon}`;
  if (!S.servicios.length) return fallo('Por ahora no hay servicios para reservar online. Escríbeme por WhatsApp o vuelve pronto.');
  S.servicio = S.servicios[0].id;
  dibujarFormulario();
  await cargarDias();
}

function fallo(msg) {
  barra.hidden = true;
  app.innerHTML = cabecera() + `<div class="tarjeta centrado"><h2>Ups</h2><p class="texto-suave">${esc(msg)}</p></div>`;
}

function noDisponible(msg, nombre) {
  barra.hidden = true;
  if (nombre) document.title = `${nombre} · Agenda`;
  app.innerHTML = `<header class="perfil">${nombre ? logoHTML({ nombre }, 104) + `<h1>${esc(nombre)}</h1>` : ''}</header>
    <div class="tarjeta centrado no-disponible"><div class="adorno" aria-hidden="true">${icono('chispa')}</div>
    <h2>Agenda no disponible por ahora</h2><p class="texto-suave">${esc(msg)}</p></div>`;
}

function cabecera(intro = true) {
  const c = S.config || { nombre_salon: 'Agenda' };
  const wa = c.whatsapp ? linkWhatsApp(c.whatsapp, '¡Hola! Quería consultarte por un turno.') : '';
  const ig = c.instagram ? `https://www.instagram.com/${encodeURIComponent(c.instagram)}/` : '';
  return `<header class="perfil">
    ${logoHTML({ nombre: c.nombre_salon, logo_path: c.logo_path }, 104)}
    <h1>${esc(c.nombre_salon)}${DEMO ? '<span class="etiqueta-demo">Demo</span>' : ''}</h1>
    ${c.direccion ? `<p class="perfil-zona">${icono('pin')}${esc(c.direccion)}</p>` : ''}
    ${ig || wa ? `<div class="perfil-redes">
      ${ig ? `<a class="red" href="${ig}" target="_blank" rel="noopener" aria-label="Instagram @${esc(c.instagram)}">${icono('instagram')}Instagram</a>` : ''}
      ${wa ? `<a class="red" href="${wa}" target="_blank" rel="noopener">${icono('whatsapp')}WhatsApp</a>` : ''}
    </div>` : ''}
    ${intro ? `<div class="adorno" aria-hidden="true">${icono('chispa')}</div>
    <p class="perfil-intro">Reserva tu turno en cuatro pasos.</p>` : ''}
  </header>`;
}

const servicioActual = () => S.servicios.find((v) => v.id === S.servicio);
const senaPct = () => Number(S.config?.sena_pct) || 0;
const senaTexto = (precio) => { const s = senaDe(precio, senaPct()); return s == null ? '' : `Seña ${senaPct()}%: ${pesos(s)}`; };

function miniaturaServicio(v) {
  if (!v.fotos.length) return `<span class="miniatura" aria-hidden="true">${iconoServicio(v.nombre)}</span>`;
  return `<button type="button" class="miniatura miniatura-foto" data-fotos="${esc(v.id)}" aria-label="Ver ${v.fotos.length > 1 ? 'fotos' : 'foto'} de ${esc(v.nombre)}">
    <img src="${esc(urlFoto(v.fotos[0]))}" alt="" loading="lazy" decoding="async" width="64" height="64">${v.fotos.length > 1 ? `<span class="miniatura-n">${v.fotos.length}</span>` : ''}</button>`;
}

function dibujarFormulario() {
  app.innerHTML = cabecera() + `
  <h2 class="paso"><span class="paso-n">1</span> Elige tu servicio</h2>
  <div class="lista-opciones" role="radiogroup" aria-label="Servicios">${S.servicios.map((v) => `
    <div class="opcion-servicio${v.id === S.servicio ? ' sel' : ''}" data-id="${esc(v.id)}" role="radio" tabindex="0" aria-checked="${v.id === S.servicio}">
      ${miniaturaServicio(v)}
      <div class="opcion-info"><strong>${esc(v.nombre)}</strong>${v.descripcion ? `<span class="opcion-desc">${esc(v.descripcion)}</span>` : ''}
        <small>${icono('reloj')}${duracionTexto(v.duracion_min)}</small>${senaTexto(v.precio) ? `<span class="chip-sena">${senaTexto(v.precio)}</span>` : ''}</div>
      <div class="opcion-lado">
        <span class="opcion-precio${v.precio == null ? ' consultar' : ''}">${precioTexto(v.precio)}</span>
        <span class="radio-punto" aria-hidden="true"></span>
      </div>
    </div>`).join('')}</div>
  ${S.extras.length ? `<div class="nota-extras"><p class="nota-extras-titulo">${icono('chispa')}Extras</p>${S.extras.map((x) => `
    <p><b>${esc(x.nombre)}</b> <span class="nota-extras-precio">+ ${precioTexto(x.precio)}</span>${x.descripcion ? `<br><span class="texto-suave">${esc(x.descripcion)}. Pídelo en la nota.</span>` : ''}</p>`).join('')}</div>` : ''}

  <h2 class="paso"><span class="paso-n">2</span> Elige el día</h2>
  <div class="tira-dias" id="dias"><p class="texto-suave">Cargando días…</p></div>

  <h2 class="paso"><span class="paso-n">3</span> Elige el horario</h2>
  <div id="horas" class="texto-suave">Cargando horarios…</div>

  <h2 class="paso"><span class="paso-n">4</span> Tus datos</h2>
  <div class="tarjeta">
    <div class="campo"><label for="nombre">Nombre y apellido</label>
      <input id="nombre" autocomplete="name" maxlength="80" placeholder="Ej.: Sofía Pérez"></div>
    <div class="campo"><label for="telefono">WhatsApp / teléfono</label>
      <input id="telefono" type="tel" inputmode="tel" autocomplete="tel" maxlength="25" placeholder="Ej.: 353 412 3456">
      <p class="ayuda" id="tel-ayuda">Con código de área, sin 0 ni 15.</p></div>
    <div class="campo"><label for="notas">Nota (opcional)</label>
      <textarea id="notas" maxlength="300" rows="2" placeholder="Ej.: quiero francesita o diseño en dos uñas"></textarea></div>
    <div class="campo campo-refs"><span class="label" id="refs-titulo">Agregar fotos del diseño (opcional)</span>
      <p class="ayuda">Hasta ${MAX_REFS} fotos de referencia. Solo las ve ella.</p>
      <div class="refs" id="refs" aria-labelledby="refs-titulo"></div>
      <input id="refs-galeria" type="file" accept="image/*" multiple hidden>
      <input id="refs-camara" type="file" accept="image/*" capture="environment" hidden>
    </div>
  </div>
  <p class="pie">${senaPct() ? `Para guardar el turno se pide una seña del ${senaPct()}%. ` : ''}Tu turno queda pendiente hasta que te lo confirme. ✦</p>`;

  const guardado = JSON.parse(localStorage.getItem(CLAVE_CLIENTA) || '{}');
  if (guardado.nombre) $('#nombre').value = guardado.nombre;
  if (guardado.telefono) $('#telefono').value = guardado.telefono;

  $$('.opcion-servicio').forEach((el) => {
    const elegir = (e) => {
      if (e.target.closest('.miniatura-foto')) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      S.servicio = el.dataset.id; S.hora = null;
      $$('.opcion-servicio').forEach((x) => { x.classList.toggle('sel', x === el); x.setAttribute('aria-checked', x === el); });
      dibujarDias(); dibujarHoras(); actualizarBarra();
    };
    el.addEventListener('click', elegir); el.addEventListener('keydown', elegir);
  });
  $$('.miniatura-foto').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = S.servicios.find((x) => x.id === b.dataset.fotos);
    if (v) abrirFotos(v.fotos.map(urlFoto), v.nombre);
  }));
  $('#nombre').addEventListener('input', actualizarBarra);
  $('#telefono').addEventListener('input', actualizarBarra);
  $('#refs-galeria').addEventListener('change', agregarRefs);
  $('#refs-camara').addEventListener('change', agregarRefs);
  dibujarRefs();
  barra.hidden = false;
  btn.onclick = reservar;
  actualizarBarra();
}

// ---------- Fotos de referencia (se comprimen en el teléfono: ~1000 px, JPG < 300 KB) ----------
function dibujarRefs() {
  const caja = $('#refs');
  if (!caja) return;
  const lleno = S.refs.length >= MAX_REFS;
  caja.innerHTML = S.refs.map((r, i) => `<div class="ref-mini">
      <button type="button" class="ref-ver" data-ver="${i}" aria-label="Ver foto ${i + 1}"><img src="${esc(r.url)}" alt="Foto ${i + 1} del diseño"></button>
      <button type="button" class="ref-quitar" data-quitar="${i}" aria-label="Quitar foto ${i + 1}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
    </div>`).join('') + (lleno ? '' : `
    <button type="button" class="ref-agregar" data-abrir="refs-galeria">${icono('mas')}<span>Galería</span></button>
    <button type="button" class="ref-agregar" data-abrir="refs-camara">${icono('camara')}<span>Cámara</span></button>`)
    + (S.refsCargando ? '<p class="ayuda refs-estado">Preparando fotos…</p>' : '');
  $$('[data-abrir]', caja).forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.abrir).click()));
  $$('[data-quitar]', caja).forEach((b) => b.addEventListener('click', () => {
    const [r] = S.refs.splice(+b.dataset.quitar, 1); URL.revokeObjectURL(r.url); dibujarRefs();
  }));
  $$('[data-ver]', caja).forEach((b) => b.addEventListener('click', () => abrirFotos(S.refs.map((r) => r.url), 'Fotos del diseño', +b.dataset.ver)));
}

async function agregarRefs(e) {
  const archivos = [...(e.target.files || [])];
  e.target.value = '';
  if (!archivos.length) return;
  const lugar = MAX_REFS - S.refs.length;
  if (archivos.length > lugar) toast(`Puedes agregar hasta ${MAX_REFS} fotos.`, 'error');
  S.refsCargando = true; dibujarRefs();
  let malas = 0;
  for (const f of archivos.slice(0, Math.max(0, lugar))) {
    try {
      const { blob } = await comprimirFoto(f, { lado: 1000, kb: 300, formato: 'image/jpeg' });
      if (blob.size > 300 * 1024) throw new Error('FOTO_INVALIDA');
      S.refs.push({ blob, url: URL.createObjectURL(blob) });
    } catch { malas++; }
  }
  S.refsCargando = false; dibujarRefs();
  if (malas) toast('No se pudo leer alguna foto. Prueba con otra (JPG, PNG o WEBP).', 'error');
}

const aDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

/** Sube las fotos al pedido recién creado con su permiso de un solo uso. Devuelve cuántas quedaron guardadas (0 si falló). */
async function subirRefs(turnoId, token, blobs) {
  if (DEMO) return guardarReferenciasDemo(turnoId, await Promise.all(blobs.map(aDataURL))) ? blobs.length : 0;
  const fd = new FormData();
  fd.append('turno_id', turnoId); fd.append('token', token);
  blobs.forEach((b, i) => fd.append('foto', b, `referencia-${i + 1}.jpg`));
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(`${FUNCIONES_URL}/referencias-turno`, { method: 'POST', body: fd, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j.fotos || blobs.length;
      if (r.status < 500) return 0; // permiso vencido o foto inválida: no tiene sentido reintentar
    } catch { /* sin conexión: se reintenta una vez */ }
  }
  return 0;
}

function rangoDias() {
  const hoy = hoyAR(), n = Math.min(DIAS_VISTA, (S.config.dias_reserva || 30) + 1);
  return Array.from({ length: n }, (_, i) => sumarDias(hoy, i));
}

async function cargarDias() {
  const dias = rangoDias();
  const { data, error } = await sb.rpc('pro_horarios_ocupados', { p_slug: SLUG, p_desde: dias[0], p_hasta: dias[dias.length - 1] });
  if (error) { $('#dias').innerHTML = `<p class="texto-suave">${esc(mensajeError(error))}</p>`; return; }
  S.ocupados = data.map((o) => ({ fecha: o.fecha, hora_inicio: hora5(o.hora_inicio), hora_fin: hora5(o.hora_fin) }));
  S.listo = true;
  dibujarDias(); dibujarHoras(); actualizarBarra();
}

function libresDe(fecha) {
  const srv = servicioActual();
  return horariosLibres({
    fecha, horario: S.horarios.find((h) => h.dia === diaSemana(fecha)),
    intervalo: S.config.intervalo_min, duracion: srv ? srv.duracion_min : 60, ocupados: S.ocupados, modo: S.config.modo_horario,
  });
}

function dibujarDias() {
  if (!S.listo) return; // sin datos de ocupación no mostramos días ni horarios
  const hoy = hoyAR();
  const dias = rangoDias().map((f) => {
    const h = S.horarios.find((x) => x.dia === diaSemana(f));
    return { fecha: f, abierto: !!(h && h.trabaja), libres: libresDe(f) };
  });
  if (!S.fecha || !dias.find((d) => d.fecha === S.fecha && d.libres.length)) {
    S.fecha = (dias.find((d) => d.libres.length) || {}).fecha || null;
  }
  $('#dias').innerHTML = dias.map((d) => {
    const off = !d.libres.length;
    const [, , dd] = d.fecha.split('-');
    return `<button type="button" class="dia${d.fecha === S.fecha ? ' sel' : ''}${off ? ' off' : ''}" data-f="${d.fecha}" ${off ? 'disabled' : ''}
      aria-label="${esc(capitalizar(fechaLarga(d.fecha)))}${off ? (d.abierto ? ', sin turnos libres' : ', cerrado') : `, ${d.libres.length} horarios libres`}">
      <span class="dia-nombre">${d.fecha === hoy ? 'Hoy' : DIAS_CORTOS[diaSemana(d.fecha)]}</span>
      <span class="dia-num">${+dd}</span>
      <span class="dia-estado">${!d.abierto ? 'Cerrado' : off ? (S.ocupados.some((o) => o.fecha === d.fecha) ? 'Completo' : 'Sin turnos') : `<b>${d.libres.length}</b> libres`}</span>
    </button>`;
  }).join('');
  $$('#dias .dia').forEach((b) => b.addEventListener('click', () => {
    S.fecha = b.dataset.f; S.hora = null; dibujarDias(); dibujarHoras(); actualizarBarra();
  }));
  const sel = $('#dias .dia.sel');
  if (sel) { const tira = $('#dias'); tira.scrollLeft = sel.offsetLeft - (tira.clientWidth - sel.offsetWidth) / 2; }
}

function dibujarHoras() {
  if (!S.listo) return;
  const caja = $('#horas');
  if (!S.fecha) {
    caja.className = 'sin-horas';
    caja.textContent = 'No hay horarios libres en los próximos días. Escríbeme por WhatsApp para consultar.';
    return;
  }
  const libres = libresDe(S.fecha);
  const grupos = [['Mañana', libres.filter((t) => aMin(t) < 13 * 60)], ['Tarde', libres.filter((t) => aMin(t) >= 13 * 60)]].filter((g) => g[1].length);
  caja.className = 'caja-horas';
  caja.innerHTML = `<p class="horas-fecha">${esc(capitalizar(fechaLarga(S.fecha)))}</p>` + grupos.map(([g, ts]) => `
    <p class="grupo-titulo">${icono(g === 'Mañana' ? 'sol' : 'luna')}${g}</p>
    <div class="grilla-horas">${ts.map((t) => `<button type="button" class="hora${t === S.hora ? ' sel' : ''}" data-h="${t}">${t}</button>`).join('')}</div>`).join('');
  $$('#horas .hora').forEach((b) => b.addEventListener('click', () => {
    S.hora = b.dataset.h; $$('#horas .hora').forEach((x) => x.classList.toggle('sel', x === b)); actualizarBarra();
  }));
}

function actualizarBarra() {
  const srv = servicioActual();
  const partes = [];
  if (srv) partes.push(`<b>${esc(srv.nombre)}</b> ${precioTexto(srv.precio)}${senaTexto(srv.precio) ? ` <span class="resumen-sena">(${senaTexto(srv.precio)})</span>` : ''}`);
  if (S.fecha) partes.push(esc(capitalizar(fechaLarga(S.fecha))));
  if (S.hora) partes.push(`<b>${S.hora} h</b>`);
  $('#resumen').innerHTML = partes.join(' · ');
  const nombre = ($('#nombre') || {}).value || '', telTxt = ($('#telefono') || {}).value || '';
  const telOk = !!normalizarTelefono(telTxt);
  const ayuda = $('#tel-ayuda');
  if (ayuda) {
    const mal = telTxt.replace(/\D/g, '').length >= 6 && !telOk;
    ayuda.classList.toggle('ayuda-error', mal);
    ayuda.textContent = mal ? 'Revisa el número: código de área + número (ej.: 353 412 3456).' : 'Con código de área, sin 0 ni 15.';
  }
  const datosOk = nombre.trim().length >= 2 && telOk;
  btn.disabled = !(srv && S.fecha && S.hora && datosOk) || S.enviando;
  btn.textContent = S.enviando ? 'Enviando…' : !S.hora ? 'Elige un horario' : !datosOk ? 'Completa tus datos' : 'Pedir turno';
}

async function reservar() {
  if (S.enviando) return;
  if (S.refsCargando) { toast('Espera a que terminen de prepararse las fotos.'); return; }
  const nombre = $('#nombre').value.trim(), telefono = normalizarTelefono($('#telefono').value), notas = $('#notas').value.trim();
  S.enviando = true; actualizarBarra();
  try {
    const args = { p_slug: SLUG, p_servicio_id: S.servicio, p_fecha: S.fecha, p_hora: S.hora, p_nombre: nombre, p_telefono: telefono, p_notas: notas || null };
    if (S.refs.length) args.p_fotos = S.refs.length;
    const { data, error } = await sb.rpc('pro_solicitar_turno', args);
    if (error) throw error;
    localStorage.setItem(CLAVE_CLIENTA, JSON.stringify({ nombre, telefono: $('#telefono').value.trim() }));
    S.enviando = false;
    const refs = S.refs.splice(0);
    confirmacion(data, nombre, refs.length && data.ref_token ? refs.length : 0);
    if (refs.length) {
      const ok = data.ref_token ? await subirRefs(data.id, data.ref_token, refs.map((r) => r.blob)) : 0;
      refs.forEach((r) => URL.revokeObjectURL(r.url));
      const est = $('#estado-refs');
      if (est) {
        est.classList.toggle('refs-ok', !!ok); est.classList.toggle('refs-falla', !ok);
        est.innerHTML = ok ? `${icono('chispa')}${ok === 1 ? 'Foto del diseño enviada' : `${ok} fotos del diseño enviadas`}.`
          : `Tu turno quedó pedido, pero no pudimos enviar las fotos del diseño. Si quieres, mándalas por WhatsApp.`;
      }
    }
  } catch (e) {
    S.enviando = false;
    const msg = mensajeError(e);
    toast(msg, 'error');
    if (/HORARIO_OCUPADO|FUERA_DE_HORARIO|FECHA_INVALIDA/.test(String(e?.message))) {
      S.hora = null; await cargarDias();
      const caja = $('#horas');
      caja.insertAdjacentHTML('afterbegin', `<p class="form-error-general" role="alert">${esc(msg)}</p>`);
      caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    actualizarBarra();
  }
}

function confirmacion(r, nombre, nFotos = 0) {
  barra.hidden = true;
  const c = S.config;
  const msg = `¡Hola! Soy ${nombre}. Acabo de pedir un turno online: ${r.servicio_nombre} ${fechaRelativa(r.fecha)} a las ${r.hora_inicio} h.`;
  const wa = c.whatsapp ? linkWhatsApp(c.whatsapp, msg) : '';
  const sena = r.sena ?? senaDe(r.precio, senaPct()), alias = r.alias_pago || c.alias_pago || '';
  const msgSena = `¡Hola! Soy ${nombre}. Pedí turno de ${r.servicio_nombre} ${fechaRelativa(r.fecha)} a las ${r.hora_inicio} h. Te envío el comprobante de la seña de ${pesos(sena)}.`;
  const waSena = c.whatsapp && sena ? linkWhatsApp(c.whatsapp, msgSena) : '';
  const cajaSena = !sena ? '' : `<div class="tarjeta caja-sena">
      <p class="caja-sena-titulo">${icono('chispa')}Seña para guardar tu turno</p>
      <p>${alias ? `Para guardar tu turno transfiere la seña de <b>${pesos(sena)}</b> al alias <b class="alias">${esc(alias)}</b> y envía el comprobante por WhatsApp.`
        : `Para guardar tu turno se pide una seña de <b>${pesos(sena)}</b>. Escríbeme por WhatsApp y te paso los datos para transferir.`}</p>
      ${alias ? `<button type="button" class="btn btn-secundario btn-grande" id="copiar-alias">Copiar alias</button>` : ''}
      ${waSena ? `<a class="btn btn-whatsapp btn-grande" href="${waSena}" target="_blank" rel="noopener">${icono('whatsapp')}Enviar comprobante por WhatsApp</a>` : ''}
    </div>`;
  app.innerHTML = cabecera(false) + `
    <section class="confirmacion" aria-live="polite">
      <div class="ok-grande" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h2 class="confirmacion-titulo">¡Pedido enviado!</h2>
      <p class="confirmacion-sub">Te confirmo el turno a la brevedad.</p>
      <div class="tarjeta">
        <dl class="detalle-datos">
          <div><dt>Servicio</dt><dd>${esc(r.servicio_nombre)}</dd></div>
          <div><dt>Día</dt><dd>${esc(capitalizar(fechaLarga(r.fecha)))}</dd></div>
          <div><dt>Hora</dt><dd>${esc(r.hora_inicio)} a ${esc(r.hora_fin)} h</dd></div>
          <div><dt>Precio</dt><dd>${precioTexto(r.precio)}</dd></div>
          ${sena ? `<div><dt>Seña</dt><dd><b>${pesos(sena)}</b></dd></div>` : ''}
          <div><dt>Estado</dt><dd><span class="chip chip-pendiente">Pendiente de confirmación</span></dd></div>
        </dl>
      </div>
      ${nFotos ? `<p class="estado-refs" id="estado-refs" role="status">Enviando ${nFotos === 1 ? 'la foto' : `${nFotos} fotos`} del diseño…</p>` : ''}
      ${cajaSena}
      <div class="acciones-columna">
        ${wa && !waSena ? `<a class="btn btn-whatsapp btn-grande" href="${wa}" target="_blank" rel="noopener">${icono('whatsapp')}Escríbeme por WhatsApp</a>` : ''}
        <button class="btn btn-secundario btn-grande" id="otro">Pedir otro turno</button>
      </div>
      <p class="pie">Si no puedes venir, avísame con tiempo. ¡Gracias! ✦</p>
    </section>`;
  $('#copiar-alias')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(alias); }
    catch { const t = document.createElement('textarea'); t.value = alias; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    b.textContent = '¡Alias copiado!'; toast(`Alias copiado: ${alias}`);
    setTimeout(() => { b.textContent = 'Copiar alias'; }, 2500);
  });
  $('#otro').onclick = () => { S.hora = null; S.refs = []; dibujarFormulario(); cargarDias(); scrollTo(0, 0); };
  scrollTo(0, 0);
}

iniciar();
