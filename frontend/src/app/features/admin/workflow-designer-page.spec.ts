import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';

import { DataGateway, ServiceUnavailableError } from '../../core/data/data-gateway';
import { WORKFLOW_DEFINITIONS } from '../../core/data/workflow-definitions';
import {
  WorkflowDefinition,
  WorkflowState,
  WorkflowTransition,
  WorkflowVersion,
} from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { WorkflowDesignerPage } from './workflow-designer-page';

const STANDARD = WORKFLOW_DEFINITIONS[0];

class FakeGateway {
  /** The engine's answer is not under test here; screens drive state directly. */
  async listAvailableTransitions(): Promise<readonly WorkflowTransition[]> {
    return [];
  }

  definition: WorkflowDefinition | null = STANDARD;
  runningCases = 12;
  saved: WorkflowVersion | null = null;
  getCalls = 0;
  failNext = false;
  gate: Promise<void> | null = null;

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    this.getCalls += 1;
    if (this.gate) {
      await this.gate;
    }
    if (this.failNext) {
      this.failNext = false;
      throw new ServiceUnavailableError();
    }
    return this.definition && this.definition.id === workflowId ? this.definition : null;
  }

  async saveWorkflowVersion(
    workflowId: string,
    version: WorkflowVersion,
  ): Promise<WorkflowDefinition> {
    this.saved = version;
    const definition = this.definition;
    if (!definition || definition.id !== workflowId) {
      throw new ServiceUnavailableError();
    }
    const updated: WorkflowDefinition = {
      ...definition,
      versions: definition.versions.map((candidate) =>
        candidate.id === version.id ? version : candidate,
      ),
    };
    this.definition = updated;
    return updated;
  }

  async countRunningCases(): Promise<number> {
    return this.runningCases;
  }
}

/**
 * The screen is driven through its template wherever a real administrator would
 * click something. Filling nine form controls one keystroke at a time proves
 * nothing the form specs do not, so the two forms and the model behind them are
 * reached directly.
 */
interface DesignerInternals {
  readonly stateForm: FormGroup;
  readonly transitionForm: FormGroup;
  readonly versionId: WritableSignal<string | null>;
  states(): readonly WorkflowState[];
  transitions(): readonly WorkflowTransition[];
  readOnly(): boolean;
  unsaved(): boolean;
  openState(state: WorkflowState | null): void;
  askDeleteState(state: WorkflowState): void;
  confirmDeleteState(): void;
  discardChanges(): void;
  submitEditor(): void;
}

function internals(fixture: ComponentFixture<WorkflowDesignerPage>): DesignerInternals {
  return fixture.componentInstance as unknown as DesignerInternals;
}

/**
 * A confirmation is a native `<dialog>`, so its buttons are in the document even
 * while it is shut. They are excluded here because several of them share a label
 * with a control on the page behind them.
 */
function maybeButton(
  fixture: ComponentFixture<unknown>,
  label: string,
): HTMLButtonElement | null {
  return (
    all<HTMLButtonElement>(fixture, 'button')
      .filter((candidate) => candidate.closest('app-confirm-dialog') === null)
      .find((candidate) => (candidate.textContent ?? '').trim() === label) ?? null
  );
}

function button(fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement {
  const found = maybeButton(fixture, label);
  if (!found) {
    throw new Error(`No button labelled "${label}" in the rendered output.`);
  }
  return found;
}

const NEW_STATE = {
  key: 'appeal',
  nameEn: 'Appeal review',
  nameAr: 'مراجعة التظلم',
  kind: 'task',
  stage: 'approval',
  assigneeRole: 'supervisor',
  slaHours: '48',
  column: '2',
  row: '2',
};

describe('WorkflowDesignerPage', () => {
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();
    await TestBed.configureTestingModule({
      imports: [WorkflowDesignerPage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useValue: gateway },
      ],
    }).compileComponents();
    await setupI18n();
  });

  async function render(
    id = 'wf-standard-approval',
  ): Promise<ComponentFixture<WorkflowDesignerPage>> {
    const fixture = TestBed.createComponent(WorkflowDesignerPage);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Loading, failure and the version that opens
  // ---------------------------------------------------------------------------

  it('opens on the draft version, because that is the one an editor can change', async () => {
    const fixture = await render();

    expect(text(fixture, 'h1')).toBe('Standard approval');
    expect(text(fixture, '.page-header__description')).toBe('Version 3');
    expect(text(fixture, '.page-header__meta app-badge')).toContain('Draft');
    expect(internals(fixture).readOnly()).toBe(false);
  });

  it('shows a skeleton only until the definition arrives', async () => {
    let release = (): void => undefined;
    gateway.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fixture = TestBed.createComponent(WorkflowDesignerPage);
    fixture.componentRef.setInput('id', 'wf-standard-approval');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(maybeEl(fixture, '.designer__loading')).not.toBeNull();

    release();
    await settle(fixture);

    expect(maybeEl(fixture, '.designer__loading')).toBeNull();
    expect(maybeEl(fixture, 'app-workflow-canvas')).not.toBeNull();
  });

  it('says what failed and reloads when asked to retry', async () => {
    gateway.failNext = true;
    const fixture = await render();

    expect(text(fixture, '.error-state__title')).toBe(
      'Workflow definitions could not be loaded',
    );
    expect(gateway.getCalls).toBe(1);

    el<HTMLButtonElement>(fixture, '.error-state__actions button').click();
    await settle(fixture);

    expect(gateway.getCalls).toBe(2);
    expect(maybeEl(fixture, 'app-workflow-canvas')).not.toBeNull();
  });

  it('distinguishes a definition that does not exist from one that would not load', async () => {
    const fixture = await render('wf-missing');

    expect(el(fixture, 'app-error-state').classList).toContain('error-state--not-found');
    expect(maybeEl(fixture, '.error-state__actions button')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  it('adds a state to the model and to the canvas', async () => {
    const fixture = await render();
    const page = internals(fixture);
    const before = all(fixture, '.canvas__node').length;

    button(fixture, 'Add state').click();
    await settle(fixture);

    page.stateForm.setValue(NEW_STATE);
    await settle(fixture);

    button(fixture, 'Save').click();
    await settle(fixture);

    expect(page.states().some((state) => state.key === 'appeal')).toBe(true);

    const nodes = all(fixture, '.canvas__node');
    expect(nodes.length).toBe(before + 1);
    expect(nodes.some((node) => (node.textContent ?? '').includes('Appeal review'))).toBe(true);

    // The list view is the interface below the md breakpoint, so it has to grow too.
    const rows = all(fixture, '.designer__lists .designer__row');
    expect(rows.some((row) => (row.textContent ?? '').includes('Appeal review'))).toBe(true);
  });

  it('reports a state nothing points at as unreachable', async () => {
    const fixture = await render();
    const page = internals(fixture);

    expect(text(fixture, 'app-alert')).toContain('No problems found');

    button(fixture, 'Add state').click();
    await settle(fixture);
    page.stateForm.setValue(NEW_STATE);
    button(fixture, 'Save').click();
    await settle(fixture);

    const findings = text(fixture, '.designer__findings');
    expect(findings).toContain('Appeal review cannot be reached from the start state');
    expect(findings).toContain('has no outgoing transition');
  });

  it('deletes a state together with the transitions that referenced it', async () => {
    const fixture = await render();
    const page = internals(fixture);

    const target = page.states().find((state) => state.key === 'documentCheck');
    expect(target).toBeDefined();
    const attached = page
      .transitions()
      .filter(
        (transition) =>
          transition.fromStateKey === 'documentCheck' ||
          transition.toStateKey === 'documentCheck',
      );
    expect(attached.length).toBeGreaterThan(0);

    page.askDeleteState(target as WorkflowState);
    await settle(fixture);

    const dialog = all(fixture, 'app-confirm-dialog')[1];
    expect(dialog.textContent).toContain('Document check');
    expect(dialog.textContent).toContain(String(attached.length));

    page.confirmDeleteState();
    await settle(fixture);

    expect(page.states().some((state) => state.key === 'documentCheck')).toBe(false);
    expect(
      page
        .transitions()
        .some(
          (transition) =>
            transition.fromStateKey === 'documentCheck' ||
            transition.toStateKey === 'documentCheck',
        ),
    ).toBe(false);
  });

  it('refuses to delete the last start state and says why in the editor', async () => {
    const fixture = await render();
    const page = internals(fixture);

    const start = page.states().find((state) => state.kind === 'start');
    page.askDeleteState(start as WorkflowState);
    await settle(fixture);

    expect(page.states().some((state) => state.key === (start as WorkflowState).key)).toBe(true);

    page.openState(start as WorkflowState);
    await settle(fixture);

    expect(el(fixture, 'app-drawer app-alert').textContent).toContain('cannot be deleted');
    expect(button(fixture, 'Delete state').disabled).toBe(true);
  });

  it('will not save a state form that is not filled in', async () => {
    const fixture = await render();
    const page = internals(fixture);
    const before = page.states().length;

    button(fixture, 'Add state').click();
    await settle(fixture);

    button(fixture, 'Save').click();
    await settle(fixture);

    expect(page.states().length).toBe(before);
    const errors = all(fixture, 'app-drawer .field__error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].textContent).toContain('Key is required');
  });

  it('rejects a state key that is not a machine key', async () => {
    const fixture = await render();
    const page = internals(fixture);

    button(fixture, 'Add state').click();
    await settle(fixture);
    button(fixture, 'Save').click();
    await settle(fixture);

    page.stateForm.patchValue({ key: 'Not A Key' });
    await settle(fixture);

    expect(el(fixture, 'app-drawer .field__error').textContent).toContain(
      'not in the expected format',
    );
  });

  it('requires at least one role on a transition', async () => {
    const fixture = await render();
    const page = internals(fixture);
    const before = page.transitions().length;

    button(fixture, 'Add transition').click();
    await settle(fixture);

    page.transitionForm.patchValue({
      key: 'appealRaised',
      labelEn: 'Raise appeal',
      labelAr: 'رفع تظلم',
      allowedRoles: { citizen: false, officer: false, supervisor: false, admin: false },
    });
    await settle(fixture);

    button(fixture, 'Save').click();
    await settle(fixture);

    expect(page.transitions().length).toBe(before);
    expect(text(fixture, '.designer__error')).toContain('is required');
  });

  it('adds a transition and draws it on the canvas', async () => {
    const fixture = await render();
    const page = internals(fixture);
    const before = all(fixture, '.canvas__edge').length;

    button(fixture, 'Add transition').click();
    await settle(fixture);

    page.transitionForm.patchValue({
      key: 'fastTrack',
      labelEn: 'Fast track',
      labelAr: 'مسار سريع',
      from: 'submitted',
      to: 'issuance',
      kind: 'forward',
      allowedRoles: { citizen: false, officer: false, supervisor: true, admin: false },
    });
    await settle(fixture);

    button(fixture, 'Save').click();
    await settle(fixture);

    const added = page.transitions().find((transition) => transition.key === 'fastTrack');
    expect(added?.allowedRoles).toEqual(['supervisor']);
    expect(all(fixture, '.canvas__edge').length).toBe(before + 1);
  });

  // ---------------------------------------------------------------------------
  // Saving, discarding and the read only version
  // ---------------------------------------------------------------------------

  it('marks the draft as unsaved and writes it through the gateway', async () => {
    const fixture = await render();
    const page = internals(fixture);

    button(fixture, 'Add state').click();
    await settle(fixture);
    page.stateForm.setValue(NEW_STATE);
    button(fixture, 'Save').click();
    await settle(fixture);

    expect(page.unsaved()).toBe(true);
    expect(text(fixture, '.page-header__meta')).toContain('Unsaved changes');

    button(fixture, 'Save draft').click();
    await settle(fixture);

    expect(gateway.saved?.states.some((state) => state.key === 'appeal')).toBe(true);
    expect(page.unsaved()).toBe(false);
    expect(text(fixture, '.page-header__meta')).not.toContain('Unsaved changes');
  });

  it('throws the working copy away when changes are discarded', async () => {
    const fixture = await render();
    const page = internals(fixture);

    button(fixture, 'Add state').click();
    await settle(fixture);
    page.stateForm.setValue(NEW_STATE);
    button(fixture, 'Save').click();
    await settle(fixture);
    expect(page.unsaved()).toBe(true);

    page.discardChanges();
    await settle(fixture);

    expect(page.states().some((state) => state.key === 'appeal')).toBe(false);
    expect(page.unsaved()).toBe(false);
    expect(gateway.saved).toBeNull();
  });

  it('renders a published version read only, with what is running on it', async () => {
    const fixture = await render();
    const page = internals(fixture);

    page.versionId.set('standard-approval-v2');
    await settle(fixture);

    expect(page.readOnly()).toBe(true);

    const notice = el(fixture, '.designer__notice');
    expect(notice.textContent).toContain('cannot be edited');
    expect(notice.textContent).toContain('12');

    expect(button(fixture, 'Add state').disabled).toBe(true);
    expect(button(fixture, 'Add transition').disabled).toBe(true);
    expect(maybeButton(fixture, 'Save draft')).toBeNull();
    expect(maybeButton(fixture, 'Discard changes')).toBeNull();
    expect(page.stateForm.disabled).toBe(true);
    expect(page.transitionForm.disabled).toBe(true);
  });

  it('still lets a published version be inspected in the editor', async () => {
    const fixture = await render();
    const page = internals(fixture);

    page.versionId.set('standard-approval-v2');
    await settle(fixture);

    page.openState(page.states()[1]);
    await settle(fixture);

    expect(el<HTMLInputElement>(fixture, 'app-drawer input').disabled).toBe(true);
    expect(maybeButton(fixture, 'Delete state')).toBeNull();
    expect(maybeButton(fixture, 'Close')).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Accessibility and direction
  // ---------------------------------------------------------------------------

  it('gives the editor a named dialog and keeps every node reachable by keyboard', async () => {
    const fixture = await render();

    const nodes = all<HTMLElement>(fixture, '.canvas__node');
    expect(nodes.every((node) => node.tagName === 'BUTTON')).toBe(true);
    expect(all(fixture, '.canvas__edge').every((chip) => chip.tagName === 'BUTTON')).toBe(true);

    button(fixture, 'Add state').click();
    await settle(fixture);

    const panel = el(fixture, '.drawer__panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const titleId = panel.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(el(fixture, `#${titleId}`).textContent?.trim()).toBe('Add state');
  });

  it('renders the definition and its states in Arabic', async () => {
    await setupI18n('ar');
    const fixture = await render();

    expect(text(fixture, 'h1')).toBe('الاعتماد القياسي');
    expect(all(fixture, '.canvas__node')[0].textContent).toContain('مُقدَّم');
  });
});
