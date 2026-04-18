const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('debug_detalles.html', 'utf8');
const $ = cheerio.load(html);

const expedienteObj = {
    organo_jurisdiccional: '',
    distrito_judicial: '',
    materia: '',
    estado: '',
    sumilla: '',
    demandante: '',
    demandado: '',
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
    else if (label.includes('sumilla:')) expedienteObj.sumilla = val;
});

// Partes
const partesRaw = $('div.divRepExp').text();
if(partesRaw) {
    const lim = limpiar(partesRaw);
    const m = lim.match(/DEMANDADO:\s*(.*?)\.\s*DEMANDANTE:\s*(.*?)(?=\.|$)/);
    if(m) {
        expedienteObj.demandado = m[1].trim();
        expedienteObj.demandante = m[2].trim();
    }
}

// Movimientos / Actos
const actos = [];
$('.panel-body').each((i, panel) => {
    // Buscar bloques 'borderinf' dentro
    const mov = { fecha_resolucion: '', resolucion: '', acto: '', sumilla: '' };
    
    $(panel).find('.borderinf').each((j, binf) => {
        const label = $(binf).find('.roptionss').text().toLowerCase().trim();
        const val = limpiar($(binf).find('.fleft').text());

        if(label.includes('fecha')) mov.fecha_resolucion = val;
        else if(label.includes('resolu')) mov.resolucion = val;
        else if(label.includes('acto:')) mov.acto = val;
        else if(label.includes('sumilla')) mov.sumilla = val;
    });

    if (mov.fecha_resolucion || mov.acto || mov.resolucion) {
        actos.push(mov);
    }
});

expedienteObj.movimientos = actos;

console.log('--- RESULTADO FINAL DE SCRAPING CEJ ---');
console.log(JSON.stringify(expedienteObj, null, 2));
