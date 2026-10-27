#!/usr/bin/env node
// Сборка каталога моделей соперников: research/catalog/*.json -> src/data/rivalModels.ts (TSK-007).
// Запуск из корня проекта: node scripts/build-rival-catalog.mjs
// Без зависимостей. Результат детерминирован: повторный запуск даёт тот же файл.
//
// Правила:
//  - берём модели с датой выхода 2016-06-01..2024-12-31 (срез игры 2017-2024, SQuAD вышел в 2016-м);
//  - scores: только непустые баллы из каталога (squad, glue, mmlu, humaneval, gsm8k, gpqa, swebench);
//  - arenaElo: из каталога; если пусто - оценка по MMLU (линейная подгонка по моделям, у которых есть и то и другое),
//    а без MMLU - 900; такая модель получает arenaEstimated = true;
//  - chat (чат/инструкционная модель, после RLHF/SFT/DPO): true, если это чат-продукт, чат-API или в каталоге баллы/Эло
//    относятся к чат- или инструкционной версии; false для базовых (предобученных) моделей, энкодеров и моделей, чьи
//    баллы целиком базовые - они перечислены в BASE_IDS;
//  - announcedOnly: из каталога (модель только показали: статья или демо без продаж и весов); в выходной файл
//    поле попадает только когда оно true - такая модель не выходит на рынок, а письмо говорит «показала»;
//  - имена: gameName отличается от realName и сохраняет номера версий 1:1 (см. digitsOk). Нарушения правятся в FIXES;
//  - notes: короткая русская заметка (≤ 120 знаков) из NOTES, на случай пропуска - обрезанная английская из каталога.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'research', 'catalog');
// Контекст на момент выхода (токенов): собран отдельно, с источниками - research/rival_context.json.
const CONTEXT_FILE = join(ROOT, 'research', 'rival_context.json');
let contextMap = null;
function contextOf(id) {
  contextMap ??= JSON.parse(readFileSync(CONTEXT_FILE, 'utf8'));
  const v = contextMap[id]?.context;
  if (typeof v !== 'number') throw new Error(`Нет контекста для ${id} в research/rival_context.json`);
  return v;
}
const OUT_FILE = join(ROOT, 'src', 'data', 'rivalModels.ts');

const FROM = '2016-06-01';
const TO = '2024-12-31';
const LABS = ['openbrain', 'antropik', 'gogle', 'zhipo', 'moonshoot', 'deepcent', 'alibabo'];
const BENCH_IDS = ['squad', 'glue', 'mmlu', 'humaneval', 'gsm8k', 'gpqa', 'swebench'];
const NOTE_MAX = 120;
const DEFAULT_ELO = 900;
const ELO_MIN = 500;
const ELO_MAX = 1400;

// Файлы каталога; у каждого - список кандидатов (первый существующий).
const SOURCES = [
  ['openbrain.json'],
  ['antropik-gogle.json', 'antropik-gogle.draft.json'],
  ['deepcent-alibabo.json'],
  ['zhipo-moonshoot-bench.json'],
];

// Не чат: базовые (предобученные) модели, энкодеры, анонсы без выпуска, модели с целиком базовыми баллами.
const BASE_IDS = new Set([
  'gtp-1', 'gtp-2', 'gtp-2-full', 'gtp-3', 'kodex', // OpenBrain: базовые модели серии GTP и код-модель Kodex (завершение, не диалог)
  'bort', 't5x', 'meeno', 'lamba', 'paln', // Gogle: энкодер, «текст в текст», анонсы без выпуска, базовая PaLN
  'gopler', 'chinchella', // Gogle: исследовательские базовые модели, только статьи
  'gml-10b', 'gml-130b', 'kodegeex', // Zhipo: базовые модели до ChatGML
  'deepseak-moe-16b', // DeepCent: все баллы каталога - базовой версии
]);

// Исправления игровых названий: id -> новое gameName (когда номера версий не совпали с реальными).
const FIXES = {
  // В реальном имени «GLM-4 (0520)» метка версии в скобках; в игровом она стояла без скобок и добавляла цифры.
  'gml-4-0520': 'GML-4 (0520)',
};

// Короткие заметки для игрока (≤ 120 знаков). Названия бенчмарков и моделей - игровые.
const NOTES = {
  // OpenBrain
  'gtp-1': 'Первая модель серии: 117 млн параметров, открытые веса; под каждую задачу дообучалась отдельно.',
  'gtp-2': 'Полные веса опубликованы не сразу из-за риска злоупотреблений. Эло - оценка.',
  'gtp-2-full': 'Полные веса GTP-2 опубликованы 05.11.2019 под открытой лицензией. Эло - оценка.',
  'gtp-3': 'Закрытая бета API с июня 2020, $60 за 1 млн токенов. Эло - оценка.',
  'kodex': 'Дообучена на открытом коде; закрытая бета, платной цены не было.',
  'instructgtp': 'GTP-3, дообученная на отзывах людей; стала моделью API по умолчанию.',
  'tixt-davanci-002': 'Первая модель серии GTP-3.5 по API; $60 за 1 млн токенов, с 01.09.2022 - $20.',
  'tixt-davanci-003': 'Флагман серии GTP-3.5 за два дня до ChatGTP; $20 за 1 млн токенов.',
  'chatgtp': 'Бесплатный чат, дообученный на отзывах людей; отдельного API не было. Баллы GTP-3.5, Эло - оценка.',
  'gtp-3-5-turbu': 'Чат-модель по API за $2 за 1 млн токенов: в десять раз дешевле Tixt-Davanci-003.',
  'gtp-4': 'Тесты частично пересекались с обучающими данными. Размер - по утечкам, не официальный.',
  'gtp-4-turbu': 'Контекст 128 тыс. токенов; входные токены втрое дешевле, чем у GTP-4.',
  'gtp-4o': 'Флагман с картинками и звуком: $5 за 1 млн входных токенов и $15 за выходные.',
  'gtp-4o-mino': 'Дешёвая замена GTP-3.5: $0,15 за 1 млн входных токенов. GSM8C не публиковали.',
  'q1-previow': 'Первая рассуждающая модель: думает перед ответом, скрытые токены тоже оплачиваются.',
  'q1-mino': 'Малая рассуждающая модель для науки и кода, на 80 % дешевле q1-Previow.',
  'q1': 'Полная рассуждающая модель; HumanEvol не публиковали. API-версия вышла 17 декабря.',
  // Antropik
  'clade-1': 'Закрытая бета и API для бизнеса; цена из прайса июля 2023. Эло - оценка по 2024 году.',
  'clade-instant-1': 'Дешёвая и быстрая версия Clade 1; цена из прайса июля 2023.',
  'clade-2': 'Открытая бета в браузере, контекст 100 тыс. токенов. Эло - оценка по старой таблице.',
  'clade-2-1': 'Первый контекст 200 тыс. токенов; баллы не публиковали. Эло - оценка.',
  'clade-3-opos': 'Старшая модель поколения: $15 / $75 за 1 млн токенов.',
  'clade-3-sonet': 'Средняя модель поколения; на ней работал бесплатный чат компании.',
  'clade-3-haiko': 'Самая быстрая и дешёвая модель поколения; в API с 13 марта 2024.',
  'clade-3-5-sonet': 'Вышла вечером 20 июня по времени США; сильнее Clade 3 Opos при цене Sonet.',
  'clade-3-5-sonet-new': 'Обновлённая Sonet с управлением компьютером; лучший балл SWE-banch на тот момент.',
  'clade-3-5-haiko': 'Анонс 22 октября, в API с 4 ноября; по коду обошла первую Clade 3.5 Sonet.',
  // Gogle
  'bort': 'Только анализирует текст, диалог не ведёт. Эло задано условно.',
  't5x': 'Модель «текст в текст», веса открыты. Для диалога не настраивалась. Эло задано условно.',
  'meeno': 'Исследовательский чат-бот: анонсирован и не выпущен. Эло - оценка.',
  'lamba': 'Диалоговая модель без API и весов, только закрытые испытания. Эло - оценка.',
  'gopler': 'Исследовательская модель на 280 млрд параметров: анонсирована и не выпускалась. Эло задано условно.',
  'chinchella': 'Показала, что на параметр нужно около 20 токенов данных; не выпускалась. Эло задано условно.',
  'paln': 'Анонсирована и не выпущена; позже API работал на PaLN 2. Эло - оценка.',
  'berd': 'Бесплатный чат на лёгкой LaMBA; позже перешёл на PaLN 2 и Gemeni. Эло - оценка.',
  'paln-2': 'Сервис PaLN API; HumanEvol взят у малой версии, это нижняя граница. Цена примерная.',
  'gemeni-1-0-pro': 'В чате с 6 декабря 2023, в API с 13 декабря; $0,5 / $1,5 за 1 млн токенов.',
  'gemeni-1-0-ultro': 'Только в платной подписке; цены за токены нет. Эло - оценка.',
  'gemeni-1-5-pro': 'Контекст 1 млн токенов; 15 февраля - закрытый предпросмотр. Баллы февральской версии.',
  'gemeni-1-5-flesh': 'Быстрая и дешёвая версия: $0,35 / $1,05 за 1 млн токенов.',
  'gemeni-2-0-flesh': 'Экспериментальная и бесплатная; цена взята из прайса 2025 года как оценка.',
  'gemeni-2-0-flesh-thinking': 'Первая модель лаборатории с рассуждением: бесплатный предпросмотр, платного API нет. Баллов нет, Эло - оценка.',
  'gemeni-exp-1206': 'Бесплатная экспериментальная модель; на «Арене» заняла первое место.',
  'gemmo-2-27b': 'Открытые веса, цену ставят сторонние хостинги. Баллы базовой версии, Эло - чат-версии.',
  // Zhipo
  'gml-10b': 'Базовая модель, 10 млрд параметров; дата - загрузка весов 22 июня 2021. Эло - оценка.',
  'gml-130b': 'Двуязычная модель на 130 млрд параметров, веса по заявке. Эло - оценка.',
  'kodegeex': 'Модель для кода на 13 млрд параметров, 23 языка; плагин для редактора бесплатный.',
  'chatgml-6b': 'Открытый чат на 6,2 млрд параметров; HumanEvol 0 %.',
  'chatgml2-6b': 'Контекст до 32 тыс. токенов; свободное коммерческое использование.',
  'chatgml3-6b': 'Сообщалось об утечке тестов в обучающие данные: GSM8C вырос с 32 до 72 %.',
  'gml-4': 'Флагман: API около $14 за 1 млн токенов, контекст 128 тыс. токенов.',
  'gml-4-0520': 'Майское обновление GML-4, цена прежняя - около $13,8 за 1 млн токенов.',
  'gml-4-9b': 'Открытая версия на 9,4 млрд параметров; баллы чат-версии. Эло - оценка.',
  'gml-4-aer': 'Дешёвая и быстрая версия GML-4: около $0,14 за 1 млн токенов.',
  'gml-4-plos': 'Флагман 2024 года; API в день анонса, $7 за 1 млн токенов. HumanEvol и GSM8C не публиковали.',
  'gml-zeru-preview': 'Первая рассуждающая модель лаборатории; бесплатна, числовых баллов нет. Эло - оценка.',
  // Moonshoot
  'kimo-chat': 'Первый ассистент лаборатории: контекст 200 тыс. иероглифов, закрытая бета. Эло - оценка.',
  'moonshoot-v1': 'API для разработчиков с контекстом 8k, 32k и 128k; старшая модель - $8,3 за 1 млн токенов.',
  'kimo-chat-2m': 'Контекст до 2 млн иероглифов; закрытая бета, без API и баллов. Эло - оценка.',
  'kimo-k0-maths': 'Рассуждающая модель для математики; без API и независимых проверок. Эло - оценка.',
  'kimo-k1': 'Рассуждающая модель с картинками, только в приложении. Баллов нет, Эло - оценка.',
  // DeepCent
  'deepseak-coder-33b': 'Модель для кода; HumanEvol - у инструкционной версии. Эло - оценка.',
  'deepseak-llm-67b': 'Открытые веса; MMLO - базовой версии, HumanEvol и GSM8C - чат-версии.',
  'deepseak-moe-16b': 'Смесь экспертов: 16 млрд всего, около 2,8 млрд активных. Баллы базовой версии.',
  'deepseak-v2': 'Смесь экспертов на 236 млрд; веса открыты, API по $0,14 / $0,28 за 1 млн токенов.',
  'deepseak-coder-v2': 'Версия V2 для кода, доученная на 6 трлн токенов; открытые веса и API.',
  'deepseak-v2-5': 'Слияние DeepSeak-V2 (чат) и Coder-V2 в одну модель.',
  'deepseak-r1-lito-previow': 'Первая рассуждающая модель лаборатории: только в чате на сайте, без API и весов. Эло - предположение.',
  'deepseak-v3': 'Смесь экспертов на 671 млрд, около 2,8 млн GPU-часов; баллы базовой версии.',
  // Alibabo
  'qwin-7b': 'Первая открытая модель лаборатории; баллы обновлённой версии, цены API нет. Эло - оценка.',
  'qwin-14b': 'Открытые веса; MMLO - базовой версии, остальное - чат-версии.',
  'qwin-72b': 'Открытые веса; через облако лаборатории продаётся чат-версия.',
  'qwin1-5-72b': 'Семейство 1.5 вышло 4 февраля; баллы базовой модели на 72 млрд.',
  'qwin2-72b': '7 трлн токенов, контекст 128 тыс.; MMLO базовой версии, остальное - инструкционной.',
  'qwin2-5-72b': '18 трлн токенов; MMLO базовой версии, остальное - инструкционной.',
  'qwin2-5-coder-32b': 'Модель для кода на основе Qwin2.5 32B; баллы кода - инструкционной версии.',
  'qwk-32b-previow': 'Открытая рассуждающая модель на основе Qwin2.5-32B; из тестов только GPQE.',
};

// ---------- Вспомогательные функции ----------

const warnings = [];
const errors = [];
const warn = (msg) => warnings.push(msg);
const fail = (msg) => errors.push(msg);

/** Название без пояснений в скобках: «GPT-3 175B (davinci)» -> «GPT-3 175B». */
function stripDetails(name) {
  return name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function digitsOf(name) {
  return (stripDetails(name).match(/\d/g) ?? []).join('');
}

/**
 * Правило «номера 1:1»: цифры в gameName (без пояснений в скобках) совпадают с цифрами в realName.
 * Допускается, что игровое имя опускает отдельно стоящий размер из реального («GPT-3 175B» -> «GTP-3»).
 */
function digitsOk(gameName, realName) {
  const game = digitsOf(gameName);
  if (game === digitsOf(realName)) return true;
  const withoutSize = stripDetails(realName).replace(/(^|\s)\d+(?:\.\d+)?[BMK](?=\s|$)/g, '$1');
  return game === (withoutSize.match(/\d/g) ?? []).join('');
}

/** Обрезка по границе слова с многоточием. */
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** Строка TypeScript в одинарных кавычках. */
function q(text) {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`;
}

function num(value) {
  return value === null ? 'null' : String(value);
}

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Линейная подгонка Эло по MMLU: elo = a + b·mmlu. Нужны хотя бы три точки с разными MMLU.
 * Берём только измеренное Эло: чужие оценки (arenaEstimated) - заглушки, на них подгонять нельзя.
 */
function fitEloByMmlu(models) {
  const pts = models
    .filter((m) => isNum(m.scores?.mmlu) && isNum(m.arenaElo) && !m.arenaEstimated)
    .map((m) => [m.scores.mmlu, m.arenaElo]);
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n };
}

// ---------- Чтение каталога ----------

function loadRaw() {
  const out = [];
  for (const candidates of SOURCES) {
    const name = candidates.find((f) => existsSync(join(CATALOG_DIR, f)));
    if (!name) {
      fail(`нет файла каталога: ${candidates.join(' или ')}`);
      continue;
    }
    if (name !== candidates[0]) console.log(`Файл ${candidates[0]} не найден, использую ${name}`);
    let json;
    try {
      json = JSON.parse(readFileSync(join(CATALOG_DIR, name), 'utf8'));
    } catch (e) {
      fail(`${name}: не разобрать JSON (${e.message})`);
      continue;
    }
    if (!json || !Array.isArray(json.models)) {
      fail(`${name}: нет массива models`);
      continue;
    }
    for (const m of json.models) out.push({ file: name, m, idx: out.length });
  }
  return out;
}

function checkRaw({ file, m }) {
  const where = `${file}:${m?.id ?? '?'}`;
  for (const key of ['id', 'lab', 'realName', 'gameName', 'released']) {
    if (typeof m[key] !== 'string' || m[key] === '') fail(`${where}: нет поля ${key}`);
  }
  if (!LABS.includes(m.lab)) fail(`${where}: неизвестная лаборатория ${m.lab}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.released ?? '')) fail(`${where}: дата не в формате YYYY-MM-DD`);
  if (typeof m.api !== 'boolean' || typeof m.openWeights !== 'boolean') fail(`${where}: api/openWeights не логические`);
  if (m.announcedOnly !== undefined && typeof m.announcedOnly !== 'boolean') fail(`${where}: announcedOnly не логическое`);
  if (m.announcedOnly && (m.api || m.openWeights)) fail(`${where}: announcedOnly вместе с api/openWeights`);
  if (!m.scores || typeof m.scores !== 'object') fail(`${where}: нет scores`);
  else {
    for (const [k, v] of Object.entries(m.scores)) {
      if (!BENCH_IDS.includes(k)) warn(`${where}: неизвестный бенчмарк ${k} в scores - пропущен`);
      else if (v !== null && (!isNum(v) || v < 0 || v > 100)) fail(`${where}: балл ${k} = ${v} вне 0..100`);
    }
  }
  for (const key of ['paramsB', 'priceInPer1M', 'priceOutPer1M']) {
    if (m[key] !== null && m[key] !== undefined && (!isNum(m[key]) || m[key] < 0)) fail(`${where}: ${key} = ${m[key]}`);
  }
  if (m.arenaElo !== null && m.arenaElo !== undefined && !isNum(m.arenaElo)) fail(`${where}: arenaElo = ${m.arenaElo}`);
}

// ---------- Сборка ----------

function main() {
  const raw = loadRaw();
  if (errors.length) return finish([]);
  raw.forEach(checkRaw);
  if (errors.length) return finish([]);

  // Диапазон дат.
  const kept = raw.filter(({ m }) => m.released >= FROM && m.released <= TO);
  const dropped = raw.filter(({ m }) => !(m.released >= FROM && m.released <= TO));
  for (const { m } of dropped) console.log(`Вне диапазона ${FROM}..${TO}: ${m.id} (${m.released}) - пропущена`);

  // Уникальность id.
  const seen = new Set();
  for (const { m } of kept) {
    if (seen.has(m.id)) fail(`повторяется id ${m.id}`);
    seen.add(m.id);
  }

  // Проверка справочников на опечатки.
  for (const id of BASE_IDS) if (!seen.has(id)) warn(`BASE_IDS: нет модели ${id}`);
  for (const id of Object.keys(FIXES)) if (!seen.has(id)) warn(`FIXES: нет модели ${id}`);
  for (const id of Object.keys(NOTES)) if (!seen.has(id)) warn(`NOTES: нет модели ${id}`);

  const fit = fitEloByMmlu(kept.map(({ m }) => m));
  let eloFitted = 0;
  let eloDefault = 0;

  const defs = kept.map(({ m, idx }) => {
    // Баллы: только непустые, в порядке BENCH_IDS.
    const scores = {};
    for (const b of BENCH_IDS) if (isNum(m.scores[b])) scores[b] = m.scores[b];

    // Эло: из каталога или оценка.
    let arenaElo = m.arenaElo;
    let arenaEstimated = Boolean(m.arenaEstimated);
    if (!isNum(arenaElo)) {
      arenaEstimated = true;
      if (fit && isNum(scores.mmlu)) {
        arenaElo = Math.round(Math.min(ELO_MAX, Math.max(ELO_MIN, fit.a + fit.b * scores.mmlu)));
        eloFitted++;
      } else {
        arenaElo = DEFAULT_ELO;
        eloDefault++;
      }
    }

    // Название.
    const gameName = FIXES[m.id] ?? m.gameName;
    if (FIXES[m.id]) console.log(`FIXES: ${m.id}: «${m.gameName}» -> «${gameName}»`);
    if (gameName === m.realName) warn(`${m.id}: gameName совпадает с realName («${gameName}»)`);
    if (!digitsOk(gameName, m.realName)) {
      warn(`${m.id}: номера не совпадают: «${gameName}» (${digitsOf(gameName)}) и «${m.realName}» (${digitsOf(m.realName)}) - добавьте исправление в FIXES`);
    }

    // Заметка.
    let notes = NOTES[m.id];
    if (notes === undefined) {
      warn(`${m.id}: нет заметки в NOTES, взята обрезанная английская из каталога`);
      const first = String(m.notes ?? '').split(/(?<=[.!?])\s/)[0];
      notes = clip(first, NOTE_MAX);
    }
    if (notes.length > NOTE_MAX) {
      warn(`${m.id}: заметка длиннее ${NOTE_MAX} знаков (${notes.length}) - обрезана`);
      notes = clip(notes, NOTE_MAX);
    }

    return {
      idx,
      id: m.id,
      lab: m.lab,
      gameName,
      realName: m.realName,
      released: m.released,
      api: m.api,
      openWeights: m.openWeights,
      announcedOnly: Boolean(m.announcedOnly),
      chat: !BASE_IDS.has(m.id),
      paramsB: isNum(m.paramsB) ? m.paramsB : null,
      priceIn: isNum(m.priceInPer1M) ? m.priceInPer1M : null,
      priceOut: isNum(m.priceOutPer1M) ? m.priceOutPer1M : null,
      scores,
      arenaElo,
      arenaEstimated,
      contaminated: Boolean(m.benchContaminationSuspected),
      context: contextOf(m.id),
      notes,
    };
  });

  // Игровые названия уникальны.
  const names = new Set();
  for (const d of defs) {
    if (names.has(d.gameName)) warn(`повторяется gameName «${d.gameName}»`);
    names.add(d.gameName);
  }

  // Порядок: дата выхода, затем лаборатория, затем порядок в файлах.
  defs.sort((a, b) => a.released.localeCompare(b.released) || LABS.indexOf(a.lab) - LABS.indexOf(b.lab) || a.idx - b.idx);

  if (fit && (eloFitted > 0 || eloDefault > 0)) {
    console.log(`Эло оценено по MMLU (Эло = ${fit.a.toFixed(1)} + ${fit.b.toFixed(2)}·MMLU, ${fit.n} моделей): ${eloFitted}; по умолчанию ${DEFAULT_ELO}: ${eloDefault}`);
  } else if (eloDefault > 0) {
    console.log(`Эло по умолчанию (${DEFAULT_ELO}): ${eloDefault}`);
  } else {
    console.log('Эло оценивать не пришлось: у всех моделей оно есть в каталоге.');
  }

  finish(defs);
}

function scoresLiteral(scores) {
  const parts = Object.entries(scores).map(([k, v]) => `${k}: ${num(v)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

function render(defs) {
  const lines = [];
  lines.push('// Сгенерировано scripts/build-rival-catalog.mjs из research/catalog - не править руками');
  lines.push('// Каталог реальных моделей семи лабораторий 2018-2024: названия изменены на 1-2 буквы, номера версий 1:1.');
  lines.push('// Эло - исторический снимок начала 2025 года или оценка (arenaEstimated); баллы - только опубликованные.');
  lines.push('');
  lines.push("import type { RivalModelDef } from '../sim/types';");
  lines.push('');
  lines.push('export const RIVAL_MODELS: RivalModelDef[] = [');
  for (const d of defs) {
    lines.push('  {');
    lines.push(`    id: ${q(d.id)}, lab: ${q(d.lab)}, gameName: ${q(d.gameName)}, realName: ${q(d.realName)}, released: ${q(d.released)},`);
    const announced = d.announcedOnly ? ' announcedOnly: true,' : '';
    lines.push(`    api: ${d.api}, openWeights: ${d.openWeights},${announced} chat: ${d.chat}, paramsB: ${num(d.paramsB)}, priceIn: ${num(d.priceIn)}, priceOut: ${num(d.priceOut)},`);
    lines.push(`    scores: ${scoresLiteral(d.scores)}, arenaElo: ${num(d.arenaElo)}, arenaEstimated: ${d.arenaEstimated}, contaminated: ${d.contaminated}, context: ${num(d.context)},`);
    lines.push(`    notes: ${q(d.notes)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

function finish(defs) {
  if (errors.length) {
    for (const e of errors) console.error(`ОШИБКА: ${e}`);
    console.error('Файл не записан.');
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUT_FILE, render(defs), 'utf8');

  const perLab = LABS.map((lab) => `${lab} ${defs.filter((d) => d.lab === lab).length}`).join(', ');
  const first = defs[0];
  const last = defs[defs.length - 1];
  console.log(`Записано ${defs.length} моделей в src/data/rivalModels.ts`);
  console.log(`По лабораториям: ${perLab}`);
  console.log(`Даты: ${first.released} (${first.id}) … ${last.released} (${last.id})`);
  console.log(`Чат: ${defs.filter((d) => d.chat).length}, не чат: ${defs.filter((d) => !d.chat).length}`);
  console.log(`Эло-оценок: ${defs.filter((d) => d.arenaEstimated).length}, с пометкой об утечке тестов: ${defs.filter((d) => d.contaminated).length}`);
  console.log(`На рынке (api или открытые веса): ${defs.filter((d) => (d.api || d.openWeights) && !d.announcedOnly).length}`);
  console.log(`Только показаны (announcedOnly): ${defs.filter((d) => d.announcedOnly).length}`);
  if (warnings.length) {
    console.log(`Предупреждений: ${warnings.length}`);
    for (const w of warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ: ${w}`);
  } else {
    console.log('Предупреждений нет.');
  }
}

main();
