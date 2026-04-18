const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');

async function scrapeCEJ(expediente, persona) {
    const parts = expediente.split('-');
    if (parts.length !== 7) {
        throw new Error('Formato de expediente inválido.');
    }

    const [p1, p2, p3, p4, p5, p6, p7] = parts;

    console.log(`[INFO] Iniciando scraper stealth para el exp: ${expediente}`);

    const browser = await puppeteer.launch({
        headless: false, // mantener false ayuda a evadir algunos WAF
        defaultViewport: null
    });

    const page = await browser.newPage();
    try {
        console.log('[INFO] Navegando al CEJ...');
        await page.goto('https://cej.pj.gob.pe/cej/forms/busquedaform.html', { waitUntil: 'networkidle2' });

        // A veces Radware Bot Manager bloquea igual. Damos 60 segs por si al usuario le sale un popup de "Soy Humano" y deba hacer clic.
        console.log('[INFO] Esperando a que el portal cargue (Si sale hCaptcha "Soy humano" en tu pantalla, resuélvelo por favor)...');
        
        // Clic en la pestaña de Búsqueda por Código de Expediente
        await page.waitForSelector('a[href="#tabs-2"]', { timeout: 60000 });
        await page.click('a[href="#tabs-2"]');
        
        // Esperar a que el formulario cargue
        await new Promise(r => setTimeout(r, 1000));

        // Llenar datos numéricos y parte
        console.log('[INFO] Llenando expediente y nombre del involucrado...');
        await page.type('#cod_expediente', p1);
        await page.type('#cod_anio', p2);
        await page.type('#cod_incidente', p3);
        await page.type('#cod_distprov', p4);
        await page.type('#cod_organo', p5);
        await page.type('#cod_especialidad', p6);
        await page.type('#cod_instancia', p7);
        await page.type('#parte', persona);

        // Bajamos para encontrar la imagen captcaha
        const captchaEl = await page.waitForSelector('#captcha_image');
        await captchaEl.screenshot({ path: 'captcha.png' });
        console.log('[INFO] Captcha descargado. Pausando script para lectura manual...');

        // === TEMPORALMENTE PARA EL TEST: Le pediremos al programador ver el archivo y escribir el captcha ===
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const captchaText = await new Promise(resolve => {
            readline.question('=> Abre el archivo captcha.png y escribe el captcha: ', ans => {
                readline.close();
                resolve(ans.trim());
            });
        });

        await page.type('#codigoCaptcha', captchaText);

        // Enviar al server
        console.log('[INFO] Enviando formulario...');
        await page.click('#consultarExpedientes'); // botón consultar
        
        // Esperamos a ver qué carga
        await new Promise(r => setTimeout(r, 6000)); // 6 segundos para que cargue la lista, a veces demora más

        // Revisar si hubo error en captcha
        const divMensaje = await page.$('#mensaje'); 
        if (divMensaje) {
             const textoMsj = await page.evaluate(el => el.textContent, divMensaje);
             if (textoMsj && textoMsj.trim() !== '') {
                 console.log('[ERROR] El sistema devolvió un mensaje: ', textoMsj.trim());
             }
        }

        console.log('[INFO] Entrando a los detalles del expediente...');
        // Clic en el botón "Ver detalle"
        const detailsBtn = await page.waitForSelector('button[title="Ver detalle de expediente"]', { timeout: 15000 });
        await detailsBtn.click();

        // Esperar a que cargue la vista de detalles
        await new Promise(r => setTimeout(r, 6000));

        // Capturar pantalla de resultados
        await page.screenshot({ path: 'resultado_2_detalles.png', fullPage: true });
        console.log('[INFO] Captura resultado_2_detalles.png guardada.');

        // Extraer DOM final para extraer variables JSON
        const finalHtml = await page.content();
        fs.writeFileSync('debug_detalles.html', finalHtml);
        console.log('[INFO] HML final guardado en debug_detalles.html.');
        
        await browser.close();
    } catch (err) {
        console.error('Error general:', err);
        await browser.close();
    }
}

scrapeCEJ('01180-2026-0-3204-JP-FC-02', 'ARIANA HOYOS TEJEDA');
