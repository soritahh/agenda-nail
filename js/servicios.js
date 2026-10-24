// Servicios: alta, edición y borrado (con confirmación). Opción de cargar sugeridos sin precio.
import { esc, pesos, parsePesos, formatearInputPesos, pesosInput, duracionTexto, toast, errorGeneral, abrirSheet, confirmar, marcarError, limpiarErrores, limpiarErrorAlEditar, ICONOS, normalizar } from './util.js';
import { listarServicios, guardarServicio, borrarServicio, cargarServiciosSugeridos } from './datos.js';

export async function render(cont, _ruta, sigueVigente = () => true) {
  const servicios = await listarServicios();
  if (!sigueVigente()) return;
  const recargar = () => render(cont, _ruta);
  const sinPrecio = servicios.filter((s) => s.precio === null).length;

  cont.innerHTML = `
    <header class="cabecera cabecera-accion">
      <div>
        <h1>Servicios</h1>
        <p class="cabecera-sub">Precio y duración de lo que ofreces</p>
      </div>
      <button type="button" class="btn btn-primario btn-compacto" id="nuevo-servicio">${ICONOS.mas}<span>Agregar</span></button>
    </header>
    ${sinPrecio ? `<p class="aviso">${sinPrecio === 1 ? 'Hay 1 servicio sin precio' : `Hay ${sinPrecio} servicios sin precio`}. Tócalo para cargar tu precio.</p>` : ''}
    <section class="tarjeta">
      ${servicios.length ? `
        <ul class="lista-servicios">
          ${servicios.map((s) => `
            <li><button type="button" class="fila-servicio" data-id="${esc(s.id)}">
              <span class="fila-servicio-info"><strong>${esc(s.nombre)}</strong><small>${esc(duracionTexto(s.duracion))}</small></span>
              <span class="fila-servicio-precio ${s.precio === null ? 'sin-precio' : ''}">${s.precio === null ? 'Define tu precio' : pesos(s.precio)}</span>
            </button></li>`).join('')}
        </ul>` : `
        <div class="vacio">
          <p>Todavía no tienes servicios. Agrega tu primer servicio, o carga una lista sugerida y luego pon tus precios.</p>
          <button type="button" class="btn btn-secundario" id="cargar-sugeridos">Cargar servicios sugeridos</button>
        </div>`}
    </section>`;

  cont.querySelector('#nuevo-servicio').addEventListener('click', () => abrirFormServicio(null, servicios, recargar));
  cont.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
    const s = servicios.find((x) => x.id === b.dataset.id);
    if (s) abrirFormServicio(s, servicios, recargar);
  }));
  const btnSug = cont.querySelector('#cargar-sugeridos');
  if (btnSug) btnSug.addEventListener('click', async () => {
    btnSug.disabled = true;
    try {
      const n = await cargarServiciosSugeridos();
      toast(`Se agregaron ${n} servicios. Toca cada uno para poner tu precio.`);
      recargar();
    } catch (e) {
      errorGeneral(e);
      btnSug.disabled = false;
    }
  });
}

function abrirFormServicio(s, servicios, recargar) {
  abrirSheet({
    titulo: s ? 'Editar servicio' : 'Nuevo servicio',
    contenido: `
      <form class="form" novalidate autocomplete="off">
        <div class="campo">
          <label for="s-nombre">Nombre *</label>
          <input id="s-nombre" name="nombre" type="text" maxlength="60" value="${esc(s ? s.nombre : '')}" placeholder="Ej.: Esmaltado semipermanente">
        </div>
        <div class="fila-2">
          <div class="campo">
            <label for="s-precio">Precio *</label>
            <div class="input-pesos"><span>$</span><input id="s-precio" name="precio" type="text" inputmode="numeric" maxlength="12" placeholder="0" value="${esc(s ? pesosInput(s.precio) : '')}"></div>
          </div>
          <div class="campo">
            <label for="s-duracion">Duración (min) *</label>
            <input id="s-duracion" name="duracion" type="number" inputmode="numeric" min="5" max="720" step="5" value="${esc(s ? s.duracion : '')}" placeholder="60">
          </div>
        </div>
        <p class="ayuda">Cambiar el precio no modifica los turnos ya agendados.</p>
        <button type="submit" class="btn btn-primario btn-grande">${s ? 'Guardar cambios' : 'Agregar servicio'}</button>
        ${s ? '<button type="button" class="btn btn-texto-peligro" data-accion="borrar">Eliminar servicio</button>' : ''}
      </form>`,
    alMontar(sheet, cerrar) {
      const form = sheet.querySelector('form');
      limpiarErrorAlEditar(form);
      form.precio.addEventListener('input', () => formatearInputPesos(form.precio));
      let guardando = false;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (guardando) return;
        limpiarErrores(form);
        const nombre = form.nombre.value.trim();
        const precio = parsePesos(form.precio.value);
        const duracion = parseInt(form.duracion.value, 10);
        let ok = true;
        if (!nombre) { marcarError(form, 'nombre', 'Escribe el nombre del servicio.'); ok = false; }
        else if (servicios.some((x) => normalizar(x.nombre) === normalizar(nombre) && (!s || x.id !== s.id))) {
          marcarError(form, 'nombre', 'Ya tienes un servicio con ese nombre.'); ok = false;
        }
        if (precio === null) { marcarError(form, 'precio', 'Ingresa el precio (puede ser 0).'); ok = false; }
        if (!Number.isFinite(duracion) || duracion < 5 || duracion > 720) { marcarError(form, 'duracion', 'Entre 5 y 720 minutos.'); ok = false; }
        if (!ok) return;
        guardando = true;
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await guardarServicio({ ...(s || {}), nombre, precio, duracion });
          toast(s ? 'Servicio actualizado.' : 'Servicio agregado.');
          cerrar();
          recargar();
        } catch (e) {
          errorGeneral(e);
          guardando = false;
          btn.disabled = false;
        }
      });
      const btnBorrar = form.querySelector('[data-accion="borrar"]');
      if (btnBorrar) btnBorrar.addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Eliminar servicio', mensaje: `¿Eliminar "${s.nombre}"? Los turnos ya agendados conservan su nombre y precio.`, textoOk: 'Eliminar', peligro: true });
        if (!ok) return;
        try {
          await borrarServicio(s.id);
          toast('Servicio eliminado.');
          cerrar();
          recargar();
        } catch (e) { errorGeneral(e); }
      });
      if (!s) setTimeout(() => form.nombre.focus(), 250);
    },
  });
}
