"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { startTaskCelebrationLifetime, TASK_CELEBRATION_PARTICLES, TASK_CELEBRATION_SHAPES, type TaskCelebrationEvent, type TaskCelebrationMode } from './task-celebration';
import './task-celebration.css';

interface Props {
  celebration: TaskCelebrationEvent | null;
  onDismiss: () => void;
  mode?: TaskCelebrationMode;
  onModeChange?: (mode: TaskCelebrationMode) => void;
}

/** A short, silent flourish that never takes keyboard focus or blocks the board. */
export default function TaskCelebration({ celebration, onDismiss, mode = 'shower', onModeChange }: Props) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [reducedMotion, setReducedMotion] = useState(true);
  const shower = useMemo(() => {
    if (!celebration) return null;
    const shape = TASK_CELEBRATION_SHAPES[Math.floor(Math.random() * TASK_CELEBRATION_SHAPES.length)];
    const particles = Array.from({ length: TASK_CELEBRATION_PARTICLES }, (_, index) => ({
      left: `${(index + Math.random()) / TASK_CELEBRATION_PARTICLES * 100}%`,
      size: `${23 + Math.random() * 23}px`,
      delay: `${Math.random() * 1.4}s`,
      duration: `${2.8 + Math.random() * 1.3}s`,
      drift: `${(Math.random() - .5) * 150}px`,
      turn: `${(Math.random() - .5) * 190}deg`,
    }));
    return { shape, particles };
  }, [celebration?.id, mode]);

  useEffect(() => {
    if (!celebration) return;
    return startTaskCelebrationLifetime(() => dismiss.current(), setReducedMotion);
  }, [celebration?.id, mode]);

  if (!celebration || !shower) return null;
  const rain = mode === 'shower' || (mode === 'system' && !reducedMotion);
  const title = celebration.preview ? 'Celebration preview' : celebration.person === 'Family' ? 'Shared tasks complete!' : celebration.person ? `You did it, ${celebration.person}!` : 'You did it, team Bird!';
  const message = celebration.preview ? 'Try your celebration style. Your tasks haven’t changed.' : celebration.person === 'Family' ? 'All your shared tasks for today are complete.' : celebration.person ? 'All your tasks for today are complete.' : 'All the tasks for today are complete.';

  return <div className={`task-celebration ${rain ? '' : 'task-celebration--still'} ${mode === 'shower' ? 'task-celebration--force-motion' : ''}`}>
    <div className="task-celebration-veil" aria-hidden="true"/>
    {rain && <div className="task-celebration-shower" key={`${celebration.id}:${mode}`} aria-hidden="true">
      {shower.particles.map((particle, index) => <span className="task-celebration-particle" key={index} style={{
        left: particle.left,
        fontSize: particle.size,
        '--task-delay': particle.delay,
        '--task-duration': particle.duration,
        '--task-drift': particle.drift,
        '--task-turn': particle.turn,
      } as React.CSSProperties}>{shower.shape.symbol}</span>)}
    </div>}
    <div className="task-celebration-card">
      <span className="task-celebration-badge" aria-hidden="true">{shower.shape.symbol}</span>
      <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{message}</p></div>
      {!rain && onModeChange && <button type="button" className="task-celebration-dismiss task-celebration-show" onClick={() => onModeChange('shower')}>Show shower</button>}
      <button type="button" className="task-celebration-dismiss" onClick={onDismiss} aria-label="Dismiss task celebration">Lovely! <span aria-hidden="true">✓</span></button>
    </div>
  </div>;
}
