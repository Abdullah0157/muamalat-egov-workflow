import {
  Department,
  DocumentVerification,
  RequestDraft,
  RequestPriority,
  ServiceDefinition,
  ServiceRequest,
  SlaStatus,
  User,
  WorkflowDefinition,
  WorkflowVersion,
} from '../models/domain';
import { DashboardMetrics, DashboardPeriod } from './metrics';

export type QueueAssignment = 'mine' | 'unassigned' | 'department';

export interface QueueQuery {
  readonly officerId: string;
  readonly departmentId: string | null;
  readonly assignment: QueueAssignment;
  readonly search: string;
  readonly serviceId: string | null;
  readonly priority: RequestPriority | null;
  readonly slaStatus: SlaStatus | null;
}

export interface QueueResult {
  readonly rows: readonly ServiceRequest[];
  /** Total before filters, so the interface can say "12 of 48". */
  readonly total: number;
}

export interface TransitionInput {
  readonly requestId: string;
  readonly transitionKey: string;
  readonly actor: User;
  readonly comment: string | null;
  readonly internalComment: boolean;
}

export interface CommentInput {
  readonly requestId: string;
  readonly author: User;
  readonly body: string;
  readonly internal: boolean;
}

export interface DocumentVerificationInput {
  readonly requestId: string;
  readonly documentId: string;
  readonly actor: User;
  readonly verification: DocumentVerification;
  readonly note: string | null;
}

/**
 * The whole surface the interface uses to reach data.
 *
 * Nothing outside this folder knows where records come from. Replacing the
 * in-memory implementation with an HTTP client is a change to one provider in
 * `data.providers.ts` plus a new subclass; no component, guard or route touches
 * anything else. Everything returns a promise for the same reason: an HTTP
 * implementation would, and code written against a synchronous mock would have
 * to be rewritten.
 */
export abstract class DataGateway {
  abstract listDepartments(): Promise<readonly Department[]>;
  abstract listServices(): Promise<readonly ServiceDefinition[]>;
  abstract getService(serviceId: string): Promise<ServiceDefinition | null>;

  /** Requests filed by one applicant, newest first. */
  abstract listRequestsForApplicant(applicantId: string): Promise<readonly ServiceRequest[]>;

  /** The officer work queue, ordered by how close each case is to its deadline. */
  abstract listQueue(query: QueueQuery): Promise<QueueResult>;

  /** Accepts either the internal id or the public reference number. */
  abstract getRequest(idOrReference: string): Promise<ServiceRequest | null>;

  abstract submitRequest(draft: RequestDraft, applicant: User): Promise<ServiceRequest>;
  abstract applyTransition(input: TransitionInput): Promise<ServiceRequest>;
  abstract addComment(input: CommentInput): Promise<ServiceRequest>;
  abstract setDocumentVerification(input: DocumentVerificationInput): Promise<ServiceRequest>;
  abstract assignRequest(requestId: string, assigneeId: string | null): Promise<ServiceRequest>;

  abstract listWorkflows(): Promise<readonly WorkflowDefinition[]>;
  abstract getWorkflow(workflowId: string): Promise<WorkflowDefinition | null>;
  abstract saveWorkflowVersion(
    workflowId: string,
    version: WorkflowVersion,
  ): Promise<WorkflowDefinition>;
  /** How many live cases are running on a version, used to guard edits. */
  abstract countRunningCases(workflowKey: string, version: number): Promise<number>;

  abstract getDashboard(period: DashboardPeriod): Promise<DashboardMetrics>;
}

/** Raised by the gateway so screens can tell "not found" from "it broke". */
export class NotFoundError extends Error {
  constructor(readonly resource: string) {
    super(`${resource} was not found`);
    this.name = 'NotFoundError';
  }
}

/** Raised when a transition is not permitted from the current state. */
export class TransitionNotAllowedError extends Error {
  constructor(readonly transitionKey: string) {
    super(`Transition "${transitionKey}" is not available from the current state`);
    this.name = 'TransitionNotAllowedError';
  }
}

/** Raised by the simulated outage switch in the prototype controls. */
export class ServiceUnavailableError extends Error {
  constructor() {
    super('The workflow service did not respond');
    this.name = 'ServiceUnavailableError';
  }
}
