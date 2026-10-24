// Estado compartido mínimo y navegación.
export const estado = { perfil: null };

export function ir(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}
