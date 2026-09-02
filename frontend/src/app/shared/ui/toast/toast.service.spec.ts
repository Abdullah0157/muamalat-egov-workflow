import { TestBed } from '@angular/core/testing';

import { TOAST_DEFAULT_DURATION_MS, TOAST_VISIBLE_LIMIT, ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
    // The queue is driven by timers, so the specs drive a fake clock rather than
    // sleeping for six seconds each time.
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(0));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('starts empty', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('queues a message and hands back its id', () => {
    const id = service.show({ tone: 'success', title: 'Draft saved' });

    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].id).toBe(id);
    expect(service.toasts()[0].title).toBe('Draft saved');
    expect(service.toasts()[0].description).toBeNull();
  });

  it('expires an ordinary toast after the default duration', () => {
    service.success('Comment added');

    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS - 1);
    expect(service.toasts().length).toBe(1);

    jasmine.clock().tick(1);
    expect(service.toasts()).toEqual([]);
  });

  it('leaves an error on screen, because a missed error is worse than a lingering one', () => {
    service.error('The action was not applied');

    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS * 10);

    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].tone).toBe('danger');
    expect(service.toasts()[0].durationMs).toBe(0);
  });

  it('treats a duration of zero as "stays until dismissed"', () => {
    const id = service.show({ tone: 'info', title: 'Uploading', durationMs: 0 });

    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS * 10);
    expect(service.toasts().length).toBe(1);

    service.dismiss(id);
    expect(service.toasts()).toEqual([]);
  });

  it('honours an explicit duration', () => {
    service.show({ tone: 'info', title: 'Copied', durationMs: 1000 });

    jasmine.clock().tick(999);
    expect(service.toasts().length).toBe(1);

    jasmine.clock().tick(1);
    expect(service.toasts()).toEqual([]);
  });

  it('caps the visible stack and drops the oldest', () => {
    for (let index = 0; index < TOAST_VISIBLE_LIMIT + 2; index += 1) {
      service.info(`Message ${index}`);
    }

    const titles = service.toasts().map((toast) => toast.title);
    expect(titles.length).toBe(TOAST_VISIBLE_LIMIT);
    expect(titles[0]).toBe('Message 2');
    expect(titles[titles.length - 1]).toBe(`Message ${TOAST_VISIBLE_LIMIT + 1}`);
  });

  it('does not resurrect a dropped toast when its timer would have fired', () => {
    for (let index = 0; index < TOAST_VISIBLE_LIMIT + 1; index += 1) {
      service.info(`Message ${index}`);
    }

    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS);
    expect(service.toasts()).toEqual([]);
  });

  it('dismisses by id and leaves the rest alone', () => {
    const first = service.info('First');
    service.info('Second');

    service.dismiss(first);

    expect(service.toasts().map((toast) => toast.title)).toEqual(['Second']);
  });

  it('freezes the countdown while the stack is paused', () => {
    service.success('Draft saved');

    jasmine.clock().tick(3000);
    service.pause();
    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS * 5);

    expect(service.toasts().length).toBe(1);
  });

  it('resumes with what was left of the countdown rather than restarting it', () => {
    service.success('Draft saved');

    jasmine.clock().tick(5000);
    service.pause();
    jasmine.clock().tick(60_000);
    service.resume();

    jasmine.clock().tick(999);
    expect(service.toasts().length).toBe(1);

    jasmine.clock().tick(1);
    expect(service.toasts()).toEqual([]);
  });

  it('does not start a countdown for a toast raised while the stack is paused', () => {
    service.pause();
    service.success('Draft saved');

    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS * 2);
    expect(service.toasts().length).toBe(1);

    service.resume();
    jasmine.clock().tick(TOAST_DEFAULT_DURATION_MS);
    expect(service.toasts()).toEqual([]);
  });

  it('carries an action through to the queue', () => {
    const run = jasmine.createSpy('run');
    service.show({ tone: 'success', title: 'Request filed', action: { label: 'View', run } });

    const action = service.toasts()[0].action;
    expect(action?.label).toBe('View');
    action?.run();
    expect(run).toHaveBeenCalled();
  });
});
