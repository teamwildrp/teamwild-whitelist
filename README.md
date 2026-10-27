# Whitelist Team Wild RP

Formulario de whitelist servido con GitHub Pages. Cada solicitud llega a Discord
a través de un Worker de Cloudflare (`worker.js`), para que la URL del webhook no
sea pública.

- `index.html`, `style.css`, `app.js`: la página.
- `config.js`: URL del Worker y roles a mencionar.
- `worker.js`: se pega en Cloudflare Workers; variables `WEBHOOK_URL` (secreto),
  `ALLOWED_ORIGIN`, `PING_ROLES`, `BOT_TOKEN` (secreto) y `COOLDOWN_HOURS`.
- Cooldown: el Worker lee el canal del webhook con el bot y rechaza (409) un envío
  si el mismo ID de Discord o email ya llegó en las últimas `COOLDOWN_HOURS` horas.
  Además cada envío queda guardado en el KV `SUBMITS` durante esas horas, así que
  borrar el mensaje en Discord ya no levanta el cooldown.
- Respuestas correctas del cuestionario: campo `ok` de cada pregunta en `app.js`.
- `presence/`: programa para el VPS que mantiene en línea el bot de whitelist (ver `presence/LEEME.md`).
