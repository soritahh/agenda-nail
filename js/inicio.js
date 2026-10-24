// Inicio: saludo, fecha de hoy y turnos del día.
import { esc, hoyISO, fechaLarga, capitalizar, ICONOS } from './util.js';
import { turnosDelDia } from './datos.js';
import { estado } from './estado.js';
import { tarjetaTurno, conectarTarjetas } from './turnos.js';

function saludo() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export async function render(cont, _ruta, sigueVigente) {
  const hoy = hoyISO();
  const turnos = await turnosDelDia(hoy);
  if (!sigueVigente()) return;
  const activos = turnos.filter((t) => t.estado !== 'cancelado');
  const nombre = estado.perfil ? estado.perfil.nombre : '';

  cont.innerHTML = `
    <header class="cabecera">
      <p class="cabecera-pre">${esc(saludo())},</p>
      <h1>${esc(nombre)}</h1>
      <p class="cabecera-sub">${esc(capitalizar(fechaLarga(hoy)))}</p>
    </header>

    <section class="tarjeta resumen-hoy">
      <div class="resumen-numero">
        <strong>${activos.length}</strong>
        <span>${activos.length === 1 ? 'turno hoy' : 'turnos hoy'}</span>
      </div>
      <a class="btn btn-primario btn-grande" href="#/turno/nuevo?fecha=${hoy}">${ICONOS.mas}<span>Nuevo turno</span></a>
    </section>

    <section class="tarjeta">
      <div class="tarjeta-titulo">
        <h2>Turnos de hoy</h2>
        <a class="enlace" href="#/agenda?fecha=${hoy}">Ver agenda</a>
      </div>
      <div class="lista-turnos" id="lista-hoy">
        ${turnos.length
          ? turnos.map((t) => tarjetaTurno(t)).join('')
          : '<p class="vacio">No tienes turnos para hoy. Agrega tu primer turno con el botón <strong>Nuevo turno</strong>.</p>'}
      </div>
    </section>`;

  conectarTarjetas(cont.querySelector('#lista-hoy'), () => render(cont, _ruta, sigueVigente));
}
