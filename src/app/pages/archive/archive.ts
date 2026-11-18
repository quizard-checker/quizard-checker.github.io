import { Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listClasses, saveClass, deleteClass } from '../../core/engine/storage.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

@Component({
  selector: 'app-archive',
  imports: [IonContent, IcoPipe],
  templateUrl: './archive.html',
})
export class ArchivePage {
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  readonly classes = signal<any[]>([]);

  async ionViewWillEnter() {
    this.classes.set((await listClasses()).filter((c: any) => c.archived));
  }

  goBack() {
    if (history.length > 1) this.location.back();
    else this.router.navigateByUrl('/tabs/home');
  }

  async restore(cls: any) {
    await saveClass({ ...cls, archived: false });
    this.classes.update(list => list.filter((c: any) => c.id !== cls.id));
    this.toast.toast(`${cls.name} restored`);
  }

  async remove(cls: any) {
    if (!await this.confirm.confirm(`Delete “${cls.name}”?`, 'The roster will be removed. Saved scan results are kept.', 'Delete')) return;
    await deleteClass(cls.id);
    this.classes.update(list => list.filter((c: any) => c.id !== cls.id));
    this.toast.toast('Class deleted', false, {
      text: 'Undo',
      handler: async () => {
        await saveClass(cls);
        this.classes.update(list => [cls, ...list]);
        this.toast.toast('Class restored');
      }
    });
  }
}
