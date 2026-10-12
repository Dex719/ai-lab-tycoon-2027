// Настройки игрока (хранятся в браузере, не в сохранении партии).

export interface Settings {
  pauseOnImportant: boolean; // пауза, когда приходит важное письмо
  pauseOnHidden: boolean; // пауза, когда вкладка браузера скрыта
  toasts: boolean; // всплывающие уведомления о новых письмах
  realNames: boolean; // показывать настоящие названия компаний, моделей и тестов
}

const KEY = 'ailab.settings';
const DEFAULTS: Settings = { pauseOnImportant: true, pauseOnHidden: true, toasts: true, realNames: false };

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
