import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DataGateway, ServiceUnavailableError } from '../../core/data/data-gateway';
import { WORKFLOW_DEFINITIONS } from '../../core/data/workflow-definitions';
import { WorkflowDefinition, WorkflowTransition } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { WorkflowListPage } from './workflow-list-page';

/**
 * Only the two calls the screen makes. Everything else on the gateway belongs to
 * other screens and a fake that implemented it would just be noise to maintain.
 */
class FakeGateway {
  /** The engine's answer is not under test here; screens drive state directly. */
  async listAvailableTransitions(): Promise<readonly WorkflowTransition[]> {
    return [];
  }

  definitions: readonly WorkflowDefinition[] = WORKFLOW_DEFINITIONS;
  runningCases = 7;
  listCalls = 0;
  failNext = false;
  /** Held open by the loading spec so the first render can be inspected. */
  gate: Promise<void> | null = null;

  async listWorkflows(): Promise<readonly WorkflowDefinition[]> {
    this.listCalls += 1;
    if (this.gate) {
      await this.gate;
    }
    if (this.failNext) {
      this.failNext = false;
      throw new ServiceUnavailableError();
    }
    return this.definitions;
  }

  async countRunningCases(): Promise<number> {
    return this.runningCases;
  }
}

describe('WorkflowListPage', () => {
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();
    await TestBed.configureTestingModule({
      imports: [WorkflowListPage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useValue: gateway },
      ],
    }).compileComponents();
    await setupI18n();
  });

  async function render(): Promise<ComponentFixture<WorkflowListPage>> {
    const fixture = TestBed.createComponent(WorkflowListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('names the screen and says what it is for', async () => {
    const fixture = await render();
    expect(text(fixture, 'h1')).toBe('Workflow definitions');
    expect(text(fixture, '.page-header__description')).toContain('immutable');
  });

  it('shows a table shaped placeholder while the definitions are loading', async () => {
    let release = (): void => undefined;
    gateway.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fixture = TestBed.createComponent(WorkflowListPage);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(maybeEl(fixture, 'app-skeleton-table')).not.toBeNull();
    expect(maybeEl(fixture, 'app-data-table')).toBeNull();

    release();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(maybeEl(fixture, 'app-skeleton-table')).toBeNull();
    expect(maybeEl(fixture, 'app-data-table')).not.toBeNull();
  });

  it('says what failed and loads again when asked to retry', async () => {
    gateway.failNext = true;
    const fixture = await render();

    expect(text(fixture, '.error-state__title')).toBe(
      'Workflow definitions could not be loaded',
    );
    expect(text(fixture, '.error-state__description')).toContain('continue to run normally');
    expect(gateway.listCalls).toBe(1);

    el<HTMLButtonElement>(fixture, '.error-state__actions button').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.listCalls).toBe(2);
    expect(maybeEl(fixture, 'app-data-table')).not.toBeNull();
  });

  it('distinguishes an empty register from a failure', async () => {
    gateway.definitions = [];
    const fixture = await render();

    expect(text(fixture, '.empty-state__title')).toBe('No workflow definitions');
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
  });

  it('renders a row per definition with its key, versions and running cases', async () => {
    const fixture = await render();
    const rows = all(fixture, '.data-table__body tr');
    expect(rows.length).toBe(WORKFLOW_DEFINITIONS.length);

    const first = rows[0];
    expect(first.textContent).toContain('Standard approval');
    expect(first.querySelector('.u-reference')?.textContent).toBe('standard-approval');
    expect(first.textContent).toContain('7');
  });

  it('shows the latest version with a status chip rather than colour alone', async () => {
    const fixture = await render();
    const chip = el(fixture, '.data-table__body tr .workflows__version app-badge');

    // Standard approval carries a version 3 draft on top of the published one.
    expect(text(fixture, '.data-table__body tr .workflows__version')).toContain('Version 3');
    expect(chip.textContent).toContain('Draft');
    expect(chip.classList).toContain('badge--neutral');
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('gives a published definition the success tone', async () => {
    gateway.definitions = WORKFLOW_DEFINITIONS.filter(
      (definition) => definition.key === 'civil-document',
    );
    const fixture = await render();
    const chip = el(fixture, '.workflows__version app-badge');

    expect(chip.textContent).toContain('Published');
    expect(chip.classList).toContain('badge--success');
  });

  it('opens the designer from the identifying cell of each row', async () => {
    const fixture = await render();
    const link = el<HTMLAnchorElement>(fixture, '.data-table__link');
    expect(link.getAttribute('href')).toBe('/admin/workflows/wf-standard-approval');
  });

  it('names the table for a screen reader', async () => {
    const fixture = await render();
    expect(text(fixture, 'table caption')).toBe('Workflow definitions');
    expect(all(fixture, 'th[scope="col"]').length).toBe(6);
  });
});
