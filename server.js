const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');

puppeteer.use(StealthPlugin());
puppeteer.use(
    RecaptchaPlugin({
        provider: { id: '2captcha', token: 'ced1a53af6a1742a33328af4d12e3b20' },
        visualFeedback: true
    })
);

const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Función para parsear el HTML
function parseCEJHtml(html) {
    const $ = cheerio.load(html);
    const expedienteObj = { 
        organo_jurisdiccional: '', 
        distrito_judicial: '', 
        materia: '', 
        estado: '', 
        sumilla: '', 
        demandante: '', 
        demandado: '',
        fecha_inicio: '',
        especialidad: '',
        juez: '',
        especialista_legal: '',
        proceso: '',
        etapa_procesal: '',
        ubicacion: '',
        motivo_conclusion: '',
        observacion: '',
        movimientos: [] 
    };

    const limpiar = (txt) => txt ? txt.replace(/\s+/g, ' ').trim() : '';

    $('.celdaGridN').each((i, el) => {
        const label = $(el).text().trim().toLowerCase();
        const val = limpiar($(el).next().text());
        
        if (label.includes('órgano jurisdiccional') || label.includes('rgano')) expedienteObj.organo_jurisdiccional = val;
        else if (label.includes('distrito')) expedienteObj.distrito_judicial = val;
        else if (label.includes('materia')) expedienteObj.materia = val;
        else if (label.includes('estado')) expedienteObj.estado = val;
        else if (label.includes('sumilla')) expedienteObj.sumilla = val;
        else if (label.includes('fecha de inicio')) expedienteObj.fecha_inicio = val;
        else if (label.includes('especialidad')) expedienteObj.especialidad = val;
        else if (label.includes('juez') && !label.includes('juzgado')) expedienteObj.juez = val;
        else if (label.includes('especialista legal')) expedienteObj.especialista_legal = val;
        else if (label.includes('proceso')) expedienteObj.proceso = val;
        else if (label.includes('etapa procesal')) expedienteObj.etapa_procesal = val;
        else if (label.includes('ubicaci')) expedienteObj.ubicacion = val;
        else if (label.includes('motivo conclusi')) expedienteObj.motivo_conclusion = val;
        else if (label.includes('observaci')) expedienteObj.observacion = val;
    });

    const partesRaw = $('div.divRepExp').text();
    if(partesRaw) {
        const lim = limpiar(partesRaw);
        
        const ddoIdx = lim.indexOf('DEMANDADO:');
        const dteIdx = lim.indexOf('DEMANDANTE:');
        
        let endIdx = lim.length;

        if (ddoIdx !== -1) {
            let nextKeyword = dteIdx !== -1 && dteIdx > ddoIdx ? dteIdx : endIdx;
            let ddoPart = lim.substring(ddoIdx + 10, nextKeyword).trim();
            if(ddoPart.endsWith('.')) ddoPart = ddoPart.slice(0, -1);
            expedienteObj.demandado = ddoPart;
        }

        if (dteIdx !== -1) {
            let nextKeyword = ddoIdx !== -1 && ddoIdx > dteIdx ? ddoIdx : endIdx;
            // A veces hay metadatos extras al final que hay que limpiar
            let dtePart = lim.substring(dteIdx + 11, nextKeyword).trim();
            // Limpia todo después del último punto si se coló basura
            const splitted = dtePart.split('.');
            if(splitted.length > 2) dtePart = splitted[0].trim();
            else if(dtePart.endsWith('.')) dtePart = dtePart.slice(0, -1);
            
            expedienteObj.demandante = dtePart;
        }
    }

    const actos = [];
    $('.panel-body').each((i, panel) => {
        const mov = { fecha_resolucion: '', resolucion: '', acto: '', sumilla: '' };
        $(panel).find('.borderinf').each((j, binf) => {
            const label = $(binf).find('.roptionss').text().toLowerCase().trim();
            const val = limpiar($(binf).find('.fleft').text());
            if(label.includes('fecha')) mov.fecha_resolucion = val;
            else if(label.includes('resolu')) mov.resolucion = val;
            else if(label.includes('acto:')) mov.acto = val;
            else if(label.includes('sumilla')) mov.sumilla = val;
        });
        if (mov.fecha_resolucion || mov.acto || mov.resolucion) actos.push(mov);
    });

    expedienteObj.movimientos = actos;
    return expedienteObj;
}

// ── Almacén en memoria de jobs asíncronos ──────────────────────────────────
const jobs = {}; // { jobId: { status: 'pending'|'done'|'error', result, error } }

// Función central de scraping (reutilizable)
async function runScrape(expediente, parte) {
    const parts = expediente.split('-');
    if (parts.length !== 7) throw new Error('Formato inválido. Deben ser 7 segmentos separados por guión.');
    const [p1, p2, p3, p4, p5, p6, p7] = parts;

    const browser = await puppeteer.launch({ 
        headless: true, 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--ignore-certificate-errors',        // Evita errores SSL con proxies
            '--ignore-ssl-errors',
            '--disable-web-security',
            // Proxy residencial para evitar el bloqueo Radware/geo-IP del Poder Judicial
            ...(process.env.PROXY_SERVER ? [`--proxy-server=${process.env.PROXY_SERVER}`] : [])
        ],
        defaultViewport: null 
    });

    try {
        const page = await browser.newPage();

        // Autenticar proxy si está configurado
        if (process.env.PROXY_USER && process.env.PROXY_PASS) {
            await page.authenticate({
                username: process.env.PROXY_USER,
                password: process.env.PROXY_PASS
            });
            console.log('🔐 Proxy residencial activado.');
        }

        // Simular un navegador normal para evitar bloqueos
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' });

        await page.goto('https://cej.pj.gob.pe/cej/forms/busquedaform.html', { waitUntil: 'networkidle2', timeout: 90000 });
        
        // Log de diagnóstico: ¿qué página ve el bot?
        const pageTitle = await page.title();
        const pageUrl = page.url();
        console.log(`📄 Página cargada: "${pageTitle}" | URL: ${pageUrl}`);

        // Esperar más tiempo a que el JS de pestañas cargue
        await new Promise(r => setTimeout(r, 3000));

        // Intentar hacer clic en la pestaña de búsqueda por código
        const tabExists = await page.$('a[href="#tabs-2"]');
        if (tabExists) {
            await page.click('a[href="#tabs-2"]');
            console.log('✅ Pestaña de código encontrada y clickeada.');
        } else {
            // Si no existe la pestaña, tomar screenshot para diagnóstico
            const screenshotB64 = await page.screenshot({ encoding: 'base64', fullPage: false });
            console.log(`⚠️ Pestaña #tabs-2 no encontrada. HTML snippet: ${(await page.content()).substring(0, 500)}`);
            throw new Error(`Geo-bloqueo o cambio en la web del CEJ. Título de página recibida: "${pageTitle}" | URL: ${pageUrl}`);
        }
        
        await new Promise(r => setTimeout(r, 1500));

        await page.type('#cod_expediente', p1);
        await page.type('#cod_anio', p2);
        await page.type('#cod_incidente', p3);
        await page.type('#cod_distprov', p4);
        await page.type('#cod_organo', p5);
        await page.type('#cod_especialidad', p6);
        await page.type('#cod_instancia', p7);
        await page.type('#parte', parte);
        await new Promise(r => setTimeout(r, 800));
        
        console.log('\n=============================================');
        console.log('🤖 ENVIANDO IMAGEN CAPTCHA A 2CAPTCHA...');
        console.log('=============================================\n');

        await page.solveRecaptchas();
        
        const captchaEl = await page.waitForSelector('#captcha_image');
        await page.evaluate((el) => el.scrollIntoView(), captchaEl);
        await new Promise(r => setTimeout(r, 500)); 
        const base64Img = await captchaEl.screenshot({ encoding: 'base64' });

        const axios = require('axios');
        let ocrText = '';
        const apiKey2c = 'ced1a53af6a1742a33328af4d12e3b20';
        
        const r1 = await axios.post('http://2captcha.com/in.php', {
           key: apiKey2c, method: 'base64', body: base64Img, json: 1
        });
        
        if (r1.data.status === 1) {
            const reqId = r1.data.request;
            console.log('⌛ Esperando respuesta de 2captcha (ID: ' + reqId + ')...');
            for(let i=0; i<20; i++) {
                await new Promise(r => setTimeout(r, 4000));
                const r2 = await axios.get(`http://2captcha.com/res.php?key=${apiKey2c}&action=get&id=${reqId}&json=1`);
                if(r2.data.status === 1) { 
                    ocrText = r2.data.request.toUpperCase(); 
                    console.log('✅ Solucionado: ' + ocrText);
                    break; 
                }
            }
        } else {
            console.log("❌ Error 2captcha: ", r1.data);
            throw new Error('Servicio 2Captcha sin saldo o fallido');
        }

        if (!ocrText) throw new Error('No se pudo resolver el Captcha en el tiempo esperado');

        await page.type('#codigoCaptcha', ocrText);
        await page.click('#consultarExpedientes');
        
        // Esperar más tiempo a que cargue la página de resultados
        await new Promise(r => setTimeout(r, 8000));

        // Screenshot de diagnóstico para ver qué tiene la página después del submit
        const screenshotAfterSubmit = await page.screenshot({ encoding: 'base64', fullPage: false });
        const htmlAfterSubmit = await page.content();
        const snippetAfterSubmit = htmlAfterSubmit.substring(0, 800);
        console.log('📸 HTML tras submit (primeros 800 chars):', snippetAfterSubmit);

        // Verificar si el captcha fue rechazado o hay mensaje de error
        const divMensaje = await page.$('#mensaje');
        if (divMensaje) {
            const textoMsj = await page.evaluate(el => el.innerText, divMensaje);
            const textoLimpio = textoMsj ? textoMsj.trim() : '';
            console.log('📢 Mensaje CEJ:', textoLimpio);
            if (textoLimpio !== '') throw new Error('CEJ respondió: ' + textoLimpio);
        }

        // Verificar si el botón de detalle está disponible (aumentamos timeout a 20s)
        let detailsBtn;
        try {
            detailsBtn = await page.waitForSelector('button[title="Ver detalle de expediente"]', { timeout: 20000 });
        } catch(e) {
            // Tomar screenshot del estado actual para diagnóstico
            const htmlActual = await page.content();
            console.log('⚠️ Botón no encontrado. URL actual:', page.url());
            console.log('⚠️ HTML actual (primeros 1000):', htmlActual.substring(0, 1000));
            throw new Error('No se encontraron resultados para ese expediente/parte. Verifique los datos e intente de nuevo.');
        }

        await detailsBtn.click();
        await new Promise(r => setTimeout(r, 7000));

        const finalHtml = await page.content();
        const jsonResult = parseCEJHtml(finalHtml);

        await browser.close();
        return jsonResult;
    } catch(e) {
        await browser.close();
        throw e;
    }
}

// ── POST /scrape-async — Inicia job y devuelve jobId inmediatamente ─────────
app.post('/scrape-async', (req, res) => {
    const { expediente, parte } = req.body;
    if(!expediente || !parte) return res.status(400).json({ error: 'Faltan datos' });

    // Generar ID único de job
    const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    jobs[jobId] = { status: 'pending' };

    // Limpiar jobs viejos (más de 30 min) para no saturar la memoria
    const ahora = Date.now();
    Object.keys(jobs).forEach(id => {
        if (jobs[id].createdAt && (ahora - jobs[id].createdAt) > 1800000) delete jobs[id];
    });
    jobs[jobId].createdAt = ahora;

    console.log(`🚀 Job ${jobId} iniciado para expediente: ${expediente}`);

    // Ejecutar en background sin bloquear la respuesta
    runScrape(expediente, parte)
        .then(result => {
            jobs[jobId].status = 'done';
            jobs[jobId].result = result;
            console.log(`✅ Job ${jobId} completado.`);
        })
        .catch(err => {
            jobs[jobId].status = 'error';
            jobs[jobId].error = err.message;
            console.log(`❌ Job ${jobId} falló: ${err.message}`);
        });

    // Responder inmediatamente con el jobId (en menos de 1 segundo)
    res.json({ jobId, status: 'pending' });
});

// ── GET /scrape-status/:jobId — Consulta estado del job ────────────────────
app.get('/scrape-status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ error: 'Job no encontrado o expirado' });
    res.json(job);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Buscador Aislado corriendo en http://localhost:${PORT}`);
    console.log(`(Abre esa URL en tu Google Chrome para ver la interfaz y probar el sistema local)`);
});
