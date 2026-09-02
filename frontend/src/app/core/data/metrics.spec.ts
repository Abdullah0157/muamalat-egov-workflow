import { ServiceRequest } from '../models/domain';
import { buildDataset } from './dataset';
import { computeDashboard } from './metrics';
import { isOpen, slaStateFor } from './sla';
import { findVersion } from './workflow-definitions';

/**
 * The dashboard is only worth showing if its figures are derived from the same
 * records the queue shows. These specs check exactly that: every headline
 * number is recomputed here from the corpus and compared, so an invented or
 * drifting figure fails the build.
 */
describe('dashboard metrics', () => {
  // A fixed instant keeps the corpus, and therefore every assertion, stable.
  const now = new Date('2026-09-01T09:00:00.000Z');
  const requests = buildDataset(now).requests;

  it('generates a corpus whose records are internally consistent', () => {
    expect(requests.length).toBeGreaterThan(20);

    for (const request of requests) {
      const version = findVersion(request.workflowKey, request.workflowVersion);
      expect(version)
        .withContext(`${request.reference} references a workflow version that exists`)
        .toBeDefined();

      const state = version?.states.find((candidate) => candidate.key === request.currentStateKey);
      expect(state)
        .withContext(`${request.reference} sits in a state defined by its workflow`)
        .toBeDefined();

      // A closed case must have a closing timestamp and vice versa.
      expect(isOpen(request) ? request.closedAt === null : request.closedAt !== null)
        .withContext(`${request.reference} agrees with its own closed state`)
        .toBeTrue();
    }
  });

  it('never leaves a case in a state its history did not reach', () => {
    for (const request of requests) {
      const transitions = request.history.filter((entry) => entry.toStateKey !== null);
      const last = transitions[transitions.length - 1];
      expect(last?.toStateKey)
        .withContext(`${request.reference} current state matches the last history entry`)
        .toBe(request.currentStateKey);
    }
  });

  it('counts open, at risk and breached cases from the records themselves', () => {
    const metrics = computeDashboard(requests, 'all', now);
    const inPeriod = requests.filter((request) => request.submittedAt !== null);

    const expectedOpen = inPeriod.filter(isOpen);
    const expectedAtRisk = expectedOpen.filter(
      (request) => slaStateFor(request, now).status === 'atRisk',
    );
    const expectedBreached = expectedOpen.filter(
      (request) => slaStateFor(request, now).status === 'breached',
    );

    expect(metrics.totalInPeriod).toBe(inPeriod.length);
    expect(metrics.open).toBe(expectedOpen.length);
    expect(metrics.atRisk).toBe(expectedAtRisk.length);
    expect(metrics.breached).toBe(expectedBreached.length);
    expect(metrics.open + metrics.closed).toBe(metrics.totalInPeriod);
  });

  it('scopes every figure to the selected period', () => {
    const all = computeDashboard(requests, 'all', now);
    const last30 = computeDashboard(requests, 'last30', now);

    expect(last30.totalInPeriod).toBeLessThanOrEqual(all.totalInPeriod);
    expect(last30.from).not.toBeNull();
    expect(all.from).toBeNull();

    const cutoff = new Date(last30.from ?? now).getTime();
    const expected = requests.filter(
      (request) => request.submittedAt !== null && new Date(request.submittedAt).getTime() >= cutoff,
    );
    expect(last30.totalInPeriod).toBe(expected.length);
  });

  it('reports an average processing time that matches the closed cases', () => {
    const metrics = computeDashboard(requests, 'all', now);
    const closed = requests.filter(
      (request) => request.submittedAt !== null && request.closedAt !== null,
    );
    const expected =
      closed.reduce(
        (sum, request) =>
          sum + new Date(request.closedAt ?? '').getTime() - new Date(request.submittedAt ?? '').getTime(),
        0,
      ) / closed.length;

    expect(metrics.averageProcessingMs).not.toBeNull();
    expect(metrics.averageProcessingMs ?? 0).toBeCloseTo(expected, -3);
  });

  it('returns nulls rather than zeroes when a period holds no closed case', () => {
    const empty: readonly ServiceRequest[] = [];
    const metrics = computeDashboard(empty, 'last30', now);

    expect(metrics.averageProcessingMs).toBeNull();
    expect(metrics.onTimeRate).toBeNull();
    expect(metrics.workload).toEqual([]);
    expect(metrics.throughput).toEqual([]);
    expect(metrics.bottlenecks).toEqual([]);
  });

  it('splits departmental workload into figures that sum to the open total', () => {
    const metrics = computeDashboard(requests, 'all', now);
    const summed = metrics.workload.reduce((sum, row) => sum + row.open, 0);
    expect(summed).toBe(metrics.open);

    for (const row of metrics.workload) {
      expect(row.onTrack + row.atRisk + row.breached).toBe(row.open);
    }
  });

  it('orders bottlenecks by average wait, longest first', () => {
    const metrics = computeDashboard(requests, 'all', now);
    expect(metrics.bottlenecks.length).toBeGreaterThan(0);

    const averages = metrics.bottlenecks.map((row) => row.averageMs);
    const sorted = [...averages].sort((a, b) => b - a);
    expect(averages).toEqual(sorted);

    for (const row of metrics.bottlenecks) {
      expect(row.caseCount).toBeGreaterThan(0);
      expect(row.averageMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('buckets throughput into consecutive weeks', () => {
    const metrics = computeDashboard(requests, 'last90', now);
    expect(metrics.throughput.length).toBeGreaterThan(1);

    for (let index = 1; index < metrics.throughput.length; index += 1) {
      const previous = new Date(metrics.throughput[index - 1].weekStart).getTime();
      const current = new Date(metrics.throughput[index].weekStart).getTime();
      expect(current - previous).toBe(7 * 86_400_000);
    }
  });

  it('reports the same escalation count as the escalation list', () => {
    const metrics = computeDashboard(requests, 'all', now);
    expect(metrics.escalations).toBe(metrics.escalatedCases.length);

    for (const row of metrics.escalatedCases) {
      expect(row.ageMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists attention cases ordered by deadline', () => {
    const metrics = computeDashboard(requests, 'all', now);
    expect(metrics.attentionCases.length).toBe(metrics.atRisk + metrics.breached);

    const deadlines = metrics.attentionCases.map((request) =>
      request.dueAt ? new Date(request.dueAt).getTime() : Number.MAX_SAFE_INTEGER,
    );
    expect(deadlines).toEqual([...deadlines].sort((a, b) => a - b));
  });

  it('is deterministic, so a supervisor sees the same figures on every load', () => {
    const first = computeDashboard(buildDataset(now).requests, 'all', now);
    const second = computeDashboard(buildDataset(now).requests, 'all', now);
    expect(first.totalInPeriod).toBe(second.totalInPeriod);
    expect(first.averageProcessingMs).toBe(second.averageProcessingMs);
    expect(first.bottlenecks.map((row) => row.stateKey)).toEqual(
      second.bottlenecks.map((row) => row.stateKey),
    );
  });
});
