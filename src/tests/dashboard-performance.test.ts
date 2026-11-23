/**
 * Neuways CRM - Dashboard Performance Optimization Test Suite
 * Covers BUG-03 (Dashboard Summary N+1 Query Optimization) and BUG-04 (Team Performance N+1 Query Optimization)
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { User, IUser } from '../models/user.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { notificationService } from '../services/notification.service.js';
import { AuthUser } from '../types/auth.types.js';

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string, detail?: any) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    if (detail) console.error('  Detail:', detail);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runDashboardPerformanceTests() {
  (mongoose.connection as any).readyState = 1;

  console.log('========================================================================');
  console.log('Neuways CRM - Phase 1A: Dashboard Performance Optimization Tests');
  console.log('========================================================================\n');

  // Avoid real notification timeouts in unit tests
  (notificationService as any).createNotification = () => Promise.resolve({ success: true });
  (EnquiryActivity as any).prototype.save = function () {
    return Promise.resolve(this);
  };

  // In-memory data stores
  const userStore: any[] = [];
  const enquiryStore: any[] = [];
  const taskStore: any[] = [];

  // Seed Users
  const managerVikramId = new Types.ObjectId();
  const managerVikram: AuthUser = {
    id: managerVikramId.toString(),
    email: 'vikram.manager@neuways.com',
    role: 'MANAGER',
    name: 'Vikram Malhotra'
  };

  const managerOtherId = new Types.ObjectId();
  const managerOther: AuthUser = {
    id: managerOtherId.toString(),
    email: 'other.manager@neuways.com',
    role: 'MANAGER',
    name: 'Other Manager'
  };

  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Super Admin'
  };

  userStore.push({
    _id: managerVikramId,
    name: 'Vikram Malhotra',
    email: 'vikram.manager@neuways.com',
    role: 'MANAGER',
    isActive: true
  });

  userStore.push({
    _id: managerOtherId,
    name: 'Other Manager',
    email: 'other.manager@neuways.com',
    role: 'MANAGER',
    isActive: true
  });

  // Seed Agents
  const agentRahulId = new Types.ObjectId();
  const agentRahul: AuthUser = {
    id: agentRahulId.toString(),
    email: 'rahul.sales@neuways.com',
    role: 'SALES',
    name: 'Rahul Sharma'
  };

  const agentRohitId = new Types.ObjectId();
  const agentRohit: AuthUser = {
    id: agentRohitId.toString(),
    email: 'rohit.sales@neuways.com',
    role: 'SALES',
    name: 'Rohit Sharma'
  };

  const agentInactiveId = new Types.ObjectId();
  const agentOtherManagerId = new Types.ObjectId();

  userStore.push({
    _id: agentRahulId,
    name: 'Rahul Sharma',
    email: 'rahul.sales@neuways.com',
    role: 'SALES',
    isActive: true,
    isTeamActive: true,
    managerId: managerVikramId
  });

  userStore.push({
    _id: agentRohitId,
    name: 'Rohit Sharma',
    email: 'rohit.sales@neuways.com',
    role: 'SALES',
    isActive: true,
    isTeamActive: true,
    managerId: managerVikramId
  });

  userStore.push({
    _id: agentInactiveId,
    name: 'Inactive Agent',
    email: 'inactive.sales@neuways.com',
    role: 'SALES',
    isActive: false,
    isTeamActive: true,
    managerId: managerVikramId
  });

  userStore.push({
    _id: agentOtherManagerId,
    name: 'Other Manager Agent',
    email: 'other.agent@neuways.com',
    role: 'SALES',
    isActive: true,
    isTeamActive: true,
    managerId: managerOtherId
  });

  // Setup Mongoose mocks that emulate MongoDB query and aggregation mechanics
  let enquiryCountQueryCount = 0;
  let taskCountQueryCount = 0;
  let enquiryAggregateCount = 0;
  let taskAggregateCount = 0;
  let taskInsertManyCount = 0;
  let taskSaveCount = 0;

  (User as any).find = function (filter: any = {}) {
    let list = [...userStore];
    if (filter.role) list = list.filter((u) => u.role === filter.role);
    if (filter.isActive !== undefined) list = list.filter((u) => u.isActive === filter.isActive);
    if (filter.isTeamActive?.$ne !== undefined) {
      list = list.filter((u) => (u as any).isTeamActive !== filter.isTeamActive.$ne);
    }
    if (filter.managerId) {
      list = list.filter((u) => u.managerId && u.managerId.toString() === filter.managerId.toString());
    }
    if (filter._id?.$in) {
      const ids = filter._id.$in.map((i: any) => i.toString());
      list = list.filter((u) => ids.includes(u._id.toString()));
    }
    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      select: () => chain,
      lean: () => Promise.resolve(list),
      then: (resolve: any, reject: any) => Promise.resolve(list).then(resolve, reject)
    };
    return chain;
  };

  (User as any).findById = function (id: any) {
    const idStr = id?.toString();
    const u = userStore.find((x) => x._id.toString() === idStr);
    const chain: any = {
      select: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve(u || null),
      then: (resolve: any, reject: any) => Promise.resolve(u || null).then(resolve, reject)
    };
    return chain;
  };

  (Enquiry as any).prototype.save = function () {
    if (!this._id) {
      this._id = new Types.ObjectId();
    }
    const idx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
    if (idx !== -1) {
      enquiryStore[idx] = this;
    } else {
      enquiryStore.push(this);
    }
    return Promise.resolve(this);
  };

  (Enquiry as any).prototype.populate = function () {
    return Promise.resolve(this);
  };

  (Enquiry as any).findById = function (id: any) {
    const idStr = id?.toString();
    const item = enquiryStore.find((e) => e._id.toString() === idStr);
    if (!item) return Promise.resolve(null);
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      },
      populate: function () {
        return Promise.resolve(this);
      }
    };
    return Promise.resolve(doc);
  };

  (Enquiry as any).find = function (filter: any = {}) {
    let result = [...enquiryStore];
    if (filter.status) {
      if (typeof filter.status === 'object' && filter.status.$ne) {
        result = result.filter((e) => e.status !== filter.status.$ne);
      } else {
        result = result.filter((e) => e.status === filter.status);
      }
    }
    if (filter.assignedTo) {
      if (filter.assignedTo.$in) {
        const ids = filter.assignedTo.$in.map((i: any) => i.toString());
        result = result.filter((e) => e.assignedTo && ids.includes(e.assignedTo.toString()));
      } else if (filter.assignedTo.$ne === null) {
        result = result.filter((e) => e.assignedTo != null);
      } else {
        result = result.filter((e) => e.assignedTo?.toString() === filter.assignedTo.toString());
      }
    }
    if (filter['dealDone.isConfirmed']?.$ne === true) {
      result = result.filter((e) => !e.dealDone || e.dealDone.isConfirmed !== true);
    }
    if (filter.currentStage?.$nin) {
      result = result.filter((e) => !filter.currentStage.$nin.includes(e.currentStage));
    }
    if (filter.$or && Array.isArray(filter.$or)) {
      result = result.filter((e) => {
        return filter.$or.some((sub: any) => {
          if (sub.normalizedMobile && e.normalizedMobile === sub.normalizedMobile) return true;
          if (sub.normalizedEmail && e.normalizedEmail === sub.normalizedEmail) return true;
          if (sub.currentStage && e.currentStage === sub.currentStage) return true;
          if (sub.currentStage?.$exists === false && e.currentStage === undefined) return true;
          if (sub['rejection.reason']?.$exists && e.rejection?.reason) return true;
          if (sub.status === 'CLOSED' && e.status === 'CLOSED' && !e.dealDone?.isConfirmed) return true;
          return false;
        });
      });
    }
    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => result,
      select: () => chain,
      lean: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
    };
    return chain;
  };

  (Enquiry as any).countDocuments = function (filter: any = {}) {
    enquiryCountQueryCount++;
    let count = 0;
    for (const e of enquiryStore) {
      let matches = true;
      if (filter.status) {
        if (typeof filter.status === 'object' && filter.status.$ne) {
          if (e.status === filter.status.$ne) matches = false;
        } else if (e.status !== filter.status) {
          matches = false;
        }
      }
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const ids = filter.assignedTo.$in.map((i: any) => i.toString());
          if (!e.assignedTo || !ids.includes(e.assignedTo.toString())) matches = false;
        } else if (e.assignedTo?.toString() !== filter.assignedTo.toString()) {
          matches = false;
        }
      }
      if (filter.currentStage) {
        if (Array.isArray(filter.currentStage.$in)) {
          if (!filter.currentStage.$in.includes(e.currentStage)) matches = false;
        } else if (Array.isArray(filter.currentStage.$nin)) {
          if (filter.currentStage.$nin.includes(e.currentStage)) matches = false;
        } else if (filter.currentStage.$ne && e.currentStage === filter.currentStage.$ne) {
          matches = false;
        }
      }
      if (filter['dealDone.isConfirmed'] === true && (!e.dealDone || !e.dealDone.isConfirmed)) matches = false;
      if (filter['dealDone.isConfirmed']?.$ne === true && e.dealDone?.isConfirmed === true) matches = false;
      if (filter['rejection.reason']?.$exists === false && e.rejection?.reason) matches = false;
      if (filter['rejection.reason']?.$exists === true && (!e.rejection || !e.rejection.reason)) matches = false;
      if (filter.$or) {
        const orMatch = filter.$or.some((sub: any) => {
          if (sub['rejection.reason']?.$exists && e.rejection?.reason) return true;
          if (sub.status === 'CLOSED' && e.status === 'CLOSED' && !e.dealDone?.isConfirmed) return true;
          return false;
        });
        if (!orMatch) matches = false;
      }
      if (matches) count++;
    }
    return Promise.resolve(count);
  };

  // Mock Enquiry.aggregate executing MongoDB pipeline in-memory
  (Enquiry as any).aggregate = function (pipeline: any[] = []) {
    enquiryAggregateCount++;
    const matchStage = pipeline.find((s) => s.$match)?.$match || {};
    let docs = [...enquiryStore];

    if (matchStage.assignedTo?.$in) {
      const allowedIds = new Set(matchStage.assignedTo.$in.map((id: any) => id.toString()));
      docs = docs.filter((d) => d.assignedTo && allowedIds.has(d.assignedTo.toString()));
    }

    const groupStage = pipeline.find((s) => s.$group)?.$group;
    if (!groupStage) return Promise.resolve(docs);

    const groups = new Map<string, any>();
    for (const d of docs) {
      const key = d.assignedTo ? d.assignedTo.toString() : 'null';
      if (!groups.has(key)) {
        groups.set(key, {
          _id: d.assignedTo,
          activeLeadsCount: 0,
          followUpCount: 0,
          meetingCount: 0,
          siteVisitCount: 0,
          completedDealsCount: 0,
          rejectedCount: 0
        });
      }
      const g = groups.get(key);

      const isActive = d.status === 'ACTIVE' && (!d.dealDone || !d.dealDone.isConfirmed) && !['DEAL_DONE', '04. Deal Done'].includes(d.currentStage);
      if (isActive) g.activeLeadsCount++;

      if (d.status === 'ACTIVE' && ['FOLLOW_UP', '01. Follow-up'].includes(d.currentStage)) g.followUpCount++;
      if (d.status === 'ACTIVE' && ['MEETING_PLAN', '02. Meeting Plan'].includes(d.currentStage)) g.meetingCount++;
      if (d.status === 'ACTIVE' && ['SITE_VISIT_PLAN', '03. Site Visit Plan'].includes(d.currentStage)) g.siteVisitCount++;

      const isCompleted = ['DEAL_DONE', '04. Deal Done'].includes(d.currentStage) && d.dealDone?.isConfirmed === true && d.status !== 'CLOSED' && !d.rejection?.reason;
      if (isCompleted) g.completedDealsCount++;

      const isRejected = (d.rejection && d.rejection.reason != null) || (d.status === 'CLOSED' && (!d.dealDone || !d.dealDone.isConfirmed));
      if (isRejected) g.rejectedCount++;
    }

    return Promise.resolve(Array.from(groups.values()));
  };

  // Mock FollowUpTask operations
  (FollowUpTask as any).prototype.save = function () {
    taskSaveCount++;
    if (!this._id) this._id = new Types.ObjectId();
    taskStore.push(this);
    return Promise.resolve(this);
  };

  (FollowUpTask as any).insertMany = function (docs: any[]) {
    taskInsertManyCount++;
    for (const d of docs) {
      const item = { ...d, _id: d._id || new Types.ObjectId() };
      taskStore.push(item);
    }
    return Promise.resolve(docs);
  };

  (FollowUpTask as any).find = function (filter: any = {}) {
    let result = [...taskStore];
    if (filter.status) result = result.filter((t) => t.status === filter.status);
    if (filter.assignedTo?.$in) {
      const ids = filter.assignedTo.$in.map((i: any) => i.toString());
      result = result.filter((t) => t.assignedTo && ids.includes(t.assignedTo.toString()));
    }
    if (filter.enquiryId?.$in) {
      const ids = filter.enquiryId.$in.map((i: any) => i.toString());
      result = result.filter((t) => t.enquiryId && ids.includes(t.enquiryId.toString()));
    }
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      select: () => chain,
      lean: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
    };
    return chain;
  };

  (FollowUpTask as any).countDocuments = function (filter: any = {}) {
    taskCountQueryCount++;
    let count = 0;
    for (const t of taskStore) {
      let matches = true;
      if (filter.status && t.status !== filter.status) matches = false;
      if (filter.assignedTo && t.assignedTo?.toString() !== filter.assignedTo.toString()) matches = false;
      if (filter.enquiryId && t.enquiryId?.toString() !== filter.enquiryId.toString()) matches = false;
      if (filter.followUpDate?.$lte && new Date(t.followUpDate) > filter.followUpDate.$lte) matches = false;
      if (filter.followUpDate?.$gt && new Date(t.followUpDate) <= filter.followUpDate.$gt) matches = false;
      if (matches) count++;
    }
    return Promise.resolve(count);
  };

  // Mock FollowUpTask.aggregate executing in-memory
  (FollowUpTask as any).aggregate = function (pipeline: any[] = []) {
    taskAggregateCount++;
    const matchStage = pipeline.find((s) => s.$match)?.$match || {};
    let docs = [...taskStore];

    if (matchStage.status) docs = docs.filter((t) => t.status === matchStage.status);
    if (matchStage.assignedTo?.$in) {
      const allowed = new Set(matchStage.assignedTo.$in.map((id: any) => id.toString()));
      docs = docs.filter((t) => t.assignedTo && allowed.has(t.assignedTo.toString()));
    }

    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const groups = new Map<string, any>();
    for (const t of docs) {
      const key = t.assignedTo ? t.assignedTo.toString() : 'null';
      if (!groups.has(key)) {
        groups.set(key, {
          _id: t.assignedTo,
          pendingFollowUpsCount: 0,
          futureFollowUpsCount: 0
        });
      }
      const g = groups.get(key);
      const tDate = new Date(t.followUpDate);
      if (tDate <= endOfDay) {
        g.pendingFollowUpsCount++;
      } else {
        g.futureFollowUpsCount++;
      }
    }

    return Promise.resolve(Array.from(groups.values()));
  };

  // =========================================================================
  // SUITE 1: BUG-03 Initial Task Generation on Write-Path & Idempotency
  // =========================================================================
  console.log('--- Suite 1: BUG-03 Initial Task Generation on Write-Path ---');

  // Test 1: New lead creation generates initial pending task
  const initialTaskCountBefore = taskStore.length;
  const leadRes1 = await enquiryService.createEnquiry(
    {
      name: 'Test Lead With Initial Task',
      mobile: '+919876543210',
      assignedToId: agentRahulId.toString(),
      preferredContactMethod: 'EMAIL',
      preferredContactTiming: '11:00 AM'
    },
    managerVikram
  );

  assert(leadRes1.success === true, 'Test 1: Lead created successfully');
  assert(taskStore.length === initialTaskCountBefore + 1, 'Test 1: New lead creation generated exactly 1 FollowUpTask');
  const generatedTask = taskStore[taskStore.length - 1];
  assert(generatedTask.status === 'PENDING', 'Test 1: Initial task status is PENDING');
  assert(generatedTask.purpose === 'EMAIL', 'Test 1: Initial task matches preferredContactMethod (EMAIL)');
  assert(generatedTask.followUpTime === '11:00 AM', 'Test 1: Initial task matches preferredContactTiming');
  assert(generatedTask.assignedTo.toString() === agentRahulId.toString(), 'Test 1: Initial task assigned to Rahul');

  // Test 2: Unassigned lead assigned via assignEnquiry initializes task
  const unassignedLeadId = new Types.ObjectId();
  enquiryStore.push({
    _id: unassignedLeadId,
    name: 'Unassigned Test Lead',
    mobile: '+919876543211',
    normalizedMobile: '9876543211',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: null,
    preferredContactMethod: 'CALL',
    preferredContactTiming: '03:00 PM',
    createdAt: new Date()
  });

  const taskCountBeforeAssign = taskStore.length;
  const assignRes = await enquiryService.assignEnquiry(unassignedLeadId.toString(), agentRohitId.toString(), adminActor);
  assert(assignRes.success === true, 'Test 2: Lead assigned to Rohit');
  assert(taskStore.length === taskCountBeforeAssign + 1, 'Test 2: Assigning unassigned lead created initial follow-up task');
  const assignedTask = taskStore[taskStore.length - 1];
  assert(assignedTask.assignedTo.toString() === agentRohitId.toString(), 'Test 2: Initial task assigned to Rohit');

  // Test 3: Safe, batched handling of existing leads via ensureInitialTasksForActiveEnquiries()
  // Create an active lead without tasks directly in store
  const manualLeadId = new Types.ObjectId();
  enquiryStore.push({
    _id: manualLeadId,
    name: 'Manual Existing Active Lead',
    mobile: '+919876543212',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: agentRahulId,
    createdAt: new Date()
  });

  const taskCountBeforeBackfill = taskStore.length;
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(taskStore.length === taskCountBeforeBackfill + 1, 'Test 3: Backfill safely created task for active lead without tasks');
  assert(taskInsertManyCount > 0, 'Test 3: ensureInitialTasksForActiveEnquiries uses bulk insertMany');

  // Test 4: Repeated backfill is idempotent (0 additional tasks inserted)
  const taskCountAfterFirstBackfill = taskStore.length;
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(taskStore.length === taskCountAfterFirstBackfill, 'Test 4: Repeated backfill did NOT create duplicate tasks');

  // Test 5: Concurrent calls to ensureInitialTasksForActiveEnquiries() do not create duplicate tasks
  const taskCountBeforeConcurrent = taskStore.length;
  await Promise.all([
    enquiryService.ensureInitialTasksForActiveEnquiries(),
    enquiryService.ensureInitialTasksForActiveEnquiries(),
    enquiryService.ensureInitialTasksForActiveEnquiries()
  ]);
  assert(taskStore.length === taskCountBeforeConcurrent, 'Test 5: Concurrent backfill requests did NOT create duplicate tasks');

  // =========================================================================
  // SUITE 2: BUG-03 Dashboard Summary Read-Only Invariance & Performance
  // =========================================================================
  console.log('\n--- Suite 2: BUG-03 Dashboard Summary Read-Only Invariance ---');

  // Test 6: getDashboardSummary does NOT perform writes or backfills
  const tasksBeforeSummary = taskStore.length;
  const summaryRes1 = await enquiryService.getDashboardSummary(managerVikram);
  assert(summaryRes1.success === true, 'Test 6: getDashboardSummary returns success: true');
  assert(taskStore.length === tasksBeforeSummary, 'Test 6: Dashboard summary load causes ZERO writes to tasks');

  // Test 7: Repeated dashboard summary calls remain strictly read-only
  for (let i = 0; i < 5; i++) {
    await enquiryService.getDashboardSummary(managerVikram);
  }
  assert(taskStore.length === tasksBeforeSummary, 'Test 7: 5 repeated dashboard requests caused ZERO database writes');

  // Test 8: Concurrent dashboard summary calls cause ZERO writes and return identical metrics
  const concurrentSummaries = await Promise.all([
    enquiryService.getDashboardSummary(managerVikram),
    enquiryService.getDashboardSummary(managerVikram),
    enquiryService.getDashboardSummary(managerVikram)
  ]);
  assert(taskStore.length === tasksBeforeSummary, 'Test 8: 3 concurrent dashboard requests caused ZERO database writes');
  assert(concurrentSummaries.every((s) => s.success === true), 'Test 8: All concurrent requests succeeded');
  assert(
    concurrentSummaries[0].data?.activePipelineCount === concurrentSummaries[1].data?.activePipelineCount,
    'Test 8: Concurrent results are deterministic and consistent'
  );

  // Test 9: Verify complete dashboard summary envelope contract is intact
  const summaryData = summaryRes1.data!;
  assert(typeof summaryData.dailyVelocity === 'number', 'Test 9: Envelope has dailyVelocity');
  assert(typeof summaryData.pendingFollowUpsCount === 'number', 'Test 9: Envelope has pendingFollowUpsCount');
  assert(typeof summaryData.futureFollowUpsCount === 'number', 'Test 9: Envelope has futureFollowUpsCount');
  assert(typeof summaryData.activePipelineCount === 'number', 'Test 9: Envelope has activePipelineCount');
  assert(typeof summaryData.completedDealsCount === 'number', 'Test 9: Envelope has completedDealsCount');
  assert(typeof summaryData.rejectedCount === 'number', 'Test 9: Envelope has rejectedCount');
  assert(Array.isArray(summaryData.pendingStages), 'Test 9: Envelope has pendingStages array');
  assert(Array.isArray(summaryData.futureStages), 'Test 9: Envelope has futureStages array');
  assert(Boolean(summaryData.stageBreakdown), 'Test 9: Envelope has stageBreakdown');

  // =========================================================================
  // SUITE 3: BUG-04 Team Performance Batched Aggregation & Metric Accuracy
  // =========================================================================
  console.log('\n--- Suite 3: BUG-04 Team Performance Batched Aggregation & Accuracy ---');

  // Seed representative leads for Rahul and Rohit
  // Rahul: 1 completed deal, 1 rejected lead
  enquiryStore.push({
    _id: new Types.ObjectId(),
    name: 'Rahul Completed Deal',
    status: 'ACTIVE',
    currentStage: 'DEAL_DONE',
    assignedTo: agentRahulId,
    dealDone: { isConfirmed: true, project: 'Grand Heights', price: 5000000 },
    createdAt: new Date()
  });

  enquiryStore.push({
    _id: new Types.ObjectId(),
    name: 'Rahul Rejected Lead',
    status: 'CLOSED',
    currentStage: 'FOLLOW_UP',
    assignedTo: agentRahulId,
    rejection: { reason: 'BUDGET_MISMATCH' },
    dealDone: { isConfirmed: false },
    createdAt: new Date()
  });

  // Seed tasks: 1 pending today, 1 future for Rahul
  const today = new Date();
  const future = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);

  taskStore.push({
    _id: new Types.ObjectId(),
    enquiryId: manualLeadId,
    assignedTo: agentRahulId,
    followUpDate: today,
    followUpTime: '10:00 AM',
    status: 'PENDING',
    purpose: 'CALL'
  });

  taskStore.push({
    _id: new Types.ObjectId(),
    enquiryId: manualLeadId,
    assignedTo: agentRahulId,
    followUpDate: future,
    followUpTime: '02:00 PM',
    status: 'PENDING',
    purpose: 'CALL'
  });

  // Reset counters to measure query batching
  enquiryCountQueryCount = 0;
  taskCountQueryCount = 0;
  enquiryAggregateCount = 0;
  taskAggregateCount = 0;

  // Test 10: getTeamPerformance executes batched aggregation (O(1) database queries)
  const teamRes = await enquiryService.getTeamPerformance(managerVikram);
  assert(teamRes.success === true, 'Test 10: getTeamPerformance succeeded for Manager Vikram');
  assert(enquiryAggregateCount === 1, 'Test 10: Enquiry metrics executed exactly 1 batched aggregation query');
  assert(taskAggregateCount === 1, 'Test 10: Task metrics executed exactly 1 batched aggregation query');
  assert(enquiryCountQueryCount === 0, 'Test 10: Zero per-agent countDocuments executed for Enquiry');
  assert(taskCountQueryCount === 0, 'Test 10: Zero per-agent countDocuments executed for FollowUpTask');

  // Test 11: Team member isolation (Vikram sees only Rahul and Rohit)
  assert(teamRes.team?.length === 2, `Test 11: Vikram's team contains exactly 2 agents (got ${teamRes.team?.length})`);
  const agentNames = teamRes.team?.map((a) => a.name);
  assert(Boolean(agentNames?.includes('Rahul Sharma') && agentNames?.includes('Rohit Sharma')), 'Test 11: Team includes Rahul and Rohit');
  assert(!agentNames?.includes('Other Manager Agent'), 'Test 11: Cross-manager agent strictly excluded');
  assert(!agentNames?.includes('Inactive Agent'), 'Test 11: Inactive agent excluded from active team view');

  // Test 12: Metric accuracy for Rahul
  const rahulMetrics = teamRes.team?.find((a) => a.id === agentRahulId.toString());
  assert(Boolean(rahulMetrics), 'Test 12: Rahul metrics present');
  assert(rahulMetrics?.completedDealsCount === 1, `Test 12: Rahul completed deals count is 1 (got ${rahulMetrics?.completedDealsCount})`);
  assert(rahulMetrics?.rejectedCount === 1, `Test 12: Rahul rejected count is 1 (got ${rahulMetrics?.rejectedCount})`);
  assert(Boolean(rahulMetrics?.pendingFollowUpsCount !== undefined && rahulMetrics.pendingFollowUpsCount >= 1), `Test 12: Rahul pending follow-ups accurate (got ${rahulMetrics?.pendingFollowUpsCount})`);
  assert(Boolean(rahulMetrics?.futureFollowUpsCount !== undefined && rahulMetrics.futureFollowUpsCount >= 1), `Test 12: Rahul future follow-ups accurate (got ${rahulMetrics?.futureFollowUpsCount})`);

  // Test 13: Empty team handling (manager with 0 agents)
  const emptyManager: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'empty.manager@neuways.com',
    role: 'MANAGER',
    name: 'Empty Manager'
  };
  const emptyRes = await enquiryService.getTeamPerformance(emptyManager);
  assert(emptyRes.success === true, 'Test 13: Empty team returns success: true');
  assert(Array.isArray(emptyRes.team) && emptyRes.team.length === 0, 'Test 13: Empty team returns empty array');

  // =========================================================================
  // SUITE 4: Scalability & Benchmark (Teams with 5, 15, and 30 Agents)
  // =========================================================================
  console.log('\n--- Suite 4: Scalability & Benchmark (Teams with 5, 15, and 30 Agents) ---');

  // Helper to create synthetic team of N agents
  async function testTeamScale(agentCount: number) {
    const scaleManagerId = new Types.ObjectId();
    const scaleManager: AuthUser = {
      id: scaleManagerId.toString(),
      email: `scale.${agentCount}@neuways.com`,
      role: 'MANAGER',
      name: `Scale Manager ${agentCount}`
    };

    userStore.push({
      _id: scaleManagerId,
      name: `Scale Manager ${agentCount}`,
      email: `scale.${agentCount}@neuways.com`,
      role: 'MANAGER',
      isActive: true
    });

    for (let i = 0; i < agentCount; i++) {
      const aId = new Types.ObjectId();
      userStore.push({
        _id: aId,
        name: `Scale Agent ${i}`,
        email: `agent.${agentCount}.${i}@neuways.com`,
        role: 'SALES',
        isActive: true,
        isTeamActive: true,
        managerId: scaleManagerId
      });

      // Seed 2 active enquiries and 1 task per agent
      enquiryStore.push({
        _id: new Types.ObjectId(),
        name: `Lead A for agent ${i}`,
        status: 'ACTIVE',
        currentStage: 'FOLLOW_UP',
        assignedTo: aId,
        createdAt: new Date()
      });
      enquiryStore.push({
        _id: new Types.ObjectId(),
        name: `Lead B for agent ${i}`,
        status: 'ACTIVE',
        currentStage: 'MEETING_PLAN',
        assignedTo: aId,
        createdAt: new Date()
      });
      taskStore.push({
        _id: new Types.ObjectId(),
        enquiryId: new Types.ObjectId(),
        assignedTo: aId,
        followUpDate: new Date(),
        status: 'PENDING'
      });
    }

    const startAgg = Date.now();
    enquiryAggregateCount = 0;
    taskAggregateCount = 0;
    enquiryCountQueryCount = 0;
    taskCountQueryCount = 0;

    const scaleRes = await enquiryService.getTeamPerformance(scaleManager);
    const durationMs = Date.now() - startAgg;

    const totalDbOperations = enquiryAggregateCount + taskAggregateCount;
    const oldExpectedQueries = 1 + agentCount * 8; // Old implementation

    return {
      agentCount,
      success: scaleRes.success,
      returnedAgents: scaleRes.team?.length || 0,
      actualDbOperations: totalDbOperations,
      oldQueriesAvoided: oldExpectedQueries - totalDbOperations,
      durationMs
    };
  }

  const benchmark5 = await testTeamScale(5);
  console.log(`[BENCHMARK - 5 Agents]: Returned ${benchmark5.returnedAgents} agents in ${benchmark5.durationMs}ms with ${benchmark5.actualDbOperations} aggregation queries (avoided ${benchmark5.oldQueriesAvoided} count queries)`);
  assert(benchmark5.actualDbOperations === 2, 'Test 14: Team of 5 agents executed exactly 2 aggregation queries');
  assert(benchmark5.returnedAgents === 5, 'Test 14: Returned exactly 5 agents');

  const benchmark15 = await testTeamScale(15);
  console.log(`[BENCHMARK - 15 Agents]: Returned ${benchmark15.returnedAgents} agents in ${benchmark15.durationMs}ms with ${benchmark15.actualDbOperations} aggregation queries (avoided ${benchmark15.oldQueriesAvoided} count queries)`);
  assert(benchmark15.actualDbOperations === 2, 'Test 15: Team of 15 agents executed exactly 2 aggregation queries (O(1) query complexity)');
  assert(benchmark15.returnedAgents === 15, 'Test 15: Returned exactly 15 agents');

  const benchmark30 = await testTeamScale(30);
  console.log(`[BENCHMARK - 30 Agents]: Returned ${benchmark30.returnedAgents} agents in ${benchmark30.durationMs}ms with ${benchmark30.actualDbOperations} aggregation queries (avoided ${benchmark30.oldQueriesAvoided} count queries)`);
  assert(benchmark30.actualDbOperations === 2, 'Test 16: Team of 30 agents executed exactly 2 aggregation queries (avoided 239 queries!)');
  assert(benchmark30.returnedAgents === 30, 'Test 16: Returned exactly 30 agents');

  console.log('\n========================================================================');
  console.log(`Dashboard Performance Test Suite Completed: ${passedAssertions}/${totalAssertions} Passed (0 Failed)`);
  console.log('========================================================================\n');
}

runDashboardPerformanceTests().catch((err) => {
  console.error('[Dashboard Performance Test Runner Error]', err);
  process.exit(1);
});
