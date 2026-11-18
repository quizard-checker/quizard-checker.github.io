import { Component, EventEmitter, Input, OnDestroy, Output, signal } from '@angular/core';
import { IcoPipe } from './ico.pipe';

// Shared by Settings and the profile picker so deleting an account always
// uses the same two-step flow: choose the profile, then confirm inside the
// same sheet. Parents perform the actual delete and refresh their own lists.
@Component({
  selector: 'app-remove-account-sheet',
  imports: [IcoPipe],
  template: `
    <div class="org-overlay" (click)="close()">
      <div
        class="org-sheet remove-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        (click)="$event.stopPropagation()"
      >
        @if (removing(); as r) {
          <div class="remove-switching" role="status" aria-live="polite">
            <div class="remove-spin">
              <span class="acc-avatar sm" [style.background]="r.color">{{ initial(r.name) }}</span>
              <span class="remove-spin-ring"></span>
            </div>
            <b>Removing {{ r.name }}…</b>
            <span class="faint">Deleting this profile and its data</span>
          </div>
        } @else if (target(); as t) {
          <div class="remove-warn-head">
            <span class="remove-ico" [innerHTML]="'alert' | ico"></span>
            <h3 id="remove-title">Delete account?</h3>
          </div>
          <p class="remove-confirm">
            Are you sure you want to delete <b>{{ t.name }}</b>?
          </p>
          <p class="faint remove-lead">
            This removes the profile with all its classes, quizzes, and results.
            This cannot be undone.
          </p>
          <div class="org-sheet-actions">
            <button type="button" class="btn btn-secondary" (click)="back()">Back</button>
            <button type="button" class="btn btn-danger" (click)="confirm()">Delete account</button>
          </div>
        } @else {
          <h3 id="remove-title">Remove an account</h3>
          <p class="faint remove-lead">
            Choose the profile you want to delete. Its classes, quizzes, and
            results will be permanently removed.
          </p>
          <div class="switch-list">
            @for (a of accounts; track a.id) {
              <button type="button" class="switch-row" (click)="pick(a)">
                <span class="acc-avatar sm" [style.background]="a.color">{{ initial(a.name) }}</span>
                <span class="switch-name">{{ a.name }}</span>
                <span class="switch-lock" [innerHTML]="'trash' | ico"></span>
              </button>
            }
          </div>
          @if (!accounts.length) {
            <p class="faint remove-empty">No profiles are available to remove.</p>
          }
          <div class="org-sheet-actions">
            <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class RemoveAccountSheet implements OnDestroy {
  @Input() accounts: any[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() removed = new EventEmitter<any>();

  readonly target = signal<any | null>(null);
  readonly removing = signal<any | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  initial(name: string): string {
    return (name || '?').charAt(0).toUpperCase();
  }

  pick(account: any) {
    if (this.removing()) return;
    this.target.set(account);
  }

  back() {
    if (this.removing()) return;
    this.target.set(null);
  }

  close() {
    if (this.removing()) return;
    this.target.set(null);
    this.closed.emit();
  }

  confirm() {
    const account = this.target();
    if (!account || this.removing()) return;
    this.target.set(null);
    this.removing.set(account);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.removing.set(null);
      this.removed.emit(account);
    }, 700);
  }
}
