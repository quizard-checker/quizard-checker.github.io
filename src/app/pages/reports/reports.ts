import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { IonContent } from '@ionic/angular';
import { listSheets, listClasses, listQuizzes, getQuiz, type SheetResult } from '../../core/engine/storage.js';
import { itemAnalysis, resultsCsv, sectionBreakdown, scoreDistribution, quizAverages, learningTrend } from '../../core/engine/reports.js';
import { exportClassReportPdf, exportReviewPdf } from '../../core/engine/export.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { fmtDate, bannerTheme } from '../../shared/helpers.js';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ByokService } from '../../core/services/byok.service';

@Component({
  selector: 'app-reports',
  imports: [IonContent, IcoPipe],
  templateUrl: './reports.html',
})
export class ReportsPage {
  router = inject(Router);
  ui = inject(UiStateService);
  readonly byok = inject(ByokService);
  private toast = inject(ToastService);
  private location = inject(Location);

  // Results isn't a tab, so the overview needs its own way out — step back to
  // wherever the teacher came from (create, a roster), or classes as a floor.
  goBack() {
    if (history.length > 1) this.location.back();
    else this.router.navigateByUrl('/tabs/classes');
  }

  sheets = signal<SheetResult[]>([]);
  classes = signal<any[]>([]);
  quizzes = signal<any[]>([]);
  selectedClassId = signal<string | null>(null);
  // A class view is scoped to ONE quiz — a pill row switches when a class has
  // checked sheets from more than one quiz, so numbers never mix papers.
  pickedQuizId = signal<string | null>(null);

  readonly dateOf = fmtDate;
  // Class tiles on the overview wear the same hashed gradients as the
  // Classes/Keys/Create boards — one visual language across the app.
  readonly bannerTheme = bannerTheme;

  readonly classSub = (cls: any): string => {
    const parts: string[] = [];
    if (cls?.subject) parts.push(cls.subject);
    const gs = [cls?.grade, cls?.section].filter(Boolean).join(' — ');
    if (gs) parts.push(gs);
    return parts.join(' · ');
  };

  // Overview cards: every class's average on every quiz it has checked, plus
  // whether the majority improved — no blended average across different tests.
  readonly classSummaries = computed(() =>
    this.classes().map(cls => {
      const sheets = this.sheets().filter(s => s.classId === cls.id);
      const rows = quizAverages(sheets).map(r => ({ ...r, label: this.quizLabel(r.quizId) }));
      return { cls, checked: sheets.length, rows, learning: learningTrend(sheets) };
    }));

  private quizLabel(id: string | null): string {
    if (!id) return '';
    const q = this.quizzes().find(x => x.id === id);
    return q ? `${q.subject || 'Quiz'}${q.title ? ' — ' + q.title : ''}` : 'Quiz';
  }

  async ionViewWillEnter() {
    await this.refresh();
    // Landing from a quiz's detail page (?quiz=): open that quiz's class view
    // with its pill already selected.
    const qm = /[?&]quiz=([A-Za-z0-9-]+)/.exec(this.router.url || '');
    if (!qm) return;
    const row = this.sheets().find(s => s.quizId === qm[1]);
    if (!row) return;
    if (this.selectedClassId() !== row.classId) await this.openClass(row.classId);
    this.pickedQuizId.set(qm[1]);
    void getQuiz(qm[1]).then(q => this.quiz.set(q));
  }

  async refresh() {
    const [sheets, classes, quizzes] = await Promise.all([listSheets(), listClasses(), listQuizzes()]);
    this.sheets.set(sheets);
    this.quizzes.set(quizzes);
    // classes that have checked sheets, in check order
    const withSheets = classes.filter(c => sheets.some(s => s.classId === c.id));
    this.classes.set(withSheets);
    if (this.selectedClassId() && !withSheets.some(c => c.id === this.selectedClassId())) {
      this.selectedClassId.set(null);
      this.pickedQuizId.set(null);
    }
    // keep the quiz filter pointing at a quiz the class actually has
    const selId = this.selectedClassId();
    if (selId) {
      const ids = this.quizIdsOf(selId);
      if (!ids.includes(this.pickedQuizId() || '')) this.pickedQuizId.set(ids[0] || null);
      this.quiz.set(this.pickedQuizId() ? await getQuiz(this.pickedQuizId()!) : null);
    }
  }

  private quizIdsOf(classId: string): string[] {
    return [...new Set(this.sheets().filter(s => s.classId === classId).map(s => s.quizId))];
  }

  // One row per quiz the class has checked, oldest first, with the point
  // change from the previous quiz. Rows act as the quiz filter.
  readonly quizRows = computed(() => {
    const rows = quizAverages(this.classSheets());
    return rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      return {
        ...r,
        label: this.quizLabel(r.quizId),
        delta: prev ? r.avg - prev.avg : null,
        // A one-paper quiz can swing the average wildly; only color a change
        // when both quizzes have at least two papers behind them.
        deltaComparable: !!prev && prev.count >= 2 && r.count >= 2,
      };
    });
  });

  readonly learning = computed(() => learningTrend(this.classSheets()));
  readonly learningFrom = computed(() => this.quizLabel(this.learning().fromQuizId));

  learningTitle(): string {
    const l = this.learning();
    if (l.status === 'insufficient') {
      return l.basis === 'average' ? 'Not enough shared students' : 'Not enough data for a trend';
    }
    if (l.basis === 'students') {
      if (l.status === 'improving') return 'Majority of the class is improving';
      if (l.status === 'slipping') return 'Most students are not improving yet';
      return 'The class is split';
    }
    if (l.status === 'improving') return 'Class average is up';
    if (l.status === 'slipping') return 'Class average is down';
    return 'Class average held steady';
  }

  learningSub(): string {
    const l = this.learning();
    if (l.status === 'insufficient') {
      if (l.basis === 'average') {
        const who = l.compared === 1
          ? 'Only one student took both quizzes'
          : 'No student took both quizzes';
        const papers = (n: number | null) => `${n ?? 0} paper${n === 1 ? '' : 's'}`;
        return `${who}, so this is not a majority trend. Class averages: ${l.fromAvg}% (${papers(l.fromCount)}) → ${l.toAvg}% (${papers(l.toCount)}).`;
      }
      return 'This class has one checked quiz. Check another quiz to compare.';
    }
    if (l.basis === 'students') {
      if (l.status === 'improving') return `${l.improved} of ${l.compared} students scored higher than on ${this.learningFrom()}.`;
      if (l.status === 'slipping') return `${l.declined} of ${l.compared} students scored lower than on ${this.learningFrom()}.`;
      return `${l.improved} improved and ${l.declined} slipped since ${this.learningFrom()}.`;
    }
    return `${l.fromAvg}% → ${l.toAvg}% since ${this.learningFrom()}.`;
  }

  // Compact badge for the overview cards.
  learningChip(l: any): string {
    if (l.status === 'insufficient') {
      if (l.basis === 'average') return l.compared === 1 ? '1 in both' : 'none in both';
      return '1 quiz';
    }
    if (l.basis === 'students') {
      if (l.status === 'improving') return `${l.improved}/${l.compared} up`;
      if (l.status === 'slipping') return `${l.declined}/${l.compared} down`;
      return `${l.improved} up · ${l.declined} down`;
    }
    return l.avgDelta === 0 ? 'avg flat' : `avg ${l.avgDelta > 0 ? '+' : ''}${l.avgDelta}`;
  }

  setQuizFilter(id: string) {
    this.pickedQuizId.set(id);
    void getQuiz(id).then(q => this.quiz.set(q));
  }

  readonly selectedClass = computed(() => this.classes().find(c => c.id === this.selectedClassId()) || null);
  readonly classSheets = computed(() =>
    this.sheets().filter(s => s.classId === this.selectedClassId()));
  // The one quiz the view is scoped to — every stat, chart, and export below
  // reads this, so a second quiz's papers never blend into the numbers.
  readonly activeSheets = computed(() =>
    this.classSheets().filter(s => !this.pickedQuizId() || s.quizId === this.pickedQuizId()));
  readonly classAvg = computed(() => {
    const s = this.activeSheets();
    return s.length ? Math.round(s.reduce((sum, x) => sum + x.percent, 0) / s.length) : 0;
  });
  readonly best = computed(() => this.activeSheets().slice().sort((a, b) => b.percent - a.percent)[0] || null);
  readonly hardest = computed(() => this.activeSheets().slice().sort((a, b) => a.percent - b.percent)[0] || null);

  readonly quiz = signal<any>(null);
  readonly analysis = computed(() => {
    const q = this.quiz();
    if (!q) return [];
    return itemAnalysis(this.activeSheets(), q.items);
  });
  readonly sections = computed(() => sectionBreakdown(this.activeSheets()));
  readonly distribution = computed(() => scoreDistribution(this.activeSheets()));

  // Bar height for the distribution histogram, scaled to the busiest band so
  // a small class stretches its chart the same way a big one does.
  distHeight(d: { count: number }) {
    const counts = this.distribution().map(x => x.count);
    const max = Math.max(...counts, 1);
    return d.count ? Math.max(10, Math.round((d.count / max) * 100)) : 0;
  }

  async openClass(id: string) {
    this.selectedClassId.set(id);
    const quizId = this.sheets().find(s => s.classId === id)?.quizId || null;
    this.pickedQuizId.set(quizId);
    this.quiz.set(quizId ? await getQuiz(quizId) : null);
  }

  backToOverview() { this.selectedClassId.set(null); this.quiz.set(null); this.pickedQuizId.set(null); }

  async exportCsv() {
    const quiz = this.quiz();
    if (!quiz) return;
    const csv = resultsCsv(this.activeSheets(), quiz.items);
    this.download(`quizard-results-${slug(this.selectedClass()?.name)}.csv`, csv, 'text/csv');
    this.toast.toast('CSV downloaded ✓');
  }

  async exportPdf() {
    const cls = this.selectedClass(), quiz = this.quiz();
    if (!cls || !quiz) return;
    await exportClassReportPdf(cls, quiz, this.activeSheets(), this.analysis());
    this.toast.toast('Report PDF downloaded ✓');
  }

  // Per-student answer review: every option, the pick and the key, one page each.
  async exportReview() {
    const quiz = this.quiz();
    if (!quiz) return;
    await exportReviewPdf(quiz, this.activeSheets());
    this.toast.toast('Review PDF downloaded ✓');
  }

  private download(filename: string, content: string, mime: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}

function slug(name: string) {
  return String(name || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'class';
}
