import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  scanOutline, scan, settingsOutline, settings, homeOutline, home
} from 'ionicons/icons';

// Eager shell: under zoneless CD (Angular 22 makes OnPush the default) an
// OnPush shell strands ion-router-outlet pages — they stay `ion-page-invisible`,
// skip their enter transition and deep-linked pages never go live. Required on
// every component between the root and the outlet (see Ionic zoneless guide).
@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './tabs.html',
})
export class TabsPage {
  constructor() {
    addIcons({
      scanOutline, scan, settingsOutline, settings
    });
  }
}
