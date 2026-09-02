import { USER_IDS } from '../../core/auth/demo-users';
import {
  CommentInput,
  DataGateway,
  DocumentVerificationInput,
  QueueQuery,
  QueueResult,
  TransitionInput,
} from '../../core/data/data-gateway';
import { DashboardMetrics, DashboardPeriod } from '../../core/data/metrics';
import { DEPARTMENTS, SERVICES } from '../../core/data/service-catalogue';
import { WORKFLOW_DEFINITIONS, WORKFLOW_KEYS } from '../../core/data/workflow-definitions';
import {
  Department,
  RequestDraft,
  ServiceDefinition,
  ServiceRequest,
  User,
  WorkflowDefinition,
  WorkflowVersion,
} from '../../core/models/domain';

/**
 * A gateway that refuses everything, for specs to override one method at a time.
 *
 * Written here rather than in each spec because `DataGateway` has fifteen
 * members and three copies of the same stub would drift. Anything a screen calls
 * that the spec did not intend to exercise fails loudly instead of returning an
 * empty list that quietly hides the call.
 */
export class StubGateway extends DataGateway {
  async listDepartments(): Promise<readonly Department[]> {
    return DEPARTMENTS;
  }

  async listServices(): Promise<readonly ServiceDefinition[]> {
    return SERVICES;
  }

  async getService(serviceId: string): Promise<ServiceDefinition | null> {
    return SERVICES.find((service) => service.id === serviceId) ?? null;
  }

  async listRequestsForApplicant(_applicantId: string): Promise<readonly ServiceRequest[]> {
    throw notImplemented('listRequestsForApplicant');
  }

  async listQueue(_query: QueueQuery): Promise<QueueResult> {
    throw notImplemented('listQueue');
  }

  async getRequest(_idOrReference: string): Promise<ServiceRequest | null> {
    throw notImplemented('getRequest');
  }

  async submitRequest(_draft: RequestDraft, _applicant: User): Promise<ServiceRequest> {
    throw notImplemented('submitRequest');
  }

  async applyTransition(_input: TransitionInput): Promise<ServiceRequest> {
    throw notImplemented('applyTransition');
  }

  async addComment(_input: CommentInput): Promise<ServiceRequest> {
    throw notImplemented('addComment');
  }

  async setDocumentVerification(_input: DocumentVerificationInput): Promise<ServiceRequest> {
    throw notImplemented('setDocumentVerification');
  }

  async assignRequest(_requestId: string, _assigneeId: string | null): Promise<ServiceRequest> {
    throw notImplemented('assignRequest');
  }

  async listWorkflows(): Promise<readonly WorkflowDefinition[]> {
    return WORKFLOW_DEFINITIONS;
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    return WORKFLOW_DEFINITIONS.find((definition) => definition.id === workflowId) ?? null;
  }

  async saveWorkflowVersion(
    _workflowId: string,
    _version: WorkflowVersion,
  ): Promise<WorkflowDefinition> {
    throw notImplemented('saveWorkflowVersion');
  }

  async countRunningCases(_workflowKey: string, _version: number): Promise<number> {
    return 0;
  }

  async getDashboard(_period: DashboardPeriod): Promise<DashboardMetrics> {
    throw notImplemented('getDashboard');
  }
}

function notImplemented(member: string): Error {
  return new Error(`StubGateway.${member} was called but the spec did not provide it`);
}

/** The service the sample request below is filed against. */
export const SAMPLE_SERVICE_ID = 'svc-civil-id-replacement';

/**
 * A filed request that lines up with the real catalogue and the real published
 * workflow, so `serviceFor`, `buildStageSteps` and `availableTransitions` all
 * resolve against the same definitions the product uses.
 */
export function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
  const submittedAt = '2026-08-20T08:00:00.000Z';
  return {
    id: 'req-ca-2026-00001',
    reference: 'CA-2026-00001',
    serviceId: SAMPLE_SERVICE_ID,
    departmentId: 'dep-civil-affairs',
    applicantId: USER_IDS.citizen,
    applicantName: { en: 'Fahad Al Sabah', ar: 'فهد الصباح' },
    workflowKey: WORKFLOW_KEYS.civil,
    workflowVersion: 1,
    currentStateKey: 'documentCheck',
    status: 'inReview',
    priority: 'normal',
    createdAt: submittedAt,
    submittedAt,
    dueAt: '2026-08-22T08:00:00.000Z',
    closedAt: null,
    assigneeId: null,
    fieldValues: {
      reason: 'lost',
      incidentDate: '2026-08-18',
      address: 'Salmiya, block 4, street 1',
      contactPhone: '55512345',
    },
    documents: [
      {
        id: 'doc-1',
        requirementId: 'police-report',
        fileName: 'police-report.pdf',
        sizeKb: 420,
        mimeType: 'application/pdf',
        uploadedAt: submittedAt,
        verification: 'verified',
        note: null,
      },
    ],
    history: [
      {
        id: 'hist-0',
        at: submittedAt,
        actorId: USER_IDS.citizen,
        actorName: { en: 'Fahad Al Sabah', ar: 'فهد الصباح' },
        actorRole: 'citizen',
        action: 'submitted',
        fromStateKey: null,
        toStateKey: 'submitted',
        transitionKey: null,
        comment: null,
      },
    ],
    comments: [],
    ...overrides,
  };
}
