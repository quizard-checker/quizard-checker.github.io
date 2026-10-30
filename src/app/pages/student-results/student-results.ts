import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { getClass, listSheets, listQuizzes, deleteSheet, saveSheet } from '../../core/engine/storage.js';
import { buildStudentReview, reviewSummary, filterReview } from '../../core/engine/student-review.js';
import { fmtDate, bannerTheme } from '../../shared/helpers.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

type ReviewFilter = 'all' | 'incorrect' | 'blank';

// One student's results, grouped by quiz. Every question shows the student's
// pick beside the keyed answer; View question expands the full stem and all
// choices, with the key and the student's choice marked. Reached from the
// Answers button on the class roster.
@Component({
  selector: 'app-student-results',
  imports: [IonContent, IcoPipe],
  templateUrl: './student-results.html',
})
export class StudentResultsPage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  cls = signal<any>(null);
  student = signal<any>(null);
  loaded = signal(false);
  private sheets = signal<any[]>([]);
  private quizzes = signal<any[]>([]);

  filter = signal<ReviewFilter>('all');
  selectedQuizId = signal<string | null>(null);
  openQuestion = signal<string | null>(null);

  readonly bannerTheme = bannerTheme;
  readonly dateOf = fmtDate;

  readonly records = computed(() =>
    this.student() ? buildStudentReview(this.sheets(), this.quizzes(), this.student()) : []);

  // One quiz at a time: the selected quiz drives the summary, filters and rows.
  readonly selectedRecord = computed(() => {
    const rows = this.records();
    return rows.find(r => r.quizId === this.selectedQuizId()) || rows[0] || null;
  });
  readonly quizSummary = computed(() => {
    const rec = this.selectedRecord();
    return reviewSummary(rec ? [rec] : []);
  });
  readonly visibleRows = computed(() => {
    const rec = this.selectedRecord();
    return rec ? (filterReview([rec], this.filter())[0]?.rows || []) : [];
  });

  readonly initials = computed(() => {
    const name = this.student()?.name || '';
    return name.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0] || '').join('').toUpperCase();
  });

  async ionViewWillEnter() {
    const classId = this.route.snapshot.paramMap.get('id');
    const studentId = this.route.snapshot.paramMap.get('studentId');
    const cls = classId ? await getClass(classId) : null;
    this.cls.set(cls);
    this.student.set((cls?.students || []).find((s: any) => s.id === studentId) || null);
    if (!cls) {
      this.sheets.set([]);
      this.quizzes.set([]);
      this.loaded.set(true);
      return;
    }
    const [sheets, quizzes] = await Promise.all([listSheets({ classId: cls.id }), listQuizzes()]);
    this.sheets.set(sheets);
    this.quizzes.set(quizzes);
    this.filter.set('all');
    this.selectedQuizId.set(this.records()[0]?.quizId || null);
    this.openQuestion.set(null);
    this.loaded.set(true);
  }

  back() {
    const id = this.cls()?.id;
    this.router.navigateByUrl(id ? `/tabs/classes/${id}` : '/tabs/classes');
  }

  setFilter(f: ReviewFilter) {
    this.filter.set(f);
    this.openQuestion.set(null);
  }

  selectQuiz(quizId: string) {
    this.selectedQuizId.set(quizId);
    this.openQuestion.set(null);
  }

  toggleQuestion(quizId: string, n: number) {
    const key = `${quizId}:${n}`;
    this.openQuestion.set(this.openQuestion() === key ? null : key);
  }

  isQuestionOpen(quizId: string, n: number) { return this.openQuestion() === `${quizId}:${n}`; }

  // A key-only quiz has placeholders instead of choices — show the answer
  // letter without pretending there is a full question to display.
  hasOptions(row: any): boolean {
    return Array.isArray(row?.options) && row.options.some((o: string) => String(o || '').trim());
  }

  letter(i: number): string { return 'ABCDEFGHIJ'[i] || ''; }

  async remove(rec: any) {
    if (!await this.confirm.confirm(`Remove this ${rec.quiz} result?`, 'The sheet scan will be deleted.', 'Remove')) return;
    const raw = this.sheets().find(s => s.id === rec.id);
    const wasSelected = this.selectedQuizId() === rec.quizId;
    await deleteSheet(rec.id);
    const id = this.cls()?.id;
    if (id) this.sheets.set(await listSheets({ classId: id }));
    if (wasSelected) this.selectedQuizId.set(this.records()[0]?.quizId || null);
    this.openQuestion.set(null);
    this.toast.toast('Result removed', false, {
      text: 'Undo',
      handler: async () => {
        if (!raw) { this.toast.toast('Could not restore that result', true); return; }
        await saveSheet(raw);
        const classId = this.cls()?.id;
        if (classId) this.sheets.set(await listSheets({ classId }));
        this.selectedQuizId.set(rec.quizId);
        this.toast.toast('Result restored');
      }
    });
  }
}
