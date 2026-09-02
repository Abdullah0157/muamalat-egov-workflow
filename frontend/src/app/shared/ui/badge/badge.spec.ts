import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl, text } from '../../testing/dom';
import { Badge, BadgeTone } from './badge';
import { IconName } from '../icon/icon';
import {
  priorityPresentation,
  requestStatusPresentation,
  slaPresentation,
  verificationPresentation,
} from '../status/status-presentation';

@Component({
  imports: [Badge],
  template: `<app-badge [tone]="tone()" [icon]="icon()" [solid]="solid()" [size]="size()">{{ label() }}</app-badge>`,
})
class Host {
  readonly tone = signal<BadgeTone>('neutral');
  readonly icon = signal<IconName | null>(null);
  readonly solid = signal(false);
  readonly size = signal<'sm' | 'md'>('md');
  readonly label = signal('In review');
}

describe('Badge', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('always renders its label as text', () => {
    expect(text(fixture, '.badge__label')).toBe('In review');
  });

  it('applies the tone class', async () => {
    fixture.componentInstance.tone.set('danger');
    await render();

    expect(el(fixture, 'app-badge').classList).toContain('badge--danger');
  });

  it('renders an icon when one is supplied', async () => {
    expect(maybeEl(fixture, 'app-icon')).toBeNull();

    fixture.componentInstance.icon.set('alert-triangle');
    await render();

    expect(maybeEl(fixture, 'app-icon')).not.toBeNull();
  });

  it('supports a solid treatment for the single most important chip', async () => {
    fixture.componentInstance.solid.set(true);
    await render();

    expect(el(fixture, 'app-badge').classList).toContain('badge--solid');
  });
});

/**
 * The presentation map is what stops one screen from calling a breached case
 * red with a warning icon while another calls it amber with a clock. It is also
 * where the "never colour alone" rule is enforced, so it is asserted directly.
 */
describe('status presentation', () => {
  it('gives every request status a tone, an icon and a label key', () => {
    const statuses = [
      'draft',
      'submitted',
      'inReview',
      'moreInfo',
      'approved',
      'rejected',
      'completed',
      'cancelled',
    ] as const;

    for (const status of statuses) {
      const presentation = requestStatusPresentation(status);
      expect(presentation.icon).withContext(`${status} needs an icon`).toBeTruthy();
      expect(presentation.labelKey)
        .withContext(`${status} needs a label key`)
        .toBe(`status.${status}`);
    }
  });

  it('distinguishes every service level state by icon as well as by colour', () => {
    const states = ['onTrack', 'atRisk', 'breached', 'met', 'notApplicable'] as const;
    const icons = states.map((state) => slaPresentation(state).icon);

    expect(new Set(icons).size).toBe(icons.length);
  });

  it('escalates the priority icon as the priority rises', () => {
    expect(priorityPresentation('normal').tone).toBe('neutral');
    expect(priorityPresentation('high').tone).toBe('warning');
    expect(priorityPresentation('urgent').tone).toBe('danger');
    expect(priorityPresentation('urgent').icon).not.toBe(priorityPresentation('normal').icon);
  });

  it('gives document verification states distinct icons', () => {
    const icons = (['pending', 'verified', 'rejected'] as const).map(
      (state) => verificationPresentation(state).icon,
    );
    expect(new Set(icons).size).toBe(3);
  });
});
