// Страница для проверки иконок: сетка со всеми значками и их названиями на цвете рабочего стола.

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { IconProps, LineIconProps } from './base';
import {
  IconAnalytics,
  IconCompute,
  IconContracts,
  IconDatacenters,
  IconInvestors,
  IconLogo,
  IconMail,
  IconModels,
  IconNewModel,
  IconResearch,
  IconSafety,
  IconTeam,
} from './desktop';
import {
  IconAlert,
  IconArrowUpDown,
  IconBank,
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFast,
  IconFaster,
  IconInfo,
  IconLock,
  IconPause,
  IconPlay,
  IconSave,
  IconTrash,
  IconTrophy,
} from './line';

const DESK = '#3a3d42';
const BAR = '#1c1c1e';
const WIN = '#e9eaed';

const DESKTOP: [string, ComponentType<IconProps>][] = [
  ['IconResearch', IconResearch],
  ['IconCompute', IconCompute],
  ['IconNewModel', IconNewModel],
  ['IconContracts', IconContracts],
  ['IconInvestors', IconInvestors],
  ['IconModels', IconModels],
  ['IconMail', IconMail],
  ['IconAnalytics', IconAnalytics],
  ['IconDatacenters', IconDatacenters],
  ['IconTeam', IconTeam],
  ['IconSafety', IconSafety],
  ['IconLogo', IconLogo],
];

const LINE: [string, ComponentType<LineIconProps>][] = [
  ['IconBank', IconBank],
  ['IconCalendar', IconCalendar],
  ['IconPause', IconPause],
  ['IconPlay', IconPlay],
  ['IconFast', IconFast],
  ['IconFaster', IconFaster],
  ['IconClose', IconClose],
  ['IconChevronLeft', IconChevronLeft],
  ['IconChevronRight', IconChevronRight],
  ['IconCheck', IconCheck],
  ['IconLock', IconLock],
  ['IconArrowUpDown', IconArrowUpDown],
  ['IconSave', IconSave],
  ['IconTrash', IconTrash],
  ['IconTrophy', IconTrophy],
  ['IconAlert', IconAlert],
  ['IconInfo', IconInfo],
];

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 };
const cell: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 4px', borderRadius: 3 };
const caption: CSSProperties = { fontSize: 12, color: '#b5b8be', textAlign: 'center' };
const heading: CSSProperties = { margin: '28px 0 12px', fontSize: 15, fontWeight: 500, color: '#f2f2f2' };

function Section({ title, children, min = 120 }: { title: string; children: ReactNode; min?: number }) {
  return (
    <section>
      <h2 style={heading}>{title}</h2>
      <div style={{ ...grid, gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>{children}</div>
    </section>
  );
}

function Cell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={cell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 56 }}>{children}</div>
      <div style={caption}>{name}</div>
    </div>
  );
}

/** Мелкая иконка на двух фонах: тёмная панель и светлое окно, плюс увеличенный вид. */
function LineCell({ name, Icon }: { name: string; Icon: ComponentType<LineIconProps> }) {
  const chip: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 32, borderRadius: 2 };
  return (
    <Cell name={name}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ ...chip, background: BAR, color: '#f2f2f2' }}>
          <Icon />
        </div>
        <div style={{ ...chip, background: WIN, color: '#1f2023' }}>
          <Icon />
        </div>
        <div style={{ ...chip, width: 44, color: '#f2f2f2' }}>
          <Icon size={36} />
        </div>
      </div>
    </Cell>
  );
}

export function IconGallery() {
  return (
    <div style={{ background: DESK, color: '#f2f2f2', minHeight: '100%', padding: '8px 24px 32px', fontFamily: '"Segoe UI", Roboto, Arial, sans-serif' }}>
      <h1 style={{ margin: '16px 0 0', fontSize: 20, fontWeight: 500 }}>Иконки</h1>

      <Section title="Рабочий стол, 56 px">
        {DESKTOP.map(([name, Icon]) => (
          <Cell key={name} name={name}>
            <span style={{ color: '#666a71', display: 'flex' }}>
              <Icon size={56} />
            </span>
          </Cell>
        ))}
      </Section>

      <Section title="Недоступные разделы, 56 px">
        {DESKTOP.filter(([name]) => name !== 'IconLogo').map(([name, Icon]) => (
          <Cell key={name} name={name}>
            <Icon size={56} disabled />
          </Cell>
        ))}
      </Section>

      <Section title="Логотип" min={200}>
        <Cell name="Центр рабочего стола, 160 px">
          <span style={{ color: '#666a71', display: 'flex' }}>
            <IconLogo size={160} />
          </span>
        </Cell>
        <Cell name="Панель задач, 26 px">
          <span style={{ background: BAR, color: '#f2f2f2', display: 'flex', padding: 6, borderRadius: 2 }}>
            <IconLogo size={26} />
          </span>
        </Cell>
      </Section>

      <Section title="Значки интерфейса: тёмная панель, светлое окно, 36 px" min={190}>
        {LINE.map(([name, Icon]) => (
          <LineCell key={name} name={name} Icon={Icon} />
        ))}
      </Section>
    </div>
  );
}
