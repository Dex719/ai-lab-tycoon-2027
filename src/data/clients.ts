// Вымышленные клиенты тендеров (FR-9). Совпадения с настоящими компаниями случайны.

import type { ClientDef } from '../sim/types';

export const CLIENTS: ClientDef[] = [
  { id: 'bank-severny', name: 'Банк «Северный»', industry: 'банк' },
  { id: 'retail-berezka', name: 'Ритейл «Берёзка Плюс»', industry: 'ритейл' },
  { id: 'air-zarya', name: 'Авиалинии «Заря»', industry: 'авиалинии' },
  { id: 'insure-nadezhny', name: 'Страховая «Надёжный Щит»', industry: 'страхование' },
  { id: 'clinic-zdravnitsa', name: 'Клиника «Здравница»', industry: 'медицина' },
  { id: 'law-pravda', name: 'Юристы «Правда и Ко»', industry: 'юристы' },
  { id: 'games-pixel-lis', name: 'Студия «Пиксельный Лис»', industry: 'игры' },
  { id: 'logistics-bystry', name: 'Логистика «Быстрый Путь»', industry: 'логистика' },
  { id: 'telecom-svyaztech', name: 'Телеком «Связьтех»', industry: 'телеком' },
  { id: 'gov-gosdostup', name: 'Портал «Госдоступ»', industry: 'госуслуги' },
  { id: 'market-torgovich', name: 'Маркетплейс «Торгович»', industry: 'маркетплейс' },
  { id: 'auto-ural', name: 'Автозавод «Уральский Двигатель»', industry: 'автопроизводитель' },
  { id: 'energy-svetlograd', name: 'Энергосбыт «Светлоград»', industry: 'энергетика' },
  { id: 'edu-novaya-shkola', name: 'Университет «Новая Школа»', industry: 'образование' },
  { id: 'pharma-biomedika', name: 'Фарма «БиоМедика»', industry: 'фармацевтика' },
  { id: 'hotels-zolotoy-bereg', name: 'Гостиницы «Золотой Берег»', industry: 'гостиницы и туризм' },
  { id: 'build-opora', name: 'Стройгрупп «Опора»', industry: 'строительство' },
  { id: 'media-efir', name: 'Медиа «Эфир-24»', industry: 'медиа' },
  { id: 'agro-kolos', name: 'Агрохолдинг «Колос»', industry: 'сельское хозяйство' },
  { id: 'taxi-poputchik', name: 'Такси «Попутчик»', industry: 'транспорт' },
];
