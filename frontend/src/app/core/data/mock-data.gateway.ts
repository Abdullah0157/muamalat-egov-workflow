import { Injectable, inject, signal } from '@angular/core';

import {
  Department,
  HistoryEntry,
  RequestDocument,
  RequestDraft,
  RequestStatus,
  Role,
  ServiceDefinition,
  ServiceRequest,
  User,
  WorkflowDefinition,
  WorkflowVersion,
} from '../models/domain';
import {
  CommentInput,
  DataGateway,
  DocumentVerificationInput,
  NotFoundError,
  QueueQuery,
  QueueResult,
  ServiceUnavailableError,
  TransitionInput,
  TransitionNotAllowedError,
} from './data-gateway';
import { buildDataset } from './dataset';
import { DemoSettingsService } from './demo-settings.service';
import { DashboardMetrics, DashboardPeriod, computeDashboard } from './metrics';
import { DEPARTMENTS, SERVICES, findDepartment, findService } from './service-catalogue';
import { addHours, isOpen, slaStateFor } from './sla';
import {
  WORKFLOW_DEFINITIONS,
  findVersion,
  findWorkflow,
  publishedVersion,
} from './workflow-definitions';

/**
 * In-memory implementation of the data gateway.
 *
 * Holds the corpus in a signal and mutates it the way a server would: a
 * transition validates against the published workflow before it is applied,
 * writes a history entry, and recomputes the derived status. Reads go through a
 * simulated latency so the interface's loading states are exercised in normal
 * use rather than only when someone remembers to test them.
 */
@Injectable()
export class MockDataGateway extends DataGateway {
  private readonly demo = inject(DemoSettingsService);
  private readonly now = new Date();
  private readonly requests = signal<readonly ServiceRequest[]>(buildDataset(this.now).requests);
  private readonly workflows = signal<readonly WorkflowDefinition[]>(WORKFLOW_DEFINITIONS);
  private referenceSequence = 90000;

  // ---------------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------------

  async listDepartments(): Promise<readonly Department[]> {
    return this.read(() => DEPARTMENTS);
  }

  async listServices(): Promise<readonly ServiceDefinition[]> {
    return this.read(() => SERVICES);
  }

  async getService(serviceId: string): Promise<ServiceDefinition | null> {
    return this.read(() => findService(serviceId) ?? null);
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  async listRequestsForApplicant(applicantId: string): Promise<readonly ServiceRequest[]> {
    return this.read(() =>
      this.visibleRequests().filter((request) => request.applicantId === applicantId),
    );
  }

  async listQueue(query: QueueQuery): Promise<QueueResult> {
    return this.read(() => {
      const all = this.visibleRequests().filter(
        (request) =>
          isOpen(request) &&
          (query.departmentId === null || request.departmentId === query.departmentId),
      );

      const rows = all
        .filter((request) => this.matchesAssignment(request, query))
        .filter((request) => this.matchesSearch(request, query.search))
        .filter((request) => query.serviceId === null || request.serviceId === query.serviceId)
        .filter((request) => query.priority === null || request.priority === query.priority)
        .filter(
          (request) =>
            query.slaStatus === null ||
            slaStateFor(request, new Date()).status === query.slaStatus,
        )
        .sort(byDeadline);

      return { rows, total: all.length };
    });
  }

  async getRequest(idOrReference: string): Promise<ServiceRequest | null> {
    return this.read(
      () =>
        this.requests().find(
          (request) =>
            request.id === idOrReference ||
            request.reference.toLowerCase() === idOrReference.toLowerCase(),
        ) ?? null,
    );
  }

  async submitRequest(draft: RequestDraft, applicant: User): Promise<ServiceRequest> {
    return this.write(() => {
      const service = findService(draft.serviceId);
      if (!service) {
        throw new NotFoundError('Service');
      }
      const workflow = findWorkflow(service.workflowKey);
      if (!workflow) {
        throw new NotFoundError('Workflow');
      }
      const version = publishedVersion(workflow);
      const startState = version.states.find((state) => state.kind === 'start');
      if (!startState) {
        throw new NotFoundError('Workflow start state');
      }

      const submittedAt = new Date();
      const department = findDepartment(service.departmentId);
      this.referenceSequence += 1;
      const reference = `${department?.code ?? 'XX'}-${submittedAt.getUTCFullYear()}-${String(
        this.referenceSequence,
      ).padStart(5, '0')}`;

      const documents: RequestDocument[] = draft.documents.map((document, index) => ({
        id: `doc-new-${this.referenceSequence}-${index}`,
        requirementId: document.requirementId,
        fileName: document.fileName,
        sizeKb: document.sizeKb,
        mimeType: document.mimeType,
        uploadedAt: submittedAt.toISOString(),
        verification: 'pending',
        note: null,
      }));

      const request: ServiceRequest = {
        id: `req-${reference.toLowerCase()}`,
        reference,
        serviceId: service.id,
        departmentId: service.departmentId,
        applicantId: applicant.id,
        applicantName: applicant.name,
        workflowKey: workflow.key,
        workflowVersion: version.version,
        currentStateKey: startState.key,
        status: 'submitted',
        priority: draft.priority,
        createdAt: submittedAt.toISOString(),
        submittedAt: submittedAt.toISOString(),
        dueAt: addHours(submittedAt, service.slaHours).toISOString(),
        closedAt: null,
        assigneeId: null,
        fieldValues: { ...draft.fieldValues, contactPhone: draft.contactPhone },
        documents,
        history: [
          {
            id: `hist-${reference}-0`,
            at: submittedAt.toISOString(),
            actorId: applicant.id,
            actorName: applicant.name,
            actorRole: applicant.role,
            action: 'submitted',
            fromStateKey: null,
            toStateKey: startState.key,
            transitionKey: null,
            comment: null,
          },
        ],
        comments: [],
      };

      this.requests.update((current) => [request, ...current]);
      return request;
    });
  }

  async applyTransition(input: TransitionInput): Promise<ServiceRequest> {
    return this.write(() => {
      const request = this.require(input.requestId);
      const version = findVersion(request.workflowKey, request.workflowVersion);
      if (!version) {
        throw new NotFoundError('Workflow version');
      }

      const transition = version.transitions.find(
        (candidate) =>
          candidate.key === input.transitionKey &&
          candidate.fromStateKey === request.currentStateKey,
      );
      if (!transition || !transition.allowedRoles.includes(input.actor.role)) {
        throw new TransitionNotAllowedError(input.transitionKey);
      }
      if (transition.requiresComment && !input.comment?.trim()) {
        throw new TransitionNotAllowedError(input.transitionKey);
      }

      const target = version.states.find((state) => state.key === transition.toStateKey);
      if (!target) {
        throw new NotFoundError('Workflow state');
      }

      const at = new Date();
      const entry: HistoryEntry = {
        id: `hist-${request.id}-${request.history.length}`,
        at: at.toISOString(),
        actorId: input.actor.id,
        actorName: input.actor.name,
        actorRole: input.actor.role,
        action: transition.kind === 'escalate' ? 'escalated' : 'transition',
        fromStateKey: request.currentStateKey,
        toStateKey: transition.toStateKey,
        transitionKey: transition.key,
        comment: input.comment,
      };

      const comments = input.comment?.trim()
        ? [
            ...request.comments,
            {
              id: `cmt-${request.id}-${request.comments.length}`,
              at: at.toISOString(),
              authorId: input.actor.id,
              authorName: input.actor.name,
              authorRole: input.actor.role,
              body: input.comment.trim(),
              internal: input.internalComment,
            },
          ]
        : request.comments;

      const closed = target.kind === 'end';
      const updated: ServiceRequest = {
        ...request,
        currentStateKey: target.key,
        status: deriveStatus(target.key, target.kind),
        closedAt: closed ? at.toISOString() : null,
        assigneeId: closed ? null : assigneeFor(target.assigneeRole, request, input.actor),
        history: [...request.history, entry],
        comments,
      };

      this.replace(updated);
      return updated;
    });
  }

  async addComment(input: CommentInput): Promise<ServiceRequest> {
    return this.write(() => {
      const request = this.require(input.requestId);
      const at = new Date();
      const updated: ServiceRequest = {
        ...request,
        comments: [
          ...request.comments,
          {
            id: `cmt-${request.id}-${request.comments.length}`,
            at: at.toISOString(),
            authorId: input.author.id,
            authorName: input.author.name,
            authorRole: input.author.role,
            body: input.body.trim(),
            internal: input.internal,
          },
        ],
        history: [
          ...request.history,
          {
            id: `hist-${request.id}-${request.history.length}`,
            at: at.toISOString(),
            actorId: input.author.id,
            actorName: input.author.name,
            actorRole: input.author.role,
            action: 'comment',
            fromStateKey: null,
            toStateKey: null,
            transitionKey: null,
            comment: input.body.trim(),
          },
        ],
      };
      this.replace(updated);
      return updated;
    });
  }

  async setDocumentVerification(input: DocumentVerificationInput): Promise<ServiceRequest> {
    return this.write(() => {
      const request = this.require(input.requestId);
      const at = new Date();
      const documents = request.documents.map((document) =>
        document.id === input.documentId
          ? { ...document, verification: input.verification, note: input.note }
          : document,
      );
      const updated: ServiceRequest = {
        ...request,
        documents,
        history: [
          ...request.history,
          {
            id: `hist-${request.id}-${request.history.length}`,
            at: at.toISOString(),
            actorId: input.actor.id,
            actorName: input.actor.name,
            actorRole: input.actor.role,
            action: input.verification === 'rejected' ? 'documentRejected' : 'documentVerified',
            fromStateKey: null,
            toStateKey: null,
            transitionKey: null,
            comment: input.note,
          },
        ],
      };
      this.replace(updated);
      return updated;
    });
  }

  async assignRequest(requestId: string, assigneeId: string | null): Promise<ServiceRequest> {
    return this.write(() => {
      const request = this.require(requestId);
      const updated = { ...request, assigneeId };
      this.replace(updated);
      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Workflow definitions
  // ---------------------------------------------------------------------------

  async listWorkflows(): Promise<readonly WorkflowDefinition[]> {
    return this.read(() => (this.demo.emptyData() ? [] : this.workflows()));
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    return this.read(
      () => this.workflows().find((definition) => definition.id === workflowId) ?? null,
    );
  }

  async saveWorkflowVersion(
    workflowId: string,
    version: WorkflowVersion,
  ): Promise<WorkflowDefinition> {
    return this.write(() => {
      const definition = this.workflows().find((candidate) => candidate.id === workflowId);
      if (!definition) {
        throw new NotFoundError('Workflow definition');
      }
      const updated: WorkflowDefinition = {
        ...definition,
        versions: definition.versions.map((candidate) =>
          candidate.id === version.id ? version : candidate,
        ),
      };
      this.workflows.update((current) =>
        current.map((candidate) => (candidate.id === workflowId ? updated : candidate)),
      );
      return updated;
    });
  }

  async countRunningCases(workflowKey: string, version: number): Promise<number> {
    return this.read(
      () =>
        this.requests().filter(
          (request) =>
            request.workflowKey === workflowKey &&
            request.workflowVersion === version &&
            isOpen(request),
        ).length,
    );
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  async getDashboard(period: DashboardPeriod): Promise<DashboardMetrics> {
    return this.read(() => computeDashboard(this.visibleRequests(), period, new Date()));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private visibleRequests(): readonly ServiceRequest[] {
    return this.demo.emptyData() ? [] : this.requests();
  }

  private require(requestId: string): ServiceRequest {
    const request = this.requests().find((candidate) => candidate.id === requestId);
    if (!request) {
      throw new NotFoundError('Request');
    }
    return request;
  }

  private replace(updated: ServiceRequest): void {
    this.requests.update((current) =>
      current.map((request) => (request.id === updated.id ? updated : request)),
    );
  }

  private matchesAssignment(request: ServiceRequest, query: QueueQuery): boolean {
    switch (query.assignment) {
      case 'mine':
        return request.assigneeId === query.officerId;
      case 'unassigned':
        return request.assigneeId === null;
      case 'department':
        return true;
    }
  }

  private matchesSearch(request: ServiceRequest, search: string): boolean {
    const term = search.trim().toLowerCase();
    if (!term) {
      return true;
    }
    const service = findService(request.serviceId);
    const haystack = [
      request.reference,
      request.applicantName.en,
      request.applicantName.ar,
      service?.name.en ?? '',
      service?.name.ar ?? '',
      service?.code ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  }

  /** Reads go through the simulated latency and the simulated outage switch. */
  private async read<T>(produce: () => T): Promise<T> {
    await this.delay();
    if (this.demo.consumeFailure()) {
      throw new ServiceUnavailableError();
    }
    return produce();
  }

  /**
   * Writes use a shorter delay and never fail from the demo switch, because a
   * failed write in a prototype leaves the interface in a state nobody can
   * reason about. The failure switch is there to exercise loading and error
   * states on reads.
   */
  private async write<T>(produce: () => T): Promise<T> {
    await this.delay(0.5);
    return produce();
  }

  private delay(factor = 1): Promise<void> {
    const ms = Math.round(this.demo.latencyMs() * factor);
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function byDeadline(a: ServiceRequest, b: ServiceRequest): number {
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return aDue - bDue;
}

function deriveStatus(stateKey: string, kind: string): RequestStatus {
  if (kind === 'end') {
    return stateKey === 'rejected' ? 'rejected' : 'completed';
  }
  if (stateKey === 'moreInfo') {
    return 'moreInfo';
  }
  if (stateKey === 'issuance') {
    return 'approved';
  }
  return 'inReview';
}

/**
 * Who owns the case once it lands in a state. An officer who advances a case
 * into another officer state keeps it; anything else falls back to the pool so
 * a supervisor or a colleague can pick it up.
 */
function assigneeFor(role: Role | null, request: ServiceRequest, actor: User): string | null {
  switch (role) {
    case 'citizen':
      return request.applicantId;
    case 'officer':
      return actor.role === 'officer' ? actor.id : request.assigneeId;
    case 'supervisor':
      return actor.role === 'supervisor' ? actor.id : null;
    default:
      return null;
  }
}
