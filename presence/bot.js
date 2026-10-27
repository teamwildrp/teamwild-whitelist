/* Whitelist Team Wild RP :: mantiene el bot de whitelist "en linea"

   Los botones los atiende el Worker de Cloudflare; esto solo abre la conexion
   con Discord que hace falta para que el bot salga conectado y con estado.
   No necesita paquetes: Node 22 o superior.

   Token: variable DISCORD_TOKEN o archivo .env junto a este (DISCORD_TOKEN=...).
   Opcionales: STATUS (online, idle, dnd) y ACTIVITY (texto del estado). */

'use strict';

const fs = require('fs');
const path = require('path');

// .env sencillo: CLAVE=valor por linea
try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch (e) { /* sin .env: se usan las variables del sistema */ }

const TOKEN = process.env.DISCORD_TOKEN;
const STATUS = process.env.STATUS || 'online';
const ACTIVITY = process.env.ACTIVITY || 'las solicitudes de whitelist';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';

if (!TOKEN) {
    console.error('[whitelist] Falta DISCORD_TOKEN (variable o archivo .env).');
    process.exit(1);
}
if (typeof WebSocket === 'undefined') {
    console.error('[whitelist] Hace falta Node 22 o superior (tienes ' + process.version + ').');
    process.exit(1);
}

let ws = null;
let heartbeat = null;
let acked = true;
let seq = null;
let sessionId = null;
let resumeUrl = null;
let retry = 1;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[whitelist]', ...a);
const send = (op, d) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ op, d }));

function presence() {
    // type 3 = "Viendo ..."
    return { since: null, afk: false, status: STATUS, activities: [{ name: ACTIVITY, type: 3 }] };
}

function connect(resume) {
    const url = resume && resumeUrl ? resumeUrl + '/?v=10&encoding=json' : GATEWAY;
    ws = new WebSocket(url);

    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.s != null) seq = msg.s;

        switch (msg.op) {
            case 10: { // Hello: empezar latidos e identificarse o reanudar
                clearInterval(heartbeat);
                acked = true;
                heartbeat = setInterval(() => {
                    if (!acked) { log('Discord no responde, reconectando'); ws.close(4000); return; }
                    acked = false;
                    send(1, seq);
                }, msg.d.heartbeat_interval);
                if (resume && sessionId) send(6, { token: TOKEN, session_id: sessionId, seq });
                else send(2, { token: TOKEN, intents: 0, properties: { os: process.platform, browser: 'tw-whitelist', device: 'tw-whitelist' }, presence: presence() });
                break;
            }
            case 11: acked = true; break;          // Latido recibido
            case 1: send(1, seq); break;           // Discord pide un latido
            case 7: ws.close(4000); break;         // Reconectar
            case 9:                                // Sesion invalida
                if (!msg.d) { sessionId = null; seq = null; }
                setTimeout(() => ws.close(4000), 1000 + Math.random() * 4000);
                break;
            case 0:
                if (msg.t === 'READY') {
                    sessionId = msg.d.session_id;
                    resumeUrl = msg.d.resume_gateway_url;
                    retry = 1;
                    log('En linea como ' + msg.d.user.username);
                } else if (msg.t === 'RESUMED') {
                    retry = 1;
                    log('Conexion reanudada');
                }
                break;
        }
    });

    ws.addEventListener('close', ev => {
        clearInterval(heartbeat);
        // Errores que no se arreglan reintentando (token malo, etc.)
        if ([4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)) {
            log('Discord rechazo la conexion (' + ev.code + '). Revisa el token.');
            process.exit(1);
        }
        const wait = Math.min(60, retry) * 1000;
        retry *= 2;
        log('Desconectado (' + ev.code + '), reintentando en ' + wait / 1000 + ' s');
        setTimeout(() => connect(!!sessionId), wait);
    });

    ws.addEventListener('error', () => { /* el cierre se encarga */ });
}

connect(false);
