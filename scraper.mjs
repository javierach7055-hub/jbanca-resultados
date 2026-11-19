import fs from 'node:fs';

const LOTTERY_RULES = {
  lotto_activo: { names: ['lotto activo'], minutes: ['00'], max: 36 },
  la_granjita: { names: ['la granjita'], minutes: ['00'], max: 36 },
  guacharo_activo: { names: ['guacharo activo'], minutes: ['00'], max: 75 },
  guacharito_millonario: { names: ['el guacharito millonario', 'guacharito millonario'], minutes: ['30'], max: 99 },
  selva_plus: { names: ['selva plus'], minutes: ['15', '45'], max: 36, comodines: true },
  lotto_internacional: { names: ['lotto activo int', 'lotto activo rd int', 'lotto internacional'], minutes: ['30'], max: 36 },
  lotto_rd: { names: ['lotto activo rd', 'lotto activo rdominicana', 'lotto rd'], minutes: ['00'], max: 36 },
  chance_animalitos: { names: ['chance con animalitos'], minutes: ['00'], max: 36 },
  ruleta_activa: { names: ['ruleta activa'], minutes: ['00'], max: 36 },
  lotto_rey: { names: ['lotto rey'], minutes: ['00'], max: 36 }
};

function getCaracasDate() {
  const now = new Date();
  const caracas = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const y = caracas.getFullYear();
  const m = String(caracas.getMonth() + 1).padStart(2, '0');
  const d = String(caracas.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mapLotteryFromHeading(rawHeading) {
  const clean = String(rawHeading || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.startsWith('resultados') || clean.startsWith('quieres hacer')) return null;

  for (const [id, rule] of Object.entries(LOTTERY_RULES)) {
    if (rule.names.some((n) => clean === n || clean.startsWith(n + ' '))) return id;
  }
  return null;
}

function normalizeTime24(rawTime) {
  const clean = String(rawTime || '').trim().toUpperCase();
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;
  const [, rawH, min, meridiem] = match;
  let hour = parseInt(rawH, 10);
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function isValidForLottery(lotteryId, drawTime, animalNum) {
  const rule = LOTTERY_RULES[lotteryId];
  if (!rule) return false;
  const min = drawTime.split(':').at(1);
  if (!rule.minutes.includes(min)) return false;
  if (animalNum === '0' || animalNum === '00') return true;
  if (rule.comodines && (animalNum === '0A' || animalNum === '0B')) return true;
  const n = parseInt(animalNum, 10);
  return !Number.isNaN(n) && n >= 1 && n <= rule.max;
}

async function scrapePage(url) {
  const res = await fetch(url, { headers: { 'Accept': 'text/plain' } });
  if (!res.ok) return [];
  const text = await res.text();

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const found = [];
  let currentLotteryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i);

    if (line.startsWith('### ')) {
      const heading = line.slice(4).trim();
      currentLotteryId = mapLotteryFromHeading(heading);
      continue;
    }

    if (!currentLotteryId) continue;

    const cleanH4 = line.replace(/^####\s*/, '').trim();
    const nextH5 = (lines.at(i + 1) || '').replace(/^#####\s*/, '').trim();

    const animalMatch = cleanH4.match(/^(00|0A|0B|[0-9]{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+)$/);
    const drawTime = normalizeTime24(nextH5);

    if (animalMatch && drawTime) {
      const [, rawNum, rawName] = animalMatch;
      let animalNum = rawNum.toUpperCase();
      if (animalNum !== '0' && animalNum !== '00' && animalNum !== '0A' && animalNum !== '0B' && animalNum.length === 1) {
        animalNum = animalNum.padStart(2, '0');
      }

      if (isValidForLottery(currentLotteryId, drawTime, animalNum)) {
        found.push({
          lotteryId: currentLotteryId,
          drawTime,
          animalNum,
          animalName: rawName.trim()
        });
      }
      i++;
    }
  }
  return found;
}

async function run() {
  // Prueba con 2026-11-18 (luego cambiamos '2026-11-18' por getCaracasDate())
  const today = '2026-11-18';
  let previous = { date: today, updatedAt: new Date().toISOString(), results: [] };

  if (fs.existsSync('resultados.json')) {
    try {
      const parsed = JSON.parse(fs.readFileSync('resultados.json', 'utf8'));
      if (parsed.date === today && Array.isArray(parsed.results)) {
        previous = parsed;
      }
    } catch {}
  }

  const urls = [
    ['https:/', 'r.jina.ai', 'https:/', 'loteriadehoy.com', 'animalitos', 'resultados', today, ''].join('/'),
    ['https:/', 'r.jina.ai', 'https:/', 'loteriadehoy.com', 'animalitos', 'resultados-internacional', today, ''].join('/')
  ];

  const map = new Map();
  for (const item of previous.results) {
    map.set(`${item.lotteryId}|${item.drawTime}`, item);
  }

  for (const url of urls) {
    const items = await scrapePage(url);
    console.log(`URL ${url}: ${items.length} resultados`);
    for (const item of items) {
      map.set(`${item.lotteryId}|${item.drawTime}`, item);
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
