import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { applyChoice, pendingChoice } from './events';
import { deserialize, serialize } from './save';
import {
  fireEmployee,
  hireCandidate,
  promoteEmployee,
  READY_QUIT_DAYS,
  RETAIN_MONTHS,
  STAFF_POACH_ID,
  staffDay,
  staffOf,
  staffSeats,
  startPoach,
  trainEmployee,
  courseCost,
  courseDays,
  courseBlock,
  COURSE_COOLDOWN,
  COURSE_DAYS,
} from './staff';
import { ROLE_INFO, rolePoints, staffEffect, type Employee } from './staffEffects';
import { isMonthStart } from './time';
import type { GameState } from './types';

function game(): GameState {
  return newGame('Тест', 7);
}

function employee(over: Partial<Employee> = {}): Employee {
  return { id: 'e1', name: 'Анна Соколова', role: 'research', level: 0, xp: 0, salary: 3_000, trait: null, startDay: 0, readyDay: null, ...over };
}

/** Прожить n дней: только дневная часть команды (зарплаты, окончание курсов, месячные дела 1-го числа). */
function runDays(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    s.day++;
    staffDay(s);
  }
}

/** До начала следующего месяца (staffDay делает месячную часть 1-го числа). */
function toMonthStart(s: GameState): void {
  do s.day++;
  while (!isMonthStart(s.day));
}

describe('команда: кандидаты и найм', () => {
  it('в новой игре сразу есть кандидаты разных ролей; найм выводит на работу через несколько дней', () => {
    const s = game();
    const st = staffOf(s);
    expect(st.candidates.length).toBe(4);
    expect(new Set(st.candidates.map((c) => c.role)).size).toBeGreaterThanOrEqual(3);
    const c = st.candidates[0];
    expect(hireCandidate(s, c.id)).toEqual({ ok: true });
    expect(st.candidates.some((x) => x.id === c.id)).toBe(false);
    const e = st.people[0];
    expect(e.startDay).toBe(s.day + c.wait);
    expect(rolePoints(s, e.role)).toBe(0); // ещё не вышел
    s.day = e.startDay;
    expect(rolePoints(s, e.role)).toBeGreaterThan(0);
  });

  it('мест не больше, чем позволяет этап: в гараже 4', () => {
    const s = game();
    const st = staffOf(s);
    expect(staffSeats(s)).toBe(4);
    st.people = [1, 2, 3, 4].map((i) => employee({ id: `e${i}` }));
    const r = hireCandidate(s, st.candidates[0].id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Мест нет: 4 из 4/);
  });

  it('«просит долю»: доля основателя уменьшается на 0,2 %', () => {
    const s = game();
    const st = staffOf(s);
    st.candidates[0].trait = 'equity';
    hireCandidate(s, st.candidates[0].id);
    expect(s.founderShare).toBeCloseTo(0.998, 9);
  });

  it('кандидаты меняются в начале месяца', () => {
    const s = game();
    const before = staffOf(s).candidates.map((c) => c.id).join();
    toMonthStart(s);
    staffDay(s);
    expect(staffOf(s).candidates.map((c) => c.id).join()).not.toBe(before);
  });
});

describe('команда: зарплаты, увольнение, опыт', () => {
  it('зарплата списывается каждый день работы, до выхода - нет', () => {
    const s = game();
    staffOf(s).people = [employee({ salary: 3_000, startDay: 10 })];
    s.day = 5;
    const c0 = s.cash;
    staffDay(s);
    expect(s.cash).toBe(c0);
    s.day = 10;
    staffDay(s);
    expect(c0 - s.cash).toBeCloseTo(100, 6);
  });

  it('увольнение: выходное пособие - месячная зарплата', () => {
    const s = game();
    staffOf(s).people = [employee({ salary: 6_000 })];
    const c0 = s.cash;
    expect(fireEmployee(s, 'e1')).toEqual({ ok: true });
    expect(c0 - s.cash).toBe(6_000);
    expect(staffOf(s).people).toHaveLength(0);
  });

  it('джуниор за 12 месяцев готов к повышению; повышение поднимает уровень и зарплату; без опыта - отказ', () => {
    const s = game();
    staffOf(s).people = [employee()];
    expect(promoteEmployee(s, 'e1').ok).toBe(false);
    for (let i = 0; i < 12; i++) {
      toMonthStart(s);
      staffDay(s);
    }
    const e = staffOf(s).people[0];
    expect(e.xp).toBe(1);
    expect(e.readyDay).not.toBeNull();
    expect(s.mail.some((m) => m.title === 'Можно повысить: Анна Соколова')).toBe(true);
    const salary = e.salary;
    expect(promoteEmployee(s, 'e1')).toEqual({ ok: true });
    expect(e.level).toBe(1);
    expect(e.salary).toBeGreaterThan(salary);
    expect(e.xp).toBe(0);
  });

  it('не повышенный дольше срока уходит, приходит важное письмо', () => {
    const s = game();
    staffOf(s).people = [employee({ xp: 1, readyDay: 0 })];
    while (s.day < READY_QUIT_DAYS + 31) {
      toMonthStart(s);
      staffDay(s);
    }
    expect(staffOf(s).people).toHaveLength(0);
    const m = s.mail.find((x) => x.title === 'Из команды ушли: Анна Соколова');
    expect(m?.important).toBe(true);
  });
});

describe('команда: эффекты', () => {
  it('без сотрудников эффекта нет; с ростом команды эффект растёт и не выходит за предел роли', () => {
    const s = game();
    expect(staffEffect(s, 'research')).toBe(0);
    staffOf(s).people = [employee()];
    const one = staffEffect(s, 'research');
    staffOf(s).people = Array.from({ length: 40 }, (_, i) => employee({ id: `e${i}`, level: 3 }));
    const many = staffEffect(s, 'research');
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(ROLE_INFO.research.cap);
  });
});

describe('команда: переманивание', () => {
  it('удержать: премия в 4 зарплаты, год не переманивают', () => {
    const s = game();
    staffOf(s).people = [employee({ level: 2, salary: 12_000 })];
    startPoach(s, 'e1', 'OpenBrain');
    const mail = pendingChoice(s);
    expect(mail?.eventId).toBe(STAFF_POACH_ID);
    const c0 = s.cash;
    applyChoice(s, mail!.id, 0);
    expect(c0 - s.cash).toBe(12_000 * RETAIN_MONTHS);
    const e = staffOf(s).people[0];
    expect(e.retainedUntil).toBe(s.day + 365);
    expect(staffOf(s).poach).toBeNull();
  });

  it('отпустить: сотрудник уходит', () => {
    const s = game();
    staffOf(s).people = [employee({ level: 3, salary: 21_000 })];
    startPoach(s, 'e1', 'Antropik');
    const mail = pendingChoice(s)!;
    applyChoice(s, mail.id, 1);
    expect(staffOf(s).people).toHaveLength(0);
  });
});

describe('команда: сохранение', () => {
  it('сотрудники и кандидаты проходят сохранение и загрузку без потерь; старое сохранение без команды загружается', () => {
    const s = game();
    hireCandidate(s, staffOf(s).candidates[0].id);
    staffOf(s).people[0].retainedUntil = 400;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.state)).toBe(serialize(s));
    const o = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete o.staff;
    const old = deserialize(JSON.stringify(o));
    expect(old.ok).toBe(true);
    if (old.ok) expect(staffOf(old.state).people).toEqual([]);
  });
});

describe('команда: переманивание не раскрывает будущее', () => {
  it('пока соперники не выпустили моделей, переманивают только OpenBrain и Gogle DeepMynd', () => {
    const s = game();
    s.rivalsReleased = [];
    staffOf(s).people = Array.from({ length: 30 }, (_, i) => employee({ id: `e${i}`, level: 2, salary: 28_000 }));
    for (let m = 0; m < 24 && !staffOf(s).poach; m++) {
      toMonthStart(s);
      staffDay(s);
    }
    expect(staffOf(s).poach).not.toBeNull();
    expect(['OpenBrain', 'Gogle DeepMynd']).toContain(staffOf(s).poach!.lab);
  });
});


describe('команда: потенциал и прокачка', () => {
  it('низкий потенциал: потолок - мидл, на потолке опыт не растёт и уход не грозит', () => {
    const s = game();
    staffOf(s).people = [employee({ level: 1, potential: 'low' })];
    for (let i = 0; i < 30; i++) {
      toMonthStart(s);
      staffDay(s);
    }
    const e = staffOf(s).people[0];
    expect(e.xp).toBe(0);
    expect(e.readyDay).toBeNull();
    expect(trainEmployee(s, 'e1').ok).toBe(false);
    expect(promoteEmployee(s, 'e1').ok).toBe(false);
  });

  it('курс: две зарплаты при старте, опыт по потенциалу после окончания (высокий - больше, низкий - меньше), повтор не раньше чем через 90 дней', () => {
    const s = game();
    staffOf(s).people = [employee({ id: 'h', potential: 'high', salary: 10_000 }), employee({ id: 'l', potential: 'low', salary: 10_000 })];
    const c0 = s.cash;
    expect(trainEmployee(s, 'h')).toEqual({ ok: true });
    expect(trainEmployee(s, 'l')).toEqual({ ok: true });
    expect(c0 - s.cash).toBe(2 * courseCost(staffOf(s).people[0]));
    const [h, l] = staffOf(s).people;
    expect(h.xp).toBe(0);
    runDays(s, COURSE_DAYS[0]);
    expect(h.xp).toBeGreaterThan(l.xp);
    expect(h.xp).toBeCloseTo(0.525, 9);
    expect(l.xp).toBeCloseTo(0.175, 9);
    const again = trainEmployee(s, 'h');
    expect(again.ok).toBe(false);
    s.day = (h.lastCourseDay ?? 0) + COURSE_COOLDOWN;
    expect(trainEmployee(s, 'h').ok).toBe(true);
  });

  it('высокий потенциал растёт быстрее среднего и дорастает до ведущего', () => {
    const s = game();
    staffOf(s).people = [employee({ id: 'h', potential: 'high' }), employee({ id: 'm', potential: 'mid' })];
    for (let i = 0; i < 9; i++) {
      toMonthStart(s);
      staffDay(s);
    }
    const [h, m] = staffOf(s).people;
    expect(h.xp).toBeGreaterThan(m.xp);
    h.level = 2;
    h.xp = 1;
    expect(promoteEmployee(s, 'h')).toEqual({ ok: true });
    expect(h.level).toBe(3);
  });
});

describe('команда: обучение занимает время', () => {
  it('старт: деньги сразу, сотрудник уходит на курс на срок по уровню, опыта сразу не прибавляется', () => {
    const s = game();
    staffOf(s).people = [employee({ id: 'j', level: 0 }), employee({ id: 'm', level: 1 }), employee({ id: 's', level: 2, potential: 'high' })];
    const cash = s.cash;
    for (const id of ['j', 'm', 's']) expect(trainEmployee(s, id).ok).toBe(true);
    expect(s.cash).toBeLessThan(cash);
    const [j, m, sn] = staffOf(s).people;
    expect(j.course).toEqual({ startDay: s.day, endDay: s.day + COURSE_DAYS[0], xp: expect.any(Number) });
    expect(courseDays(j)).toBeLessThan(courseDays(m));
    expect(courseDays(m)).toBeLessThan(courseDays(sn));
    expect(j.xp).toBe(0);
  });

  it('пока идёт курс, повторно отправить нельзя - причина с датой окончания', () => {
    const s = game();
    staffOf(s).people = [employee()];
    trainEmployee(s, 'e1');
    const r = trainEmployee(s, 'e1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Уже на обучении до /);
    expect(courseBlock(s, staffOf(s).people[0])).toMatch(/на обучении/);
  });

  it('во время курса вклада в роль нет, после окончания вклад возвращается', () => {
    const s = game();
    staffOf(s).people = [employee({ role: 'training' })];
    const before = staffEffect(s, 'training');
    expect(before).toBeGreaterThan(0);
    trainEmployee(s, 'e1');
    expect(rolePoints(s, 'training')).toBe(0);
    expect(staffEffect(s, 'training')).toBe(0);
    runDays(s, COURSE_DAYS[0]);
    expect(rolePoints(s, 'training')).toBeGreaterThan(0);
  });

  it('курс кончается ровно в срок: опыт прибавляется, курс снимается, приходит письмо; опыт от работы на курсе не копится', () => {
    const s = game();
    staffOf(s).people = [employee()];
    trainEmployee(s, 'e1');
    const e = staffOf(s).people[0];
    runDays(s, COURSE_DAYS[0] - 1);
    expect(e.course).toBeTruthy();
    expect(e.xp).toBe(0);
    const mails = s.mail.length;
    runDays(s, 1);
    expect(e.course).toBeNull();
    expect(e.xp).toBeCloseTo(0.35, 9);
    expect(s.mail.length).toBe(mails + 1);
    expect(s.mail.some((m) => m.title === `Курс пройден: ${e.name}`)).toBe(true);
  });

  it('курс, который добирает опыт до 1, делает сотрудника готовым к повышению', () => {
    const s = game();
    staffOf(s).people = [employee({ xp: 0.9 })];
    trainEmployee(s, 'e1');
    runDays(s, COURSE_DAYS[0]);
    const e = staffOf(s).people[0];
    expect(e.xp).toBe(1);
    expect(e.readyDay).toBe(s.day);
    expect(promoteEmployee(s, 'e1').ok).toBe(true);
  });

  it('курс проходит сохранение; старое сохранение без поля курса загружается, сотрудник не на курсе', () => {
    const s = game();
    staffOf(s).people = [employee(), employee({ id: 'e2', name: 'Дмитрий Ким' })];
    trainEmployee(s, 'e1');
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(staffOf(r.state).people[0].course).toEqual(staffOf(s).people[0].course);
    const o = JSON.parse(serialize(s)) as { staff: { people: Record<string, unknown>[] } };
    for (const p of o.staff.people) delete p.course;
    const old = deserialize(JSON.stringify(o));
    expect(old.ok).toBe(true);
    if (old.ok) {
      const e = staffOf(old.state).people[0];
      expect(e.course).toBeUndefined();
      expect(rolePoints(old.state, 'research')).toBeGreaterThan(0);
      expect(courseBlock(old.state, e)).toMatch(/Следующий курс/);
    }
  });
});
