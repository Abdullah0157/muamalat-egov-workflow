import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { findDepartment } from '../../core/data/service-catalogue';
import { I18nService } from '../../core/i18n/i18n.service';
import { DraftDocument, ServiceDefinition, ServiceField } from '../../core/models/domain';
import { Button } from '../../shared/ui/button/button';
import { Checkbox } from '../../shared/ui/checkbox/checkbox';
import {
  WIZARD_STEP_DETAILS,
  WIZARD_STEP_DOCUMENTS,
  WIZARD_STEP_SERVICE,
  fieldAnchorId,
} from './wizard-model';

/**
 * Step four: everything about to be filed, and the declaration.
 *
 * Read only on purpose. An editable summary looks helpful and then produces a
 * form where the same answer exists in two places; the edit link goes back to
 * the step that owns the answer, so there is one control per question in the
 * whole wizard.
 *
 * The declaration is a real checkbox with a validator rather than a tick box
 * that only styles the submit button, because a declaration that was never
 * recorded is not a declaration.
 */
@Component({
  selector: 'app-citizen-review-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Checkbox, ReactiveFormsModule],
  styleUrl: './review-step.scss',
  host: {
    class: 'review-step',
  },
  template: `
    <fieldset class="review-step__fieldset">
      <legend class="review-step__legend">{{ i18n.t('citizen.wizard.reviewLegend') }}</legend>
      <p class="review-step__hint">{{ i18n.t('citizen.wizard.reviewHint') }}</p>

      <section class="review-group">
        <header class="review-group__header">
          <h2 class="review-group__title">{{ i18n.t('common.service') }}</h2>
          <app-button
            size="sm"
            variant="link"
            icon="edit"
            (pressed)="edit.emit(serviceStep)"
          >
            {{ i18n.t('common.edit') }}
            <span class="u-visually-hidden">, {{ i18n.t('citizen.wizard.stepService') }}</span>
          </app-button>
        </header>

        <dl class="u-fields">
          <div>
            <dt>{{ i18n.t('common.service') }}</dt>
            <dd>{{ i18n.pick(service().name) }}</dd>
          </div>
          <div>
            <dt>{{ i18n.t('common.department') }}</dt>
            <dd>{{ departmentName() }}</dd>
          </div>
          <div>
            <dt>{{ i18n.t('common.sla') }}</dt>
            <dd>{{ i18n.plural('units.hours', service().slaHours) }}</dd>
          </div>
          <div>
            <dt>{{ i18n.t('common.fee') }}</dt>
            <dd>{{ fee() }}</dd>
          </div>
        </dl>
      </section>

      <section class="review-group">
        <header class="review-group__header">
          <h2 class="review-group__title">{{ i18n.t('common.details') }}</h2>
          <app-button
            size="sm"
            variant="link"
            icon="edit"
            (pressed)="edit.emit(detailsStep)"
          >
            {{ i18n.t('common.edit') }}
            <span class="u-visually-hidden">, {{ i18n.t('citizen.wizard.stepDetails') }}</span>
          </app-button>
        </header>

        <dl class="u-fields">
          @for (field of service().fields; track field.id) {
            <div>
              <dt>{{ i18n.pick(field.label) }}</dt>
              <dd>{{ displayValue(field) }}</dd>
            </div>
          }
          <div>
            <dt>{{ i18n.t('citizen.wizard.contactPhone') }}</dt>
            <dd><span class="u-reference">{{ rawValue('contactPhone') }}</span></dd>
          </div>
          <div>
            <dt>{{ i18n.t('common.priority') }}</dt>
            <dd>{{ priorityLabel() }}</dd>
          </div>
        </dl>
      </section>

      <section class="review-group">
        <header class="review-group__header">
          <h2 class="review-group__title">{{ i18n.t('common.attachments') }}</h2>
          <app-button
            size="sm"
            variant="link"
            icon="edit"
            (pressed)="edit.emit(documentsStep)"
          >
            {{ i18n.t('common.edit') }}
            <span class="u-visually-hidden">, {{ i18n.t('citizen.wizard.stepDocuments') }}</span>
          </app-button>
        </header>

        @if (service().documents.length === 0) {
          <p class="review-group__none">{{ i18n.t('empty.noDocumentsTitle') }}</p>
        } @else {
          <dl class="u-fields">
            @for (requirement of service().documents; track requirement.id) {
              <div>
                <dt>{{ i18n.pick(requirement.name) }}</dt>
                <dd>
                  @if (attachmentFor(requirement.id); as chosen) {
                    <span class="review-group__file">{{ chosen.fileName }}</span>
                    <span class="review-group__file-size">
                      {{ i18n.formatFileSize(chosen.sizeKb) }}
                    </span>
                  } @else {
                    <span class="review-group__none">{{ i18n.t('common.none') }}</span>
                  }
                </dd>
              </div>
            }
          </dl>
        }
      </section>

      <div class="review-step__declaration" [id]="declarationAnchor()">
        <h2 class="review-group__title">{{ i18n.t('citizen.wizard.declaration') }}</h2>
        <app-checkbox
          required
          [formControl]="declaration()"
          [label]="i18n.t('citizen.wizard.declarationText')"
          [error]="declarationError()"
        />
      </div>
    </fieldset>
  `,
})
export class CitizenReviewStep {
  readonly service = input.required<ServiceDefinition>();

  /** The details step's group, read for its values rather than edited here. */
  readonly form = input.required<FormGroup>();

  readonly attachments = input<Readonly<Record<string, DraftDocument>>>({});
  readonly declaration = input.required<FormControl<boolean>>();
  readonly declarationError = input<string | null>(null);
  readonly idPrefix = input.required<string>();

  /** Carries the step index to return to. */
  readonly edit = output<number>();

  protected readonly i18n = inject(I18nService);

  protected readonly serviceStep = WIZARD_STEP_SERVICE;
  protected readonly detailsStep = WIZARD_STEP_DETAILS;
  protected readonly documentsStep = WIZARD_STEP_DOCUMENTS;

  protected declarationAnchor(): string {
    return fieldAnchorId(this.idPrefix(), 'declaration');
  }

  protected departmentName(): string {
    const department = findDepartment(this.service().departmentId);
    return department ? this.i18n.pick(department.name) : this.i18n.t('common.notAvailable');
  }

  protected fee(): string {
    const amount = this.service().feeKwd;
    return amount === 0 ? this.i18n.t('common.free') : this.i18n.formatCurrency(amount);
  }

  protected rawValue(name: string): string {
    const value = this.form().get(name)?.value;
    return value === null || value === undefined ? '' : String(value);
  }

  protected priorityLabel(): string {
    const value = this.rawValue('priority') || 'normal';
    return this.i18n.t(`priority.${value}`);
  }

  protected attachmentFor(requirementId: string): DraftDocument | null {
    return this.attachments()[requirementId] ?? null;
  }

  /**
   * Answers are echoed the way they were asked: a chosen option reads back as
   * its label rather than its stored code, and a date reads in the applicant's
   * own calendar rather than as an ISO string.
   */
  protected displayValue(field: ServiceField): string {
    const raw = this.rawValue(field.id).trim();
    if (raw === '') {
      return this.i18n.t('common.notSet');
    }
    switch (field.type) {
      case 'select': {
        const option = field.options.find((candidate) => candidate.value === raw);
        return option ? this.i18n.pick(option.label) : raw;
      }
      case 'date': {
        const day = toCalendarDay(raw);
        return day ? this.i18n.formatDate(day) : raw;
      }
      case 'number': {
        const parsed = Number(raw);
        return Number.isNaN(parsed) ? raw : this.i18n.formatNumber(parsed);
      }
      default:
        return raw;
    }
  }
}

/**
 * Reads `yyyy-mm-dd` as a calendar day rather than as an instant.
 *
 * `new Date('2026-03-01')` is midnight UTC, which prints as the previous day
 * anywhere west of Greenwich. A date on a government form is a day, not a
 * moment, so the parts are used directly.
 */
function toCalendarDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
