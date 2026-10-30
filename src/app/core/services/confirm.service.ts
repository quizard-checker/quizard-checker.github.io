import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly visible = signal(false);
  readonly title = signal('');
  readonly message = signal('');
  readonly subject = signal('');
  readonly okLabel = signal('Delete');
  readonly icon = signal<'trash' | 'alert'>('trash');
  readonly destructive = signal(false);
  private resolve: ((value: boolean) => void) | null = null;

  confirm(title: string, message: string, okLabel = 'Delete', subject = ''): Promise<boolean> {
    if (this.resolve) this.finish(false);
    const destructive = /delete|erase/i.test(title);
    this.title.set(title);
    this.message.set(message);
    this.subject.set(subject);
    this.okLabel.set(okLabel);
    this.icon.set(destructive && /^delete/i.test(title) ? 'trash' : 'alert');
    this.destructive.set(destructive);
    this.visible.set(true);
    return new Promise(resolve => {
      this.resolve = resolve;
      // Default to the safe action: a stray Enter must not delete data.
      setTimeout(() => globalThis.document?.getElementById('confirm-cancel')?.focus(), 0);
    });
  }

  accept() { this.finish(true); }
  cancel() { this.finish(false); }

  private finish(value: boolean) {
    const resolve = this.resolve;
    this.resolve = null;
    this.visible.set(false);
    resolve?.(value);
  }
}
