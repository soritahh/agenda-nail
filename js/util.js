// Utilidades compartidas: formato, fechas, escape de HTML, toasts y hojas modales.

export function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formato de pesos argentinos: $ 12.500 */
export function pesos(n) {
  const v = Math.round(Number(n) || 0);
  const signo = v < 0 ? '-' : '';
  const abs = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$ ${abs}`;
}

/** Convierte lo que escribe la usuaria ("12.500", "$ 12500") a número entero, o null si está vacío. */
export function parsePesos(texto) {
  const limpio = String(texto ?? '').replace(/[^\d]/g, '');
  if (limpio === '') return null;
  return parseInt(limpio, 10);
}

/** Formatea un input de pesos mientras se escribe (12500 -> 12.500). */
export function formatearInputPesos(input) {
  const n = parsePesos(input.value);
  input.value = n === null ? '' : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function pesosInput(n) {
  if (n === null || n === undefined || n === '') return '';
  return Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------- Fechas (siempre en hora local, formato YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');

export function fechaISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hoyISO() {
  return fechaISO(new Date());
}

export function parseFecha(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function sumarDias(iso, dias) {
  const d = parseFecha(iso);
  d.setDate(d.getDate() + dias);
  return fechaISO(d);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(iso) {
  const d = parseFecha(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function fechaCorta(iso) {
  const d = parseFecha(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function capitalizar(t) {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmm(mins) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

export function horaFin(hora, duracion) {
  return hhmm(minutos(hora) + Number(duracion));
}

export function duracionTexto(min) {
  min = Number(min) || 0;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function normalizar(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ---------- Estados de turno ----------
export const ESTADOS = {
  pendiente: { etiqueta: 'Pendiente' },
  confirmado: { etiqueta: 'Confirmado' },
  completado: { etiqueta: 'Completado' },
  cancelado: { etiqueta: 'Cancelado' },
};

// ---------- Toast ----------
let toastTimer = null;
export function toast(mensaje, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = mensaje;
  el.className = `toast visible ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

export function errorGeneral(e) {
  console.error(e);
  toast(e && e.name === 'ErrorDB' ? e.message : 'Ocurrió un error inesperado. Intenta de nuevo.', 'error');
}

// ---------- Hoja modal (bottom sheet) ----------
const pilaSheets = [];

export function abrirSheet({ titulo, contenido, alMontar, alCerrar }) {
  const capa = document.createElement('div');
  capa.className = 'sheet-capa';
  capa.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="sheet-cabecera">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="btn-icono sheet-cerrar" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet-cuerpo">${contenido}</div>
    </div>`;
  document.body.appendChild(capa);
  requestAnimationFrame(() => capa.classList.add('abierta'));
  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    const i = pilaSheets.indexOf(cerrar);
    if (i >= 0) pilaSheets.splice(i, 1);
    capa.classList.remove('abierta');
    setTimeout(() => capa.remove(), 200);
    if (alCerrar) alCerrar();
  };
  pilaSheets.push(cerrar);
  capa.addEventListener('click', (ev) => { if (ev.target === capa) cerrar(); });
  capa.querySelector('.sheet-cerrar').addEventListener('click', cerrar);
  const sheet = capa.querySelector('.sheet');
  if (alMontar) alMontar(sheet, cerrar);
  return cerrar;
}

export function cerrarTodasLasSheets() {
  [...pilaSheets].forEach((c) => c());
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && pilaSheets.length) pilaSheets[pilaSheets.length - 1]();
});

/** Confirmación con botones propios. Devuelve Promise<boolean>. Cerrar sin elegir = false. */
export function confirmar({ titulo = '¿Estás segura?', mensaje, textoOk = 'Confirmar', peligro = false }) {
  return new Promise((resolve) => {
    let respuesta = false;
    abrirSheet({
      titulo,
      contenido: `
        <p class="confirmar-texto">${esc(mensaje)}</p>
        <div class="acciones-fila">
          <button type="button" class="btn btn-secundario" data-r="no">Volver</button>
          <button type="button" class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-r="si">${esc(textoOk)}</button>
        </div>`,
      alMontar(sheet, cerrar) {
        sheet.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
          respuesta = b.dataset.r === 'si';
          cerrar();
        }));
      },
      alCerrar: () => resolve(respuesta),
    });
  });
}

/** Muestra un error de campo debajo del input. */
export function marcarError(form, nombre, mensaje) {
  const campo = form.querySelector(`[name="${nombre}"]`);
  const cont = campo ? campo.closest('.campo') : null;
  if (!cont) return;
  cont.classList.add('con-error');
  let msg = cont.querySelector('.campo-error');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'campo-error';
    cont.appendChild(msg);
  }
  msg.textContent = mensaje;
}

/** Quita el error de un campo apenas la usuaria lo corrige. */
export function limpiarErrorAlEditar(form) {
  const quitar = (ev) => {
    const cont = ev.target.closest && ev.target.closest('.campo');
    if (!cont || !cont.classList.contains('con-error')) return;
    cont.classList.remove('con-error');
    const msg = cont.querySelector('.campo-error');
    if (msg) msg.remove();
    if (!form.querySelector('.con-error')) {
      const general = form.querySelector('.form-error-general');
      if (general) { general.textContent = ''; general.hidden = true; }
    }
  };
  form.addEventListener('input', quitar);
  form.addEventListener('change', quitar);
}

export function limpiarErrores(form) {
  form.querySelectorAll('.con-error').forEach((c) => c.classList.remove('con-error'));
  form.querySelectorAll('.campo-error').forEach((m) => m.remove());
  const general = form.querySelector('.form-error-general');
  if (general) { general.textContent = ''; general.hidden = true; }
}

export function errorGeneralForm(form, mensaje) {
  const general = form.querySelector('.form-error-general');
  if (general) {
    general.textContent = mensaje;
    general.hidden = false;
    general.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    toast(mensaje, 'error');
  }
}

export const ICONOS = {
  mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  izq: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  der: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  tel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
