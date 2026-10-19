// Хранилище игры для React: состояние, скорость, игровой цикл, автосохранение.
// Симуляция меняет состояние на месте; интерфейс подписан на счётчик версий.

import { useSyncExternalStore } from 'react';
import * as actions from '../sim/actions';
import { TICK_MS } from '../sim/constants';
import type { Difficulty } from '../sim/rivalry';
import { goalOfferOpen, goalsDay, unseenReview } from '../sim/goals';
import { advanceDay, advanceDays, blockedByChoice } from '../sim/tick';
import type { ChallengeId, CofounderId, CountryId, GameState, Result, Speed, WorldModId } from '../sim/types';
import { landAction } from './feel';
import { readSlot, writeSlot, type SlotId } from './saves';
import { getSettings } from './settings';
import { runwayMonths } from './runway';

type Listener = () => void;

type AnyAction = (s: GameState, ...args: any[]) => Result | void;
/** Действия, которые можно делать после конца партии: только просмотр. */
const AFTER_END_ACTIONS: ReadonlySet<AnyAction> = new Set<AnyAction>([actions.markMailRead, actions.markAllRead, actions.renameModel]);

export class GameStore {
  state: GameState | null = null;
  speed: Speed = 0;
  lastSpeed: Exclude<Speed, 0> = 1;
  version = 0;
  /** Текст ошибки последнего автосохранения (например, переполнено хранилище браузера) или null. */
  autosaveError: string | null = null;
  /** Почему игра встала на паузу сама (заголовок важного письма и т. п.) или null. Пропадает, когда игрок продолжает игру. */
  pauseReason: string | null = null;
  /** Письмо, которое «Почта» должна открыть (после нажатия «Открыть» в уведомлении); окно забирает его и сбрасывает. */
  mailFocus: string | null = null;
  /**
   * Исключение в симуляции (шаг дня или действие игрока) или null. Пока оно есть, время стоит: иначе каждый тик повторял бы
   * тот же день и снова списывал его расходы (QA 19.10). Игрок выбирает в окне ошибки, что делать дальше.
   */
  simError: string | null = null;
  private listeners = new Set<Listener>();
  /** День последней паузы «денег хватит меньше чем на месяц». */
  private lowCashDay = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  focusMail(id: string | null): void {
    this.mailFocus = id;
    this.bump();
  }

  bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Начать игру с готовым состоянием (новая игра или загрузка). */
  start(state: GameState): void {
    this.state = state;
    this.lowCashDay = -Infinity;
    this.autosaveError = null;
    this.pauseReason = null;
    this.mailFocus = null;
    this.simError = null;
    this.setSpeed(0);
    this.bump();
  }

  /** Новая партия. difficulty - сложность соперников (по умолчанию «Обычная»). */
  newGame(
    labName: string,
    opts: { founderName?: string; tutorial?: boolean; seed?: number; difficulty?: Difficulty; country?: CountryId; challenges?: ChallengeId[]; worldMods?: WorldModId[]; cofounder?: CofounderId } = {},
  ): void {
    const s = actions.newGame(labName, opts.seed ?? (Date.now() ^ 0x5eed) >>> 0, opts.difficulty ?? 'normal', opts.country, {
      challenges: opts.challenges,
      worldMods: opts.worldMods,
      cofounder: opts.cofounder,
    });
    s.founderName = (opts.founderName ?? '').trim();
    s.tutorial = { step: 0, active: opts.tutorial ?? false };
    goalsDay(s); // цели первого года предлагаются сразу: окно выбора открывается до первого дня
    this.start(s);
  }

  /**
   * Сохранить партию в ячейку. Законченную партию в автосохранение не пишем: «Продолжить» её пропускает, и живая
   * партия пропала бы (QA 19.10: «Посмотреть игру» → «Сохранить и выйти» затирал автосохранение).
   */
  saveToSlot(id: SlotId): boolean {
    if (!this.state || (id === 'auto' && this.state.outcome)) return false;
    return writeSlot(id, this.state);
  }

  /** Загрузить ячейку; при ошибке вернуть её текст. */
  loadSlot(id: SlotId): string | null {
    const r = readSlot(id);
    if (!r.ok) return r.error;
    this.start(r.state);
    return null;
  }

  quit(): void {
    this.autosaveError = null;
    this.pauseReason = null;
    this.simError = null;
    this.setSpeed(0);
    this.state = null;
    this.bump();
  }

  /**
   * Выполнить действие игрока и перерисовать интерфейс. После конца партии («Посмотреть игру») - только просмотр:
   * прочитать письма, переименовать модель. Раньше можно было выпускать модели, поднимать раунды и добирать достижения.
   */
  dispatch<A extends unknown[]>(fn: (s: GameState, ...args: A) => Result | void, ...args: A): Result {
    if (!this.state) return { ok: false, error: 'Игра не начата' };
    if (this.state.outcome && !AFTER_END_ACTIONS.has(fn as unknown as AnyAction)) {
      return { ok: false, error: 'Партия окончена: можно только смотреть.' };
    }
    let r: Result;
    try {
      r = fn(this.state, ...args) ?? { ok: true };
    } catch (e) {
      this.fail(e);
      return { ok: false, error: 'Внутренняя ошибка игры: действие не выполнено.' };
    }
    if (r.ok) {
      landAction();
      // Игрок ответил на событие (выбор в письме, действие в окне): плашка «Пауза: …» больше не нужна, сама пауза остаётся
      // (плейтест 17.10 - старая причина висела минутами после решения).
      this.pauseReason = null;
    }
    this.bump();
    return r;
  }

  /** Служебное изменение (шаг обучения игре): не действие игрока, причину паузы на верхней панели не трогает. */
  note<A extends unknown[]>(fn: (s: GameState, ...args: A) => void, ...args: A): void {
    if (!this.state) return;
    fn(this.state, ...args);
    this.bump();
  }

  /** Скорость с клавиатуры (1, 2, 3): те же запреты, что у паузы и кнопок скорости. */
  requestSpeed(speed: Speed): void {
    const s = this.state;
    if (!s || s.outcome || this.simError || blockedByChoice(s) || unseenReview(s) || goalOfferOpen(s)) return;
    this.setSpeed(speed);
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    if (speed !== 0) {
      this.lastSpeed = speed;
      this.pauseReason = null; // игрок продолжил игру - причина паузы больше не нужна
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (speed !== 0) this.timer = setInterval(() => this.tick(), TICK_MS[speed]);
    this.bump();
  }

  /** Пауза/продолжение. В законченной игре и пока в почте ждёт выбор, часы не трогаем. */
  togglePause(): void {
    const s = this.state;
    if (!s || s.outcome || this.simError || blockedByChoice(s) || unseenReview(s) || goalOfferOpen(s)) return;
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }

  /** Вкладка браузера скрыта: браузер замедляет таймеры, а игра за это время ушла бы вперёд. Сами не продолжаем. */
  pauseForHidden(): void {
    if (!this.state || this.state.outcome || this.speed === 0 || !getSettings().pauseOnHidden) return;
    this.pauseReason = 'Вкладка была скрыта';
    this.setSpeed(0);
  }

  private tick(): void {
    const s = this.state;
    if (!s) return;
    if (s.outcome) {
      this.setSpeed(0);
      return;
    }
    if (this.simError) {
      this.setSpeed(0);
      return;
    }
    // Ждём выбора в почте, закрытия итогов года или выбора целей года; скорость сохраняется.
    if (blockedByChoice(s) || unseenReview(s) || goalOfferOpen(s)) return;
    const mark = this.markAdvance(s);
    try {
      advanceDay(s);
    } catch (e) {
      this.fail(e);
      return;
    }
    this.afterAdvance(mark);
  }

  /** Исключение в симуляции: время стоит, текст ошибки - в окне игры и в консоли (для отчёта об ошибке). */
  private fail(e: unknown): void {
    console.error('[ai-lab] ошибка симуляции', e);
    this.simError = e instanceof Error ? e.message || e.name : String(e);
    this.setSpeed(0);
  }

  /** Игрок решил продолжить после ошибки симуляции. */
  dismissSimError(): void {
    this.simError = null;
    this.bump();
  }

  /** Перемотка на n дней (отладка и проверка агентом). */
  advance(n: number): number {
    if (!this.state || this.simError) return 0;
    const mark = this.markAdvance(this.state);
    let done = 0;
    try {
      done = advanceDays(this.state, n);
    } catch (e) {
      this.fail(e);
      return 0;
    }
    this.afterAdvance(mark);
    return done;
  }

  /** Запомнить, что было до шага симуляции, чтобы после него увидеть новые важные письма и уход денег в минус. */
  private markAdvance(s: GameState): AdvanceMark {
    return {
      mailNum: s.nextMailNum,
      wasNegative: s.finance.negativeDays > 0,
      models: s.models.length,
      research: s.research.done.length + s.research.algoLevel + s.research.contextLevel,
      contracts: s.contracts.length,
      goals: s.yearly.year * 100 + s.yearly.goals.filter((g) => g.done).length,
    };
  }

  /** Пауза по галочкам «Настроек»: модель обучена, исследование завершено, тендер выигран, цель выполнена. */
  private eventReason(s: GameState, mark: AdvanceMark): string | null {
    const set = getSettings();
    if (set.pauseOnReady && s.models.length > mark.models) return `Модель «${s.models[s.models.length - 1].name}» готова`;
    const research = s.research.done.length + s.research.algoLevel + s.research.contextLevel;
    if (set.pauseOnResearch && research > mark.research) return freshTitle(s, mark, 'Исследование завершено') ?? 'Исследование завершено';
    // Победы по авто-заявкам приходят сводкой раз в месяц и паузу не ставят: только тендер, выигранный по своей заявке.
    if (set.pauseOnTender && s.contracts.length > mark.contracts) {
      const won = freshTitle(s, mark, 'Тендер выигран');
      if (won) return won;
    }
    const goals = s.yearly.year * 100 + s.yearly.goals.filter((g) => g.done).length;
    if (set.pauseOnGoal && goals > mark.goals && goals % 100 > 0) return 'Цель года выполнена';
    // Готовая модель не выпущена: напоминание с паузой каждые READY_REMIND_DAYS дней (плейтест 17.10 - простояла 113 дней).
    if (set.pauseOnReady) {
      const idle = s.models.find((m) => m.releasedDay === null && s.day > m.trainedDay && (s.day - m.trainedDay) % READY_REMIND_DAYS === 0);
      if (idle) return `Модель «${idle.name}» готова ${s.day - idle.trainedDay} дн. и не выпущена`;
    }
    return null;
  }

  /** Причина, по которой после шага надо поставить паузу, или null. */
  private alertReason(s: GameState, mark: AdvanceMark): string | null {
    // Письма лежат по порядку номеров: новые - в хвосте списка.
    const fresh: string[] = [];
    for (let i = s.mail.length - 1; i >= 0; i--) {
      const m = s.mail[i];
      if (Number(m.id.slice(1)) < mark.mailNum) break;
      // «Модель готова» ставит паузу по своей галочке (eventReason), а не как важное письмо.
      if (m.important && !isReadyMail(m)) fresh.unshift(m.title);
    }
    if (fresh.length > 0) return fresh.length === 1 ? fresh[0] : `${fresh[0]} (и ещё ${fresh.length - 1})`;
    if (!mark.wasNegative && s.finance.negativeDays > 0) return 'Деньги ушли в минус';
    // Заранее, а не когда денег уже нет: не чаще раза в 30 дней.
    const runway = runwayMonths(s);
    if (runway !== null && runway < 1 && s.day - this.lowCashDay >= 30) {
      this.lowCashDay = s.day;
      return 'Денег хватит меньше чем на месяц: поднимите доходы, урежьте аренду или привлеките инвесторов';
    }
    return null;
  }

  private afterAdvance(mark?: AdvanceMark): void {
    const s = this.state;
    if (!s) return;
    if (s.flags.autosaveDue) {
      s.flags.autosaveDue = false;
      // Законченную игру не сохраняем поверх последнего живого автосохранения.
      if (!s.outcome) {
        this.autosaveError = writeSlot('auto', s) ? null : 'Автосохранение не удалось: хранилище браузера переполнено или недоступно.';
      }
    }
    if (s.outcome) {
      this.setSpeed(0);
    } else if (this.speed !== 0 && unseenReview(s)) {
      this.pauseReason = 'Итоги года';
      this.setSpeed(0); // окно итогов года показывается один раз; lastSpeed сохраняется
    } else if (this.speed !== 0 && goalOfferOpen(s)) {
      this.pauseReason = 'Цели года';
      this.setSpeed(0);
    } else if (mark && this.speed !== 0) {
      const reason = (getSettings().pauseOnImportant ? this.alertReason(s, mark) : null) ?? this.eventReason(s, mark);
      if (reason !== null) {
        this.pauseReason = reason;
        this.setSpeed(0); // lastSpeed сохраняется: пробел продолжит с прежней скоростью
      }
    }
    this.bump();
  }
}

/** Через сколько дней (и потом каждые столько же) напомнить о готовой, но не выпущенной модели. */
export const READY_REMIND_DAYS = 30;

interface AdvanceMark {
  /** Номер, который получит следующее письмо (s.nextMailNum до шага). */
  mailNum: number;
  /** Деньги уже были в минусе до шага. */
  wasNegative: boolean;
  /** Для пауз по галочкам: число обученных моделей, уровень исследований, контрактов, выполненных целей года. */
  models: number;
  research: number;
  contracts: number;
  goals: number;
}

/** Письмо «Модель «X» готова» (sim/training.ts). */
function isReadyMail(m: { kind: string; title: string }): boolean {
  return m.kind === 'training' && /^Модель «.*» готова$/.test(m.title);
}

/** Заголовок самого нового письма за шаг, который начинается с prefix (для подписи паузы). */
function freshTitle(s: GameState, mark: AdvanceMark, prefix: string): string | null {
  for (let i = s.mail.length - 1; i >= 0; i--) {
    const m = s.mail[i];
    if (Number(m.id.slice(1)) < mark.mailNum) break;
    if (m.title.startsWith(prefix)) return m.title;
  }
  return null;
}

export const store = new GameStore();

/** Текущее состояние; компонент перерисовывается на каждом тике и действии. */
export function useGame(): GameState | null {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}

export function useSpeed(): Speed {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.speed;
}

export { actions };
