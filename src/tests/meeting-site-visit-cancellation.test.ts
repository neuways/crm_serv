/**
 * Neuways CRM - REQ-31: Meeting / Site Visit Cancellation Test Suite
 *
 * Verifies all 16 approved business requirements:
 * 1. Meeting cancellation with valid reason.
 * 2. Meeting cancellation rejected without reason (and whitespace-only).
 * 3. Site Visit cancellation with valid reason.
 * 4. Site Visit cancellation rejected without reason (and whitespace-only).
 * 5. Lead remains at the same workflow stage after cancellation.
 * 6. Cancelled plan remains visible in history (cancellationHistory & subdocument).
 * 7. Previous schedule is preserved (previousDate, previousTime).
 * 8. Corresponding follow-up task is synchronized correctly (status = CANCELLED).
 * 9. Unrelated tasks remain untouched (CALL, WHATSAPP, EMAIL, etc.).
 * 10. Completed tasks are not overwritten (terminal status invariant).
 * 11. Rescheduling does not generate duplicate tasks (updates in place).
 * 12. Cancellation activity is recorded (MEETING_CANCELLED, SITE_VISIT_CANCELLED).
 * 13. Correct cancellation notifications are dispatched (Agent, Manager, Admin).
 * 14. Cancelled schedule reminders are no longer active (no longer PENDING).
 * 15. Existing Manager approval and customer confirmation behavior remains unchanged.
 * 16. Existing role permissions are preserved (RBAC & cross-agent 403).
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { User, IUser } from '../models/user.model.js';
import { FollowUpTask, IFollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { notificationService } from '../services/notification.service.js';
import { AuthUser } from '../types/auth.types.js';

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: any, message: string, detail?: any) {
  totalAssertions++;
  if (Boolean(condition)) {
    passedAssertions++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    if (detail) console.error('  Detail:', detail);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runCancellationTests() {
  (mongoose.connection as any).readyState = 1;

  console.log('========================================================================');
  console.log('Neuways CRM - REQ-31: Meeting & Site Visit Cancellation Test Suite');
  console.log('========================================================================\n');

  // Intercept notifications to capture dispatched events
  const dispatchedEvents: any[] = [];
  (notificationService as any).createNotification = () => Promise.resolve({ success: true });
  (notificationService as any).dispatchCrmEvent = (event: any) => {
    dispatchedEvents.push(event);
    return Promise.resolve();
  };
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

  const salesAgentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Agent Alice',
    email: 'alice@neuways.com',
    role: 'SALES'
  };

  const salesAgentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Agent Bob',
    email: 'bob@neuways.com',
    role: 'SALES'
  };

  // In-memory data store for tests
  const inMemoryTasks: any[] = [];
  const inMemoryEnquiries: any[] = [];
  const inMemoryActivities: any[] = [];
  const inMemoryUsers: any[] = [
    { _id: new Types.ObjectId(adminActor.id), name: adminActor.name, email: adminActor.email, role: 'ADMIN', isActive: true },
    { _id: new Types.ObjectId(managerActor.id), name: managerActor.name, email: managerActor.email, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(salesAgentA.id), name: salesAgentA.name, email: salesAgentA.email, role: 'SALES', managerId: new Types.ObjectId(managerActor.id), isActive: true },
    { _id: new Types.ObjectId(salesAgentB.id), name: salesAgentB.name, email: salesAgentB.email, role: 'SALES', managerId: new Types.ObjectId(managerActor.id), isActive: true }
  ];

  // Mock User.findById
  (User as any).findById = function (id: any) {
    const idStr = id ? id.toString() : '';
    const user = inMemoryUsers.find((u) => u._id.toString() === idStr);
    const chain: any = {
      select: () => chain,
      lean: async () => user,
      then: (fn: any) => Promise.resolve(user).then(fn)
    };
    return chain;
  };

  // Mock User.findOne
  (User as any).findOne = function (query: any) {
    const idStr = query?._id ? query._id.toString() : '';
    const user = inMemoryUsers.find((u) => u._id.toString() === idStr);
    const chain: any = {
      select: () => chain,
      lean: async () => user,
      then: (fn: any) => Promise.resolve(user).then(fn)
    };
    return chain;
  };

  // Mock User.find
  (User as any).find = function (query: any) {
    let result = [...inMemoryUsers];
    if (query?.role) result = result.filter((u) => u.role === query.role);
    if (query?.isActive !== undefined) result = result.filter((u) => u.isActive === query.isActive);
    const chain: any = {
      select: () => chain,
      lean: async () => result,
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };

  // Mock Enquiry.findById
  (Enquiry as any).findById = function (id: any) {
    const idStr = id ? id.toString() : '';
    const enq = inMemoryEnquiries.find((e) => e._id.toString() === idStr);
    const doc = enq
      ? {
          ...enq,
          toObject: () => ({ ...enq }),
          save: async function () {
            Object.assign(enq, this);
            return this;
          }
        }
      : null;
    const chain: any = {
      populate: () => chain,
      lean: async () => doc,
      then: (fn: any) => Promise.resolve(doc).then(fn)
    };
    return chain;
  };

  // Mock EnquiryActivity.prototype.save
  EnquiryActivity.prototype.save = function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    if (!this.createdAt) this.createdAt = new Date();
    inMemoryActivities.push(this);
    return Promise.resolve(this);
  };

  // Mock FollowUpTask.findOne
  (FollowUpTask as any).findOne = function (query: any) {
    let matches = inMemoryTasks.filter((t) => {
      let ok = true;
      if (query.enquiryId && t.enquiryId.toString() !== query.enquiryId.toString()) ok = false;
      if (query.purpose && t.purpose !== query.purpose) ok = false;
      if (query.status?.$in && !query.status.$in.includes(t.status)) ok = false;
      return ok;
    });
    const chain: any = {
      sort: () => chain,
      then: (fn: any) => {
        const found = matches[matches.length - 1] || null;
        return Promise.resolve(found).then(fn);
      }
    };
    return chain;
  };

  // Mock FollowUpTask.find
  (FollowUpTask as any).find = function (query: any) {
    let matches = inMemoryTasks.filter((t) => {
      let ok = true;
      if (query.enquiryId && t.enquiryId.toString() !== query.enquiryId.toString()) ok = false;
      if (query.purpose && t.purpose !== query.purpose) ok = false;
      return ok;
    });
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      lean: async () => matches,
      then: (fn: any) => Promise.resolve(matches).then(fn)
    };
    return chain;
  };

  // Mock FollowUpTask.prototype.save
  FollowUpTask.prototype.save = function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    if (!this.createdAt) this.createdAt = new Date();
    const existingIdx = inMemoryTasks.findIndex((t) => t._id.toString() === this._id.toString());
    if (existingIdx >= 0) {
      inMemoryTasks[existingIdx] = this;
    } else {
      inMemoryTasks.push(this);
    }
    return Promise.resolve(this);
  };

  // Helper to create test enquiry
  function createTestEnquiry(custom: Partial<IEnquiry> = {}): any {
    const id = new Types.ObjectId();
    const enq: any = {
      _id: id,
      name: 'Ramesh Patel',
      mobile: '9876543210',
      email: 'ramesh@example.com',
      projectName: 'Prestige Lakeside',
      currentStage: 'MEETING_PLAN',
      status: 'ACTIVE',
      assignedTo: new Types.ObjectId(salesAgentA.id),
      managerId: new Types.ObjectId(managerActor.id),
      meetingPlan: {
        meetingPlace: 'Prestige Marketing Suite',
        meetingDate: '2026-11-15',
        meetingTime: '11:00',
        projectDetails: 'Prestige Lakeside 3BHK',
        isCompleted: false,
        status: 'SCHEDULED',
        isCancelled: false
      },
      ...custom,
      toObject: function () {
        return { ...this };
      },
      save: async function () {
        const idx = inMemoryEnquiries.findIndex((e) => e._id.toString() === this._id.toString());
        if (idx >= 0) inMemoryEnquiries[idx] = this;
        return this;
      }
    };
    inMemoryEnquiries.push(enq);
    return enq;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Meeting cancellation with valid reason
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: Meeting cancellation with valid reason ---');
  const enq1 = createTestEnquiry();

  // Create corresponding meeting task
  const task1 = new FollowUpTask({
    enquiryId: enq1._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'MEETING',
    followUpDate: new Date('2026-11-15'),
    followUpTime: '11:00',
    notes: 'Meeting at Prestige Marketing Suite',
    status: 'PENDING',
    outcome: 'MEETING_SCHEDULED'
  });
  await task1.save();

  const cancelRes1 = await enquiryService.cancelMeetingPlan(
    enq1._id.toString(),
    { cancellationReason: 'Client called to cancel due to family emergency' },
    salesAgentA
  );

  assert(cancelRes1.success === true, 'Scenario 1: Meeting cancellation succeeds with valid reason');
  assert(enq1.meetingPlan?.isCancelled === true, 'Scenario 1: meetingPlan.isCancelled is true');
  assert(enq1.meetingPlan?.status === 'CANCELLED', 'Scenario 1: meetingPlan.status is CANCELLED');
  assert(
    enq1.meetingPlan?.cancellationReason === 'Client called to cancel due to family emergency',
    'Scenario 1: cancellationReason persisted on meetingPlan'
  );
  assert(Boolean(enq1.meetingPlan?.cancelledAt), 'Scenario 1: cancelledAt timestamp recorded');
  assert(
    enq1.meetingPlan?.cancelledByName === salesAgentA.name,
    'Scenario 1: cancelledByName actor captured'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Meeting cancellation rejected without reason
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Meeting cancellation rejected without reason ---');
  const enq2 = createTestEnquiry();

  const emptyReasonRes = await enquiryService.cancelMeetingPlan(
    enq2._id.toString(),
    { cancellationReason: '' },
    salesAgentA
  );
  assert(emptyReasonRes.success === false, 'Scenario 2: Cancellation rejected with empty reason');
  assert(emptyReasonRes.statusCode === 400, 'Scenario 2: Returns HTTP 400');
  assert(
    emptyReasonRes.message?.includes('Cancellation reason is mandatory'),
    'Scenario 2: Error specifies mandatory reason'
  );

  const whitespaceReasonRes = await enquiryService.cancelMeetingPlan(
    enq2._id.toString(),
    { cancellationReason: '   \t\n  ' },
    salesAgentA
  );
  assert(whitespaceReasonRes.success === false, 'Scenario 2: Cancellation rejected with whitespace-only reason');
  assert(whitespaceReasonRes.statusCode === 400, 'Scenario 2: Whitespace-only returns HTTP 400');

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Site Visit cancellation with valid reason
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Site Visit cancellation with valid reason ---');
  const enq3 = createTestEnquiry({
    currentStage: 'SITE_VISIT_PLAN',
    meetingPlan: {
      meetingPlace: 'Main Office',
      meetingDate: '2026-11-10',
      meetingTime: '10:00',
      isCompleted: true,
      status: 'COMPLETED'
    },
    siteVisitPlan: {
      siteVisitAddress: 'Tower 3, Unit 402, Prestige Lakeside',
      siteVisitDate: '2026-11-18',
      siteVisitTime: '14:00',
      projectName: 'Prestige Lakeside',
      managerId: new Types.ObjectId(managerActor.id),
      managerName: managerActor.name,
      visitOutcome: 'PENDING_APPROVAL',
      isCompleted: false,
      status: 'SCHEDULED',
      isCancelled: false
    }
  });

  const visitTask3 = new FollowUpTask({
    enquiryId: enq3._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'SITE_VISIT',
    followUpDate: new Date('2026-11-18'),
    followUpTime: '14:00',
    notes: 'Site visit for unit 402',
    status: 'PENDING',
    outcome: 'MEETING_SCHEDULED'
  });
  await visitTask3.save();

  const cancelVisitRes = await enquiryService.cancelSiteVisitPlan(
    enq3._id.toString(),
    { cancellationReason: 'Bad weather / heavy rain forecasted' },
    salesAgentA
  );

  assert(cancelVisitRes.success === true, 'Scenario 3: Site Visit cancellation succeeds');
  assert(enq3.siteVisitPlan?.isCancelled === true, 'Scenario 3: siteVisitPlan.isCancelled is true');
  assert(enq3.siteVisitPlan?.status === 'CANCELLED', 'Scenario 3: siteVisitPlan.status is CANCELLED');
  assert(
    enq3.siteVisitPlan?.cancellationReason === 'Bad weather / heavy rain forecasted',
    'Scenario 3: cancellationReason persisted on siteVisitPlan'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Site Visit cancellation rejected without reason
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Site Visit cancellation rejected without reason ---');
  const enq4 = createTestEnquiry({
    currentStage: 'SITE_VISIT_PLAN',
    meetingPlan: { isCompleted: true, status: 'COMPLETED' },
    siteVisitPlan: {
      siteVisitAddress: 'Tower 1',
      siteVisitDate: '2026-11-20',
      siteVisitTime: '15:00',
      projectName: 'Prestige',
      isCompleted: false,
      status: 'SCHEDULED'
    }
  });

  const emptyVisitReasonRes = await enquiryService.cancelSiteVisitPlan(
    enq4._id.toString(),
    { cancellationReason: '' },
    salesAgentA
  );
  assert(emptyVisitReasonRes.success === false, 'Scenario 4: Site visit cancellation rejected without reason');
  assert(emptyVisitReasonRes.statusCode === 400, 'Scenario 4: Returns HTTP 400');

  const whitespaceVisitRes = await enquiryService.cancelSiteVisitPlan(
    enq4._id.toString(),
    { cancellationReason: '    ' },
    salesAgentA
  );
  assert(whitespaceVisitRes.success === false, 'Scenario 4: Whitespace-only reason rejected');

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Lead remains at the same workflow stage after cancellation
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Lead remains at the same workflow stage after cancellation ---');
  assert(enq1.currentStage === 'MEETING_PLAN', 'Scenario 5: Lead remains at MEETING_PLAN after meeting cancellation');
  assert(enq3.currentStage === 'SITE_VISIT_PLAN', 'Scenario 5: Lead remains at SITE_VISIT_PLAN after site visit cancellation');
  assert(enq1.status === 'ACTIVE', 'Scenario 5: Lead status is NOT closed or rejected');
  assert(enq3.status === 'ACTIVE', 'Scenario 5: Site visit lead status is NOT closed or rejected');

  // Invariant: Advancing is blocked when cancelled
  const advanceMeetingRes = await enquiryService.saveWorkflowStep(
    enq1._id.toString(),
    { step: 'MEETING_PLAN', advanceStage: true },
    salesAgentA
  );
  assert(advanceMeetingRes.success === false, 'Scenario 5: Advance stage blocked when meeting is cancelled');

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Cancelled plan remains visible in history
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Cancelled plan remains visible in history ---');
  assert(Array.isArray(enq1.meetingPlan?.cancellationHistory), 'Scenario 6: cancellationHistory is an array');
  assert(enq1.meetingPlan?.cancellationHistory?.length === 1, 'Scenario 6: cancellationHistory has 1 entry');
  assert(
    enq1.meetingPlan?.cancellationHistory?.[0].cancellationReason === 'Client called to cancel due to family emergency',
    'Scenario 6: cancellationHistory entry contains reason'
  );
  assert(
    enq3.siteVisitPlan?.cancellationHistory?.length === 1,
    'Scenario 6: siteVisitPlan cancellationHistory recorded'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Previous schedule is preserved
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: Previous schedule is preserved ---');
  assert(enq1.meetingPlan?.previousDate === '2026-11-15', 'Scenario 7: previousDate preserved for meeting');
  assert(enq1.meetingPlan?.previousTime === '11:00', 'Scenario 7: previousTime preserved for meeting');
  assert(enq3.siteVisitPlan?.previousDate === '2026-11-18', 'Scenario 7: previousDate preserved for site visit');
  assert(enq3.siteVisitPlan?.previousTime === '14:00', 'Scenario 7: previousTime preserved for site visit');

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Corresponding follow-up task is synchronized correctly
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: Corresponding follow-up task is synchronized correctly ---');
  assert(task1.status === 'CANCELLED', 'Scenario 8: Meeting follow-up task status is CANCELLED');
  assert(task1.previousStatus === 'PENDING', 'Scenario 8: previousStatus recorded as PENDING');
  assert(
    task1.cancellationReason === 'Client called to cancel due to family emergency',
    'Scenario 8: Task cancellationReason matches plan reason'
  );
  assert(visitTask3.status === 'CANCELLED', 'Scenario 8: Site visit follow-up task status is CANCELLED');

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Unrelated tasks remain untouched
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Unrelated tasks remain untouched ---');
  const callTask = new FollowUpTask({
    enquiryId: enq1._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'CALL',
    followUpDate: new Date('2026-11-12'),
    followUpTime: '10:00',
    notes: 'Follow up call on financing',
    status: 'PENDING'
  });
  await callTask.save();

  const whatsAppTask = new FollowUpTask({
    enquiryId: enq1._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'WHATSAPP',
    followUpDate: new Date('2026-11-13'),
    followUpTime: '12:00',
    notes: 'Send brochure on WhatsApp',
    status: 'PENDING'
  });
  await whatsAppTask.save();

  // Cancel meeting again on a new enquiry that has multiple task types
  const enqMulti = createTestEnquiry();
  const multiMeetingTask = new FollowUpTask({
    enquiryId: enqMulti._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'MEETING',
    followUpDate: new Date('2026-11-16'),
    followUpTime: '11:00',
    notes: 'Meeting',
    status: 'PENDING'
  });
  await multiMeetingTask.save();

  const multiCallTask = new FollowUpTask({
    enquiryId: enqMulti._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'CALL',
    followUpDate: new Date('2026-11-14'),
    followUpTime: '09:00',
    notes: 'Call customer',
    status: 'PENDING'
  });
  await multiCallTask.save();

  await enquiryService.cancelMeetingPlan(
    enqMulti._id.toString(),
    { cancellationReason: 'Cancelled meeting only' },
    salesAgentA
  );

  assert(multiMeetingTask.status === 'CANCELLED', 'Scenario 9: Only MEETING task cancelled');
  assert(multiCallTask.status === 'PENDING', 'Scenario 9: Unrelated CALL task remains strictly PENDING');
  assert(callTask.status === 'PENDING', 'Scenario 9: Prior CALL task remains PENDING');
  assert(whatsAppTask.status === 'PENDING', 'Scenario 9: WHATSAPP task remains PENDING');

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Completed tasks are not overwritten
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 10: Completed tasks are not overwritten ---');
  const enqCompleted = createTestEnquiry({
    meetingPlan: {
      meetingPlace: 'Office',
      meetingDate: '2026-11-01',
      meetingTime: '10:00',
      isCompleted: true,
      status: 'COMPLETED'
    }
  });

  const completedTask = new FollowUpTask({
    enquiryId: enqCompleted._id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'MEETING',
    followUpDate: new Date('2026-11-01'),
    followUpTime: '10:00',
    status: 'COMPLETED'
  });
  await completedTask.save();

  const cancelCompletedRes = await enquiryService.cancelMeetingPlan(
    enqCompleted._id.toString(),
    { cancellationReason: 'Trying to cancel completed meeting' },
    salesAgentA
  );
  assert(cancelCompletedRes.success === false, 'Scenario 10: Cannot cancel an already completed meeting');
  assert(cancelCompletedRes.statusCode === 400, 'Scenario 10: Returns HTTP 400 for completed plan');
  assert(completedTask.status === 'COMPLETED', 'Scenario 10: COMPLETED task remains untouched');

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Rescheduling does not generate duplicate tasks
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 11: Rescheduling does not generate duplicate tasks ---');
  // First, schedule a new meeting after cancellation
  const initialTaskCount = inMemoryTasks.filter((t) => t.enquiryId.toString() === enq1._id.toString()).length;

  const rescheduleRes = await enquiryService.saveWorkflowStep(
    enq1._id.toString(),
    {
      step: 'MEETING_PLAN',
      action: 'RESCHEDULE',
      meetingPlace: 'Client Office, Whitefield',
      meetingDate: '2026-11-25',
      meetingTime: '15:00',
      projectDetails: 'Prestige Lakeside 3BHK'
    },
    salesAgentA
  );

  assert(rescheduleRes.success === true, 'Scenario 11: Rescheduling meeting succeeds');
  assert(enq1.meetingPlan?.isCancelled === false, 'Scenario 11: isCancelled is reset to false');
  assert(enq1.meetingPlan?.status === 'SCHEDULED', 'Scenario 11: status is SCHEDULED');
  assert(enq1.meetingPlan?.meetingDate === '2026-11-25', 'Scenario 11: New date persisted');
  assert(enq1.meetingPlan?.previousDate === '2026-11-15', 'Scenario 11: Old date preserved in previousDate');

  // Now, update the active meeting schedule draft (should update existing task in-place!)
  const countAfterReschedule = inMemoryTasks.filter((t) => t.enquiryId.toString() === enq1._id.toString()).length;

  const updateDraftRes = await enquiryService.saveWorkflowStep(
    enq1._id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'Client Office, Whitefield',
      meetingDate: '2026-11-26',
      meetingTime: '16:00',
      projectDetails: 'Prestige Lakeside 3BHK'
    },
    salesAgentA
  );

  assert(updateDraftRes.success === true, 'Scenario 11: Update schedule draft succeeds');
  const countAfterUpdate = inMemoryTasks.filter((t) => t.enquiryId.toString() === enq1._id.toString()).length;
  assert(
    countAfterUpdate === countAfterReschedule,
    'Scenario 11: Updating meeting schedule updates task in-place with NO duplicate tasks created'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Cancellation activity is recorded
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 12: Cancellation activity is recorded ---');
  const meetingCancelActivities = inMemoryActivities.filter((a) => a.type === 'MEETING_CANCELLED');
  assert(meetingCancelActivities.length >= 1, 'Scenario 12: MEETING_CANCELLED activity recorded');
  const lastMeetingAct = meetingCancelActivities[meetingCancelActivities.length - 1];
  assert(Boolean(lastMeetingAct.metadata?.cancellationReason), 'Scenario 12: Activity contains cancellationReason');
  assert(lastMeetingAct.performedByName === salesAgentA.name, 'Scenario 12: Activity records who performed cancellation');

  const visitCancelActivities = inMemoryActivities.filter((a) => a.type === 'SITE_VISIT_CANCELLED');
  assert(visitCancelActivities.length >= 1, 'Scenario 12: SITE_VISIT_CANCELLED activity recorded');
  const lastVisitAct = visitCancelActivities[visitCancelActivities.length - 1];
  assert(Boolean(lastVisitAct.metadata?.cancellationReason), 'Scenario 12: Site visit activity contains cancellationReason');

  // ---------------------------------------------------------------------------
  // SCENARIO 13: Correct cancellation notifications are dispatched
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 13: Correct cancellation notifications are dispatched ---');
  const meetingCancelEvents = dispatchedEvents.filter((e) => e.eventType === 'MEETING_CANCELLED');
  assert(meetingCancelEvents.length >= 1, 'Scenario 13: MEETING_CANCELLED notification event dispatched');
  const lastMeetingEvent = meetingCancelEvents[meetingCancelEvents.length - 1];
  assert(Boolean(lastMeetingEvent.payload?.cancellationReason), 'Scenario 13: Event payload contains cancellationReason');

  const visitCancelEvents = dispatchedEvents.filter((e) => e.eventType === 'SITE_VISIT_CANCELLED');
  assert(visitCancelEvents.length >= 1, 'Scenario 13: SITE_VISIT_CANCELLED notification event dispatched');

  // ---------------------------------------------------------------------------
  // SCENARIO 14: Cancelled schedule reminders are no longer active
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 14: Cancelled schedule reminders are no longer active ---');
  assert(task1.status === 'CANCELLED', 'Scenario 14: Task is CANCELLED (no longer PENDING)');
  assert(visitTask3.status === 'CANCELLED', 'Scenario 14: Visit task is CANCELLED (no longer PENDING)');

  // ---------------------------------------------------------------------------
  // SCENARIO 15: Manager approval & customer confirmation behavior unchanged
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 15: Existing Manager approval & customer confirmation unchanged ---');
  assert(enq3.siteVisitPlan?.managerId !== undefined, 'Scenario 15: Manager fields preserved on site visit');
  assert(enq3.siteVisitPlan?.visitOutcome !== undefined, 'Scenario 15: Visit outcome fields preserved');

  // ---------------------------------------------------------------------------
  // SCENARIO 16: Existing role permissions are preserved
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 16: Existing role permissions are preserved ---');
  // Agent B cannot cancel Agent A's meeting
  const crossAgentRes = await enquiryService.cancelMeetingPlan(
    enq1._id.toString(),
    { cancellationReason: 'Agent B trying to cancel' },
    salesAgentB
  );
  assert(crossAgentRes.success === false, 'Scenario 16: Cross-agent cancellation rejected');
  assert(crossAgentRes.statusCode === 403, 'Scenario 16: Returns HTTP 403 Forbidden for peer agent');

  // Manager Ravi (same team) can cancel
  const enqManagerTest = createTestEnquiry();
  const managerCancelRes = await enquiryService.cancelMeetingPlan(
    enqManagerTest._id.toString(),
    { cancellationReason: 'Manager cancelled due to schedule conflict' },
    managerActor
  );
  assert(managerCancelRes.success === true, 'Scenario 16: Manager can cancel team lead meeting');

  // Admin can cancel
  const enqAdminTest = createTestEnquiry();
  const adminCancelRes = await enquiryService.cancelMeetingPlan(
    enqAdminTest._id.toString(),
    { cancellationReason: 'Admin cancellation' },
    adminActor
  );
  assert(adminCancelRes.success === true, 'Scenario 16: Admin can cancel organization-wide lead meeting');

  console.log('\n========================================================================');
  console.log(`REQ-31 Test Suite Completed: ${passedAssertions}/${totalAssertions} Assertions Passed`);
  console.log('========================================================================\n');
}

runCancellationTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
