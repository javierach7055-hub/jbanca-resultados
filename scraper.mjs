import fs from 'node:fs';

const LOTTERY_SOURCES = [
  { id: 'lotto_activo', slug: 'lottoactivo' },
  { id: 'la_granjita', slug: 'lagranjita' },
  { id: 'guacharo_activo', slug: 'guacharoactivo' },
  { id: 'guacharito_millonario', slug: 'elguacharitomillonario' },
  { id: 'selva_plus', slug: 'selvaplus' },
  { id: 'lotto_internacional', slug: 'lottoactivordint' },
  { id: 'lotto_rd', slug: 'lottoactivordominicana' },
  { id: 'chance_animalitos', slug: 'chanceconanimalitos' },
  { id: 'ruleta_activa', slug: 'ruletaactiva' },
  { id: 'lotto_rey', slug: 'lottorey' }
];

function getCaracasDate() {
  const now = new Date();
  const caracas = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const y = caracas.getFullYear();
  const m = String(caracas.getMonth() + 1).padStart(2, '0');
  const d = String(caracas.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

async function fetchLotteryByDate(lotteryId, slug, dateStr) {
  const baseUrl = ['https:/', 'r.jina.ai', 'https:/', 'loteriadehoy.com', 'animalito', slug, 'resultados', dateStr, ''].join('/');
  const url = `${baseUrl}?nocache=${Date.now()}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'text/plain',
      'X-No-Cache': 'true'
    }
  });
  if (!res.ok) return [];

  const text = await res.text();
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '-');

  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i);
    if (line.startsWith('Quieres hacer publicidad')) break;

    const animalMatch = line.match(/^(00|0A|0B|[0-9]{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]+)$/);
    if (!animalMatch) continue;

    let drawTime = null;
    for (let offset = 1; offset <= 3; offset++) {
      const candidate = lines.at(i + offset) || '';
      const parsedTime = extractTime24(candidate);
      if (parsedTime) {
        drawTime = parsedTime;
        break;
      }
    }

    if (drawTime) {
      const [, rawNum, rawName] = animalMatch;
      let animalNum = rawNum.toUpperCase();
      if (animalNum !== '0' && animalNum !== '00' && animalNum !== '0A' && animalNum !== '0B' && animalNum.length === 1) {
        animalNum = animalNum.padStart(2, '0');
      }
      found.push({
        lotteryId,
        drawTime,
        animalNum,
        animalName: rawName.trim()
      });
    }
  }
  return found;
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
      const items = await fetchLotteryByDate(src.id, src.slug, today);
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
