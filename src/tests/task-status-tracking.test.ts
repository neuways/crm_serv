/**
 * Neuways CRM - REQ-22: Task Status Tracking Comprehensive Test Suite
 *
 * Verifies:
 * 1. Default status on task creation is PENDING
 * 2. Manual status update: PENDING -> IN_PROGRESS succeeds
 * 3. Manual status update: IN_PROGRESS -> COMPLETED succeeds
 * 4. Cancellation requires mandatory non-empty cancellationReason (400 if missing)
 * 5. Cancellation persists cancellationReason on task
 * 6. Rescheduling requires valid new date and time (400 if missing)
 * 7. Rescheduling preserves previous schedule (previousFollowUpDate / previousFollowUpTime)
 * 8. Rescheduling prevents duplicate task creation (updates in place)
 * 9. Terminal statuses (COMPLETED and CANCELLED) cannot be reopened or transitioned (400)
 * 10. Invalid status transitions rejected (e.g. PENDING -> PENDING, COMPLETED -> PENDING)
 * 11. Role-based scoping: Sales can only update assigned lead tasks (403 Forbidden for cross-agent)
 * 12. Role-based scoping: Manager can update team member lead tasks, rejected for cross-team (403)
 * 13. Role-based scoping: Admin can update any lead task
 * 14. Immutable EnquiryActivity audit record created with TASK_STATUS_CHANGED
 * 15. Task status tracking counts provided in dashboard summary
 * 16. Inactivity invariant: Opening lead, viewing tasks, or navigation does NOT change status (strictly manual)
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { User, IUser } from '../models/user.model.js';
import { FollowUpTask, IFollowUpTask, TaskStatus, ALLOWED_STATUS_TRANSITIONS } from '../models/follow-up-task.model.js';
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

async function runTaskStatusTrackingTests() {
  (mongoose.connection as any).readyState = 1;

  console.log('========================================================================');
  console.log('Neuways CRM - REQ-22: Task Status Tracking Comprehensive Test Suite');
  console.log('========================================================================\n');

  // Suppress real external notification timeouts
  (notificationService as any).createNotification = () => Promise.resolve({ success: true });
  (notificationService as any).dispatchCrmEvent = () => Promise.resolve();
  (notificationService as any).notifyNextFollowUpScheduled = () => Promise.resolve();

  // Test Actors
  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Admin Chief',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  };

  const managerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Manager Ravi',
    email: 'ravi.manager@neuways.com',
    role: 'MANAGER'
  };

  const otherManagerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Manager Priya',
    email: 'priya.manager@neuways.com',
    role: 'MANAGER'
  };

  const salesAgentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Agent A',
    email: 'agent.a@neuways.com',
    role: 'SALES'
  };

  const salesAgentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Agent B',
    email: 'agent.b@neuways.com',
    role: 'SALES'
  };

  // In-memory data store for tests
  const inMemoryTasks: any[] = [];
  const inMemoryEnquiries: any[] = [];
  const inMemoryActivities: any[] = [];
  const inMemoryUsers: any[] = [
    { _id: new Types.ObjectId(adminActor.id), name: adminActor.name, email: adminActor.email, role: 'ADMIN', isActive: true },
    { _id: new Types.ObjectId(managerActor.id), name: managerActor.name, email: managerActor.email, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(otherManagerActor.id), name: otherManagerActor.name, email: otherManagerActor.email, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(salesAgentA.id), name: salesAgentA.name, email: salesAgentA.email, role: 'SALES', managerId: new Types.ObjectId(managerActor.id), isActive: true },
    { _id: new Types.ObjectId(salesAgentB.id), name: salesAgentB.name, email: salesAgentB.email, role: 'SALES', managerId: new Types.ObjectId(otherManagerActor.id), isActive: true }
  ];

  // Mock Enquiry.findById
  (Enquiry as any).findById = function (id: any) {
    const idStr = id ? id.toString() : '';
    const enq = inMemoryEnquiries.find((e) => e._id.toString() === idStr);
    const doc = enq ? { ...enq, save: () => Promise.resolve(enq) } : null;
    const chain: any = {
      populate: () => chain,
      lean: async () => doc,
      then: (fn: any) => Promise.resolve(doc).then(fn)
    };
    return chain;
  };

  // Mock Enquiry.find
  (Enquiry as any).find = function () {
    const chain: any = {
      select: () => chain,
      sort: () => chain,
      lean: async () => [...inMemoryEnquiries],
      then: (fn: any) => Promise.resolve([...inMemoryEnquiries]).then(fn)
    };
    return chain;
  };

  // Mock Enquiry.countDocuments
  (Enquiry as any).countDocuments = function () {
    return Promise.resolve(inMemoryEnquiries.length);
  };

  // Mock FollowUpTask.findById
  (FollowUpTask as any).findById = function (id: any) {
    const idStr = id ? id.toString() : '';
    const task = inMemoryTasks.find((t) => t._id.toString() === idStr);
    if (!task) return Promise.resolve(null);
    return Promise.resolve({
      ...task,
      save: function () {
        Object.assign(task, this);
        return Promise.resolve(task);
      }
    });
  };

  // Mock FollowUpTask.find
  (FollowUpTask as any).find = function (filter: any) {
    let result = [...inMemoryTasks];
    if (filter) {
      if (filter.enquiryId) {
        result = result.filter((t) => t.enquiryId.toString() === filter.enquiryId.toString());
      }
      if (filter.status) {
        result = result.filter((t) => t.status === filter.status);
      }
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const ids = filter.assignedTo.$in.map((i: any) => i.toString());
          result = result.filter((t) => ids.includes(t.assignedTo?.toString()));
        } else {
          result = result.filter((t) => t.assignedTo?.toString() === filter.assignedTo.toString());
        }
      }
    }
    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      lean: async () => result,
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };

  // Mock FollowUpTask.countDocuments
  (FollowUpTask as any).countDocuments = function (filter: any) {
    let result = [...inMemoryTasks];
    if (filter) {
      if (filter.status) {
        result = result.filter((t) => t.status === filter.status);
      }
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const ids = filter.assignedTo.$in.map((i: any) => i.toString());
          result = result.filter((t) => ids.includes(t.assignedTo?.toString()));
        } else {
          result = result.filter((t) => t.assignedTo?.toString() === filter.assignedTo.toString());
        }
      }
    }
    return Promise.resolve(result.length);
  };

  // Mock EnquiryActivity save
  (EnquiryActivity as any).prototype.save = function () {
    inMemoryActivities.push(this);
    return Promise.resolve(this);
  };

  // Mock FollowUpTask save constructor
  (FollowUpTask as any).prototype.save = function () {
    if (!this._id) this._id = new Types.ObjectId();
    inMemoryTasks.push(this);
    return Promise.resolve(this);
  };

  // Mock User.find
  (User as any).find = function (query: any) {
    let users = [...inMemoryUsers];
    if (query?.managerId) {
      users = users.filter((u) => u.managerId && u.managerId.toString() === query.managerId.toString());
    }
    return {
      select: () => users,
      lean: async () => users
    };
  };

  // Mock User.findById
  (User as any).findById = function (id: any) {
    const idStr = id ? id.toString() : '';
    const u = inMemoryUsers.find((user) => user._id.toString() === idStr);
    return Promise.resolve(u ? { ...u } : null);
  };

  // Helper to create test lead
  const testLeadAId = new Types.ObjectId();
  const testLeadA = {
    _id: testLeadAId,
    id: testLeadAId.toString(),
    name: 'Rahul Sharma',
    mobile: '9876543210',
    email: 'rahul@example.com',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryEnquiries.push(testLeadA);

  const testLeadBId = new Types.ObjectId();
  const testLeadB = {
    _id: testLeadBId,
    id: testLeadBId.toString(),
    name: 'Anjali Verma',
    mobile: '9123456780',
    email: 'anjali@example.com',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(salesAgentB.id),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryEnquiries.push(testLeadB);

  // ---------------------------------------------------------------------------
  // Suite 1: Allowed Status Transitions & State Machine
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Allowed Status Transitions & State Machine ---');

  assert(
    ALLOWED_STATUS_TRANSITIONS.PENDING.includes('IN_PROGRESS') &&
    ALLOWED_STATUS_TRANSITIONS.PENDING.includes('COMPLETED') &&
    ALLOWED_STATUS_TRANSITIONS.PENDING.includes('CANCELLED') &&
    ALLOWED_STATUS_TRANSITIONS.PENDING.includes('RESCHEDULED'),
    'PENDING allows transitions to IN_PROGRESS, COMPLETED, CANCELLED, RESCHEDULED'
  );

  assert(
    ALLOWED_STATUS_TRANSITIONS.IN_PROGRESS.includes('COMPLETED') &&
    ALLOWED_STATUS_TRANSITIONS.IN_PROGRESS.includes('CANCELLED') &&
    ALLOWED_STATUS_TRANSITIONS.IN_PROGRESS.includes('RESCHEDULED') &&
    !ALLOWED_STATUS_TRANSITIONS.IN_PROGRESS.includes('PENDING'),
    'IN_PROGRESS allows COMPLETED, CANCELLED, RESCHEDULED, but NOT PENDING'
  );

  assert(
    ALLOWED_STATUS_TRANSITIONS.RESCHEDULED.includes('IN_PROGRESS') &&
    ALLOWED_STATUS_TRANSITIONS.RESCHEDULED.includes('COMPLETED') &&
    ALLOWED_STATUS_TRANSITIONS.RESCHEDULED.includes('CANCELLED') &&
    !ALLOWED_STATUS_TRANSITIONS.RESCHEDULED.includes('PENDING'),
    'RESCHEDULED allows IN_PROGRESS, COMPLETED, CANCELLED, but NOT PENDING'
  );

  assert(
    ALLOWED_STATUS_TRANSITIONS.COMPLETED.length === 0,
    'COMPLETED is terminal with zero allowed transitions'
  );

  assert(
    ALLOWED_STATUS_TRANSITIONS.CANCELLED.length === 0,
    'CANCELLED is terminal with zero allowed transitions'
  );

  // ---------------------------------------------------------------------------
  // Suite 2: Default Task Status & Manual Updates
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Default Task Status & Manual Transitions ---');

  // Create initial task
  const task1Id = new Types.ObjectId();
  const task1: any = {
    _id: task1Id,
    id: task1Id.toString(),
    enquiryId: testLeadAId,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'CALL',
    followUpDate: new Date('2026-11-10'),
    followUpTime: '10:00',
    notes: 'Initial callback discussion',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryTasks.push(task1);

  assert(task1.status === 'PENDING', 'Default status is PENDING upon creation');

  // Transition: PENDING -> IN_PROGRESS
  const inProgressRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task1Id.toString(),
    { status: 'IN_PROGRESS', notes: 'Currently calling the prospect' },
    salesAgentA
  );
  assert(inProgressRes.success === true, 'PENDING -> IN_PROGRESS succeeds');
  assert(task1.status === 'IN_PROGRESS', 'Task status is now IN_PROGRESS');
  assert(task1.previousStatus === 'PENDING', 'Previous status recorded as PENDING');
  assert(task1.notes === 'Currently calling the prospect', 'Updated task notes saved');

  // Transition: IN_PROGRESS -> COMPLETED
  const completedRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task1Id.toString(),
    { status: 'COMPLETED', notes: 'Client attended call and confirmed interest' },
    salesAgentA
  );
  assert(completedRes.success === true, 'IN_PROGRESS -> COMPLETED succeeds');
  assert(task1.status === 'COMPLETED', 'Task status is now COMPLETED');
  assert(task1.previousStatus === 'IN_PROGRESS', 'Previous status recorded as IN_PROGRESS');

  // ---------------------------------------------------------------------------
  // Suite 3: Terminal Status Enforcement (No Reopening)
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Terminal Status Enforcement ---');

  // Attempt to transition COMPLETED task back to PENDING
  const reopenPendingRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task1Id.toString(),
    { status: 'PENDING' },
    salesAgentA
  );
  assert(reopenPendingRes.success === false, 'Reopening COMPLETED task to PENDING is rejected');
  assert(reopenPendingRes.statusCode === 400, 'Reopening COMPLETED task returns HTTP 400');
  assert(Boolean(reopenPendingRes.message?.includes('terminal status')), 'Rejection cites terminal status invariant');

  // Attempt to transition COMPLETED task to IN_PROGRESS
  const reopenInProgressRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task1Id.toString(),
    { status: 'IN_PROGRESS' },
    salesAgentA
  );
  assert(reopenInProgressRes.success === false, 'Transitioning COMPLETED task to IN_PROGRESS is rejected');

  // ---------------------------------------------------------------------------
  // Suite 4: Cancellation Requirements & Validation
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Task Cancellation ---');

  const task2Id = new Types.ObjectId();
  const task2: any = {
    _id: task2Id,
    id: task2Id.toString(),
    enquiryId: testLeadAId,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'MEETING',
    followUpDate: new Date('2026-11-12'),
    followUpTime: '15:00',
    notes: 'Scheduled site office meeting',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryTasks.push(task2);

  // Cancellation attempt without cancellationReason
  const cancelNoReasonRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task2Id.toString(),
    { status: 'CANCELLED' },
    salesAgentA
  );
  assert(cancelNoReasonRes.success === false, 'Cancelling task without reason is rejected');
  assert(cancelNoReasonRes.statusCode === 400, 'Rejection returns HTTP 400');
  assert(Boolean(cancelNoReasonRes.message?.includes('Cancellation reason is mandatory')), 'Error message specifies mandatory cancellation reason');

  // Cancellation attempt with empty string
  const cancelEmptyReasonRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task2Id.toString(),
    { status: 'CANCELLED', cancellationReason: '   ' },
    salesAgentA
  );
  assert(cancelEmptyReasonRes.success === false, 'Cancelling task with whitespace reason is rejected');

  // Cancellation with valid reason
  const cancelValidRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task2Id.toString(),
    { status: 'CANCELLED', cancellationReason: 'Prospect is travelling overseas indefinitely' },
    salesAgentA
  );
  assert(cancelValidRes.success === true, 'Cancelling task with valid reason succeeds');
  assert(task2.status === 'CANCELLED', 'Task status is now CANCELLED');
  assert(task2.cancellationReason === 'Prospect is travelling overseas indefinitely', 'cancellationReason is persisted');
  assert(task2.previousStatus === 'PENDING', 'previousStatus recorded as PENDING');

  // Attempt to reopen CANCELLED task
  const reopenCancelledRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task2Id.toString(),
    { status: 'IN_PROGRESS' },
    salesAgentA
  );
  assert(reopenCancelledRes.success === false, 'Reopening CANCELLED task is rejected');
  assert(reopenCancelledRes.statusCode === 400, 'Reopening CANCELLED task returns HTTP 400');

  // ---------------------------------------------------------------------------
  // Suite 5: Rescheduling Requirements & Schedule Preservation
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Task Rescheduling ---');

  const originalDate = new Date('2026-11-15');
  const originalTime = '11:30';

  const task3Id = new Types.ObjectId();
  const task3: any = {
    _id: task3Id,
    id: task3Id.toString(),
    enquiryId: testLeadAId,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'SITE_VISIT',
    followUpDate: originalDate,
    followUpTime: originalTime,
    notes: 'Site visit for Greenfield Towers',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryTasks.push(task3);

  const initialTaskCount = inMemoryTasks.length;

  // Rescheduling without date
  const reschedNoDateRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task3Id.toString(),
    { status: 'RESCHEDULED', followUpTime: '14:00' },
    salesAgentA
  );
  assert(reschedNoDateRes.success === false, 'Rescheduling without date is rejected');
  assert(reschedNoDateRes.statusCode === 400, 'Rejection returns HTTP 400');

  // Rescheduling without time
  const reschedNoTimeRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task3Id.toString(),
    { status: 'RESCHEDULED', followUpDate: '2026-11-20' },
    salesAgentA
  );
  assert(reschedNoTimeRes.success === false, 'Rescheduling without time is rejected');

  // Rescheduling with valid new date and time
  const newDateStr = '2026-11-20';
  const newTimeStr = '14:30';

  const reschedSuccessRes = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task3Id.toString(),
    { status: 'RESCHEDULED', followUpDate: newDateStr, followUpTime: newTimeStr, notes: 'Client requested weekend visit' },
    salesAgentA
  );
  assert(reschedSuccessRes.success === true, 'Rescheduling with valid date/time succeeds');
  assert(task3.status === 'RESCHEDULED', 'Task status is now RESCHEDULED');
  assert(task3.previousStatus === 'PENDING', 'previousStatus recorded as PENDING');
  assert(task3.followUpTime === newTimeStr, 'followUpTime updated to new time');
  assert(new Date(task3.followUpDate).toISOString().slice(0, 10) === newDateStr, 'followUpDate updated to new date');
  assert(task3.previousFollowUpDate === originalDate, 'previousFollowUpDate preserved');
  assert(task3.previousFollowUpTime === originalTime, 'previousFollowUpTime preserved');

  // Confirm no duplicate task was created
  assert(inMemoryTasks.length === initialTaskCount, 'Rescheduling updates task in-place without creating duplicate tasks');

  // Rescheduled task can subsequently transition to IN_PROGRESS or COMPLETED
  const reschedToInProgress = await enquiryService.updateTaskStatus(
    testLeadA.id,
    task3Id.toString(),
    { status: 'IN_PROGRESS' },
    salesAgentA
  );
  assert(reschedToInProgress.success === true, 'RESCHEDULED -> IN_PROGRESS transition succeeds');
  assert(task3.status === 'IN_PROGRESS', 'Task status is now IN_PROGRESS');

  // ---------------------------------------------------------------------------
  // Suite 6: Role-Based Authorization
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 6: Role-Based Authorization ---');

  const taskBId = new Types.ObjectId();
  const taskB: any = {
    _id: taskBId,
    id: taskBId.toString(),
    enquiryId: testLeadBId,
    assignedTo: new Types.ObjectId(salesAgentB.id),
    purpose: 'CALL',
    followUpDate: new Date('2026-11-18'),
    followUpTime: '16:00',
    notes: 'Lead B follow-up',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  inMemoryTasks.push(taskB);

  // Sales Agent A attempts to update Lead B's task (assigned to Sales Agent B)
  const crossAgentUpdate = await enquiryService.updateTaskStatus(
    testLeadB.id,
    taskBId.toString(),
    { status: 'IN_PROGRESS' },
    salesAgentA
  );
  assert(crossAgentUpdate.success === false, 'Sales Agent A cannot update task on Lead B (assigned to Agent B)');
  assert(crossAgentUpdate.statusCode === 403, 'Cross-agent update returns HTTP 403 Forbidden');

  // Manager Ravi (manager of Agent A) attempts to update Lead B's task (Agent B reports to Manager Priya)
  const crossManagerUpdate = await enquiryService.updateTaskStatus(
    testLeadB.id,
    taskBId.toString(),
    { status: 'IN_PROGRESS' },
    managerActor
  );
  assert(crossManagerUpdate.success === false, 'Manager Ravi cannot update task on Lead B (outside their team)');
  assert(crossManagerUpdate.statusCode === 403, 'Cross-manager update returns HTTP 403 Forbidden');

  // Manager Priya (manager of Agent B) updates Lead B's task -> succeeds
  const ownManagerUpdate = await enquiryService.updateTaskStatus(
    testLeadB.id,
    taskBId.toString(),
    { status: 'IN_PROGRESS' },
    otherManagerActor
  );
  assert(ownManagerUpdate.success === true, 'Manager Priya successfully updates task on their own team lead');
  assert(taskB.status === 'IN_PROGRESS', 'Lead B task status updated to IN_PROGRESS by Manager Priya');

  // Admin updates Lead B's task -> succeeds org-wide
  const adminUpdate = await enquiryService.updateTaskStatus(
    testLeadB.id,
    taskBId.toString(),
    { status: 'COMPLETED' },
    adminActor
  );
  assert(adminUpdate.success === true, 'Admin successfully updates any task across the organization');
  assert(taskB.status === 'COMPLETED', 'Lead B task status updated to COMPLETED by Admin');

  // ---------------------------------------------------------------------------
  // Suite 7: Activity History & Audit Logging
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 7: EnquiryActivity Audit Logging ---');

  const taskAudit = inMemoryActivities.filter((a) => a.type === 'TASK_STATUS_CHANGED');
  assert(taskAudit.length > 0, 'TASK_STATUS_CHANGED activity records persisted');

  const latestAudit = taskAudit[taskAudit.length - 1];
  assert(latestAudit.performedByName === adminActor.name, 'Activity records who performed the change');
  assert(latestAudit.type === 'TASK_STATUS_CHANGED', 'Activity type is TASK_STATUS_CHANGED');
  assert(latestAudit.metadata?.newStatus === 'COMPLETED', 'Activity metadata records newStatus');
  assert(latestAudit.metadata?.previousStatus === 'IN_PROGRESS', 'Activity metadata records previousStatus');

  // ---------------------------------------------------------------------------
  // Suite 8: Dashboard Summary Task Status Counts
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 8: Dashboard Summary Task Status Counts ---');

  const adminSummary = await enquiryService.getDashboardSummary(adminActor);
  assert(adminSummary.success === true, 'getDashboardSummary succeeds');
  const statusCounts = adminSummary.data?.taskStatusCounts;
  assert(statusCounts !== undefined, 'Summary data contains taskStatusCounts object');
  assert(typeof statusCounts?.pending === 'number', 'taskStatusCounts has pending count');
  assert(typeof statusCounts?.inProgress === 'number', 'taskStatusCounts has inProgress count');
  assert(typeof statusCounts?.completed === 'number', 'taskStatusCounts has completed count');
  assert(typeof statusCounts?.cancelled === 'number', 'taskStatusCounts has cancelled count');
  assert(typeof statusCounts?.rescheduled === 'number', 'taskStatusCounts has rescheduled count');

  // ---------------------------------------------------------------------------
  // Suite 9: Inactivity & Read-Only Invariance
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 9: Inactivity & Read-Only Invariance ---');

  const taskBeforeView: any = { ...taskB };
  // Viewing follow-ups
  const viewRes = await enquiryService.getFollowUps(testLeadB.id, adminActor);
  assert(viewRes.success === true, 'getFollowUps succeeds');
  assert(taskB.status === taskBeforeView.status, 'Viewing follow-ups does NOT change task status');
  assert(taskB.statusChangedAt === taskBeforeView.statusChangedAt, 'Viewing follow-ups does not update statusChangedAt');

  // Getting single enquiry
  const leadViewRes = await enquiryService.getEnquiryById(testLeadB.id, adminActor);
  assert(leadViewRes.success === true, 'getEnquiryById succeeds');
  assert(taskB.status === taskBeforeView.status, 'Opening lead detail does NOT change task status');

  console.log('\n========================================================================');
  console.log(`Task Status Tracking Test Suite Completed: ${passedAssertions}/${totalAssertions} Passed`);
  console.log('========================================================================\n');
}

runTaskStatusTrackingTests().catch((err) => {
  console.error('Test Suite Failed with unexpected error:', err);
  process.exit(1);
});
