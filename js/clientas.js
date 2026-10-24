// Clientas: lista con búsqueda, alta/edición e historial de turnos.
import { esc, toast, errorGeneral, abrirSheet, marcarError, limpiarErrores, limpiarErrorAlEditar, ICONOS, normalizar } from './util.js';
import { listarClientas, guardarClienta, filtrarClientas, turnosDeClienta, actualizarNombreEnTurnos } from './datos.js';
import { tarjetaTurno, conectarTarjetas } from './turnos.js';
import { ir } from './estado.js';

let busqueda = '';

export async function render(cont, _ruta, sigueVigente = () => true) {
  const clientas = await listarClientas();
  if (!sigueVigente()) return;

  cont.innerHTML = `
    <header class="cabecera cabecera-accion">
      <div>
        <h1>Clientas</h1>
        <p class="cabecera-sub">${clientas.length} ${clientas.length === 1 ? 'clienta' : 'clientas'}</p>
      </div>
      <button type="button" class="btn btn-primario btn-compacto" id="nueva-clienta">${ICONOS.mas}<span>Agregar</span></button>
    </header>
    ${clientas.length ? `
    <div class="buscador">
      ${ICONOS.buscar}
      <input type="search" id="buscar-clienta" placeholder="Buscar por nombre o teléfono" value="${esc(busqueda)}" aria-label="Buscar clienta">
    </div>` : ''}
    <section class="tarjeta">
      <ul class="lista-clientas" id="lista-clientas"></ul>
    </section>`;

  const ul = cont.querySelector('#lista-clientas');
  const recargar = () => render(cont, _ruta);

  function pintarLista() {
    if (!clientas.length) {
      ul.innerHTML = '<li class="vacio">Todavía no tienes clientas. Se agregan solas al crear un turno, o puedes agregar tu primera clienta con el botón <strong>Agregar</strong>.</li>';
      return;
    }
    const filtradas = filtrarClientas(clientas, busqueda);
    ul.innerHTML = filtradas.length
      ? filtradas.map((c) => `
        <li><button type="button" class="fila-clienta" data-id="${esc(c.id)}">
          <span class="avatar" aria-hidden="true">${esc(c.nombre.charAt(0).toUpperCase())}</span>
          <span class="fila-clienta-info"><strong>${esc(c.nombre)}</strong><small>${esc(c.telefono || 'Sin teléfono')}</small></span>
          ${ICONOS.der}
        </button></li>`).join('')
      : '<li class="vacio">No hay clientas que coincidan con la búsqueda.</li>';
    ul.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
      const c = clientas.find((x) => x.id === b.dataset.id);
      if (c) abrirFicha(c, recargar);
    }));
  }

  const inBuscar = cont.querySelector('#buscar-clienta');
  if (inBuscar) inBuscar.addEventListener('input', () => { busqueda = inBuscar.value; pintarLista(); });
  cont.querySelector('#nueva-clienta').addEventListener('click', () => abrirFormClienta(null, clientas, recargar));
  pintarLista();
}

async function abrirFicha(c, recargar) {
  let historial = [];
  try {
    historial = await turnosDeClienta(c.id);
  } catch (e) { errorGeneral(e); return; }
  const completados = historial.filter((t) => t.estado === 'completado').length;

  abrirSheet({
    titulo: c.nombre,
    contenido: `
      <div class="ficha">
        ${c.telefono ? `<a class="enlace-tel" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ''))}">${ICONOS.tel}<span>${esc(c.telefono)}</span></a>` : '<p class="ayuda">Sin teléfono</p>'}
        ${c.notas ? `<p class="ficha-notas">${esc(c.notas)}</p>` : ''}
        <div class="acciones-fila">
          <button type="button" class="btn btn-secundario" data-accion="editar">Editar datos</button>
          <button type="button" class="btn btn-primario" data-accion="turno">Nuevo turno</button>
        </div>
        <p class="etiqueta-seccion">Historial de turnos (${historial.length}${completados ? ` · ${completados} completados` : ''})</p>
        <div class="lista-turnos" id="historial">
          ${historial.length ? historial.map((t) => tarjetaTurno(t, { mostrarFecha: true })).join('') : '<p class="vacio">Todavía no tiene turnos.</p>'}
        </div>
      </div>`,
    alMontar(sheet, cerrar) {
      sheet.querySelector('[data-accion="editar"]').addEventListener('click', async () => {
        cerrar();
        const todas = await listarClientas().catch(() => []);
        abrirFormClienta(c, todas, recargar);
      });
      sheet.querySelector('[data-accion="turno"]').addEventListener('click', () => {
        cerrar();
        ir(`#/turno/nuevo?clienta=${encodeURIComponent(c.id)}`);
      });
      conectarTarjetas(sheet.querySelector('#historial'), () => { cerrar(); recargar(); });
    },
  });
}

function abrirFormClienta(c, clientas, recargar) {
  abrirSheet({
    titulo: c ? 'Editar clienta' : 'Nueva clienta',
    contenido: `
      <form class="form" novalidate autocomplete="off">
        <div class="campo">
          <label for="c-nombre">Nombre *</label>
          <input id="c-nombre" name="nombre" type="text" maxlength="60" value="${esc(c ? c.nombre : '')}" placeholder="Nombre y apellido">
        </div>
        <div class="campo">
          <label for="c-telefono">Teléfono</label>
          <input id="c-telefono" name="telefono" type="tel" inputmode="tel" maxlength="30" value="${esc(c ? c.telefono : '')}" placeholder="Ej.: 11 5555-1234">
        </div>
        <div class="campo">
          <label for="c-notas">Notas</label>
          <textarea id="c-notas" name="notas" rows="3" maxlength="500" placeholder="Preferencias, alergias, colores favoritos…">${esc(c ? c.notas : '')}</textarea>
        </div>
        <button type="submit" class="btn btn-primario btn-grande">${c ? 'Guardar cambios' : 'Agregar clienta'}</button>
      </form>`,
    alMontar(sheet, cerrar) {
      const form = sheet.querySelector('form');
      limpiarErrorAlEditar(form);
      let guardando = false;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (guardando) return;
        limpiarErrores(form);
        const nombre = form.nombre.value.trim();
        const telefono = form.telefono.value.trim();
        let ok = true;
        if (!nombre) { marcarError(form, 'nombre', 'Escribe el nombre.'); ok = false; }
        else if (clientas.some((x) => x.nombreBusqueda === normalizar(nombre) && (!c || x.id !== c.id))) {
          marcarError(form, 'nombre', 'Ya tienes una clienta con ese nombre.'); ok = false;
        }
        if (telefono && telefono.replace(/\D/g, '').length < 6) { marcarError(form, 'telefono', 'El teléfono parece incompleto.'); ok = false; }
        if (!ok) return;
        guardando = true;
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const guardada = await guardarClienta({ ...(c || {}), nombre, telefono, notas: form.notas.value });
          if (c && c.nombre !== guardada.nombre) await actualizarNombreEnTurnos(guardada.id, guardada.nombre);
          toast(c ? 'Clienta actualizada.' : 'Clienta agregada.');
          cerrar();
          recargar();
        } catch (e) {
          errorGeneral(e);
          guardando = false;
          btn.disabled = false;
        }
      });
      if (!c) setTimeout(() => form.nombre.focus(), 250);
    },
  });
}
