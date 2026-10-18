// Сделки поздней игры (окно «Сделки», sim/deals.ts): звёздные команды, стартапы на продажу, облачные партнёры.
// Компании названы по правилу игры: настоящее название с изменённой парой букв (словарь - data/realNames.ts).
// Люди в командах вымышленные.

import type { CloudId, StartupId, TeamId } from '../sim/lateState';
import type { LabId, SegmentId } from '../sim/types';

/** С этого дня открыты сделки (окно «Сделки» на рабочем столе). */
export const DEALS_FROM = '2023-01-01';

// ---------- Звёздные команды ----------

export interface TeamDef {
  id: TeamId;
  name: string; // «Команда обучения»
  leader: string; // вымышленный руководитель
  initials: string; // для значка
  color: string;
  about: string; // одна строка: откуда и чем сильна
  effect: string; // что даёт, коротко
  extra?: string; // второе следствие, мелко
  signing: number; // подъёмные при найме, $
  salary: number; // зарплата команды в месяц, $
}

/** Больше двух команд лаборатория не удержит: столько руководителей направлений. */
export const MAX_TEAMS = 2;
/** Удержать команду, которую переманивает соперник: столько месяцев зарплаты. */
export const TEAM_RETAIN_MONTHS = 6;

export const TEAMS: readonly TeamDef[] = [
  {
    id: 'training',
    name: 'Команда обучения',
    leader: 'Вера Орлова',
    initials: 'ВО',
    color: '#2f80e4',
    about: 'Инженеры распределённого обучения: запускали кластеры на десятки тысяч карт.',
    effect: 'Обучение быстрее на 25 %',
    signing: 40e6,
    salary: 3e6,
  },
  {
    id: 'research',
    name: 'Команда исследований',
    leader: 'Самуэль Окафор',
    initials: 'СО',
    color: '#7b5cd6',
    about: 'Авторы работ по архитектуре и оптимизации, которые цитирует вся отрасль.',
    effect: 'Исследования дешевле на 30 %',
    signing: 30e6,
    salary: 2.5e6,
  },
  {
    id: 'posttrain',
    name: 'Команда дообучения',
    leader: 'Лин Вэй',
    initials: 'ЛВ',
    color: '#1fa8a0',
    about: 'Специалисты по RLHF и оценке ответов: делали чат-модели, которые любят пользователи.',
    effect: '+8 Эло новым моделям с RLHF',
    extra: 'Доработка моделей в финальном квартале сильнее в 1,5 раза.',
    signing: 50e6,
    salary: 4e6,
  },
];

export function teamDef(id: TeamId): TeamDef {
  const def = TEAMS.find((t) => t.id === id);
  if (!def) throw new Error(`Нет команды ${id}`);
  return def;
}

// ---------- Стартапы ----------

export type StartupEffect =
  | { kind: 'trainSpeed' } // обучение быстрее (lateState.STARTUP_TRAIN_SPEED)
  | { kind: 'segBrand'; seg: SegmentId; add: number } // бренд игрока в сегменте навсегда
  | { kind: 'algo'; levels: number } // уровни «Алгоритмических улучшений» сразу
  | { kind: 'rlhfElo' }; // прибавка Эло новым моделям с RLHF (lateState.STARTUP_RLHF_ELO)

export interface StartupDef {
  id: StartupId;
  name: string; // игровое название
  what: string; // чем занимается, со строчной буквы
  effect: string; // что получит лаборатория
  apply: StartupEffect;
  price: number; // $
  from: string; // день, когда стартап выставлен на продажу
  rival: LabId; // кто купит, если не купить
  /** Стартап - промежуточная лаборатория-соперник (data/labs.ts): после покупки она уходит с рынка. */
  lab?: LabId;
}

/** Сколько дней стартап ждёт покупателя, прежде чем его купит соперник. */
export const OFFER_DAYS = 45;
/** Шумиха соперника, который купил стартап. */
export const RIVAL_BUY_HYPE = 10;

export const STARTUPS: readonly StartupDef[] = [
  {
    id: 'mozaic',
    name: 'MozaicML',
    what: 'платформа для дешёвого обучения больших моделей',
    effect: 'Обучение быстрее на 10 %',
    apply: { kind: 'trainSpeed' },
    price: 130e6,
    from: '2023-03-01',
    rival: 'alibabo',
  },
  {
    id: 'kodeium',
    name: 'Kodeium',
    what: 'помощник программиста в редакторе кода',
    effect: 'Бренд у разработчиков +0,25',
    apply: { kind: 'segBrand', seg: 'developers', add: 0.25 },
    price: 90e6,
    from: '2023-07-01',
    rival: 'openbrain',
  },
  {
    id: 'charakter',
    name: 'Charakter.AI',
    what: 'чат с персонажами, миллионы пользователей',
    effect: 'Бренд у обычных пользователей +0,25',
    apply: { kind: 'segBrand', seg: 'consumers', add: 0.25 },
    price: 150e6,
    // Срок предложения кончается 02.08.2024 - в этот день Gogle забирает основателей (как Google и Character.AI).
    from: '2024-06-18',
    rival: 'gogle',
    lab: 'charakter',
  },
  {
    id: 'inflexion',
    name: 'Infleksion',
    what: 'сильная исследовательская команда и свой чат',
    effect: '+1 уровень «Алгоритмических улучшений»',
    apply: { kind: 'algo', levels: 1 },
    price: 300e6,
    // Срок предложения кончается 19.03.2024 - в этот день команду переманивает Mikrosoft, партнёр OpenBrain.
    from: '2024-02-03',
    rival: 'openbrain',
    lab: 'infleksion',
  },
  {
    id: 'adapt',
    name: 'Adapt AI',
    what: 'агенты, которые работают в программах компаний',
    effect: 'Бренд у корпоративных клиентов +0,25',
    apply: { kind: 'segBrand', seg: 'enterprise', add: 0.25 },
    price: 120e6,
    from: '2024-06-01',
    rival: 'antropik',
  },
  {
    id: 'skale',
    name: 'Skale AI',
    what: 'разметка данных и оценка ответов моделей',
    effect: '+5 Эло новым моделям с RLHF',
    apply: { kind: 'rlhfElo' },
    price: 250e6,
    from: '2024-08-01',
    rival: 'gogle',
  },
];

export function startupDef(id: StartupId): StartupDef {
  const def = STARTUPS.find((t) => t.id === id);
  if (!def) throw new Error(`Нет стартапа ${id}`);
  return def;
}

// ---------- Облачные партнёры ----------

export interface CloudDef {
  id: CloudId;
  name: string;
  months: number; // срок сделки
  discount: number; // аренда дешевле на эту долю
  capMult: number; // лимит аренды ×
  commit: number; // обязательный платёж: доля аренды прошлого месяца
  minMonthly: number; // но не меньше, $ в месяц
}

/** При расторжении платится такая доля оставшихся обязательных платежей. */
export const CLOUD_EXIT_SHARE = 0.5;

export const CLOUDS: readonly CloudDef[] = [
  { id: 'azura', name: 'Mikrosoft Azura', months: 24, discount: 0.2, capMult: 1.5, commit: 1, minMonthly: 20e6 },
  { id: 'awz', name: 'Amazom AWZ', months: 18, discount: 0.12, capMult: 1.3, commit: 0.7, minMonthly: 12e6 },
  { id: 'orakle', name: 'Orakle Cloud', months: 12, discount: 0.08, capMult: 1.15, commit: 0.5, minMonthly: 6e6 },
];

export function cloudDef(id: CloudId): CloudDef {
  const def = CLOUDS.find((t) => t.id === id);
  if (!def) throw new Error(`Нет облачного партнёра ${id}`);
  return def;
}
