import { ChangeDetectionStrategy, Component, inject, model } from '@angular/core';

import { DemoSettingsService, SimulatedLatency } from '../core/data/demo-settings.service';
import { I18nService } from '../core/i18n/i18n.service';
import { ThemePreference, ThemeService } from '../core/theme/theme.service';
import { Button } from '../shared/ui/button/button';
import { Drawer } from '../shared/ui/drawer/drawer';
import { Icon, IconName } from '../shared/ui/icon/icon';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly labelKey: string;
  readonly icon: IconName;
}

interface LatencyOption {
  readonly value: SimulatedLatency;
  readonly labelKey: string;
}

/**
 * Appearance and prototype controls.
 *
 * The prototype half of this panel exists because loading, empty and error
 * states are part of the product and have to be reachable during review. It is
 * deleted together with the mock gateway when a real service is connected,
 * which is why its markup is local rather than pulled from the design system.
 */
@Component({
  selector: 'app-settings-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Drawer, Button, Icon],
  styleUrl: './settings-drawer.scss',
  template: `
    <app-drawer [(open)]="open" [title]="i18n.t('theme.label')">
      <div class="settings">
        <fieldset class="settings__group">
          <legend class="settings__legend">{{ i18n.t('theme.label') }}</legend>
          <div class="settings__segmented">
            @for (option of themeOptions; track option.value) {
              <label class="settings__segment">
                <input
                  type="radio"
                  name="appearance"
                  class="settings__radio"
                  [value]="option.value"
                  [checked]="theme.preference() === option.value"
                  (change)="theme.set(option.value)"
                />
                <span class="settings__segment-face">
                  <app-icon [name]="option.icon" size="md" />
                  <span>{{ i18n.t(option.labelKey) }}</span>
                </span>
              </label>
            }
          </div>
        </fieldset>

        <hr class="u-divider" />

        <section class="settings__group">
          <h3 class="settings__legend">{{ i18n.t('demo.title') }}</h3>
          <p class="settings__note">{{ i18n.t('demo.description') }}</p>

          <fieldset class="settings__group settings__group--nested">
            <legend class="settings__sublegend">{{ i18n.t('demo.latency') }}</legend>
            <div class="settings__segmented">
              @for (option of latencyOptions; track option.value) {
                <label class="settings__segment">
                  <input
                    type="radio"
                    name="latency"
                    class="settings__radio"
                    [value]="option.value"
                    [checked]="demo.latency() === option.value"
                    (change)="demo.setLatency(option.value)"
                  />
                  <span class="settings__segment-face">{{ i18n.t(option.labelKey) }}</span>
                </label>
              }
            </div>
          </fieldset>

          <label class="settings__toggle">
            <input
              type="checkbox"
              class="settings__checkbox"
              [checked]="demo.failNext()"
              (change)="demo.setFailNext(isChecked($event))"
            />
            <span class="settings__toggle-body">
              <span class="settings__toggle-label">{{ i18n.t('demo.failNext') }}</span>
              <span class="settings__note">{{ i18n.t('demo.failNextHint') }}</span>
            </span>
          </label>

          <label class="settings__toggle">
            <input
              type="checkbox"
              class="settings__checkbox"
              [checked]="demo.emptyData()"
              (change)="demo.setEmptyData(isChecked($event))"
            />
            <span class="settings__toggle-body">
              <span class="settings__toggle-label">{{ i18n.t('demo.emptyData') }}</span>
              <span class="settings__note">{{ i18n.t('demo.emptyDataHint') }}</span>
            </span>
          </label>

          <app-button variant="secondary" size="sm" icon="refresh" (pressed)="demo.reset()">
            {{ i18n.t('demo.reset') }}
          </app-button>
        </section>

        <hr class="u-divider" />

        <p class="settings__note settings__note--prototype">
          <app-icon name="info" size="sm" />
          <span>{{ i18n.t('app.prototypeNotice') }}</span>
        </p>
      </div>
    </app-drawer>
  `,
})
export class SettingsDrawer {
  readonly open = model.required<boolean>();

  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly demo = inject(DemoSettingsService);

  protected readonly themeOptions: readonly ThemeOption[] = [
    { value: 'system', labelKey: 'theme.system', icon: 'monitor' },
    { value: 'light', labelKey: 'theme.light', icon: 'sun' },
    { value: 'dark', labelKey: 'theme.dark', icon: 'moon' },
  ];

  protected readonly latencyOptions: readonly LatencyOption[] = [
    { value: 'none', labelKey: 'demo.latencyNone' },
    { value: 'fast', labelKey: 'demo.latencyFast' },
    { value: 'slow', labelKey: 'demo.latencySlow' },
  ];

  protected isChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
