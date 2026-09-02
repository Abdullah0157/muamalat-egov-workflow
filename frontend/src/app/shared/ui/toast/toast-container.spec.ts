import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { all, el, maybeEl, text } from '../../testing/dom';
import { ToastContainer } from './toast-container';
import { ToastService } from './toast.service';

describe('ToastContainer', () => {
  let fixture: ComponentFixture<ToastContainer>;
  let toasts: ToastService;

  // Every toast in here is raised with `durationMs: 0`, so nothing in this file
  // depends on a timer firing. Expiry is covered by the service spec.
  function raise(tone: 'info' | 'success' | 'warning' | 'danger', title: string, description?: string): string {
    return toasts.show({ tone, title, description, durationMs: 0 });
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastContainer],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    toasts = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(ToastContainer);
    await settle();
  });

  it('is a labelled polite live region that exists before anything arrives', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-live')).toBe('polite');
    expect(host.getAttribute('aria-label')).toBe('Notifications');
    expect(all(fixture, '.toast').length).toBe(0);
  });

  it('renders the title, the detail and a glyph for each message', async () => {
    raise('success', 'Draft saved', 'You can return to it from your list.');
    await settle();

    expect(text(fixture, '.toast__title')).toBe('Draft saved');
    expect(text(fixture, '.toast__description')).toContain('return to it');
    expect(maybeEl(fixture, '.toast app-icon.toast__icon')).not.toBeNull();
  });

  it('omits the detail line when there is none', async () => {
    raise('info', 'Copied to the clipboard');
    await settle();

    expect(maybeEl(fixture, '.toast__description')).toBeNull();
  });

  it('makes only error messages assertive', async () => {
    raise('success', 'Draft saved');
    raise('danger', 'The action was not applied');
    await settle();

    const rendered = all<HTMLElement>(fixture, '.toast');
    expect(rendered[0].hasAttribute('role')).toBeFalse();
    expect(rendered[1].getAttribute('role')).toBe('alert');
    expect(rendered[1].classList).toContain('toast--danger');
  });

  it('gives every dismiss control a translated accessible name', async () => {
    raise('info', 'Copied to the clipboard');
    await settle();

    expect(el(fixture, '.toast__dismiss button').getAttribute('aria-label')).toBe(
      'Dismiss notification',
    );
  });

  it('removes a message from the queue when it is dismissed', async () => {
    raise('info', 'Copied to the clipboard');
    await settle();

    el<HTMLButtonElement>(fixture, '.toast__dismiss button').click();
    await settle();

    expect(toasts.toasts().length).toBe(0);
    expect(all(fixture, '.toast').length).toBe(0);
  });

  it('runs the offered action and clears the message with it', async () => {
    const run = jasmine.createSpy('run');
    toasts.show({
      tone: 'success',
      title: 'Request KW-2026-0041 submitted',
      durationMs: 0,
      action: { label: 'View the request', run },
    });
    await settle();

    const action = el<HTMLButtonElement>(fixture, '.toast__content button');
    expect(action.textContent?.trim()).toBe('View the request');

    action.click();
    await settle();

    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.toasts().length).toBe(0);
  });

  it('pauses the stack while the pointer is over a message and resumes on leave', async () => {
    const pause = spyOn(toasts, 'pause').and.callThrough();
    const resume = spyOn(toasts, 'resume').and.callThrough();
    raise('info', 'Copied to the clipboard');
    await settle();

    const toast = el<HTMLElement>(fixture, '.toast');
    toast.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pause).toHaveBeenCalled();

    toast.dispatchEvent(new MouseEvent('mouseleave'));
    expect(resume).toHaveBeenCalled();
  });

  it('pauses the stack while focus is inside it', async () => {
    const pause = spyOn(toasts, 'pause').and.callThrough();
    const resume = spyOn(toasts, 'resume').and.callThrough();
    raise('info', 'Copied to the clipboard');
    await settle();

    const toast = el<HTMLElement>(fixture, '.toast');
    toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(pause).toHaveBeenCalled();

    toast.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(resume).toHaveBeenCalled();
  });

  it('renders the stack oldest first', async () => {
    raise('info', 'First');
    raise('info', 'Second');
    await settle();

    expect(all(fixture, '.toast__title').map((node) => node.textContent?.trim())).toEqual([
      'First',
      'Second',
    ]);
  });
});
