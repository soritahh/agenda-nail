// Lógica de dominio: clientas, servicios, turnos y reglas (superposición, saldo).
import { db, STORES, nuevoId } from './db.js';
import { minutos, normalizar, horaFin } from './util.js';

// ---------- Perfil ----------
export async function obtenerPerfil() {
  return (await db.ajuste('perfil')) || null;
}
export function guardarPerfil(perfil) {
  return db.guardarAjuste('perfil', perfil);
}

// ---------- Clientas ----------
export async function listarClientas() {
  const lista = await db.todos(STORES.clientas);
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function obtenerClienta(id) {
  return db.obtener(STORES.clientas, id);
}

export async function guardarClienta(datos) {
  const ahora = new Date().toISOString();
  const clienta = {
    id: datos.id || nuevoId(),
    nombre: datos.nombre.trim(),
    telefono: (datos.telefono || '').trim(),
    notas: (datos.notas || '').trim(),
    creado: datos.creado || ahora,
    actualizado: ahora,
  };
  clienta.nombreBusqueda = normalizar(clienta.nombre);
  await db.guardar(STORES.clientas, clienta);
  return clienta;
}

export async function buscarClientaPorNombre(nombre) {
  const n = normalizar(nombre);
  const lista = await db.todos(STORES.clientas);
  return lista.find((c) => c.nombreBusqueda === n) || null;
}

export function filtrarClientas(lista, texto) {
  const q = normalizar(texto);
  if (!q) return lista;
  const qTel = q.replace(/\D/g, '');
  return lista.filter((c) => c.nombreBusqueda.includes(q) || (qTel && c.telefono.replace(/\D/g, '').includes(qTel)));
}

// ---------- Servicios ----------
export const SERVICIOS_SUGERIDOS = [
  { nombre: 'Manicura tradicional', duracion: 45 },
  { nombre: 'Esmaltado semipermanente', duracion: 60 },
  { nombre: 'Kapping', duracion: 90 },
  { nombre: 'Uñas esculpidas', duracion: 120 },
  { nombre: 'Soft gel', duracion: 90 },
  { nombre: 'Retiro', duracion: 30 },
  { nombre: 'Nail art', duracion: 30 },
  { nombre: 'Pedicura', duracion: 60 },
];

export async function listarServicios() {
  const lista = await db.todos(STORES.servicios);
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function guardarServicio(datos) {
  const servicio = {
    id: datos.id || nuevoId(),
    nombre: datos.nombre.trim(),
    precio: datos.precio === null || datos.precio === undefined ? null : Number(datos.precio),
    duracion: Number(datos.duracion),
    creado: datos.creado || new Date().toISOString(),
  };
  await db.guardar(STORES.servicios, servicio);
  return servicio;
}

export function borrarServicio(id) {
  return db.borrar(STORES.servicios, id);
}

/** Agrega los sugeridos que todavía no existan (por nombre). Precio vacío para que ella lo defina. */
export async function cargarServiciosSugeridos() {
  const existentes = new Set((await db.todos(STORES.servicios)).map((s) => normalizar(s.nombre)));
  const nuevos = SERVICIOS_SUGERIDOS
    .filter((s) => !existentes.has(normalizar(s.nombre)))
    .map((s) => ({ id: nuevoId(), nombre: s.nombre, precio: null, duracion: s.duracion, creado: new Date().toISOString() }));
  if (nuevos.length) await db.guardarVarios(STORES.servicios, nuevos);
  return nuevos.length;
}

// ---------- Turnos ----------
export function obtenerTurno(id) {
  return db.obtener(STORES.turnos, id);
}

function ordenarTurnos(lista) {
  return lista.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}

export async function turnosDelDia(fecha) {
  return ordenarTurnos(await db.porIndice(STORES.turnos, 'fecha', fecha));
}

export async function turnosDelMes(anio, mes) {
  // mes: 0-11
  const prefijo = `${anio}-${String(mes + 1).padStart(2, '0')}-`;
  const rango = IDBKeyRange.bound(prefijo + '01', prefijo + '31');
  return ordenarTurnos(await db.porIndice(STORES.turnos, 'fecha', rango));
}

export async function turnosDeClienta(clientaId) {
  const lista = await db.porIndice(STORES.turnos, 'clientaId', clientaId);
  return ordenarTurnos(lista).reverse();
}

/** Devuelve el primer turno no cancelado que se superpone con el horario dado, o null. */
export async function buscarSuperposicion({ fecha, hora, duracion, excluirId }) {
  const ini = minutos(hora);
  const fin = ini + Number(duracion);
  const delDia = await turnosDelDia(fecha);
  return delDia.find((t) => {
    if (t.id === excluirId || t.estado === 'cancelado') return false;
    const tIni = minutos(t.hora);
    const tFin = tIni + Number(t.duracion);
    return ini < tFin && tIni < fin;
  }) || null;
}

export function saldo(turno) {
  return Math.max(0, (Number(turno.precio) || 0) - (Number(turno.sena) || 0));
}

export class ErrorValidacion extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'ErrorValidacion'; }
}

/**
 * Guarda un turno. Si no viene clientaId, crea la clienta con nombre y teléfono.
 * Guarda una "foto" del nombre y precio del servicio para que el historial no cambie.
 */
export async function guardarTurno(datos) {
  if (datos.estado !== 'cancelado') {
    const choque = await buscarSuperposicion({ fecha: datos.fecha, hora: datos.hora, duracion: datos.duracion, excluirId: datos.id });
    if (choque) {
      throw new ErrorValidacion(`Ese horario se superpone con el turno de ${choque.clientaNombre} (${choque.hora} a ${horaFin(choque.hora, choque.duracion)}). Elige otro horario.`);
    }
  }

  let clienta = datos.clientaId ? await obtenerClienta(datos.clientaId) : null;
  if (!clienta) {
    clienta = await buscarClientaPorNombre(datos.clientaNombre);
    if (!clienta) {
      clienta = await guardarClienta({ nombre: datos.clientaNombre, telefono: datos.clientaTelefono || '' });
    }
  }

  const ahora = new Date().toISOString();
  const turno = {
    id: datos.id || nuevoId(),
    clientaId: clienta.id,
    clientaNombre: clienta.nombre,
    servicioId: datos.servicioId || null,
    servicioNombre: datos.servicioNombre,
    precio: Number(datos.precio),
    sena: Number(datos.sena) || 0,
    fecha: datos.fecha,
    hora: datos.hora,
    duracion: Number(datos.duracion),
    estado: datos.estado || 'pendiente',
    notas: (datos.notas || '').trim(),
    creado: datos.creado || ahora,
    actualizado: ahora,
  };
  await db.guardar(STORES.turnos, turno);
  return turno;
}

export async function cambiarEstadoTurno(turno, estado) {
  if (estado !== 'cancelado' && turno.estado === 'cancelado') {
    const choque = await buscarSuperposicion({ fecha: turno.fecha, hora: turno.hora, duracion: turno.duracion, excluirId: turno.id });
    if (choque) {
      throw new ErrorValidacion(`No se puede reactivar: ahora ese horario lo ocupa ${choque.clientaNombre} (${choque.hora}).`);
    }
  }
  const actualizado = { ...turno, estado, actualizado: new Date().toISOString() };
  await db.guardar(STORES.turnos, actualizado);
  return actualizado;
}

export function borrarTurno(id) {
  return db.borrar(STORES.turnos, id);
}

/** Si se cambia el nombre de una clienta, se actualiza en sus turnos para que la agenda muestre el nombre actual. */
export async function actualizarNombreEnTurnos(clientaId, nombre) {
  const lista = await db.porIndice(STORES.turnos, 'clientaId', clientaId);
  const cambiar = lista.filter((t) => t.clientaNombre !== nombre).map((t) => ({ ...t, clientaNombre: nombre }));
  if (cambiar.length) await db.guardarVarios(STORES.turnos, cambiar);
}
