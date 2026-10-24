// Turnos: tarjeta, detalle (cambiar estado, editar, cancelar, eliminar) y formulario rápido.
import {
  esc, pesos, parsePesos, formatearInputPesos, pesosInput, hoyISO, fechaLarga, capitalizar,
  horaFin, minutos, duracionTexto, ESTADOS, toast, errorGeneral, abrirSheet, confirmar,
  marcarError, limpiarErrores, limpiarErrorAlEditar, errorGeneralForm, ICONOS, normalizar,
} from './util.js';
import {
  obtenerTurno, guardarTurno, cambiarEstadoTurno, borrarTurno, saldo, ErrorValidacion,
  listarClientas, listarServicios, obtenerClienta, filtrarClientas,
} from './datos.js';
import { ir } from './estado.js';

// ---------- Tarjeta de turno (reutilizada en Inicio, Agenda y Clientas) ----------
export function tarjetaTurno(t, { mostrarFecha = false } = {}) {
  const s = saldo(t);
  return `
    <button type="button" class="turno estado-${t.estado}" data-turno="${esc(t.id)}">
      <span class="turno-hora">
        <strong>${esc(t.hora)}</strong>
        <small>${esc(horaFin(t.hora, t.duracion))}</small>
      </span>
      <span class="turno-info">
        <span class="turno-clienta">${esc(t.clientaNombre)}</span>
        <span class="turno-servicio">${esc(t.servicioNombre)}${mostrarFecha ? ` · ${esc(fechaCortaTexto(t.fecha))}` : ''}</span>
        <span class="turno-precio"><span class="nw">${pesos(t.precio)}</span>${s > 0 && t.sena ? ` · <span class="saldo nw">Saldo ${pesos(s)}</span>` : ''}</span>
      </span>
      <span class="chip chip-${t.estado}">${ESTADOS[t.estado].etiqueta}</span>
    </button>`;
}

function fechaCortaTexto(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Conecta los clics de las tarjetas de turno dentro de un contenedor. */
export function conectarTarjetas(contenedor, alCambiar) {
  contenedor.querySelectorAll('[data-turno]').forEach((b) => {
    b.addEventListener('click', () => abrirDetalleTurno(b.dataset.turno, alCambiar));
  });
}

// ---------- Detalle ----------
export async function abrirDetalleTurno(id, alCambiar = () => {}) {
  let t;
  try {
    t = await obtenerTurno(id);
  } catch (e) { errorGeneral(e); return; }
  if (!t) { toast('Ese turno ya no existe.', 'error'); alCambiar(); return; }

  let telefono = '';
  try {
    const c = await obtenerClienta(t.clientaId);
    telefono = c ? c.telefono : '';
  } catch (_) { /* el detalle se muestra igual */ }

  const s = saldo(t);
  abrirSheet({
    titulo: 'Detalle del turno',
    contenido: `
      <div class="detalle">
        <p class="detalle-clienta">${esc(t.clientaNombre)}</p>
        ${telefono ? `<a class="enlace-tel" href="tel:${esc(telefono.replace(/[^\d+]/g, ''))}">${ICONOS.tel}<span>${esc(telefono)}</span></a>` : ''}
        <dl class="detalle-datos">
          <div><dt>Fecha</dt><dd>${esc(capitalizar(fechaLarga(t.fecha)))}</dd></div>
          <div><dt>Horario</dt><dd>${esc(t.hora)} a ${esc(horaFin(t.hora, t.duracion))} (${esc(duracionTexto(t.duracion))})</dd></div>
          <div><dt>Servicio</dt><dd>${esc(t.servicioNombre)}</dd></div>
          <div><dt>Precio</dt><dd>${pesos(t.precio)}</dd></div>
          <div><dt>Seña</dt><dd>${t.sena ? pesos(t.sena) : 'Sin seña'}</dd></div>
          <div><dt>Saldo pendiente</dt><dd class="${s > 0 ? 'saldo' : ''}">${pesos(s)}</dd></div>
          ${t.notas ? `<div class="detalle-notas"><dt>Notas</dt><dd>${esc(t.notas)}</dd></div>` : ''}
        </dl>
        <p class="etiqueta-seccion">Estado</p>
        <div class="selector-estado" role="group" aria-label="Cambiar estado">
          ${Object.entries(ESTADOS).map(([clave, e]) => `
            <button type="button" class="chip-estado chip-${clave} ${t.estado === clave ? 'activo' : ''}" data-estado="${clave}" aria-pressed="${t.estado === clave}">${e.etiqueta}</button>`).join('')}
        </div>
        <div class="acciones-columna">
          <button type="button" class="btn btn-primario" data-accion="editar">Reprogramar o editar</button>
          ${t.estado !== 'cancelado' ? '<button type="button" class="btn btn-secundario" data-accion="cancelar">Cancelar turno</button>' : ''}
          <button type="button" class="btn btn-texto-peligro" data-accion="eliminar">Eliminar turno</button>
        </div>
      </div>`,
    alMontar(sheet, cerrar) {
      const reabrir = () => { cerrar(); alCambiar(); setTimeout(() => abrirDetalleTurno(id, alCambiar), 220); };

      sheet.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', async () => {
        const nuevo = b.dataset.estado;
        if (nuevo === t.estado) return;
        if (nuevo === 'cancelado') {
          const ok = await confirmar({ titulo: 'Cancelar turno', mensaje: `¿Cancelar el turno de ${t.clientaNombre}? El horario quedará libre.`, textoOk: 'Sí, cancelar' });
          if (!ok) return;
        }
        try {
          await cambiarEstadoTurno(t, nuevo);
          toast(`Turno marcado como ${ESTADOS[nuevo].etiqueta.toLowerCase()}.`);
          reabrir();
        } catch (e) {
          if (e instanceof ErrorValidacion) toast(e.message, 'error'); else errorGeneral(e);
        }
      }));

      sheet.querySelector('[data-accion="editar"]').addEventListener('click', () => {
        cerrar();
        ir(`#/turno/editar/${encodeURIComponent(t.id)}`);
      });

      const btnCancelar = sheet.querySelector('[data-accion="cancelar"]');
      if (btnCancelar) btnCancelar.addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Cancelar turno', mensaje: `¿Cancelar el turno de ${t.clientaNombre}? El horario quedará libre.`, textoOk: 'Sí, cancelar' });
        if (!ok) return;
        try {
          await cambiarEstadoTurno(t, 'cancelado');
          toast('Turno cancelado.');
          reabrir();
        } catch (e) { errorGeneral(e); }
      });

      sheet.querySelector('[data-accion="eliminar"]').addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Eliminar turno', mensaje: 'Se borrará este turno para siempre. Esta acción no se puede deshacer.', textoOk: 'Eliminar', peligro: true });
        if (!ok) return;
        try {
          await borrarTurno(t.id);
          toast('Turno eliminado.');
          cerrar();
          alCambiar();
        } catch (e) { errorGeneral(e); }
      });
    },
  });
}

// ---------- Formulario (nuevo / editar) ----------
export async function render(cont, ruta) {
  const [modo, idEditar] = ruta.partes;
  const editando = modo === 'editar' && idEditar;
  const [clientas, servicios] = await Promise.all([listarClientas(), listarServicios()]);

  let turno = null;
  if (editando) {
    turno = await obtenerTurno(decodeURIComponent(idEditar));
    if (!turno) {
      cont.innerHTML = `<div class="tarjeta vacio"><p>Ese turno ya no existe.</p><a class="btn btn-primario" href="#/agenda">Ir a la agenda</a></div>`;
      return;
    }
  }

  const clientaInicial = turno
    ? clientas.find((c) => c.id === turno.clientaId) || null
    : (ruta.params.clienta ? clientas.find((c) => c.id === ruta.params.clienta) || null : null);
  const fechaInicial = turno ? turno.fecha : (/^\d{4}-\d{2}-\d{2}$/.test(ruta.params.fecha || '') ? ruta.params.fecha : hoyISO());

  // Servicio inicial: en edición, si el servicio sigue existiendo se selecciona; si no, va como "otro" con su nombre guardado.
  let servicioSel = '';
  if (turno) servicioSel = servicios.some((s) => s.id === turno.servicioId) ? turno.servicioId : 'otro';
  else if (!servicios.length) servicioSel = 'otro';

  const volver = editando ? `#/agenda?fecha=${turno.fecha}` : (ruta.params.desde === 'agenda' ? `#/agenda?fecha=${fechaInicial}` : '#/inicio');

  cont.innerHTML = `
    <header class="cabecera cabecera-con-volver">
      <a class="btn-icono btn-volver" href="${volver}" aria-label="Volver">${ICONOS.izq}</a>
      <div>
        <h1>${editando ? 'Editar turno' : 'Nuevo turno'}</h1>
        <p class="cabecera-sub">${editando ? 'Cambia el día, la hora o los datos' : 'Completa los datos y listo'}</p>
      </div>
    </header>

    <form id="form-turno" class="tarjeta form" novalidate autocomplete="off">
      <p class="form-error-general" role="alert" hidden></p>

      <div class="campo campo-clienta">
        <label for="t-clienta">Clienta *</label>
        <div class="buscador-clienta">
          <input id="t-clienta" name="clienta" type="text" maxlength="60" placeholder="Busca o escribe un nombre nuevo"
            value="${esc(clientaInicial ? clientaInicial.nombre : (turno ? turno.clientaNombre : ''))}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="t-sugerencias">
          <ul id="t-sugerencias" class="sugerencias" role="listbox" hidden></ul>
        </div>
        <p class="ayuda" id="t-clienta-estado"></p>
      </div>

      <div class="campo" id="campo-telefono">
        <label for="t-telefono">Teléfono de la clienta nueva</label>
        <input id="t-telefono" name="telefono" type="tel" inputmode="tel" maxlength="30" placeholder="Ej.: 11 5555-1234">
      </div>

      <div class="campo">
        <label for="t-servicio">Servicio *</label>
        <select id="t-servicio" name="servicio">
          <option value="" ${servicioSel === '' ? 'selected' : ''}>${servicios.length ? 'Elige un servicio' : 'Todavía no tienes servicios'}</option>
          ${servicios.map((s) => `<option value="${esc(s.id)}" ${servicioSel === s.id ? 'selected' : ''}>${esc(s.nombre)}${s.precio === null ? ' (sin precio)' : ` · ${pesos(s.precio)}`}</option>`).join('')}
          <option value="otro" ${servicioSel === 'otro' ? 'selected' : ''}>Otro (escribir nombre)</option>
        </select>
        ${servicios.length ? '' : '<p class="ayuda">Puedes cargar tu lista en <a href="#/servicios">Servicios</a> para completar precio y duración automáticamente.</p>'}
      </div>

      <div class="campo" id="campo-servicio-otro" hidden>
        <label for="t-servicio-nombre">Nombre del servicio *</label>
        <input id="t-servicio-nombre" name="servicioNombre" type="text" maxlength="60" placeholder="Ej.: Esmaltado + diseño"
          value="${esc(turno && servicioSel === 'otro' ? turno.servicioNombre : '')}">
      </div>

      <div class="fila-2">
        <div class="campo">
          <label for="t-fecha">Fecha *</label>
          <input id="t-fecha" name="fecha" type="date" value="${esc(fechaInicial)}">
        </div>
        <div class="campo">
          <label for="t-hora">Hora de inicio *</label>
          <input id="t-hora" name="hora" type="time" step="300" value="${esc(turno ? turno.hora : '')}">
        </div>
      </div>

      <div class="fila-2">
        <div class="campo">
          <label for="t-duracion">Duración (min) *</label>
          <input id="t-duracion" name="duracion" type="number" inputmode="numeric" min="5" max="720" step="5" value="${esc(turno ? turno.duracion : '')}" placeholder="60">
        </div>
        <div class="campo">
          <label for="t-precio">Precio *</label>
          <div class="input-pesos"><span>$</span><input id="t-precio" name="precio" type="text" inputmode="numeric" maxlength="12" placeholder="0" value="${esc(turno ? pesosInput(turno.precio) : '')}"></div>
        </div>
      </div>

      <div class="fila-2">
        <div class="campo">
          <label for="t-sena">Seña (opcional)</label>
          <div class="input-pesos"><span>$</span><input id="t-sena" name="sena" type="text" inputmode="numeric" maxlength="12" placeholder="0" value="${esc(turno && turno.sena ? pesosInput(turno.sena) : '')}"></div>
        </div>
        <div class="campo">
          <span class="label">Saldo pendiente</span>
          <output id="t-saldo" class="saldo-calculado">$ 0</output>
        </div>
      </div>

      <p class="ayuda" id="t-horario"></p>

      <div class="campo">
        <label for="t-notas">Notas</label>
        <textarea id="t-notas" name="notas" rows="3" maxlength="500" placeholder="Diseño, color, alergias…">${esc(turno ? turno.notas : '')}</textarea>
      </div>

      <button type="submit" class="btn btn-primario btn-grande" id="t-guardar">${editando ? 'Guardar cambios' : 'Guardar turno'}</button>
    </form>`;

  const form = cont.querySelector('#form-turno');
  const inClienta = form.clienta;
  const listaSug = form.querySelector('#t-sugerencias');
  const estadoClienta = form.querySelector('#t-clienta-estado');
  const campoTel = form.querySelector('#campo-telefono');
  const selServicio = form.servicio;
  const campoOtro = form.querySelector('#campo-servicio-otro');
  const salidaSaldo = form.querySelector('#t-saldo');
  const textoHorario = form.querySelector('#t-horario');
  let clientaSel = clientaInicial;
  limpiarErrorAlEditar(form);

  // --- Clienta: búsqueda y selección ---
  function actualizarEstadoClienta() {
    const nombre = inClienta.value.trim();
    if (clientaSel && normalizar(clientaSel.nombre) !== normalizar(nombre)) clientaSel = null;
    if (!clientaSel && nombre) {
      const exacta = clientas.find((c) => c.nombreBusqueda === normalizar(nombre));
      if (exacta) clientaSel = exacta;
    }
    if (clientaSel) {
      estadoClienta.textContent = `Clienta registrada${clientaSel.telefono ? ` · ${clientaSel.telefono}` : ''}`;
      estadoClienta.className = 'ayuda ayuda-ok';
      campoTel.hidden = true;
    } else if (nombre) {
      estadoClienta.textContent = 'Clienta nueva: se agregará a tu lista al guardar.';
      estadoClienta.className = 'ayuda ayuda-nueva';
      campoTel.hidden = false;
    } else {
      estadoClienta.textContent = '';
      campoTel.hidden = true;
    }
  }

  function mostrarSugerencias() {
    const q = inClienta.value.trim();
    const coincidencias = q ? filtrarClientas(clientas, q).slice(0, 6) : [];
    if (!coincidencias.length || (clientaSel && coincidencias.length === 1 && coincidencias[0].id === clientaSel.id)) {
      listaSug.hidden = true;
      inClienta.setAttribute('aria-expanded', 'false');
      return;
    }
    listaSug.innerHTML = coincidencias.map((c) => `
      <li role="option" data-id="${esc(c.id)}"><strong>${esc(c.nombre)}</strong>${c.telefono ? `<small>${esc(c.telefono)}</small>` : ''}</li>`).join('');
    listaSug.hidden = false;
    inClienta.setAttribute('aria-expanded', 'true');
  }

  inClienta.addEventListener('input', () => { actualizarEstadoClienta(); mostrarSugerencias(); });
  inClienta.addEventListener('focus', mostrarSugerencias);
  inClienta.addEventListener('blur', () => setTimeout(() => { listaSug.hidden = true; }, 150));
  listaSug.addEventListener('mousedown', (ev) => ev.preventDefault());
  listaSug.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (!li) return;
    clientaSel = clientas.find((c) => c.id === li.dataset.id) || null;
    if (clientaSel) inClienta.value = clientaSel.nombre;
    listaSug.hidden = true;
    actualizarEstadoClienta();
  });

  // --- Servicio: completa precio y duración ---
  function actualizarServicio(completar) {
    const val = selServicio.value;
    campoOtro.hidden = val !== 'otro';
    const s = servicios.find((x) => x.id === val);
    if (s && completar) {
      form.duracion.value = s.duracion;
      form.precio.value = s.precio === null ? '' : pesosInput(s.precio);
      // Avisar que cambiaron (limpia errores previos de esos campos y recalcula).
      [form.duracion, form.precio].forEach((inp) => inp.dispatchEvent(new Event('input', { bubbles: true })));
      if (s.precio === null) toast('Este servicio no tiene precio cargado: ingrésalo aquí o en Servicios.', 'aviso');
    }
    actualizarCalculos();
  }
  selServicio.addEventListener('change', () => actualizarServicio(true));

  // --- Precio, seña, saldo y horario ---
  function actualizarCalculos() {
    const precio = parsePesos(form.precio.value) || 0;
    const sena = parsePesos(form.sena.value) || 0;
    salidaSaldo.textContent = pesos(Math.max(0, precio - sena));
    const hora = form.hora.value;
    const dur = parseInt(form.duracion.value, 10);
    textoHorario.innerHTML = hora && dur > 0
      ? `${ICONOS.reloj}<span>De ${esc(hora)} a ${esc(horaFin(hora, dur))}</span>`
      : '';
  }
  [form.precio, form.sena].forEach((inp) => inp.addEventListener('input', () => { formatearInputPesos(inp); actualizarCalculos(); }));
  [form.hora, form.duracion].forEach((inp) => inp.addEventListener('input', actualizarCalculos));

  actualizarEstadoClienta();
  actualizarServicio(false);

  // --- Guardar ---
  let guardando = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    limpiarErrores(form);
    actualizarEstadoClienta();

    const datos = {
      id: turno ? turno.id : undefined,
      creado: turno ? turno.creado : undefined,
      estado: turno ? turno.estado : 'pendiente',
      clientaId: clientaSel ? clientaSel.id : null,
      clientaNombre: inClienta.value.trim(),
      clientaTelefono: form.telefono.value.trim(),
      fecha: form.fecha.value,
      hora: form.hora.value,
      duracion: parseInt(form.duracion.value, 10),
      precio: parsePesos(form.precio.value),
      sena: parsePesos(form.sena.value) || 0,
      notas: form.notas.value,
    };
    const sv = servicios.find((s) => s.id === selServicio.value);
    if (sv) { datos.servicioId = sv.id; datos.servicioNombre = sv.nombre; }
    else if (selServicio.value === 'otro') { datos.servicioId = null; datos.servicioNombre = form.servicioNombre.value.trim(); }

    const errores = [];
    if (!datos.clientaNombre) errores.push(['clienta', 'Escribe el nombre de la clienta o elígela de la lista.']);
    if (!datos.clientaId && datos.clientaTelefono && datos.clientaTelefono.replace(/\D/g, '').length < 6) errores.push(['telefono', 'El teléfono parece incompleto.']);
    if (!selServicio.value) errores.push(['servicio', 'Elige un servicio.']);
    else if (selServicio.value === 'otro' && !datos.servicioNombre) errores.push(['servicioNombre', 'Escribe el nombre del servicio.']);
    if (!datos.fecha) errores.push(['fecha', 'Elige la fecha.']);
    if (!datos.hora) errores.push(['hora', 'Elige la hora de inicio.']);
    if (!Number.isFinite(datos.duracion) || datos.duracion < 5) errores.push(['duracion', 'La duración debe ser de al menos 5 minutos.']);
    else if (datos.duracion > 720) errores.push(['duracion', 'La duración no puede superar las 12 horas.']);
    else if (datos.hora && minutos(datos.hora) + datos.duracion > 24 * 60) errores.push(['duracion', 'El turno no puede terminar después de la medianoche.']);
    if (datos.precio === null) errores.push(['precio', 'Ingresa el precio (puede ser 0).']);
    if (datos.precio !== null && datos.sena > datos.precio) errores.push(['sena', 'La seña no puede ser mayor que el precio.']);

    if (errores.length) {
      errores.forEach(([campo, msg]) => marcarError(form, campo, msg));
      errorGeneralForm(form, errores.length === 1 ? errores[0][1] : 'Revisa los campos marcados.');
      return;
    }

    const btn = form.querySelector('#t-guardar');
    const textoBtn = btn.textContent;
    guardando = true;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const guardado = await guardarTurno(datos);
      toast(editando ? 'Cambios guardados.' : 'Turno guardado.');
      ir(`#/agenda?fecha=${guardado.fecha}`);
    } catch (e) {
      if (e instanceof ErrorValidacion) {
        marcarError(form, 'hora', 'Horario ocupado.');
        errorGeneralForm(form, e.message);
      } else {
        errorGeneral(e);
      }
      guardando = false;
      btn.disabled = false;
      btn.textContent = textoBtn;
    }
  });
}
