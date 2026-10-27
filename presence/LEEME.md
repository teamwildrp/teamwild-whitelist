# Bot de whitelist en línea

Los botones de Aprobar/Rechazar los atiende el Worker de Cloudflare y funcionan
aunque el bot salga desconectado. Este programa solo hace que aparezca **en
línea** con el estado "Viendo las solicitudes de whitelist". No necesita
paquetes: solo **Node 22 o superior**.

## Panel (Pterodactyl, Astral Nodes)

1. Crea un servidor con el egg de **Node.js** (versión 22 o más nueva).
2. Sube `bot.js` y `package.json` al Administrador de archivos.
3. Crea un archivo `.env` con:
   ```
   DISCORD_TOKEN=token_del_bot_de_whitelist
   ```
4. En **Startup**, el archivo de inicio es `bot.js`. Si hay campo de paquetes, déjalo vacío.
5. Inicia el servidor. En la consola debe salir `En linea como Team Wild RP`.

## VPS con SSH

```bash
node --version            # 22 o más
cd /opt/tw-whitelist-presence   # carpeta con bot.js, package.json y .env
npx pm2 start bot.js --name wl-presence
npx pm2 save && npx pm2 startup
```

## Opcional (en `.env`)

- `STATUS=idle` o `dnd` para ausente / no molestar.
- `ACTIVITY=texto` para cambiar lo que dice después de "Viendo".
