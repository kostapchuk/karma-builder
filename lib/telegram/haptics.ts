/**
 * Тактильный отклик. Дешёвый и очень заметный вклад в ощущение геймификации,
 * поэтому дёргаем его на начисление баллов, level-up и новые бейджи.
 *
 * Все вызовы «мягкие»: вне Telegram и на неподдерживающих клиентах — no-op.
 */

import { hapticFeedback } from '@telegram-apps/sdk-react';

function withHaptics(fn: () => void): void {
  try {
    if (!hapticFeedback.isSupported()) return;
    fn();
  } catch {
    /* клиент не поддерживает — молча пропускаем */
  }
}

export function hapticSelection(): void {
  withHaptics(() => hapticFeedback.selectionChanged());
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  withHaptics(() => hapticFeedback.impactOccurred(style));
}

export function hapticSuccess(): void {
  withHaptics(() => hapticFeedback.notificationOccurred('success'));
}

export function hapticWarning(): void {
  withHaptics(() => hapticFeedback.notificationOccurred('warning'));
}
