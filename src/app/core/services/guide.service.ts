import { Injectable, signal } from '@angular/core';

/**
 * The in-app "How to use Quizard" preview. Kept at the app root so both the
 * Quizzes hero and Settings open the same sheet without leaving the app (or
 * needing a connection).
 */
@Injectable({ providedIn: 'root' })
export class GuideService {
  readonly open = signal(false);
  show() { this.open.set(true); }
  close() { this.open.set(false); }
}
