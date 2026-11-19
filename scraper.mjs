import fs from 'node:fs';
import { chromium } from 'playwright-core';

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
  const [, rawH, min, meridiem] = match;
  let hour = parseInt(rawH, 10);
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-VE'
  });
  const page = await context.newPage();

  await page.goto('https://loteriadehoy.com', {
    waitUntil: 'networkidle',
    timeout: 45000
  });
  await page.waitForSelector('h3', { timeout: 20000 });

  // Recorre todos los encabezados h3, h4, h5 en orden lineal de la página
  const rawItems = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('h3, h4, h5'));
    const extracted = [];
    let currentTitle = '';
    let pendingH4 = '';

    for (const node of nodes) {
      const tag = node.tagName;
      const text = node.textContent.replace(/\s+/g, ' ').trim();

      if (tag === 'H3') {
        currentTitle = text;
        pendingH4 = '';
      } else if (tag === 'H4' && currentTitle) {
        pendingH4 = text;
      } else if (tag === 'H5' && currentTitle && pendingH4) {
        extracted.push({ title: currentTitle, h4: pendingH4, h5: text });
        pendingH4 = '';
      }
    }
    return extracted;
  });

  await browser.close();

  const scraped = [];
  for (const item of rawItems) {
    const lotteryId = mapLotteryId(item.title);
    if (!lotteryId) continue;

    const match = item.h4.match(/^(00|0A|0B|[0-9]{1,2})\s+(.+)$/i);
    const drawTime = normalizeTime24(item.h5);
    if (!match || !drawTime) continue;

    const [, rawNum, rawName] = match;
    let animalNum = rawNum.toUpperCase();
    if (animalNum !== '0' && animalNum !== '00' && animalNum !== '0A' && animalNum !== '0B' && animalNum.length === 1) {
      animalNum = animalNum.padStart(2, '0');
    }

    scraped.push({
      lotteryId,
      drawTime,
      animalNum,
      animalName: rawName.trim()
    });
  }

  console.log(`Resultados extraídos con Chrome real: ${scraped.length}`);

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
