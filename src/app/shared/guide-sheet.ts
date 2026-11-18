import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GuideService } from '../core/services/guide.service';
import { IcoPipe } from './ico.pipe';

type GuideStep = {
  icon: string; title: string; body: string; tip?: string;
  anchor?: string; demo?: 'scanner'; action?: 'home' | 'scan' | 'settings';
};

const STEPS: GuideStep[] = [
  {
    icon: 'users',
    title: 'Start with a class',
    body: 'On Home, tap Add class. Give it a subject, grade, and section. One class keeps its roster, quizzes, and scanned results together.',
    tip: 'You can create as many classes as you teach. Everything stays on this device.',
    anchor: 'home-add-class',
    action: 'home',
  },
  {
    icon: 'users',
    title: 'Add or paste the roster',
    body: 'Open the class and add students. Paste a list or add them one at a time. Each student gets a stable number and a 5-digit PIN for PIN sheets.',
    tip: 'Keep the PIN list handy — the shaded PIN on a half-sheet identifies the student.',
  },
  {
    icon: 'sparkles',
    title: 'Create the quiz and answer key',
    body: 'Open the class, go to Classwork, and create a quiz. Paste the answer key, import it, or build it from a saved key. Set the number of items.',
    tip: 'The printed sheet does not contain the answer key — Quizard scores against the key stored in the app.',
  },
  {
    icon: 'scan',
    title: 'Generate and print the answer sheets',
    body: 'Choose the quiz and print PIN half-sheets. Two students fit on one long-bond page. Print at 100% actual size, then cut on the dashed line.',
    tip: 'Do not use fit-to-page. Keep all four black corner squares inside the printable area.',
  },
  {
    icon: 'camera',
    title: 'Open the scanner',
    body: 'Go to the Scan tab, choose the class, and tap Start checking. Auto-scan is on by default. The sheet scores itself when the scanner sees it.',
    tip: 'You can also use Check from photo for a picture taken with the phone camera.',
    action: 'scan',
  },
  {
    icon: 'scan',
    title: 'Hold the whole sheet in view',
    body: 'Fit all four black corner squares inside the camera. The sheet can be small — move back instead of trying to fill the frame. Keep it flat and avoid glare.',
    tip: 'The printed border is not required. All four corner squares are what align the bubble grid.',
    demo: 'scanner',
  },
  {
    icon: 'check',
    title: 'Review the score card',
    body: 'After a scan, the score card shows the student and score. Tap Next sheet for the next paper. If something is wrong, tap Redo and scan the same paper again.',
    tip: 'Redo clears the saved result for that paper so the corrected scan can replace it.',
  },
  {
    icon: 'chart',
    title: 'Review and share the results',
    body: 'Open the class results to see the average, per-question breakdown, and each student’s answers. Export a report or back up your library from Settings.',
    tip: 'Everything works offline. Back up regularly if you use more than one device.',
    action: 'settings',
  },
];

// A short, offline step-by-step tutorial. Phase 1 is content and navigation;
// the spotlight/coach-mark animation comes in a later phase.
@Component({
  selector: 'app-guide-sheet',
  imports: [IcoPipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (guide.open()) {
      <div class="org-overlay" [class.tour-overlay]="hasTarget()" (click)="guide.close()">
        @if (target(); as r) {
          <div class="tour-spotlight" aria-hidden="true"
               [style.top.px]="r.top - 6" [style.left.px]="r.left - 6"
               [style.width.px]="r.width + 12" [style.height.px]="r.height + 12"></div>
        }
        <div class="org-sheet guide-sheet" [class.anchored]="hasTarget()"
             role="dialog" aria-modal="true" aria-labelledby="guide-title"
             (click)="$event.stopPropagation()" (keydown.escape)="guide.close()">
          <div class="guide-head">
            <div>
              <p class="guide-kicker">STEP-BY-STEP TUTORIAL</p>
              <h3 id="guide-title">How to use Quizard</h3>
            </div>
            <button class="guide-skip" type="button" (click)="guide.skip()">Skip</button>
          </div>

          <div class="guide-progress-track" role="progressbar"
               [attr.aria-valuenow]="guide.step() + 1"
               [attr.aria-valuemin]="1" [attr.aria-valuemax]="guide.total">
            <span [style.width.%]="guide.progress() * 100"></span>
          </div>
          <p class="guide-count">Step {{ guide.step() + 1 }} of {{ guide.total }}</p>

          @if (current(); as step) {
            <div class="guide-step-card">
              <span class="guide-step-ico" [innerHTML]="step.icon | ico"></span>
              <div>
                <h4>{{ step.title }}</h4>
                <p>{{ step.body }}</p>
                @if (step.tip) {
                  <p class="guide-tip">{{ step.tip }}</p>
                }
                @if (step.demo === 'scanner') {
                  <div class="scanner-demo" aria-hidden="true">
                    <div class="demo-sheet">
                      <i class="dm tl"></i><i class="dm tr"></i>
                      <i class="dm br"></i><i class="dm bl"></i>
                      <span class="demo-scan"></span>
                    </div>
                    <span class="demo-check">✓</span>
                    <p class="demo-caption">Four markers lock, then it captures by itself.</p>
                  </div>
                }
                @if (step.action) {
                  <button class="btn btn-secondary guide-try" type="button" (click)="tryStep(step)">
                    Try it
                  </button>
                }
              </div>
            </div>
          }

          <div class="org-sheet-actions guide-nav">
            <button class="btn btn-secondary" type="button"
                    [disabled]="guide.step() === 0" (click)="guide.back()">Back</button>
            <button class="btn btn-primary" type="button" (click)="guide.next()">
              {{ guide.step() === guide.total - 1 ? 'Finish' : 'Next' }}
            </button>
          </div>
          <button class="guide-skip-link" type="button" (click)="guide.skip()">Skip tutorial</button>
        </div>
      </div>
    }
  `,
})
export class GuideSheet {
  readonly guide = inject(GuideService);
  private router = inject(Router);
  readonly current = computed(() => STEPS[this.guide.step()] || STEPS[0]);
  readonly target = signal<DOMRect | null>(null);
  readonly hasTarget = computed(() => !!this.target());

  constructor() {
    effect(() => {
      const open = this.guide.open();
      const step = this.current();
      if (!open) {
        this.target.set(null);
        return;
      }
      requestAnimationFrame(() => this.measure(step));
    });
  }

  @HostListener('window:resize')
  onResize() {
    this.measure(this.current());
  }

  private measure(step: GuideStep) {
    const el = step.anchor
      ? document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
      : null;
    this.target.set(el ? el.getBoundingClientRect() : null);
  }

  tryStep(step: GuideStep) {
    this.guide.skip();
    const route = step.action === 'scan'
      ? '/tabs/checking'
      : step.action === 'settings'
        ? '/tabs/settings'
        : '/tabs/home';
    void this.router.navigateByUrl(route);
  }
}
