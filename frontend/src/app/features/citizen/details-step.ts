import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { I18nService } from '../../core/i18n/i18n.service';
import { ServiceDefinition, ServiceField } from '../../core/models/domain';
import { validationMessage } from '../../shared/forms/validation-messages';
import { DatePicker } from '../../shared/ui/date-picker/date-picker';
import { Select, SelectOption } from '../../shared/ui/select/select';
import { TextField } from '../../shared/ui/text-field/text-field';
import { Textarea } from '../../shared/ui/textarea/textarea';
import { fieldAnchorId } from './wizard-model';

/**
 * Step two: the questions the chosen service asks.
 *
 * The form is generated from the service definition rather than written out per
 * service, which is what makes adding a service a data change. The field type in
 * the catalogue picks the control, and the label and hint come off the record in
 * both languages, so a new service is translated by whoever adds it rather than
 * by a later code change.
 *
 * Two questions are asked of every service and so are declared here: the number
 * to send the reference to, and how urgent the applicant considers it.
 */
@Component({
  selector: 'app-citizen-details-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePicker, ReactiveFormsModule, Select, TextField, Textarea],
  styleUrl: './details-step.scss',
  host: {
    class: 'details-step',
  },
  template: `
    <fieldset class="details-step__fieldset" [formGroup]="form()">
      <legend class="details-step__legend">{{ i18n.t('citizen.wizard.detailsLegend') }}</legend>
      <p class="details-step__hint">{{ i18n.t('citizen.wizard.detailsHint') }}</p>

      <div class="details-step__grid">
        @for (field of service().fields; track field.id) {
          <div
            class="details-step__field"
            [class.details-step__field--wide]="field.type === 'textarea'"
            [id]="anchorFor(field.id)"
          >
            @switch (field.type) {
              @case ('textarea') {
                <app-textarea
                  autoGrow
                  [formControlName]="field.id"
                  [label]="labelFor(field)"
                  [hint]="hintFor(field)"
                  [maxLength]="field.maxLength"
                  [required]="field.required"
                  [showOptional]="!field.required"
                  [error]="errorFor(field.id, labelFor(field))"
                />
              }
              @case ('select') {
                <app-select
                  [formControlName]="field.id"
                  [label]="labelFor(field)"
                  [hint]="hintFor(field)"
                  [options]="optionsFor(field)"
                  [placeholder]="i18n.t('common.select')"
                  [required]="field.required"
                  [showOptional]="!field.required"
                  [error]="errorFor(field.id, labelFor(field))"
                />
              }
              @case ('date') {
                <app-date-picker
                  [formControlName]="field.id"
                  [label]="labelFor(field)"
                  [hint]="hintFor(field)"
                  [required]="field.required"
                  [showOptional]="!field.required"
                  [error]="errorFor(field.id, labelFor(field))"
                />
              }
              @case ('number') {
                <app-text-field
                  type="number"
                  inputMode="numeric"
                  [formControlName]="field.id"
                  [label]="labelFor(field)"
                  [hint]="hintFor(field)"
                  [required]="field.required"
                  [showOptional]="!field.required"
                  [error]="errorFor(field.id, labelFor(field))"
                />
              }
              @default {
                <app-text-field
                  [formControlName]="field.id"
                  [label]="labelFor(field)"
                  [hint]="hintFor(field)"
                  [maxLength]="field.maxLength"
                  [required]="field.required"
                  [showOptional]="!field.required"
                  [error]="errorFor(field.id, labelFor(field))"
                />
              }
            }
          </div>
        }

        <div class="details-step__field" [id]="anchorFor('contactPhone')">
          <!--
            Pinned left to right and tagged as a national number: a Kuwaiti
            mobile is eight digits with no country code, and it must not reorder
            itself inside Arabic text.
          -->
          <app-text-field
            required
            type="tel"
            inputMode="tel"
            autocomplete="tel-national"
            textDirection="ltr"
            icon="phone"
            formControlName="contactPhone"
            [maxLength]="8"
            [label]="i18n.t('citizen.wizard.contactPhone')"
            [hint]="i18n.t('citizen.wizard.contactPhoneHint')"
            [error]="errorFor('contactPhone', i18n.t('citizen.wizard.contactPhone'))"
          />
        </div>

        <div class="details-step__field" [id]="anchorFor('priority')">
          <app-select
            formControlName="priority"
            [label]="i18n.t('citizen.wizard.priorityLabel')"
            [hint]="i18n.t('citizen.wizard.priorityHint')"
            [options]="priorityOptions()"
            [error]="errorFor('priority', i18n.t('citizen.wizard.priorityLabel'))"
          />
        </div>
      </div>
    </fieldset>
  `,
})
export class CitizenDetailsStep {
  readonly service = input.required<ServiceDefinition>();
  readonly form = input.required<FormGroup>();
  readonly idPrefix = input.required<string>();

  protected readonly i18n = inject(I18nService);

  protected anchorFor(name: string): string {
    return fieldAnchorId(this.idPrefix(), name);
  }

  protected labelFor(field: ServiceField): string {
    return this.i18n.pick(field.label);
  }

  protected hintFor(field: ServiceField): string | null {
    return field.hint ? this.i18n.pick(field.hint) : null;
  }

  protected optionsFor(field: ServiceField): readonly SelectOption[] {
    return field.options.map((option) => ({
      value: option.value,
      label: this.i18n.pick(option.label),
    }));
  }

  protected priorityOptions(): readonly SelectOption[] {
    return [
      { value: 'normal', label: this.i18n.t('priority.normal') },
      { value: 'high', label: this.i18n.t('priority.high') },
      { value: 'urgent', label: this.i18n.t('priority.urgent') },
    ];
  }

  /**
   * Nothing is shown until the control has been touched or edited, so a form
   * does not open covered in errors for answers nobody has been given a chance
   * to give yet.
   */
  protected errorFor(name: string, label: string): string | null {
    return validationMessage(this.form().get(name), label, this.i18n);
  }
}
