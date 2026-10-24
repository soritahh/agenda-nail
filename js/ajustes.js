// Ajustes: nombre de la profesional o del salón.
import { toast, errorGeneral, marcarError, limpiarErrores, limpiarErrorAlEditar } from './util.js';
import { guardarPerfil } from './datos.js';
import { estado } from './estado.js';

export async function render(cont) {
  const nombre = estado.perfil ? estado.perfil.nombre : '';
  cont.innerHTML = `
    <header class="cabecera">
      <h1>Ajustes</h1>
      <p class="cabecera-sub">Tus datos dentro de la app</p>
    </header>
    <form class="tarjeta form" id="form-ajustes" novalidate>
      <div class="campo">
        <label for="a-nombre">Tu nombre o el de tu salón</label>
        <input id="a-nombre" name="nombre" type="text" maxlength="60" value="">
      </div>
      <button type="submit" class="btn btn-primario btn-grande">Guardar</button>
    </form>
    <section class="tarjeta info-app">
      <h2>Sobre tus datos</h2>
      <p>Todo se guarda solo en este dispositivo y navegador. Si borras los datos del navegador, se pierden.</p>
      <p class="version">Agenda Nail · versión 1.0</p>
    </section>`;

  const form = cont.querySelector('#form-ajustes');
  form.nombre.value = nombre;
  limpiarErrorAlEditar(form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpiarErrores(form);
    const nuevo = form.nombre.value.trim();
    if (!nuevo) { marcarError(form, 'nombre', 'El nombre no puede quedar vacío.'); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const perfil = { ...(estado.perfil || {}), nombre: nuevo };
      await guardarPerfil(perfil);
      estado.perfil = perfil;
      toast('Ajustes guardados.');
    } catch (e) {
      errorGeneral(e);
    } finally {
      btn.disabled = false;
    }
  });
}
