// «Аналитика» с вкладками, как в Processor Tycoon. Временная сборка из прежних окон — переделывается в волне B.

import { useState } from 'react';
import type { WindowProps } from '.';
import { Tabs } from '../components/common';
import FinanceWindow from './FinanceWindow';
import MarketWindow from './MarketWindow';
import RatingsWindow from './RatingsWindow';

type Tab = 'market' | 'ratings' | 'finance';

export default function AnalyticsWindow(props: WindowProps) {
  const [tab, setTab] = useState<Tab>('market');
  return (
    <>
      <Tabs
        tabs={[
          { id: 'market', label: 'Рынок' },
          { id: 'ratings', label: 'Рейтинги' },
          { id: 'finance', label: 'Финансы' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'market' && <MarketWindow {...props} />}
      {tab === 'ratings' && <RatingsWindow {...props} />}
      {tab === 'finance' && <FinanceWindow {...props} />}
    </>
  );
}
