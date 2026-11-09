// Obtiene Dólar observado, Euro, UF y UTM y los guarda en data/indicadores.json.
// Fuente principal: API del Banco Central de Chile (requiere secretos BCCH_USER y BCCH_PASS).
// Respaldo: mindicador.cl (sin registro).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = 'data/indicadores.json';
const SERIES = {
  dolar: 'F073.TCO.PRE.Z.D',   // Dólar observado
  euro:  'F072.CLP.EUR.N.O.D', // Euro en pesos
  uf:    'F073.UFF.PRE.Z.D',   // Unidad de Fomento
  utm:   'F073.UTR.PRE.Z.M',   // Unidad Tributaria Mensual
};

const fmt = d => d.toISOString().slice(0, 10);

async function desdeBancoCentral(user, pass) {
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(desde.getDate() - 45);
  const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 5); // la UF se publica por adelantado
  const out = {}; let fechaDolar = null;
  for (const [k, code] of Object.entries(SERIES)) {
    const url = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?' + new URLSearchParams({
      user, pass, firstdate: fmt(desde), lastdate: fmt(hasta), timeseries: code, function: 'GetSeries',
    });
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j.Codigo !== 0) throw new Error(`Código ${j.Codigo}: ${j.Descripcion}`);
      // Para la UF se toma el valor de hoy (Chile), no el último publicado por adelantado
      const hoyCL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
      const obs = (j.Series?.Obs || [])
        .filter(o => o.statusCode === 'OK' && !isNaN(parseFloat(o.value)))
        .map(o => { const [d, m, y] = o.indexDateString.split('-'); return { fecha: `${y}-${m}-${d}`, valor: parseFloat(o.value) }; })
        .filter(o => o.fecha <= hoyCL);
      const ultimo = obs.at(-1);
      if (!ultimo) throw new Error('sin observaciones');
      out[k] = ultimo.valor;
      if (k === 'dolar') fechaDolar = ultimo.fecha;
      console.log(`${k}: ${ultimo.valor} (${ultimo.fecha})`);
    } catch (e) {
      console.warn(`No se pudo obtener ${k} (${code}): ${e.message}`);
    }
  }
  if (!out.dolar) throw new Error('El Banco Central no devolvió el dólar observado');
  return { ...out, fecha: fechaDolar, fuente: 'Banco Central de Chile' };
}

async function desdeMindicador() {
  const r = await fetch('https://mindicador.cl/api');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return { dolar: d.dolar.valor, euro: d.euro?.valor, uf: d.uf?.valor, utm: d.utm?.valor,
           fecha: d.dolar.fecha.slice(0, 10), fuente: 'Banco Central de Chile (vía mindicador.cl)' };
}

let datos;
const { BCCH_USER, BCCH_PASS } = process.env;
try {
  if (!BCCH_USER || !BCCH_PASS) throw new Error('Faltan los secretos BCCH_USER / BCCH_PASS');
  datos = await desdeBancoCentral(BCCH_USER, BCCH_PASS);
} catch (e) {
  console.warn('Banco Central:', e.message, '→ usando mindicador.cl');
  datos = await desdeMindicador();
}

// Conserva valores anteriores si alguno faltó esta vez
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  for (const k of Object.keys(SERIES)) if (datos[k] == null && prev[k] != null) datos[k] = prev[k];
}
mkdirSync('data', { recursive: true });
datos.actualizado = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(datos, null, 2) + '\n');
console.log('Guardado', OUT, datos);
