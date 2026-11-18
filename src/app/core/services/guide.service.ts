import { Injectable, computed, signal } from '@angular/core';

const STEP_KEY = 'quizard.tutorial.v1.step';
const DONE_KEY = 'quizard.tutorial.v1.done';
const TOTAL = 8;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function readStep(): number {
  const n = Number(storageGet(STEP_KEY) || 0);
  return Number.isFinite(n) ? Math.min(TOTAL - 1, Math.max(0, Math.floor(n))) : 0;
}

function readDone(): boolean {
  return storageGet(DONE_KEY) === '1';
}

/**
 * The in-app step-by-step tutorial. Kept at the app root so Home and Settings
 * open the same state, and progress survives a reload or a closed modal.
 */
@Injectable({ providedIn: 'root' })
export class GuideService {
  readonly open = signal(false);
  readonly step = signal(readStep());
  readonly done = signal(readDone());
  readonly total = TOTAL;
  readonly progress = computed(() => (this.step() + 1) / this.total);

  show() {
    // Completed users replay from the beginning; unfinished users resume.
    this.step.set(this.done() ? 0 : readStep());
    this.open.set(true);
  }

  close() {
    this.persistStep();
    this.open.set(false);
  }

  next() {
    if (this.step() >= this.total - 1) {
      this.finish();
      return;
    }
    this.step.update(v => Math.min(this.total - 1, v + 1));
    this.persistStep();
  }

  back() {
    this.step.update(v => Math.max(0, v - 1));
    this.persistStep();
  }

  skip() {
    this.persistStep();
    this.open.set(false);
  }

  finish() {
    this.done.set(true);
    storageSet(DONE_KEY, '1');
    this.persistStep();
    this.open.set(false);
  }

  private persistStep() {
    storageSet(STEP_KEY, String(this.step()));
  }
}
