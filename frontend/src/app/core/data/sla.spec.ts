import { ServiceRequest } from '../models/domain';
import { AT_RISK_THRESHOLD, isClosed, isOpen, processingTimeMs, slaStateFor } from './sla';

function makeRequest(overrides: Partial<ServiceRequest>): ServiceRequest {
  return {
    id: 'req-1',
    reference: 'CA-2026-00001',
    serviceId: 'svc-birth-certificate',
    departmentId: 'dep-civil-affairs',
    applicantId: 'usr-citizen-1',
    applicantName: { en: 'Applicant', ar: 'مقدّم الطلب' },
    workflowKey: 'civil-document',
    workflowVersion: 1,
    currentStateKey: 'documentCheck',
    status: 'inReview',
    priority: 'normal',
    createdAt: '2026-09-01T00:00:00.000Z',
    submittedAt: '2026-09-01T00:00:00.000Z',
    dueAt: '2026-09-02T00:00:00.000Z',
    closedAt: null,
    assigneeId: null,
    fieldValues: {},
    documents: [],
    history: [],
    comments: [],
    ...overrides,
  };
}

describe('service level calculation', () => {
  const submittedAt = '2026-09-01T00:00:00.000Z';
  const dueAt = '2026-09-02T00:00:00.000Z';

  it('reports an unsubmitted draft as not applicable rather than on track', () => {
    const draft = makeRequest({ status: 'draft', submittedAt: null, dueAt: null });
    const state = slaStateFor(draft, new Date('2026-09-01T12:00:00.000Z'));

    expect(state.status).toBe('notApplicable');
    expect(state.remainingMs).toBeNull();
  });

  it('is on track early in the window', () => {
    const request = makeRequest({ submittedAt, dueAt });
    const state = slaStateFor(request, new Date('2026-09-01T06:00:00.000Z'));

    expect(state.status).toBe('onTrack');
    expect(state.elapsedFraction).toBeCloseTo(0.25, 5);
    expect(state.remainingMs).toBe(18 * 3600_000);
  });

  it('becomes at risk once the threshold fraction of the window has elapsed', () => {
    const request = makeRequest({ submittedAt, dueAt });
    const justBefore = slaStateFor(request, new Date('2026-09-01T17:00:00.000Z'));
    const atThreshold = slaStateFor(request, new Date('2026-09-01T18:00:00.000Z'));

    expect(AT_RISK_THRESHOLD).toBe(0.75);
    expect(justBefore.status).toBe('onTrack');
    expect(atThreshold.status).toBe('atRisk');
  });

  it('is breached once the deadline has passed', () => {
    const request = makeRequest({ submittedAt, dueAt });
    const state = slaStateFor(request, new Date('2026-09-02T03:00:00.000Z'));

    expect(state.status).toBe('breached');
    expect(state.remainingMs).toBeLessThan(0);
    expect(state.elapsedFraction).toBe(1);
  });

  it('judges a closed case against when it closed, not against now', () => {
    const request = makeRequest({
      submittedAt,
      dueAt,
      status: 'completed',
      closedAt: '2026-09-01T20:00:00.000Z',
    });

    // Long after the deadline, but it finished inside its window.
    const state = slaStateFor(request, new Date('2026-10-01T00:00:00.000Z'));
    expect(state.status).toBe('met');
  });

  it('reports a late closure as breached', () => {
    const request = makeRequest({
      submittedAt,
      dueAt,
      status: 'completed',
      closedAt: '2026-09-03T00:00:00.000Z',
    });

    expect(slaStateFor(request, new Date('2026-10-01T00:00:00.000Z')).status).toBe('breached');
  });

  it('treats every terminal status as closed', () => {
    expect(isClosed(makeRequest({ status: 'completed' }))).toBeTrue();
    expect(isClosed(makeRequest({ status: 'rejected' }))).toBeTrue();
    expect(isClosed(makeRequest({ status: 'cancelled' }))).toBeTrue();
    expect(isOpen(makeRequest({ status: 'inReview' }))).toBeTrue();
    expect(isOpen(makeRequest({ status: 'moreInfo' }))).toBeTrue();
  });

  it('measures processing time from submission to closure', () => {
    const request = makeRequest({
      submittedAt,
      closedAt: '2026-09-01T12:00:00.000Z',
      status: 'completed',
    });

    expect(processingTimeMs(request)).toBe(12 * 3600_000);
    expect(processingTimeMs(makeRequest({ closedAt: null }))).toBeNull();
  });
});
