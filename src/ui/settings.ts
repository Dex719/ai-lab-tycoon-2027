// Настройки игрока (хранятся в браузере, не в сохранении партии).

export interface Settings {
  pauseOnImportant: boolean; // пауза, когда приходит важное письмо
  pauseOnReady: boolean; // пауза, когда модель обучена
  pauseOnResearch: boolean; // пауза, когда исследование завершено
  pauseOnTender: boolean; // пауза, когда выигран тендер
  pauseOnGoal: boolean; // пауза, когда выполнена цель года
  pauseOnHidden: boolean; // пауза, когда вкладка браузера скрыта
  toasts: boolean; // всплывающие уведомления о новых письмах
  realNames: boolean; // показывать настоящие названия компаний, моделей и тестов
  volume: number; // громкость звуков 0..1, 0 - без звука
}

const KEY = 'ailab.settings';
const DEFAULTS: Settings = {
  pauseOnImportant: true,
  pauseOnReady: true,
  pauseOnResearch: false,
  pauseOnTender: false,
  pauseOnGoal: false,
  pauseOnHidden: true,
  toasts: true,
  realNames: false,
  volume: 0.5,
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // настройки останутся только до перезагрузки
  }
  return cache;
}
