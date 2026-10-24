// Punto de entrada: arranque, pantalla de bienvenida, ruteo por hash y service worker.
import { db } from './db.js';
import { obtenerPerfil, guardarPerfil } from './datos.js';
import { toast, errorGeneral, cerrarTodasLasSheets, limpiarErrores, limpiarErrorAlEditar, marcarError } from './util.js';
import * as inicio from './inicio.js';
import * as agenda from './agenda.js';
import * as clientas from './clientas.js';
import * as servicios from './servicios.js';
import * as ajustes from './ajustes.js';
import * as turnos from './turnos.js';
import { estado } from './estado.js';


const RUTAS = {
  inicio: { modulo: inicio, nav: 'inicio' },
  agenda: { modulo: agenda, nav: 'agenda' },
  clientas: { modulo: clientas, nav: 'clientas' },
  servicios: { modulo: servicios, nav: 'servicios' },
  ajustes: { modulo: ajustes, nav: 'ajustes' },
  turno: { modulo: turnos, nav: null },
};

/** "#/turno/editar/abc?fecha=2026-10-24" -> { nombre:'turno', partes:['editar','abc'], params:{fecha:...} } */
function leerRuta() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [camino, query = ''] = hash.split('?');
  const [nombre, ...partes] = camino.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { nombre: RUTAS[nombre] ? nombre : 'inicio', partes, params };
}

let renderEnCurso = 0;
async function renderRuta() {
  const ruta = leerRuta();
  const def = RUTAS[ruta.nombre];
  const cont = document.getElementById('contenido');
  cerrarTodasLasSheets();
  document.querySelectorAll('.nav-inferior a').forEach((a) => {
    const activo = a.dataset.nav === def.nav;
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.dataset.vista = ruta.nombre;
  const id = ++renderEnCurso;
  try {
    await def.modulo.render(cont, ruta, () => id === renderEnCurso);
    window.scrollTo(0, 0);
  } catch (e) {
    errorGeneral(e);
    cont.innerHTML = '<div class="tarjeta vacio"><p>No se pudo cargar esta pantalla.</p><button type="button" class="btn btn-primario" id="reintentar">Reintentar</button></div>';
    cont.querySelector('#reintentar').addEventListener('click', renderRuta);
  }
}

function mostrarSplash() {
  const splash = document.getElementById('splash');
  const form = document.getElementById('form-splash');
  splash.hidden = false;
  limpiarErrorAlEditar(form);
  document.getElementById('app').hidden = true;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpiarErrores(form);
    const nombre = form.nombre.value.trim();
    if (!nombre) {
      marcarError(form, 'nombre', 'Escribe tu nombre o el de tu salón para continuar.');
      form.nombre.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      estado.perfil = { nombre };
      await guardarPerfil(estado.perfil);
      splash.hidden = true;
      mostrarApp();
      toast(`¡Bienvenida, ${nombre}!`);
    } catch (e) {
      errorGeneral(e);
      btn.disabled = false;
    }
  });
}

function mostrarApp() {
  document.getElementById('app').hidden = false;
  if (!location.hash) location.replace('#/inicio');
  renderRuta();
}

async function arrancar() {
  window.addEventListener('hashchange', renderRuta);
  try {
    await db.abrir();
    estado.perfil = await obtenerPerfil();
  } catch (e) {
    errorGeneral(e);
    document.body.insertAdjacentHTML('afterbegin', `<div class="error-fatal"><h1>Agenda Nail</h1><p>${e.message || 'No se pudieron cargar tus datos.'}</p></div>`);
    return;
  }
  if (estado.perfil && estado.perfil.nombre) mostrarApp();
  else mostrarSplash();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker no registrado', e));
  });
}

arrancar();
