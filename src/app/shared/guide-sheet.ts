import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GuideService } from '../core/services/guide.service';
import { IcoPipe } from './ico.pipe';

// A short, offline preview of the guide that used to open the docs website.
// The teacher gets the flow at a glance without a browser jump.
@Component({
  selector: 'app-guide-sheet',
  imports: [IcoPipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (guide.open()) {
      <div class="org-overlay" (click)="guide.close()">
        <div class="org-sheet guide-sheet" role="dialog" aria-modal="true" aria-labelledby="guide-title"
             (click)="$event.stopPropagation()" (keydown.escape)="guide.close()">
          <h3 id="guide-title">How to use Quizard</h3>
          <p class="guide-sub">The short version — everything works offline.</p>

          <ol class="guide-steps">
            <li class="guide-step">
              <span class="guide-step-ico" [innerHTML]="'users' | ico"></span>
              <div><b>Add your class</b><span>Paste a roster and give the class its school year. Student numbers stay stable.</span></div>
            </li>
            <li class="guide-step">
              <span class="guide-step-ico" [innerHTML]="'sparkles' | ico"></span>
              <div><b>Create a quiz</b><span>Anchor it to your answer key, let AI write from a lesson, or match your own format.</span></div>
            </li>
            <li class="guide-step">
              <span class="guide-step-ico" [innerHTML]="'scan' | ico"></span>
              <div><b>Print bubble sheets</b><span>One page per student — every QR carries the quiz and the student's name.</span></div>
            </li>
            <li class="guide-step">
              <span class="guide-step-ico" [innerHTML]="'camera' | ico"></span>
              <div><b>Scan the papers</b><span>Hold a sheet in the frame and it scores itself; the score card names the quiz.</span></div>
            </li>
            <li class="guide-step">
              <span class="guide-step-ico" [innerHTML]="'chart' | ico"></span>
              <div><b>See the results</b><span>Class averages, the learning trend, and a per-student answer review.</span></div>
            </li>
          </ol>

          <div class="org-sheet-actions">
            <button class="btn btn-primary" (click)="guide.close()">Got it</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class GuideSheet {
  readonly guide = inject(GuideService);
}
