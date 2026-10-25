// MODO DEMO: un "cliente Supabase" falso que guarda todo en localStorage de ESTE dispositivo.
// Se activa sólo en r/?m=demo y en panel.html?demo=1. No hace ninguna llamada a la base real.
import { ZONA } from './config.js';

const q = new URLSearchParams(location.search);
export const DEMO = (q.get('m') || '').toLowerCase() === 'demo' || q.get('demo') === '1';
export const DEMO_AVISO = 'Modo demo — los datos se guardan solo en este dispositivo';
const CLAVE = 'agenda-nail-pro-demo-v1';
const LOGO_DEMO = new URL('../icons/demo-logo.svg', import.meta.url).href;

// ---------- Fechas (hora de Argentina) ----------
const fmtF = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtH = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hoy = () => fmtF.format(new Date());
const ahoraMin = () => { const [h, m] = fmtH.format(new Date()).split(':').map(Number); return h * 60 + m; };
const masDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();
const aMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const ACTIVOS = ['pendiente', 'aprobado'];

// ---------- Datos de ejemplo ----------
function semilla() {
  const pro = { id: 'demo-pro', user_id: 'demo-user', slug: 'demo', nombre: 'Tu Marca Nails', logo_path: 'demo:logo', color: null,
    whatsapp: null, instagram: null, zona: 'Tu ciudad', intervalo_min: 30, dias_reserva: 30, estado: 'activa' };
  const horarios = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ profesional_id: pro.id, dia, trabaja: dia >= 1 && dia <= 6,
    inicio: '09:00:00', fin: dia === 6 ? '14:00:00' : '19:00:00' }));
  const t0 = Date.now();
  const servicios = [
    ['Esmaltado semipermanente', 15000, 60], ['Kapping gel', 18000, 90], ['Uñas esculpidas', 25000, 120],
    ['Belleza de pies', 14000, 60], ['Nail art (por uña)', null, 30],
  ].map(([nombre, precio, duracion_min], i) => ({ id: `demo-srv-${i + 1}`, profesional_id: pro.id, nombre, precio, duracion_min, activo: true,
    created_at: new Date(t0 + i * 1000).toISOString() }));
  // Dos turnos de ejemplo en los próximos días hábiles, para que el panel no arranque vacío.
  const habiles = []; for (let i = 1; habiles.length < 2 && i < 10; i++) { const f = masDias(hoy(), i); if (dow(f) >= 1 && dow(f) <= 5) habiles.push(f); }
  const ej = (f, h, s, nombre, estado) => ({ id: uid(), profesional_id: pro.id, clienta_nombre: nombre, clienta_telefono: '1100000000',
    servicio_id: s.id, servicio_nombre: s.nombre, precio: s.precio, fecha: f, hora_inicio: h, hora_fin: aHora(aMin(h) + s.duracion_min),
    notas: 'Turno de ejemplo', estado, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const turnos = [ej(habiles[0], '10:00:00', servicios[0], 'Sofía (ejemplo)', 'aprobado'), ej(habiles[1], '16:00:00', servicios[1], 'Martina (ejemplo)', 'pendiente')];
  return { v: 1, pro, horarios, servicios, turnos };
}
function leer() {
  try { const d = JSON.parse(localStorage.getItem(CLAVE)); if (d && d.v === 1 && d.pro) return d; } catch { /* datos rotos: se regeneran */ }
  const d = semilla(); guardar(d); return d;
}
function guardar(d) { localStorage.setItem(CLAVE, JSON.stringify(d)); }
export function reiniciarDemo() { localStorage.removeItem(CLAVE); }
export function logoDemo(path) { return path === 'demo:logo' ? LOGO_DEMO : (leer().logos || {})[path] || ''; }
export function fotoDemo(path) { return (leer().fotos || {})[path] || ''; }

const TABLAS = { profesionales: 'pro', pro_horarios: 'horarios', pro_servicios: 'servicios', pro_turnos: 'turnos' };
const filas = (d, t) => (t === 'profesionales' ? [d.pro] : d[TABLAS[t]]);
const err = (message) => ({ message, code: 'DEMO' });

// ---------- Constructor de consultas (subconjunto de supabase-js que usa la app) ----------
class Consulta {
  constructor(tabla) { this.t = tabla; this.f = []; this.ord = []; this.op = 'select'; this.lim = null; this.uno = null; this.lanzar = false; this.cnt = false; this.head = false; this.ret = false; }
  select(_c, o = {}) { if (this.op === 'select') { this.cnt = !!o.count; this.head = !!o.head; } else this.ret = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  gte(c, v) { this.f.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.f.push((r) => r[c] <= v); return this; }
  in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this; }
  order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.uno = 'maybe'; return this; }
  single() { this.uno = 'single'; return this; }
  throwOnError() { this.lanzar = true; return this; }
  update(v) { this.op = 'update'; this.val = v; return this; }
  insert(v) { this.op = 'insert'; this.val = v; return this; }
  delete() { this.op = 'delete'; return this; }
  ejecutar() {
    const d = leer(); let lista = filas(d, this.t);
    if (!lista) return { data: null, error: err('Tabla no disponible en la demo') };
    const ahora = new Date().toISOString();
    if (this.op === 'insert') {
      const nuevas = (Array.isArray(this.val) ? this.val : [this.val]).map((v) => ({ id: uid(), activo: true, created_at: ahora, ...v }));
      d[TABLAS[this.t]].push(...nuevas); guardar(d);
      return { data: this.ret ? (this.uno ? nuevas[0] : nuevas) : null, error: null };
    }
    let sel = lista.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === 'update') {
      sel.forEach((r) => Object.assign(r, this.val, 'updated_at' in r ? { updated_at: ahora } : {}));
      guardar(d);
    } else if (this.op === 'delete') {
      if (this.t !== 'profesionales') d[TABLAS[this.t]] = lista.filter((r) => !sel.includes(r));
      guardar(d);
    }
    for (const [c, asc] of [...this.ord].reverse()) {
      sel = [...sel].sort((a, b) => { const x = a[c], y = b[c]; const r = x === y ? 0 : (x === null || x === undefined) ? 1 : (y === null || y === undefined) ? -1 : (x < y ? -1 : 1); return asc ? r : -r; });
    }
    if (this.lim !== null) sel = sel.slice(0, this.lim);
    sel = sel.map((r) => ({ ...r }));
    if (this.op !== 'select' && !this.ret) return { data: null, error: null };
    if (this.cnt && this.head) return { data: null, count: sel.length, error: null };
    if (this.uno === 'single' && sel.length !== 1) return { data: null, error: err('No se encontró el dato') };
    if (this.uno) return { data: sel[0] || null, error: null };
    return { data: sel, count: this.cnt ? sel.length : null, error: null };
  }
  then(ok, ko) {
    return new Promise((res, rej) => {
      setTimeout(() => {
        let r; try { r = this.ejecutar(); } catch (e) { r = { data: null, error: err(e.message || String(e)) }; }
        if (this.lanzar && r.error) rej(r.error); else res(r);
      }, 60);
    }).then(ok, ko);
  }
}

// ---------- RPC ----------
function insertarTurno(d, srv, fecha, hora, nombre, tel, notas, estado) {
  const ini = aMin(hora), fin = ini + srv.duracion_min;
  const choca = d.turnos.some((t) => t.fecha === fecha && ACTIVOS.includes(t.estado) && aMin(t.hora_inicio) < fin && ini < aMin(t.hora_fin));
  if (choca) throw new Error('HORARIO_OCUPADO');
  const pct = d.pro.sena_pct || 0, sena = srv.precio == null || pct <= 0 ? null : Math.round((srv.precio * pct) / 100);
  const t = { id: uid(), profesional_id: d.pro.id, clienta_nombre: nombre, clienta_telefono: tel, servicio_id: srv.id, servicio_nombre: srv.nombre,
    precio: srv.precio, sena, fecha, hora_inicio: aHora(ini), hora_fin: aHora(fin), notas, estado, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  d.turnos.push(t); guardar(d);
  return { id: t.id, fecha, hora_inicio: t.hora_inicio.slice(0, 5), hora_fin: t.hora_fin.slice(0, 5), servicio_nombre: srv.nombre, precio: srv.precio, sena, alias_pago: d.pro.alias_pago || null, estado };
}
const limpiar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const RPC = {
  pro_pagina({ p_slug }) {
    const d = leer(), p = d.pro;
    if ((p_slug || '').toLowerCase() !== 'demo') return { existe: false, disponible: false };
    const activos = d.servicios.filter((s) => s.activo).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return { existe: true, disponible: true, slug: p.slug, nombre: p.nombre, logo_path: p.logo_path, color: p.color, whatsapp: p.whatsapp,
      instagram: p.instagram, zona: p.zona, intervalo_min: p.intervalo_min, dias_reserva: p.dias_reserva,
      modo_horario: p.modo_horario || 'rango', sena_pct: p.sena_pct || 0, alias_pago: p.alias_pago || null,
      horarios: [...d.horarios].sort((a, b) => a.dia - b.dia).map(({ dia, trabaja, inicio, fin, horas_fijas }) => ({ dia, trabaja, inicio, fin, horas_fijas: horas_fijas || [] })),
      servicios: activos.filter((s) => !s.es_extra).map(({ id, nombre, precio, duracion_min, descripcion, fotos }) => ({ id, nombre, precio, duracion_min, descripcion: descripcion || null, fotos: fotos || [] })),
      extras: activos.filter((s) => s.es_extra).map(({ id, nombre, precio, descripcion }) => ({ id, nombre, precio, descripcion: descripcion || null })) };
  },
  pro_horarios_ocupados({ p_desde, p_hasta }) {
    return leer().turnos.filter((t) => ACTIVOS.includes(t.estado) && t.fecha >= p_desde && t.fecha <= p_hasta)
      .sort((a, b) => (a.fecha + a.hora_inicio < b.fecha + b.hora_inicio ? -1 : 1))
      .map(({ fecha, hora_inicio, hora_fin }) => ({ fecha, hora_inicio, hora_fin }));
  },
  pro_solicitar_turno({ p_servicio_id, p_fecha, p_hora, p_nombre, p_telefono, p_notas }) {
    const d = leer(), nombre = limpiar(p_nombre), tel = String(p_telefono || '').replace(/\D/g, ''), notas = limpiar(p_notas) || null;
    if (nombre.length < 2 || nombre.length > 80) throw new Error('DATOS_INVALIDOS: nombre');
    if (!/^\d{8,15}$/.test(tel)) throw new Error('DATOS_INVALIDOS: telefono');
    const srv = d.servicios.find((s) => s.id === p_servicio_id && s.activo && !s.es_extra);
    if (!srv) throw new Error('SERVICIO_NO_DISPONIBLE');
    const h = hoy();
    if (!p_fecha || p_fecha < h || p_fecha > masDias(h, d.pro.dias_reserva)) throw new Error('FECHA_INVALIDA');
    if (p_fecha === h && aMin(p_hora) <= ahoraMin()) throw new Error('FECHA_INVALIDA');
    const hor = d.horarios.find((x) => x.dia === dow(p_fecha));
    if (!hor || !hor.trabaja) throw new Error('FUERA_DE_HORARIO');
    if (d.pro.modo_horario === 'fijo') {
      if (!(hor.horas_fijas || []).some((t) => String(t).slice(0, 5) === String(p_hora).slice(0, 5)) || aMin(p_hora) + srv.duracion_min > 24 * 60 - 1) throw new Error('FUERA_DE_HORARIO');
    } else if (aMin(p_hora) < aMin(hor.inicio) || (aMin(p_hora) - aMin(hor.inicio)) % d.pro.intervalo_min
      || aMin(hor.fin) - aMin(p_hora) < srv.duracion_min) throw new Error('FUERA_DE_HORARIO');
    if (d.turnos.filter((t) => t.clienta_telefono === tel && t.estado === 'pendiente' && t.fecha >= h).length >= 3) throw new Error('DEMASIADOS_PEDIDOS');
    return insertarTurno(d, srv, p_fecha, p_hora, nombre, tel, notas, 'pendiente');
  },
  pro_turno_manual({ p_servicio_id, p_fecha, p_hora, p_nombre, p_telefono, p_notas, p_estado = 'aprobado' }) {
    const d = leer(), nombre = limpiar(p_nombre), tel = String(p_telefono || '').replace(/\D/g, '') || null, notas = limpiar(p_notas) || null;
    if (nombre.length < 2 || nombre.length > 80) throw new Error('DATOS_INVALIDOS: nombre');
    if (tel && !/^\d{8,15}$/.test(tel)) throw new Error('DATOS_INVALIDOS: telefono');
    if (!['aprobado', 'pendiente'].includes(p_estado)) throw new Error('DATOS_INVALIDOS: estado');
    if (!p_fecha || !p_hora) throw new Error('FECHA_INVALIDA');
    const srv = d.servicios.find((s) => s.id === p_servicio_id && !s.es_extra);
    if (!srv) throw new Error('SERVICIO_NO_DISPONIBLE');
    if (aMin(p_hora) + srv.duracion_min > 24 * 60 - 1) throw new Error('FUERA_DE_HORARIO');
    return insertarTurno(d, srv, p_fecha, p_hora, nombre, tel, notas, p_estado);
  },
  pro_slug_disponible() { return false; },
};

// ---------- Cliente ----------
export function crearClienteDemo() {
  const user = { id: 'demo-user', email: 'demo@tumarca.nails', user_metadata: {} };
  const respuesta = (fn) => new Promise((res) => setTimeout(() => {
    try { res({ data: fn(), error: null }); } catch (e) { res({ data: null, error: err(e.message || String(e)) }); }
  }, 60));
  const noDemo = () => respuesta(() => { throw new Error('Esto no está disponible en la demo.'); });
  return {
    demo: true,
    from: (t) => new Consulta(t),
    rpc: (nombre, args = {}) => (RPC[nombre] ? respuesta(() => RPC[nombre](args)) : noDemo()),
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signUp: noDemo, signInWithPassword: noDemo, resetPasswordForEmail: noDemo, updateUser: noDemo,
    },
    storage: {
      from: () => ({
        // El logo subido en la demo queda como imagen dentro del navegador (no se sube a ningún lado).
        upload: (path, file) => new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const d = leer();
              if (path.includes('/servicios/')) d.fotos = { ...(d.fotos || {}), [path]: fr.result }; else d.logos = { [path]: fr.result };
              guardar(d); res({ data: { path }, error: null });
            } catch { res({ data: null, error: err('La imagen es muy pesada para guardarla en la demo.') }); }
          };
          fr.onerror = () => res({ data: null, error: err('No se pudo leer la imagen.') });
          fr.readAsDataURL(file);
        }),
        remove: async (paths = []) => { const d = leer(); if (d.fotos) { paths.forEach((p) => delete d.fotos[p]); guardar(d); } return { data: null, error: null }; },
      }),
    },
  };
}
