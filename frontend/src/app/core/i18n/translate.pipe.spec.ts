import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { text } from '../../shared/testing/dom';
import { I18nService } from './i18n.service';
import { LocalizedTextPipe, TranslatePipe, TranslatePluralPipe } from './translate.pipe';

@Component({
  imports: [TranslatePipe, TranslatePluralPipe, LocalizedTextPipe],
  template: `
    <p class="plain">{{ 'common.submit' | t }}</p>
    <p class="params">{{ 'common.step' | t: { current: current(), total: 4 } }}</p>
    <p class="plural">{{ 'units.requests' | tPlural: count() }}</p>
    <p class="localized">{{ department | localized }}</p>
    <p class="missing">{{ 'not.a.real.key' | t }}</p>
  `,
})
class Host {
  readonly current = signal(1);
  readonly count = signal(3);
  readonly department = { en: 'Civil Affairs', ar: 'الأحوال المدنية' };
}

describe('translate pipes', () => {
  let fixture: ComponentFixture<Host>;
  let i18n: I18nService;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    i18n = await setupI18n();
    fixture = TestBed.createComponent(Host);
    await render();
  });

  it('translates a plain key', () => {
    expect(text(fixture, '.plain')).toBe('Submit');
  });

  it('interpolates parameters', () => {
    expect(text(fixture, '.params')).toBe('Step 1 of 4');
  });

  it('re-evaluates when a parameter changes even though the key did not', async () => {
    fixture.componentInstance.current.set(3);
    await render();

    expect(text(fixture, '.params')).toBe('Step 3 of 4');
  });

  /**
   * The reason the pipe is impure. A pure pipe memoises on argument identity,
   * and the message key does not change when the language does, so a pure pipe
   * would keep showing English forever.
   */
  it('re-translates the same key after a language switch', async () => {
    expect(text(fixture, '.plain')).toBe('Submit');

    await i18n.setLanguage('ar');
    await render();

    expect(text(fixture, '.plain')).toBe('إرسال');
  });

  it('selects the plural form for the count', async () => {
    expect(text(fixture, '.plural')).toBe('3 requests');

    fixture.componentInstance.count.set(1);
    await render();
    expect(text(fixture, '.plural')).toBe('1 request');

    fixture.componentInstance.count.set(0);
    await render();
    expect(text(fixture, '.plural')).toBe('No requests');
  });

  it('uses Arabic plural categories after a language switch', async () => {
    await i18n.setLanguage('ar');
    fixture.componentInstance.count.set(2);
    await render();

    expect(text(fixture, '.plural')).toBe('طلبان');
  });

  it('picks the right side of a bilingual data value', async () => {
    expect(text(fixture, '.localized')).toBe('Civil Affairs');

    await i18n.setLanguage('ar');
    await render();

    expect(text(fixture, '.localized')).toBe('الأحوال المدنية');
  });

  it('shows the key itself when a message is missing, rather than nothing', () => {
    expect(text(fixture, '.missing')).toBe('not.a.real.key');
  });
});
