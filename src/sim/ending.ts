// Конец партии (идеи «Люди и сюжет» и «Режимы», 18.10): счёт партии с расшифровкой, заголовок концовки по стилю игры
// и эпилог «что стало с людьми». Только чтение состояния: итоговое окно (ui/EndDialog) и таблица лучших партий.

import { STARTUPS } from '../data/deals';
import { LABS } from '../data/labs';
import { challengeScoreMult } from './challenges';
import { LAB_HEADS } from './duel';
import { valuation } from './investors';
import { labGone } from './rivals';
import { ruPlural } from './text';
import type { GameState } from './types';

export interface ScorePart {
  label: string;
  value: number;
}

export interface PartyScore {
  total: number;
  parts: ScorePart[];
  /** Множитель сложности (Лёгкая 0,8, Обычная 1, Сложная 1,3) × испытания и условия мира. */
  mult: number;
}

const DIFF_MULT = { easy: 0.8, normal: 1, hard: 1.3 } as const;

/**
 * Очки за долю основателя: 8 за каждый процент. Стоимость доли идёт в счёт по логарифму, и продажа 92 % компании стоила
 * всего ~40 очков: «сильный» бот с долей 8 % набирал 2 200 против 1 600-1 900 у «разумного» с 43 % (QA 19.10). С этой
 * частью первое место на чужие деньги и второе со своей лабораторией идут почти вровень.
 */
export const CONTROL_POINTS_PER_PCT = 8;

function placePoints(place: number | null): number {
  if (place === null) return 0;
  if (place === 1) return 1000;
  if (place === 2) return 700;
  if (place === 3) return 550;
  if (place <= 5) return 400;
  if (place <= 10) return 250;
  return 100;
}

/** Место на конец партии: последний закрытый месяц (null - соперники ещё не продавали модели или банкротство). */
export function finalPlace(s: GameState): number | null {
  if (s.outcome === 'bankrupt') return null;
  return s.finance.history.at(-1)?.placeEnd ?? null;
}

/** Честная игра: ни одной раскрытой подгонки и ни одного иска за чужие данные. */
export function playedClean(s: GameState): boolean {
  return !s.models.some((m) => m.exposed || m.stolenCaught);
}

/** Счёт партии: место, месяцы на 1-м месте, ваша часть компании, честность; × множитель сложности. */
export function partyScore(s: GameState): PartyScore {
  const place = finalPlace(s);
  let part = 0;
  try {
    part = valuation(s).total * s.founderShare;
  } catch {
    part = 0;
  }
  const parts: ScorePart[] = [
    { label: place !== null ? `${place}-е место в конце` : 'Места в конце нет', value: placePoints(place) },
    { label: `Месяцев на 1-м месте: ${s.monthsFirst}`, value: s.monthsFirst * 15 },
    { label: 'Ваша часть компании', value: s.outcome === 'bankrupt' ? 0 : Math.round(100 * Math.log10(Math.max(1, part / 1e6))) },
    {
      label: `Контроль над лабораторией: ${Math.round(s.founderShare * 100)} %`,
      value: s.outcome === 'bankrupt' ? 0 : Math.round(CONTROL_POINTS_PER_PCT * s.founderShare * 100),
    },
    { label: 'Честная игра', value: playedClean(s) && s.models.some((m) => m.releasedDay !== null) ? 100 : 0 },
  ];
  // Сложность и испытания с условиями мира (sim/challenges.ts): трудное повышает счёт, лёгкое снижает.
  const mult = Math.round((DIFF_MULT[s.difficulty] ?? 1) * challengeScoreMult(s) * 100) / 100;
  const total = Math.round(parts.reduce((a, p) => a + p.value, 0) * mult);
  return { total, parts, mult };
}

export interface Ending {
  title: string;
  text: string;
}

/** Заголовок концовки: что за лаборатория получилась (у разных стилей игры - разный финал). */
export function endingOf(s: GameState): Ending {
  const place = finalPlace(s);
  const share = s.founderShare;
  if (s.outcome === 'bankrupt') return { title: 'Закрытая лаборатория', text: 'Деньги кончились раньше, чем модели начали окупаться.' };
  if (s.outcome === 'victory' && share >= 0.5) return { title: 'Лидер гонки', text: 'Лучшая модель в мире - ваша, и решения в компании тоже принимаете вы.' };
  if (s.outcome === 'victory') return { title: 'Победа на чужие деньги', text: 'Лучшая модель - ваша, но большая часть компании уже у инвесторов.' };
  if (share < 0.25) return { title: 'Компанию забрал совет', text: 'Инвесторы владеют почти всей лабораторией и решают, куда она пойдёт дальше.' };
  if (place !== null && place <= 3 && playedClean(s) && s.reputation >= 70) {
    return { title: 'Честная лаборатория', text: 'Не первые, но без подгонки и исков: такой лаборатории доверяют.' };
  }
  if (place === 2) return { title: 'Тихая вторая', text: 'До первого места не хватило немного. Следующая модель может всё решить.' };
  if (place !== null && place <= 5) return { title: 'В числе лидеров', text: 'Лаборатория в первой пятёрке мира.' };
  return { title: 'Одна из многих', text: 'Лаборатория выжила, но гонку ведут другие.' };
}

/** Эпилог: 3-6 строк о людях и мире к концу партии. */
export function epilogueOf(s: GameState): string[] {
  const out: string[] = [];
  const share = s.founderShare;
  const founder = s.founderName.trim() || 'Основатель';
  out.push(
    share >= 0.5
      ? `${founder} сохраняет контроль над компанией: доля ${Math.round(share * 100)} %.`
      : share >= 0.25
        ? `${founder} делит решения с советом директоров: доля ${Math.round(share * 100)} %.`
        : `${founder} владеет ${Math.round(share * 100)} % компании, решения принимает совет инвесторов.`,
  );
  const staff = s.staff?.people.filter((e) => e.startDay <= s.day).length ?? 0;
  if (staff > 0) out.push(`В штате ${staff} ${ruPlural(staff, 'человек', 'человека', 'человек')} кроме основателей.`);
  const main = s.duel?.main;
  if (main) {
    const lab = LABS.find((l) => l.id === main)?.name ?? main;
    const d = s.duel!.labs[main];
    const head = LAB_HEADS[main].split(',')[0];
    out.push(
      d.youPassed >= d.passedYou
        ? `${head} из ${lab}, ваш главный соперник, признаёт: в этой гонке вы обходили их чаще (${d.youPassed} против ${d.passedYou}).`
        : `${head} из ${lab}, ваш главный соперник, обходил вас чаще (${d.passedYou} против ${d.youPassed}) и уже готовит следующую модель.`,
    );
  }
  const gone = LABS.filter((l) => l.exit && labGone(s, l.id));
  const bought = gone.filter((l) => s.late?.startups.some((d) => d.status === 'bought' && STARTUPS.find((x) => x.id === d.id)?.lab === l.id));
  if (bought.length > 0) out.push(`Команды ${bought.map((l) => l.name).join(' и ')} работают у вас.`);
  else if (gone.length > 0) out.push(`${gone.map((l) => l.name).join(' и ')} ушли с рынка: их команды забрали корпорации.`);
  const stolen = s.models.filter((m) => m.plan.stolenData).length;
  const suits = s.models.filter((m) => m.stolenCaught).length;
  if (stolen > 0) out.push(suits > 0 ? `Моделей на чужих данных: ${stolen}, исков: ${suits}.` : `Моделей на чужих данных: ${stolen}, ни одного иска.`);
  const exposed = s.models.filter((m) => m.exposed).length;
  if (exposed > 0) out.push(`Раскрытых подгонок под тесты: ${exposed}.`);
  return out.slice(0, 6);
}
