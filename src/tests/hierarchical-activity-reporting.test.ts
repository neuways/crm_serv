/**
 * Neuways CRM - Hierarchical Activity Logging, Accountability & Daily Work Reporting Tests
 *
 * Non-destructive in-memory tests verifying:
 * 1. 1-click quick call attempt logging (NO_ANSWER, SWITCHED_OFF, CALL_BACK_REQUESTED, etc.)
 * 2. Strict Step 1 -> Step 2 advancement gating on quick logs
 * 3. Hierarchical reporting & notifications (Sales -> Manager + Admin, Manager -> Admin)
 * 4. Per-employee work & call accountability aggregation with RBAC (Admin, Manager, Sales)
 * 5. Cross-lead filtered live activity feed (employeeId, outcome, period, RBAC)
 * 6. Explicit Daily Work Report submission (WORK_REPORT_SUBMITTED)
 */

import { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { User } from '../models/user.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { Notification } from '../models/notification.model.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { AuthUser } from '../types/auth.types.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

function makeChainQuery(items: any[]) {
  const q: any = {
    _items: [...items],
    select() { return this; },
    sort(sortObj: any) {
      if (sortObj?.createdAt === -1) {
        this._items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return this;
    },
    skip(n: number) { this._items = this._items.slice(n); return this; },
    limit(n: number) { this._items = this._items.slice(0, n); return this; },
    populate() { return this; },
    lean() { return this; },
    then(resolve: any, reject?: any) {
      return Promise.resolve(this._items).then(resolve, reject);
    }
  };
  return q;
}

function matchesFilter(doc: any, filter: Record<string, any>): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (key === '$and' && Array.isArray(cond)) {
      if (!cond.every((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }

    const parts = key.split('.');
    let val = doc;
    for (const p of parts) {
      val = val != null ? val[p] : undefined;
    }

    if (cond && typeof cond === 'object' && !(cond instanceof Types.ObjectId) && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$in' in cond) {
        const arr = (cond.$in as any[]).map((x) => x?.toString());
        if (!val || !arr.includes(val.toString())) return false;
      }
      if ('$ne' in cond) {
        if (val === cond.$ne) return false;
      }
      if ('$gte' in cond) {
        if (!val || new Date(val) < new Date(cond.$gte)) return false;
      }
      if ('$lte' in cond) {
        if (!val || new Date(val) > new Date(cond.$lte)) return false;
      }
      continue;
    }

    const expected = cond instanceof Types.ObjectId ? cond.toString() : cond;
    const actual = val instanceof Types.ObjectId ? val.toString() : val;
    if (actual !== expected) return false;
  }
  return true;
}

async function runHierarchicalReportingTests() {
  console.log('====================================================');
  console.log('Starting Hierarchical Activity & Accountability Suite');
  console.log('====================================================\n');

  const adminId = new Types.ObjectId();
  const managerAId = new Types.ObjectId();
  const managerBId = new Types.ObjectId();
  const salesA1Id = new Types.ObjectId();
  const salesA2Id = new Types.ObjectId();
  const salesB1Id = new Types.ObjectId();

  const usersStore: any[] = [
    { _id: adminId, id: adminId.toString(), name: 'Admin Root', email: 'admin@test.com', role: 'ADMIN', isActive: true },
    { _id: managerAId, id: managerAId.toString(), name: 'Manager Alpha', email: 'mgr.a@test.com', role: 'MANAGER', isActive: true },
    { _id: managerBId, id: managerBId.toString(), name: 'Manager Beta', email: 'mgr.b@test.com', role: 'MANAGER', isActive: true },
    { _id: salesA1Id, id: salesA1Id.toString(), name: 'Sales Priya', email: 'priya@test.com', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerAId },
    { _id: salesA2Id, id: salesA2Id.toString(), name: 'Sales Karan', email: 'karan@test.com', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerAId },
    { _id: salesB1Id, id: salesB1Id.toString(), name: 'Sales Zoya', email: 'zoya@test.com', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerBId }
  ];

  const adminActor: AuthUser = { id: adminId.toString(), email: 'admin@test.com', role: 'ADMIN', name: 'Admin Root' };
  const mgrAActor: AuthUser = { id: managerAId.toString(), email: 'mgr.a@test.com', role: 'MANAGER', name: 'Manager Alpha' };
  const salesA1Actor: AuthUser = { id: salesA1Id.toString(), email: 'priya@test.com', role: 'SALES', name: 'Sales Priya' };
  const salesB1Actor: AuthUser = { id: salesB1Id.toString(), email: 'zoya@test.com', role: 'SALES', name: 'Sales Zoya' };

  const leadA1Id = new Types.ObjectId();
  const leadM1Id = new Types.ObjectId();
  const leadsStore: any[] = [
    {
      _id: leadA1Id,
      id: leadA1Id.toString(),
      name: 'Client Rahul',
      mobile: '+919800011122',
      normalizedMobile: '+919800011122',
      projectName: 'Skyline Heights',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: salesA1Id,
      managerId: managerAId,
      save: async function () { return this; },
      toObject: function () { return { ...this }; }
    },
    {
      _id: leadM1Id,
      id: leadM1Id.toString(),
      name: 'Client Meera',
      mobile: '+919800033344',
      normalizedMobile: '+919800033344',
      projectName: 'Emerald Vista',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: managerAId,
      managerId: null,
      save: async function () { return this; },
      toObject: function () { return { ...this }; }
    }
  ];

  const activityStore: any[] = [];
  const taskStore: any[] = [
    {
      _id: new Types.ObjectId(),
      enquiryId: leadA1Id,
      assignedTo: salesA2Id,
      status: 'PENDING',
      followUpDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // Overdue 2 days
    }
  ];
  const notificationStore: any[] = [];

  (User as any)._isMocked = true;
  (User as any).find = (filter: any = {}) => makeChainQuery(usersStore.filter((u) => matchesFilter(u, filter)));
  (User as any).findById = (id: any) => {
    const targetId = id?.toString();
    const doc = usersStore.find((u) => u._id.toString() === targetId) || null;
    const q: any = {
      select() { return this; },
      then(resolve: any, reject?: any) { return Promise.resolve(doc).then(resolve, reject); }
    };
    return q;
  };

  (Enquiry as any).find = (filter: any = {}) => makeChainQuery(leadsStore.filter((l) => matchesFilter(l, filter)));
  (Enquiry as any).findById = (id: any) => {
    const targetId = id?.toString();
    const doc = leadsStore.find((l) => l._id.toString() === targetId) || null;
    const q: any = {
      populate() { return this; },
      then(resolve: any, reject?: any) { return Promise.resolve(doc).then(resolve, reject); }
    };
    return q;
  };

  EnquiryActivity.prototype.save = function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    if (!this.createdAt) this.createdAt = new Date();
    const plain = this.toObject ? this.toObject() : { ...this };
    if (!plain._id) plain._id = this._id;
    if (!plain.createdAt) plain.createdAt = this.createdAt;
    activityStore.push(plain);
    return Promise.resolve(this);
  };
  (EnquiryActivity as any).find = (filter: any = {}) => makeChainQuery(activityStore.filter((a) => matchesFilter(a, filter)));
  (EnquiryActivity as any).countDocuments = async (filter: any = {}) => activityStore.filter((a) => matchesFilter(a, filter)).length;

  FollowUpTask.prototype.save = function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    const plain = this.toObject ? this.toObject() : { ...this };
    taskStore.push(plain);
    return Promise.resolve(this);
  };
  (FollowUpTask as any).find = (filter: any = {}) => makeChainQuery(taskStore.filter((t) => matchesFilter(t, filter)));

  (Notification as any)._isMocked = true;
  (Notification as any).findOne = async () => null;
  Notification.prototype.save = function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    const plain = this.toObject ? this.toObject() : { ...this };
    notificationStore.push(plain);
    return Promise.resolve(this);
  };

  const service = new EnquiryService();

  // 1. Test 1-Click Quick Call Attempts (NO_ANSWER & SWITCHED_OFF)
  const noAnswerRes = await service.logQuickActivity(
    leadA1Id.toString(),
    { purpose: 'CALL', outcome: 'NO_ANSWER' },
    salesA1Actor
  );
  assert(noAnswerRes.success === true, '1-click NO_ANSWER quick call log succeeds without notes');
  assert(leadsStore[0].currentStage === 'FOLLOW_UP', 'NO_ANSWER keeps lead on FOLLOW_UP');
  assert(leadsStore[0].lastFollowUpOutcome === 'NO_ANSWER', 'Persists NO_ANSWER on lead');
  assert(activityStore[0].type === 'CALL_ATTEMPT', 'Logs CALL_ATTEMPT activity');
  assert(activityStore[0].actorRole === 'SALES', 'Captures actorRole SALES on activity');
  assert(activityStore[0].managerId?.toString() === managerAId.toString(), 'Captures supervisor managerId on activity');

  const switchedOffRes = await service.logQuickActivity(
    leadA1Id.toString(),
    { purpose: 'CALL', outcome: 'SWITCHED_OFF', callDurationSeconds: 18 },
    salesA1Actor
  );
  assert(switchedOffRes.success === true, '1-click SWITCHED_OFF quick call log succeeds');
  assert(leadsStore[0].lastFollowUpOutcome === 'SWITCHED_OFF', 'Persists SWITCHED_OFF on lead');

  // 2. Test strict advancement gate on logQuickActivity
  const invalidAdvance = await service.logQuickActivity(
    leadA1Id.toString(),
    { purpose: 'CALL', outcome: 'SWITCHED_OFF', advanceStage: true },
    salesA1Actor
  );
  assert(invalidAdvance.success === false && invalidAdvance.statusCode === 400, 'Rejects stage advancement when quick outcome is SWITCHED_OFF');

  // 3. Test CALL_BACK_REQUESTED validation & hierarchical scheduling notification
  const missingCallbackRes = await service.logQuickActivity(
    leadA1Id.toString(),
    { purpose: 'CALL', outcome: 'CALL_BACK_REQUESTED' },
    salesA1Actor
  );
  assert(missingCallbackRes.success === false && missingCallbackRes.statusCode === 400, 'Requires callback date/time for CALL_BACK_REQUESTED');

  const validCallbackRes = await service.logQuickActivity(
    leadA1Id.toString(),
    {
      purpose: 'CALL',
      outcome: 'CALL_BACK_REQUESTED',
      nextFollowUpDate: '2026-11-28',
      nextFollowUpTime: '16:00',
      notes: 'Customer busy, asked to call Saturday'
    },
    salesA1Actor
  );
  assert(validCallbackRes.success === true, 'Valid CALL_BACK_REQUESTED saves with callback task');

  // 4. Test Hierarchical Notification Routing:
  // Rule 1: Sales milestone (SITE_VISIT_COMPLETED) -> Manager + Admin
  const notifsBeforeSalesMilestone = notificationStore.length;
  const milestoneRes = await service.logQuickActivity(
    leadA1Id.toString(),
    { purpose: 'SITE_VISIT', outcome: 'SITE_VISIT_COMPLETED', notes: 'Completed sample flat walkthrough' },
    salesA1Actor
  );
  assert(milestoneRes.success === true, 'Sales Agent milestone log succeeds');
  const salesMilestoneNotifs = notificationStore.slice(notifsBeforeSalesMilestone);
  assert(
    salesMilestoneNotifs.some((n) => n.recipient.toString() === managerAId.toString()),
    'Rule 1: Assigned Manager notified on Sales milestone'
  );
  assert(
    salesMilestoneNotifs.some((n) => n.recipient.toString() === adminId.toString()),
    'Rule 1: Admin notified on Sales milestone'
  );

  // Rule 2: Manager action (MEETING_SCHEDULED milestone) -> Admin
  const notifsBeforeMgrAction = notificationStore.length;
  const mgrQuickRes = await service.logQuickActivity(
    leadM1Id.toString(),
    { purpose: 'CALL', outcome: 'MEETING_SCHEDULED', notes: 'Confirmed direct meeting for tomorrow' },
    mgrAActor
  );
  assert(mgrQuickRes.success === true, 'Manager quick log succeeds');
  const mgrNotifs = notificationStore.slice(notifsBeforeMgrAction);
  assert(
    mgrNotifs.some((n) => n.recipient.toString() === adminId.toString()),
    'Rule 2: Admin notified when Manager logs milestone'
  );
  assert(
    !mgrNotifs.some((n) => n.recipient.toString() === managerAId.toString()),
    'Rule 2: Manager does not receive duplicate self notification'
  );

  // 5. Test Work & Call Accountability Aggregation + RBAC Scoping
  // Admin sees Manager Alpha, Manager Beta, Sales Priya, Sales Karan, Sales Zoya
  const adminReport = await service.getTeamActivityReport({ period: 'today' }, adminActor);
  assert(adminReport.success === true, 'Admin retrieves organization-wide team activity report');
  const priyaRow = adminReport.employees?.find((e) => e.employeeId === salesA1Id.toString());
  const karanRow = adminReport.employees?.find((e) => e.employeeId === salesA2Id.toString());
  assert(priyaRow?.totalCallsLogged === 3, 'Priya totalCallsLogged accurately counts 3 phone call attempts');
  assert(priyaRow?.totalActivitiesCount === 4, 'Priya totalActivitiesCount accurately counts 4 total activities (3 calls + 1 visit)');
  assert(priyaRow?.noAnswerBusyCount === 1, 'Counts 1 NO_ANSWER');
  assert(priyaRow?.switchedOffCount === 1, 'Counts 1 SWITCHED_OFF');
  assert(priyaRow?.callbackRequestedCount === 1, 'Counts 1 CALL_BACK_REQUESTED');
  assert(priyaRow?.siteVisitsCompletedCount === 1, 'Counts 1 SITE_VISIT_COMPLETED');
  assert(priyaRow?.activityStatus === 'ACTIVE_TODAY', 'Priya status classified ACTIVE_TODAY');
  assert(karanRow?.activityStatus === 'INACTIVE', 'Idle agent Karan classified INACTIVE');
  assert(karanRow?.pendingOverdueCount === 1, 'Counts 1 overdue follow-up for Karan');

  // Manager Alpha sees ONLY Team Alpha (self + Priya + Karan), NOT Zoya
  const mgrReport = await service.getTeamActivityReport({ period: 'today' }, mgrAActor);
  assert(mgrReport.success === true, 'Manager retrieves team report');
  assert(
    Boolean(mgrReport.employees?.every((e) => [managerAId.toString(), salesA1Id.toString(), salesA2Id.toString()].includes(e.employeeId))),
    'Manager report excludes out-of-team employees (Zoya)'
  );
  const crossTeamReport = await service.getTeamActivityReport({ period: 'today', employeeId: salesB1Id.toString() }, mgrAActor);
  assert(crossTeamReport.success === false && crossTeamReport.statusCode === 403, 'Rejects Manager querying out-of-team employee report');

  // Sales Priya sees ONLY self
  const salesReport = await service.getTeamActivityReport({ period: 'today' }, salesA1Actor);
  assert(salesReport.success === true && salesReport.employees?.length === 1, 'Sales sees only personal daily scorecard');
  const crossSalesReport = await service.getTeamActivityReport({ period: 'today', employeeId: salesA2Id.toString() }, salesA1Actor);
  assert(crossSalesReport.success === false && crossSalesReport.statusCode === 403, 'Rejects Sales viewing peer scorecard');

  // 6. Test Activity Feed Filtering
  const switchedOffFeed = await service.getActivityFeed({ outcome: 'SWITCHED_OFF' }, adminActor);
  assert(switchedOffFeed.success === true && switchedOffFeed.activities?.length === 1, 'Activity feed filters accurately by outcome=SWITCHED_OFF');
  const salesCrossFeed = await service.getActivityFeed({ employeeId: salesA2Id.toString() }, salesB1Actor);
  assert(salesCrossFeed.success === false && salesCrossFeed.statusCode === 403, 'Activity feed enforces Sales RBAC');

  // 7. Test Explicit Daily Work Report Submission (Sales -> Manager + Admin)
  const notifsBeforeReport = notificationStore.length;
  const workReportRes = await service.submitWorkReport(
    { summaryNotes: 'Completed all high-priority callbacks today', period: 'today' },
    salesA1Actor
  );
  assert(workReportRes.success === true, 'Daily work report submission succeeds');
  const reportNotifs = notificationStore.slice(notifsBeforeReport);
  assert(reportNotifs.some((n) => n.recipient.toString() === managerAId.toString()), 'Work report notifies assigned Manager');
  assert(reportNotifs.some((n) => n.recipient.toString() === adminId.toString()), 'Work report notifies Admin');
  assert(
    activityStore.some((a) => a.type === 'WORK_REPORT_SUBMITTED' && a.performedBy?.toString() === salesA1Id.toString()),
    'Records immutable WORK_REPORT_SUBMITTED activity'
  );

  console.log('\n====================================================');
  console.log(`Hierarchical Activity Tests: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runHierarchicalReportingTests().catch((err) => {
  console.error('Unhandled error in hierarchical-activity-reporting.test.ts:', err);
  process.exit(1);
});
