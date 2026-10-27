/* Whitelist Team Wild RP :: intermediario en Cloudflare Workers

   La pagina publica envia aqui y el Worker reenvia a Discord, asi la URL del
   webhook nunca aparece en GitHub ni en el navegador.

   Variables del Worker (Settings > Variables and Secrets):
     WEBHOOK_URL     URL del webhook de Discord (tipo Secret)
     ALLOWED_ORIGIN  https://TUUSUARIO.github.io  (sin barra final)
     PING_ROLES      IDs de roles separados por coma: los unicos que pueden sonar
     BOT_TOKEN       Token de un bot que pueda leer el canal del webhook (tipo Secret)
     COOLDOWN_HOURS  Horas entre solicitudes con el mismo ID de Discord o email (12)

   El cooldown se comprueba leyendo las solicitudes que ya hay en el canal, asi
   cuenta tambien las enviadas antes de existir y borrar un mensaje lo levanta. */

const MAX_FILES = 2;
const MAX_BYTES = 9 * 1024 * 1024;
const API = 'https://discord.com/api/v10';
const MAX_PAGES = 10;

let channelId = null;

function field(payload, name) {
    const embed = (payload.embeds || [])[0] || {};
    const f = (embed.fields || []).find(x => x && x.name === name);
    return f ? String(f.value || '').replace(/`/g, '').trim().toLowerCase() : '';
}

// Fecha hasta la que dura el cooldown de esta persona, o null si puede enviar
async function cooldownUntil(env, id, email) {
    const hours = Number(env.COOLDOWN_HOURS || 12);
    if (!env.BOT_TOKEN || !hours) return null;
    const auth = { headers: { Authorization: 'Bot ' + env.BOT_TOKEN } };

    if (!channelId) {
        const wh = await fetch(env.WEBHOOK_URL).then(r => r.ok ? r.json() : null);
        if (!wh) throw new Error('webhook');
        channelId = wh.channel_id;
    }

    const since = Date.now() - hours * 3600e3;
    let before = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(API + '/channels/' + channelId + '/messages?limit=100' + before, auth);
        if (!res.ok) throw new Error('messages ' + res.status);
        const msgs = await res.json();
        for (const m of msgs) {
            const sent = Date.parse(m.timestamp);
            if (sent < since) return null;
            if (!m.webhook_id || !(m.embeds || []).length) continue;
            const old = { embeds: m.embeds };
            if ((id && field(old, 'ID de Discord') === id) || (email && field(old, 'Email') === email)) {
                return new Date(sent + hours * 3600e3).toISOString();
            }
        }
        if (msgs.length < 100) return null;
        before = '&before=' + msgs[msgs.length - 1].id;
    }
    return null;
}

export default {
    async fetch(request, env) {
        const cors = {
            'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Vary': 'Origin',
        };
        const reply = (status, text) => new Response(text || null, { status, headers: cors });
        const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

        if (request.method === 'OPTIONS') return reply(204);
        if (request.method !== 'POST') return reply(405, 'Method not allowed');

        const origin = request.headers.get('Origin') || '';
        if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return reply(403, 'Forbidden');
        if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return reply(413, 'Too large');

        let incoming, payload;
        try {
            incoming = await request.formData();
            payload = JSON.parse(incoming.get('payload_json'));
        } catch (e) {
            return reply(400, 'Bad request');
        }

        // Si no se puede leer el canal, se deja pasar: mejor una solicitud repetida que una perdida
        try {
            const until = await cooldownUntil(env, field(payload, 'ID de Discord'), field(payload, 'Email'));
            if (until) return json(409, { error: 'cooldown', until });
        } catch (e) {
            console.error('cooldown', e.message);
        }

        // Nada de lo que llegue desde fuera decide a quien se menciona
        const roles = String(env.PING_ROLES || '').split(',').map(s => s.trim()).filter(Boolean);
        payload.allowed_mentions = { parse: [], roles, users: [] };
        payload.content = String(payload.content || '').slice(0, 1900);
        payload.embeds = Array.isArray(payload.embeds) ? payload.embeds.slice(0, 1) : [];

        const out = new FormData();
        out.append('payload_json', JSON.stringify(payload));
        for (let i = 0; i < MAX_FILES; i++) {
            const f = incoming.get('files[' + i + ']');
            if (f && typeof f !== 'string') out.append('files[' + i + ']', f, f.name);
        }

        const res = await fetch(env.WEBHOOK_URL, { method: 'POST', body: out });
        return reply(res.ok ? 204 : res.status);
    },
};
