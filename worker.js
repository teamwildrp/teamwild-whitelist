/* Whitelist Team Wild RP :: intermediario en Cloudflare Workers

   La pagina publica envia aqui y el Worker reenvia a Discord, asi la URL del
   webhook nunca aparece en GitHub ni en el navegador.

   Variables del Worker (Settings > Variables and Secrets):
     WEBHOOK_URL       URL del webhook de Discord (tipo Secret)
     ALLOWED_ORIGIN    https://TUUSUARIO.github.io  (sin barra final)
     PING_ROLES        IDs de roles separados por coma: los unicos que pueden sonar
     BOT_TOKEN         Token de un bot que pueda leer el canal del webhook (tipo Secret)
     COOLDOWN_HOURS    Horas de espera tras un rechazo para volver a enviar (12)

   Revision con botones (solo si WL_BOT_TOKEN y WL_PUBLIC_KEY estan puestos):
     WL_BOT_TOKEN      Token del bot de whitelist (tipo Secret). Publica las solicitudes
     WL_PUBLIC_KEY     Public Key de esa aplicacion (verifica los clics)
     GUILD_ID          Servidor de Discord
     CHANNEL_ID        Canal donde llegan las solicitudes
     APPROVED_CHANNEL  Canal donde se anuncian las aprobadas
     REJECTED_CHANNEL  Canal donde se anuncian las rechazadas
     APPROVER_ROLES    Roles que pueden aprobar o rechazar, separados por coma
     WL_ROLE           Rol que se da al aprobar (vacio: no se toca ningun rol)
     APPROVED_MESSAGE  Texto que se publica al aprobar; {user} se cambia por la mencion
     CITIZEN_ROLE      Rol de quien ya paso la whitelist en llamada (acceso completo)

   En el Developer Portal, "Interactions Endpoint URL" de esa aplicacion debe ser
   https://<este worker>/interactions

   Inicio de sesion con Discord (solo si CLIENT_SECRET y SESSION_SECRET estan puestos):
     CLIENT_ID         Application ID del bot de whitelist
     CLIENT_SECRET     Client Secret de esa aplicacion (tipo Secret)
     SESSION_SECRET    Cualquier texto largo al azar, firma las sesiones (tipo Secret)
     PAGE_URL          Direccion del formulario, a donde se vuelve tras iniciar sesion
   En OAuth2 > Redirects de la aplicacion: https://<este worker>/callback

   Estado de cada persona (KV SUBMITS), que decide si puede enviar:
     user:<id>      { status: pending | approved | rejected, at, msg, reason }
     email:<email>  ID de Discord de quien envio con ese email
   Sin registro se busca en el canal (solicitudes de antes del KV) y se guarda.
     - Rol CITIZEN_ROLE      -> acceso completo, no envia
     - Rol WL_ROLE o aprobada -> aprobada, sigue con el ticket
     - Pendiente              -> esperando respuesta (si se borra el mensaje, se olvida)
     - Rechazada              -> espera COOLDOWN_HOURS desde el rechazo */

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

// ------------------------------------------------------------ Estado de cada persona

const STATES = ['pending', 'approved', 'rejected'];

async function getRecord(env, id) {
    if (!env.SUBMITS || !id) return null;
    try { return JSON.parse(await env.SUBMITS.get('user:' + id)); } catch (e) { return null; }
}

async function setRecord(env, id, rec, email) {
    if (!env.SUBMITS || !id) return;
    await env.SUBMITS.put('user:' + id, JSON.stringify(rec));
    if (email) await env.SUBMITS.put('email:' + email, id);
}

async function memberRoles(env, id) {
    if (!env.WL_BOT_TOKEN || !env.GUILD_ID) return [];
    const res = await discord(env, '/guilds/' + env.GUILD_ID + '/members/' + id);
    return res.ok ? ((await res.json()).roles || []) : [];
}

// Lo que dice un mensaje del canal: botones activos, "Aprobada" o "Rechazada"
function messageRecord(m, hours) {
    const buttons = (m.components || []).flatMap(r => r.components || []);
    const done = buttons.find(c => c.disabled && /^(Aprobada|Rechazada)$/.test(c.label || ''));
    if (done) {
        const fields = ((m.embeds || [])[0] || {}).fields || [];
        const reason = (fields.find(f => f.name === 'Motivo') || {}).value || '';
        return { status: done.label === 'Aprobada' ? 'approved' : 'rejected', at: m.edited_timestamp || m.timestamp, msg: m.id, reason };
    }
    if (buttons.some(c => /^wl:a:/.test(c.custom_id || '') && !c.disabled)) return { status: 'pending', at: m.timestamp, msg: m.id };
    // Solicitudes viejas del webhook, sin botones: cuentan como pendientes solo COOLDOWN_HOURS
    if (Date.parse(m.timestamp) + hours * 3600e3 > Date.now()) return { status: 'pending', at: m.timestamp, msg: m.id, legacy: true };
    return null;
}

// Busca la ultima solicitud de esta persona en el canal (para las enviadas antes del KV)
async function scanChannel(env, id, email, hours) {
    const token = env.WL_BOT_TOKEN || env.BOT_TOKEN;
    if (!token) return null;
    const auth = { headers: { Authorization: 'Bot ' + token } };

    if (!channelId) channelId = env.CHANNEL_ID || null;
    if (!channelId) {
        const wh = await fetch(env.WEBHOOK_URL).then(r => r.ok ? r.json() : null);
        if (!wh) throw new Error('webhook');
        channelId = wh.channel_id;
    }

    let before = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(API + '/channels/' + channelId + '/messages?limit=100' + before, auth);
        if (!res.ok) throw new Error('messages ' + res.status);
        const msgs = await res.json();
        for (const m of msgs) {
            if (!(m.webhook_id || (m.author && m.author.bot)) || !(m.embeds || []).length) continue;
            const old = { embeds: m.embeds };
            const owner = field(old, 'ID de Discord');
            if ((id && owner === id) || (email && field(old, 'Email') === email)) {
                const rec = messageRecord(m, hours);
                return rec ? { ...rec, owner } : null;
            }
        }
        if (msgs.length < 100) return null;
        before = '&before=' + msgs[msgs.length - 1].id;
    }
    return null;
}

// Que puede hacer esta persona: none (enviar), pending, approved, citizen o rejected (+ until)
async function personState(env, id, email) {
    const hours = Number(env.COOLDOWN_HOURS || 12);

    const roles = await memberRoles(env, id).catch(() => []);
    if (env.CITIZEN_ROLE && roles.includes(env.CITIZEN_ROLE)) return { state: 'citizen' };
    if (env.WL_ROLE && roles.includes(env.WL_ROLE)) return { state: 'approved' };

    let owner = id;
    let rec = await getRecord(env, id);
    if (!rec && email && env.SUBMITS) {
        const other = await env.SUBMITS.get('email:' + email);
        if (other) { owner = other; rec = await getRecord(env, other); }
    }
    if (!rec) {
        rec = await scanChannel(env, id, email, hours);
        if (rec) {
            owner = rec.owner || id;
            delete rec.owner;
            if (!rec.legacy) await setRecord(env, owner, rec);
        }
    }
    if (!rec || !STATES.includes(rec.status)) return { state: 'none' };

    if (rec.status === 'pending') {
        if (rec.legacy) return Date.parse(rec.at) + hours * 3600e3 > Date.now() ? { state: 'pending' } : { state: 'none' };
        // El mensaje manda: si se borro, la solicitud ya no existe; si ya se reviso,
        // vale eso aunque el KV (que tarda hasta un minuto) todavia diga pendiente
        if (rec.msg && env.WL_BOT_TOKEN && env.CHANNEL_ID) {
            const res = await discord(env, '/channels/' + env.CHANNEL_ID + '/messages/' + rec.msg);
            if (res.status === 404) {
                await env.SUBMITS.delete('user:' + owner);
                return { state: 'none' };
            }
            const live = res.ok ? messageRecord(await res.json(), hours) : null;
            if (live && live.status !== 'pending') rec = live;
        }
        if (rec.status === 'pending') return { state: 'pending' };
    }
    if (rec.status === 'approved') return { state: 'approved' };

    const until = Date.parse(rec.at) + hours * 3600e3;
    return until > Date.now() ? { state: 'rejected', until: new Date(until).toISOString(), reason: rec.reason || '' } : { state: 'none' };
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
    if (channel && approve && env.APPROVED_MESSAGE) {
        const res = await discord(env, '/channels/' + channel + '/messages', { method: 'POST', json: {
            content: env.APPROVED_MESSAGE.replaceAll('{user}', '<@' + userId + '>'),
            allowed_mentions: { parse: [], users: [userId] },
        } });
        if (!res.ok) problems.push('No se pudo publicar en <#' + channel + '> (error ' + res.status + '). ¿El bot puede escribir ahí?');
    } else if (channel) {
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

    // Con mensaje fijo, aprobar es un solo clic
    if (it.type === 3 && approve && env.APPROVED_MESSAGE) return finish(env, ctx, it, true, userId, '');

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
        return finish(env, ctx, it, approve, userId, text);
    }

    return ephemeral('Acción desconocida.');
}

// Marca la solicitud como revisada y anuncia el resultado
function finish(env, ctx, it, approve, userId, text) {
    const admin = it.member.user.id;
    const embed = { ...((it.message.embeds || [])[0] || {}) };
    embed.color = approve ? 0x6faa42 : 0xe0645f;
    const added = [{ name: approve ? '✅ Aprobada' : '❌ Rechazada', value: 'Por <@' + admin + '> · <t:' + Math.floor(Date.now() / 1000) + ':R>' }];
    if (text) added.push({ name: approve ? 'Mensaje' : 'Motivo', value: cut(text, 1000) });
    embed.fields = (embed.fields || []).concat(added).slice(-25);

    ctx.waitUntil(announce(env, it, approve, userId, text).catch(e => console.error('announce', e.message)));
    ctx.waitUntil(setRecord(env, userId, {
        status: approve ? 'approved' : 'rejected',
        at: new Date().toISOString(),
        msg: it.message.id,
        reason: approve ? '' : cut(text, 1000),
    }).catch(e => console.error('record', e.message)));
    return Response.json({ type: 7, data: {
        embeds: [embed],
        components: reviewButtons(userId, approve ? 'Aprobada' : 'Rechazada'),
        allowed_mentions: { parse: [] },
    } });
}

// ------------------------------------------------------------ Inicio de sesion con Discord

function loginEnabled(env) {
    return !!(env.CLIENT_ID && env.CLIENT_SECRET && env.SESSION_SECRET && env.PAGE_URL);
}

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(env, text) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

// La sesion es "datos.firma": la pagina lee los datos, solo el Worker puede firmarlos
async function makeSession(env, user) {
    const data = b64url(new TextEncoder().encode(JSON.stringify({
        id: user.id,
        username: user.username,
        name: user.global_name || user.username,
        avatar: user.avatar ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64' : '',
        email: user.verified ? (user.email || '') : '',
        exp: Date.now() + 6 * 3600e3,
    })));
    return data + '.' + await hmac(env, data);
}

async function readSession(env, token) {
    const [data, sig] = String(token || '').split('.');
    if (!data || !sig || sig !== await hmac(env, data)) return null;
    try {
        const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
        return s.exp > Date.now() && /^\d{17,20}$/.test(s.id) ? s : null;
    } catch (e) {
        return null;
    }
}

function backToPage(env, hash, extra = {}) {
    return new Response(null, { status: 302, headers: { Location: env.PAGE_URL + '#' + hash, ...extra } });
}

async function login(request, env) {
    const url = new URL(request.url);
    const redirect = url.origin + '/callback';

    if (url.pathname === '/login') {
        const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
        const auth = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
            client_id: env.CLIENT_ID, response_type: 'code', scope: 'identify email',
            redirect_uri: redirect, state,
        });
        return new Response(null, { status: 302, headers: {
            Location: auth,
            'Set-Cookie': 'wl_state=' + state + '; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax',
        } });
    }

    // /callback
    const clear = { 'Set-Cookie': 'wl_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' };
    const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)wl_state=([^;]+)/);
    const code = url.searchParams.get('code');
    if (!code) return backToPage(env, 'login_error=cancel', clear);
    if (!cookie || cookie[1] !== url.searchParams.get('state')) return backToPage(env, 'login_error=state', clear);

    const tok = await fetch(API + '/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: redirect,
        }),
    }).then(r => r.ok ? r.json() : null);
    if (!tok) return backToPage(env, 'login_error=discord', clear);

    const user = await fetch(API + '/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } }).then(r => r.ok ? r.json() : null);
    if (!user) return backToPage(env, 'login_error=discord', clear);

    return backToPage(env, 'login=' + await makeSession(env, user), clear);
}

// ------------------------------------------------------------ Entrada

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/interactions') {
            if (request.method !== 'POST' || !reviewEnabled(env)) return new Response('Not found', { status: 404 });
            return interactions(request, env, ctx);
        }
        if (url.pathname === '/login' || url.pathname === '/callback') {
            if (request.method !== 'GET' || !loginEnabled(env)) return new Response('Not found', { status: 404 });
            return login(request, env);
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

        // La pagina pregunta al iniciar sesion si la persona puede enviar, antes de rellenar nada
        if (url.pathname === '/status') {
            if (!loginEnabled(env)) return json(200, {});
            let s = null;
            try { s = await readSession(env, (await request.formData()).get('auth')); } catch (e) { }
            if (!s) return json(401, { error: 'login' });
            try {
                return json(200, await personState(env, s.id, String(s.email || '').toLowerCase()));
            } catch (e) {
                console.error('status', e.message);
                return json(200, { state: 'none' });
            }
        }

        let incoming, payload;
        try {
            incoming = await request.formData();
            payload = JSON.parse(incoming.get('payload_json'));
        } catch (e) {
            return reply(400, 'Bad request');
        }

        // Con inicio de sesion, el usuario y el ID salen de Discord, no de lo que se escribio
        if (loginEnabled(env)) {
            const s = await readSession(env, incoming.get('auth'));
            if (!s) return json(401, { error: 'login' });
            const embed = (payload.embeds || [])[0];
            if (!embed) return reply(400, 'Bad request');
            const set = (name, value) => {
                embed.fields = embed.fields || [];
                const f = embed.fields.find(x => x && x.name === name);
                if (f) f.value = value; else embed.fields.unshift({ name, value, inline: true });
            };
            set('ID de Discord', '`' + s.id + '`');
            set('Usuario', '<@' + s.id + '>\n`' + cut(s.username, 40) + '` ✔️');
            payload.content = String(payload.content || '').replace(/\*\*[^*]*\*\*\s*$/, '**' + cut(s.username, 40).replace(/([*_`~|\\])/g, '\\$1') + '**');
        }

        // Si no se puede comprobar, se deja pasar: mejor una solicitud repetida que una perdida
        try {
            const st = await personState(env, field(payload, 'ID de Discord'), field(payload, 'Email'));
            if (st.state !== 'none') return json(409, { error: 'cooldown', ...st });
        } catch (e) {
            console.error('state', e.message);
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
            : await fetch(env.WEBHOOK_URL + '?wait=true', { method: 'POST', body: out });

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
            res = await fetch(env.WEBHOOK_URL + '?wait=true', { method: 'POST', body: retry });
        }
        if (res.ok) {
            const sent = await res.json().catch(() => ({}));
            ctx.waitUntil(setRecord(env, userId, { status: 'pending', at: new Date().toISOString(), msg: sent.id || '' }, field(payload, 'Email'))
                .catch(e => console.error('record', e.message)));
        }
        return reply(res.ok ? 204 : res.status);
    },
};
