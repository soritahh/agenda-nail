// Edge Function 'admin-pin': crea o cambia el PIN (6 dígitos) con el que una manicurista entra a su panel PRO.
// Sólo la puede usar un superadmin (tabla public.superadmins). La service role vive sólo en el entorno de la función
// (SUPABASE_SERVICE_ROLE_KEY lo inyecta Supabase); nunca está en el frontend ni en el repo.
// Cada agenda tiene un usuario de Auth con correo sintético <slug>@pin.agenda-nail.invalid (dominio .invalid:
// nunca se envía un mail) y el PIN como contraseña; se crea ya confirmado, así Supabase no manda correos.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DOMINIO_PIN = 'pin.agenda-nail.invalid';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falla(405, 'METODO', 'Método no permitido.');

  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return falla(500, 'CONFIG', 'Falta configuración del servidor.');
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) ¿Quién llama? Tiene que ser un superadmin con sesión válida.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return falla(401, 'SIN_SESION', 'Tienes que iniciar sesión.');
  const { data: quien, error: errQuien } = await admin.auth.getUser(token);
  if (errQuien || !quien?.user) return falla(401, 'SIN_SESION', 'Tu sesión no es válida. Vuelve a entrar.');
  const { data: sa, error: errSa } = await admin.from('superadmins').select('user_id').eq('user_id', quien.user.id).maybeSingle();
  if (errSa) return falla(500, 'ERROR', 'No se pudo verificar el permiso.');
  if (!sa) return falla(403, 'SIN_PERMISO', 'No tienes permiso para esto.');

  // 2) Datos
  let cuerpo: { accion?: string; profesional_id?: string; pin?: string };
  try { cuerpo = await req.json(); } catch { return falla(400, 'DATOS_INVALIDOS', 'Pedido inválido.'); }
  if (cuerpo.accion !== 'pin') return falla(400, 'DATOS_INVALIDOS', 'Acción desconocida.');
  if (!UUID_RE.test(String(cuerpo.profesional_id || ''))) return falla(400, 'DATOS_INVALIDOS', 'Agenda inválida.');
  const motivo = problemaPin(cuerpo.pin);
  if (motivo) return falla(400, 'PIN_DEBIL', motivo);
  const pin = cuerpo.pin as string;

  const { data: pro, error: errPro } = await admin.from('profesionales').select('id, slug, user_id').eq('id', cuerpo.profesional_id).maybeSingle();
  if (errPro) return falla(500, 'ERROR', 'No se pudo leer la agenda.');
  if (!pro) return falla(404, 'NO_ENCONTRADA', 'No existe esa agenda.');
  const email = `${pro.slug}@${DOMINIO_PIN}`;

  // 3) Usuario de la agenda: el ya vinculado si es de PIN, o el que tenga ese correo sintético, o uno nuevo.
  let uid: string | null = null;
  let creado = false;
  if (pro.user_id) {
    const { data: u } = await admin.auth.admin.getUserById(pro.user_id);
    if (u?.user?.email?.toLowerCase().endsWith(`@${DOMINIO_PIN}`)) uid = u.user.id;
  }
  if (!uid) {
    const { data: existente } = await admin.rpc('pro_srv_usuario_por_email', { p_email: email });
    if (existente) uid = existente as string;
  }
  // Nunca tocar la cuenta de un superadmin.
  if (uid) {
    const { data: esSa } = await admin.from('superadmins').select('user_id').eq('user_id', uid).maybeSingle();
    if (esSa) return falla(409, 'CUENTA_PROTEGIDA', 'Esa cuenta no se puede modificar desde aquí.');
    const { data: otra } = await admin.from('profesionales').select('id').eq('user_id', uid).neq('id', pro.id).maybeSingle();
    if (otra) return falla(409, 'CUENTA_CON_OTRA_AGENDA', 'Ese acceso ya está vinculado a otra agenda.');
  }

  const meta = { app_metadata: { acceso: 'pin', profesional_id: pro.id } };
  if (uid) {
    const { error } = await admin.auth.admin.updateUserById(uid, { email, password: pin, email_confirm: true, ...meta });
    if (error) return falla(400, 'AUTH', `No se pudo guardar el PIN: ${error.message}`);
  } else {
    const { data: nuevo, error } = await admin.auth.admin.createUser({ email, password: pin, email_confirm: true, ...meta });
    if (error || !nuevo?.user) return falla(400, 'AUTH', `No se pudo crear el acceso: ${error?.message || 'error'}`);
    uid = nuevo.user.id;
    creado = true;
  }

  if (pro.user_id !== uid) {
    const { error } = await admin.from('profesionales').update({ user_id: uid }).eq('id', pro.id);
    if (error) {
      if (creado) await admin.auth.admin.deleteUser(uid);
      return falla(500, 'ERROR', 'No se pudo vincular el acceso con la agenda.');
    }
  }
  // Un PIN nuevo cierra las sesiones abiertas con el PIN anterior (en otros teléfonos).
  if (!creado) await admin.rpc('pro_srv_cerrar_sesiones', { p_uid: uid });

  return respuesta(200, { ok: true, creado, slug: pro.slug });
});
