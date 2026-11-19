import fs from 'node:fs';

function mapLotteryId(h3Text) {
  const n = String(h3Text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (n.includes('guacharito')) return 'guacharito_millonario';
  if (n.includes('guacharo')) return 'guacharo_activo';
  if (n.includes('la granjita')) return 'la_granjita';
  if (n.includes('lotto activo int') || n.includes('lotto internacional')) return 'lotto_internacional';
  if (n.includes('lotto activo rd') || n.includes('lotto rd')) return 'lotto_rd';
  if (n === 'lotto activo' || (n.includes('lotto activo') && !n.includes('2') && !n.includes('monje'))) return 'lotto_activo';
  if (n.includes('ruleta activa')) return 'ruleta_activa';
  if (n.includes('lotto rey')) return 'lotto_rey';
  if (n.includes('selva plus')) return 'selva_plus';
  if (n.includes('chance con animalitos')) return 'chance_animalitos';
  return null;
}

function getCaracasDate() {
  const now = new Date();
  const caracas = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const y = caracas.getFullYear();
  const m = String(caracas.getMonth() + 1).padStart(2, '0');
  const d = String(caracas.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTime24(rawTime) {
  const clean = String(rawTime || '').trim().toUpperCase();
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  const meridiem = match[3];
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function parseLoteriaDeHoy(html) {
  const results = [];
  const sections = html.split(/<h3[^>]*>/i);

  for (let i = 1; i < sections.length; i++) {
    const closeH3 = sections[i].search(/<\/h3>/i);
    if (closeH3 === -1) continue;

    const title = sections[i].slice(0, closeH3).replace(/<[^>]+>/g, ' ').trim();
    const lotteryId = mapLotteryId(title);
    if (!lotteryId) continue;

    const body = sections[i].slice(closeH3 + 5);
    const pairRegex = /<h4[^>]*>\s*(00|0A|0B|[0-9]{1,2})\s+([^<]+)<\/h4>[\s\S]{0,300}?<h5[^>]*>\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*<\/h5>/gi;
    let m;
    while ((m = pairRegex.exec(body)) !== null) {
      let animalNum = m[1].trim().toUpperCase();
      const animalName = m[2].trim();
      const drawTime = normalizeTime24(m[3]);

      if (animalNum !== '0' && animalNum !== '00' && animalNum !== '0A' && animalNum !== '0B' && animalNum.length === 1) {
        animalNum = animalNum.padStart(2, '0');
      }

      if (drawTime && animalNum) {
        results.push({ lotteryId, drawTime, animalNum, animalName });
      }
    }
  }
  return results;
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

  const res = await fetch('https://loteriadehoy.com', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al consultar loteriadehoy.com`);
  }

  const html = await res.text();
  const scraped = parseLoteriaDeHoy(html);
  console.log(`Resultados extraídos de loteriadehoy.com: ${scraped.length}`);

  const map = new Map();
  for (const item of previous.results) {
    map.set(`${item.lotteryId}|${item.drawTime}`, item);
  }
  for (const item of scraped) {
    map.set(`${item.lotteryId}|${item.drawTime}`, item);
  }

  const output = {
    date: today,
    updatedAt: new Date().toISOString(),
    results: Array.from(map.values())
  };

  fs.writeFileSync('resultados.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(`Guardado resultados.json con ${output.results.length} resultados para ${today}.`);
}

run();

