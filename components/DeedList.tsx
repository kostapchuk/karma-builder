'use client';

import type { DeedView } from '@/lib/api/types';
import { sqlToEpoch } from '@/lib/api/types';
import { REVIEWER_SLOTS } from '@/lib/karma/review';
import { CATEGORY_META, EFFORT_META, formatDeedTime } from '@/lib/ui/catalog';

/**
 * Строка дела. В V2 у неё появился статус: балл больше не начисляется в момент
 * записи, и список обязан показывать, чем дело закончилось — иначе непонятно,
 * почему карма не выросла.
 */
/**
 * Сколько оценок ждёт дело — из `REVIEWER_SLOTS`, а не словом в подписи:
 * иначе при смене числа рецензентов список обещает не то, что делает сервер.
 */
const NEEDED = REVIEWER_SLOTS.length;

const WAITING_LABEL =
  NEEDED === 1
    ? 'Ждёт проверки'
    : NEEDED === 2
      ? 'Ждёт двух проверок'
      : `Ждёт проверок: ${NEEDED}`;

export const STATUS_META: Record<DeedView['status'], { label: string; tone: 'wait' | 'done' | 'muted' }> = {
  pending: { label: WAITING_LABEL, tone: 'wait' },
  // При одном рецензенте «оценил один из 1» — бессмыслица: такое дело уже
  // подтверждено. Статус остаётся достижимым только для дел, заведённых, когда
  // слотов было два, поэтому подпись должна быть осмысленной в обоих случаях.
  partially_reviewed: {
    label: NEEDED === 1 ? WAITING_LABEL : `Проверил один из ${NEEDED}`,
    tone: 'wait',
  },
  approved: { label: 'Подтверждено', tone: 'done' },
  rejected: { label: 'Отклонено', tone: 'muted' },
  expired: { label: NEEDED === 1 ? 'Ссылка истекла' : 'Ссылки истекли', tone: 'muted' },
};

interface Props {
  deeds: DeedView[];
  onSelect?(deed: DeedView): void;
  empty?: React.ReactNode;
}

export function DeedList({ deeds, onSelect, empty }: Props) {
  if (deeds.length === 0) {
    return (
      <div className="empty">
        <span className="emoji">🌱</span>
        {empty ?? 'Пока ни одного дела. Первое — самое ценное.'}
      </div>
    );
  }

  return (
    <div className="deed-list">
      {deeds.map((deed) => {
        const meta = CATEGORY_META[deed.category];
        const status = STATUS_META[deed.status];
        const approved = deed.status === 'approved';
        const Tag = onSelect ? 'button' : 'div';

        return (
          <Tag
            className="deed"
            key={deed.id}
            {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(deed) } : {})}
          >
            <span className="icon">{meta.icon}</span>
            <span className="body">
              <b>{deed.description || meta.label}</b>
              <span className="meta">
                {meta.label} · {EFFORT_META[deed.effortLevel].label} ·{' '}
                {formatDeedTime(sqlToEpoch(deed.createdAt))}
              </span>
              <span className={`pill ${status.tone}`}>{status.label}</span>
            </span>
            <span className={`points${approved ? '' : ' muted'}`}>
              {/* До подтверждения показываем предложение системы со знаком «примерно»:
                  это ещё не карма, а прогноз. */}
              {approved ? `+${deed.finalScore}` : `~${deed.baseScore}`}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
