/* Whitelist Team Wild RP :: configuracion
   Lo unico que hay que tocar para conectar el formulario con Discord. */

window.TW_CONFIG = {
    serverName: 'Team Wild RP',

    // URL del Worker de Cloudflare (worker.js), que reenvia al webhook de Discord.
    // El webhook NUNCA va aqui: este archivo es publico.
    endpoint: 'https://teamwild-whitelist.scratch-2026-10-19-acfc9a.workers.dev',

    // IDs de los roles a mencionar en cada solicitud (clic derecho en el rol > Copiar ID).
    // Deben coincidir con PING_ROLES del Worker, que es quien decide cuales suenan.
    pingRoles: ['1437175053933350912', '1467583188825280621'],

    // Pedir inicio de sesion con Discord antes del formulario (rellena usuario e ID)
    discordLogin: true,

    // Invitacion al Discord, para quien inicia sesion sin ser miembro
    inviteUrl: 'https://discord.gg/4TQk5Fy7fF',

    // Canal de tickets, para los pasos que siguen tras aprobar la whitelist
    ticketUrl: 'https://discord.com/channels/1437159254900343060/1467588652778524764',

    // Tamaño maximo del archivo con la historia
    maxFileMB: 8,
};
