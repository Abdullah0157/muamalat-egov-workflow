import { Pipe, PipeTransform, inject } from '@angular/core';

import { paramsEqual } from './catalogue';
import { I18nService } from './i18n.service';
import { MessageParams } from './i18n.types';

/**
 * `{{ 'nav.requests' | t }}` and `{{ 'sla.remaining' | t: { time: value } }}`.
 *
 * The pipe is impure on purpose. A pure pipe is only re-evaluated when its
 * arguments change by identity, and the message key does not change when the
 * user switches language, so a pure pipe would hand back a stale English
 * string forever. Being impure costs one integer comparison per change
 * detection pass because the result is memoised below, and under zoneless
 * change detection those passes only happen when something actually changed.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  private cachedKey: string | null = null;
  private cachedParams: MessageParams | undefined;
  private cachedRevision = -1;
  private cachedValue = '';

  transform(key: string, params?: MessageParams): string {
    const revision = this.i18n.revision();
    if (
      revision !== this.cachedRevision ||
      key !== this.cachedKey ||
      !paramsEqual(params, this.cachedParams)
    ) {
      this.cachedRevision = revision;
      this.cachedKey = key;
      this.cachedParams = params;
      this.cachedValue = this.i18n.t(key, params);
    }
    return this.cachedValue;
  }
}

/**
 * `{{ 'inbox.count' | tPlural: n }}`. Kept separate from `t` so the count is a
 * real argument rather than a magic parameter name.
 */
@Pipe({ name: 'tPlural', pure: false })
export class TranslatePluralPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  private cachedKey: string | null = null;
  private cachedCount = Number.NaN;
  private cachedRevision = -1;
  private cachedValue = '';

  transform(key: string, count: number): string {
    const revision = this.i18n.revision();
    if (revision !== this.cachedRevision || key !== this.cachedKey || count !== this.cachedCount) {
      this.cachedRevision = revision;
      this.cachedKey = key;
      this.cachedCount = count;
      this.cachedValue = this.i18n.plural(key, count);
    }
    return this.cachedValue;
  }
}

/** Selects the right side of a bilingual field carried on a data record. */
@Pipe({ name: 'localized', pure: false })
export class LocalizedTextPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(value: { en: string; ar: string } | null | undefined): string {
    return this.i18n.pick(value);
  }
}
