import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { Enquiry, EnquiryActivity, FollowUpTask, User } from '../models/index.js';
import { Notification } from '../models/notification.model.js';
import { notificationService } from '../services/notification.service.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { DEAL_LOST_REASONS, REJECTED_REASONS, PREDEFINED_REJECTION_REASONS } from '../models/enquiry.model.js';
import { AuthUser } from '../types/auth.types.js';

let passedTests = 0;
let failedTests = 0;
let totalTests = 0;

function pass(name: string) {
  passedTests++;
  totalTests++;
  console.log(`[PASS] ${name}`);
}

function fail(name: string, err: any) {
  failedTests++;
  totalTests++;
  console.error(`[FAIL] ${name}:`, err.message || err);
}

// In-Memory mock store
const enquiryStore: any[] = [];
const activityStore: any[] = [];
const userStore: any[] = [];
const taskStore: any[] = [];
const notificationStore: any[] = [];

// Setup mongoose mock behavior for isolated unit testing
function setupMocks() {
  (mongoose.connection as any).readyState = 1;

  (Enquiry as any).findById = (id: any) => {
    const idStr = id?.toString();
    const item = enquiryStore.find((e) => (e._id?.toString() || e.id?.toString()) === idStr);
    if (!item) {
      const emptyChain: any = {
        populate: () => emptyChain,
        lean: () => Promise.resolve(null),
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      };
      return emptyChain as any;
    }
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      },
    };
    const chain: any = {
      populate: () => chain,
      lean: () => Promise.resolve(doc),
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    };
    return chain as any;
  };

  (Enquiry as any).find = (filter: any = {}) => {
    let result = [...enquiryStore];
    if (filter.status) {
      if (typeof filter.status === 'object' && filter.status.$ne) {
        result = result.filter((e) => e.status !== filter.status.$ne);
      } else {
        result = result.filter((e) => e.status === filter.status);
      }
    }
    if (filter['rejection.closureType']) {
      result = result.filter((e) => e.rejection?.closureType === filter['rejection.closureType']);
    }
    if (filter.assignedTo) {
      if (filter.assignedTo.$in) {
        const ids = filter.assignedTo.$in.map((id: any) => id.toString());
        result = result.filter((e) => e.assignedTo && ids.includes(e.assignedTo.toString()));
      } else {
        result = result.filter((e) => e.assignedTo?.toString() === filter.assignedTo.toString());
      }
    }
    if (filter.currentStage) {
      if (typeof filter.currentStage === 'object') {
        if (Array.isArray(filter.currentStage.$in)) {
          result = result.filter((e) => filter.currentStage.$in.includes(e.currentStage));
        } else if (filter.currentStage.$ne) {
          result = result.filter((e) => e.currentStage !== filter.currentStage.$ne);
        }
      } else {
        result = result.filter((e) => e.currentStage === filter.currentStage);
      }
    }
    if (filter['dealDone.isConfirmed'] === true) {
      result = result.filter((e) => e.dealDone && e.dealDone.isConfirmed === true);
    }
    if (filter['dealDone.isConfirmed']?.$ne === true) {
      result = result.filter((e) => !e.dealDone || e.dealDone.isConfirmed !== true);
    }
    if (filter['rejection.reason']?.$exists === true) {
      result = result.filter((e) => e.rejection && e.rejection.reason != null);
    }
    if (filter['rejection.reason']?.$exists === false) {
      result = result.filter((e) => !e.rejection || !e.rejection.reason);
    }
    if (filter.$or) {
      result = result.filter((e) => {
        return filter.$or.some((sub: any) => {
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
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain as any;
  };

  (Enquiry as any).countDocuments = (filter: any = {}) => {
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
      if (filter['rejection.closureType'] && e.rejection?.closureType !== filter['rejection.closureType']) {
        matches = false;
      }
      if (filter['rejection.closureType']?.$in && !filter['rejection.closureType'].$in.includes(e.rejection?.closureType)) {
        matches = false;
      }
      if (filter.assignedTo && e.assignedTo?.toString() !== filter.assignedTo.toString()) matches = false;
      if (filter.currentStage && Array.isArray(filter.currentStage.$in) && !filter.currentStage.$in.includes(e.currentStage)) {
        matches = false;
      }
      if (filter['dealDone.isConfirmed'] === true && (!e.dealDone || !e.dealDone.isConfirmed)) matches = false;
      if (filter['dealDone.isConfirmed']?.$ne === true && e.dealDone?.isConfirmed === true) matches = false;
      if (filter['rejection.reason'] && filter['rejection.reason'].$exists === false && e.rejection?.reason) {
        matches = false;
      }
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

  (EnquiryActivity as any).prototype.save = function () {
    activityStore.push(this);
    return Promise.resolve(this);
  };

  (FollowUpTask as any).create = (data: any) => {
    taskStore.push(data);
    return Promise.resolve(data);
  };

  (FollowUpTask as any).prototype.save = function () {
    taskStore.push(this);
    return Promise.resolve(this);
  };

  (FollowUpTask as any).find = (query: any = {}) => {
    let tasks = [...taskStore];
    if (query.enquiryId) {
      tasks = tasks.filter((t) => t.enquiryId?.toString() === query.enquiryId.toString());
    }
    if (query.status) {
      if (query.status.$in) {
        tasks = tasks.filter((t) => query.status.$in.includes(t.status));
      } else {
        tasks = tasks.filter((t) => t.status === query.status);
      }
    }
    const mapped = tasks.map((t) => {
      const doc: any = {
        ...t,
        save: function () {
          Object.assign(t, this);
          return Promise.resolve(t);
        },
      };
      return doc;
    });
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve(mapped),
      then: (resolve: any, reject: any) => Promise.resolve(mapped).then(resolve, reject),
    };
    return chain as any;
  };

  (FollowUpTask as any).countDocuments = (filter: any = {}) => {
    let count = 0;
    for (const t of taskStore) {
      let matches = true;
      if (filter.enquiryId && t.enquiryId?.toString() !== filter.enquiryId.toString()) matches = false;
      if (filter.status && t.status !== filter.status) matches = false;
      if (matches) count++;
    }
    return Promise.resolve(count);
  };

  (FollowUpTask as any).updateMany = (filter: any, update: any) => {
    let matched = 0;
    for (const t of taskStore) {
      let match = true;
      if (filter.enquiryId && t.enquiryId?.toString() !== filter.enquiryId?.toString()) match = false;
      if (filter.status?.$in && !filter.status.$in.includes(t.status)) match = false;
      if (match) {
        if (update.$set) {
          Object.assign(t, update.$set);
        }
        matched++;
      }
    }
    return Promise.resolve({ matchedCount: matched, modifiedCount: matched });
  };

  (User as any)._isMocked = true;
  (Notification as any)._isMocked = true;

  (Notification as any).findOne = (query: any = {}) => {
    const found = notificationStore.find((n) => {
      if (query.idempotencyKey && n.idempotencyKey === query.idempotencyKey) return true;
      return false;
    });
    return {
      lean: () => Promise.resolve(found || null),
      then: (resolve: any, reject: any) => Promise.resolve(found || null).then(resolve, reject),
    } as any;
  };

  (Notification as any).prototype.save = function () {
    notificationStore.push(this);
    return Promise.resolve(this);
  };

  (notificationService as any).createNotification = async function (data: any) {
    if (data.idempotencyKey) {
      const existing = notificationStore.find((n) => n.idempotencyKey === data.idempotencyKey);
      if (existing) {
        return { success: true, notification: existing };
      }
    }
    notificationStore.push(data);
    return { success: true, notification: data };
  };

  (User as any).findById = (id: any) => {
    const idStr = id?.toString();
    const user = userStore.find((u) => (u._id?.toString() || u.id?.toString()) === idStr);
    return {
      select: () => Promise.resolve(user),
      lean: () => Promise.resolve(user),
      then: (resolve: any, reject: any) => Promise.resolve(user).then(resolve, reject),
    } as any;
  };

  (User as any).find = (query: any = {}) => {
    let users = [...userStore];
    if (query.role) {
      users = users.filter((u) => u.role === query.role);
    }
    if (query.isActive !== undefined) {
      users = users.filter((u) => u.isActive === query.isActive);
    }
    if (query.managerId) {
      users = users.filter((u) => u.managerId?.toString() === query.managerId.toString());
    }
    return {
      select: () => ({
        lean: () => Promise.resolve(users),
        then: (resolve: any, reject: any) => Promise.resolve(users).then(resolve, reject),
      }),
      lean: () => Promise.resolve(users),
      then: (resolve: any, reject: any) => Promise.resolve(users).then(resolve, reject),
    } as any;
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('Starting REQ-36: Rejected vs Deal Lost Test Suite');
  console.log('====================================================\n');

  setupMocks();

  const adminUser: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    name: 'Admin User',
    role: 'ADMIN',
  };

  const managerUser: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'manager@neuways.com',
    name: 'Manager User',
    role: 'MANAGER',
  };

  const salesAgent1: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent1@neuways.com',
    name: 'Sales Agent 1',
    role: 'SALES',
  };

  const salesAgent2: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent2@neuways.com',
    name: 'Sales Agent 2',
    role: 'SALES',
  };

  userStore.push(
    { _id: new Types.ObjectId(adminUser.id), name: adminUser.name, role: 'ADMIN', isActive: true },
    { _id: new Types.ObjectId(managerUser.id), name: managerUser.name, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(salesAgent1.id), name: salesAgent1.name, role: 'SALES', managerId: managerUser.id, isActive: true },
    { _id: new Types.ObjectId(salesAgent2.id), name: salesAgent2.name, role: 'SALES', managerId: new Types.ObjectId().toString(), isActive: true }
  );

  const enquiryService = new EnquiryService();
  (enquiryService as any).ensureInitialTasksForActiveEnquiries = () => Promise.resolve();

  // ---------------------------------------------------------------------------
  // Test 1: Valid deal lost submissions succeed with allowed reasons
  // ---------------------------------------------------------------------------
  try {
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Deal Lost Test Lead 1',
      status: 'ACTIVE',
      currentStage: 'SITE_VISIT_PLAN',
      assignedTo: new Types.ObjectId(salesAgent1.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await enquiryService.markDealLost(
      leadId.toString(),
      {
        reason: DEAL_LOST_REASONS[0], // 'Chose another property/competitor'
        remarks: 'Client signed with competitor offering immediate possession.',
      },
      salesAgent1
    );

    assert.strictEqual(res.success, true, 'markDealLost should return success: true');
    const updated = enquiryStore.find((e) => e._id.toString() === leadId.toString());
    assert.strictEqual(updated.status, 'CLOSED', 'Status must be CLOSED');
    assert.strictEqual(updated.rejection?.closureType, 'DEAL_LOST', 'closureType must be DEAL_LOST');
    assert.strictEqual(updated.rejection?.reason, DEAL_LOST_REASONS[0]);
    assert.strictEqual(updated.rejection?.previousStage, 'SITE_VISIT_PLAN');
    assert.ok(updated.rejection?.remarks.includes('competitor'));
    pass('Test 1: Valid deal lost submission succeeds with allowed reason');
  } catch (err) {
    fail('Test 1: Valid deal lost submission succeeds with allowed reason', err);
  }

  // ---------------------------------------------------------------------------
  // Test 2: Invalid deal lost reasons are rejected with clear error message
  // ---------------------------------------------------------------------------
  try {
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Deal Lost Test Lead 2',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res = await enquiryService.markDealLost(
      leadId.toString(),
      {
        reason: 'Random non-existent reason',
        remarks: 'Some valid remarks here',
      },
      salesAgent1
    );

    assert.strictEqual(res.success, false, 'Invalid reason must fail');
    assert.ok(res.message.includes('Invalid deal lost reason'), 'Message must explain invalid reason');
    pass('Test 2: Invalid deal lost reason rejected with clear error message');
  } catch (err) {
    fail('Test 2: Invalid deal lost reason rejected with clear error message', err);
  }

  // ---------------------------------------------------------------------------
  // Test 3: Empty or whitespace-only remarks are rejected for both Rejected and Deal Lost
  // ---------------------------------------------------------------------------
  try {
    const leadIdA = new Types.ObjectId();
    enquiryStore.push({
      _id: leadIdA,
      id: leadIdA.toString(),
      name: 'Deal Lost Empty Remarks Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const resLostEmpty = await enquiryService.markDealLost(
      leadIdA.toString(),
      {
        reason: DEAL_LOST_REASONS[0],
        remarks: '   ',
      },
      salesAgent1
    );
    assert.strictEqual(resLostEmpty.success, false, 'Whitespace remarks in deal lost must fail');
    assert.ok(resLostEmpty.message.toLowerCase().includes('remarks'), 'Must state mandatory remarks');

    const leadIdB = new Types.ObjectId();
    enquiryStore.push({
      _id: leadIdB,
      id: leadIdB.toString(),
      name: 'Reject Empty Remarks Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const resRejectEmpty = await enquiryService.rejectEnquiry(
      leadIdB.toString(),
      {
        reason: REJECTED_REASONS[0],
        remarks: '',
      },
      salesAgent1
    );
    assert.strictEqual(resRejectEmpty.success, false, 'Empty remarks in reject must fail');
    assert.ok(resRejectEmpty.message.toLowerCase().includes('remarks') && resRejectEmpty.message.toLowerCase().includes('mandatory'), 'Must state mandatory remarks');
    pass('Test 3: Empty or whitespace-only remarks are rejected for both Rejected and Deal Lost');
  } catch (err) {
    fail('Test 3: Empty or whitespace-only remarks are rejected for both Rejected and Deal Lost', err);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Cannot mark a lead as deal lost if it is already closed or finalized deal done
  // ---------------------------------------------------------------------------
  try {
    const closedLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: closedLeadId,
      id: closedLeadId.toString(),
      name: 'Already Closed Lead',
      status: 'CLOSED',
      currentStage: 'MEETING_PLAN',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const resClosed = await enquiryService.markDealLost(
      closedLeadId.toString(),
      { reason: DEAL_LOST_REASONS[1], remarks: 'Attempt on closed' },
      salesAgent1
    );
    assert.strictEqual(resClosed.success, false, 'Cannot mark already closed lead as deal lost');

    const finalizedLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: finalizedLeadId,
      id: finalizedLeadId.toString(),
      name: 'Deal Done Lead',
      status: 'ACTIVE',
      currentStage: 'DEAL_DONE',
      dealDone: { isConfirmed: true, finalizedAt: new Date() },
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const resFinalized = await enquiryService.markDealLost(
      finalizedLeadId.toString(),
      { reason: DEAL_LOST_REASONS[1], remarks: 'Attempt on deal done' },
      salesAgent1
    );
    assert.strictEqual(resFinalized.success, false, 'Cannot mark finalized deal done as deal lost');
    pass('Test 4: Cannot mark a lead as deal lost if it is already closed or finalized deal done');
  } catch (err) {
    fail('Test 4: Cannot mark a lead as deal lost if it is already closed or finalized deal done', err);
  }

  // ---------------------------------------------------------------------------
  // Test 5 & 6 & 7: Follow-up tasks cancellation on Deal Lost and Rejected
  // ---------------------------------------------------------------------------
  try {
    const leadWithTasksId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadWithTasksId,
      id: leadWithTasksId.toString(),
      name: 'Tasks Sync Lead',
      status: 'ACTIVE',
      currentStage: 'MEETING_PLAN',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    // 1 Pending task (active)
    const pendingTaskId = new Types.ObjectId();
    taskStore.push({
      _id: pendingTaskId,
      enquiryId: leadWithTasksId,
      taskType: 'MEETING',
      status: 'PENDING',
    });

    // 1 In-progress task (active)
    const inProgressTaskId = new Types.ObjectId();
    taskStore.push({
      _id: inProgressTaskId,
      enquiryId: leadWithTasksId,
      taskType: 'FOLLOW_UP',
      status: 'IN_PROGRESS',
    });

    // 1 Rescheduled task (active)
    const rescheduledTaskId = new Types.ObjectId();
    taskStore.push({
      _id: rescheduledTaskId,
      enquiryId: leadWithTasksId,
      taskType: 'SITE_VISIT',
      status: 'RESCHEDULED',
    });

    // 1 Completed task (terminal - must NOT be touched)
    const completedTaskId = new Types.ObjectId();
    taskStore.push({
      _id: completedTaskId,
      enquiryId: leadWithTasksId,
      taskType: 'FOLLOW_UP',
      status: 'COMPLETED',
      completedAt: new Date('2026-01-01'),
    });

    // 1 Already Cancelled task (terminal - must NOT be touched)
    const existingCancelledTaskId = new Types.ObjectId();
    taskStore.push({
      _id: existingCancelledTaskId,
      enquiryId: leadWithTasksId,
      taskType: 'SITE_VISIT',
      status: 'CANCELLED',
      cancellationReason: 'Prior customer request',
    });

    const res = await enquiryService.markDealLost(
      leadWithTasksId.toString(),
      {
        reason: 'Payment/loan issue',
        remarks: 'Bank rejected home loan application.',
      },
      salesAgent1
    );

    assert.strictEqual(res.success, true);

    const pendingTask = taskStore.find((t) => t._id.toString() === pendingTaskId.toString());
    const inProgressTask = taskStore.find((t) => t._id.toString() === inProgressTaskId.toString());
    const rescheduledTask = taskStore.find((t) => t._id.toString() === rescheduledTaskId.toString());
    const completedTask = taskStore.find((t) => t._id.toString() === completedTaskId.toString());
    const existingCancelledTask = taskStore.find((t) => t._id.toString() === existingCancelledTaskId.toString());

    assert.strictEqual(pendingTask.status, 'CANCELLED', 'Pending task must be cancelled');
    assert.strictEqual(inProgressTask.status, 'CANCELLED', 'In-progress task must be cancelled');
    assert.strictEqual(rescheduledTask.status, 'CANCELLED', 'Rescheduled task must be cancelled');
    assert.ok(pendingTask.cancellationReason.includes('Deal Lost'), 'Must note Deal Lost in cancellation reason');
    assert.ok(pendingTask.statusChangedAt instanceof Date, 'Must have statusChangedAt date');
    assert.ok(pendingTask.statusChangedBy != null, 'Must have statusChangedBy actor');

    // Invariants: COMPLETED and CANCELLED untouched
    assert.strictEqual(completedTask.status, 'COMPLETED', 'Completed task must remain COMPLETED');
    assert.strictEqual(completedTask.completedAt.toISOString(), new Date('2026-01-01').toISOString());
    assert.strictEqual(existingCancelledTask.cancellationReason, 'Prior customer request', 'Prior cancelled task untouched');

    pass('Test 5, 6 & 7: Active tasks cancelled on Deal Lost; terminal COMPLETED and CANCELLED untouched');
  } catch (err) {
    fail('Test 5, 6 & 7: Active tasks cancelled on Deal Lost; terminal COMPLETED and CANCELLED untouched', err);
  }

  // ---------------------------------------------------------------------------
  // Test 8: Distinct activity history entries are created for REJECTED and DEAL_LOST
  // ---------------------------------------------------------------------------
  try {
    const rejectLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: rejectLeadId,
      id: rejectLeadId.toString(),
      name: 'Activity Test Lead Reject',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    await enquiryService.rejectEnquiry(
      rejectLeadId.toString(),
      { reason: 'Budget too high', remarks: 'Customer looking for properties under 50L.' },
      salesAgent1
    );

    const rejectActivities = activityStore.filter((a) => a.enquiryId?.toString() === rejectLeadId.toString());
    const hasLeadRejectedActivity = rejectActivities.some((a) => a.type === 'LEAD_REJECTED');
    assert.ok(hasLeadRejectedActivity, 'Must emit LEAD_REJECTED activity');

    const lostLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: lostLeadId,
      id: lostLeadId.toString(),
      name: 'Activity Test Lead Lost',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    await enquiryService.markDealLost(
      lostLeadId.toString(),
      { reason: 'Pricing issue', remarks: 'Client negotiated for 15% discount which was declined.' },
      salesAgent1
    );

    const lostActivities = activityStore.filter((a) => a.enquiryId?.toString() === lostLeadId.toString());
    const hasDealLostActivity = lostActivities.some((a) => a.type === 'DEAL_LOST');
    assert.ok(hasDealLostActivity, 'Must emit DEAL_LOST activity');

    pass('Test 8: Distinct activity history entries are created for LEAD_REJECTED and DEAL_LOST');
  } catch (err) {
    fail('Test 8: Distinct activity history entries are created for LEAD_REJECTED and DEAL_LOST', err);
  }

  // ---------------------------------------------------------------------------
  // Test 9: Legacy closed records remain readable without errors
  // ---------------------------------------------------------------------------
  try {
    const legacyLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: legacyLeadId,
      id: legacyLeadId.toString(),
      name: 'Legacy Closed Lead No ClosureType',
      status: 'CLOSED',
      currentStage: 'FOLLOW_UP',
      rejection: {
        reason: 'Not interested',
        rejectedAt: new Date('2025-05-01'),
        // Notice closureType is intentionally omitted (legacy)
      },
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res = await enquiryService.listEnquiries({ rejected: true }, adminUser);
    assert.strictEqual(res.success, true);
    const legacyFound = res.enquiries.find((e: any) => e.id?.toString() === legacyLeadId.toString());
    assert.ok(legacyFound, 'Legacy closed record must be returned without errors');
    assert.strictEqual(legacyFound.rejection?.closureType, undefined, 'Legacy record preserves undefined closureType');

    pass('Test 9: Legacy closed records remain readable without errors');
  } catch (err) {
    fail('Test 9: Legacy closed records remain readable without errors', err);
  }

  // ---------------------------------------------------------------------------
  // Test 10: Filtering by closureType in list APIs
  // ---------------------------------------------------------------------------
  try {
    const listResLost = await enquiryService.listEnquiries({ closureType: 'DEAL_LOST' }, adminUser);
    assert.strictEqual(listResLost.success, true);
    for (const lead of listResLost.enquiries) {
      assert.strictEqual(lead.rejection?.closureType, 'DEAL_LOST', 'Must only return DEAL_LOST leads');
    }

    const listResReject = await enquiryService.listEnquiries({ closureType: 'REJECTED' }, adminUser);
    assert.strictEqual(listResReject.success, true);
    for (const lead of listResReject.enquiries) {
      assert.strictEqual(lead.rejection?.closureType, 'REJECTED', 'Must only return REJECTED leads');
    }

    pass('Test 10: Filtering by closureType in list APIs works accurately');
  } catch (err) {
    fail('Test 10: Filtering by closureType in list APIs works accurately', err);
  }

  // ---------------------------------------------------------------------------
  // Test 11: RBAC rules are enforced for Deal Lost
  // ---------------------------------------------------------------------------
  try {
    const agent2LeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: agent2LeadId,
      id: agent2LeadId.toString(),
      name: 'Agent 2 Protected Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent2.id),
    });

    // Agent 1 attempts to mark Agent 2's lead as deal lost -> Must fail (403)
    const resForbidden = await enquiryService.markDealLost(
      agent2LeadId.toString(),
      { reason: DEAL_LOST_REASONS[0], remarks: 'Unauthorized attempt' },
      salesAgent1
    );
    assert.strictEqual(resForbidden.success, false, 'Unassigned agent cannot mark deal lost');
    assert.strictEqual(resForbidden.statusCode, 403, 'Must return 403');
    assert.ok(resForbidden.message.includes('Access denied'), 'Message must indicate lack of authorization');

    // Admin can mark any lead as deal lost
    const resAdmin = await enquiryService.markDealLost(
      agent2LeadId.toString(),
      { reason: DEAL_LOST_REASONS[0], remarks: 'Authorized admin closure' },
      adminUser
    );
    assert.strictEqual(resAdmin.success, true, 'Admin can mark any lead as deal lost');

    pass('Test 11: RBAC rules are strictly enforced for Deal Lost');
  } catch (err) {
    fail('Test 11: RBAC rules are strictly enforced for Deal Lost', err);
  }

  // ---------------------------------------------------------------------------
  // Test 12: Idempotent closure checks prevent double closing
  // ---------------------------------------------------------------------------
  try {
    const doubleCloseLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: doubleCloseLeadId,
      id: doubleCloseLeadId.toString(),
      name: 'Double Close Test Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const firstClose = await enquiryService.markDealLost(
      doubleCloseLeadId.toString(),
      { reason: DEAL_LOST_REASONS[0], remarks: 'First closure' },
      salesAgent1
    );
    assert.strictEqual(firstClose.success, true);

    // Second attempt to mark deal lost
    const secondLost = await enquiryService.markDealLost(
      doubleCloseLeadId.toString(),
      { reason: DEAL_LOST_REASONS[1], remarks: 'Second closure attempt' },
      salesAgent1
    );
    assert.strictEqual(secondLost.success, false, 'Double deal lost must be prevented');

    // Attempt to mark rejected after already deal lost
    const attemptReject = await enquiryService.rejectEnquiry(
      doubleCloseLeadId.toString(),
      { reason: REJECTED_REASONS[0], remarks: 'Attempt reject on already closed' },
      salesAgent1
    );
    assert.strictEqual(attemptReject.success, false, 'Reject on deal lost must be prevented');

    pass('Test 12: Idempotent closure checks prevent double closing or conflicting closures');
  } catch (err) {
    fail('Test 12: Idempotent closure checks prevent double closing or conflicting closures', err);
  }

  // ---------------------------------------------------------------------------
  // Test 13: Scenario 1 - Assigned Sales Agent receives Deal Lost notification when Admin or Manager marks lead as Deal Lost
  // ---------------------------------------------------------------------------
  try {
    notificationStore.length = 0;
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Agent Notification Lead',
      status: 'ACTIVE',
      currentStage: 'SITE_VISIT_PLAN',
      assignedTo: new Types.ObjectId(salesAgent1.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await enquiryService.markDealLost(
      leadId.toString(),
      { reason: 'Pricing issue', remarks: 'Admin confirmed client found pricing above market.' },
      adminUser
    );
    assert.strictEqual(res.success, true, 'Admin marking Deal Lost must succeed');

    const agentNotif = notificationStore.find((n) => n.recipient === salesAgent1.id);
    assert.ok(agentNotif, 'Assigned Sales Agent must receive a notification');
    assert.strictEqual(agentNotif.title, 'Opportunity Deal Lost: Agent Notification Lead');
    assert.strictEqual(agentNotif.link, '/leads');
    assert.strictEqual(agentNotif.type, 'WORKFLOW_UPDATE');
    assert.strictEqual(agentNotif.idempotencyKey, `deal_lost_${leadId.toString()}_${salesAgent1.id}`);
    assert.ok(agentNotif.message.includes(adminUser.name), 'Notification message must mention actor name');
    assert.ok(agentNotif.message.includes('Pricing issue'), 'Notification message must include reason');

    pass('Test 13: Assigned Sales Agent receives Deal Lost notification when Admin marks lead as Deal Lost');
  } catch (err) {
    fail('Test 13: Assigned Sales Agent receives Deal Lost notification when Admin marks lead as Deal Lost', err);
  }

  // ---------------------------------------------------------------------------
  // Test 14: Scenario 2 - Admin and responsible Manager continue receiving Deal Lost notifications
  // ---------------------------------------------------------------------------
  try {
    notificationStore.length = 0;
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Multi Recipient Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await enquiryService.markDealLost(
      leadId.toString(),
      { reason: 'Payment/loan issue', remarks: 'Bank refused loan approval.' },
      salesAgent1
    );
    assert.strictEqual(res.success, true);

    const adminNotif = notificationStore.find((n) => n.recipient === adminUser.id);
    assert.ok(adminNotif, 'Active Admin must receive Deal Lost notification');
    assert.strictEqual(adminNotif.title, 'Deal Lost: Multi Recipient Lead');
    assert.strictEqual(adminNotif.link, '/leads');
    assert.strictEqual(adminNotif.idempotencyKey, `deal_lost_${leadId.toString()}_${adminUser.id}`);

    const managerNotif = notificationStore.find((n) => n.recipient === managerUser.id);
    assert.ok(managerNotif, 'Responsible Manager must receive Deal Lost notification');
    assert.strictEqual(managerNotif.title, 'Team Deal Lost: Multi Recipient Lead');
    assert.strictEqual(managerNotif.link, '/manager/rejected-deals');
    assert.strictEqual(managerNotif.idempotencyKey, `deal_lost_${leadId.toString()}_${managerUser.id}`);

    pass('Test 14: Admin and responsible Manager continue receiving Deal Lost notifications');
  } catch (err) {
    fail('Test 14: Admin and responsible Manager continue receiving Deal Lost notifications', err);
  }

  // ---------------------------------------------------------------------------
  // Test 15: Scenario 3 - Assigned Sales Agent does NOT receive duplicate self-notification when agent themselves marks lead Deal Lost
  // ---------------------------------------------------------------------------
  try {
    notificationStore.length = 0;
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Self Notification Check Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await enquiryService.markDealLost(
      leadId.toString(),
      { reason: 'Pricing issue', remarks: 'Client declined proposal.' },
      salesAgent1
    );
    assert.strictEqual(res.success, true);

    const selfNotifs = notificationStore.filter((n) => n.recipient === salesAgent1.id);
    assert.strictEqual(selfNotifs.length, 0, 'Assigned Sales Agent must NOT receive self-notification');

    pass('Test 15: Assigned Sales Agent does NOT receive duplicate self-notification when agent themselves marks lead Deal Lost');
  } catch (err) {
    fail('Test 15: Assigned Sales Agent does NOT receive duplicate self-notification when agent themselves marks lead Deal Lost', err);
  }

  // ---------------------------------------------------------------------------
  // Test 16: Scenario 4 - Existing LEAD_REJECTED notification behavior remains unchanged
  // ---------------------------------------------------------------------------
  try {
    notificationStore.length = 0;
    const leadId = new Types.ObjectId();
    enquiryStore.push({
      _id: leadId,
      id: leadId.toString(),
      name: 'Rejection Notification Lead',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await enquiryService.rejectEnquiry(
      leadId.toString(),
      { reason: 'Budget mismatch', remarks: 'Client has budget of 30L, our minimum is 65L.' },
      salesAgent1
    );
    assert.strictEqual(res.success, true);

    const adminNotif = notificationStore.find((n) => n.recipient === adminUser.id);
    assert.ok(adminNotif, 'Admin must receive Lead Rejected notification');
    assert.strictEqual(adminNotif.title, 'Lead Rejected: Rejection Notification Lead');
    assert.strictEqual(adminNotif.link, '/leads');
    assert.strictEqual(adminNotif.idempotencyKey, `lead_rejected_${leadId.toString()}_${adminUser.id}`);

    const managerNotif = notificationStore.find((n) => n.recipient === managerUser.id);
    assert.ok(managerNotif, 'Manager must receive Team Lead Rejected notification');
    assert.strictEqual(managerNotif.title, 'Team Lead Rejected: Rejection Notification Lead');
    assert.strictEqual(managerNotif.link, '/manager/rejected-deals');
    assert.strictEqual(managerNotif.idempotencyKey, `lead_rejected_${leadId.toString()}_${managerUser.id}`);

    const agentNotifs = notificationStore.filter((n) => n.recipient === salesAgent1.id);
    assert.strictEqual(agentNotifs.length, 0, 'Sales agent actor does not receive self-notification on rejection');

    pass('Test 16: Existing LEAD_REJECTED notification behavior remains unchanged');
  } catch (err) {
    fail('Test 16: Existing LEAD_REJECTED notification behavior remains unchanged', err);
  }

  // ---------------------------------------------------------------------------
  // Test 17: Scenario 5 - Rejected-only reasons (Budget mismatch, Location issue) are accepted by rejectEnquiry()
  // ---------------------------------------------------------------------------
  try {
    const lead1Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead1Id,
      id: lead1Id.toString(),
      name: 'Reject Reason Test 1',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res1 = await enquiryService.rejectEnquiry(
      lead1Id.toString(),
      { reason: 'Budget mismatch', remarks: 'Budget mismatch documented' },
      salesAgent1
    );
    assert.strictEqual(res1.success, true, 'Budget mismatch must be accepted by rejectEnquiry');

    const lead2Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead2Id,
      id: lead2Id.toString(),
      name: 'Reject Reason Test 2',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res2 = await enquiryService.rejectEnquiry(
      lead2Id.toString(),
      { reason: 'Location issue', remarks: 'Location issue documented' },
      salesAgent1
    );
    assert.strictEqual(res2.success, true, 'Location issue must be accepted by rejectEnquiry');

    pass('Test 17: Rejected-only reasons (Budget mismatch, Location issue) are accepted by rejectEnquiry()');
  } catch (err) {
    fail('Test 17: Rejected-only reasons (Budget mismatch, Location issue) are accepted by rejectEnquiry()', err);
  }

  // ---------------------------------------------------------------------------
  // Test 18: Scenario 6 - Deal Lost-only reasons (Pricing issue, Property preference changed) are rejected by rejectEnquiry() with HTTP 400
  // ---------------------------------------------------------------------------
  try {
    const lead1Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead1Id,
      id: lead1Id.toString(),
      name: 'Reject Deal Lost Reason 1',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res1 = await enquiryService.rejectEnquiry(
      lead1Id.toString(),
      { reason: 'Pricing issue', remarks: 'Trying to reject with deal lost reason' },
      salesAgent1
    );
    assert.strictEqual(res1.success, false, 'Pricing issue must be rejected by rejectEnquiry');
    assert.strictEqual(res1.statusCode, 400, 'Must return HTTP 400');
    assert.ok(res1.message.includes('Invalid rejection reason'));

    const lead2Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead2Id,
      id: lead2Id.toString(),
      name: 'Reject Deal Lost Reason 2',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res2 = await enquiryService.rejectEnquiry(
      lead2Id.toString(),
      { reason: 'Property preference changed', remarks: 'Trying to reject with deal lost reason' },
      salesAgent1
    );
    assert.strictEqual(res2.success, false, 'Property preference changed must be rejected by rejectEnquiry');
    assert.strictEqual(res2.statusCode, 400, 'Must return HTTP 400');
    assert.ok(res2.message.includes('Invalid rejection reason'));

    pass('Test 18: Deal Lost-only reasons (Pricing issue, Property preference changed) are rejected by rejectEnquiry() with HTTP 400');
  } catch (err) {
    fail('Test 18: Deal Lost-only reasons (Pricing issue, Property preference changed) are rejected by rejectEnquiry() with HTTP 400', err);
  }

  // ---------------------------------------------------------------------------
  // Test 19: Scenario 7 - Deal Lost-only reasons (Pricing issue, Property preference changed) are accepted by markDealLost()
  // ---------------------------------------------------------------------------
  try {
    const lead1Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead1Id,
      id: lead1Id.toString(),
      name: 'Deal Lost Reason Test 1',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res1 = await enquiryService.markDealLost(
      lead1Id.toString(),
      { reason: 'Pricing issue', remarks: 'Client wants discount beyond permissible threshold' },
      salesAgent1
    );
    assert.strictEqual(res1.success, true, 'Pricing issue must be accepted by markDealLost');

    const lead2Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead2Id,
      id: lead2Id.toString(),
      name: 'Deal Lost Reason Test 2',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res2 = await enquiryService.markDealLost(
      lead2Id.toString(),
      { reason: 'Property preference changed', remarks: 'Client decided to look for a commercial plot' },
      salesAgent1
    );
    assert.strictEqual(res2.success, true, 'Property preference changed must be accepted by markDealLost');

    pass('Test 19: Deal Lost-only reasons (Pricing issue, Property preference changed) are accepted by markDealLost()');
  } catch (err) {
    fail('Test 19: Deal Lost-only reasons (Pricing issue, Property preference changed) are accepted by markDealLost()', err);
  }

  // ---------------------------------------------------------------------------
  // Test 20: Scenario 8 - Rejected-only reasons (Budget too high, Location issue) are rejected by markDealLost() with HTTP 400
  // ---------------------------------------------------------------------------
  try {
    const lead1Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead1Id,
      id: lead1Id.toString(),
      name: 'Deal Lost Reject Reason 1',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res1 = await enquiryService.markDealLost(
      lead1Id.toString(),
      { reason: 'Budget too high', remarks: 'Trying to mark deal lost with reject reason' },
      salesAgent1
    );
    assert.strictEqual(res1.success, false, 'Budget too high must be rejected by markDealLost');
    assert.strictEqual(res1.statusCode, 400, 'Must return HTTP 400');
    assert.ok(res1.message.includes('Invalid deal lost reason'));

    const lead2Id = new Types.ObjectId();
    enquiryStore.push({
      _id: lead2Id,
      id: lead2Id.toString(),
      name: 'Deal Lost Reject Reason 2',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(salesAgent1.id),
    });

    const res2 = await enquiryService.markDealLost(
      lead2Id.toString(),
      { reason: 'Location issue', remarks: 'Trying to mark deal lost with reject reason' },
      salesAgent1
    );
    assert.strictEqual(res2.success, false, 'Location issue must be rejected by markDealLost');
    assert.strictEqual(res2.statusCode, 400, 'Must return HTTP 400');
    assert.ok(res2.message.includes('Invalid deal lost reason'));

    pass('Test 20: Rejected-only reasons (Budget too high, Location issue) are rejected by markDealLost() with HTTP 400');
  } catch (err) {
    fail('Test 20: Rejected-only reasons (Budget too high, Location issue) are rejected by markDealLost() with HTTP 400', err);
  }

  // ---------------------------------------------------------------------------
  // Test 21: Scenario 9 - Existing valid legacy rejection reasons (PREDEFINED_REJECTION_REASONS) remain supported by rejectEnquiry()
  // ---------------------------------------------------------------------------
  try {
    for (const legacyReason of PREDEFINED_REJECTION_REASONS) {
      const leadId = new Types.ObjectId();
      enquiryStore.push({
        _id: leadId,
        id: leadId.toString(),
        name: `Legacy Reason Lead ${legacyReason}`,
        status: 'ACTIVE',
        currentStage: 'FOLLOW_UP',
        assignedTo: new Types.ObjectId(salesAgent1.id),
      });

      const res = await enquiryService.rejectEnquiry(
        leadId.toString(),
        { reason: legacyReason, remarks: `Legacy reason verification for ${legacyReason}` },
        salesAgent1
      );
      assert.strictEqual(res.success, true, `Legacy reason "${legacyReason}" must be accepted by rejectEnquiry`);
    }

    pass('Test 21: Existing valid legacy rejection reasons (PREDEFINED_REJECTION_REASONS) remain supported by rejectEnquiry()');
  } catch (err) {
    fail('Test 21: Existing valid legacy rejection reasons (PREDEFINED_REJECTION_REASONS) remain supported by rejectEnquiry()', err);
  }

  console.log('\n====================================================');
  console.log(`REQ-36 Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
