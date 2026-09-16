export const PRACTICE_COMPLETED_EVENT = 'ingles-al-grano:practice-completed';
export const PRACTICE_COMPLETED_KEY = 'ingles-al-grano:practice-completed';

export function markPracticeCompleted(): void {
  try { localStorage.setItem(PRACTICE_COMPLETED_KEY, 'true'); } catch { /* no-op */ }
  window.dispatchEvent(new Event(PRACTICE_COMPLETED_EVENT));
}
