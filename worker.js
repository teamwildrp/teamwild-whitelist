/* Whitelist Team Wild RP :: intermediario en Cloudflare Workers

   La pagina publica envia aqui y el Worker reenvia a Discord, asi la URL del
   webhook nunca aparece en GitHub ni en el navegador.

   Variables del Worker (Settings > Variables and Secrets):
     WEBHOOK_URL       URL del webhook de Discord (tipo Secret)
     ALLOWED_ORIGIN    https://TUUSUARIO.github.io  (sin barra final)
     PING_ROLES        IDs de roles separados por coma: los unicos que pueden sonar
     BOT_TOKEN         Token de un bot que pueda leer el canal del webhook (tipo Secret)
     COOLDOWN_HOURS    Horas entre solicitudes con el mismo ID de Discord o email (12)

   Revision con botones (solo si WL_BOT_TOKEN y WL_PUBLIC_KEY estan puestos):
     WL_BOT_TOKEN      Token del bot de whitelist (tipo Secret). Publica las solicitudes
     WL_PUBLIC_KEY     Public Key de esa aplicacion (verifica los clics)
     GUILD_ID          Servidor de Discord
     CHANNEL_ID        Canal donde llegan las solicitudes
     APPROVED_CHANNEL  Canal donde se anuncian las aprobadas
     REJECTED_CHANNEL  Canal donde se anuncian las rechazadas
     APPROVER_ROLES    Roles que pueden aprobar o rechazar, separados por coma
     WL_ROLE           Rol que se da al aprobar (vacio: no se toca ningun rol)

   En el Developer Portal, "Interactions Endpoint URL" de esa aplicacion debe ser
   https://<este worker>/interactions

   El cooldown se comprueba leyendo las solicitudes que ya hay en el canal, asi
   cuenta tambien las enviadas antes de existir y borrar un mensaje lo levanta. */

const MAX_FILES = 2;
const MAX_BYTES = 9 * 1024 * 1024;
const API = 'https://discord.com/api/v10';
const MAX_PAGES = 10;
const EPHEMERAL = 64;

let channelId = null;

function field(payload, name) {
    const embed = (payload.embeds || [])[0] || {};
    const f = (embed.fields || []).find(x => x && x.name === name);
    return f ? String(f.value || '').replace(/`/g, '').trim().toLowerCase() : '';
}

function list(v) {
    return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function cut(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function reviewEnabled(env) {
    return !!(env.WL_BOT_TOKEN && env.WL_PUBLIC_KEY && env.CHANNEL_ID);
}

function discord(env, path, init = {}) {
    const headers = { Authorization: 'Bot ' + env.WL_BOT_TOKEN, ...(init.headers || {}) };
    if (init.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        init = { ...init, body: JSON.stringify(init.json) };
    }
    return fetch(API + path, { ...init, headers });
}

// Fecha hasta la que dura el cooldown de esta persona, o null si puede enviar
async function cooldownUntil(env, id, email) {
    const hours = Number(env.COOLDOWN_HOURS || 12);
    const token = env.WL_BOT_TOKEN || env.BOT_TOKEN;
    if (!token || !hours) return null;
    const auth = { headers: { Authorization: 'Bot ' + token } };

    if (!channelId) channelId = env.CHANNEL_ID || null;
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
            if (!(m.webhook_id || (m.author && m.author.bot)) || !(m.embeds || []).length) continue;
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

// ------------------------------------------------------------ Revision desde Discord

function hexBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

async function verified(request, env, body) {
    const sig = request.headers.get('X-Signature-Ed25519');
    const ts = request.headers.get('X-Signature-Timestamp');
    if (!sig || !ts) return false;
    try {
        const key = await crypto.subtle.importKey('raw', hexBytes(env.WL_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
        return await crypto.subtle.verify('Ed25519', key, hexBytes(sig), new TextEncoder().encode(ts + body));
    } catch (e) {
        return false;
    }
}

function canReview(env, member) {
    if (!member) return false;
    if ((BigInt(member.permissions || 0) & 8n) === 8n) return true; // Administrador
    const allowed = list(env.APPROVER_ROLES);
    return (member.roles || []).some(r => allowed.includes(r));
}

function reviewButtons(userId, disabledLabel) {
    if (disabledLabel) {
        return [{ type: 1, components: [{ type: 2, style: 2, label: disabledLabel, custom_id: 'wl:done', disabled: true }] }];
    }
    return [{ type: 1, components: [
        { type: 2, style: 3, label: 'Aprobar', emoji: { name: '✅' }, custom_id: 'wl:a:' + userId },
        { type: 2, style: 4, label: 'Rechazar', emoji: { name: '✖️' }, custom_id: 'wl:r:' + userId },
    ] }];
}

function alreadyReviewed(message) {
    return !((message && message.components) || []).some(row =>
        (row.components || []).some(c => /^wl:[ar]:/.test(c.custom_id || '') && !c.disabled));
}

function ephemeral(content) {
    return Response.json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });
}

// Lo que se hace despues de responder a Discord: anuncio, rol y aviso al admin si algo falla
async function announce(env, interaction, approve, userId, text) {
    const problems = [];
    const channel = approve ? env.APPROVED_CHANNEL : env.REJECTED_CHANNEL;
    if (channel) {
        const res = await discord(env, '/channels/' + channel + '/messages', { method: 'POST', json: {
            content: '<@' + userId + '>',
            embeds: [{
                title: approve ? '✅ Whitelist aprobada' : '❌ Whitelist rechazada',
                description: cut(text, 4000),
                color: approve ? 0x6faa42 : 0xe0645f,
                footer: { text: 'Team Wild RP · Whitelist' },
                timestamp: new Date().toISOString(),
            }],
            allowed_mentions: { parse: [], users: [userId] },
        } });
        if (!res.ok) problems.push('No se pudo publicar en <#' + channel + '> (error ' + res.status + '). ¿El bot puede escribir ahí?');
    }

    if (approve && env.WL_ROLE && env.GUILD_ID) {
        const res = await discord(env, '/guilds/' + env.GUILD_ID + '/members/' + userId + '/roles/' + env.WL_ROLE, {
            method: 'PUT',
            headers: { 'X-Audit-Log-Reason': encodeURIComponent('Whitelist aprobada por ' + interaction.member.user.username) },
        });
        if (res.status === 404) problems.push('No se pudo dar el rol <@&' + env.WL_ROLE + '>: el usuario no está en el servidor.');
        else if (!res.ok) problems.push('No se pudo dar el rol <@&' + env.WL_ROLE + '> (error ' + res.status + '). El rol del bot tiene que estar por encima y con "Gestionar roles".');
    }

    if (problems.length) {
        await fetch(API + '/webhooks/' + interaction.application_id + '/' + interaction.token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: problems.join('\n'), flags: EPHEMERAL, allowed_mentions: { parse: [] } }),
        });
    }
}

async function interactions(request, env, ctx) {
    const body = await request.text();
    if (!(await verified(request, env, body))) return new Response('Bad signature', { status: 401 });
    const it = JSON.parse(body);

    if (it.type === 1) return Response.json({ type: 1 }); // PING

    const id = (it.data && it.data.custom_id) || '';
    const m = id.match(/^wl:(a|r|ma|mr):(\d{17,20})$/);
    if (!m) return ephemeral('Este botón ya no sirve.');
    if (!canReview(env, it.member)) return ephemeral('No tienes permiso para revisar solicitudes de whitelist.');
    if (alreadyReviewed(it.message)) return ephemeral('Otra persona ya revisó esta solicitud.');

    const userId = m[2];
    const approve = m[1] === 'a' || m[1] === 'ma';

    // Clic en un boton: se abre la ventana para escribir el mensaje
    if (it.type === 3) {
        return Response.json({ type: 9, data: {
            custom_id: 'wl:' + (approve ? 'ma' : 'mr') + ':' + userId,
            title: approve ? 'Aprobar whitelist' : 'Rechazar whitelist',
            components: [{ type: 1, components: [{
                type: 4, custom_id: 'msg', style: 2, required: true, max_length: 1500,
                label: approve ? 'Mensaje de aprobación' : 'Motivo del rechazo',
                placeholder: approve ? 'Se publica en el canal de aprobadas, mencionando al usuario.' : 'Se publica en el canal de rechazadas, mencionando al usuario.',
                value: approve ? '¡Felicidades! Tu whitelist fue aprobada. Te esperamos en la ciudad.' : undefined,
            }] }],
        } });
    }

    // Ventana enviada: se marca la solicitud y se anuncia
    if (it.type === 5) {
        const text = (((it.data.components || [])[0] || {}).components || [])[0]?.value || '';
        const admin = it.member.user.id;
        const embed = { ...((it.message.embeds || [])[0] || {}) };
        embed.color = approve ? 0x6faa42 : 0xe0645f;
        embed.fields = (embed.fields || []).concat([
            { name: approve ? '✅ Aprobada' : '❌ Rechazada', value: 'Por <@' + admin + '> · <t:' + Math.floor(Date.now() / 1000) + ':R>' },
            { name: approve ? 'Mensaje' : 'Motivo', value: cut(text, 1000) },
        ]).slice(-25);

        ctx.waitUntil(announce(env, it, approve, userId, text).catch(e => console.error('announce', e.message)));
        return Response.json({ type: 7, data: {
            embeds: [embed],
            components: reviewButtons(userId, approve ? 'Aprobada' : 'Rechazada'),
            allowed_mentions: { parse: [] },
        } });
    }

    return ephemeral('Acción desconocida.');
}

// ------------------------------------------------------------ Entrada

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/interactions') {
            if (request.method !== 'POST' || !reviewEnabled(env)) return new Response('Not found', { status: 404 });
            return interactions(request, env, ctx);
        }

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
        const roles = list(env.PING_ROLES);
        payload.allowed_mentions = { parse: [], roles, users: [] };
        payload.content = String(payload.content || '').slice(0, 1900);
        payload.embeds = Array.isArray(payload.embeds) ? payload.embeds.slice(0, 1) : [];
        delete payload.components;

        const userId = field(payload, 'ID de Discord');
        const withButtons = reviewEnabled(env) && /^\d{17,20}$/.test(userId);
        if (withButtons) {
            delete payload.username;
            payload.components = reviewButtons(userId);
        }

        const out = new FormData();
        out.append('payload_json', JSON.stringify(payload));
        for (let i = 0; i < MAX_FILES; i++) {
            const f = incoming.get('files[' + i + ']');
            if (f && typeof f !== 'string') out.append('files[' + i + ']', f, f.name);
        }

        let res = withButtons
            ? await discord(env, '/channels/' + env.CHANNEL_ID + '/messages', { method: 'POST', body: out })
            : await fetch(env.WEBHOOK_URL, { method: 'POST', body: out });

        // Si el bot de whitelist falla, la solicitud igual llega por el webhook (sin botones)
        if (!res.ok && withButtons) {
            console.error('bot post', res.status, await res.text());
            delete payload.components;
            const retry = new FormData();
            retry.append('payload_json', JSON.stringify(payload));
            for (let i = 0; i < MAX_FILES; i++) {
                const f = incoming.get('files[' + i + ']');
                if (f && typeof f !== 'string') retry.append('files[' + i + ']', f, f.name);
            }
            res = await fetch(env.WEBHOOK_URL, { method: 'POST', body: retry });
        }
        return reply(res.ok ? 204 : res.status);
    },
};
