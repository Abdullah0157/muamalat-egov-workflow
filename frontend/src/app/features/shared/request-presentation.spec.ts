import { TestBed } from '@angular/core/testing';

import { buildDataset } from '../../core/data/dataset';
import { I18nService } from '../../core/i18n/i18n.service';
import { ServiceRequest } from '../../core/models/domain';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import {
  allRequiredDocumentsVerified,
  availableTransitions,
  buildHistoryItems,
  buildStageSteps,
  currentStage,
  serviceFor,
  stateName,
  versionFor,
  waitingOnRole,
} from './request-presentation';

describe('request presentation', () => {
  const now = new Date('2026-09-01T09:00:00.000Z');
  const corpus = buildDataset(now).requests;
  let i18n: I18nService;

  function find(predicate: (request: ServiceRequest) => boolean): ServiceRequest {
    const match = corpus.find(predicate);
    if (!match) {
      throw new Error('The sample corpus does not contain a request matching this case');
    }
    return match;
  }

  /** A case parked in the "more information needed" loop of the standard workflow. */
  function awaitingApplicant(): ServiceRequest {
    const base = corpus[0];
    return {
      ...base,
      workflowKey: 'standard-approval',
      workflowVersion: 2,
      currentStateKey: 'moreInfo',
      status: 'moreInfo',
      closedAt: null,
      history: [
        {
          id: 'h1',
          at: '2026-08-20T08:00:00.000Z',
          actorId: 'usr-citizen-1',
          actorName: { en: 'Applicant', ar: 'مقدّم الطلب' },
          actorRole: 'citizen',
          action: 'submitted',
          fromStateKey: null,
          toStateKey: 'submitted',
          transitionKey: null,
          comment: null,
        },
        {
          id: 'h2',
          at: '2026-08-21T08:00:00.000Z',
          actorId: 'usr-officer-1',
          actorName: { en: 'Officer', ar: 'موظف' },
          actorRole: 'officer',
          action: 'transition',
          fromStateKey: 'submitted',
          toStateKey: 'documentCheck',
          transitionKey: 'beginReview',
          comment: null,
        },
        {
          id: 'h3',
          at: '2026-08-22T08:00:00.000Z',
          actorId: 'usr-officer-1',
          actorName: { en: 'Officer', ar: 'موظف' },
          actorRole: 'officer',
          action: 'transition',
          fromStateKey: 'documentCheck',
          toStateKey: 'moreInfo',
          transitionKey: 'requestInformation',
          comment: 'The tenancy contract is not legible.',
        },
      ],
      comments: [],
    };
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [...testProviders()] });
    i18n = await setupI18n();
  });

  // ---------------------------------------------------------------------------
  // Stage tracker
  // ---------------------------------------------------------------------------

  it('always produces the four stages a citizen is shown', () => {
    const steps = buildStageSteps(corpus[0], i18n);

    expect(steps.map((step) => step.id)).toEqual([
      'submission',
      'review',
      'approval',
      'completion',
    ]);
    expect(steps.every((step) => step.label.length > 0)).toBeTrue();
  });

  it('marks stages before the current one complete and later ones upcoming', () => {
    const open = find((request) => request.closedAt === null && request.status === 'inReview');
    const steps = buildStageSteps(open, i18n);
    const currentIndex = steps.findIndex((step) => step.state === 'current');

    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(steps.slice(0, currentIndex).every((step) => step.state === 'complete')).toBeTrue();
    expect(steps.slice(currentIndex + 1).every((step) => step.state === 'upcoming')).toBeTrue();
  });

  /**
   * Built by hand rather than fished out of the corpus: whether any generated
   * record happens to be sitting with its applicant at the fixed instant is an
   * accident of the seed, and a spec that depends on that accident is a spec
   * that will fail one day for no reason.
   */
  it('marks the stage blocked while the file is back with the applicant', () => {
    const steps = buildStageSteps(awaitingApplicant(), i18n);

    expect(steps.some((step) => step.state === 'blocked')).toBeTrue();
    expect(steps.some((step) => step.state === 'current')).toBeFalse();
  });

  it('marks every stage complete once the file is closed', () => {
    const closed = find((request) => request.closedAt !== null);

    expect(buildStageSteps(closed, i18n).every((step) => step.state === 'complete')).toBeTrue();
  });

  it('translates the stage labels', async () => {
    const english = buildStageSteps(corpus[0], i18n).map((step) => step.label);
    await i18n.setLanguage('ar');
    const arabic = buildStageSteps(corpus[0], i18n).map((step) => step.label);

    expect(english[0]).toBe('Submission');
    expect(arabic[0]).toBe('التقديم');
  });

  // ---------------------------------------------------------------------------
  // Audit trail
  // ---------------------------------------------------------------------------

  it('orders the audit trail newest first', () => {
    const request = find((request) => request.history.length > 2);
    const items = buildHistoryItems(request, i18n);

    const times = items.map((item) => new Date(item.timestamp).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('names the actor and their role on every entry', () => {
    const items = buildHistoryItems(corpus[0], i18n);

    for (const item of items) {
      expect(item.meta).toBeTruthy();
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.icon).toBeTruthy();
    }
  });

  it('uses the transition label from the workflow rather than a generic word', () => {
    const request = find(
      (candidate) => candidate.history.some((entry) => entry.transitionKey !== null),
    );
    const version = versionFor(request);
    const entry = request.history.find((candidate) => candidate.transitionKey !== null);
    const transition = version?.transitions.find(
      (candidate) => candidate.key === entry?.transitionKey,
    );

    const item = buildHistoryItems(request, i18n).find((candidate) => candidate.id === entry?.id);
    expect(item?.title).toBe(i18n.pick(transition?.label));
  });

  it('does not print the same comment twice when it came in with a transition', () => {
    const request = find((candidate) => candidate.comments.length > 0);
    const items = buildHistoryItems(request, i18n);
    const bodies = items.map((item) => item.description).filter((body): body is string => !!body);

    expect(new Set(bodies).size).toBe(bodies.length);
  });

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  it('offers only the transitions the workflow allows for the role', () => {
    const open = find((request) => request.closedAt === null && request.currentStateKey !== 'moreInfo');
    const version = versionFor(open);
    const expected = version?.transitions.filter(
      (transition) =>
        transition.fromStateKey === open.currentStateKey &&
        transition.allowedRoles.includes('officer'),
    );

    expect(availableTransitions(open, 'officer').map((t) => t.key)).toEqual(
      (expected ?? []).map((t) => t.key),
    );
  });

  it('offers nothing on a closed case', () => {
    const closed = find((request) => request.closedAt !== null);

    expect(availableTransitions(closed, 'officer')).toEqual([]);
    expect(availableTransitions(closed, 'supervisor')).toEqual([]);
  });

  it('offers nothing when nobody is signed in', () => {
    expect(availableTransitions(corpus[0], null)).toEqual([]);
  });

  it('reports the role a waiting case is waiting on', () => {
    expect(waitingOnRole(awaitingApplicant())).toBe('citizen');
  });

  it('only offers the applicant transition while the case sits with them', () => {
    const waiting = awaitingApplicant();

    expect(availableTransitions(waiting, 'officer')).toEqual([]);
    expect(availableTransitions(waiting, 'citizen').map((t) => t.key)).toEqual([
      'informationProvided',
    ]);
  });

  // ---------------------------------------------------------------------------
  // Guards and naming
  // ---------------------------------------------------------------------------

  it('names the current state from the workflow definition', () => {
    const request = corpus[0];
    const version = versionFor(request);
    const state = version?.states.find((s) => s.key === request.currentStateKey);

    expect(stateName(request, i18n)).toBe(i18n.pick(state?.name));
  });

  it('reports the current stage as one the workflow actually defines', () => {
    for (const request of corpus.slice(0, 10)) {
      expect(['submission', 'review', 'approval', 'completion']).toContain(currentStage(request));
    }
  });

  /**
   * This guard gates the "documents verified" transition, so it must be exactly
   * right: every required requirement needs a document against it, and that
   * document must be verified. An optional requirement is irrelevant.
   */
  it('only reports documents verified when every required requirement has a verified copy', () => {
    for (const request of corpus.slice(0, 25)) {
      const service = serviceFor(request);
      if (!service) {
        continue;
      }
      const expected = service.documents
        .filter((requirement) => requirement.required)
        .every((requirement) =>
          request.documents.some(
            (document) =>
              document.requirementId === requirement.id && document.verification === 'verified',
          ),
        );

      expect(allRequiredDocumentsVerified(request))
        .withContext(`${request.reference} document guard`)
        .toBe(expected);
    }
  });

  it('finds at least one case in each direction, so the guard is genuinely exercised', () => {
    const results = corpus.map(allRequiredDocumentsVerified);

    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});
