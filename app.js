/* Whitelist Team Wild RP :: formulario por pasos que avisa a Discord por webhook */

(function () {
    'use strict';

    var CFG = window.TW_CONFIG || {};
    var DRAFT_KEY = 'tw-whitelist-draft';
    var SESSION_KEY = 'tw-whitelist-session';

    // `ok` es el indice de la respuesta correcta; solo se usa para la nota que llega a Discord
    var QUIZ = {
        'quiz-1': [
            { id: 'mg', q: '¿Qué es MG (Meta Gaming)?', ok: 2, opts: [
                'Realizar una acción que sería imposible de realizar en la vida real.',
                'Que tu personaje muera permanentemente.',
                'Usar información externa para usarla dentro del rol.',
                'Ninguna de las anteriores.'] },
            { id: 'pg', q: '¿Qué es PG (Power Gaming)?', ok: 2, opts: [
                'Que tu personaje muera permanentemente.',
                'Usar información externa para usarla dentro del rol.',
                'Realizar una acción que sería imposible de realizar en la vida real.',
                'Ninguna de las anteriores.'] },
            { id: 'ck', q: '¿Qué es CK?', ok: 2, opts: [
                'Usar información externa para usarla dentro del rol.',
                'Realizar una acción que sería imposible de realizar en la vida real.',
                'Que tu personaje muera permanentemente.',
                'Ninguna de las anteriores.'] },
            { id: 'pk', q: '¿Qué es PK?', ok: 3, opts: [
                'Que tu personaje muera permanentemente.',
                'Realizar una acción que sería imposible de realizar en la vida real.',
                'Usar información externa para usarla dentro del rol.',
                'Ninguna de las anteriores.'] },
            { id: 'cuchillo', q: 'Si vas por la calle desarmado y ves a una persona robando con un cuchillo a otra, ¿la enfrentas?', ok: 1, opts: [
                'Sí.',
                'No.',
                'Depende de la situación.'] },
        ],
        'quiz-2': [
            { id: 'ic', q: '¿Qué es IC?', ok: 0, opts: [
                'Cualquier acción dentro del rol.',
                'Cualquier acción fuera del rol.',
                'Cualquier acción que involucre un vehículo.',
                'Cualquier acción que involucre un arma.'] },
            { id: 'ooc', q: '¿Qué es OOC?', ok: 3, opts: [
                'Cualquier acción que involucre un arma.',
                'Cualquier acción que involucre un vehículo.',
                'Cualquier acción dentro del rol.',
                'Cualquier acción fuera del rol.'] },
            { id: 'me', q: '¿Para qué se usa el comando /me?', ok: 2, opts: [
                'Para mostrar una característica o validar situaciones.',
                'Para enviar un aviso de ayuda.',
                'Para señalar la acción que está haciendo mi personaje.',
                'Para enviar un mensaje privado.'] },
            { id: 'do', q: '¿Para qué se usa el comando /do?', ok: 3, opts: [
                'Para señalar la acción que está haciendo mi personaje.',
                'Para enviar un aviso de ayuda.',
                'Para enviar un mensaje privado.',
                'Para mostrar una característica o validar situaciones.'] },
            { id: 'entorno', q: '¿Para qué sirve el comando /entorno?', ok: 2, opts: [
                'Para dar aviso/reporte a los administradores.',
                'Para detallar a un personaje del entorno.',
                'Para dar aviso a los servicios de emergencia.',
                'Para detallar situaciones del entorno.'] },
        ],
    };
    var ALL_QUIZ = QUIZ['quiz-1'].concat(QUIZ['quiz-2']);

    var form = document.getElementById('wl-form');
    var sections = form.querySelectorAll('.section');
    var stepEls = document.querySelectorAll('.step');
    var btnBack = document.getElementById('btn-back');
    var btnNext = document.getElementById('btn-next');
    var status = document.getElementById('nav-status');
    var current = 0;
    var LAST = 2;
    var storyFile = null;

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ------------------------------------------------------------ Preguntas tipo test

    Object.keys(QUIZ).forEach(function (hostId) {
        var html = QUIZ[hostId].map(function (item) {
            var opts = item.opts.map(function (o, i) {
                return '<label class="opt"><input type="radio" name="' + item.id + '" value="' + i + '">' +
                    '<span class="box"></span><span>' + esc(o) + '</span></label>';
            }).join('');
            return '<div class="card q" data-name="' + item.id + '" data-radio="1">' +
                '<label class="q-title">' + esc(item.q) + ' <em>*</em></label>' +
                '<div class="options" role="radiogroup">' + opts + '</div>' +
                '<p class="q-error"></p></div>';
        }).join('');
        document.getElementById(hostId).innerHTML = html;
    });

    // ------------------------------------------------------------ Archivo de la historia

    var fileInput = document.getElementById('historia-file');
    var drop = document.getElementById('drop');
    var pill = document.getElementById('file-pill');
    var maxBytes = (CFG.maxFileMB || 8) * 1024 * 1024;

    document.getElementById('drop-meta').textContent = 'PDF, DOC, DOCX, ODT, RTF o TXT · máx. ' + (CFG.maxFileMB || 8) + ' MB';

    function fmtSize(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }

    function setFile(f) {
        var card = drop.closest('.card');
        if (f && f.size > maxBytes) {
            showError(card, 'El archivo pesa ' + fmtSize(f.size) + '. El máximo es ' + (CFG.maxFileMB || 8) + ' MB.');
            fileInput.value = '';
            return;
        }
        storyFile = f || null;
        drop.classList.toggle('hidden', !!storyFile);
        pill.classList.toggle('hidden', !storyFile);
        if (storyFile) {
            document.getElementById('file-name').textContent = storyFile.name;
            document.getElementById('file-size').textContent = fmtSize(storyFile.size);
            clearError(card);
        } else {
            fileInput.value = '';
        }
    }

    fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
    document.getElementById('file-clear').addEventListener('click', function () { setFile(null); });
    ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

    // ------------------------------------------------------------ Validacion

    function val(name) {
        var el = form.elements[name];
        return el ? String(el.value || '').trim() : '';
    }
    function checkedValues(name) {
        return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; });
    }
    function showError(card, msg) { card.classList.add('invalid'); card.querySelector('.q-error').textContent = msg; }
    function clearError(card) { card.classList.remove('invalid'); }

    function cardError(card) {
        var name = card.dataset.name;
        if (card.dataset.radio || card.dataset.multi) {
            return checkedValues(name).length ? '' : (card.dataset.multi ? 'Elige al menos una opción.' : 'Elige una respuesta.');
        }
        if (name === 'historia') {
            if (storyFile) return '';
            var t = val('historia_texto');
            if (!t) return 'Sube un archivo o escribe la historia.';
            if (t.length < 200) return 'La historia es muy corta (' + t.length + ' caracteres). Escribe al menos 200.';
            return '';
        }
        var v = val(name);
        if (!v) return 'Este campo es obligatorio.';
        if (name === 'edad') {
            var n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 99) return 'Escribe una edad válida.';
        }
        if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Escribe un email válido.';
        if (name === 'discord_id' && !/^\d{17,20}$/.test(v)) return 'El ID de Discord son 17 a 20 números (no es tu nombre de usuario).';
        if (name === 'discord_user' && /\s/.test(v)) return 'El nombre de usuario no lleva espacios.';
        return '';
    }

    function validateSection(i) {
        var firstBad = null;
        sections[i].querySelectorAll('.card.q').forEach(function (card) {
            var err = cardError(card);
            if (err) { showError(card, err); firstBad = firstBad || card; }
            else clearError(card);
        });
        if (firstBad) {
            firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var focusable = firstBad.querySelector('input:not([type=file]), textarea');
            if (focusable && focusable.type !== 'radio' && focusable.type !== 'checkbox') setTimeout(function () { focusable.focus({ preventScroll: true }); }, 300);
        }
        return !firstBad;
    }

    // Revalidar en vivo solo las tarjetas que ya estaban marcadas
    form.addEventListener('input', function (e) {
        var card = e.target.closest('.card.q');
        if (card && card.classList.contains('invalid') && !cardError(card)) clearError(card);
        saveDraft();
    });
    form.addEventListener('change', function (e) {
        var card = e.target.closest('.card.q');
        if (card && card.classList.contains('invalid') && !cardError(card)) clearError(card);
        saveDraft();
    });

    // ------------------------------------------------------------ Borrador local

    function saveDraft() {
        try {
            var data = {};
            Array.prototype.forEach.call(form.elements, function (el) {
                if (!el.name || el.type === 'file' || el.name === 'website') return;
                if (el.type === 'radio' || el.type === 'checkbox') {
                    if (el.checked) (data[el.name] = data[el.name] || []).push(el.value);
                } else data[el.name] = el.value;
            });
            localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        } catch (e) { /* sin almacenamiento: no pasa nada */ }
    }
    function loadDraft() {
        try {
            var data = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
            if (!data) return;
            Array.prototype.forEach.call(form.elements, function (el) {
                if (!el.name || !(el.name in data) || el.type === 'file') return;
                if (el.type === 'radio' || el.type === 'checkbox') el.checked = data[el.name].indexOf(el.value) !== -1;
                else el.value = data[el.name];
            });
        } catch (e) { /* borrador roto: se ignora */ }
    }
    function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { } }

    // ------------------------------------------------------------ Sesion de Discord

    // La sesion la firma el Worker; aqui solo se leen los datos para mostrarlos
    var session = null;
    var sessionToken = '';

    function decodeSession(token) {
        try {
            var b = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
            var data = JSON.parse(decodeURIComponent(escape(atob(b))));
            return data.exp > Date.now() ? data : null;
        } catch (e) { return null; }
    }
    function saveSession(token) {
        try { if (token) localStorage.setItem(SESSION_KEY, token); else localStorage.removeItem(SESSION_KEY); } catch (e) { }
    }
    function startLogin() {
        saveDraft();
        location.href = CFG.endpoint.replace(/\/$/, '') + '/login';
    }

    function showGate(error) {
        document.getElementById('cooldown').classList.add('hidden');
        document.getElementById('login-gate').classList.remove('hidden');
        document.getElementById('steps').classList.add('hidden');
        form.classList.add('hidden');
        document.getElementById('login-error').textContent = error || '';
    }

    function showForm() {
        document.getElementById('login-gate').classList.add('hidden');
        document.getElementById('cooldown').classList.add('hidden');
        document.getElementById('steps').classList.remove('hidden');
        form.classList.remove('hidden');
    }

    // Pantalla de espera: se ve en vez del formulario mientras dura el cooldown
    var cooldownTimer = null;
    function showCooldown(untilIso) {
        var until = new Date(untilIso);
        if (isNaN(until)) return showForm();
        document.getElementById('login-gate').classList.add('hidden');
        document.getElementById('steps').classList.add('hidden');
        form.classList.add('hidden');
        document.getElementById('cooldown').classList.remove('hidden');
        document.getElementById('cd-date').textContent = until.toLocaleString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        }).replace(',', '').replace(/,? (\d{1,2}:\d{2})$/, ' a las $1');
        function tick() {
            var mins = Math.ceil((until - Date.now()) / 60000);
            if (mins <= 0) { clearInterval(cooldownTimer); location.reload(); return; }
            var h = Math.floor(mins / 60), m = mins % 60;
            document.getElementById('cd-left').textContent = 'Faltan ' + (h ? h + ' h ' : '') + m + ' min';
        }
        clearInterval(cooldownTimer);
        tick();
        cooldownTimer = setInterval(tick, 30000);
        window.scrollTo({ top: 0 });
    }

    // Antes de mostrar el formulario se pregunta si la persona puede enviar
    function checkStatus() {
        document.getElementById('steps').classList.add('hidden');
        form.classList.add('hidden');
        var fd = new FormData();
        fd.append('auth', sessionToken);
        fetch(CFG.endpoint.replace(/\/$/, '') + '/status', { method: 'POST', body: fd })
            .then(function (res) {
                if (res.status === 401) { saveSession(''); session = null; showGate(LOGIN_ERRORS.expired); return; }
                return res.json().then(function (data) { if (data.until) showCooldown(data.until); else showForm(); });
            })
            .catch(function () { showForm(); }); // si no se puede consultar, el envio lo vuelve a comprobar
    }

    function applySession() {
        form.elements.discord_id.value = session.id;
        form.elements.discord_user.value = session.username;
        if (session.email && !val('email')) form.elements.email.value = session.email;
        document.getElementById('discord-fields').classList.add('hidden');
        document.getElementById('account').classList.remove('hidden');
        document.getElementById('acc-avatar').src = session.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        document.getElementById('acc-name').textContent = session.name || session.username;
        document.getElementById('acc-user').textContent = '@' + session.username + ' · ' + session.id;
    }

    var LOGIN_ERRORS = {
        cancel: 'Cancelaste el inicio de sesión. Lo necesitamos para continuar.',
        state: 'El inicio de sesión caducó. Inténtalo de nuevo.',
        discord: 'Discord no respondió. Inténtalo de nuevo en un momento.',
        expired: 'Tu sesión con Discord caducó. Vuelve a iniciar sesión: tus respuestas se guardaron.',
    };

    function initLogin() {
        if (!CFG.discordLogin || !CFG.endpoint) return;
        var hash = new URLSearchParams(location.hash.slice(1));
        var error = '';
        if (hash.get('login')) saveSession(hash.get('login'));
        if (hash.get('login_error')) error = LOGIN_ERRORS[hash.get('login_error')] || LOGIN_ERRORS.discord;
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);

        try { sessionToken = localStorage.getItem(SESSION_KEY) || ''; } catch (e) { sessionToken = ''; }
        session = sessionToken ? decodeSession(sessionToken) : null;
        if (session) { applySession(); checkStatus(); }
        else { saveSession(''); showGate(error || (sessionToken ? LOGIN_ERRORS.expired : '')); }
    }

    document.getElementById('btn-login').addEventListener('click', function (e) { e.preventDefault(); startLogin(); });
    document.getElementById('btn-switch').addEventListener('click', function () { saveSession(''); startLogin(); });
    document.getElementById('cd-switch').addEventListener('click', function () { saveSession(''); startLogin(); });

    // ------------------------------------------------------------ Navegacion

    function go(i) {
        current = i;
        sections.forEach(function (s, k) { s.classList.toggle('active', k === i); });
        stepEls.forEach(function (s, k) {
            s.classList.toggle('active', k === i);
            s.classList.toggle('complete', k < i);
        });
        btnBack.classList.toggle('invisible', i === 0);
        btnNext.innerHTML = i === LAST
            ? '<i class="fa-solid fa-paper-plane"></i> Enviar solicitud'
            : 'Siguiente <i class="fa-solid fa-arrow-right"></i>';
        setStatus('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function setStatus(msg, isError) {
        status.textContent = msg;
        status.classList.toggle('error', !!isError);
        if (isError && window.matchMedia('(max-width: 620px)').matches) alert(msg);
    }

    btnBack.addEventListener('click', function () { if (current > 0) go(current - 1); });
    btnNext.addEventListener('click', function () {
        if (!validateSection(current)) { setStatus('Revisa los campos marcados en rojo.', true); return; }
        if (current < LAST) go(current + 1);
        else submit();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    // ------------------------------------------------------------ Envio a Discord

    function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    function quizResults() {
        return ALL_QUIZ.map(function (item) {
            var picked = Number(checkedValues(item.id)[0]);
            return { item: item, picked: picked, right: picked === item.ok };
        });
    }

    function buildTranscript(results) {
        var L = [];
        var line = '────────────────────────────────────────';
        L.push('SOLICITUD DE WHITELIST · ' + (CFG.serverName || 'Team Wild RP'));
        L.push('Fecha: ' + new Date().toLocaleString('es-ES'));
        L.push(line);
        L.push('Usuario de Discord: ' + val('discord_user'));
        L.push('ID de Discord:      ' + val('discord_id'));
        L.push('Edad OOC:           ' + val('edad'));
        L.push('Email:              ' + val('email'));
        L.push('Rol deseado:        ' + checkedValues('roles').join(', '));
        L.push(line);
        L.push('¿POR QUÉ TE GUSTARÍA UNIRTE AL SERVIDOR?', val('porque'), '');
        L.push('¿QUÉ APORTARÍAS AL SERVIDOR?', val('aporte'), '');
        L.push(line);
        L.push('CUESTIONARIO (' + results.filter(function (r) { return r.right; }).length + '/' + results.length + ')', '');
        results.forEach(function (r) {
            L.push((r.right ? '[OK]  ' : '[MAL] ') + r.item.q);
            L.push('      Respondió: ' + r.item.opts[r.picked]);
            if (!r.right) L.push('      Correcta:  ' + r.item.opts[r.item.ok]);
        });
        L.push('', 'ACLARACIÓN "NINGUNA DE LAS ANTERIORES":', val('ninguna'), '');
        L.push('¿QUÉ SIGNIFICA IDP PARA TI?', val('idp'));
        L.push(line);
        L.push('HISTORIA DEL PERSONAJE');
        L.push(storyFile ? '(Adjunta como archivo: ' + storyFile.name + ')' : val('historia_texto'));
        return L.join('\n');
    }

    function buildPayload(results) {
        var score = results.filter(function (r) { return r.right; }).length;
        var pct = score / results.length;
        var color = pct >= .8 ? 0x6faa42 : pct >= .6 ? 0xd9a441 : 0xe0645f;
        var roles = (CFG.pingRoles || []).filter(Boolean).map(String);

        var quizLines = results.map(function (r) {
            return (r.right ? '✅' : '❌') + ' **' + r.item.id.toUpperCase() + '** · ' + cut(r.item.opts[r.picked], 70);
        }).join('\n');

        var historia = storyFile
            ? '📎 Archivo adjunto: `' + cut(storyFile.name, 80) + '`'
            : '📝 Escrita en el formulario (' + val('historia_texto').length + ' caracteres) · ver archivo adjunto';

        var embed = {
            title: '📋 Nueva solicitud de whitelist',
            color: color,
            description: '**Cuestionario: ' + score + '/' + results.length + '**\n' + quizLines,
            fields: [
                { name: 'Usuario', value: '<@' + val('discord_id') + '>\n`' + cut(val('discord_user'), 40) + '`', inline: true },
                { name: 'ID de Discord', value: '`' + val('discord_id') + '`', inline: true },
                { name: 'Edad OOC', value: val('edad'), inline: true },
                { name: 'Email', value: cut(val('email'), 100), inline: true },
                { name: 'Rol deseado', value: checkedValues('roles').join(', '), inline: true },
                { name: 'Historia', value: historia, inline: false },
                { name: '¿Por qué quiere unirse?', value: cut(val('porque'), 700) },
                { name: '¿Qué aportaría?', value: cut(val('aporte'), 700) },
                { name: '"Ninguna de las anteriores"', value: cut(val('ninguna'), 400) },
                { name: '¿Qué entiende por IDP?', value: cut(val('idp'), 700) },
            ],
            footer: { text: (CFG.serverName || 'Team Wild RP') + ' · Whitelist' },
            timestamp: new Date().toISOString(),
        };

        return {
            username: 'Whitelist · ' + (CFG.serverName || 'Team Wild RP'),
            content: (roles.length ? roles.map(function (id) { return '<@&' + id + '>'; }).join(' ') + ' ' : '') +
                'Nueva solicitud de whitelist de **' + cut(val('discord_user'), 40).replace(/([*_`~|\\])/g, '\\$1') + '**',
            // Solo pueden sonar los roles configurados; nada que escriba el usuario puede mencionar a nadie
            allowed_mentions: { parse: [], roles: roles, users: [] },
            embeds: [embed],
        };
    }

    function submit() {
        if (form.elements.website.value) { go(3); document.getElementById('nav').classList.add('hidden'); return; } // bot
        if (!CFG.endpoint) { setStatus('El formulario aún no está conectado a Discord. Avisa a un administrador.', true); return; }

        var results = quizResults();
        var payload = buildPayload(results);
        var safeUser = val('discord_user').replace(/[^\w.-]/g, '_').slice(0, 32) || 'usuario';

        var fd = new FormData();
        fd.append('payload_json', JSON.stringify(payload));
        if (session) fd.append('auth', sessionToken);
        fd.append('files[0]', new Blob([buildTranscript(results)], { type: 'text/plain;charset=utf-8' }), 'solicitud-' + safeUser + '.txt');
        if (storyFile) {
            var ext = (storyFile.name.match(/\.[a-z0-9]{1,5}$/i) || [''])[0];
            fd.append('files[1]', storyFile, 'historia-' + safeUser + ext);
        }

        btnNext.disabled = btnBack.disabled = true;
        btnNext.innerHTML = '<i class="fa-solid fa-spinner"></i> Enviando…';
        setStatus('');

        fetch(CFG.endpoint, { method: 'POST', body: fd })
            .then(function (res) {
                if (res.ok) { clearDraft(); go(3); document.getElementById('nav').classList.add('hidden'); return; }
                if (res.status === 401) {
                    saveDraft();
                    saveSession('');
                    session = null;
                    showGate(LOGIN_ERRORS.expired);
                    return;
                }
                if (res.status === 409) return res.json().catch(function () { return {}; }).then(function (data) {
                    if (data.until && session) { clearDraft(); showCooldown(data.until); return; }
                    var until = data.until ? new Date(data.until) : null;
                    throw new Error('Ya hay una solicitud enviada con este ID de Discord o email. ' + (until
                        ? 'Podrás enviar otra a partir del ' + until.toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + '.'
                        : 'Espera unas horas para enviar otra.'));
                });
                if (res.status === 429) throw new Error('Hay muchas solicitudes ahora mismo. Espera un minuto y vuelve a intentarlo.');
                if (res.status === 413) throw new Error('El archivo es demasiado grande para Discord. Prueba con uno más pequeño.');
                throw new Error('No se pudo enviar (error ' + res.status + '). Inténtalo de nuevo.');
            })
            .catch(function (err) {
                setStatus(err && err.message && err.message.indexOf('Failed to fetch') === -1
                    ? err.message : 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.', true);
            })
            .finally(function () {
                btnNext.disabled = btnBack.disabled = false;
                if (current === LAST) btnNext.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar solicitud';
            });
    }

    loadDraft();
    initLogin();
    go(0);
})();
