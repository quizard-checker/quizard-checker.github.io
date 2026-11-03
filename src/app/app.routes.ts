import { Routes } from '@angular/router';

// Teacher app (see PLAN.md): the student shell is retired. Old student pages
// stay on disk until the Phase 4 cleanup but are no longer routed or bundled.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'welcome' },
  {
    path: 'welcome',
    loadComponent: () => import('./pages/welcome/welcome').then(m => m.WelcomePage)
  },
  {
    path: 'accounts',
    loadComponent: () => import('./pages/accounts/accounts').then(m => m.AccountsPage)
  },
  {
    path: 'quiz',
    loadComponent: () => import('./pages/create/create').then(m => m.CreatePage)
  },
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs').then(m => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./pages/home/home').then(m => m.HomePage) },
      { path: 'classes/:id', loadComponent: () => import('./pages/class-roster/class-roster').then(m => m.ClassRosterPage) },
      { path: 'classes/:id/students/:studentId', loadComponent: () => import('./pages/student-results/student-results').then(m => m.StudentResultsPage) },
      { path: 'keys', loadComponent: () => import('./pages/keys/keys').then(m => m.KeysPage) },
      { path: 'checking', loadComponent: () => import('./pages/checking/checking').then(m => m.CheckingPage) },
      { path: 'reports', loadComponent: () => import('./pages/reports/reports').then(m => m.ReportsPage) },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsPage) },
      // old tab paths — land on Home (query params carry over)
      { path: 'create', redirectTo: 'home' },
      { path: 'classes', redirectTo: 'home' }
    ]
  },
  { path: '**', redirectTo: 'welcome' }
];
