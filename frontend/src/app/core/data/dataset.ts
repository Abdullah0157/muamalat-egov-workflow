import { ALL_USERS, USER_IDS, findUser } from '../auth/demo-users';
import {
  HistoryEntry,
  RequestComment,
  RequestDocument,
  RequestPriority,
  RequestStatus,
  Role,
  ServiceDefinition,
  ServiceRequest,
  User,
  WorkflowTransition,
  WorkflowVersion,
} from '../models/domain';
import { SeededRandom } from './random';
import { SERVICES, findDepartment } from './service-catalogue';
import { addHours } from './sla';
import { findWorkflow, publishedVersion } from './workflow-definitions';

const SEED = 20260901;
const REQUEST_COUNT = 64;
const HISTORY_WINDOW_DAYS = 120;

export interface Dataset {
  readonly requests: readonly ServiceRequest[];
  readonly generatedAt: string;
}

/**
 * Builds the sample corpus.
 *
 * Rather than inventing statuses and dates independently, every record is
 * produced by walking its own workflow: a case is created, submitted, and then
 * stepped through real transitions with plausible dwell times until it either
 * closes or runs out of simulated time. The history, the current state, the
 * status and the SLA position therefore agree with each other, which is the
 * only way the dashboard figures can be honest.
 *
 * `now` is a parameter so specs can pin the corpus to a fixed instant.
 */
export function buildDataset(now: Date): Dataset {
  const random = new SeededRandom(SEED);
  const requests: ServiceRequest[] = [];
  const sequenceByDepartment = new Map<string, number>();

  for (let index = 0; index < REQUEST_COUNT; index += 1) {
    const service = random.weighted(serviceWeights());
    const request = buildRequest(random, service, now, sequenceByDepartment);
    if (request) {
      requests.push(request);
    }
  }

  // Newest first is what every list in the product wants.
  requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { requests, generatedAt: now.toISOString() };
}

/**
 * Civil documents are high volume and quick; building permits are rare and
 * slow. Weighting the mix this way is what makes the bottleneck table show
 * something a supervisor would recognise.
 */
function serviceWeights(): readonly (readonly [ServiceDefinition, number])[] {
  return SERVICES.map((service) => {
    switch (service.code) {
      case 'CA-204':
        return [service, 5] as const;
      case 'CA-101':
        return [service, 4] as const;
      case 'CO-315':
        return [service, 3] as const;
      case 'MP-505':
        return [service, 3] as const;
      case 'HE-602':
        return [service, 3] as const;
      case 'MU-418':
        return [service, 2] as const;
      case 'CO-310':
        return [service, 2] as const;
      default:
        return [service, 1] as const;
    }
  });
}

interface SimulationStep {
  readonly transition: WorkflowTransition;
  readonly at: Date;
  readonly actor: User;
}

function buildRequest(
  random: SeededRandom,
  service: ServiceDefinition,
  now: Date,
  sequenceByDepartment: Map<string, number>,
): ServiceRequest | null {
  const workflow = findWorkflow(service.workflowKey);
  if (!workflow) {
    return null;
  }
  const version = publishedVersion(workflow);
  const startState = version.states.find((state) => state.kind === 'start');
  if (!startState) {
    return null;
  }

  const applicant = random.chance(0.65) ? requireUser(USER_IDS.citizen) : requireUser(USER_IDS.citizenSecond);
  const createdAt = randomInstant(random, now, HISTORY_WINDOW_DAYS);
  const submittedAt = new Date(createdAt.getTime() + random.int(2, 90) * 60_000);
  const dueAt = addHours(submittedAt, service.slaHours);
  const priority = random.weighted<RequestPriority>([
    ['normal', 8],
    ['high', 3],
    ['urgent', 1],
  ]);

  const department = findDepartment(service.departmentId);
  const departmentCode = department?.code ?? 'XX';
  const sequence = (sequenceByDepartment.get(departmentCode) ?? 0) + 1;
  sequenceByDepartment.set(departmentCode, sequence);
  const reference = `${departmentCode}-${submittedAt.getUTCFullYear()}-${String(sequence).padStart(
    5,
    '0',
  )}`;

  const officer = pickOfficer(random, service.departmentId);
  const supervisor = requireUser(USER_IDS.supervisor);

  const steps = simulate(random, version, startState.key, submittedAt, now, {
    applicant,
    officer,
    supervisor,
  });

  const currentStateKey = steps.length > 0 ? steps[steps.length - 1].transition.toStateKey : startState.key;
  const currentState = version.states.find((state) => state.key === currentStateKey);
  const closed = currentState?.kind === 'end';
  const closedAt = closed && steps.length > 0 ? steps[steps.length - 1].at : null;

  const documents = buildDocuments(random, service, submittedAt, steps.length > 1);
  const history = buildHistory(applicant, submittedAt, steps, version);
  const comments = buildComments(random, steps);

  const status = deriveStatus(currentStateKey, currentState?.kind ?? 'task', steps);

  return {
    id: `req-${reference.toLowerCase()}`,
    reference,
    serviceId: service.id,
    departmentId: service.departmentId,
    applicantId: applicant.id,
    applicantName: applicant.name,
    workflowKey: workflow.key,
    workflowVersion: version.version,
    currentStateKey,
    status,
    priority,
    createdAt: createdAt.toISOString(),
    submittedAt: submittedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    closedAt: closedAt ? closedAt.toISOString() : null,
    assigneeId: closed ? null : assigneeFor(currentState?.assigneeRole ?? null, officer, supervisor, applicant),
    fieldValues: buildFieldValues(random, service, submittedAt),
    documents,
    history,
    comments,
  };
}

interface Actors {
  readonly applicant: User;
  readonly officer: User;
  readonly supervisor: User;
}

/**
 * Walks the workflow, choosing a transition at each step and advancing the
 * clock. Stops when the case reaches an end state, when the simulated clock
 * passes `now` (leaving the case open in that state), or after a hard step cap
 * so a badly formed loop cannot hang the generator.
 */
function simulate(
  random: SeededRandom,
  version: WorkflowVersion,
  startStateKey: string,
  submittedAt: Date,
  now: Date,
  actors: Actors,
): SimulationStep[] {
  const steps: SimulationStep[] = [];
  let stateKey = startStateKey;
  let clock = submittedAt;
  let loopBudget = 1;

  for (let step = 0; step < 12; step += 1) {
    const state = version.states.find((candidate) => candidate.key === stateKey);
    if (!state || state.kind === 'end') {
      break;
    }

    const options = version.transitions.filter(
      (transition) => transition.fromStateKey === stateKey,
    );
    if (options.length === 0) {
      break;
    }

    const chosen = chooseTransition(random, options, loopBudget);
    if (chosen.kind === 'moreInfo' || chosen.kind === 'escalate') {
      loopBudget -= 1;
    }

    // Dwell time is a fraction of the state's own allowance, with a long tail so
    // some cases genuinely breach.
    const allowance = state.slaHours ?? 24;
    const multiplier = random.weighted<number>([
      [0.25, 4],
      [0.6, 5],
      [0.95, 3],
      [1.6, 2],
      [3.2, 1],
    ]);
    const dwellHours = Math.max(0.25, allowance * multiplier * (0.6 + random.next() * 0.8));
    const next = addHours(clock, dwellHours);

    if (next.getTime() > now.getTime()) {
      // The case has not yet left this state.
      break;
    }

    clock = next;
    steps.push({ transition: chosen, at: clock, actor: actorFor(chosen, actors) });
    stateKey = chosen.toStateKey;
  }

  return steps;
}

function chooseTransition(
  random: SeededRandom,
  options: readonly WorkflowTransition[],
  loopBudget: number,
): WorkflowTransition {
  const weighted = options.map((transition) => {
    switch (transition.kind) {
      case 'forward':
        return [transition, 10] as const;
      case 'moreInfo':
        return [transition, loopBudget > 0 ? 3 : 0] as const;
      case 'escalate':
        return [transition, loopBudget > 0 ? 2 : 0] as const;
      case 'reject':
        return [transition, 1] as const;
    }
  });
  const usable = weighted.filter(([, weight]) => weight > 0);
  return random.weighted(usable.length > 0 ? usable : weighted);
}

function actorFor(transition: WorkflowTransition, actors: Actors): User {
  if (transition.allowedRoles.includes('citizen')) {
    return actors.applicant;
  }
  if (transition.allowedRoles.includes('supervisor') && !transition.allowedRoles.includes('officer')) {
    return actors.supervisor;
  }
  return actors.officer;
}

function assigneeFor(
  role: Role | null,
  officer: User,
  supervisor: User,
  applicant: User,
): string | null {
  switch (role) {
    case 'officer':
      return officer.id;
    case 'supervisor':
      return supervisor.id;
    case 'citizen':
      return applicant.id;
    default:
      return null;
  }
}

function deriveStatus(
  stateKey: string,
  kind: string,
  steps: readonly SimulationStep[],
): RequestStatus {
  if (kind === 'end') {
    return stateKey === 'rejected' ? 'rejected' : 'completed';
  }
  if (stateKey === 'moreInfo') {
    return 'moreInfo';
  }
  if (stateKey === 'issuance') {
    return 'approved';
  }
  if (steps.length === 0) {
    return 'submitted';
  }
  return 'inReview';
}

function buildHistory(
  applicant: User,
  submittedAt: Date,
  steps: readonly SimulationStep[],
  version: WorkflowVersion,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    {
      id: 'hist-submitted',
      at: submittedAt.toISOString(),
      actorId: applicant.id,
      actorName: applicant.name,
      actorRole: 'citizen',
      action: 'submitted',
      fromStateKey: null,
      toStateKey: version.states.find((state) => state.kind === 'start')?.key ?? null,
      transitionKey: null,
      comment: null,
    },
  ];

  steps.forEach((step, index) => {
    entries.push({
      id: `hist-${index}`,
      at: step.at.toISOString(),
      actorId: step.actor.id,
      actorName: step.actor.name,
      actorRole: step.actor.role,
      action: step.transition.kind === 'escalate' ? 'escalated' : 'transition',
      fromStateKey: step.transition.fromStateKey,
      toStateKey: step.transition.toStateKey,
      transitionKey: step.transition.key,
      comment: null,
    });
  });

  return entries;
}

/**
 * Comments are attached to the steps that required one, so the record reads
 * consistently: a rejection always has a reason next to it.
 */
function buildComments(random: SeededRandom, steps: readonly SimulationStep[]): RequestComment[] {
  const comments: RequestComment[] = [];
  steps.forEach((step, index) => {
    if (!step.transition.requiresComment) {
      return;
    }
    comments.push({
      id: `cmt-${index}`,
      at: step.at.toISOString(),
      authorId: step.actor.id,
      authorName: step.actor.name,
      authorRole: step.actor.role,
      body: commentBodyFor(step.transition.kind, random),
      internal: step.actor.role !== 'citizen' && random.chance(0.3),
    });
  });
  return comments;
}

function commentBodyFor(kind: WorkflowTransition['kind'], random: SeededRandom): string {
  switch (kind) {
    case 'moreInfo':
      return random.pick([
        'The tenancy contract is not legible. Please attach a clearer scan of all pages.',
        'The attached civil ID has expired. Attach a copy of the current card.',
        'The address given does not match the record. Confirm the block and street number.',
      ]);
    case 'reject':
      return random.pick([
        'Refused because the required police report was not provided within the response window.',
        'Refused: the premises area declared does not match the approved floor plan.',
        'Refused because the licence had already lapsed at the point of application.',
      ]);
    case 'escalate':
      return random.pick([
        'Raised to the supervisor: the activity requested is not listed in the current schedule.',
        'Raised to the supervisor: conflicting record found against the same plot number.',
      ]);
    default:
      return random.pick([
        'Documents checked against the originals and found in order. Recommending approval.',
        'Technical review complete. No objection from the department.',
        'Inspection carried out and the site matches the submitted plan.',
      ]);
  }
}

function buildDocuments(
  random: SeededRandom,
  service: ServiceDefinition,
  submittedAt: Date,
  reviewed: boolean,
): RequestDocument[] {
  return service.documents
    .filter((requirement) => requirement.required || random.chance(0.5))
    .map((requirement, index) => {
      const format = requirement.formats[0];
      const verification = !reviewed
        ? 'pending'
        : random.weighted<RequestDocument['verification']>([
            ['verified', 8],
            ['pending', 2],
            ['rejected', 1],
          ]);
      return {
        id: `doc-${requirement.id}-${index}`,
        requirementId: requirement.id,
        fileName: `${requirement.id}.${format}`,
        sizeKb: random.int(120, requirement.maxSizeMb * 900),
        mimeType: mimeFor(format),
        uploadedAt: new Date(submittedAt.getTime() - random.int(1, 40) * 60_000).toISOString(),
        verification,
        note:
          verification === 'rejected'
            ? 'The scan is cut off at the bottom edge. Attach the full page.'
            : null,
      };
    });
}

function mimeFor(format: string): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'dwg':
      return 'image/vnd.dwg';
    default:
      return 'application/octet-stream';
  }
}

function buildFieldValues(
  random: SeededRandom,
  service: ServiceDefinition,
  submittedAt: Date,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of service.fields) {
    switch (field.type) {
      case 'select':
        values[field.id] = field.options.length > 0 ? random.pick(field.options).value : '';
        break;
      case 'date':
        values[field.id] = new Date(submittedAt.getTime() - random.int(1, 900) * 86_400_000)
          .toISOString()
          .slice(0, 10);
        break;
      case 'number':
        values[field.id] = String(random.int(1, 250));
        break;
      case 'textarea':
        values[field.id] = random.pick([
          'Block 4, Street 12, Building 8, Salmiya.',
          'Block 9, Street 3, Building 21, Jahra.',
          'Block 1, Street 106, Building 4, Kuwait City.',
        ]);
        break;
      default:
        values[field.id] = random.pick([
          'Al Manar Trading Company',
          'Gulf Horizon Establishment',
          'Bayan Contracting',
          'Sabah Al Salem Bakery',
        ]);
    }
  }
  return values;
}

function randomInstant(random: SeededRandom, now: Date, windowDays: number): Date {
  const offsetMs = random.int(1, windowDays * 24) * 3600_000;
  return new Date(now.getTime() - offsetMs);
}

function pickOfficer(random: SeededRandom, departmentId: string): User {
  const inDepartment = ALL_USERS.filter(
    (user) => user.role === 'officer' && user.departmentId === departmentId,
  );
  if (inDepartment.length > 0) {
    return random.pick(inDepartment);
  }
  return requireUser(USER_IDS.officer);
}

function requireUser(id: string): User {
  const user = findUser(id);
  if (!user) {
    throw new Error(`Sample data references an unknown account: ${id}`);
  }
  return user;
}
