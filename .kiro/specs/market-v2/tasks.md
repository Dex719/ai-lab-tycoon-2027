# Tasks: market-v2

## Document Information

- **Feature Name**: market-v2
- **Version**: 0.1
- **Date**: 12.10.2026
- **Author**: Dex719
- **Status**: план на ночную сборку (два агента по очереди: сначала симуляция, затем интерфейс)
- **Related Documents**: `requirements.md`, `design.md`

## Порядок работы

- Агент A (симуляция) выполняет A1-A12 строго по порядку: каждый шаг заканчивается зелёными `npx vitest run <свои тесты>` и `npx tsc --noEmit -p .`. Правки интерфейса в A - только те, без которых не собирается `tsc` (переименование ключей, новые поля в формах).
- Агент B (интерфейс) начинает после A12 и выполняет B1-B9; по окончании - `npx tsc --noEmit -p .`, `npx vitest run`, `npx vite build`.
- Шаг C (баланс) - последним.
- Общие правила: ни одного U+2014/U+2013 в текстах интерфейса и писем (только «-»); даты в письмах через `formatDate`; константы только в `constants.ts` (у ботов - в `bots.ts`); `Math.random`/`Date.now` в `src/sim` запрещены.

## A. Симуляция

- [ ] **A1. Контракт: типы, константы, состояние**
  - Файлы: `src/sim/types.ts` (`Allocation` с `api`/`subs`, `SegmentId`, `Channel`, `Tier`, `TrainingPlan.tier`, `TrainingRun.id/failed`, `GameState.trainings/nextRunNum`, поля `PlayerModel` из design 4.1, `IncomeKind` + `subs`, `ExpenseKind` + `review`, `MonthRecord.subscribers`, `ModifierKind` + `segBrand`/`subsDemand`, `RivalModelDef.tier?`, `market` из design 2.7), `src/sim/constants.ts` (раздел 10 design, `CHAT_MOMENT_DATE`), `src/sim/state.ts` (`emptyLedger`, `createInitialState`: `trainings: []`, `nextRunNum: 1`, `market.segments`).
  - Переименование `inference` → `api` везде по списку design 1.1 (включая тесты: в литералах добавить `subs: 0`).
  - Тесты: `compute.test.ts` (пять ключей, `DEFAULT_ALLOC`, нормализация). Критерий: `tsc` зелёный на этом шаге допускает временные ошибки только в `save.ts`, `training.ts`, `market.ts`, которые закрываются в A2-A5.

- [ ] **A2. Сохранения и миграция**
  - Файлы: `src/sim/save.ts` (`migrateMarketV2`, формы `STATE`, `MODIFIER_KINDS`, `playerModel`, `trainingRun`, `income`/`expense`, `monthRecord`, `market`).
  - Тесты: `save.test.ts` - сохранение старого вида (alloc с `inference`, `training`, модели без новых полей, журнал без `subs`/`review`, рынок без `segments`) загружается с умолчаниями design 9; новое сохранение - без изменений; `serialize(deserialize(x)) === x` для нового.

- [ ] **A3. Финансы**
  - Файлы: `src/sim/finance.ts` (`lastMonthRevenue` + subs, `closeMonth` пишет `subscribers`).
  - Тесты: `finance.test.ts` - `earn('subs')` в `revenueDaily` и в выручке месяца; `spend('review')`; `closeMonth.subscribers`.

- [ ] **A4. Уровни, параллельное обучение, проверка**
  - Файлы: `src/sim/training.ts` (`frontierParams`, `tierOf`, `tierRange`, `tierPreset`, `trainingPoolPerRun`, `validatePlan` с уровнем и лимитом проектов, `estimate` с `extra = 1`, `startTraining` → `trainings.push` с `id`, `cancelTraining(s, runId)`, `applyFailChoice`, `progressDay` по массиву, `reviewRequired`, `reviewCost`, `reviewDays`, `startReview`, `reviewDay`), `src/sim/leaderboard.ts` (`rivalFrontierElo`), `src/data/events.ts` (`training-fail` имя проекта с `failed`; `CHAT_DATE` → импорт `CHAT_MOMENT_DATE`), `src/sim/tick.ts` (`reviewDay` после `trainingDay`).
  - `codeLevel` временно можно вызывать из `market.ts` (A5): чтобы не замыкать импорты, положить `codeLevel` в `leaderboard.ts` рядом с `rivalFrontierElo` и импортировать в оба модуля.
  - Тесты: `training.test.ts` (замена `s.training` → `s.trainings[0]`, `s.training = null` → `s.trainings = []`; новые случаи из design 13), `events.test.ts` (письмо срыва), `tick.test.ts` (проверка завершается в тике).

- [ ] **A5. Рынок по сегментам**
  - Файлы: `src/sim/market.ts` (design 2 и 12: `devShareOfApi`, `subsUsers`, `segmentDemand`, `subsOpen`, `servingTokensPerH100eDay`, `contextLogRatio`, `segBrand`, `perceivedQuality(…, hypeMult)`, `marketSnapshot` с сегментами, `inferenceNeed` → `{ api, subs }`, `combineShares`, `playerSales`, `dayStep`), `src/sim/rivals.ts` (`marketRivals(s, channel)`, `rivalOnApi`, `rivalOnSubs`, `rivalTier`, `rivalSubsPrice`, `catalogEloFrontier`).
  - Тесты: `market.test.ts` (старые тесты формулы API переводятся на `segments.developers`/`enterprise` или на `perceivedQuality` без сегмента; новые случаи из design 13), `rivals.test.ts` (`rivalTier` по опорам design 3.1, `marketRivals('subs')`).

- [ ] **A6. Действия**
  - Файлы: `src/sim/actions.ts` (`releaseModel(s, id, price, opts?)`, `setOnSubs`, `setSubsPrice`, `startReview`, экспорт `cancelTraining(s, runId)`), тексты писем design 4.2 и 4.3.
  - Тесты: `training.test.ts` или новый `actions.test.ts` - выпуск с подпиской до/после 30.11.2022, цена подписки в границах, `setOnSubs` при `review`, `startReview` без денег.

- [ ] **A7. Соперники с характерами**
  - Файлы: `src/sim/rivalry.ts` (таблица design 5.2: `MOVES.freeTier.demand`, `execFreeTier`, `triggerHolds` freeTier/cheapShock, `templateDef.tier`, `botPriceReflex`, `segShare`, тексты слуха и письма).
  - Тесты: `rivalry.test.ts` - `freeTier` ставит `segBrand` только consumers и `subsDemand`; `cheapShock` по доле разработчиков; `botPriceReflex` снижает `subsPrice`; остальные тесты зелёные (общие доли не меняли смысл).

- [ ] **A8. Инвесторы**
  - Файлы: `src/sim/investors.ts` - без правок логики; проверить, что `Valuation.annualRevenue` включает подписки.
  - Тесты: `investors.test.ts` - оценка растёт при `earn('subs')`.

- [ ] **A9. Боты**
  - Файлы: `src/sim/bots.ts` (design 7: `manageAlloc` по каналам, `manageModels` с подпиской и проверкой, `chinchillaPlan.tier`, `botChoice` по проекту с `failed`).
  - Тесты: `bots.test.ts` - после 30.11.2022 у бота есть модель с `onSubs`; `alloc.api + alloc.subs ≤ 0,7`; сумма долей 1; `chinchillaPlan.tier === tierOf`.

- [ ] **A10. Сборка интерфейса до зелёного `tsc`**
  - Минимальные правки, чтобы проект собирался: `src/ui/alloc.ts` (`ALLOC_ROWS` пять строк, `toAllocation`, `percentsOf`), `src/ui/labels.ts` (`subs`, `review`), `src/ui/windows/ComputeWindow.tsx`, `ModelsWindow.tsx`, `TrainingWindow.tsx`, `SidePanel.tsx`, `tutorialSteps.ts`, `TopBar.tsx`, `FinanceWindow.tsx`, `AnalyticsWindow.tsx` - только замена `s.training` → `s.trainings`, `pool(s,'inference')` → `pool(s,'api')`, `s.market.shares` → `playerSales`, новые обязательные поля ledger. Внешний вид не менять (это B).
  - Критерий: `npx tsc --noEmit -p .` и `npx vitest run` зелёные целиком.

- [ ] **A11. Опоры баланса (первый проход)**
  - Файлы: `src/sim/balance.test.ts` (design 14: новые проверки `subs2024`, потенциал подписок/API, доля OpenBrain среди обычных), при необходимости `constants.ts` (`SUBS_USERS`, `u0Offset`) и `bots.ts` (`BOT_SERVE_MAX`).
  - Критерий: все опоры зелёные; в отчёте - таблица итогов прогонов (место, Эло, выручка, из них подписки, инвесторы, касса).

- [ ] **A12. Отчёт для агента B**
  - Короткий список: что из сигнатур design 12 отличается от реализации, какие поля интерфейсу брать из `s.market.segments` и `playerSales`, какие действия экспортированы из `actions.ts`.

## B. Интерфейс

- [ ] **B1. `ui/alloc.ts` и «Мощности»** - `setPercent`, `totalPercent`, независимые ползунки, поля процентов, «Занято: N %», ошибка после «Распределить», подтверждение 0 % для API/подписок, `ClientNeed` по каналам, пять строк в «Сведениях» (design 15.1). Тест: новый `src/ui/alloc.test.ts`.
- [ ] **B2. «Новая модель»** - блок «Уровень» с пресетами и диапазоном, ограничение ползунка размера, строка «Уровень» в сводке, второй проект, список идущих проектов с «Отменить» (design 15.2). Проверить `data-tutorial="train-start"` на месте.
- [ ] **B3. «Модели»** - значки уровня и проверки в списке, показатели, панели «API» и «Подписка», кнопка «Начать проверку», блок выпуска с подпиской и ценой уровня, предупреждения по каналам (design 15.3). `data-tutorial="release"` на кнопке «Выпустить».
- [ ] **B4. «Аналитика» → «Рынок»** - раздел «Сегменты», новые колонки таблицы моделей (design 15.4).
- [ ] **B5. «Аналитика» → «Ваши модели», «Финансы»** - ряды и колонки подписок, статья «Проверки» (design 15.5).
- [ ] **B6. Верхняя и боковая панели** - `TopBar` «/мес.» с подписками; `SidePanel` подписчики у моделей и в строке цели (design 15.5).
- [ ] **B7. Обучение для новичков** - тексты трёх шагов (design 15.6); `done` шага «Первая модель»: `s.trainings.length > 0 || s.models.length > 0`.
- [ ] **B8. Тексты и подсказки** - пройти все новые строки: кнопки-глаголы, подписи-существительные, без длинных тире, даты через `formatDateShort`/`formatDate`; ошибки действий показываются `ErrorText`.
- [ ] **B9. Проверка сборки** - `npx tsc --noEmit -p .`, `npx vitest run`, `npx vite build` зелёные; в отчёте - список окон и что в каждом добавлено. Скриншоты - по возможности, если браузер доступен; иначе пометить «нужна проверка владельцем».

## C. Баланс (последний шаг)

- [ ] **C1. Полный прогон опор** - `npx vitest run src/sim/balance.test.ts` после B; при расхождениях крутить только ручки из design 14 (`SUBS_USERS`, `consumers.u0Offset`, `BOT_SERVE_MAX`, `revenueReinvest`, `TIER_UTILITY`), по одной за раз, с записью «было/стало» в отчёте.
- [ ] **C2. Сводка** - 10 строк в `PROGRESS.md`: что вошло, итоги прогонов (разумный: место, выручка, доля подписок 2024; сильный: победы), что отложено (п. 16 design).
