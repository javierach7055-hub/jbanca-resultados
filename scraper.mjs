import fs from 'node:fs';

const LOTTERY_SOURCES = [
  // 9 loterías originales (LoteriaDeHoy)
  { id: 'lotto_activo', source: 'loteriadehoy', slug: 'lottoactivo' },
  { id: 'la_granjita', source: 'loteriadehoy', slug: 'lagranjita' },
  { id: 'guacharo_activo', source: 'loteriadehoy', slug: 'guacharoactivo' },
  { id: 'guacharito_millonario', source: 'loteriadehoy', slug: 'elguacharitomillonario' },
  { id: 'selva_plus', source: 'loteriadehoy', slug: 'selvaplus' },
  { id: 'lotto_internacional', source: 'loteriadehoy', slug: 'lottoactivordint' },
  { id: 'lotto_rd', source: 'loteriadehoy', slug: 'lottoactivordominicana' },
  { id: 'chance_animalitos', source: 'loteriadehoy', slug: 'chanceconanimalitos' },
  { id: 'ruleta_activa', source: 'loteriadehoy', slug: 'ruletaactiva' },

  // 2 loterías nuevas en LoteriaDeHoy
  { id: 'loto_chaima', source: 'loteriadehoy', slug: 'lotochaima' },
  { id: 'granja_millonaria', source: 'loteriadehoy', slug: 'granjamillionaria' },

  // Cóndor Gana en LottoResultados (funcionando al 100%)
  { id: 'condor_gana', source: 'lottoresultados', url: 'https://www.lottoresultados.com/resultados/animalitos/condor-gana' },

  // Tropi Gana con respaldo doble: Centro de Apuestas El Rey (principal) + LottoResultados (fallback)
  {
    id: 'tropi_gana',
    source: 'tropi_dual',
    primaryUrl: 'https://centrodeapuestaselrey.com.ve/resultados/tropi-gana',
    fallbackUrl: 'https://www.lottoresultados.com/resultados/animalitos/tropi-gana'
  },

  // El Granjazo en LottoResultados (con navegador real / browser engine en Jina para evitar bloqueo 403/503)
  { id: 'el_granjazo', source: 'lottoresultados', url: 'https://www.lottoresultados.com/resultados/animalitos/el-granjazo-granja-millonaria' },

  // Fruita Gana en TuAzar (funcionando al 100%)
  { id: 'fruita_gana', source: 'tuazar_frutas', url: 'https://resultados.tuazar.com/loteria/frutas/resultados' }
];

function getCaracasDate() {
  const now = new Date();
  const caracas = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const y = caracas.getFullYear();
  const m = String(caracas.getMonth() + 1).padStart(2, '0');
  const d = String(caracas.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeAnimalNum(rawNum) {
  const upper = String(rawNum || '').trim().toUpperCase();
  if (upper === '0' || upper === '00' || upper === '0A' || upper === '0B') return upper;
  return upper.length === 1 ? upper.padStart(2, '0') : upper;
}

function extractTime24(rawLine) {
  const clean = String(rawLine || '').replace(/^#+\s*/, '').trim().toUpperCase();
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\b/);
  if (!match) return null;
  const [, rawH, min, meridiem] = match;
  let hour = parseInt(rawH, 10);
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJinaRaw(targetUrl, useBrowserEngine = false) {
  const jinaUrl = `https://r.jina.ai/${targetUrl}`;
  const headers = {
    'Accept': 'text/plain',
    'X-No-Cache': 'true'
  };
  if (useBrowserEngine) {
    headers['X-Engine'] = 'browser';
    headers['X-Wait-For-Selector'] = 'h4';
  }
  const res = await fetch(jinaUrl, { headers });
  if (!res.ok) {
    console.warn(`HTTP ${res.status} al consultar ${targetUrl}`);
    return '';
  }
  return await res.text();
}

// Parser 1: LoteriaDeHoy
async function fetchFromLoteriaDeHoy(lotteryId, slug, dateStr) {
  const targetUrl = `https://loteriadehoy.com/animalito/${slug}/resultados/${dateStr}/`;
  const text = await fetchJinaRaw(targetUrl);
  if (!text) return [];

  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '-');

  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Quieres hacer publicidad')) break;

    const animalMatch = line.match(/^(00|0A|0B|[0-9]{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]+)$/);
    if (!animalMatch) continue;

    let drawTime = null;
    for (let offset = 1; offset <= 3; offset++) {
      const parsedTime = extractTime24(lines[i + offset] || '');
      if (parsedTime) {
        drawTime = parsedTime;
        break;
      }
    }

    if (drawTime) {
      found.push({
        lotteryId,
        drawTime,
        animalNum: normalizeAnimalNum(animalMatch[1]),
        animalName: animalMatch[2].trim()
      });
    }
  }
  return found;
}

// Parser 2: Centro de Apuestas El Rey (Tropi Gana: "9:00 am" + "![tropi-gana-resultado](.../17_pavo.jpg)" + "Pavo")
async function fetchFromElReyTropiGana(lotteryId, targetUrl) {
  const text = await fetchJinaRaw(targetUrl);
  if (!text) return [];

  const foundMap = new Map();
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '-');

  for (let i = 0; i < lines.length; i++) {
    const drawTime = extractTime24(lines[i]);
    if (!drawTime) continue;

    let animalNum = null;
    let animalName = null;

    for (let offset = 1; offset <= 3; offset++) {
      const nextLine = lines[i + offset] || '';
      const imgMatch = nextLine.match(/\/tropi_gana\/(00|[0-9]{1,2})_([a-zA-Z0-9_-]+)\.(jpg|png|webp)/i);
      if (imgMatch) {
        animalNum = imgMatch[1];
        const nextName = (lines[i + offset + 1] || '').trim();
        if (nextName && !nextName.startsWith('!') && !extractTime24(nextName)) {
          animalName = nextName;
        } else {
          animalName = imgMatch[2].replace(/[_-]/g, ' ');
        }
        break;
      }
    }

    if (animalNum !== null && animalName) {
      foundMap.set(drawTime, {
        lotteryId,
        drawTime,
        animalNum: normalizeAnimalNum(animalNum),
        animalName: animalName.charAt(0).toUpperCase() + animalName.slice(1)
      });
    }
  }

  return Array.from(foundMap.values());
}

// Parser 3: LottoResultados (con reintento usando motor de navegador si la primera respuesta viene vacía/rate-limited)
async function fetchFromLottoResultados(lotteryId, targetUrl, dateStr) {
  let text = await fetchJinaRaw(targetUrl, false);
  if (!text || !text.includes('Resultados de Hoy')) {
    await sleep(1500);
    text = await fetchJinaRaw(targetUrl, true);
  }
  if (!text) return [];

  const foundMap = new Map();

  // Método A: alt text exacto "Resultado 61 Turpial de ... el 2026-11-26 a las 09:30"
  const altRegex = new RegExp(
    `Resultado\\s+(00|0A|0B|[0-9]{1,2})\\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\\s]+?)\\s+de\\s+.+?\\s+el\\s+${dateStr}\\s+a\\s+las\\s+(\\d{1,2}:\\d{2})`,
    'gi'
  );
  let altMatch;
  while ((altMatch = altRegex.exec(text)) !== null) {
    const [, rawNum, rawName, rawTime] = altMatch;
    const [hh, mm] = rawTime.split(':');
    const drawTime = `${hh.padStart(2, '0')}:${mm}`;
    foundMap.set(drawTime, {
      lotteryId,
      drawTime,
      animalNum: normalizeAnimalNum(rawNum),
      animalName: rawName.trim()
    });
  }

  // Método B: líneas dentro de "Resultados de Hoy" hasta "Resultados de Ayer"
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '-');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Resultados de Ayer') || line.includes('Resultados de la semana')) break;

    const drawTime = extractTime24(line);
    if (!drawTime || foundMap.has(drawTime)) continue;

    for (let offset = 1; offset <= 2; offset++) {
      const candidate = lines[i + offset] || '';
      const animalMatch = candidate.match(/^(00|0A|0B|[0-9]{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+)$/);
      if (animalMatch) {
        foundMap.set(drawTime, {
          lotteryId,
          drawTime,
          animalNum: normalizeAnimalNum(animalMatch[1]),
          animalName: animalMatch[2].trim()
        });
        break;
      }
    }
  }

  return Array.from(foundMap.values());
}

// Parser 4: TuAzar Frutas
async function fetchFromTuAzarFrutas(lotteryId, targetUrl) {
  const text = await fetchJinaRaw(targetUrl);
  if (!text) return [];

  const foundMap = new Map();
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '-');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Operadora:')) break;

    const drawTime = extractTime24(line);
    if (!drawTime) continue;

    let fruitName = null;
    let fruitNum = null;

    for (let back = 1; back <= 5; back++) {
      const rawPrev = lines[i - back] || '';
      const imgMatch = rawPrev.match(/\/fruita_gana\/(00|[0-9]{1,2})\.png/i);
      if (imgMatch && fruitNum === null) {
        fruitNum = imgMatch[1];
        continue;
      }

      const cleanPrev = rawPrev.replace(/\*/g, '').replace(/-/g, '').trim();
      if (!cleanPrev || cleanPrev === 'Fruta' || cleanPrev === 'Fruita Gana') continue;

      if (!fruitName && /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleanPrev)) {
        fruitName = cleanPrev;
        continue;
      }
      if (fruitNum === null && /^(00|[0-9]{1,2})$/.test(cleanPrev)) {
        fruitNum = cleanPrev;
      }
    }

    if (fruitNum !== null && fruitName) {
      foundMap.set(drawTime, {
        lotteryId,
        drawTime,
        animalNum: normalizeAnimalNum(fruitNum),
        animalName: fruitName
      });
    }
  }

  return Array.from(foundMap.values());
}

async function run() {
  const today = getCaracasDate();
  let previous = { date: today, updatedAt: new Date().toISOString(), results: [] };

  if (fs.existsSync('resultados.json')) {
    try {
      const parsed = JSON.parse(fs.readFileSync('resultados.json', 'utf8'));
      if (parsed.date === today && Array.isArray(parsed.results)) {
        previous = parsed;
      }
    } catch {}
  }

  const map = new Map();
  for (const item of previous.results) {
    map.set(`${item.lotteryId}|${item.drawTime}`, item);
  }

  for (const src of LOTTERY_SOURCES) {
    try {
      let items = [];
      if (src.source === 'loteriadehoy') {
        items = await fetchFromLoteriaDeHoy(src.id, src.slug, today);
      } else if (src.source === 'lottoresultados') {
        await sleep(1200); // Pausa corta para evitar límite de peticiones simultáneas en LottoResultados
        items = await fetchFromLottoResultados(src.id, src.url, today);
      } else if (src.source === 'tropi_dual') {
        items = await fetchFromElReyTropiGana(src.id, src.primaryUrl);
        if (items.length === 0) {
          await sleep(1200);
          items = await fetchFromLottoResultados(src.id, src.fallbackUrl, today);
        }
      } else if (src.source === 'tuazar_frutas') {
        items = await fetchFromTuAzarFrutas(src.id, src.url);
      }

      console.log(`${src.id}: ${items.length} resultados`);
      for (const item of items) {
        map.set(`${item.lotteryId}|${item.drawTime}`, item);
      }
    } catch (err) {
      console.warn(`Error en ${src.id}:`, err.message);
    }
  }

  const output = {
    date: today,
    updatedAt: new Date().toISOString(),
    results: Array.from(map.values())
  };

  fs.writeFileSync('resultados.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(`Guardado resultados.json con ${output.results.length} resultados totales para ${today}.`);
}

run();
