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

  // 3 loterías nuevas en LottoResultados
  { id: 'tropi_gana', source: 'lottoresultados', url: 'https://www.lottoresultados.com/resultados/animalitos/tropi-gana' },
  { id: 'condor_gana', source: 'lottoresultados', url: 'https://www.lottoresultados.com/resultados/animalitos/condor-gana' },
  { id: 'el_granjazo', source: 'lottoresultados', url: 'https://www.lottoresultados.com/resultados/animalitos/el-granjazo-granja-millonaria' },

  // 1 lotería nueva de frutas en TuAzar
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

async function fetchJinaRaw(targetUrl) {
  const jinaUrl = `https://r.jina.ai/${targetUrl}?nocache=${Date.now()}`;
  const res = await fetch(jinaUrl, {
    headers: {
      'Accept': 'text/plain',
      'X-No-Cache': 'true'
    }
  });
  if (!res.ok) return '';
  return await res.text();
}

// Parser 1: LoteriaDeHoy (formato: "16 Oso" seguido en 1..3 líneas de "02:00 PM")
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

// Parser 2: LottoResultados (usa tanto el alt de imagen "Resultado 17 Pavo ... a las 09:00" como el texto "9:00 am" + "17 Pavo")
async function fetchFromLottoResultados(lotteryId, targetUrl, dateStr) {
  const text = await fetchJinaRaw(targetUrl);
  if (!text) return [];

  const foundMap = new Map();

  // Método A (alt text exacto con fecha de hoy): "Resultado 61 Turpial de ... el 2026-11-26 a las 09:30"
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

  // Método B (respaldo por líneas en bloque "Resultados de Hoy")
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

// Parser 3: TuAzar Frutas (detecta ruta de imagen "/fruita_gana/5.png" + nombre + hora, y respaldo por líneas)
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

      // Detectar número desde URL de imagen si existe: /fruita_gana/5.png
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
        items = await fetchFromLottoResultados(src.id, src.url, today);
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
