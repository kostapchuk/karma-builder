'use client';

import type { DeedView } from '@/lib/api/types';
import { sqlToEpoch } from '@/lib/api/types';
import { CATEGORY_META, EFFORT_META, formatDeedTime } from '@/lib/ui/catalog';

/**
 * Строка дела. В V2 у неё появился статус: балл больше не начисляется в момент
 * записи, и список обязан показывать, чем дело закончилось — иначе непонятно,
 * почему карма не выросла.
 */
export const STATUS_META: Record<DeedView['status'], { label: string; tone: 'wait' | 'done' | 'muted' }> = {
  pending: { label: 'Ждёт двух оценок', tone: 'wait' },
  partially_reviewed: { label: 'Оценил один из двух', tone: 'wait' },
  approved: { label: 'Подтверждено', tone: 'done' },
  rejected: { label: 'Отклонено', tone: 'muted' },
  expired: { label: 'Ссылки истекли', tone: 'muted' },
  legacy_unverified: { label: 'Из прежней версии', tone: 'muted' },
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
              <span>
                {meta.label} · {EFFORT_META[deed.effortLevel].label} ·{' '}
                {formatDeedTime(sqlToEpoch(deed.createdAt))}
              </span>
              <span className={`pill ${status.tone}`}>{status.label}</span>
            </span>
            <span className={`points${approved ? '' : ' muted'}`}>
              {/* До подтверждения показываем оценку системы со знаком «примерно»:
                  это ещё не карма, а прогноз. */}
              {approved ? `+${deed.finalScore}` : `~${deed.baseScore}`}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
