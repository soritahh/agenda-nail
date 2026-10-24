// Agenda: calendario mensual + lista de turnos del día seleccionado.
import { esc, hoyISO, fechaISO, parseFecha, sumarDias, fechaLarga, capitalizar, MESES, ICONOS } from './util.js';
import { turnosDelMes, turnosDelDia } from './datos.js';
import { tarjetaTurno, conectarTarjetas } from './turnos.js';

const DIAS_CORTOS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const vista = { fecha: null, anio: null, mes: null };

export async function render(cont, ruta, sigueVigente) {
  const fParam = ruta.params.fecha;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fParam || '') ? fParam : (vista.fecha || hoyISO());
  vista.fecha = fecha;
  const d = parseFecha(fecha);
  if (fParam || vista.anio === null) { vista.anio = d.getFullYear(); vista.mes = d.getMonth(); }

  cont.innerHTML = `
    <header class="cabecera">
      <h1>Agenda</h1>
      <p class="cabecera-sub">Elige un día para ver sus turnos</p>
    </header>
    <section class="tarjeta calendario" id="calendario"></section>
    <section class="tarjeta" id="dia"></section>`;

  await pintar(cont, sigueVigente);
}

let pintadoActual = 0;
async function pintar(cont, sigueVigente = () => true) {
  const id = ++pintadoActual; // si se navega rápido, solo se pinta el último pedido
  const [delMes, delDia] = await Promise.all([turnosDelMes(vista.anio, vista.mes), turnosDelDia(vista.fecha)]);
  if (!sigueVigente() || id !== pintadoActual) return;
  pintarCalendario(cont, delMes);
  pintarDia(cont, delDia);
}

function pintarCalendario(cont, delMes) {
  const cal = cont.querySelector('#calendario');
  const conteo = {};
  delMes.forEach((t) => { if (t.estado !== 'cancelado') conteo[t.fecha] = (conteo[t.fecha] || 0) + 1; });

  const primero = new Date(vista.anio, vista.mes, 1);
  const offset = (primero.getDay() + 6) % 7; // semana empieza el lunes
  const diasMes = new Date(vista.anio, vista.mes + 1, 0).getDate();
  const hoy = hoyISO();

  let celdas = '';
  for (let i = 0; i < offset; i++) celdas += '<span class="cal-vacia"></span>';
  for (let dia = 1; dia <= diasMes; dia++) {
    const iso = fechaISO(new Date(vista.anio, vista.mes, dia));
    const n = conteo[iso] || 0;
    const clases = ['cal-dia', iso === hoy ? 'hoy' : '', iso === vista.fecha ? 'seleccionado' : '', n ? 'con-turnos' : ''].join(' ');
    celdas += `<button type="button" class="${clases}" data-fecha="${iso}" aria-label="${esc(fechaLarga(iso))}${n ? `, ${n} ${n === 1 ? 'turno' : 'turnos'}` : ''}" ${iso === vista.fecha ? 'aria-pressed="true"' : ''}>${dia}${n ? '<i class="punto"></i>' : ''}</button>`;
  }

  cal.innerHTML = `
    <div class="cal-cabecera">
      <button type="button" class="btn-icono" data-mes="-1" aria-label="Mes anterior">${ICONOS.izq}</button>
      <h2>${capitalizar(MESES[vista.mes])} ${vista.anio}</h2>
      <button type="button" class="btn-icono" data-mes="1" aria-label="Mes siguiente">${ICONOS.der}</button>
    </div>
    <div class="cal-grilla cal-semana">${DIAS_CORTOS.map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-grilla">${celdas}</div>
    ${vista.fecha !== hoy ? '<button type="button" class="btn-chico" id="ir-hoy">Ir a hoy</button>' : ''}`;

  cal.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    const m = new Date(vista.anio, vista.mes + Number(b.dataset.mes), 1);
    vista.anio = m.getFullYear();
    vista.mes = m.getMonth();
    pintar(cont);
  }));
  cal.querySelectorAll('[data-fecha]').forEach((b) => b.addEventListener('click', () => seleccionar(cont, b.dataset.fecha)));
  const irHoy = cal.querySelector('#ir-hoy');
  if (irHoy) irHoy.addEventListener('click', () => seleccionar(cont, hoy));
}

function seleccionar(cont, iso) {
  vista.fecha = iso;
  const d = parseFecha(iso);
  vista.anio = d.getFullYear();
  vista.mes = d.getMonth();
  history.replaceState(null, '', `#/agenda?fecha=${iso}`);
  pintar(cont);
}

function pintarDia(cont, turnos) {
  const dia = cont.querySelector('#dia');
  const activos = turnos.filter((t) => t.estado !== 'cancelado').length;
  dia.innerHTML = `
    <div class="dia-cabecera">
      <button type="button" class="btn-icono" data-dia="-1" aria-label="Día anterior">${ICONOS.izq}</button>
      <div class="dia-titulo">
        <h2>${esc(capitalizar(fechaLarga(vista.fecha)))}</h2>
        <p>${activos} ${activos === 1 ? 'turno' : 'turnos'}</p>
      </div>
      <button type="button" class="btn-icono" data-dia="1" aria-label="Día siguiente">${ICONOS.der}</button>
    </div>
    <div class="lista-turnos" id="lista-dia">
      ${turnos.length ? turnos.map((t) => tarjetaTurno(t)).join('') : '<p class="vacio">No hay turnos este día.</p>'}
    </div>
    <a class="btn btn-primario" href="#/turno/nuevo?fecha=${vista.fecha}&desde=agenda">${ICONOS.mas}<span>Nuevo turno este día</span></a>`;

  dia.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => seleccionar(cont, sumarDias(vista.fecha, Number(b.dataset.dia)))));
  conectarTarjetas(dia.querySelector('#lista-dia'), () => pintar(cont));
}
