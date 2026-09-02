import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { DocumentRequirement, DraftDocument } from '../../core/models/domain';
import { Alert } from '../../shared/ui/alert/alert';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';
import { acceptAttributeFor, fieldAnchorId, formatAcceptedFormats } from './wizard-model';

/** What the step hands back when someone picks a file. */
export interface DocumentChoice {
  readonly requirement: DocumentRequirement;
  readonly file: File;
}

/**
 * Step three: the copies that have to travel with the application.
 *
 * One control per requirement, because a single "add files" box makes the
 * applicant work out which of five documents they have actually attached. Each
 * requirement states its accepted formats and its size limit before a file is
 * chosen, not after it is rejected.
 *
 * The input is a real `<input type="file">`, visually hidden but still in the
 * tab order and still labelled, with the button drawn by its own label. A `div`
 * with a click handler would lose keyboard access and the platform's file
 * picker announcement.
 *
 * Nothing is transmitted anywhere. The banner at the top of the step says so,
 * and no wording in here claims otherwise: a file is "chosen", never "uploaded".
 */
@Component({
  selector: 'app-citizen-documents-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, Button, Icon],
  styleUrl: './documents-step.scss',
  host: {
    class: 'documents-step',
  },
  template: `
    <fieldset class="documents-step__fieldset">
      <legend class="documents-step__legend">{{ i18n.t('citizen.wizard.documentsLegend') }}</legend>
      <p class="documents-step__hint">{{ i18n.t('citizen.wizard.documentsHint') }}</p>

      <app-alert tone="info" class="documents-step__notice">
        {{ i18n.t('app.prototypeNotice') }}
      </app-alert>

      <ul class="documents-step__list">
        @for (requirement of requirements(); track requirement.id) {
          <li
            class="upload"
            [class.upload--invalid]="!!errorFor(requirement)"
            [id]="anchorFor(requirement.id)"
          >
            <div class="upload__heading">
              <p class="upload__name">
                <span>{{ i18n.pick(requirement.name) }}</span>
                @if (requirement.required) {
                  <span class="upload__required" aria-hidden="true">*</span>
                  <span class="u-visually-hidden">{{ i18n.t('a11y.requiredField') }}</span>
                } @else {
                  <span class="upload__optional">{{ i18n.t('common.optional') }}</span>
                }
              </p>
              <p class="upload__accepted" [id]="hintIdFor(requirement)">
                {{ acceptedText(requirement) }}
              </p>
            </div>

            @if (attachmentFor(requirement); as chosen) {
              <p class="upload__file">
                <app-icon name="paperclip" size="md" class="upload__file-icon" />
                <span class="upload__file-name">{{ chosen.fileName }}</span>
                <span class="upload__file-size">{{ i18n.formatFileSize(chosen.sizeKb) }}</span>
                <app-button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  (pressed)="removed.emit(requirement.id)"
                >
                  {{ i18n.t('citizen.wizard.removeFile') }}
                </app-button>
              </p>
            }

            <div class="upload__control">
              <input
                type="file"
                class="upload__input"
                [id]="inputIdFor(requirement)"
                [accept]="acceptFor(requirement)"
                [attr.aria-describedby]="describedByFor(requirement)"
                [attr.aria-invalid]="errorFor(requirement) ? 'true' : null"
                (change)="handleChange(requirement, $event)"
              />
              <label class="upload__button" [attr.for]="inputIdFor(requirement)">
                <app-icon name="paperclip" size="md" />
                <span>{{ buttonLabel(requirement) }}</span>
              </label>
            </div>

            @if (errorFor(requirement); as message) {
              <p class="upload__error" [id]="errorIdFor(requirement)">
                <app-icon name="alert-circle" size="sm" />
                <span>{{ message }}</span>
              </p>
            }
          </li>
        }
      </ul>
    </fieldset>
  `,
})
export class CitizenDocumentsStep {
  readonly requirements = input<readonly DocumentRequirement[]>([]);

  /** What has been attached so far, keyed by requirement id. */
  readonly attachments = input<Readonly<Record<string, DraftDocument>>>({});

  /** Already localised messages, keyed by requirement id. */
  readonly errors = input<Readonly<Record<string, string>>>({});

  readonly idPrefix = input.required<string>();

  readonly chose = output<DocumentChoice>();
  readonly removed = output<string>();

  protected readonly i18n = inject(I18nService);

  protected anchorFor(requirementId: string): string {
    return fieldAnchorId(this.idPrefix(), `document-${requirementId}`);
  }

  protected inputIdFor(requirement: DocumentRequirement): string {
    return `${this.anchorFor(requirement.id)}-input`;
  }

  protected hintIdFor(requirement: DocumentRequirement): string {
    return `${this.anchorFor(requirement.id)}-hint`;
  }

  protected errorIdFor(requirement: DocumentRequirement): string {
    return `${this.anchorFor(requirement.id)}-error`;
  }

  /** The accepted formats always describe the control; the error joins them. */
  protected describedByFor(requirement: DocumentRequirement): string {
    const ids = [this.hintIdFor(requirement)];
    if (this.errorFor(requirement)) {
      ids.push(this.errorIdFor(requirement));
    }
    return ids.join(' ');
  }

  protected attachmentFor(requirement: DocumentRequirement): DraftDocument | null {
    return this.attachments()[requirement.id] ?? null;
  }

  protected errorFor(requirement: DocumentRequirement): string | null {
    return this.errors()[requirement.id] ?? null;
  }

  protected acceptedText(requirement: DocumentRequirement): string {
    return this.i18n.t('citizen.wizard.accepted', {
      formats: formatAcceptedFormats(requirement.formats),
      size: this.i18n.formatFileSize(requirement.maxSizeMb * 1024),
    });
  }

  protected acceptFor(requirement: DocumentRequirement): string {
    return acceptAttributeFor(requirement.formats);
  }

  protected buttonLabel(requirement: DocumentRequirement): string {
    return this.attachmentFor(requirement)
      ? this.i18n.t('citizen.wizard.replaceFile')
      : this.i18n.t('citizen.wizard.chooseFile');
  }

  /**
   * The input is cleared straight after reading the file. Without that, choosing
   * the same file again after removing it fires no change event, because the
   * input's value has not changed.
   */
  protected handleChange(requirement: DocumentRequirement, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) {
      this.chose.emit({ requirement, file });
    }
  }
}
