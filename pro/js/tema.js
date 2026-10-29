// Tema visual por agenda (opt-in): sólo se aplica si la agenda tiene profesionales.tema (ej. plantilla "estudio").
// Las agendas sin tema (ej. Katia) no cargan nada de esto.
const RAIZ = new URL('../', import.meta.url).href;
const HEX = /^#[0-9a-f]{6}$/i;
const FUENTES_OK = /^[A-Za-z ]{2,40}$/;

export const urlTema = (ruta) => (ruta && !/^[a-z]+:|^\/\//i.test(ruta) && !ruta.includes('..') ? RAIZ + ruta.replace(/^\/+/, '') : '');
export const logoTema = (tema) => urlTema(tema?.logo);

export function aplicarTema(tema) {
  if (!tema || tema.plantilla !== 'estudio') return false;
  const c = tema.colores || {}, r = document.documentElement.style;
  const vars = { fondo: '--e-fondo', oro: '--e-oro', oro_claro: '--e-oro-claro', marfil: '--e-marfil', beige: '--e-beige', texto: '--e-texto' };
  Object.entries(vars).forEach(([k, v]) => { if (HEX.test(c[k] || '')) r.setProperty(v, c[k]); });
  const fuente = FUENTES_OK.test(tema.fuente_titulos || '') ? tema.fuente_titulos : 'Cormorant Garamond';
  r.setProperty('--e-serif', `'${fuente}', 'Playfair Display', Georgia, serif`);
  if (!document.getElementById('tema-fuente')) {
    const l = document.createElement('link'); l.id = 'tema-fuente'; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fuente).replace(/%20/g, '+')}:wght@500;600;700&display=swap`;
    document.head.appendChild(l);
  }
  if (!document.getElementById('tema-css')) {
    const l = document.createElement('link'); l.id = 'tema-css'; l.rel = 'stylesheet'; l.href = RAIZ + 'css/estudio.css?v=e3';
    document.head.appendChild(l);
  }
  document.body.classList.add('tema-estudio');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', HEX.test(c.fondo || '') ? c.fondo : '#0e0c09');
  const logo = logoTema(tema);
  if (logo) document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon]').forEach((l) => { l.href = logo; l.removeAttribute('type'); });
  return true;
}
