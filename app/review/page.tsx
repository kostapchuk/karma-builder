'use client';

import Link from 'next/link';
import { useState } from 'react';

import { DeedList } from '@/components/DeedList';
import { ShareReviewLinks } from '@/components/ShareReviewLinks';
import { REVIEWER_SLOTS } from '@/lib/karma/review';
import { useAppStore } from '@/lib/store/useAppStore';
import { plural } from '@/lib/ui/catalog';

/**
 * «На ревью» — экран, которого в V1 не было и быть не могло.
 *
 * Здесь живут дела между «записал» и «подтвердили»: видно, кто из рецензентов
 * ответил, и отсюда же перевыпускается истёкшая ссылка.
 */
export default function ReviewPage() {
  const deeds = useAppStore((s) => s.deeds);
  const hydrate = useAppStore((s) => s.hydrate);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const waiting = deeds.filter(
    (deed) => deed.status === 'pending' || deed.status === 'partially_reviewed',
  );
  const open = waiting.find((deed) => deed.id === openId) ?? null;

  async function refresh() {
    setRefreshing(true);
    try {
      await hydrate(true);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        На проверке
      </h1>

      {waiting.length > 0 && (
        <p className="hint" style={{ padding: '0 4px', marginTop: -8 }}>
          {waiting.length} {plural(waiting.length, 'дело ждёт', 'дела ждут', 'дел ждут')} проверки.
          {REVIEWER_SLOTS.length === 1
            ? ' Карма начислится, когда проверяющий поставит балл.'
            : ' Карма начислится, когда ответят все проверяющие: итог — среднее их баллов.'}
        </p>
      )}

      <DeedList
        deeds={waiting}
        onSelect={(deed) => setOpenId(deed.id === openId ? null : deed.id)}
        empty={
          <>
            Ни одного дела на проверке.
            <br />
            <Link href="/add">Записать дело</Link>
          </>
        }
      />

      {open && <ShareReviewLinks deed={open} />}

      <button className="btn secondary" disabled={refreshing} onClick={() => void refresh()}>
        {refreshing ? 'Обновляем…' : 'Обновить'}
      </button>
    </main>
  );
}
