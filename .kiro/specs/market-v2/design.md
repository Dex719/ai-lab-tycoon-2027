# Design: market-v2 (Рынок v2: подписки, сегменты, уровни моделей)

## Document Information

- **Feature Name**: market-v2
- **Version**: 0.1
- **Date**: 12.10.2026
- **Author**: Dex719
- **Status**: Draft v0.1 (сверено с кодом `src/sim` на 12.10.2026)
- **Related**: `requirements.md`, `tasks.md`, `.kiro/specs/vertical-slice/design.md` (базовые формулы; здесь только изменения и дополнения)

## 0. Ключевые решения (кратко)

1. Два канала продаж: **API** ($ за 1 млн токенов, как сейчас) и **Подписка** ($ за пользователя в месяц, опорная цена $20). Канал подписок открыт с чат-момента 30.11.2022 (`CHAT_MOMENT_DATE`); до него для игрока закрыт, у соперников пуст.
2. Пять долей мощности: `training | contracts | experiments | api | subs`. Ключ `inference` переименован в `api`, добавлен `subs`. Ключ `experiments` (подпись «Исследования») не переименовывается: это проще и не трогает `research.ts` и его тесты.
3. Три сегмента спроса: `consumers` (обычные, канал подписка), `enterprise` (корпоративные, канал API), `developers` (разработчики, канал API). Корпоративные покупают только по API (подписка сотрудников считается токенами API): проще, чем два канала у одного сегмента.
4. Спрос API `T(t)` остаётся прежней кривой и делится между корпоративными и разработчиками долей `DEV_SHARE_OF_API(t)`; спрос подписок - новая кривая `SUBS_USERS(t)` в пользователях. Доли по сегментам - softmax с прежней структурой полезности и своими весами.
5. Мощность: по каналам, `served_api = min(1, pool(api)/need_api)`, `served_subs = min(1, pool(subs)/need_subs)`; `servedShares` переиспользуется по сегментам. Общие `shares`/`labShares` - взвешенная по потенциальной выручке сумма сегментов, сумма по-прежнему 1, поэтому `rivalry.ts`, `investors.ts`, `finance.closeMonth` работают без правок логики.
6. Уровни моделей `tier: 'light' | 'mid' | 'flagship'` в плане обучения; уровень обязан совпадать с правилом `tierOf(paramsB, day)` относительно переднего края `FRONTIER_PARAMS_B(t)`. Соперникам уровень выводится из каталога (параметры, иначе цена, иначе Эло).
7. Внешняя проверка: модель с Эло не ниже лучшего соперника минус 10 или с уровнем по коду выше лучшего соперника на 5 очков перед подпиской проходит проверку 30-45 дней за `$300 тыс. + $2 тыс. × млрд параметров`. API при этом доступен (корпоративные и разработчики - единственные покупатели API).
8. Параллельное обучение: `training: TrainingRun | null` заменяется на `trainings: TrainingRun[]` (не больше 2), доля «Обучение» делится поровну. Вариант «второе поле `training2`» отвергнут: два поля усложняют каждый цикл.
9. Победа, `monthsFirst`, `marketArenaRank` и оценка техчасти у инвесторов по-прежнему считаются среди моделей **по API** (планка победы не меняется, опоры баланса остаются). Оценка инвесторов по выручке включает подписки автоматически через `revenueDaily`.
10. Версия сохранения остаётся 1; старые поля дополняются значениями по умолчанию в `save.ts`.

## 1. Каналы и доли мощности

### 1.1 Allocation

```ts
export interface Allocation {
  training: number;
  contracts: number;
  experiments: number; // исследования (ключ не меняется)
  api: number;         // было inference: обслуживание запросов по API
  subs: number;        // обслуживание чата подписчиков
}
export const DEFAULT_ALLOC: Allocation = { training: 0.4, contracts: 0.2, experiments: 0.4, api: 0, subs: 0 };
```

- `compute.ALLOC_KEYS = ['training', 'contracts', 'experiments', 'api', 'subs']`; `normalizeAlloc`, `setAllocation`, `pool(s, kind)` без изменений логики.
- Везде `pool(s, 'inference')` → `pool(s, 'api')`. Полный список мест: `types.ts`, `constants.ts`, `compute.ts`, `market.ts`, `bots.ts`, `save.ts`, `ui/alloc.ts`, `ui/windows/ComputeWindow.tsx`, `ui/windows/ModelsWindow.tsx`, тесты `compute.test.ts`, `bots.test.ts`, `contracts.test.ts`, `training.test.ts`, `market.test.ts`, `research.test.ts`, `save.test.ts` (в литералах `{ training, contracts, experiments, inference }` ключ `inference` → `api`, добавить `subs: 0`).

### 1.2 Миграция старых сохранений

`alloc.inference` → `alloc.api`, `alloc.subs = 0`, ключ `inference` удаляется. Если `api` уже есть - ничего не делать.

## 2. Сегменты спроса

### 2.1 Определения

```ts
export type SegmentId = 'consumers' | 'enterprise' | 'developers';
export const SEGMENT_IDS: readonly SegmentId[] = ['consumers', 'enterprise', 'developers'];
export type Channel = 'api' | 'subs';
export interface SegmentDef {
  name: string;        // «Обычные», «Корпоративные», «Разработчики»
  channel: Channel;
  wQ: number;          // вес воспринимаемого качества
  hypeMult: number;    // множитель шумихи внутри Q
  wBrand: number;      // вес бренда
  wPrice: number;      // эластичность по цене
  wCtx: number;        // вес контекста
  wCode: number;       // вес уровня по коду
  exposedPenalty: number; // штраф разоблачённой модели игрока
  u0Offset: number;    // прибавка к внешнему варианту
  tier: Record<Tier, number>; // прибавка за уровень модели
  values: string;      // «что ценит» для интерфейса
}
```

| Сегмент | Канал | wQ | hypeMult | wBrand | wPrice | wCtx | wCode | exposed | u0Offset | light / mid / flagship |
|---|---|---|---|---|---|---|---|---|---|---|
| consumers | subs | 1,0 | 1,5 | 1,2 | 0,8 | 0,25 | 0 | 0,2 | +0,5 | −0,3 / 0 / +0,1 |
| enterprise | api | 1,2 | 0,7 | 0,8 | 0,6 | 0,35 | 0,3 | 0,8 | 0 | −0,4 / 0 / +0,2 |
| developers | api | 0,8 | 1,0 | 0,5 | 1,6 | 0,25 | 0,6 | 0,3 | −0,3 | +0,2 / 0 / −0,2 |

Средневзвешенные веса API-сегментов (0,45 корпоративные / 0,55 разработчики в 2024 году) ≈ прежним 1,0 и 1,2: баланс API 2017-2022 почти не меняется.

`values`: consumers - «известность, цена подписки, длинный контекст»; enterprise - «Эло, контекст, отсутствие подгонки, флагманы»; developers - «цена за токен, баллы по коду, лёгкие модели».

### 2.2 Кривые спроса (2017-2024)

- `T(t)` токенов API в день - прежняя `DEMAND_TOKENS` × `modValue('demand').mult`.
- `DEV_SHARE_OF_API` (линейно): 01.01.2017 - 0,8; 11.06.2020 - 0,7; 30.11.2022 - 0,6; 31.12.2024 - 0,45. `T_dev = f × T`, `T_ent = (1 − f) × T`.
- `SUBS_USERS(t)` платёжеспособных пользователей чата (лог-линейно): 01.01.2017 - 1e3; 11.06.2020 - 2e4; 29.11.2022 - 1e5; 30.11.2022 - 5e5; 10.02.2023 - 1,5e6; 01.06.2023 - 3e6; 01.01.2024 - 7e6; 31.12.2024 - 1,5e7; × `modValue('subsDemand').mult`.
- `subsOpen(day) = day ≥ dateToDay(CHAT_MOMENT_DATE)`; до этого дня список моделей сегмента consumers пуст (весь спрос внешнему варианту), `setOnSubs(true)` отклоняется.
- Опоры (реальный мир, масштаб игры ≈ 1:1): потенциал API на 31.12.2024 - 3e12 × $2,5 / 1e6 = $7,5 млн в день ($2,7 млрд в год; OpenAI API ≈ $1 млрд, Anthropic 2024 ≈ $1 млрд); потенциал подписок - 1,5e7 × $20 / 30 = $10 млн в день ($3,6 млрд в год; ChatGPT Plus $20, OpenAI 2024 ≈ $3,7 млрд всего, из них подписки ≈ $2,7 млрд). Отношение подписки/API на конец 2024 года - в пределах 1…1,6.

### 2.3 Полезность и доли

Для модели i в сегменте seg:

```
Q_seg,i = Elo_i + hypeMult_seg × k_h(t) × hype[owner_i]            (k_h - прежний hypeK)
brand_seg,owner = labBrand(s, owner) + modValue('segBrand', `${owner}:${seg}`).add
priceTerm = channel api:  ln(clamp(price_i / P_ref(t), 1/20, 20))
            channel subs: ln(clamp(subsPrice_i / SUBS_REF_PRICE, 1/4, 4))
ctxTerm   = ln(clamp(context_i / C_ref(t), 1/64, 8))               (contextLogRatio)
codeTerm  = codeLevel_i === null ? 0 : clamp(codeLevel_i − CAP_LEVEL[год], −20, 20) / CODE_UTILITY_SCALE
U_i = wQ × (Q_seg,i − 1000)/100 + wBrand × brand − wPrice × priceTerm + wCtx × ctxTerm + wCode × codeTerm
      + tier_seg[tier_i] − (exposed_i ? exposedPenalty_seg : 0)
U0_seg = (Q_ref(t) − 1000)/100 + u0Offset_seg
share_seg,i = e^{U_i} / (e^{U0_seg} + Σ_j e^{U_j});  noneShare_seg = e^{U0_seg} / (…)
demand_seg,i = share_seg,i × D_seg(t)      (токены в день или пользователи)
tokens_seg,i = demand × (channel subs ? TOKENS_PER_USER_DAY : 1)
```

- `codeLevel(s, ref)`: среднее `capFromScore(b, показанный балл)` по вышедшим бенчмаркам области `code` (HumanEvol с 07.07.2021, SWE-banch с 10.10.2023); игрок - `modelScore(m, b, false)` (подгонка входит, разоблачённая модель - честный балл), соперник - `rivalScore(def, b).value`. Нет вышедших бенчмарков кода - `null`. `CAP_LEVEL` - существующая таблица уровня года из `contracts`. `CODE_UTILITY_SCALE = 10`: +10 очков над уровнем года дают разработчикам +0,6 полезности.
- Нечисловая полезность → −1e9 (как сейчас). Softmax устойчивый (вычитание максимума).
- Модели в сегменте: канал api - выпущенные модели игрока с `onApi` и `marketRivals(s, 'api')` (прежний фильтр); канал subs - модели игрока с `onSubs` и `marketRivals(s, 'subs')` (раздел 5.1), только при `subsOpen`.

### 2.4 Мощность и обслуживание

- `servingTokensPerH100eDay(paramsB) = INF_FLOP_PER_H100E_DAY / (2 × paramsB × 1e9)` (175 млрд - 36,6 млн токенов в день на H100e; 1,8 трлн - 3,6 млн). Лёгкая модель обслуживает больше пользователей на карту сама собой.
- `need_api = Σ_{seg api} Σ_{игрок i} tokens_seg,i / serving(N_i)`; `need_subs = Σ_{игрок i} users_i × TOKENS_PER_USER_DAY / serving(N_i)`.
- `served_api = need_api > 0 ? min(1, pool(s,'api') / need_api) : 1`; `served_subs` аналогично с `pool(s,'subs')`. Внутри канала все модели игрока обслуживаются одной долей (как сейчас).
- По сегменту: `servedShares(segSnapshot, served_канала)` - прежняя функция без изменений: потерянный спрос игрока уходит соперникам и внешнему варианту.

### 2.5 Выручка

- API: `Σ_{seg api} Σ_i tokens_seg,i × served_api × price_i / 1e6` → `earn('api')`; `model.earned +=`.
- Подписки: `Σ_i users_i × served_subs × subsPrice_i / 30` → `earn('subs')`; `model.earned +=`, `model.earnedSubs +=`.
- Потеря спроса: `lostApi = 1 − served_api` (0, если `need_api = 0`), `lostSubs` аналогично; `lostFraction = (R_api × lostApi + R_subs × lostSubs) / (R_api + R_subs)`, где `R_api = Σ tokens × price / 1e6`, `R_subs = Σ users × subsPrice / 30` - потенциальная выручка игрока в день (при нуле - 0). Шумиха игрока падает на `HYPE_LOST_DEMAND_K × lostFraction`, как сейчас.

### 2.6 Общие доли (совместимость)

- Вес сегмента: `R_seg` - потенциальная выручка сегмента в день: API-сегменты `D_seg × P_ref(t) / 1e6`, consumers `D × SUBS_REF_PRICE / 30`; `w_seg = R_seg / Σ R` (при Σ R = 0 - поровну).
- `s.market.shares[key] = Σ_seg w_seg × shares_seg[key]` (модели нет в сегменте - 0), `labShares` и `none` так же. Сумма 1. До чат-момента вес consumers ничтожен, общие доли ≈ доли API: `threatOf`, `computeLever`, `botPriceReflex`, `MonthRecord.marketShare` работают без изменений.

### 2.7 Состояние рынка

```ts
market: {
  shares: Record<string, number>;                 // общие, взвешенные по выручке
  labShares: Record<HypeOwner | 'none', number>;  // общие
  playerTokens: number;                           // токены API, обслуженные вчера
  lostFraction: number;                           // взвешенная потеря (2.5)
  totalTokens: number;                            // T(t) с модификаторами
  playerSubs: number;                             // подписчиков обслужено (новое, 0)
  totalSubs: number;                              // SUBS_USERS(t) с модификаторами (новое, 0)
  lostApi: number; lostSubs: number;              // новое, 0
  segments: Record<SegmentId, SegmentShares>;     // новое
}
interface SegmentShares { shares: Record<string, number>; labShares: Record<HypeOwner | 'none', number>; total: number } // после ограничения мощностью; total - D_seg
```

## 3. Уровни моделей

```ts
export type Tier = 'light' | 'mid' | 'flagship';
export const TIER_IDS: readonly Tier[] = ['light', 'mid', 'flagship'];
export const TIER_NAMES: Record<Tier, string> = { light: 'Лёгкая', mid: 'Средняя', flagship: 'Флагман' };
```

- Передний край по параметрам `FRONTIER_PARAMS_B` (лог-линейно, млрд): 01.01.2017 - 1; 14.02.2019 - 1,5; 11.06.2020 - 175; 04.04.2022 - 540; 14.03.2023 - 1 800; 31.12.2024 - 2 000. `frontierParams(day) = lerpByDate(FRONTIER_PARAMS_B, day, true)`.
- `TIER_PARAMS_RATIO = { light: [0, 0.08], mid: [0.08, 0.35], flagship: [0.35, 1.5] }` - доли `F(t)`. `tierOf(paramsB, day)`: `r = paramsB / F`; `r ≥ 0,35` → flagship; `r ≥ 0,08` → mid; иначе light.
- `tierRange(day, tier) = [max(PARAMS_B_MIN, lo × F), min(PARAMS_B_MAX, hi × F)]`; у light `lo = PARAMS_B_MIN`. Пустой диапазон (`lo ≥ hi`) - уровень недоступен (в 2017 году лёгкие модели - 0,05…0,08 млрд).
- Пресет `tierPreset(s, tier)`: `paramsB = clamp(TIER_PRESET_RATIO[tier] × F, range)`, `TIER_PRESET_RATIO = { light: 0.04, mid: 0.17, flagship: 0.7 }`; `tokensB = clamp(20 × paramsB, TOKENS_B_MIN, MAX_TOKENS_B(год))`.
- Цены по умолчанию: `TIER_API_PRICE_MULT = { light: 0.25, mid: 1, flagship: 3 }` × `P_ref(day)` при выпуске; `TIER_SUBS_PRICE = { light: 10, mid: 20, flagship: 20 }` $ в месяц.
- Стоимость обслуживания - через `paramsB` (раздел 2.4), отдельного множителя нет.
- Отношение сегментов - таблица `tier` в 2.1.
- `TrainingPlan.tier` обязателен; `validatePlan`: `plan.tier !== tierOf(plan.paramsB, s.day)` → «Размер модели не соответствует уровню «{name}»: в этом году от {lo} до {hi} млрд параметров.» Уровень фиксируется на старте проекта и дальше не пересчитывается.
- Старые сохранения: `plan.tier = tierOf(plan.paramsB, model.trainedDay | run.startedDay)`.

### 3.1 Уровень модели соперника

`rivalTier(def): Tier` (чистая функция каталога, кеш по id):
1. `def.tier` задан - он (шаблоны ответных моделей: cheap → light, open → mid, context → уровень базовой модели; `RivalModelDef.tier?: Tier` - новое необязательное поле, `templateDef` заполняет).
2. `paramsB` известен - `tierOf(paramsB, rivalDay(def))`.
3. Иначе `catalogPrice(def)` известна - `ratio = catalogPrice / P_ref(rivalDay)`: `≥ 2,5` flagship, `≥ 0,4` mid, иначе light (`RIVAL_TIER_PRICE_RATIO`).
4. Иначе (чат без API и цен) - `arenaElo ≥ catalogEloFrontier(rivalDay) − RIVAL_TIER_ELO_GAP (30)` → flagship, иначе mid; `catalogEloFrontier(day)` - наибольший `arenaElo` каталога среди моделей с `rivalDay ≤ day`.

Опоры: GTP-3 Davanci - flagship; Clade 3 Haiko - light; Clade 3 Sonet - mid; GTP-4 Turbu - flagship; ChatGTP - flagship; Berd - mid; PaLN 2 - mid; GTP-4o Mino - light.

## 4. Переключатели каналов, цены, проверка

### 4.1 Поля модели

```ts
onApi: boolean;            // как сейчас (имя сохраняется)
price: number;             // $ за 1 млн токенов, как сейчас
onSubs: boolean;           // новое, false
subsPrice: number;         // новое, $ в месяц, TIER_SUBS_PRICE[tier]
review: 'none' | 'required' | 'pending' | 'passed'; // новое, 'none'
reviewEndDay: number | null;                        // новое, null
earnedSubs: number;        // новое, 0; earned - по обоим каналам
```

- Границы `subsPrice`: `SUBS_PRICE_MIN = 1`, `SUBS_PRICE_MAX = 200`, округление до центов.
- «В продаже» = `onApi || onSubs`; «ограничить от подписки» - просто `onSubs = false`.

### 4.2 Внешняя проверка

- `rivalFrontierElo(s) = max_{lab} bestElo(s, lab)` (leaderboard.ts); `rivalCodeFrontier(s) = max codeLevel` по `marketRivals(s,'api') ∪ marketRivals(s,'subs')`, `null`, если нечего считать.
- `reviewRequired(s, m)`: `rivalFrontierElo(s) > 0 && m.arenaElo ≥ rivalFrontierElo(s) − REVIEW_ELO_GAP (10)` или `(codeLevel(s, m) !== null && rivalCodeFrontier(s) !== null && codeLevel ≥ rivalCodeFrontier + REVIEW_CODE_GAP (5))`. Считается один раз в `releaseModel` (край только растёт, поэтому позже проверка не появится).
- `reviewDays(s, m) = REVIEW_DAYS_MIN (30) + round(REVIEW_DAYS_EXTRA (15) × min(1, paramsB / F(day)))`: 30…45 дней, без случайности (поток случайных чисел сидов не меняется).
- `reviewCost(m) = REVIEW_COST_BASE ($300 000) + REVIEW_COST_PER_B ($2 000) × paramsB` (1,8 трлн - $3,9 млн).
- Действие `startReview(s, id)`: модель выпущена, `review === 'required'`, `cash ≥ cost` (иначе «Не хватает денег на проверку: нужно $X, на счету $Y»); `spend('review', cost)`, `review = 'pending'`, `reviewEndDay = day + reviewDays`.
- `reviewDay(s)` (тик, после обучения): `pending && day ≥ reviewEndDay` → `passed`, важное письмо.
- Пока `review ∈ {required, pending}`: `onSubs` включить нельзя («Сначала пройдите внешнюю проверку»); API продаётся как обычно (покупатели API - корпоративные и разработчики).
- Письма (kind `training`):
  1. При выпуске, если нужна проверка: «Нужна внешняя проверка: «X»» - «Модель заметно сильнее переднего края ({причина: Эло N против M у лучшего соперника | уровень по коду выше лучшего соперника}). До проверки её можно продавать только по API корпоративным клиентам и разработчикам. Проверка займёт D дней и стоит $C; начать её можно в окне «Модели».»
  2. При старте: «Внешняя проверка начата: «X»» - «Независимые эксперты проверяют модель до ДД.ММ.ГГГГ. Списано $C.»
  3. По окончании (`important: true`): «Внешняя проверка пройдена: «X»» - «Замечаний нет. Подписку можно включить в окне «Модели».»
- Старые сохранения: все модели `review = 'none'`.

### 4.3 Действия (`actions.ts`)

- `releaseModel(s, id, price, opts?: { onSubs?: boolean; subsPrice?: number })`: как сейчас плюс `subsPrice = opts.subsPrice ?? TIER_SUBS_PRICE[tier]` (проверка границ), `review = reviewRequired ? 'required' : 'none'`, `onSubs = !!opts.onSubs && subsOpen(s.day) && review === 'none'`; письмо о выпуске: «Модель доступна клиентам по API{ и по подписке}.»; при `review === 'required'` - письмо 1 из 4.2.
- `setOnSubs(s, id, on)`: модель выпущена; при `on`: `subsOpen` («Подписки появятся после выхода чат-ботов (30.11.2022).»), `review ∈ {none, passed}`.
- `setSubsPrice(s, id, price)`: границы 4.1.
- `startReview(s, id)`: 4.2.
- `cancelTraining(s, runId)`: раздел 6.
- `setOnApi`, `setModelPrice` - без изменений.

## 5. Соперники

### 5.1 Каналы соперников

- Канал API: `rivalOnApi(def) = (def.api || def.openWeights) && !def.announcedOnly` - прежний фильтр `marketRivals`.
- Канал подписки: `rivalOnSubs(def) = def.chat && !def.announcedOnly && !(def.openWeights && !def.api)` (ChatGTP, Berd, Kimo Chat, Gemeni 1.0 Ultro, Gemeni-Exp-1206 - да; ChatGML-6B (только веса) - нет; Qwin-72B (API и веса) - да).
- `marketRivals(s, channel: Channel = 'api')`: тот же отбор (не старше 3 лет, по 3 новейших на лабораторию), фильтр по каналу. Вызовы без аргумента (`leaderboard.ts`, `rivalry.ts`, тесты) не меняются.
- Цена подписки соперника `rivalSubsPrice(def) = TIER_SUBS_PRICE[rivalTier(def)]`; цена API - прежняя `rivalPriceIn`.
- `MarketEntry` дополняется: `tier: Tier`, `codeLevel: number | null`, `demand: number` (единицы сегмента), `tokens` - токены в день (для consumers `demand × TOKENS_PER_USER_DAY`).

### 5.2 Изменения в `rivalry.ts` (точный список)

| Место | Было | Стало |
|---|---|---|
| `MOVES.freeTier.demand` | 1,08 | 1 (спрос API не трогает) |
| `execFreeTier` | `labBrand` target lab add 0,15k; `demand` ×1,08 | `segBrand` target `${lab}:consumers` add 0,3k на 180 дней; `subsDemand` ×1,15 id `rival-subsdemand-${lab}`; текст письма: «Бренд {lab} у обычных пользователей сильнее в течение 180 дней, спрос на подписки вырос на 15 %. Удержать подписчиков помогут цена подписки и контекст.» |
| `triggerHolds.freeTier` | `shareP ≥ 0,12` | `segShare(s, 'consumers', 'player') ≥ 0,12` (новый помощник: `s.market.segments[seg].labShares[owner] ?? 0`) |
| `triggerHolds.cheapShock` | `shareP ≥ diff.shockShare` | `segShare(s, 'developers', 'player') ≥ diff.shockShare` |
| `templateDef` | - | `tier`: cheap → `'light'`, open → `'mid'`, context → `rivalTier(base)` |
| `botPriceReflex` | API ×0,85 | плюс `subsPrice × 0,9`, не ниже $5, для моделей с `onSubs` |
| `rumourBody.freeTier` | - | «…Рынок подписок вырастет, но бренд {lab} у обычных пользователей станет сильнее…» |

Остальное (`threatOf`, `computeLever`, `labStance`, `playerShare`, память, накал) - без изменений: общие доли сохраняют смысл.

### 5.3 Модификаторы

`ModifierKind` += `'segBrand'` (target `${lab | 'player'}:${SegmentId}`, `add`) и `'subsDemand'` (`mult` к `SUBS_USERS`). `save.MODIFIER_KINDS` += оба. `demand` по-прежнему множит только `T(t)`.

## 6. Параллельное обучение

```ts
trainings: TrainingRun[];          // было training: TrainingRun | null; не больше MAX_TRAININGS = 2
nextRunNum: number;                // новое, 1; id проекта `t${n}`
interface TrainingRun { id: string; failed: boolean; ...прежние поля }
```

- Мощность на проект: `pool(s, 'training') / trainings.length` (`trainingPoolPerRun(s, extra = 0)`; `estimate` считает срок с `extra = 1`).
- `progressDay`: для каждого проекта: `failed` → стоит; иначе `flopDone += poolPerRun × TRAIN_FLOP_PER_H100E_DAY`; срыв запускается, только если `!awaitingEvent(s, 'training-fail')` (второй срыв ждёт решения по первому: `flopDone` зажимается в точке срыва, `failAtFraction` остаётся); завершение - модель, проект удаляется из массива.
- `applyFailChoice(s, choice)`: проект `trainings.find(r => r.failed)`; после выбора `failed = false`, `failAtFraction = null`.
- `cancelTraining(s, runId)`: нет проекта - «Нет такого проекта обучения.»; если он `failed` - `dropChoices('training-fail', …)`.
- `validatePlan`: `trainings.length ≥ MAX_TRAININGS` → «Одновременно идут не больше двух проектов обучения.»; `FAIL_BIG_JUMP` по `bestFlop` как сейчас.
- `data/events.ts` `training-fail.mail`: имя - `s.trainings.find(r => r.failed)?.plan.name`.
- Старые сохранения: `trainings = training ? [{ ...training, id: 't1', failed: есть неотвеченное письмо 'training-fail' }] : []`, `nextRunNum = 2`, поле `training` удаляется.
- Боты: один проект за раз (как сейчас); `botChoice` - по проекту с `failed`.

## 7. Боты (`bots.ts`)

- `manageAlloc`: `{ api: needApi, subs: needSubs } = inferenceNeed(s, snap)`; `api = min(BOT_SERVE_MAX (0,5), needApi × 1,15 / total)`, `subs = min(0,5, needSubs × 1,15 / total)`, вместе не больше `BOT_SERVE_TOTAL_MAX (0,7)` (урезать пропорционально); остальное как сейчас.
- `manageModels`: выпуск по цене `0,8 × TIER_API_PRICE_MULT[tier] × P_ref`; две лучшие модели - `onApi = true`; с `subsOpen`: `review === 'required' && cash ≥ 3 × reviewCost` → `startReview`; `review ∈ {none, passed}` → `setOnSubs(true)`; остальные модели - оба канала выключены. `subsPrice` - по умолчанию.
- `chinchillaPlan`: `tier: tierOf(paramsB, s.day)`.
- `botPriceReflex` - 5.2.

## 8. Финансы и инвесторы

- `IncomeKind` += `'subs'` («Подписки»); `ExpenseKind` += `'review'` («Проверки»). `state.emptyLedger` и `save.ts` формы обновить; миграция: `income.subs = 0`, `expense.review = 0` в `finance.month` и каждой записи `history`.
- `finance.earn('subs')` идёт в `revenueDaily` (не инвесторы); `lastMonthRevenue = api + subs + contracts`; накладные 3 % считаются от неё.
- `MonthRecord` += `subscribers: number` (обслужено подписчиков в последний день; миграция 0).
- Инвесторы: `annualRev` из `revenueLast90` уже включает подписки; `techValue` по-прежнему по месту среди моделей по API. Код `investors.ts` не меняется.

## 9. Состояние: полный список изменений

| Поле | Тип | По умолчанию (миграция) |
|---|---|---|
| `compute.alloc` | `Allocation` с `api`, `subs` | `api = inference`, `subs = 0` |
| `trainings` | `TrainingRun[]` | из `training` (раздел 6) |
| `nextRunNum` | `number` | 2, если был проект, иначе 1 |
| `TrainingRun.id`, `.failed` | `string`, `boolean` | `'t1'`, по письму |
| `TrainingPlan.tier` | `Tier` | `tierOf(paramsB, день старта или обучения)` |
| `PlayerModel.onSubs` | `boolean` | `false` |
| `PlayerModel.subsPrice` | `number` | `TIER_SUBS_PRICE[tier]` |
| `PlayerModel.review` | `'none' \| 'required' \| 'pending' \| 'passed'` | `'none'` |
| `PlayerModel.reviewEndDay` | `number \| null` | `null` |
| `PlayerModel.earnedSubs` | `number` | 0 |
| `finance.*.income.subs`, `expense.review` | `number` | 0 |
| `MonthRecord.subscribers` | `number` | 0 |
| `market.playerSubs`, `totalSubs`, `lostApi`, `lostSubs` | `number` | 0 |
| `market.segments` | `Record<SegmentId, SegmentShares>` | у каждого сегмента `{ shares: {}, labShares: { все 0, none: 1 }, total: 0 }` |
| `ModifierKind` | + `segBrand`, `subsDemand` | - |
| `RivalModelDef.tier?` | `Tier` | - (данные) |

`version` остаётся 1. Миграция - одна функция `migrateMarketV2(data)` в `save.ts` перед проверкой формы; `STATE` в `save.ts` дополняется новыми полями (тип `Record<keyof GameState, Check>` не даст забыть).

## 10. Константы (`constants.ts`, стартовые значения)

```ts
export const CHAT_MOMENT_DATE = '2022-11-30';          // переносится из data/events.ts (CHAT_DATE), там импорт
export const DEFAULT_ALLOC = { training: 0.4, contracts: 0.2, experiments: 0.4, api: 0, subs: 0 };
export const MAX_TRAININGS = 2;
export const SEGMENT_DEF: Record<SegmentId, SegmentDef> = { /* таблица 2.1 */ };
export const DEV_SHARE_OF_API: [string, number][] = [['2017-01-01', 0.8], ['2020-06-11', 0.7], ['2022-11-30', 0.6], ['2024-12-31', 0.45]];
export const SUBS_USERS: [string, number][] = [['2017-01-01', 1e3], ['2020-06-11', 2e4], ['2022-11-29', 1e5], ['2022-11-30', 5e5], ['2023-02-10', 1.5e6], ['2023-06-01', 3e6], ['2024-01-01', 7e6], ['2024-12-31', 1.5e7]];
export const SUBS_REF_PRICE = 20; export const SUBS_PRICE_MIN = 1; export const SUBS_PRICE_MAX = 200;
export const SUBS_PRICE_RATIO_MIN = 1 / 4; export const SUBS_PRICE_RATIO_MAX = 4;
export const CODE_UTILITY_SCALE = 10; export const CODE_DIFF_CAP = 20;
export const FRONTIER_PARAMS_B: [string, number][] = [['2017-01-01', 1], ['2019-02-14', 1.5], ['2020-06-11', 175], ['2022-04-04', 540], ['2023-03-14', 1800], ['2024-12-31', 2000]];
export const TIER_PARAMS_RATIO: Record<Tier, [number, number]> = { light: [0, 0.08], mid: [0.08, 0.35], flagship: [0.35, 1.5] };
export const TIER_PRESET_RATIO: Record<Tier, number> = { light: 0.04, mid: 0.17, flagship: 0.7 };
export const TIER_API_PRICE_MULT: Record<Tier, number> = { light: 0.25, mid: 1, flagship: 3 };
export const TIER_SUBS_PRICE: Record<Tier, number> = { light: 10, mid: 20, flagship: 20 };
export const RIVAL_TIER_PRICE_RATIO = { flagship: 2.5, mid: 0.4 }; export const RIVAL_TIER_ELO_GAP = 30;
export const REVIEW_ELO_GAP = 10; export const REVIEW_CODE_GAP = 5;
export const REVIEW_DAYS_MIN = 30; export const REVIEW_DAYS_EXTRA = 15;
export const REVIEW_COST_BASE = 300_000; export const REVIEW_COST_PER_B = 2_000;
// bots.ts: BOT_SERVE_MAX = 0.5, BOT_SERVE_TOTAL_MAX = 0.7, BOT_REVIEW_CASH_MULT = 3
```

`CONTEXT_MARKET_K`, `PRICE_ELASTICITY`, `TOKENS_PER_USER_DAY`, `DEMAND_TOKENS`, `REF_PRICE`, `REF_QUALITY` - без изменений (`contextUtility` и `PRICE_ELASTICITY` остаются для старых тестов; рынок использует веса сегментов).

## 11. Порядок тика (изменения)

Между 5 (`training.progressDay`) и 6 (`contracts.progressDay`) добавляется **5а. `training.reviewDay`** (завершение внешних проверок). Шаг 7 `market.dayStep` считает три сегмента, два канала мощности, выручку `api` и `subs`, пишет `s.market` целиком (включая `segments`). Остальной порядок без изменений. В конце месяца `closeMonth` пишет `subscribers = s.market.playerSubs`.

## 12. API модулей (новое и изменённое)

| Модуль | Экспорт |
|---|---|
| `compute.ts` | `pool(s, kind: keyof Allocation)` - ключи `api`, `subs`; `normalizeAlloc` на 5 ключей |
| `market.ts` | `demandTokens(s)`, `devShareOfApi(day)`, `subsUsers(s)`, `segmentDemand(s, seg)`, `subsOpen(day)`, `servingTokensPerH100eDay(paramsB)`, `contextLogRatio(context, day)`, `codeLevel(s, ref)`, `segBrand(s, owner, seg)`, `perceivedQuality(s, owner, elo, hypeMult = 1)`, `marketSnapshot(s)` → `MarketSnapshot { segments: Record<SegmentId, SegmentSnapshot>; totalTokens; totalSubs }`, `SegmentSnapshot { id; channel; entries: MarketEntry[]; noneShare; total; weight }`, `inferenceNeed(s, snap)` → `{ api; subs }`, `servedShares(seg, served)` (без изменений), `combineShares(snap, served: Record<SegmentId, ServedShares>)` → общие `shares`/`labShares`, `playerSales(s, modelId)` → `{ apiTokens; subsUsers; apiRevenueDay; subsRevenueDay }` из `s.market`, `dayStep(s)` |
| `rivals.ts` | `marketRivals(s, channel = 'api')`, `rivalOnApi(def)`, `rivalOnSubs(def)`, `rivalTier(def)`, `rivalSubsPrice(def)`, `catalogEloFrontier(day)` |
| `leaderboard.ts` | `rivalFrontierElo(s)`; `marketArenaRank` без изменений (по API) |
| `training.ts` | `frontierParams(day)`, `tierOf(paramsB, day)`, `tierRange(day, tier)`, `tierPreset(s, tier)`, `trainingPoolPerRun(s, extra = 0)`, `validatePlan` (уровень, лимит проектов), `estimate` (срок при `trainings.length + 1`), `startTraining`, `cancelTraining(s, runId)`, `applyFailChoice`, `progressDay`, `reviewRequired(s, m)`, `reviewCost(m)`, `reviewDays(s, m)`, `startReview(s, id)`, `reviewDay(s)` |
| `actions.ts` | `releaseModel(s, id, price, opts?)`, `setOnSubs`, `setSubsPrice`, `startReview`, `cancelTraining(s, runId)` |
| `finance.ts` | `earn(s, 'subs', x)`, `spend(s, 'review', x)`, `lastMonthRevenue` (+subs) |
| `rivalry.ts` | `segShare(s, seg, owner)`; изменения 5.2 |
| `save.ts` | `migrateMarketV2(data)` |
| `bots.ts` | сигнатуры прежние |

## 13. Тесты (добавить)

- `market.test.ts`: опорные точки `DEV_SHARE_OF_API`, `SUBS_USERS`, `subsOpen`; consumers пуст до 30.11.2022; сумма долей по сегменту 1; разработчики чувствительнее к цене, чем корпоративные; при равных Эло и цене light выигрывает у разработчиков, flagship - у корпоративных; подгонка под HumanEvol поднимает долю у разработчиков, разоблачение режет корпоративных; `servingTokensPerH100eDay(175) ≈ 3,66e7`; `inferenceNeed` по каналам; `pool.api = 0` - выручки API нет, подписки идут; `pool.subs` вдвое меньше нужного - выручка подписок вдвое; общие доли - взвешенная сумма, в сумме 1; `playerSales`; ChatGTP в `marketRivals(s,'subs')` и не в `'api'`; `dayStep` пишет `segments`, `playerSubs`, `lostSubs`; детерминизм; прежняя формула API при `hypeMult = 1` (старые тесты - через `perceivedQuality` без сегмента).
- `training.test.ts`: `tierOf` (0,1 млрд в 2017 - mid; 175 млрд 11.06.2020 - flagship; 72 млрд 30.11.2023 - light), `tierRange` (light в 2017 - 0,05…0,08), `tierPreset`; `validatePlan` отклоняет несовпадающий уровень и третий проект; два проекта делят мощность поровну и идут независимо; срыв второго ждёт решения по первому; `cancelTraining(id)`; `estimate.days` при одном идущем проекте вдвое длиннее; `reviewRequired` по Эло и по коду, не требуется без соперников; `reviewCost`, `reviewDays` 30…45; `startReview` списывает и ставит `pending`; `reviewDay` переводит в `passed` и шлёт важное письмо; `setOnSubs` до прохождения отклоняется.
- `rivals.test.ts`: `rivalTier` по опорам 3.1; `marketRivals('subs')`; уровни шаблонов.
- `rivalry.test.ts`: `freeTier` ставит `segBrand` только consumers и `subsDemand`; `cheapShock` срабатывает по доле разработчиков; `botPriceReflex` снижает `subsPrice`.
- `save.test.ts`: сохранение старого вида (alloc с `inference`, `training`, модели без новых полей, журнал без `subs`/`review`, рынок без `segments`) загружается с умолчаниями из 9; загрузка нового - без изменений; детерминизм после загрузки.
- `finance.test.ts`: `earn('subs')` входит в `revenueDaily` и `lastMonthRevenue`; `spend('review')`.
- `compute.test.ts`: пять ключей, `DEFAULT_ALLOC`, нормализация.
- `events.test.ts`: письмо `training-fail` называет проект с `failed`.
- `bots.test.ts`: после 30.11.2022 у бота есть модель с `onSubs`; `alloc.api + alloc.subs ≤ 0,7`, сумма 1.
- `investors.test.ts`: оценка растёт с выручкой подписок.
- `ui/alloc.test.ts` (новый): `setPercent` не трогает другие доли, `totalPercent`, `percentsOf` на 5 ключей.
- `balance.test.ts` - раздел 14.

## 14. Опоры баланса (`balance.test.ts`)

- Бот «ничего» банкротится до 01.01.2020 (как сейчас).
- Бот «разумный» (зёрна 2, 3, 5): `finished`; 2-4-е место среди моделей по API; выручка за игру (api + subs + contracts) в пределах $0,5…2,0 млрд; доход `subs` за 2024 год больше 0 и не больше 70 % выручки 2024 года; инвесторы ≤ 1,5 выручки; касса в конце ≤ расходов за последний год; прогон < 12 с.
- Бот «сильный»: победа хотя бы на одном зерне из трёх, остальные ≤ 3-го места; инвесторы ≤ 2 выручек; на Сложной доживает на зёрнах 1-5.
- Бот «подгонщик» хуже разумного на зерне 3.
- Чистые опоры рынка (без ботов, `newGame` + `advanceDays`): на 31.12.2024 потенциал подписок / потенциал API в пределах 1…1,6; доля OpenBrain среди обычных пользователей на 31.12.2023 ≥ 35 % при пустой лаборатории игрока.
- Ручки подстройки, если опоры не сходятся: `SUBS_USERS` (×0,5…1), `SEGMENT_DEF.consumers.u0Offset` (+0,5…+1,0), `BOT_SERVE_MAX`, `revenueReinvest` бота, `TIER_UTILITY`. Тест печатает итог прогона с добавлением `subs2024` и `subscribers`.

## 15. Интерфейс

Общие правила текста: кнопки - глаголы («Распределить», «Выпустить», «Начать проверку», «Изменить цену»), подписи - существительные («API», «Подписка», «Уровень», «Цена подписки в месяц»), подсказки - одно предложение.

### 15.1 «Мощности» (`ComputeWindow.tsx`, `ui/alloc.ts`)
- `ALLOC_ROWS`: Обучение, Контракты, Исследования, API (подсказка «Обслуживание запросов по API: корпоративные клиенты и разработчики.», цвет прежний зелёный), Подписки (подсказка «Обслуживание чата для подписчиков.», цвет `#1fa8a0`).
- Ползунки независимы: `setPercent(cur, key, v)` меняет только свою долю; `withPercent` остаётся для диалога исследования. Рядом с каждым ползунком поле процента (`type=number`, 0…100, Enter применяет).
- Строка «Занято: N %»; при N ≠ 100 рядом «свободно K %» или «лишние K %» красным.
- «Распределить» активна при изменениях; при сумме ≠ 100 после нажатия - `ErrorText` «Сумма долей должна быть 100 %. Сейчас N %.», действие не вызывается. При `api = 0` и модели с `onApi` (или `subs = 0` и модели с `onSubs`) - `ConfirmDialog` «Доля «API» равна 0 %: запросы к моделям в продаже не будут обслуживаться. Распределить?» (кнопки «Распределить» / «Отмена»).
- `ClientNeed` под API: «Нужно API: N H100e», под Подписки: «Нужно подпискам: N H100e» (из `inferenceNeed`); нехватка - `Alert warn`.
- «Сведения»: пять строк долей.

### 15.2 «Новая модель» (`TrainingWindow.tsx`)
- Первый блок «Уровень»: три кнопки-радио с названием, диапазоном «от X до Y млрд параметров», подписью «API ≈ $P за 1 млн, подписка $S в месяц» и «≈ N пользователей чата на H100e» (по пресету); недоступный уровень заблокирован с подсказкой «Передний край ещё мал для этого уровня». Выбор уровня подставляет пресет (параметры и токены); ползунок размера ограничен `tierRange`. `Draft.tier` (по умолчанию - уровень прошлого проекта или «Средняя»).
- Сводка слева: строка «Уровень».
- Второй проект: при одном идущем проекте форма открыта с `Alert info` «Второй проект разделит долю «Обучение» пополам: срок текущего проекта вырастет вдвое»; срок считается через `estimate` (уже учитывает деление). При двух проектах форма заблокирована: «Идут два проекта обучения».
- `RunningBar` → список проектов: имя, уровень, готово, осталось, «Отменить» у каждого (подтверждение как сейчас).

### 15.3 «Модели» (`ModelsWindow.tsx`)
- Список: под именем значок уровня (pill «Лёгкая» / «Средняя» / «Флагман»), состояние «Обучена», «В продаже: API», «В продаже: API, подписка», «В продаже: подписка», «Снята»; при `review = 'required'` - «Нужна проверка», `pending` - «Проверка до ДД.ММ».
- Карточка, показатели: «Место на «Арене»», «Пользователей API в день» (≈ токены / 10 000), «Подписчиков» (`playerSales.subsUsers`), «Выручка в день» (API + подписки, подпись «API $a, подписки $b»), «Заработала всего» (подпись «из них подписки $x»).
- Блок «Продажи» из двух панелей:
  - «API»: флажок «API» (`setOnApi`), цена за 1 млн токенов и «Изменить цену» (как сейчас), доля API и токены в день.
  - «Подписка»: флажок «Подписка» (`setOnSubs`), «Цена подписки в месяц» и «Изменить цену» (`setSubsPrice`), подписчиков и выручка в день. Флажок недоступен с подсказкой: до 30.11.2022 - «Подписки появятся после выхода чат-ботов»; `required` - «Нужна внешняя проверка» и кнопка «Начать проверку» с подписью «$C, D дней»; `pending` - «Проверка до ДД.ММ.ГГГГ».
  - Кнопка «Снять с продажи» убирается: оба флажка выключены = «Снята».
- Блок «Выпуск на рынок»: цена по умолчанию - уровень × `P_ref` (три кнопки-подсказки остаются относительно этой цены); флажок «Подписка» (виден при `subsOpen`, по умолчанию включён, если проверка не нужна; иначе выключен с подсказкой) и поле «Цена подписки в месяц» с умолчанием уровня.
- Предупреждения: доля «API» 0 % при `onApi`, доля «Подписки» 0 % при `onSubs`; потери по каналу («Не хватает мощности «API»: теряется N %», «…«Подписки»…»).

### 15.4 «Аналитика» → «Рынок» (`MarketWindow.tsx`)
- Над «Моделями на рынке» новый раздел «Сегменты»: таблица «Сегмент | Канал | Что ценит | Спрос | Ваша доля | Лидер | Лучшие модели» (спрос - «N токенов в день» или «N пользователей»; лидер - лаборатория с наибольшей долей и её доля; лучшие модели - три первые с долями). Данные из `marketSnapshot(s).segments` (спрос) и `s.market.segments` (доли).
- Таблица «Модели на рынке»: колонки «Канал» (API / Подписка / API, подписка), «Уровень», «Цена» (API: за 1 млн; подписка: в месяц), «Обычные», «Корпоративные», «Разработчики» (доли по сегментам), «Спрос» (токены в день или пользователи). Старая колонка «Доля» - общая.
- «Доли лабораторий» и график - общие доли (без изменений).

### 15.5 «Аналитика» → «Ваши модели», «Финансы», верхняя панель, боковая панель
- «Ваши модели»: график выручки - ряды API, Подписки, Контракты (`REVENUE_SERIES`); таблица: колонки «Каналы», «Уровень», «Цена подписки», «Подписчиков».
- «Финансы»: `INCOME_KINDS = ['api', 'subs', 'contracts', 'investors']`, `INCOME_LABELS.subs = 'Подписки'`; `EXPENSE_KINDS` + `'review'`, `EXPENSE_LABELS.review = 'Проверки'`, подсказка «Оплата внешней проверки сильных моделей»; `revenueOf` и «Итог без инвесторов» включают подписки.
- Верхняя панель (`TopBar.tsx`): «/мес.» и подсказка доходов включают `subs`.
- Боковая панель (`SidePanel.tsx`): вкладка «Модели» - у каждой модели строки «Подписчиков» и «Выручка в день» (API + подписки); строка цели - «Подписчиков: N» (`s.market.playerSubs`).

### 15.6 Обучение для новичков (`tutorialSteps.ts`)
- «Распределение мощности»: «Мощность делится на пять частей: обучение, контракты, исследования, API и подписки. Доли вводят ползунками или числами, в сумме должно быть 100 %. Нажмите «Распределить».»
- «Первая модель»: «…откройте «Новая модель». Выберите уровень «Средняя», при необходимости поправьте размер и данные и нажмите «Начать обучение».»
- «Выпуск модели»: «…Запросы по API обслуживает доля «API» в «Мощностях», чат подписчиков - доля «Подписки» (с 30.11.2022).»
- Остальные шаги без изменений.

## 16. Вне среза

Число видеокарт мелкими цифрами рядом с H100e и всплывающие уведомления (требования, п. 7) - отдельные задачи интерфейса, в этот срез не входят.
