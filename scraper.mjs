import fs from 'node:fs';
import { chromium } from 'playwright-core';

function mapLotteryId(line) {
  const n = String(line || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (n.startsWith('resultados ')) return null;
  if (n === 'el guacharito millonario' || n === 'guacharito millonario') return 'guacharito_millonario';
  if (n === 'guacharo activo') return 'guacharo_activo';
  if (n === 'la granjita') return 'la_granjita';
  if (n.startsWith('lotto activo int') || n === 'lotto internacional') return 'lotto_internacional';
  if (n === 'lotto activo rd' || n === 'lotto rd') return 'lotto_rd';
  if (n === 'lotto activo') return 'lotto_activo';
  if (n === 'ruleta activa') return 'ruleta_activa';
  if (n === 'lotto rey') return 'lotto_rey';
  if (n === 'selva plus') return 'selva_plus';
  if (n === 'chance con animalitos') return 'chance_animalitos';
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
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
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

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'es-VE',
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  await page.goto('https://loteriadehoy.com', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  // Esperar 6 segundos para superar cualquier pantalla de espera de Cloudflare
  await page.waitForTimeout(6000);

  const bodyText = await page.evaluate(() => document.body.innerText || '');
  await browser.close();

  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== '-');

  console.log(`Total líneas leídas: ${lines.length}. Muestra:`, lines.slice(0, 15).join(' | '));

  const scraped = [];
  let currentLotteryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i);

    // Detectar si entramos en el pie de página
    if (line.startsWith('Quieres hacer publicidad')) break;

    const detectedLottery = mapLotteryId(line);
    if (detectedLottery) {
      currentLotteryId = detectedLottery;
      continue;
    }

    if (!currentLotteryId) continue;

    // Verificar si la línea actual es "NUMERO ANIMAL" (ej: "11 Gato" o "00 Ballena")
    // y la siguiente línea es una hora "HH:MM AM/PM"
    const animalMatch = line.match(/^(00|0A|0B|[0-9]{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+)$/);
    const nextLine = lines.at(i + 1) || '';
    const drawTime = normalizeTime24(nextLine);

    if (animalMatch && drawTime) {
      const [, rawNum, rawName] = animalMatch;
      let animalNum = rawNum.toUpperCase();
      if (animalNum !== '0' && animalNum !== '00' && animalNum !== '0A' && animalNum !== '0B' && animalNum.length === 1) {
        animalNum = animalNum.padStart(2, '0');
      }

      scraped.push({
        lotteryId: currentLotteryId,
        drawTime,
        animalNum,
        animalName: rawName.trim()
      });
      i++; // Saltar la línea de la hora ya procesada
    }
  }

  console.log(`Resultados extraídos: ${scraped.length}`);

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
