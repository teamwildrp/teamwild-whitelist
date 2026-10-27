# Whitelist Team Wild RP

Formulario de whitelist servido con GitHub Pages. Cada solicitud llega a Discord
a través de un Worker de Cloudflare (`worker.js`), para que la URL del webhook no
sea pública.

- `index.html`, `style.css`, `app.js`: la página.
- `config.js`: URL del Worker y roles a mencionar.
- `worker.js`: se pega en Cloudflare Workers; variables `WEBHOOK_URL` (secreto),
  `ALLOWED_ORIGIN`, `PING_ROLES`, `BOT_TOKEN` (secreto) y `COOLDOWN_HOURS`.
- Estado de cada persona (KV `SUBMITS` + roles de Discord): al iniciar sesión la
  página muestra, en vez del formulario, si la solicitud está pendiente, fue
  rechazada (espera `COOLDOWN_HOURS` desde el rechazo, con el motivo), fue aprobada
  (pasos del ticket) o ya tiene el rol Ciudadano. Borrar el mensaje de una
  solicitud pendiente la anula; las aprobadas y rechazadas quedan guardadas.
- Respuestas correctas del cuestionario: campo `ok` de cada pregunta en `app.js`.
- `presence/`: programa para el VPS que mantiene en línea el bot de whitelist (ver `presence/LEEME.md`).
