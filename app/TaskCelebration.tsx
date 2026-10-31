"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { startTaskCelebrationLifetime, TASK_CELEBRATION_PARTICLES, TASK_CELEBRATION_SHAPES, type TaskCelebrationEvent } from './task-celebration';
import './task-celebration.css';

interface Props {
  celebration: TaskCelebrationEvent | null;
  onDismiss: () => void;
}

/** A short, silent flourish that never takes keyboard focus or blocks the board. */
export default function TaskCelebration({ celebration, onDismiss }: Props) {
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
  }, [celebration?.id]);

  useEffect(() => {
    if (!celebration) return;
    return startTaskCelebrationLifetime(() => dismiss.current(), setReducedMotion);
  }, [celebration?.id]);

  if (!celebration || !shower) return null;
  const title = celebration.person === 'Family' ? 'Shared tasks complete!' : celebration.person ? `You did it, ${celebration.person}!` : 'You did it, team Bird!';
  const message = celebration.person === 'Family' ? 'All your shared tasks for today are complete.' : celebration.person ? 'All your tasks for today are complete.' : 'All the tasks for today are complete.';

  return <div className={`task-celebration ${reducedMotion ? 'task-celebration--still' : ''}`}>
    <div className="task-celebration-veil" aria-hidden="true"/>
    {!reducedMotion && <div className="task-celebration-shower" aria-hidden="true">
      {shower.particles.map((particle, index) => <span className="task-celebration-particle" key={index} style={{
        left: particle.left,
        fontSize: particle.size,
        animationDelay: particle.delay,
        animationDuration: particle.duration,
        '--task-drift': particle.drift,
        '--task-turn': particle.turn,
      } as React.CSSProperties}>{shower.shape.symbol}</span>)}
    </div>}
    <div className="task-celebration-card">
      <span className="task-celebration-badge" aria-hidden="true">{shower.shape.symbol}</span>
      <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{message}</p></div>
      <button type="button" className="task-celebration-dismiss" onClick={onDismiss} aria-label="Dismiss task celebration">Lovely! <span aria-hidden="true">✓</span></button>
    </div>
  </div>;
}
