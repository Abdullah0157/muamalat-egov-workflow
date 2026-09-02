import { User } from '../models/domain';

/** Department identifiers, shared by the accounts below and the sample data. */
export const DEPARTMENT_IDS = {
  civilAffairs: 'dep-civil-affairs',
  commerce: 'dep-commerce',
  municipality: 'dep-municipality',
  manpower: 'dep-manpower',
  health: 'dep-health',
} as const;

export const USER_IDS = {
  citizen: 'usr-citizen-1',
  citizenSecond: 'usr-citizen-2',
  officer: 'usr-officer-1',
  officerSecond: 'usr-officer-2',
  officerThird: 'usr-officer-3',
  supervisor: 'usr-supervisor-1',
  admin: 'usr-admin-1',
} as const;

/**
 * Fixed accounts used in place of an identity provider. The four offered on the
 * sign in screen are the first of each role; the extra officers and the second
 * citizen exist so the sample data has more than one name in it.
 */
export const ALL_USERS: readonly User[] = [
  {
    id: USER_IDS.citizen,
    name: { en: 'Fahad Al Sabah', ar: 'فهد الصباح' },
    civilId: '289061500321',
    email: 'fahad.alsabah@example.kw',
    role: 'citizen',
    departmentId: null,
    jobTitle: null,
  },
  {
    id: USER_IDS.citizenSecond,
    name: { en: 'Noura Al Ajmi', ar: 'نورة العجمي' },
    civilId: '294110800917',
    email: 'noura.alajmi@example.kw',
    role: 'citizen',
    departmentId: null,
    jobTitle: null,
  },
  {
    id: USER_IDS.officer,
    name: { en: 'Mariam Al Rashid', ar: 'مريم الرشيد' },
    civilId: '278032100455',
    email: 'm.alrashid@muamalat.gov.kw',
    role: 'officer',
    departmentId: DEPARTMENT_IDS.civilAffairs,
    jobTitle: { en: 'Transactions Officer', ar: 'موظفة معاملات' },
  },
  {
    id: USER_IDS.officerSecond,
    name: { en: 'Yousef Al Enezi', ar: 'يوسف العنزي' },
    civilId: '283071900612',
    email: 'y.alenezi@muamalat.gov.kw',
    role: 'officer',
    departmentId: DEPARTMENT_IDS.commerce,
    jobTitle: { en: 'Licensing Officer', ar: 'موظف تراخيص' },
  },
  {
    id: USER_IDS.officerThird,
    name: { en: 'Dalal Al Mutairi', ar: 'دلال المطيري' },
    civilId: '291042700188',
    email: 'd.almutairi@muamalat.gov.kw',
    role: 'officer',
    departmentId: DEPARTMENT_IDS.municipality,
    jobTitle: { en: 'Inspection Officer', ar: 'موظفة تفتيش' },
  },
  {
    id: USER_IDS.supervisor,
    name: { en: 'Abdullah Al Kandari', ar: 'عبدالله الكندري' },
    civilId: '271091100734',
    email: 'a.alkandari@muamalat.gov.kw',
    role: 'supervisor',
    departmentId: DEPARTMENT_IDS.civilAffairs,
    jobTitle: { en: 'Head of Operations', ar: 'رئيس العمليات' },
  },
  {
    id: USER_IDS.admin,
    name: { en: 'Hessa Al Failakawi', ar: 'حصة الفيلكاوي' },
    civilId: '286120300529',
    email: 'h.alfailakawi@muamalat.gov.kw',
    role: 'admin',
    departmentId: null,
    jobTitle: { en: 'Workflow Administrator', ar: 'مديرة مسارات العمل' },
  },
];

/** The accounts offered on the sign in screen, one per role. */
export const DEMO_USERS: readonly User[] = [
  ALL_USERS[0],
  ALL_USERS[2],
  ALL_USERS[5],
  ALL_USERS[6],
];

export function findUser(id: string): User | undefined {
  return ALL_USERS.find((user) => user.id === id);
}
