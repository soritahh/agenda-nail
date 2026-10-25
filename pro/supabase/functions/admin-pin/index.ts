// Edge Function 'admin-pin': acceso con PIN (6 dígitos) de las manicuristas al panel PRO.
//   accion 'codigo'  (sólo superadmin): genera un código de activación de un solo uso (vence en 7 días) para una
//                    agenda. Si ella ya tenía PIN, ese PIN deja de servir y se cierran sus sesiones.
//   accion 'activar' (pública): agenda + código + PIN elegido por ella -> crea/actualiza su acceso y borra el código.
//   accion 'cambiar' (la dueña con sesión): PIN actual + PIN nuevo.
// Cada agenda tiene un usuario de Auth con correo sintético <slug>@pin.agenda-nail.invalid (dominio .invalid: nunca
// se envía un mail), creado ya confirmado, con el PIN como contraseña. La service role vive sólo en el entorno de la
// función (SUPABASE_SERVICE_ROLE_KEY la inyecta Supabase); nunca está en el frontend ni en el repo.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const DOMINIO_PIN = 'pin.agenda-nail.invalid';
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin I, L, O, 0, 1 para que no se confundan
const LARGO_CODIGO = 8;
const DIAS_VALIDEZ = 7;
const MAX_INTENTOS_CODIGO = 5;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function respuesta(status: number, cuerpo: Record<string, unknown>) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const falla = (status: number, error: string, mensaje: string) => respuesta(status, { error, mensaje });

/** null si el PIN sirve; si no, el motivo en castellano. */
export function problemaPin(pin: unknown): string | null {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'El PIN tiene que tener exactamente 6 números.';
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return 'Ese PIN es muy fácil de adivinar (todos los números iguales).';
  const paso = d[1] - d[0];
  if (Math.abs(paso) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === paso)) return 'Ese PIN es muy fácil de adivinar (números seguidos).';
  if (pin.slice(0, 3) === pin.slice(3) || pin.slice(0, 2).repeat(3) === pin) return 'Ese PIN es muy fácil de adivinar (se repite).';
  if (['112233', '123321', '102030', '159753', '147258', '258369', '789456', '456123', '131313', '010101'].includes(pin)) {
    return 'Ese PIN es muy fácil de adivinar. Elige otro.';
  }
  return null;
}

function codigoNuevo(): string {
  let s = '';
  while (s.length < LARGO_CODIGO) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < ALFABETO.length * 8 && s.length < LARGO_CODIGO) s += ALFABETO[b % ALFABETO.length]; // sin sesgo
    }
  }
  return s;
}
const normalizarCodigo = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function hashCodigo(profesionalId: string, codigo: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${profesionalId}:${codigo}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function claveAzar(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Pro = { id: string; slug: string; user_id: string | null };

/** El usuario de PIN de la agenda (el vinculado si es de PIN, o el que tenga su correo sintético), o null. */
async function usuarioPin(admin: SupabaseClient, pro: Pro): Promise<string | null> {
  if (pro.user_id) {
    const { data: u } = await admin.auth.admin.getUserById(pro.user_id);
    if (u?.user?.email?.toLowerCase().endsWith(`@${DOMINIO_PIN}`)) return u.user.id;
  }
  const { data } = await admin.rpc('pro_srv_usuario_por_email', { p_email: `${pro.slug}@${DOMINIO_PIN}` });
  return (data as string | null) || null;
}

/** Comprueba que la cuenta se pueda tocar: nunca un superadmin ni la cuenta de otra agenda. */
async function cuentaProtegida(admin: SupabaseClient, uid: string, pro: Pro): Promise<Response | null> {
  const { data: esSa } = await admin.from('superadmins').select('user_id').eq('user_id', uid).maybeSingle();
  if (esSa) return falla(409, 'CUENTA_PROTEGIDA', 'Esa cuenta no se puede modificar desde aquí.');
  const { data: otra } = await admin.from('profesionales').select('id').eq('user_id', uid).neq('id', pro.id).maybeSingle();
  if (otra) return falla(409, 'CUENTA_CON_OTRA_AGENDA', 'Ese acceso ya está vinculado a otra agenda.');
  return null;
}

// ---------- superadmin: generar código ----------
async function generarCodigo(admin: SupabaseClient, req: Request, cuerpo: Record<string, unknown>) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: quien } = token ? await admin.auth.getUser(token) : { data: null };
  if (!quien?.user) return falla(401, 'SIN_SESION', 'Tienes que iniciar sesión.');
  const { data: sa, error: errSa } = await admin.from('superadmins').select('user_id').eq('user_id', quien.user.id).maybeSingle();
  if (errSa) return falla(500, 'ERROR', 'No se pudo verificar el permiso.');
  if (!sa) return falla(403, 'SIN_PERMISO', 'No tienes permiso para esto.');

  if (!UUID_RE.test(String(cuerpo.profesional_id || ''))) return falla(400, 'DATOS_INVALIDOS', 'Agenda inválida.');
  const { data: pro } = await admin.from('profesionales').select('id, slug, user_id').eq('id', cuerpo.profesional_id).maybeSingle();
  if (!pro) return falla(404, 'NO_ENCONTRADA', 'No existe esa agenda.');

  // Si ya tenía PIN, lo anulamos (clave al azar) y cerramos sus sesiones: tendrá que activar de nuevo.
  const uid = await usuarioPin(admin, pro);
  let pinAnulado = false;
  if (uid) {
    const prot = await cuentaProtegida(admin, uid, pro);
    if (prot) return prot;
    const { error } = await admin.auth.admin.updateUserById(uid, { password: claveAzar() });
    if (error) return falla(500, 'AUTH', 'No se pudo anular el PIN anterior.');
    await admin.rpc('pro_srv_cerrar_sesiones', { p_uid: uid });
    pinAnulado = true;
  }

  const codigo = codigoNuevo();
  const expira = new Date(Date.now() + DIAS_VALIDEZ * 864e5).toISOString();
  const { error } = await admin.from('pro_activaciones').upsert({
    profesional_id: pro.id, codigo_hash: await hashCodigo(pro.id, codigo), expira, intentos: 0, created_at: new Date().toISOString(),
  });
  if (error) return falla(500, 'ERROR', 'No se pudo guardar el código.');
  return respuesta(200, { ok: true, codigo, expira, slug: pro.slug, pin_anulado: pinAnulado });
}

// ---------- pública: activar con código y elegir PIN ----------
async function activar(admin: SupabaseClient, cuerpo: Record<string, unknown>) {
  const INCORRECTO = () => falla(400, 'CODIGO_INCORRECTO', 'Agenda o código incorrectos. Revisa e intenta de nuevo.');
  const slug = String(cuerpo.slug || '').trim().toLowerCase();
  const codigo = normalizarCodigo(cuerpo.codigo);
  if (!SLUG_RE.test(slug) || codigo.length !== LARGO_CODIGO) return INCORRECTO();
  const motivo = problemaPin(cuerpo.pin);
  if (motivo) return falla(400, 'PIN_DEBIL', motivo);

  const { data: pro } = await admin.from('profesionales').select('id, slug, user_id').eq('slug', slug).maybeSingle();
  if (!pro) return INCORRECTO();
  const { data: act } = await admin.from('pro_activaciones').select('codigo_hash, expira, intentos').eq('profesional_id', pro.id).maybeSingle();
  if (!act) return INCORRECTO();
  if (new Date(act.expira).getTime() <= Date.now()) {
    await admin.from('pro_activaciones').delete().eq('profesional_id', pro.id);
    return falla(400, 'CODIGO_VENCIDO', 'Ese código ya venció. Pídele uno nuevo a Agustin.');
  }
  if ((await hashCodigo(pro.id, codigo)) !== act.codigo_hash) {
    const intentos = act.intentos + 1;
    if (intentos >= MAX_INTENTOS_CODIGO) {
      await admin.from('pro_activaciones').delete().eq('profesional_id', pro.id);
      return falla(429, 'CODIGO_BLOQUEADO', 'Demasiados intentos con un código incorrecto. Pídele uno nuevo a Agustin.');
    }
    await admin.from('pro_activaciones').update({ intentos }).eq('profesional_id', pro.id);
    return INCORRECTO();
  }

  // Código correcto: un solo uso. Se borra antes de crear el acceso para que no se pueda usar dos veces.
  const { data: borrado } = await admin.from('pro_activaciones').delete().eq('profesional_id', pro.id).eq('codigo_hash', act.codigo_hash).select('profesional_id');
  if (!borrado?.length) return INCORRECTO();

  const pin = cuerpo.pin as string;
  const email = `${pro.slug}@${DOMINIO_PIN}`;
  const meta = { app_metadata: { acceso: 'pin', profesional_id: pro.id } };
  let uid = await usuarioPin(admin, pro);
  let creado = false;
  if (uid) {
    const prot = await cuentaProtegida(admin, uid, pro);
    if (prot) return prot;
    const { error } = await admin.auth.admin.updateUserById(uid, { email, password: pin, email_confirm: true, ...meta });
    if (error) return falla(500, 'AUTH', 'No se pudo guardar el PIN. Pídele un código nuevo a Agustin.');
    await admin.rpc('pro_srv_cerrar_sesiones', { p_uid: uid });
  } else {
    const { data: nuevo, error } = await admin.auth.admin.createUser({ email, password: pin, email_confirm: true, ...meta });
    if (error || !nuevo?.user) return falla(500, 'AUTH', 'No se pudo crear el acceso. Pídele un código nuevo a Agustin.');
    uid = nuevo.user.id;
    creado = true;
  }
  if (pro.user_id !== uid) {
    const { error } = await admin.from('profesionales').update({ user_id: uid }).eq('id', pro.id);
    if (error) {
      if (creado) await admin.auth.admin.deleteUser(uid);
      return falla(500, 'ERROR', 'No se pudo vincular el acceso. Pídele un código nuevo a Agustin.');
    }
  }
  return respuesta(200, { ok: true, slug: pro.slug, email });
}

// ---------- la dueña: cambiar su PIN ----------
async function cambiar(admin: SupabaseClient, url: string, req: Request, cuerpo: Record<string, unknown>) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: quien } = token ? await admin.auth.getUser(token) : { data: null };
  const email = quien?.user?.email?.toLowerCase() || '';
  if (!quien?.user || !email.endsWith(`@${DOMINIO_PIN}`)) return falla(401, 'SIN_SESION', 'Tu sesión no es válida. Vuelve a entrar.');
  const { data: pro } = await admin.from('profesionales').select('id').eq('user_id', quien.user.id).maybeSingle();
  if (!pro) return falla(403, 'SIN_PERMISO', 'Esta cuenta no tiene una agenda.');

  const actual = String(cuerpo.pin_actual ?? '');
  if (!/^\d{6}$/.test(actual)) return falla(400, 'PIN_ACTUAL', 'Tu PIN actual no es correcto.');
  const motivo = problemaPin(cuerpo.pin);
  if (motivo) return falla(400, 'PIN_DEBIL', motivo);
  if (cuerpo.pin === actual) return falla(400, 'PIN_IGUAL', 'El PIN nuevo tiene que ser distinto del actual.');

  // Verificar el PIN actual con un inicio de sesión normal (cuenta para los límites de Supabase Auth).
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) return falla(500, 'CONFIG', 'Falta configuración del servidor.');
  const prueba = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: errActual } = await prueba.auth.signInWithPassword({ email, password: actual });
  if (errActual) {
    return errActual.status === 429
      ? falla(429, 'DEMASIADOS', 'Demasiados intentos. Espera unos minutos.')
      : falla(400, 'PIN_ACTUAL', 'Tu PIN actual no es correcto.');
  }
  const { error } = await admin.auth.admin.updateUserById(quien.user.id, { password: cuerpo.pin as string });
  if (error) return falla(500, 'AUTH', 'No se pudo cambiar el PIN.');
  await admin.rpc('pro_srv_cerrar_sesiones', { p_uid: quien.user.id }); // cierra también otros teléfonos
  return respuesta(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falla(405, 'METODO', 'Método no permitido.');
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return falla(500, 'CONFIG', 'Falta configuración del servidor.');
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return falla(400, 'DATOS_INVALIDOS', 'Pedido inválido.'); }
  try {
    if (cuerpo.accion === 'codigo') return await generarCodigo(admin, req, cuerpo);
    if (cuerpo.accion === 'activar') return await activar(admin, cuerpo);
    if (cuerpo.accion === 'cambiar') return await cambiar(admin, url, req, cuerpo);
    return falla(400, 'DATOS_INVALIDOS', 'Acción desconocida.');
  } catch (_e) {
    return falla(500, 'ERROR', 'Algo salió mal. Intenta de nuevo.');
  }
});
