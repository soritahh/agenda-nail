// Edge Function 'referencias-turno': la clienta adjunta hasta 3 fotos del diseño a SU pedido recién creado.
// Pide el id del turno + el token de un solo uso que devolvió pro_solicitar_turno (en la base sólo está su hash y
// vence a los 15 minutos). El token se consume ANTES de subir (no se puede reutilizar). Valida cantidad, tamaño,
// tipo declarado y los primeros bytes (JPEG/WEBP/PNG reales). Sube con service role al bucket privado
// 'pro-referencias' en <profesional_id>/<turno_id>/; sólo la dueña de esa agenda puede leerlas (URLs firmadas).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTOS = 3, MAX_BYTES = 400 * 1024;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falla = (status: number, error: string, mensaje: string) => json(status, { error, mensaje });

function tipoReal(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  const t = new TextDecoder().decode(b.slice(0, 12));
  if (t.startsWith('RIFF') && t.slice(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
async function sha256hex(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falla(405, 'METODO', 'Método no permitido.');
  if (Number(req.headers.get('content-length') || 0) > MAX_FOTOS * MAX_BYTES + 64 * 1024) return falla(413, 'MUY_GRANDE', 'Las fotos pesan demasiado.');
  let form: FormData;
  try { form = await req.formData(); } catch { return falla(400, 'FORM', 'Datos inválidos.'); }
  const id = String(form.get('turno_id') || ''), token = String(form.get('token') || '');
  const archivos = form.getAll('foto').filter((f): f is File => f instanceof File);
  if (!UUID_RE.test(id) || !/^[0-9a-f]{64}$/.test(token)) return falla(400, 'DATOS', 'Datos inválidos.');
  if (!archivos.length || archivos.length > MAX_FOTOS) return falla(400, 'CANTIDAD', 'Puedes adjuntar hasta 3 fotos.');

  // Validar todo antes de consumir el token
  const fotos: { bytes: Uint8Array; mime: string; ext: string }[] = [];
  for (const f of archivos) {
    if (f.size <= 0 || f.size > MAX_BYTES) return falla(400, 'FOTO_INVALIDA', 'Cada foto puede pesar hasta 400 KB.');
    if (!['image/jpeg', 'image/webp', 'image/png'].includes(f.type)) return falla(400, 'FOTO_INVALIDA', 'Sólo imágenes JPG, WEBP o PNG.');
    const bytes = new Uint8Array(await f.arrayBuffer());
    const t = tipoReal(bytes);
    if (!t) return falla(400, 'FOTO_INVALIDA', 'El archivo no es una imagen válida.');
    fotos.push({ bytes, ...t });
  }

  try {
    const hash = await sha256hex(token);
    // Consumir el token (una sola vez, 15 minutos, sin fotos previas)
    const { data: t, error } = await sb.from('pro_turnos').update({ ref_token_hash: null })
      .eq('id', id).eq('ref_token_hash', hash).is('ref_fotos', null)
      .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
      .select('id, profesional_id, ref_fotos_esperadas').maybeSingle();
    if (error) throw error;
    if (!t) return falla(403, 'TOKEN', 'El permiso para subir fotos venció o ya se usó.');
    const lote = fotos.slice(0, Math.max(1, Math.min(MAX_FOTOS, t.ref_fotos_esperadas || MAX_FOTOS)));
    const rutas: string[] = [];
    for (const [i, f] of lote.entries()) {
      const ruta = `${t.profesional_id}/${t.id}/${i + 1}.${f.ext}`;
      const { error: e2 } = await sb.storage.from('pro-referencias').upload(ruta, f.bytes, { contentType: f.mime, upsert: false });
      if (!e2) rutas.push(ruta); else console.error('referencias-turno subida', e2.message);
    }
    await sb.from('pro_turnos').update({ ref_fotos: rutas }).eq('id', t.id);
    if (!rutas.length) return falla(500, 'SUBIDA', 'No se pudieron guardar las fotos.');
    return json(200, { ok: true, fotos: rutas.length });
  } catch (e) {
    console.error('referencias-turno', String(e));
    return falla(500, 'INTERNO', 'No se pudieron guardar las fotos.');
  }
});
