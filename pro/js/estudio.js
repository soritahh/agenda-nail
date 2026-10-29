// Plantilla "estudio" de la página pública (r/?m=<slug>), sólo para agendas con profesionales.tema.plantilla = 'estudio'.
// Flujo: inicio con categorías → servicio (+ extras) → calendario del mes → horarios libres → datos → confirmación.
// La disponibilidad sale de pro_disponibilidad (sólo horarios libres, sin nombres) y la reserva de pro_reservar (valida duración y superposición).
import {
  sb, $, $$, esc, pesos, hoyAR, sumarDias, diaSemana, parseFecha, MESES, fechaLarga, capitalizar, fechaRelativa,
  duracionTexto, normalizarTelefono, linkWhatsApp, toast, mensajeError, hora5, comprimirFoto,
} from './comun.js?v=p7';
import { FUNCIONES_URL, SUPABASE_KEY } from './config.js?v=p7';
import { aplicarTema, logoTema, urlTema } from './tema.js?v=p9';
import { urlFoto } from './comun.js?v=p7';

const app = $('#app');
const CLAVE_CLIENTA = 'agenda-nail-pro-clienta';
const MAX_REFS = 3;
const S = { c: null, slug: '', cat: null, srv: null, opcion: null, extras: {}, libres: null, mes: null, fecha: null, hora: null, refs: [], enviando: false };

const ICONOS = {
  mano: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5V4a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V12m0-4.5a1.5 1.5 0 013 0V15a7 7 0 01-7 7h-1a7 7 0 01-5.6-2.8L4 16.2a1.6 1.6 0 012.5-2L8 15.5"/>',
  pie: '<path d="M8 21c-2.5 0-4-1.8-4-4.5 0-3 1.5-5 2-8 .4-2.5 1.5-4 3.5-4s3 1.5 3 3.5c0 2.5-1.5 4-1.5 6.5 0 1.5 1.5 2 1.5 3.5C12.5 19.8 10.5 21 8 21z"/><circle cx="15" cy="4.5" r="1.3"/><circle cx="17.8" cy="6.8" r="1.1"/><circle cx="19.5" cy="9.7" r="1"/><circle cx="20.2" cy="12.7" r=".9"/>',
  ojo: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M5 7.5L3.5 5.5M9 5.6L8.4 3.3M15 5.6l.6-2.3M19 7.5l1.5-2"/>',
  ceja: '<path d="M3 13c3-4.5 9-6 16-3.5"/><path d="M4.5 17s2.8-2.6 7.5-2.6S19.5 17 19.5 17"/><circle cx="12" cy="17.2" r="1.4"/>',
  regalo: '<rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M2.5 9h19M12 9v11.5M12 9S9.5 3.5 7 5.2 9 9 12 9zm0 0s2.5-5.5 5-3.8S15 9 12 9z"/>',
  estrella: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  flecha: '<path d="M9 5l7 7-7 7"/>', atras: '<path d="M15 5l-7 7 7 7"/>', reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', mas: '<path d="M12 5v14M5 12h14"/>', menos: '<path d="M5 12h14"/>', foto: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 6l1.5-2.5h4L15.5 6"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-3.8-1z"/><path d="M9 9.5c.5 2.5 2.5 4.5 5 5l1-1.2-1.8-1-.9.8a4 4 0 01-1.9-1.9l.8-.9-1-1.8z"/>',
};
const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[n] || ICONOS.estrella}</svg>`;
const precioDe = (s) => (s.precio == null ? 'Consultar' : `${s.precio_desde ? 'desde ' : ''}${pesos(s.precio)}`);
const cats = () => (S.c.tema.categorias || []).filter((k) => k && k.id);
const catDe = (id) => cats().find((k) => k.id === id);
const srvDe = (id) => S.c.servicios.find((s) => s.id === id);
const esCombo = (s) => Array.isArray(s?.combo_ids) && s.combo_ids.length > 0;
const opcionesDe = (s) => (s?.combo_opciones || []).map(srvDe).filter(Boolean);
const imagenDe = (s) => (s.fotos?.length ? urlFoto(s.fotos[0]) : urlTema(s.imagen));
const incluyeTexto = (s) => { const f = s.combo_ids.map(srvDe).filter(Boolean).map((x) => x.nombre); const o = opcionesDe(s); if (o.length) f.splice(1, 0, o.map((x) => x.nombre).join(' o ')); return f.join(' + '); };
const ordenar = (a, b) => (a.orden ?? 99) - (b.orden ?? 99);

export async function iniciarEstudio(data, slug) {
  S.c = data; S.slug = slug;
  aplicarTema(data.tema);
  document.title = `${data.nombre} · Reservá tu turno`;
  $('#barra')?.setAttribute('hidden', '');
  app.className = 'e-app';
  window.addEventListener('popstate', (e) => mostrar(e.state || { p: 'inicio' }, false));
  mostrar({ p: 'inicio' }, false);
  history.replaceState({ p: 'inicio' }, '');
}

function mostrar(st, push = true) {
  if (push) history.pushState(st, '');
  if (st.p === 'categoria') S.cat = st.cat;
  if (st.p === 'servicio' && st.srv !== S.srv) { S.srv = st.srv; S.opcion = null; S.extras = {}; S.libres = null; S.fecha = null; S.hora = null; }
  ({ inicio: vInicio, categoria: vCategoria, servicio: vServicio, calendario: vCalendario, datos: vDatos }[st.p] || vInicio)();
  scrollTo(0, 0);
  app.focus({ preventScroll: true });
}
const ir = (st) => mostrar(st);
const volver = () => history.back();

function cabecera(titulo) {
  return `<header class="e-barra">
    <button type="button" class="e-atras" data-atras aria-label="Volver">${ic('atras')}<span>Volver</span></button>
    <img class="e-barra-logo" src="${esc(logoTema(S.c.tema))}" alt="" width="44" height="44">
  </header>${titulo ? `<h1 class="e-titulo">${esc(titulo)}</h1>` : ''}`;
}
function enganchar() { $$('[data-atras]').forEach((b) => (b.onclick = volver)); }

// ---------- Inicio ----------
function vInicio() {
  const t = S.c.tema, ks = cats(), ben = t.beneficios || {};
  const normales = ks.filter((k) => k.id !== 'combos'), combos = ks.find((k) => k.id === 'combos');
  const hayCombos = combos && S.c.servicios.some((s) => s.categoria === 'combos');
  const ig = S.c.instagram ? String(S.c.instagram).replace(/^@/, '') : '';
  app.innerHTML = `
    <section class="e-hero">
      <img class="e-logo" src="${esc(logoTema(t))}" alt="${esc(S.c.nombre)}" width="168" height="168">
      <p class="e-marca">${esc(t.titulo || S.c.nombre)}</p>
      ${t.subtitulo ? `<p class="e-submarca">${esc(t.subtitulo)}</p>` : ''}
      ${t.lema ? `<p class="e-lema">${esc(t.lema)}</p>` : ''}
    </section>
    <section class="e-hoja" id="servicios">
      <h2 class="e-h2">¿Qué servicio te gustaría reservar?</h2>
      <p class="e-ayuda">Tocá una opción para ver los servicios.</p>
      <div class="e-cats">${normales.map((k) => `
        <button type="button" class="e-cat" data-cat="${esc(k.id)}">
          <span class="e-cat-ic">${ic(k.icono)}</span>
          <span class="e-cat-nombre">${esc(k.nombre)}</span>
          ${k.sub ? `<span class="e-cat-sub">${esc(k.sub)}</span>` : ''}
        </button>`).join('')}
      </div>
      ${hayCombos ? `<button type="button" class="e-combo-card" data-cat="combos">
          <span class="e-cat-ic e-cat-ic-oro">${ic(combos.icono || 'regalo')}</span>
          <span class="e-combo-txt"><b>${esc(combos.nombre)}</b>${combos.sub ? `<span>${esc(combos.sub)}</span>` : ''}</span>
          ${ic('flecha', 'e-chev')}
        </button>` : ''}
      ${ben.titulo ? `<div class="e-beneficios">
          <span class="e-ben-ic">${ic('estrella')}</span>
          <div><p class="e-ben-titulo">${esc(ben.titulo)}</p>${ben.texto ? `<p class="e-ben-texto">${esc(ben.texto)}</p>` : ''}</div>
        </div>` : ''}
      <button type="button" class="e-btn e-btn-oro" id="e-reservar">Reservar mi turno</button>
      ${ig || S.c.whatsapp ? `<div class="e-redes">
        ${S.c.whatsapp ? `<a href="${linkWhatsApp(S.c.whatsapp, '¡Hola! Quería consultar por un turno.')}" target="_blank" rel="noopener">${ic('whatsapp')}WhatsApp</a>` : ''}
        ${ig ? `<a href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">@${esc(ig)}</a>` : ''}
      </div>` : ''}
      ${S.c.zona ? `<p class="e-zona">${esc(S.c.zona)}</p>` : ''}
    </section>`;
  $$('[data-cat]').forEach((b) => (b.onclick = () => ir({ p: 'categoria', cat: b.dataset.cat })));
  $('#e-reservar').onclick = () => {
    const g = $('.e-cats'); g.scrollIntoView({ behavior: 'smooth', block: 'center' });
    g.classList.remove('e-pulso'); void g.offsetWidth; g.classList.add('e-pulso');
  };
}

// ---------- Categoría ----------
function vCategoria() {
  const k = catDe(S.cat) || { id: S.cat, nombre: 'Servicios' };
  const lista = S.c.servicios.filter((s) => s.categoria === k.id).sort(ordenar);
  app.innerHTML = cabecera(k.nombre) + `
    ${k.sub ? `<p class="e-ayuda e-ayuda-top">${esc(k.sub)}</p>` : ''}
    <div class="e-lista">${lista.length ? lista.map((s) => {
      const inc = esCombo(s) ? [incluyeTexto(s)] : [], img = imagenDe(s);
      return `<button type="button" class="e-srv${s.proximamente ? ' e-srv-off' : ''}${img ? ' e-srv-img' : ''}" data-srv="${s.id}" ${s.proximamente ? 'disabled aria-disabled="true"' : ''}>
        ${img ? `<img class="e-srv-foto" src="${esc(img)}" alt="" loading="lazy">` : ''}
        <span class="e-srv-txt">
          <span class="e-srv-nombre">${esc(s.nombre)}</span>
          ${inc.length ? `<span class="e-srv-inc">Incluye: ${esc(inc[0])}</span>` : ''}
          ${s.proximamente ? '<span class="e-prox">Próximamente</span>' : `<span class="e-srv-meta">${ic('reloj')}${esc(duracionTexto(s.duracion_min))}</span>`}
        </span>
        ${s.proximamente ? '' : `<span class="e-srv-precio">${precioDe(s)}</span>${ic('flecha', 'e-chev')}`}
      </button>`;
    }).join('') : '<p class="e-vacio">Todavía no hay servicios en esta categoría.</p>'}</div>`;
  enganchar();
  $$('[data-srv]:not([disabled])').forEach((b) => (b.onclick = () => ir({ p: 'servicio', srv: b.dataset.srv })));
}

// ---------- Servicio + extras ----------
function extrasDe(s) {
  const catsSrv = new Set([s.categoria, ...(esCombo(s) ? [...s.combo_ids.map(srvDe), ...opcionesDe(s)].filter(Boolean).map((x) => x.categoria) : [])]);
  return (S.c.extras || []).filter((x) => x.categoria && catsSrv.has(x.categoria)).sort(ordenar);
}
function totales() {
  const s = srvDe(S.srv), ops = opcionesDe(s), op = srvDe(S.opcion);
  let min = s.duracion_min - (ops.length && op ? Math.max(...ops.map((x) => x.duracion_min)) - op.duracion_min : 0), precio = s.precio || 0, desde = !!s.precio_desde;
  extrasDe(s).forEach((x) => {
    const n = S.extras[x.id] || 0; if (!n) return;
    min += (x.extra_min || 0) * (x.extra_por_unidad ? n : 1); precio += (x.precio || 0) * n; if (x.precio_desde) desde = true;
  });
  return { min, precio, desde, consultar: s.precio == null };
}
const extrasArg = () => [...(S.opcion ? [{ opcion: S.opcion }] : []), ...Object.entries(S.extras).filter(([, n]) => n > 0).map(([id, cantidad]) => ({ id, cantidad }))];

function vServicio() {
  const s = srvDe(S.srv);
  if (!s) return ir({ p: 'inicio' });
  const xs = extrasDe(s), inc = esCombo(s) ? s.combo_ids.map(srvDe).filter(Boolean) : [], ops = opcionesDe(s), img = imagenDe(s);
  app.innerHTML = cabecera(s.nombre) + `
    ${img ? `<img class="e-portada" src="${esc(img)}" alt="${esc(s.nombre)}">` : ''}
    <div class="e-tarjeta">
      <div class="e-fila-precio"><span>${ic('reloj')}${esc(duracionTexto(s.duracion_min))}</span><b>${precioDe(s)}</b></div>
      ${s.descripcion && !/^Combo de ejemplo/.test(s.descripcion) ? `<p class="e-desc">${esc(s.descripcion)}</p>` : ''}
      ${inc.length ? `<p class="e-sub-h">Este combo incluye</p><ul class="e-inc">${inc.map((x) => `<li>${ic('ok')}<span>${esc(x.nombre)}</span><small>${esc(duracionTexto(x.duracion_min))}</small></li>`).join('')}</ul>
        ${ops.length ? `<p class="e-sub-h">Elegí uno para manos</p><div class="e-opciones" role="radiogroup">${ops.map((o) => `
          <label class="e-extra e-extra-check e-opcion"><input type="radio" name="e-op" value="${o.id}" ${S.opcion === o.id ? 'checked' : ''}>
          <span class="e-check e-radio" aria-hidden="true">${ic('ok')}</span><div class="e-extra-txt"><b>${esc(o.nombre)}</b><span>${esc(duracionTexto(o.duracion_min))}</span></div></label>`).join('')}</div>` : ''}
        <p class="e-nota">Se reserva como un solo turno de ${esc(duracionTexto(s.duracion_min))}.</p>` : ''}
    </div>
    ${xs.length ? `<h2 class="e-h3">¿Querés sumar algo?</h2><div class="e-extras">${xs.map((x) => x.extra_por_unidad ? `
      <div class="e-extra" data-x="${x.id}">
        <div class="e-extra-txt"><b>${esc(x.nombre)}</b><span>${pesos(x.precio)} c/u${x.extra_min ? ` · +${x.extra_min} min c/u` : ''}</span>${x.descripcion ? `<small>${esc(x.descripcion)}</small>` : ''}</div>
        <div class="e-cant" role="group" aria-label="Cantidad de ${esc(x.nombre)}">
          <button type="button" class="e-cant-btn" data-menos aria-label="Una menos">${ic('menos')}</button>
          <output class="e-cant-n" aria-live="polite">${S.extras[x.id] || 0}</output>
          <button type="button" class="e-cant-btn" data-mas aria-label="Una más">${ic('mas')}</button>
        </div>
      </div>` : `
      <label class="e-extra e-extra-check" data-x="${x.id}">
        <input type="checkbox" ${S.extras[x.id] ? 'checked' : ''}>
        <span class="e-check" aria-hidden="true">${ic('ok')}</span>
        <div class="e-extra-txt"><b>${esc(x.nombre)}</b><span>${x.extra_min ? `+${x.extra_min} min · ` : ''}${precioDe(x)}</span>${x.descripcion ? `<small>${esc(x.descripcion)}</small>` : ''}</div>
      </label>`).join('')}</div>` : ''}
    <div class="e-total" id="e-total"></div>
    <button type="button" class="e-btn e-btn-oro" id="e-seguir">Elegir día y horario</button>`;
  enganchar();
  const pintarTotal = () => {
    const t = totales();
    $('#e-total').innerHTML = `<span>Total estimado</span><b>${t.consultar ? 'Consultar' : `${t.desde ? 'desde ' : ''}${pesos(t.precio)}`}</b><span class="e-total-dur">${ic('reloj')}${esc(duracionTexto(t.min))}</span>`;
  };
  $$('.e-extra').forEach((el) => {
    const id = el.dataset.x, x = xs.find((y) => y.id === id);
    const chk = el.querySelector('input');
    if (chk) chk.onchange = () => { S.extras[id] = chk.checked ? 1 : 0; S.libres = null; pintarTotal(); };
    const cambiar = (d) => { S.extras[id] = Math.max(0, Math.min(10, (S.extras[id] || 0) + d)); el.querySelector('output').textContent = S.extras[id]; S.libres = null; pintarTotal(); };
    el.querySelector('[data-mas]') && (el.querySelector('[data-mas]').onclick = () => cambiar(1));
    el.querySelector('[data-menos]') && (el.querySelector('[data-menos]').onclick = () => cambiar(-1));
    void x;
  });
  pintarTotal();
  $$('input[name=e-op]').forEach((i) => (i.onchange = () => { S.opcion = i.value; S.libres = null; pintarTotal(); }));
  $('#e-seguir').onclick = () => {
    if (ops.length && !S.opcion) { toast('Elegí una opción para manos.', 'error'); $('.e-opciones').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ir({ p: 'calendario' });
  };
}

// ---------- Calendario ----------
async function cargarLibres() {
  const hoy = hoyAR(), hasta = sumarDias(hoy, Math.min(61, S.c.dias_reserva || 30));
  const { data, error } = await sb.rpc('pro_disponibilidad', { p_slug: S.slug, p_servicio_id: S.srv, p_extras: extrasArg(), p_desde: hoy, p_hasta: hasta });
  if (error) throw error;
  const m = new Map();
  (data || []).forEach((r) => { const h = hora5(r.hora); m.has(r.fecha) ? m.get(r.fecha).push(h) : m.set(r.fecha, [h]); });
  S.libres = { hoy, hasta, dias: m };
}

async function vCalendario() {
  if (!srvDe(S.srv)) return ir({ p: 'inicio' });
  app.innerHTML = cabecera('Elegí el día') + `<div class="e-tarjeta e-cal" id="e-cal"><div class="e-cargando"><span class="spinner"></span> Buscando días libres…</div></div>
    <div id="e-horas"></div>`;
  enganchar();
  try { if (!S.libres) await cargarLibres(); }
  catch (e) { $('#e-cal').innerHTML = `<p class="e-vacio">${esc(mensajeError(e))}</p><button class="e-btn e-btn-borde" id="e-reint">Reintentar</button>`; $('#e-reint').onclick = () => vCalendario(); return; }
  if (S.fecha && !S.libres.dias.has(S.fecha)) { S.fecha = null; S.hora = null; }
  if (!S.mes) S.mes = (S.fecha || [...S.libres.dias.keys()][0] || S.libres.hoy).slice(0, 7);
  pintarMes(); pintarHoras();
}

function pintarMes() {
  const { hoy, hasta, dias } = S.libres;
  const [y, m] = S.mes.split('-').map(Number);
  const primero = `${S.mes}-01`, ndias = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (diaSemana(primero) + 6) % 7; // semana empieza en lunes
  const minMes = hoy.slice(0, 7), maxMes = hasta.slice(0, 7);
  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push('<span class="e-dia e-dia-vacio"></span>');
  for (let d = 1; d <= ndias; d++) {
    const f = `${S.mes}-${String(d).padStart(2, '0')}`, libre = dias.has(f);
    celdas.push(libre
      ? `<button type="button" class="e-dia e-dia-libre${f === S.fecha ? ' e-dia-sel' : ''}${f === hoy ? ' e-dia-hoy' : ''}" data-f="${f}" aria-pressed="${f === S.fecha}" aria-label="${esc(capitalizar(fechaLarga(f)))}, ${dias.get(f).length} horarios">${d}</button>`
      : `<span class="e-dia e-dia-off" aria-hidden="true">${d}</span>`);
  }
  $('#e-cal').innerHTML = `
    <div class="e-mes">
      <button type="button" class="e-mes-btn" id="e-mes-ant" aria-label="Mes anterior" ${S.mes <= minMes ? 'disabled' : ''}>${ic('atras')}</button>
      <p class="e-mes-nombre">${capitalizar(MESES[m - 1])} ${y}</p>
      <button type="button" class="e-mes-btn" id="e-mes-sig" aria-label="Mes siguiente" ${S.mes >= maxMes ? 'disabled' : ''}>${ic('flecha')}</button>
    </div>
    <div class="e-sem">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="e-grilla">${celdas.join('')}</div>
    ${dias.size ? '<p class="e-leyenda"><span class="e-ley-libre"></span>Con turnos libres <span class="e-ley-off"></span>Sin turnos</p>' : '<p class="e-vacio">No hay turnos libres por ahora. Probá más adelante.</p>'}`;
  const mover = (n) => { const d = parseFecha(primero); d.setUTCMonth(d.getUTCMonth() + n); S.mes = d.toISOString().slice(0, 7); pintarMes(); };
  $('#e-mes-ant').onclick = () => mover(-1);
  $('#e-mes-sig').onclick = () => mover(1);
  $$('.e-dia-libre').forEach((b) => (b.onclick = () => { S.fecha = b.dataset.f; S.hora = null; pintarMes(); pintarHoras(true); }));
}

function pintarHoras(scroll = false) {
  const caja = $('#e-horas');
  if (!S.fecha) { caja.innerHTML = '<p class="e-ayuda e-ayuda-top">Tocá un día resaltado para ver los horarios.</p>'; return; }
  const hs = S.libres.dias.get(S.fecha) || [], t = totales();
  caja.innerHTML = `<h2 class="e-h3">${esc(capitalizar(fechaLarga(S.fecha)))}</h2>
    <p class="e-ayuda">Horarios disponibles para ${esc(duracionTexto(t.min))}:</p>
    <div class="e-horas">${hs.map((h) => `<button type="button" class="e-hora${h === S.hora ? ' e-hora-sel' : ''}" data-h="${h}" aria-pressed="${h === S.hora}">${h}</button>`).join('')}</div>
    <button type="button" class="e-btn e-btn-oro" id="e-cont" ${S.hora ? '' : 'disabled'}>${S.hora ? `Continuar con las ${S.hora} h` : 'Elegí un horario'}</button>`;
  $$('.e-hora').forEach((b) => (b.onclick = () => { S.hora = b.dataset.h; pintarHoras(); $('#e-cont').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  $('#e-cont').onclick = () => S.hora && ir({ p: 'datos' });
  if (scroll) caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Datos + envío ----------
function resumenHTML() {
  const s = srvDe(S.srv), t = totales();
  const ex = (S.c.extras || []).filter((x) => S.extras[x.id] > 0).map((x) => `${x.nombre}${x.extra_por_unidad ? ` ×${S.extras[x.id]}` : ''}`);
  return `<dl class="e-resumen">
    <div><dt>Servicio</dt><dd>${esc(s.nombre)}${S.opcion ? `<br><small>${esc(srvDe(S.opcion)?.nombre || '')}</small>` : ''}${ex.length ? `<br><small>+ ${esc(ex.join(', '))}</small>` : ''}</dd></div>
    <div><dt>Día</dt><dd>${esc(capitalizar(fechaLarga(S.fecha)))}</dd></div>
    <div><dt>Hora</dt><dd>${esc(S.hora)} h · ${esc(duracionTexto(t.min))}</dd></div>
    <div><dt>Total</dt><dd>${t.consultar ? 'Consultar' : `${t.desde ? 'desde ' : ''}${pesos(t.precio)}`}</dd></div>
  </dl>`;
}

function vDatos() {
  if (!S.fecha || !S.hora) return ir({ p: 'inicio' });
  let previo = {}; try { previo = JSON.parse(localStorage.getItem(CLAVE_CLIENTA)) || {}; } catch { /* nada */ }
  app.innerHTML = cabecera('Tus datos') + `
    <div class="e-tarjeta">${resumenHTML()}</div>
    <form class="e-form" id="e-form" novalidate>
      <label class="e-campo"><span>Nombre y apellido</span><input id="e-nombre" autocomplete="name" maxlength="60" required value="${esc(previo.nombre || '')}"></label>
      <label class="e-campo"><span>Teléfono (WhatsApp)</span><input id="e-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required placeholder="Ej: 11 2345 6789" value="${esc(previo.telefono || '')}"></label>
      <label class="e-campo"><span>Comentario <small>(opcional)</small></span><textarea id="e-notas" rows="3" maxlength="200" placeholder="Algo que quieras contarme"></textarea></label>
      <div class="e-campo"><span>Foto del diseño <small>(opcional, hasta ${MAX_REFS})</small></span>
        <div class="e-fotos" id="e-fotos"></div>
        <label class="e-btn e-btn-borde e-btn-foto">${ic('foto')}Agregar foto<input type="file" accept="image/*" multiple id="e-file" hidden></label>
      </div>
      <p class="e-error" id="e-error" role="alert" hidden></p>
      <button type="submit" class="e-btn e-btn-oro" id="e-enviar">Confirmar pedido de turno</button>
      <p class="e-nota">Tu turno queda pendiente hasta que te lo confirmemos.</p>
    </form>`;
  enganchar();
  pintarFotos();
  $('#e-file').onchange = async (ev) => {
    for (const f of [...ev.target.files].slice(0, MAX_REFS - S.refs.length)) {
      try { const { blob } = await comprimirFoto(f, { lado: 1000, kb: 300, formato: 'image/jpeg' }); S.refs.push({ blob, url: URL.createObjectURL(blob) }); }
      catch { toast('No se pudo leer esa foto. Probá con otra.', 'error'); }
    }
    ev.target.value = ''; pintarFotos();
  };
  $('#e-form').onsubmit = (ev) => { ev.preventDefault(); enviar(); };
}
function pintarFotos() {
  $('#e-fotos').innerHTML = S.refs.map((r, i) => `<span class="e-foto"><img src="${r.url}" alt="Foto ${i + 1}"><button type="button" data-q="${i}" aria-label="Quitar foto">×</button></span>`).join('');
  $$('[data-q]').forEach((b) => (b.onclick = () => { const [r] = S.refs.splice(+b.dataset.q, 1); URL.revokeObjectURL(r.url); pintarFotos(); }));
  $('.e-btn-foto').hidden = S.refs.length >= MAX_REFS;
}

async function enviar() {
  if (S.enviando) return;
  const nombre = $('#e-nombre').value.trim().replace(/\s+/g, ' '), tel = normalizarTelefono($('#e-tel').value), notas = $('#e-notas').value.trim();
  const err = $('#e-error');
  const fallo = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (nombre.length < 2) return fallo('Escribí tu nombre.');
  if (!/^[0-9]{8,15}$/.test(tel)) return fallo('Revisá el teléfono: escribilo con código de área, sin 0 ni 15.');
  err.hidden = true; S.enviando = true;
  const b = $('#e-enviar'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Enviando…';
  try {
    const { data, error } = await sb.rpc('pro_reservar', {
      p_slug: S.slug, p_servicio_id: S.srv, p_extras: extrasArg(), p_fecha: S.fecha, p_hora: S.hora,
      p_nombre: nombre, p_telefono: tel, p_notas: notas || null, p_fotos: S.refs.length,
    });
    if (error) throw error;
    localStorage.setItem(CLAVE_CLIENTA, JSON.stringify({ nombre, telefono: $('#e-tel').value.trim() }));
    const refs = S.refs.splice(0);
    confirmacion(data, nombre, refs.length && data.ref_token ? refs.length : 0);
    if (refs.length && data.ref_token) {
      const ok = await subirRefs(data.id, data.ref_token, refs.map((r) => r.blob));
      const est = $('#e-refs');
      if (est) est.textContent = ok ? 'Fotos del diseño enviadas.' : 'Tu turno quedó pedido, pero no pudimos enviar las fotos. Mandalas por WhatsApp.';
    }
  } catch (e) {
    b.disabled = false; b.textContent = 'Confirmar pedido de turno';
    const msg = mensajeError(e);
    if (/HORARIO_OCUPADO|FUERA_DE_HORARIO|FECHA_INVALIDA|ocupad/i.test(String(e?.message))) {
      toast('Ese horario se acaba de ocupar. Elegí otro, por favor.', 'error');
      S.libres = null; S.hora = null; history.back();
    } else fallo(msg);
  } finally { S.enviando = false; }
}

async function subirRefs(turnoId, token, blobs) {
  const fd = new FormData();
  fd.append('turno_id', turnoId); fd.append('token', token);
  blobs.forEach((bl, i) => fd.append('foto', bl, `referencia-${i + 1}.jpg`));
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`${FUNCIONES_URL}/referencias-turno`, { method: 'POST', body: fd, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j.fotos || blobs.length;
      if (r.status < 500) return 0;
    } catch { /* reintenta */ }
  }
  return 0;
}

function confirmacion(r, nombre, nFotos) {
  const c = S.c, sena = r.sena || 0, alias = r.alias_pago || c.alias_pago || '';
  const msg = `¡Hola! Soy ${nombre}. Pedí turno de ${r.servicio_nombre} ${fechaRelativa(r.fecha)} a las ${hora5(r.hora_inicio)} h.`;
  const wa = c.whatsapp ? linkWhatsApp(c.whatsapp, msg) : '';
  app.innerHTML = `<section class="e-hero e-hero-chico"><img class="e-logo e-logo-chico" src="${esc(logoTema(c.tema))}" alt="${esc(c.nombre)}" width="96" height="96"></section>
    <section class="e-hoja e-conf" aria-live="polite">
      <div class="e-ok">${ic('ok')}</div>
      <h1 class="e-h2">¡Pedido enviado!</h1>
      <p class="e-ayuda">Te confirmamos el turno a la brevedad.</p>
      <div class="e-tarjeta"><dl class="e-resumen">
        <div><dt>Servicio</dt><dd>${esc(r.servicio_nombre)}</dd></div>
        <div><dt>Día</dt><dd>${esc(capitalizar(fechaLarga(r.fecha)))}</dd></div>
        <div><dt>Hora</dt><dd>${esc(hora5(r.hora_inicio))} a ${esc(hora5(r.hora_fin))} h</dd></div>
        <div><dt>Total</dt><dd>${r.precio == null ? 'Consultar' : pesos(r.precio)}</dd></div>
        ${sena ? `<div><dt>Seña</dt><dd>${pesos(sena)}${alias ? ` · alias <b>${esc(alias)}</b>` : ''}</dd></div>` : ''}
        <div><dt>Estado</dt><dd><span class="e-chip">Pendiente de confirmación</span></dd></div>
      </dl></div>
      ${nFotos ? `<p class="e-nota" id="e-refs" role="status">Enviando fotos del diseño…</p>` : ''}
      ${wa ? `<a class="e-btn e-btn-oro" href="${wa}" target="_blank" rel="noopener">${ic('whatsapp')}Avisar por WhatsApp</a>` : ''}
      <button type="button" class="e-btn e-btn-borde" id="e-otro">Volver al inicio</button>
    </section>`;
  $('#e-otro').onclick = () => { S.srv = null; S.libres = null; S.fecha = null; S.hora = null; S.mes = null; history.replaceState({ p: 'inicio' }, ''); mostrar({ p: 'inicio' }, false); };
  history.replaceState({ p: 'confirmado' }, '');
  scrollTo(0, 0);
}
