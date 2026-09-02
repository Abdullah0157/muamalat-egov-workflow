import { DEPARTMENT_IDS } from '../auth/demo-users';
import { Department, ServiceDefinition } from '../models/domain';
import { WORKFLOW_KEYS } from './workflow-definitions';

export const DEPARTMENTS: readonly Department[] = [
  {
    id: DEPARTMENT_IDS.civilAffairs,
    code: 'CA',
    name: { en: 'Civil Affairs', ar: 'الأحوال المدنية' },
  },
  {
    id: DEPARTMENT_IDS.commerce,
    code: 'CO',
    name: { en: 'Commerce and Industry', ar: 'التجارة والصناعة' },
  },
  {
    id: DEPARTMENT_IDS.municipality,
    code: 'MU',
    name: { en: 'Municipality', ar: 'البلدية' },
  },
  {
    id: DEPARTMENT_IDS.manpower,
    code: 'MP',
    name: { en: 'Manpower Authority', ar: 'الهيئة العامة للقوى العاملة' },
  },
  {
    id: DEPARTMENT_IDS.health,
    code: 'HE',
    name: { en: 'Public Health', ar: 'الصحة العامة' },
  },
];

export function findDepartment(id: string): Department | undefined {
  return DEPARTMENTS.find((department) => department.id === id);
}

/**
 * The service catalogue.
 *
 * Each entry carries the questions the citizen wizard asks, the documents that
 * must be attached, the statutory processing time that every SLA figure is
 * derived from, and the workflow the request will run on. Adding a service is
 * therefore a data change, not a code change.
 */
export const SERVICES: readonly ServiceDefinition[] = [
  {
    id: 'svc-civil-id-replacement',
    code: 'CA-101',
    name: { en: 'Replace a civil ID card', ar: 'بدل فاقد للبطاقة المدنية' },
    description: {
      en: 'Request a replacement card when the original is lost, stolen or damaged.',
      ar: 'طلب بطاقة بديلة عند فقدان الأصل أو سرقته أو تلفه.',
    },
    departmentId: DEPARTMENT_IDS.civilAffairs,
    workflowKey: WORKFLOW_KEYS.civil,
    slaHours: 48,
    feeKwd: 5,
    fields: [
      {
        id: 'reason',
        type: 'select',
        label: { en: 'Reason for replacement', ar: 'سبب طلب البدل' },
        hint: null,
        required: true,
        maxLength: null,
        options: [
          { value: 'lost', label: { en: 'Lost', ar: 'فقدان' } },
          { value: 'stolen', label: { en: 'Stolen', ar: 'سرقة' } },
          { value: 'damaged', label: { en: 'Damaged', ar: 'تلف' } },
          { value: 'expired', label: { en: 'Expired', ar: 'انتهاء الصلاحية' } },
        ],
      },
      {
        id: 'incidentDate',
        type: 'date',
        label: { en: 'Date of loss or damage', ar: 'تاريخ الفقدان أو التلف' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
      {
        id: 'address',
        type: 'textarea',
        label: { en: 'Current address', ar: 'العنوان الحالي' },
        hint: {
          en: 'Area, block, street and building as printed on your tenancy or title document.',
          ar: 'المنطقة والقطعة والشارع والقسيمة كما وردت في عقد الإيجار أو سند الملكية.',
        },
        required: true,
        maxLength: 300,
        options: [],
      },
    ],
    documents: [
      {
        id: 'police-report',
        name: { en: 'Police report', ar: 'تقرير الشرطة' },
        required: true,
        formats: ['pdf', 'jpg', 'png'],
        maxSizeMb: 5,
      },
      {
        id: 'passport-copy',
        name: { en: 'Passport copy', ar: 'صورة جواز السفر' },
        required: true,
        formats: ['pdf', 'jpg'],
        maxSizeMb: 5,
      },
      {
        id: 'photo',
        name: { en: 'Recent photograph', ar: 'صورة شخصية حديثة' },
        required: false,
        formats: ['jpg', 'png'],
        maxSizeMb: 2,
      },
    ],
  },
  {
    id: 'svc-birth-certificate',
    code: 'CA-204',
    name: { en: 'Certified birth certificate', ar: 'شهادة ميلاد مصدّقة' },
    description: {
      en: 'Obtain a certified copy of a birth record held by Civil Affairs.',
      ar: 'الحصول على نسخة مصدّقة من قيد الميلاد لدى الأحوال المدنية.',
    },
    departmentId: DEPARTMENT_IDS.civilAffairs,
    workflowKey: WORKFLOW_KEYS.civil,
    slaHours: 24,
    feeKwd: 2,
    fields: [
      {
        id: 'subjectName',
        type: 'text',
        label: { en: 'Name on the record', ar: 'الاسم في القيد' },
        hint: null,
        required: true,
        maxLength: 120,
        options: [],
      },
      {
        id: 'dateOfBirth',
        type: 'date',
        label: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
      {
        id: 'copies',
        type: 'number',
        label: { en: 'Number of copies', ar: 'عدد النسخ' },
        hint: { en: 'Up to five per request.', ar: 'حتى خمس نسخ لكل طلب.' },
        required: true,
        maxLength: null,
        options: [],
      },
    ],
    documents: [
      {
        id: 'civil-id-copy',
        name: { en: 'Civil ID copy', ar: 'صورة البطاقة المدنية' },
        required: true,
        formats: ['pdf', 'jpg'],
        maxSizeMb: 5,
      },
    ],
  },
  {
    id: 'svc-commercial-licence',
    code: 'CO-310',
    name: { en: 'New commercial licence', ar: 'ترخيص تجاري جديد' },
    description: {
      en: 'Apply for a licence to trade from a commercial premises.',
      ar: 'التقدم بطلب ترخيص لمزاولة النشاط التجاري في محل تجاري.',
    },
    departmentId: DEPARTMENT_IDS.commerce,
    workflowKey: WORKFLOW_KEYS.licensing,
    slaHours: 240,
    feeKwd: 150,
    fields: [
      {
        id: 'tradeName',
        type: 'text',
        label: { en: 'Trade name', ar: 'الاسم التجاري' },
        hint: null,
        required: true,
        maxLength: 120,
        options: [],
      },
      {
        id: 'activity',
        type: 'select',
        label: { en: 'Commercial activity', ar: 'النشاط التجاري' },
        hint: null,
        required: true,
        maxLength: null,
        options: [
          { value: 'retail', label: { en: 'Retail', ar: 'تجزئة' } },
          { value: 'restaurant', label: { en: 'Restaurant or cafe', ar: 'مطعم أو مقهى' } },
          { value: 'services', label: { en: 'Professional services', ar: 'خدمات مهنية' } },
          { value: 'workshop', label: { en: 'Workshop', ar: 'ورشة' } },
        ],
      },
      {
        id: 'premisesArea',
        type: 'number',
        label: { en: 'Premises area in square metres', ar: 'مساحة المحل بالمتر المربع' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
      {
        id: 'notes',
        type: 'textarea',
        label: { en: 'Additional notes', ar: 'ملاحظات إضافية' },
        hint: null,
        required: false,
        maxLength: 500,
        options: [],
      },
    ],
    documents: [
      {
        id: 'tenancy-contract',
        name: { en: 'Tenancy contract', ar: 'عقد الإيجار' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 10,
      },
      {
        id: 'floor-plan',
        name: { en: 'Floor plan', ar: 'المخطط الهندسي' },
        required: true,
        formats: ['pdf', 'dwg'],
        maxSizeMb: 20,
      },
      {
        id: 'partner-ids',
        name: { en: 'Civil ID of every partner', ar: 'البطاقة المدنية لكل شريك' },
        required: true,
        formats: ['pdf', 'jpg'],
        maxSizeMb: 10,
      },
    ],
  },
  {
    id: 'svc-licence-renewal',
    code: 'CO-315',
    name: { en: 'Renew a commercial licence', ar: 'تجديد ترخيص تجاري' },
    description: {
      en: 'Renew an existing licence before it expires.',
      ar: 'تجديد ترخيص قائم قبل انتهاء صلاحيته.',
    },
    departmentId: DEPARTMENT_IDS.commerce,
    workflowKey: WORKFLOW_KEYS.standard,
    slaHours: 72,
    feeKwd: 75,
    fields: [
      {
        id: 'licenceNumber',
        type: 'text',
        label: { en: 'Licence number', ar: 'رقم الترخيص' },
        hint: null,
        required: true,
        maxLength: 30,
        options: [],
      },
      {
        id: 'expiryDate',
        type: 'date',
        label: { en: 'Current expiry date', ar: 'تاريخ الانتهاء الحالي' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
    ],
    documents: [
      {
        id: 'current-licence',
        name: { en: 'Current licence', ar: 'الترخيص الحالي' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 5,
      },
      {
        id: 'tenancy-contract',
        name: { en: 'Tenancy contract', ar: 'عقد الإيجار' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 10,
      },
    ],
  },
  {
    id: 'svc-building-permit',
    code: 'MU-402',
    name: { en: 'Building permit', ar: 'رخصة بناء' },
    description: {
      en: 'Permission to build, extend or alter a structure.',
      ar: 'إذن بالبناء أو التوسعة أو التعديل على منشأة قائمة.',
    },
    departmentId: DEPARTMENT_IDS.municipality,
    workflowKey: WORKFLOW_KEYS.licensing,
    slaHours: 336,
    feeKwd: 250,
    fields: [
      {
        id: 'plotNumber',
        type: 'text',
        label: { en: 'Plot number', ar: 'رقم القسيمة' },
        hint: null,
        required: true,
        maxLength: 30,
        options: [],
      },
      {
        id: 'workType',
        type: 'select',
        label: { en: 'Type of work', ar: 'نوع العمل' },
        hint: null,
        required: true,
        maxLength: null,
        options: [
          { value: 'new', label: { en: 'New build', ar: 'بناء جديد' } },
          { value: 'extension', label: { en: 'Extension', ar: 'توسعة' } },
          { value: 'alteration', label: { en: 'Alteration', ar: 'تعديل' } },
          { value: 'demolition', label: { en: 'Demolition', ar: 'هدم' } },
        ],
      },
      {
        id: 'contractor',
        type: 'text',
        label: { en: 'Licensed contractor', ar: 'المقاول المرخّص' },
        hint: null,
        required: true,
        maxLength: 120,
        options: [],
      },
    ],
    documents: [
      {
        id: 'title-deed',
        name: { en: 'Title deed', ar: 'سند الملكية' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 10,
      },
      {
        id: 'engineering-drawings',
        name: { en: 'Engineering drawings', ar: 'المخططات الهندسية' },
        required: true,
        formats: ['pdf', 'dwg'],
        maxSizeMb: 40,
      },
      {
        id: 'soil-report',
        name: { en: 'Soil report', ar: 'تقرير فحص التربة' },
        required: false,
        formats: ['pdf'],
        maxSizeMb: 20,
      },
    ],
  },
  {
    id: 'svc-street-occupation',
    code: 'MU-418',
    name: { en: 'Temporary street occupation', ar: 'إشغال طريق مؤقت' },
    description: {
      en: 'Permission to occupy part of a public street during construction or an event.',
      ar: 'إذن بإشغال جزء من الطريق العام أثناء الإنشاء أو الفعاليات.',
    },
    departmentId: DEPARTMENT_IDS.municipality,
    workflowKey: WORKFLOW_KEYS.standard,
    slaHours: 96,
    feeKwd: 40,
    fields: [
      {
        id: 'location',
        type: 'text',
        label: { en: 'Location', ar: 'الموقع' },
        hint: null,
        required: true,
        maxLength: 160,
        options: [],
      },
      {
        id: 'startDate',
        type: 'date',
        label: { en: 'Start date', ar: 'تاريخ البدء' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
      {
        id: 'durationDays',
        type: 'number',
        label: { en: 'Duration in days', ar: 'المدة بالأيام' },
        hint: null,
        required: true,
        maxLength: null,
        options: [],
      },
    ],
    documents: [
      {
        id: 'site-plan',
        name: { en: 'Site plan', ar: 'مخطط الموقع' },
        required: true,
        formats: ['pdf', 'jpg'],
        maxSizeMb: 10,
      },
    ],
  },
  {
    id: 'svc-work-permit',
    code: 'MP-505',
    name: { en: 'Work permit transfer', ar: 'نقل إذن عمل' },
    description: {
      en: 'Transfer an existing work permit to a new employer.',
      ar: 'نقل إذن عمل قائم إلى صاحب عمل جديد.',
    },
    departmentId: DEPARTMENT_IDS.manpower,
    workflowKey: WORKFLOW_KEYS.standard,
    slaHours: 120,
    feeKwd: 10,
    fields: [
      {
        id: 'permitNumber',
        type: 'text',
        label: { en: 'Permit number', ar: 'رقم الإذن' },
        hint: null,
        required: true,
        maxLength: 30,
        options: [],
      },
      {
        id: 'newEmployer',
        type: 'text',
        label: { en: 'New employer', ar: 'صاحب العمل الجديد' },
        hint: null,
        required: true,
        maxLength: 120,
        options: [],
      },
      {
        id: 'occupation',
        type: 'text',
        label: { en: 'Occupation', ar: 'المهنة' },
        hint: null,
        required: true,
        maxLength: 80,
        options: [],
      },
    ],
    documents: [
      {
        id: 'release-letter',
        name: { en: 'Release letter', ar: 'كتاب إخلاء طرف' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 5,
      },
      {
        id: 'employment-contract',
        name: { en: 'New employment contract', ar: 'عقد العمل الجديد' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 10,
      },
    ],
  },
  {
    id: 'svc-health-certificate',
    code: 'HE-602',
    name: { en: 'Food handler health certificate', ar: 'شهادة صحية لمتداولي الأغذية' },
    description: {
      en: 'Health clearance required for anyone handling food commercially.',
      ar: 'شهادة لياقة صحية مطلوبة لكل من يتداول الأغذية تجارياً.',
    },
    departmentId: DEPARTMENT_IDS.health,
    workflowKey: WORKFLOW_KEYS.standard,
    slaHours: 72,
    feeKwd: 8,
    fields: [
      {
        id: 'employer',
        type: 'text',
        label: { en: 'Employer', ar: 'جهة العمل' },
        hint: null,
        required: true,
        maxLength: 120,
        options: [],
      },
      {
        id: 'role',
        type: 'select',
        label: { en: 'Role', ar: 'الوظيفة' },
        hint: null,
        required: true,
        maxLength: null,
        options: [
          { value: 'cook', label: { en: 'Cook', ar: 'طاهٍ' } },
          { value: 'server', label: { en: 'Server', ar: 'عامل تقديم' } },
          { value: 'butcher', label: { en: 'Butcher', ar: 'جزار' } },
          { value: 'baker', label: { en: 'Baker', ar: 'خباز' } },
        ],
      },
    ],
    documents: [
      {
        id: 'medical-report',
        name: { en: 'Medical examination report', ar: 'تقرير الفحص الطبي' },
        required: true,
        formats: ['pdf'],
        maxSizeMb: 10,
      },
      {
        id: 'civil-id-copy',
        name: { en: 'Civil ID copy', ar: 'صورة البطاقة المدنية' },
        required: true,
        formats: ['pdf', 'jpg'],
        maxSizeMb: 5,
      },
    ],
  },
];

export function findService(id: string): ServiceDefinition | undefined {
  return SERVICES.find((service) => service.id === id);
}
