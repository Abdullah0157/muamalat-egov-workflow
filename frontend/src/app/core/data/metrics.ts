import { LocalizedText, ServiceRequest } from '../models/domain';
import { DEPARTMENTS, findDepartment, findService } from './service-catalogue';
import { dwellTimesByState, isOpen, processingTimeMs, slaStateFor } from './sla';
import { findVersion } from './workflow-definitions';

export type DashboardPeriod = 'last30' | 'last90' | 'all';

export interface DepartmentWorkload {
  readonly departmentId: string;
  readonly name: LocalizedText;
  readonly open: number;
  readonly onTrack: number;
  readonly atRisk: number;
  readonly breached: number;
}

export interface BottleneckRow {
  readonly stateKey: string;
  readonly name: LocalizedText;
  readonly averageMs: number;
  readonly caseCount: number;
}

export interface ThroughputPoint {
  readonly weekStart: string;
  readonly submitted: number;
  readonly closed: number;
}

export interface EscalationRow {
  readonly requestId: string;
  readonly reference: string;
  readonly serviceName: LocalizedText;
  readonly departmentName: LocalizedText;
  readonly raisedAt: string;
  readonly ageMs: number;
}

export interface DashboardMetrics {
  readonly period: DashboardPeriod;
  readonly from: string | null;
  readonly to: string;
  /** Cases submitted inside the period. Every figure below is scoped to these. */
  readonly totalInPeriod: number;
  readonly open: number;
  readonly closed: number;
  readonly atRisk: number;
  readonly breached: number;
  /** Null when no case closed in the period, rather than a misleading zero. */
  readonly averageProcessingMs: number | null;
  /** Fraction of closed cases that finished inside their window, or null. */
  readonly onTimeRate: number | null;
  readonly escalations: number;
  readonly workload: readonly DepartmentWorkload[];
  readonly bottlenecks: readonly BottleneckRow[];
  readonly throughput: readonly ThroughputPoint[];
  readonly escalatedCases: readonly EscalationRow[];
  readonly attentionCases: readonly ServiceRequest[];
}

const PERIOD_DAYS: Readonly<Record<DashboardPeriod, number | null>> = {
  last30: 30,
  last90: 90,
  all: null,
};

export function periodStart(period: DashboardPeriod, now: Date): Date | null {
  const days = PERIOD_DAYS[period];
  return days === null ? null : new Date(now.getTime() - days * 86_400_000);
}

/**
 * Every figure on the supervisor dashboard is computed here, from the same
 * records the queue and the citizen list are built from. Nothing is hardcoded
 * and nothing is smoothed: if there is no data for a period the function
 * returns nulls and empty lists so the interface can say so honestly rather
 * than drawing a flat line at zero.
 */
export function computeDashboard(
  requests: readonly ServiceRequest[],
  period: DashboardPeriod,
  now: Date,
): DashboardMetrics {
  const from = periodStart(period, now);
  const inPeriod = requests.filter((request) => withinPeriod(request, from));

  const open = inPeriod.filter(isOpen);
  const closed = inPeriod.filter((request) => !isOpen(request));

  const slaByRequest = new Map(inPeriod.map((request) => [request.id, slaStateFor(request, now)]));

  const atRisk = open.filter((request) => slaByRequest.get(request.id)?.status === 'atRisk');
  const breached = open.filter((request) => slaByRequest.get(request.id)?.status === 'breached');

  const processingTimes = closed
    .map(processingTimeMs)
    .filter((value): value is number => value !== null);
  const averageProcessingMs =
    processingTimes.length === 0
      ? null
      : processingTimes.reduce((sum, value) => sum + value, 0) / processingTimes.length;

  const onTime = closed.filter((request) => slaByRequest.get(request.id)?.status === 'met');
  const onTimeRate = closed.length === 0 ? null : onTime.length / closed.length;

  const escalatedCases = collectEscalations(inPeriod, now);

  return {
    period,
    from: from ? from.toISOString() : null,
    to: now.toISOString(),
    totalInPeriod: inPeriod.length,
    open: open.length,
    closed: closed.length,
    atRisk: atRisk.length,
    breached: breached.length,
    averageProcessingMs,
    onTimeRate,
    escalations: escalatedCases.length,
    workload: computeWorkload(open, now),
    bottlenecks: computeBottlenecks(inPeriod, now),
    throughput: computeThroughput(inPeriod, from, now),
    escalatedCases,
    attentionCases: [...atRisk, ...breached].sort(byDueDate),
  };
}

function withinPeriod(request: ServiceRequest, from: Date | null): boolean {
  if (!request.submittedAt) {
    return false;
  }
  if (from === null) {
    return true;
  }
  return new Date(request.submittedAt).getTime() >= from.getTime();
}

function byDueDate(a: ServiceRequest, b: ServiceRequest): number {
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return aDue - bDue;
}

function computeWorkload(open: readonly ServiceRequest[], now: Date): DepartmentWorkload[] {
  return DEPARTMENTS.map((department) => {
    const cases = open.filter((request) => request.departmentId === department.id);
    let onTrack = 0;
    let atRisk = 0;
    let breached = 0;
    for (const request of cases) {
      const status = slaStateFor(request, now).status;
      if (status === 'breached') {
        breached += 1;
      } else if (status === 'atRisk') {
        atRisk += 1;
      } else {
        onTrack += 1;
      }
    }
    return {
      departmentId: department.id,
      name: department.name,
      open: cases.length,
      onTrack,
      atRisk,
      breached,
    };
  })
    .filter((row) => row.open > 0)
    .sort((a, b) => b.open - a.open);
}

function computeBottlenecks(
  requests: readonly ServiceRequest[],
  now: Date,
): BottleneckRow[] {
  const totals = new Map<string, { total: number; count: number; name: LocalizedText }>();

  for (const request of requests) {
    const version = findVersion(request.workflowKey, request.workflowVersion);
    if (!version) {
      continue;
    }
    for (const [stateKey, elapsed] of dwellTimesByState(request, now)) {
      const state = version.states.find((candidate) => candidate.key === stateKey);
      if (!state || state.kind === 'end') {
        continue;
      }
      const existing = totals.get(stateKey) ?? { total: 0, count: 0, name: state.name };
      totals.set(stateKey, {
        total: existing.total + elapsed,
        count: existing.count + 1,
        name: existing.name,
      });
    }
  }

  return [...totals.entries()]
    .map(([stateKey, value]) => ({
      stateKey,
      name: value.name,
      averageMs: value.total / value.count,
      caseCount: value.count,
    }))
    .sort((a, b) => b.averageMs - a.averageMs);
}

function computeThroughput(
  requests: readonly ServiceRequest[],
  from: Date | null,
  now: Date,
): ThroughputPoint[] {
  if (requests.length === 0) {
    return [];
  }

  const earliest =
    from ??
    new Date(
      Math.min(
        ...requests
          .map((request) => (request.submittedAt ? new Date(request.submittedAt).getTime() : now.getTime())),
      ),
    );

  const buckets = new Map<string, { submitted: number; closed: number }>();
  for (let cursor = startOfWeek(earliest); cursor <= now; cursor = addDays(cursor, 7)) {
    buckets.set(cursor.toISOString(), { submitted: 0, closed: 0 });
  }

  for (const request of requests) {
    if (request.submittedAt) {
      bump(buckets, request.submittedAt, 'submitted');
    }
    if (request.closedAt) {
      bump(buckets, request.closedAt, 'closed');
    }
  }

  return [...buckets.entries()]
    .map(([weekStart, value]) => ({ weekStart, submitted: value.submitted, closed: value.closed }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function bump(
  buckets: Map<string, { submitted: number; closed: number }>,
  isoDate: string,
  key: 'submitted' | 'closed',
): void {
  const weekKey = startOfWeek(new Date(isoDate)).toISOString();
  const bucket = buckets.get(weekKey);
  if (bucket) {
    bucket[key] += 1;
  }
}

/** Weeks run Sunday to Saturday, which matches the Kuwaiti working week. */
function startOfWeek(date: Date): Date {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function collectEscalations(requests: readonly ServiceRequest[], now: Date): EscalationRow[] {
  const rows: EscalationRow[] = [];
  for (const request of requests) {
    const escalation = [...request.history]
      .reverse()
      .find((entry) => entry.action === 'escalated');
    if (!escalation) {
      continue;
    }
    const service = findService(request.serviceId);
    const department = findDepartment(request.departmentId);
    rows.push({
      requestId: request.id,
      reference: request.reference,
      serviceName: service?.name ?? { en: request.serviceId, ar: request.serviceId },
      departmentName: department?.name ?? { en: request.departmentId, ar: request.departmentId },
      raisedAt: escalation.at,
      ageMs: now.getTime() - new Date(escalation.at).getTime(),
    });
  }
  return rows.sort((a, b) => b.ageMs - a.ageMs);
}
