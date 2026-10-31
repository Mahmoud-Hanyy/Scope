import type { Session } from '../types/session';

export function sessionDuration(session: Session, now: number): string {
  // Browser restart is detected after downtime; that gap is not a measured session.
  if (session.endReason === 'browser-restart')
    return 'Unavailable after browser restart';
  const seconds = Math.max(
    0,
    Math.floor(((session.endedAt ?? now) - session.startedAt) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
