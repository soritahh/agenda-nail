// Página pública: la clienta elige servicio, día y horario, y envía su pedido.
import {
  sb, $, $$, esc, pesos, hoyAR, sumarDias, diaSemana, DIAS_CORTOS, fechaLarga, capitalizar, fechaRelativa,
  duracionTexto, horariosLibres, aMin, normalizarTelefono, linkWhatsApp, toast, mensajeError, registrarSW, hora5,
} from './comun.js';

const S = { config: null, horarios: [], servicios: [], ocupados: [], listo: false, servicio: null, fecha: null, hora: null, enviando: false };
const app = $('#app'), barra = $('#barra'), btn = $('#btn-reservar');
const DIAS_VISTA = 21;

async function iniciar() {
  registrarSW();
  try {
    const [c, h, s] = await Promise.all([
      sb.from('config').select('nombre_salon, whatsapp, direccion, intervalo_min, dias_reserva').eq('id', 1).single(),
      sb.from('horarios').select('dia, trabaja, inicio, fin').order('dia'),
      sb.from('servicios').select('id, nombre, precio, duracion_min').eq('activo', true).order('precio'),
    ]);
    if (c.error || h.error || s.error) throw c.error || h.error || s.error;
    S.config = c.data; S.horarios = h.data; S.servicios = s.data;
  } catch (e) {
    return fallo(mensajeError(e));
  }
  document.title = `Reserva tu turno · ${S.config.nombre_salon}`;
  if (!S.servicios.length) return fallo('Por ahora no hay servicios para reservar online. Vuelve pronto.');
  S.servicio = S.servicios[0].id;
  dibujarFormulario();
  await cargarDias();
}

function fallo(msg) {
  barra.hidden = true;
  app.innerHTML = cabecera() + `<div class="tarjeta centrado"><h2>Ups</h2><p class="texto-suave">${esc(msg)}</p></div>
    <p class="pie-pro"><a href="panel.html">Acceso profesional</a></p>`;
}

function cabecera() {
  const c = S.config || { nombre_salon: 'Agenda Nail' };
  const maps = c.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}` : '';
  return `<header class="salon-cabecera">
    <img class="salon-logo" src="icons/icono.svg" alt="" width="64" height="64">
    <div class="salon-info">
      <p class="salon-pre">Reserva tu turno</p>
      <h1>${esc(c.nombre_salon)}</h1>
      ${c.direccion ? `<a class="salon-dir" href="${maps}" target="_blank" rel="noopener">${esc(c.direccion)}</a>` : ''}
    </div>
  </header>`;
}

const servicioActual = () => S.servicios.find((v) => v.id === S.servicio);

function dibujarFormulario() {
  app.innerHTML = cabecera() + `
  <h2 class="paso"><span class="paso-n">1</span> Elige tu servicio</h2>
  <div class="lista-opciones" role="radiogroup" aria-label="Servicios">${S.servicios.map((v) => `
    <div class="opcion-servicio${v.id === S.servicio ? ' sel' : ''}" data-id="${esc(v.id)}" role="radio" tabindex="0" aria-checked="${v.id === S.servicio}">
      <span class="radio-punto" aria-hidden="true"></span>
      <div class="opcion-info"><strong>${esc(v.nombre)}</strong><small>${duracionTexto(v.duracion_min)}</small></div>
      <span class="opcion-precio">${pesos(v.precio)}</span>
    </div>`).join('')}</div>

  <h2 class="paso"><span class="paso-n">2</span> Elige el día</h2>
  <div class="tira-dias" id="dias"><p class="texto-suave">Cargando días…</p></div>

  <h2 class="paso"><span class="paso-n">3</span> Elige el horario</h2>
  <div id="horas" class="texto-suave">Cargando horarios…</div>

  <h2 class="paso"><span class="paso-n">4</span> Tus datos</h2>
  <div class="tarjeta">
    <div class="campo"><label for="nombre">Nombre y apellido</label>
      <input id="nombre" autocomplete="name" maxlength="80" placeholder="Ej.: Sofía Pérez"></div>
    <div class="campo"><label for="telefono">WhatsApp / teléfono</label>
      <input id="telefono" type="tel" inputmode="tel" autocomplete="tel" maxlength="25" placeholder="Ej.: 11 2345 6789">
      <p class="ayuda" id="tel-ayuda">Con código de área, sin 0 ni 15.</p></div>
    <div class="campo"><label for="notas">Nota (opcional)</label>
      <textarea id="notas" maxlength="300" rows="2" placeholder="Ej.: quiero diseño en dos uñas"></textarea></div>
  </div>
  <p class="pie">Tu pedido queda pendiente hasta que el salón lo confirme.</p>
  <p class="pie-pro"><a href="panel.html">Acceso profesional</a></p>`;

  const guardado = JSON.parse(localStorage.getItem('agenda-nail-clienta') || '{}');
  if (guardado.nombre) $('#nombre').value = guardado.nombre;
  if (guardado.telefono) $('#telefono').value = guardado.telefono;

  $$('.opcion-servicio').forEach((el) => {
    const elegir = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      S.servicio = el.dataset.id; S.hora = null;
      $$('.opcion-servicio').forEach((x) => { x.classList.toggle('sel', x === el); x.setAttribute('aria-checked', x === el); });
      dibujarDias(); dibujarHoras(); actualizarBarra();
    };
    el.addEventListener('click', elegir); el.addEventListener('keydown', elegir);
  });
  $('#nombre').addEventListener('input', actualizarBarra);
  $('#telefono').addEventListener('input', actualizarBarra);
  barra.hidden = false;
  btn.onclick = reservar;
  actualizarBarra();
}

function rangoDias() {
  const hoy = hoyAR(), n = Math.min(DIAS_VISTA, (S.config.dias_reserva || 30) + 1);
  return Array.from({ length: n }, (_, i) => sumarDias(hoy, i));
}

async function cargarDias() {
  const dias = rangoDias();
  const { data, error } = await sb.rpc('horarios_ocupados', { p_desde: dias[0], p_hasta: dias[dias.length - 1] });
  if (error) { $('#dias').innerHTML = `<p class="texto-suave">${esc(mensajeError(error))}</p>`; return; }
  S.ocupados = data.map((o) => ({ fecha: o.fecha, hora_inicio: hora5(o.hora_inicio), hora_fin: hora5(o.hora_fin) }));
  S.listo = true;
  dibujarDias(); dibujarHoras(); actualizarBarra();
}

function libresDe(fecha) {
  const srv = servicioActual();
  return horariosLibres({
    fecha, horario: S.horarios.find((h) => h.dia === diaSemana(fecha)),
    intervalo: S.config.intervalo_min, duracion: srv ? srv.duracion_min : 60, ocupados: S.ocupados,
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
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function dibujarHoras() {
  if (!S.listo) return;
  const caja = $('#horas');
  if (!S.fecha) {
    caja.className = 'tarjeta centrado texto-suave';
    caja.textContent = 'No hay horarios libres en los próximos días. Escribe al salón para consultar.';
    return;
  }
  const libres = libresDe(S.fecha);
  const grupos = [['Mañana', libres.filter((t) => aMin(t) < 13 * 60)], ['Tarde', libres.filter((t) => aMin(t) >= 13 * 60)]].filter((g) => g[1].length);
  caja.className = '';
  caja.innerHTML = `<p class="horas-fecha">${esc(capitalizar(fechaLarga(S.fecha)))}</p>` + grupos.map(([g, ts]) => `
    <p class="grupo-titulo">${g}</p>
    <div class="grilla-horas">${ts.map((t) => `<button type="button" class="hora${t === S.hora ? ' sel' : ''}" data-h="${t}">${t}</button>`).join('')}</div>`).join('');
  $$('#horas .hora').forEach((b) => b.addEventListener('click', () => {
    S.hora = b.dataset.h; $$('#horas .hora').forEach((x) => x.classList.toggle('sel', x === b)); actualizarBarra();
  }));
}

function actualizarBarra() {
  const srv = servicioActual();
  const partes = [];
  if (srv) partes.push(`<b>${esc(srv.nombre)}</b> ${pesos(srv.precio)}`);
  if (S.fecha) partes.push(esc(capitalizar(fechaLarga(S.fecha))));
  if (S.hora) partes.push(`<b>${S.hora} h</b>`);
  $('#resumen').innerHTML = partes.join(' · ');
  const nombre = ($('#nombre') || {}).value || '', telTxt = ($('#telefono') || {}).value || '';
  const telOk = !!normalizarTelefono(telTxt);
  const ayuda = $('#tel-ayuda');
  if (ayuda) {
    const mal = telTxt.replace(/\D/g, '').length >= 6 && !telOk;
    ayuda.classList.toggle('ayuda-error', mal);
    ayuda.textContent = mal ? 'Revisa el número: código de área + número (ej.: 11 2345 6789).' : 'Con código de área, sin 0 ni 15.';
  }
  const datosOk = nombre.trim().length >= 2 && telOk;
  btn.disabled = !(srv && S.fecha && S.hora && datosOk) || S.enviando;
  btn.textContent = S.enviando ? 'Enviando…' : !S.hora ? 'Elige un horario' : !datosOk ? 'Completa tus datos' : 'Pedir turno';
}

async function reservar() {
  if (S.enviando) return;
  const nombre = $('#nombre').value.trim(), telefono = normalizarTelefono($('#telefono').value), notas = $('#notas').value.trim();
  S.enviando = true; actualizarBarra();
  try {
    const { data, error } = await sb.rpc('solicitar_turno', {
      p_servicio_id: S.servicio, p_fecha: S.fecha, p_hora: S.hora, p_nombre: nombre, p_telefono: telefono, p_notas: notas || null,
    });
    if (error) throw error;
    localStorage.setItem('agenda-nail-clienta', JSON.stringify({ nombre, telefono: $('#telefono').value.trim() }));
    S.enviando = false;
    confirmacion(data, nombre);
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

function confirmacion(r, nombre) {
  barra.hidden = true;
  const c = S.config;
  const msg = `¡Hola! Soy ${nombre}. Acabo de pedir un turno online: ${r.servicio_nombre} ${fechaRelativa(r.fecha)} a las ${r.hora_inicio} h.`;
  const wa = c.whatsapp ? linkWhatsApp(c.whatsapp, msg) : '';
  app.innerHTML = cabecera() + `
    <section class="confirmacion" aria-live="polite">
      <div class="ok-grande" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h2 class="confirmacion-titulo">Tu pedido fue enviado</h2>
      <p class="confirmacion-sub">Te confirmamos pronto.</p>
      <div class="tarjeta">
        <dl class="detalle-datos">
          <div><dt>Servicio</dt><dd>${esc(r.servicio_nombre)}</dd></div>
          <div><dt>Día</dt><dd>${esc(capitalizar(fechaLarga(r.fecha)))}</dd></div>
          <div><dt>Hora</dt><dd>${esc(r.hora_inicio)} a ${esc(r.hora_fin)} h</dd></div>
          <div><dt>Precio</dt><dd>${pesos(r.precio)}</dd></div>
          <div><dt>Estado</dt><dd><span class="chip chip-pendiente">Pendiente de confirmación</span></dd></div>
        </dl>
      </div>
      <div class="acciones-columna">
        ${wa ? `<a class="btn btn-whatsapp btn-grande" href="${wa}" target="_blank" rel="noopener">Avisar al salón por WhatsApp</a>` : ''}
        <button class="btn btn-secundario btn-grande" id="otro">Pedir otro turno</button>
      </div>
      <p class="pie">Si no puedes ir, avisa al salón con tiempo. ¡Gracias!</p>
    </section>`;
  $('#otro').onclick = () => { S.hora = null; dibujarFormulario(); cargarDias(); scrollTo(0, 0); };
  scrollTo(0, 0);
}

iniciar();
