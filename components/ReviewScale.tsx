'use client';

/**
 * Шкала оценки — главный элемент экрана проверяющего.
 *
 * Якоря и ручка стоят на ОДНОЙ оси: проверяющий видит не «примеры где-то рядом»,
 * а точки на той же линейке, по которой двигает свою оценку. Цвет ручки идёт
 * от шалфейного к янтарному — вес оценки читается раньше, чем цифра.
 *
 * Жила в отдельной SPA, пока ревью шло без логина; переехала сюда вместе с
 * маршрутом, когда проверяющего понадобилось опознавать.
 */

import { useEffect, useRef, useState } from 'react';

import type { ScoreAnchor } from '@/lib/karma/review';

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

/** Длительность переезда ручки. Держать в согласии с `.track-area[data-glide]`. */
const GLIDE_MS = 220;

export function ReviewScale({ value, max, anchors, baseScore, onChange }: Props) {
  // Ручка приезжает от нуля к подсказке системы один раз при открытии: это
  // объясняет устройство шкалы быстрее любой подписи.
  const [mounted, setMounted] = useState(false);

  // Плавность нужна там, где оценка меняется скачком — на въезде и на тычке
  // в якорь, — и вредна при перетаскивании: там тот же переход читается как
  // лаг, ручка все 220 мс отстаёт от пальца. Поэтому он не постоянный, а
  // включается на время конкретного скачка.
  const [glide, setGlide] = useState(true);
  const glideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const glideOnce = () => {
    clearTimeout(glideTimer.current);
    setGlide(true);
    glideTimer.current = setTimeout(() => setGlide(false), GLIDE_MS + 40);
  };

  // Перетаскивание обрывает текущий переезд немедленно, не дожидаясь таймера:
  // иначе первое же движение пальца досталось бы анимации.
  const stopGlide = () => {
    clearTimeout(glideTimer.current);
    setGlide(false);
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    glideOnce();
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(glideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Скачок к готовому значению: якорь или «вернуть». */
  const jumpTo = (next: number) => {
    glideOnce();
    onChange(next);
  };

  const shown = mounted ? value : 0;
  const ratio = shown / max;
  const color = scoreColor(ratio);
  const percent = `${ratio * 100}%`;

  return (
    <section className="scale" aria-labelledby="scale-heading">
      <h2 id="scale-heading" className="section-title">
        Ваш балл
      </h2>

      <div className="readout">
        <b style={{ color }}>{shown}</b>
        <span>из {max}</span>
      </div>

      <div className="track-area" data-glide={glide || undefined}>
        <div className="track">
          <div className="track-fill" style={{ width: percent, background: color }} />
          <input
            className="track-input"
            type="range"
            min={0}
            max={max}
            step={1}
            value={value}
            onPointerDown={stopGlide}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-label={`Балл делу от 0 до ${max}`}
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
              onClick={() => jumpTo(anchor.score)}
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
          <button type="button" onClick={() => jumpTo(baseScore)}>
            вернуть
          </button>
        )}
      </p>
    </section>
  );
}
