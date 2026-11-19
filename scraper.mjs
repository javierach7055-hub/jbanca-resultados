import fs from 'node:fs';

// Fecha actual en hora de Venezuela (America/Caracas, UTC-4)
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
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  const meridiem = match[3];
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function mapLotteryId(rawName) {
  const n = String(rawName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('guacharito')) return 'guacharito_millonario';
  if (n.includes('guacharo')) return 'guacharo_activo';
  if (n.includes('granjita')) return 'la_granjita';
  if (n.includes('internacional')) return 'lotto_internacional';
  if (n.includes('rd')) return 'lotto_rd';
  if (n.includes('lotto activo')) return 'lotto_activo';
  if (n.includes('ruleta')) return 'ruleta_activa';
  if (n.includes('lotto rey')) return 'lotto_rey';
  if (n.includes('selva')) return 'selva_plus';
  if (n.includes('chance')) return 'chance_animalitos';
  return null;
}

async function fetchFromLotoven() {
  const res = await fetch('https://lotoven.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JBancaProBot/1.0' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  // Extrae bloques por lotería y tarjetas de sorteo de Lotoven
  const sectionRegex = /<h[23][^>]*>([^<]+)<\/h[23]>([\s\S]*?)(?=<h[23]|<\/section|$)/gi;
  let secMatch;

  while ((secMatch = sectionRegex.exec(html)) !== null) {
    const lotteryId = mapLotteryId(secMatch[1]);
    if (!lotteryId) continue;

    const block = secMatch[2];
    const cardRegex = /(\d{1,2}:\d{2}\s*(?:AM|PM))[\s\S]{0,400}?\b(00|0A|0B|[0-9]{1,2})\b/gi;
    let cardMatch;
    while ((cardMatch = cardRegex.exec(block)) !== null) {
      const drawTime = normalizeTime24(cardMatch[1]);
      let animalNum = cardMatch[2].toUpperCase();
      if (animalNum !== '0' && animalNum !== '00' && animalNum.length === 1) {
        animalNum = animalNum.padStart(2, '0');
      }
      if (drawTime && animalNum) {
        results.push({ lotteryId, drawTime, animalNum });
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

  let scraped = [];
  try {
    scraped = await fetchFromLotoven();
    console.log(`Resultados extraídos: ${scraped.length}`);
  } catch (err) {
    console.error('Error consultando fuente externa:', err.message);
  }

  // Combinar sin duplicados (manteniendo los ya capturados hoy)
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
