// Web Push sin dependencias (sólo WebCrypto): sirve igual en Deno (Edge Function) y en Node 20 (pruebas).
//   - Cifrado del mensaje: RFC 8291 + RFC 8188 ("aes128gcm").
//   - Identificación del servidor: VAPID (RFC 8292), JWT ES256.
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64u(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function unir(...partes) {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(clave, datos) {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
}
/** HKDF-SHA256 con un solo bloque de salida (largo <= 32). */
async function hkdf(sal, ikm, info, largo) {
  const prk = await hmac(sal, ikm);
  return (await hmac(prk, unir(info, new Uint8Array([1])))).slice(0, largo);
}

/** Par de claves VAPID nuevo: { publica: 65 bytes en base64url, privada: 'd' en base64url }. */
export async function generarVapid() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  return { publica: b64u(publica), privada: jwk.d };
}

async function jwtVapid(endpoint, vapid, sub) {
  const pub = deB64u(vapid.publica);
  const clave = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: vapid.privada, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, enc.encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64u(firma)}`; // WebCrypto ya firma en formato r||s, el que pide JWT
}

/** Cifra `texto` para una suscripción { p256dh, auth } (base64url). Devuelve el cuerpo binario aes128gcm. */
export async function cifrar(texto, p256dh, auth) {
  const uaPub = deB64u(p256dh), secreto = deB64u(auth);
  if (uaPub.length !== 65 || secreto.length !== 16) throw new Error('claves de suscripción inválidas');
  const efimera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const uaClave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaClave }, efimera.privateKey, 256));
  const ikm = await hkdf(secreto, ecdh, unir(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plano = unir(enc.encode(texto), new Uint8Array([2])); // 0x02 = último (y único) registro, sin relleno
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, plano));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

/**
 * Envía un push. sus = { endpoint, p256dh, auth }; vapid = { publica, privada }; sub = 'mailto:…' o URL https.
 * Devuelve { status, texto } del servicio de push (201 = aceptado; 404/410 = suscripción vencida).
 */
export async function enviarPush(sus, datos, vapid, { sub, ttl = 86400, urgencia = 'high', fetchFn = fetch } = {}) {
  const cuerpo = await cifrar(typeof datos === 'string' ? datos : JSON.stringify(datos), sus.p256dh, sus.auth);
  const jwt = await jwtVapid(sus.endpoint, vapid, sub);
  const r = await fetchFn(sus.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(ttl),
      Urgency: urgencia,
      Authorization: `vapid t=${jwt}, k=${vapid.publica}`,
    },
    body: cuerpo,
  });
  return { status: r.status, texto: (await r.text().catch(() => '')).slice(0, 300) };
}
