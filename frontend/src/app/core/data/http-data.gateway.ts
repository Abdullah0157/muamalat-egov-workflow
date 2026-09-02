import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { findWorkflow, registerWorkflows } from './workflow-definitions';
import {
  CommentInput,
  DataGateway,
  DocumentVerificationInput,
  QueueQuery,
  QueueResult,
  TransitionInput,
} from './data-gateway';
import { DashboardMetrics, DashboardPeriod } from './metrics';
import {
  Department,
  WorkflowTransition,
  HistoryEntry,
  RequestDraft,
  RequestStatus,
  ServiceDefinition,
  ServiceRequest,
  SlaStatus,
  User,
  WorkflowDefinition,
} from '../models/domain';
import {
  ApiAuditTrail,
  ApiRequestDetail,
  ApiDashboard,
  ApiRequestSummary,
  ApiWorkflowDetail,
  ApiWorkflowSummary,
} from './api.contracts';
import {
  toDashboard,
  toDepartments,
  toHistory,
  toServiceDefinitions,
  toServiceRequest,
  toServiceRequestFromSummary,
  toWorkflowDefinition,
} from './api.mappers';

/**
 * Talks to the Muamalat API.
 *
 * Swapped in for {@link MockDataGateway} through `data.providers.ts`; no screen,
 * guard or resource changes, because everything depends on the abstract
 * {@link DataGateway} rather than on an implementation.
 *
 * Where the API does not yet expose a capability the UI offers, the method
 * throws {@link ApiCapabilityError} rather than returning invented data. A
 * screen that quietly shows fabricated numbers is worse than one that says the
 * feature is unavailable, particularly in a system of record.
 */
@Injectable()
export class HttpDataGateway extends DataGateway {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  // ---------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------

  /**
   * Departments are not a table of their own: they are the set of owning
   * departments declared across published workflow states. Deriving them keeps
   * a single source of truth, so adding a department to a workflow in the
   * designer is all it takes for it to appear in the officer filters.
   */
  async listDepartments(): Promise<readonly Department[]> {
    return toDepartments(await this.publishedWorkflows());
  }

  async listServices(): Promise<readonly ServiceDefinition[]> {
    return toServiceDefinitions(await this.publishedWorkflows());
  }

  async getService(serviceId: string): Promise<ServiceDefinition | null> {
    const services = await this.listServices();
    return services.find((service) => service.id === serviceId) ?? null;
  }

  // ---------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------

  async listRequestsForApplicant(applicantId: string): Promise<readonly ServiceRequest[]> {
    const rows = await this.get<ApiRequestSummary[]>('/requests/mine');

    // The endpoint is already scoped to the authenticated caller by the API.
    // Filtering again here is defence in depth: if the token and the requested
    // applicant ever disagree, the UI must not render someone else's requests.
    return rows
      .filter((row) => row.applicantUserId === applicantId)
      .map(toServiceRequestFromSummary);
  }

  async listQueue(query: QueueQuery): Promise<QueueResult> {
    // The API pages the queue; the officer screen filters and sorts the page it
    // is given. A full page is requested so client side narrowing has the whole
    // page to work with rather than a slice of a slice.
    let params = new HttpParams().set('page', '1').set('pageSize', '100');

    if (query.departmentId) {
      params = params.set('department', query.departmentId);
    }

    const rows = await this.get<ApiRequestSummary[]>('/requests/queue', params);
    const mapped = rows.map(toServiceRequestFromSummary);

    // Search, service and SLA narrowing happen client side against the current
    // page because the API does not accept those filters yet. This is stated
    // plainly rather than hidden: the counts below describe the page, not the
    // whole queue, and the officer screen labels them as such.
    const filtered = mapped.filter((request) => {
      if (query.serviceId && request.serviceId !== query.serviceId) {
        return false;
      }

      if (query.slaStatus && this.slaStatusOf(request) !== query.slaStatus) {
        return false;
      }

      if (query.search) {
        const needle = query.search.trim().toLowerCase();
        const haystack = `${request.reference} ${request.applicantName.en} ${request.applicantName.ar}`;
        if (!haystack.toLowerCase().includes(needle)) {
          return false;
        }
      }

      return true;
    });

    return { rows: filtered, total: filtered.length };
  }

  async getRequest(idOrReference: string): Promise<ServiceRequest | null> {
    // Deep links in the interface carry the reference number, because that is what a
    // citizen has in front of them. The API exposes both, so the right path is chosen
    // rather than making every caller know which kind of key it is holding.
    const path = isUuid(idOrReference)
      ? `/requests/${encodeURIComponent(idOrReference)}`
      : `/requests/by-reference/${encodeURIComponent(idOrReference)}`;

    const detail = await this.getOrNull<ApiRequestDetail>(path);

    if (!detail) {
      return null;
    }

    // A case can be opened directly from a deep link, before any screen has had
    // reason to list the catalogue. The definition it is pinned to is fetched on
    // demand, otherwise the officer would see a case with no available actions
    // and no stage names, which looks like a permissions problem rather than a
    // missing fetch.
    if (!findWorkflow(detail.workflowKey)) {
      const definition = await this.getOrNull<ApiWorkflowDetail>(
        `/workflows/${encodeURIComponent(detail.workflowKey)}/versions/${detail.workflowVersion}`,
      );

      if (definition) {
        registerWorkflows([toWorkflowDefinition(definition)]);
      }
    }

    // History is a separate resource because it carries the chain verification
    // result alongside the entries, and most screens do not need it.
    const audit = await this.getOrNull<ApiAuditTrail>(
      `/requests/${encodeURIComponent(detail.id)}/audit`,
    );

    return toServiceRequest(detail, audit ? toHistory(audit) : []);
  }

  async submitRequest(draft: RequestDraft, _applicant: User): Promise<ServiceRequest> {
    const detail = await this.post<ApiRequestDetail>('/requests', {
      workflowKey: draft.serviceId,
      serviceType: null,
    });

    return toServiceRequest(detail, []);
  }

  async applyTransition(input: TransitionInput): Promise<ServiceRequest> {
    const detail = await this.post<ApiRequestDetail>(
      `/requests/${encodeURIComponent(input.requestId)}/transitions/${encodeURIComponent(input.transitionKey)}`,
      { comment: input.comment },
    );

    return toServiceRequest(detail, []);
  }

  /**
   * The transitions the API will actually accept from this caller right now.
   * Asking the server rather than deriving them in the browser means the rules
   * are enforced in exactly one place, and a UI that is out of date cannot
   * offer an action that the engine will refuse.
   */
  async listAvailableTransitions(requestId: string): Promise<readonly WorkflowTransition[]> {
    const request = await this.getRequest(requestId);
    if (!request) return [];

    const offered = await this.get<AvailableTransition[]>(
      `/requests/${encodeURIComponent(request.id)}/transitions`,
    );

    // The engine names the transitions it will accept; the definition supplies the
    // rest of each one (guards, target, roles) for display.
    const version = findWorkflow(request.workflowKey)?.versions.find(
      (v) => v.status === 'published',
    );

    const offeredCodes = new Set(offered.map((t) => t.code));

    return (version?.transitions ?? []).filter((t) => offeredCodes.has(t.key));
  }

  // ---------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------

  async listWorkflows(): Promise<readonly WorkflowDefinition[]> {
    const summaries = await this.get<ApiWorkflowSummary[]>('/workflows');

    const details = await Promise.all(
      summaries.map((summary) =>
        this.getOrNull<ApiWorkflowDetail>(
          `/workflows/${encodeURIComponent(summary.key)}/versions/${summary.version}`,
        ),
      ),
    );

    const definitions = details
      .filter((detail): detail is ApiWorkflowDetail => detail !== null)
      .map(toWorkflowDefinition);

    // Registered so the presentation helpers can resolve state names, stages and
    // the transitions an officer may take. They reason about the definition a
    // request is pinned to, which only the server can supply.
    registerWorkflows(definitions);

    return definitions;
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    const workflows = await this.listWorkflows();
    return workflows.find((workflow) => workflow.id === workflowId) ?? null;
  }

  // ---------------------------------------------------------------------
  // Not yet exposed by the API
  // ---------------------------------------------------------------------

  async addComment(_input: CommentInput): Promise<ServiceRequest> {
    throw new ApiCapabilityError('comments');
  }

  async setDocumentVerification(_input: DocumentVerificationInput): Promise<ServiceRequest> {
    throw new ApiCapabilityError('document verification');
  }

  async assignRequest(_requestId: string, _assigneeId: string | null): Promise<ServiceRequest> {
    throw new ApiCapabilityError('manual assignment');
  }

  async saveWorkflowVersion(): Promise<WorkflowDefinition> {
    throw new ApiCapabilityError('workflow editing');
  }

  async countRunningCases(_workflowKey: string, _version: number): Promise<number> {
    throw new ApiCapabilityError('running case counts');
  }

  async getDashboard(period: DashboardPeriod): Promise<DashboardMetrics> {
    const api = await this.get<ApiDashboard>(
      '/dashboard',
      new HttpParams().set('period', period),
    );

    const metrics = toDashboard(api, period);

    // The cases needing attention are the breached ones the dashboard already
    // named. Resolved against the queue so the supervisor gets full request rows
    // to open, rather than the dashboard inventing a second shape for the same
    // records.
    const queue = await this.listQueue({
      officerId: '',

      // No department filter: a supervisor oversees every department, so the
      // breached cases must be resolved across all of them.
      departmentId: null,
      assignment: 'department',
      search: '',
      serviceId: null,
      priority: null,
      slaStatus: null,
    });

    const escalatedIds = new Set(metrics.escalatedCases.map((c) => c.requestId));

    return { ...metrics, attentionCases: queue.rows.filter((r) => escalatedIds.has(r.id)) };
  }

  // ---------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------

  private async publishedWorkflows(): Promise<readonly WorkflowDefinition[]> {
    const workflows = await this.listWorkflows();
    return workflows.filter((workflow) => workflow.versions.some((v) => v.status === 'published'));
  }

  private slaStatusOf(request: ServiceRequest): SlaStatus {
    if (!request.dueAt) {
      return 'notApplicable';
    }

    if (request.closedAt) {
      return 'met';
    }

    const remaining = new Date(request.dueAt).getTime() - Date.now();
    if (remaining <= 0) {
      return 'breached';
    }

    // Mirrors the server's default warning threshold of 75 percent elapsed.
    const total = new Date(request.dueAt).getTime() - new Date(request.submittedAt ?? request.createdAt).getTime();
    return remaining <= total * 0.25 ? 'atRisk' : 'onTrack';
  }

  private get<T>(path: string, params?: HttpParams): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.baseUrl}${path}`, { params }));
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.baseUrl}${path}`, body));
  }
}

export interface AvailableTransition {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly toStateCode: string;
  readonly requiresComment: boolean;
  readonly kind: string;
}

/**
 * Raised when a screen asks for something the API does not implement yet.
 * Carrying the capability name lets the UI say which feature is unavailable
 * instead of showing a generic failure.
 */
export class ApiCapabilityError extends Error {
  constructor(readonly capability: string) {
    super(`The API does not support ${capability} yet.`);
    this.name = 'ApiCapabilityError';
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}
