/**
 * Шкала оценки — главный элемент страницы.
 *
 * Якоря и ручка стоят на ОДНОЙ оси: рецензент видит не «примеры где-то рядом»,
 * а точки на той же линейке, по которой двигает свою оценку. Цвет ручки идёт
 * от шалфейного к янтарному — вес оценки читается раньше, чем цифра.
 */

import { useEffect, useState } from 'react';
import type { ScoreAnchor } from '../../lib/karma/review';

const LOW = [107, 143, 122] as const; // #6b8f7a
const HIGH = [226, 134, 31] as const; // #e2861f

/** Линейная интерполяция цвета по позиции на шкале. */
function scoreColor(ratio: number): string {
  const channel = (i: number) => Math.round(LOW[i] + (HIGH[i] - LOW[i]) * ratio);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

interface Props {
  value: number;
  max: number;
  anchors: readonly ScoreAnchor[];
  baseScore: number;
  onChange(value: number): void;
}

export function Scale({ value, max, anchors, baseScore, onChange }: Props) {
  // Ручка приезжает от нуля к подсказке системы один раз при открытии: это
  // объясняет устройство шкалы быстрее любой подписи.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const shown = mounted ? value : 0;
  const ratio = shown / max;
  const color = scoreColor(ratio);
  const percent = `${ratio * 100}%`;

  return (
    <section className="scale" aria-labelledby="scale-heading">
      <h2 id="scale-heading" className="eyebrow">
        Ваша оценка
      </h2>

      <div className="readout">
        <b style={{ color }}>{shown}</b>
        <span>из {max}</span>
      </div>

      <div className="track-area">
        <div className="track">
          <div className="track-fill" style={{ width: percent, background: color }} />
          <input
            className="track-input"
            type="range"
            min={0}
            max={max}
            step={1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-label={`Оценка дела от 0 до ${max}`}
            aria-valuetext={`${value} из ${max}`}
          />
          <div className="handle" style={{ left: percent, background: color }} />
        </div>

        <div className="anchors">
          {anchors.map((anchor) => (
            <button
              key={anchor.score}
              type="button"
              className="anchor"
              style={{ left: `${(anchor.score / max) * 100}%` }}
              data-active={value === anchor.score}
              onClick={() => onChange(anchor.score)}
              title={anchor.example}
              aria-label={`Поставить ${anchor.score}: ${anchor.example}`}
            >
              <b>{anchor.score}</b>
              <span>{anchor.short}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="suggestion">
        <span>Система предлагает {baseScore}</span>
        {value !== baseScore && (
          <button type="button" onClick={() => onChange(baseScore)}>
            вернуть
          </button>
        )}
      </p>
    </section>
  );
}
