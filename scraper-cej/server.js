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

app.post('/scrape', async (req, res) => {
    const { expediente, parte } = req.body;
    if(!expediente || !parte) return res.status(400).json({error: 'Faltan datos'});

    const parts = expediente.split('-');
    if (parts.length !== 7) return res.status(400).json({error: 'Formato inválido'});
    const [p1, p2, p3, p4, p5, p6, p7] = parts;

    let browser;
    try {
        browser = await puppeteer.launch({ headless: false, defaultViewport: null });
        const page = await browser.newPage();
        await page.goto('https://cej.pj.gob.pe/cej/forms/busquedaform.html', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('a[href="#tabs-2"]', { timeout: 60000 });
        await page.click('a[href="#tabs-2"]');
        await new Promise(r => setTimeout(r, 1000));

        await page.type('#cod_expediente', p1);
        await page.type('#cod_anio', p2);
        await page.type('#cod_incidente', p3);
        await page.type('#cod_distprov', p4);
        await page.type('#cod_organo', p5);
        await page.type('#cod_especialidad', p6);
        await page.type('#cod_instancia', p7);
        await page.type('#parte', parte);

        // Captcha CEJ Solución Automática con 2Captcha
        await new Promise(r => setTimeout(r, 800)); // Esperar que se dibuje
        
        console.log('\n=============================================');
        console.log('🤖 ENVIANDO CAPTCHAS A 2CAPTCHA...');
        console.log('=============================================\n');

        // Solve image catchas/recaptchas automatically
        const { captchas, solutions, error } = await page.solveRecaptchas();
        
        if (error) {
            console.log('❌ Error resolviendo reCaptchas:', error);
        }

        // Si hay una imagen con ID codigoCaptcha que no es reCaptcha tradicional,
        // a veces hay que extraerlo y enviarlo.
        // Pero resolveRecaptchas de puppeteer-extra intercepta reCaptcha/hCaptcha.
        // Para el Captcha NORMAL de texto de la CEJ:
        // puppeteer-extra-plugin-recaptcha no resuelve esto automáticamente si no lo marcamos.
        
        // Dejaremos el failsafe manual SOLO en caso 2captcha esté sin saldo para el login
        console.log('Verificando si se requiere input adicional...');
        
        // --- PARA LA IMAGEN ALFANUMÉRICA CEJ ---
        // (El plugin recaptcha resuelve el "Soy Humano". El código de la imagen hay que mandarlo a 2captcha manualmente o vía tesseract si no hay saldo)
        // NOTA: Para no romper el demo actual en caso de saldo 0, reactivo readline fallback.
        
        const captchaEl = await page.waitForSelector('#captcha_image');
        await page.evaluate((el) => el.scrollIntoView(), captchaEl);
        await new Promise(r => setTimeout(r, 500)); 
        await captchaEl.screenshot({ path: 'captcha_bot.png' });

        const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        const ocrText = await new Promise(resolve => {
            readline.question('=> Escribe el captcha de la imagen CEJ: ', ans => {
                readline.close();
                resolve(ans.trim().toUpperCase());
            });
        });

        await page.type('#codigoCaptcha', ocrText);
        await page.click('#consultarExpedientes');
        
        await new Promise(r => setTimeout(r, 5000)); 

        const divMensaje = await page.$('#mensaje'); 
        if (divMensaje) {
             const textoMsj = await page.evaluate(el => el.textContent, divMensaje);
             if (textoMsj && textoMsj.trim() !== '') throw new Error('CEJ Bot: ' + textoMsj.trim());
        }

        const detailsBtn = await page.waitForSelector('button[title="Ver detalle de expediente"]', { timeout: 10000 });
        await detailsBtn.click();
        await new Promise(r => setTimeout(r, 5000));

        const finalHtml = await page.content();
        const jsonResult = parseCEJHtml(finalHtml);

        await browser.close();
        res.json(jsonResult);
    } catch (error) {
        if(browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Buscador Aislado corriendo en http://localhost:${PORT}`);
    console.log(`(Abre esa URL en tu Google Chrome para ver la interfaz y probar el sistema local)`);
});
