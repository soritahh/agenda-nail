// Edge Function 'notificar-turno': avisos push (Web Push) a la dueña de la agenda.
//   - Trigger de la base (pedido online nuevo): header x-notif-secret (vive sólo en Vault) + { turno_id }.
//     El turno se marca como avisado una sola vez (notificado_at) y sólo si es un pedido pendiente de los últimos
//     10 minutos: repetir la llamada no manda nada. Responde 202 al instante y envía en segundo plano; si la clienta
//     adjunta fotos, espera unos segundos a que terminen de subir para decir cuántas son.
//   - { accion: 'probar' } con la sesión de la dueña: notificación de prueba a sus propios dispositivos.
//   - { accion: 'clave' }: clave pública VAPID (la crea la primera vez; la privada queda en Vault).
// Suscripciones vencidas (404/410 del servicio de push) se borran.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { enviarPush, generarVapid } from './webpush.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUB_VAPID = 'https://agenda-nail.pages.dev';
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Config = { secreto: string | null; vapid: { publica: string; privada: string } };
let config: Config | null = null;
async function leerConfig(): Promise<Config> {
  if (config) return config;
  const { data, error } = await sb.rpc('pro_push_config');
  if (error) throw error;
  let publica = Deno.env.get('VAPID_PUBLIC_KEY') || data.vapid_publica;
  let privada = Deno.env.get('VAPID_PRIVATE_KEY') || data.vapid_privada;
  if (!publica || !privada) {
    const v = await generarVapid();
    const { error: e2 } = await sb.rpc('pro_push_guardar_vapid', { p_publica: v.publica, p_privada: v.privada });
    if (e2) throw e2;
    const { data: d2 } = await sb.rpc('pro_push_config'); // por si otra instancia la creó primero
    publica = d2.vapid_publica; privada = d2.vapid_privada;
  }
  config = { secreto: data.secreto, vapid: { publica, privada } };
  return config;
}

function igualSeguro(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function enviarA(profesionalId: string, datos: Record<string, unknown>) {
  const { vapid } = await leerConfig();
  const { data: subs, error } = await sb.from('pro_push_subs').select('id, endpoint, p256dh, auth').eq('profesional_id', profesionalId);
  if (error) throw error;
  const resultados = await Promise.all((subs || []).map(async (s) => {
    try {
      const r = await enviarPush(s, datos, vapid, { sub: SUB_VAPID });
      if (r.status === 404 || r.status === 410) await sb.from('pro_push_subs').delete().eq('id', s.id);
      return { host: new URL(s.endpoint).host, status: r.status };
    } catch (e) {
      return { host: new URL(s.endpoint).host, status: 0, error: String(e).slice(0, 120) };
    }
  }));
  return resultados;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function avisarTurno(t: Record<string, any>) {
  let fotos = t.ref_fotos?.length || 0;
  if (t.ref_fotos_esperadas > 0 && !t.ref_fotos) {
    for (let i = 0; i < 16 && !fotos; i++) { // hasta ~20 s a que terminen de subir las fotos
      await espera(1250);
      const { data } = await sb.from('pro_turnos').select('ref_fotos').eq('id', t.id).single();
      if (data?.ref_fotos) fotos = data.ref_fotos.length;
    }
  }
  const [a, m, d] = String(t.fecha).split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  const nombre = String(t.clienta_nombre || 'Una clienta').trim().split(/\s+/)[0];
  const cuerpo = `${nombre} pidió ${t.servicio_nombre} el ${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} a las ${String(t.hora_inicio).slice(0, 5)}`
    + (fotos ? ` · ${fotos} ${fotos === 1 ? 'foto' : 'fotos'}` : '');
  let icon: string | null = null;
  const { data: pro } = await sb.from('profesionales').select('logo_path').eq('id', t.profesional_id).single();
  if (pro?.logo_path) icon = sb.storage.from('pro-logos').getPublicUrl(pro.logo_path).data.publicUrl;
  const res = await enviarA(t.profesional_id, { title: 'Nuevo turno 💅', body: cuerpo, icon, tag: `turno-${t.id}`, url: 'panel.html#/proximos/pendientes' });
  console.log(JSON.stringify({ evento: 'aviso-turno', turno: t.id, fotos, envios: res }));
}

const ultimaPrueba = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'METODO' });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'JSON' }); }

  try {
    // 1) Llamada del trigger
    const secreto = req.headers.get('x-notif-secret');
    if (secreto !== null) {
      const cfg = await leerConfig();
      if (!igualSeguro(secreto, cfg.secreto || '')) return json(401, { error: 'SECRETO' });
      const id = String(body.turno_id || '');
      if (!UUID_RE.test(id)) return json(400, { error: 'TURNO' });
      const { data: t, error } = await sb.from('pro_turnos')
        .update({ notificado_at: new Date().toISOString() })
        .eq('id', id).is('notificado_at', null).eq('estado', 'pendiente')
        .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
        .select('id, profesional_id, clienta_nombre, servicio_nombre, fecha, hora_inicio, ref_fotos, ref_fotos_esperadas')
        .maybeSingle();
      if (error) throw error;
      if (!t) return json(200, { ok: true, enviado: false, motivo: 'ya avisado, inexistente o viejo' });
      // @ts-ignore EdgeRuntime existe en Supabase Edge Functions
      EdgeRuntime.waitUntil(avisarTurno(t).catch((e) => console.error('aviso-turno', String(e))));
      return json(202, { ok: true, enviado: true });
    }

    if (body.accion === 'clave') return json(200, { publica: (await leerConfig()).vapid.publica });

    // 2) Prueba desde el panel (sesión de la dueña)
    if (body.accion === 'probar') {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: { user } } = await sb.auth.getUser(jwt);
      if (!user) return json(401, { error: 'SIN_SESION', mensaje: 'Entra de nuevo a tu panel.' });
      const { data: pro } = await sb.from('profesionales').select('id, logo_path').eq('user_id', user.id).maybeSingle();
      if (!pro) return json(403, { error: 'SIN_PERMISO' });
      const antes = ultimaPrueba.get(pro.id) || 0;
      if (Date.now() - antes < 10_000) return json(429, { error: 'ESPERA', mensaje: 'Espera unos segundos antes de probar de nuevo.' });
      ultimaPrueba.set(pro.id, Date.now());
      const icon = pro.logo_path ? sb.storage.from('pro-logos').getPublicUrl(pro.logo_path).data.publicUrl : null;
      const res = await enviarA(pro.id, { title: 'Notificación de prueba 💅', body: 'Así te va a llegar cada pedido nuevo de tus clientas.', icon, tag: 'prueba', url: 'panel.html#/proximos/pendientes' });
      const ok = res.filter((r) => r.status >= 200 && r.status < 300).length;
      return json(200, { ok: true, dispositivos: res.length, enviadas: ok, estados: res.map((r) => r.status) });
    }
    return json(400, { error: 'ACCION' });
  } catch (e) {
    console.error('notificar-turno', String(e));
    return json(500, { error: 'INTERNO', mensaje: 'No se pudo enviar el aviso.' });
  }
});
