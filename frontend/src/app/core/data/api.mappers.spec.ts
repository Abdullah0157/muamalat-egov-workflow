import { ApiAuditTrail, ApiRequestDetail, ApiWorkflowDetail } from './api.contracts';
import { toHistory, toServiceDefinitions, toServiceRequest, toWorkflowDefinition } from './api.mappers';

/**
 * These fixtures are copied from real responses produced by the running API,
 * not invented. A mapper tested against a shape the server never sends proves
 * nothing.
 */
const REQUEST: ApiRequestDetail = {
  id: '01a05e56-bf07-7c58-afff-c2fe7595a0e9',
  referenceNumber: 'MW-2026-000123',
  serviceType: 'Commercial Licence Renewal',
  workflowKey: 'commercial-licence-renewal',
  workflowVersion: 1,
  applicantUserId: 'citizen-1',
  applicantDisplayName: 'Fatima Al Suwaidi',
  currentStateCode: 'DOCUMENT_REVIEW',
  currentStateNameEn: 'Document Review',
  currentStateNameAr: 'مراجعة المستندات',
  isClosed: false,
  submittedAt: '2026-03-01T09:00:00+00:00',
  currentStateEnteredAt: '2026-03-01T10:00:00+00:00',
  closedAt: null,
  decisionAt: null,
  assignedToDepartment: 'Licensing',
  feePaid: false,
  sla: { status: 'AtRisk', dueAt: '2026-03-03T10:00:00+00:00' },
  documents: [
    {
      id: 'doc-1',
      documentType: 'civil_id',
      fileName: 'civil-id.pdf',
      contentType: 'application/pdf',
      sizeBytes: 204800,
      uploadedAt: '2026-03-01T09:05:00+00:00',
      isVerified: true,
      verifiedAt: '2026-03-01T09:30:00+00:00',
    },
  ],
};

describe('request mapping', () => {
  it('carries the citizen facing reference through unchanged', () => {
    expect(toServiceRequest(REQUEST, []).reference).toBe('MW-2026-000123');
  });

  it('reports an open request in an unrecognised state as in review', () => {
    // DOCUMENT_REVIEW is not one of the statuses the UI names, and guessing an
    // outcome for an open request would misinform the applicant.
    expect(toServiceRequest(REQUEST, []).status).toBe('inReview');
  });

  it('maps terminal states onto their real outcome', () => {
    const approved = { ...REQUEST, currentStateCode: 'APPROVED', isClosed: true };
    const rejected = { ...REQUEST, currentStateCode: 'REJECTED', isClosed: true };
    const withdrawn = { ...REQUEST, currentStateCode: 'WITHDRAWN', isClosed: true };

    expect(toServiceRequest(approved, []).status).toBe('approved');
    expect(toServiceRequest(rejected, []).status).toBe('rejected');
    expect(toServiceRequest(withdrawn, []).status).toBe('cancelled');
  });

  it('flags a request waiting on the applicant', () => {
    const waiting = { ...REQUEST, currentStateCode: 'MORE_INFO_REQUIRED' };
    expect(toServiceRequest(waiting, []).status).toBe('moreInfo');
  });

  it('takes the SLA deadline from the server rather than recomputing it', () => {
    expect(toServiceRequest(REQUEST, []).dueAt).toBe('2026-03-03T10:00:00+00:00');
  });

  it('reports no deadline when the state has no SLA', () => {
    // States where the citizen has to act carry no SLA, and inventing one would
    // show a countdown the government is not actually held to.
    const noSla = { ...REQUEST, sla: null };
    expect(toServiceRequest(noSla, []).dueAt).toBeNull();
  });

  it('converts document size to whole kilobytes without reporting zero', () => {
    const tiny = {
      ...REQUEST,
      documents: [{ ...REQUEST.documents[0], sizeBytes: 200 }],
    };

    expect(toServiceRequest(tiny, []).documents[0].sizeKb).toBe(1);
  });

  it('treats an unverified document as pending rather than rejected', () => {
    const pending = {
      ...REQUEST,
      documents: [{ ...REQUEST.documents[0], isVerified: false, verifiedAt: null }],
    };

    expect(toServiceRequest(pending, []).documents[0].verification).toBe('pending');
  });
});

describe('history mapping', () => {
  const TRAIL: ApiAuditTrail = {
    requestId: REQUEST.id,
    referenceNumber: REQUEST.referenceNumber,
    chainIsValid: true,
    headHash: 'abc',
    problems: [],
    entries: [
      {
        sequence: 1,
        eventType: 'RequestSubmitted',
        fromStateCode: null,
        toStateCode: 'SUBMITTED',
        transitionCode: null,
        actorDisplayName: 'Fatima Al Suwaidi',
        actorRoles: 'Citizen',
        comment: null,
        occurredAt: '2026-03-01T09:00:00+00:00',
        hash: 'h1',
      },
      {
        sequence: 2,
        eventType: 'StateChanged',
        fromStateCode: 'SUBMITTED',
        toStateCode: 'DOCUMENT_REVIEW',
        transitionCode: 'START_REVIEW',
        actorDisplayName: 'Mariam Al Balushi',
        actorRoles: 'Officer,Supervisor',
        comment: null,
        occurredAt: '2026-03-01T10:00:00+00:00',
        hash: 'h2',
      },
    ],
  };

  it('preserves chain order', () => {
    expect(toHistory(TRAIL).map((e) => e.at)).toEqual([
      '2026-03-01T09:00:00+00:00',
      '2026-03-01T10:00:00+00:00',
    ]);
  });

  it('attributes an action to the most privileged role the actor held', () => {
    expect(toHistory(TRAIL)[1].actorRole).toBe('supervisor');
  });

  it('translates event types the UI knows about', () => {
    expect(toHistory(TRAIL)[0].action).toBe('submitted');
    expect(toHistory(TRAIL)[1].action).toBe('transition');
  });
});

describe('workflow mapping', () => {
  const WORKFLOW: ApiWorkflowDetail = {
    id: 'wf-1',
    key: 'commercial-licence-renewal',
    version: 1,
    nameEn: 'Commercial Licence Renewal',
    nameAr: 'تجديد الرخصة التجارية',
    isPublished: true,
    createdAt: '2026-01-01T00:00:00+00:00',
    states: [
      {
        code: 'SUBMITTED',
        nameEn: 'Submitted',
        nameAr: 'تم التقديم',
        kind: 'Start',
        owningDepartment: 'Licensing',
        sortOrder: 1,
        sla: { target: '1.00:00:00', warnAfter: '18:00:00', escalateToRole: 'Supervisor' },
      },
      {
        code: 'MORE_INFO_REQUIRED',
        nameEn: 'More Information Required',
        nameAr: 'مطلوب معلومات إضافية',
        kind: 'Intermediate',
        owningDepartment: null,
        sortOrder: 3,
        sla: null,
      },
      {
        code: 'APPROVED',
        nameEn: 'Approved',
        nameAr: 'تمت الموافقة',
        kind: 'Terminal',
        owningDepartment: null,
        sortOrder: 7,
        sla: null,
      },
    ],
    transitions: [
      {
        code: 'REQUEST_INFO',
        fromStateCode: 'SUBMITTED',
        toStateCode: 'MORE_INFO_REQUIRED',
        nameEn: 'Request Information',
        nameAr: 'طلب معلومات',
        kind: 'RequestInformation',
        requiresComment: true,
        allowedRoles: ['Officer', 'Supervisor'],
        guards: [{ kind: 'RequiresComment', parameter: null }],
        actions: [],
      },
      {
        code: 'TO_TECHNICAL',
        fromStateCode: 'SUBMITTED',
        toStateCode: 'APPROVED',
        nameEn: 'Approve',
        nameAr: 'اعتماد',
        kind: 'Normal',
        requiresComment: false,
        allowedRoles: ['Supervisor'],
        guards: [{ kind: 'RequiresDocumentType', parameter: 'civil_id' }],
        actions: [],
      },
    ],
  };

  it('keeps both languages', () => {
    const mapped = toWorkflowDefinition(WORKFLOW);
    expect(mapped.name.en).toBe('Commercial Licence Renewal');
    expect(mapped.name.ar).toBe('تجديد الرخصة التجارية');
  });

  it('parses a .NET day-and-time duration into hours', () => {
    // "1.00:00:00" is one day, which is 24 hours and not 1.
    const mapped = toWorkflowDefinition(WORKFLOW);
    expect(mapped.versions[0].states[0].slaHours).toBe(24);
  });

  it('leaves states with no SLA without a deadline', () => {
    const mapped = toWorkflowDefinition(WORKFLOW);
    expect(mapped.versions[0].states[1].slaHours).toBeNull();
  });

  it('marks start and terminal states', () => {
    const states = toWorkflowDefinition(WORKFLOW).versions[0].states;
    expect(states[0].kind).toBe('start');
    expect(states[2].kind).toBe('end');
  });

  it('classifies a request-for-information transition', () => {
    const transitions = toWorkflowDefinition(WORKFLOW).versions[0].transitions;
    expect(transitions[0].kind).toBe('moreInfo');
  });

  it('renders structured guards as a readable expression', () => {
    const transitions = toWorkflowDefinition(WORKFLOW).versions[0].transitions;
    expect(transitions[1].guard).toBe('RequiresDocumentType(civil_id)');
  });

  it('infers that a document guard means an attachment is required', () => {
    const transitions = toWorkflowDefinition(WORKFLOW).versions[0].transitions;
    expect(transitions[1].requiresAttachment).toBeTrue();
    expect(transitions[0].requiresAttachment).toBeFalse();
  });

  it('advertises an SLA that counts only government-owned stages', () => {
    // MORE_INFO_REQUIRED has no SLA because the citizen is the one who must
    // act; counting it would overstate how long the department takes.
    const [service] = toServiceDefinitions([toWorkflowDefinition(WORKFLOW)]);
    expect(service.slaHours).toBe(24);
  });
});
