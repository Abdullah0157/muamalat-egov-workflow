import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { findDepartment } from '../../core/data/service-catalogue';
import { I18nService } from '../../core/i18n/i18n.service';
import { ServiceDefinition } from '../../core/models/domain';
import { Icon } from '../../shared/ui/icon/icon';
import { fieldAnchorId } from './wizard-model';

/**
 * Step one: which service do you need.
 *
 * A real radio group in a real fieldset. The card treatment is styling on top
 * of native radios, so arrow key navigation, the "one of four" announcement and
 * the browser's own required handling all come from the platform. Nothing here
 * is a div pretending to be a control.
 *
 * Each option carries the two facts that decide the choice: how long the
 * ministry has to process it, and what it costs. Hiding those behind the
 * selection would make someone pick a service to find out.
 */
@Component({
  selector: 'app-citizen-service-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './service-step.scss',
  host: {
    class: 'service-step',
  },
  template: `
    <fieldset class="service-step__fieldset" [id]="anchorId()">
      <legend class="service-step__legend">{{ i18n.t('citizen.wizard.serviceLegend') }}</legend>
      <p class="service-step__hint" [id]="hintId()">{{ i18n.t('citizen.wizard.serviceHint') }}</p>

      <div class="service-step__options">
        @for (service of services(); track service.id) {
          <div class="service-option" [class.service-option--selected]="selected() === service.id">
            <input
              type="radio"
              class="service-option__input"
              [id]="optionId(service)"
              [name]="groupName()"
              [value]="service.id"
              [checked]="selected() === service.id"
              [attr.aria-describedby]="hintId()"
              (change)="chose.emit(service.id)"
            />
            <label class="service-option__label" [attr.for]="optionId(service)">
              <span class="service-option__name">{{ i18n.pick(service.name) }}</span>
              <span class="service-option__description">{{ i18n.pick(service.description) }}</span>

              <span class="service-option__facts">
                <span class="service-option__fact">
                  <app-icon name="building" size="sm" />
                  <span class="service-option__fact-label">{{ i18n.t('common.department') }}</span>
                  <span class="service-option__fact-value">{{ departmentName(service) }}</span>
                </span>

                <span class="service-option__fact">
                  <app-icon name="clock" size="sm" />
                  <span class="service-option__fact-label">{{ i18n.t('common.sla') }}</span>
                  <span class="service-option__fact-value">{{ processingTime(service) }}</span>
                </span>

                <span class="service-option__fact">
                  <app-icon name="stamp" size="sm" />
                  <span class="service-option__fact-label">{{ i18n.t('common.fee') }}</span>
                  <span class="service-option__fact-value">{{ fee(service) }}</span>
                </span>
              </span>
            </label>
          </div>
        }
      </div>
    </fieldset>
  `,
})
export class CitizenServiceStep {
  readonly services = input<readonly ServiceDefinition[]>([]);
  readonly selected = input<string | null>(null);

  /** The wizard's instance prefix, so ids are unique on the page. */
  readonly idPrefix = input.required<string>();

  readonly chose = output<string>();

  protected readonly i18n = inject(I18nService);

  protected anchorId(): string {
    return fieldAnchorId(this.idPrefix(), 'service');
  }

  protected hintId(): string {
    return `${this.anchorId()}-hint`;
  }

  /** One name for the whole group, which is what makes the radios exclusive. */
  protected groupName(): string {
    return `${this.idPrefix()}-service`;
  }

  protected optionId(service: ServiceDefinition): string {
    return `${this.groupName()}-${service.id}`;
  }

  protected departmentName(service: ServiceDefinition): string {
    const department = findDepartment(service.departmentId);
    return department ? this.i18n.pick(department.name) : this.i18n.t('common.notAvailable');
  }

  /**
   * Stated in hours rather than as "2 d 0 h", because the statutory window is
   * written in hours in the regulation and that is the number a citizen will be
   * quoted at the counter.
   */
  protected processingTime(service: ServiceDefinition): string {
    return this.i18n.plural('units.hours', service.slaHours);
  }

  protected fee(service: ServiceDefinition): string {
    return service.feeKwd === 0
      ? this.i18n.t('common.free')
      : this.i18n.formatCurrency(service.feeKwd);
  }
}
