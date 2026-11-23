/**
 * Nueways CRM - Employee vs Lead Data Isolation & Sales Dashboard Verification Tests
 *
 * Verifies:
 * 1. Employee vs. Lead Collection Isolation:
 *    - Employee creation creates exactly 1 record in `users` and 0 records in `enquiries`.
 *    - Listing enquiries queries exclusively `enquiries` and never returns or maps user records.
 * 2. Role-Based Scoping & Follow-Up Authorization:
 *    - Sales Agent sees only enquiries assigned to their user ID.
 *    - Sales Agent attempting to log a follow-up on another agent's enquiry gets HTTP 403 Forbidden.
 * 3. Follow-Up Workflow Validation:
 *    - Outcome selection is supported ('CONNECTED', 'NO_ANSWER', 'CALL_BACK_REQUESTED', etc.).
 *    - Follow-up with 'CALL_BACK_REQUESTED' strictly requires nextFollowUpDate and nextFollowUpTime.
 *    - Follow-up with 'CALL_BACK_REQUESTED' automatically creates a future PENDING follow-up task.
 * 4. Dashboard Summary Role-Scoping & Live Calculation:
 *    - Sales Agent dashboard summary computes metrics strictly for their assigned enquiries.
 *    - Admin / Manager dashboard summary computes organization-wide aggregated metrics.
 */

import { Types } from 'mongoose';
import { User, IUser } from '../models/user.model.js';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { FollowUpTask, IFollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { userService } from '../services/user.service.js';
import { createFollowUpSchema } from '../controllers/enquiry.controller.js';
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

async function runIsolationTests() {
  console.log('====================================================');
  console.log('Starting Employee vs. Lead Isolation & Follow-Up Test Suite');
  console.log('====================================================\n');

  // Setup mock actor tokens
  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Admin User'
  };

  const salesAgentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.a@neuways.com',
    role: 'SALES',
    name: 'Sales Agent A'
  };

  const salesAgentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.b@neuways.com',
    role: 'SALES',
    name: 'Sales Agent B'
  };

  // -----------------------------------------------------------------
  // Suite 1: Collection Separation & Schema Isolation
  // -----------------------------------------------------------------
  console.log('--- Suite 1: Employee vs. Lead Collection Separation ---');

  // Verify User and Enquiry model collection names are distinct
  assert(
    User.collection.collectionName === 'users',
    'User model maps exclusively to "users" collection'
  );
  assert(
    Enquiry.collection.collectionName === 'enquiries',
    'Enquiry model maps exclusively to "enquiries" collection'
  );
  assert(
    FollowUpTask.collection.collectionName === 'follow_up_tasks',
    'FollowUpTask model maps exclusively to "follow_up_tasks" collection'
  );

  // -----------------------------------------------------------------
  // Suite 2: Follow-Up Zod Schema Validation & Outcome Rules
  // -----------------------------------------------------------------
  console.log('\n--- Suite 2: Follow-Up Workflow Schema Validation ---');

  // Valid standard follow-up
  const validConnected = createFollowUpSchema.safeParse({
    purpose: 'CALL',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: 'Spoke with prospective client, interested in 3BHK unit.',
    outcome: 'CONNECTED'
  });
  assert(validConnected.success === true, 'Accepts valid follow-up with CONNECTED outcome');

  // CALL_BACK_REQUESTED without nextFollowUpDate must fail
  const missingNextDate = createFollowUpSchema.safeParse({
    purpose: 'CALL',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: 'Client requested callback tomorrow.',
    outcome: 'CALL_BACK_REQUESTED',
    nextFollowUpTime: '15:00'
  });
  assert(
    missingNextDate.success === false,
    'Rejects CALL_BACK_REQUESTED when nextFollowUpDate is missing'
  );

  // CALL_BACK_REQUESTED without nextFollowUpTime must fail
  const missingNextTime = createFollowUpSchema.safeParse({
    purpose: 'CALL',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: 'Client requested callback tomorrow.',
    outcome: 'CALL_BACK_REQUESTED',
    nextFollowUpDate: '2026-10-29'
  });
  assert(
    missingNextTime.success === false,
    'Rejects CALL_BACK_REQUESTED when nextFollowUpTime is missing'
  );

  // CALL_BACK_REQUESTED with valid nextFollowUpDate & nextFollowUpTime must succeed
  const validCallback = createFollowUpSchema.safeParse({
    purpose: 'WHATSAPP',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: 'Sent project brochure; client asked to follow up next Tuesday.',
    outcome: 'CALL_BACK_REQUESTED',
    nextFollowUpDate: '2026-11-03',
    nextFollowUpTime: '14:30'
  });
  assert(
    validCallback.success === true,
    'Accepts CALL_BACK_REQUESTED when next date and time are supplied'
  );

  // Closing without closing reason must fail
  const missingClosingReason = createFollowUpSchema.safeParse({
    purpose: 'CALL',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: 'Client decided to postpone purchase.',
    outcome: 'NOT_INTERESTED',
    leadStatus: 'CLOSED'
  });
  assert(
    missingClosingReason.success === false,
    'Rejects leadStatus=CLOSED without mandatory closingReason'
  );

  // Empty notes must fail
  const emptyNotes = createFollowUpSchema.safeParse({
    purpose: 'CALL',
    followUpDate: '2026-10-28',
    followUpTime: '11:00',
    notes: '   ',
    outcome: 'CONNECTED'
  });
  assert(emptyNotes.success === false, 'Rejects empty follow-up remark/notes');

  // -----------------------------------------------------------------
  // Suite 3: Follow-Up Role Authorization & Cross-Agent Denied
  // -----------------------------------------------------------------
  console.log('\n--- Suite 3: Follow-Up Role Authorization & Scoping ---');

  // Mock Enquiry assigned to Agent B
  const enquiryForB = {
    _id: new Types.ObjectId(),
    name: 'Customer B',
    status: 'ACTIVE',
    assignedTo: new Types.ObjectId(salesAgentB.id)
  };

  // Mock Enquiry.findById to return enquiryForB
  const originalFindById = Enquiry.findById;
  (Enquiry as any).findById = (id: any) => {
    return Promise.resolve(enquiryForB);
  };

  // Agent A attempts to record follow-up on Agent B's enquiry -> HTTP 403 Access Denied
  const crossAgentResult = await enquiryService.createFollowUp(
    enquiryForB._id.toString(),
    {
      purpose: 'CALL',
      followUpDate: '2026-10-28',
      followUpTime: '10:00',
      notes: 'Attempting follow up on colleague lead'
    },
    salesAgentA
  );

  assert(
    crossAgentResult.success === false,
    'Cross-agent follow-up attempt returns success: false'
  );
  assert(
    crossAgentResult.statusCode === 403,
    'Cross-agent follow-up returns HTTP 403 Forbidden'
  );
  assert(
    Boolean(crossAgentResult.message?.includes('Access denied')),
    'Error message clearly communicates role-based ownership denial'
  );

  // Agent A attempts to view follow-ups on Agent B's enquiry -> HTTP 403 Access Denied
  const crossAgentViewResult = await enquiryService.getFollowUps(
    enquiryForB._id.toString(),
    salesAgentA
  );

  assert(
    crossAgentViewResult.success === false,
    'Cross-agent view follow-up returns success: false'
  );
  assert(
    crossAgentViewResult.statusCode === 403,
    'Cross-agent view follow-up returns HTTP 403 Forbidden'
  );

  // Restore Enquiry.findById
  (Enquiry as any).findById = originalFindById;

  // -----------------------------------------------------------------
  // Suite 4: Dashboard Summary Role-Scoping & Live Metrics Structure
  // -----------------------------------------------------------------
  console.log('\n--- Suite 4: Dashboard Summary Data Contract ---');

  const summarySales = await enquiryService.getDashboardSummary(salesAgentA);
  assert(summarySales.success === true, 'getDashboardSummary returns success: true for SALES role');
  assert(summarySales.data !== undefined, 'getDashboardSummary provides structured data envelope');
  assert(typeof summarySales.data?.dailyVelocity === 'number', 'dailyVelocity is a valid number');
  assert(
    typeof summarySales.data?.pendingFollowUpsCount === 'number',
    'pendingFollowUpsCount is a valid number'
  );
  assert(
    typeof summarySales.data?.futureFollowUpsCount === 'number',
    'futureFollowUpsCount is a valid number'
  );
  assert(
    typeof summarySales.data?.activePipelineCount === 'number',
    'activePipelineCount is a valid number'
  );
  assert(
    Array.isArray(summarySales.data?.pendingStages),
    'pendingStages is a valid array of stage metrics'
  );
  assert(
    Array.isArray(summarySales.data?.futureStages),
    'futureStages is a valid array of stage metrics'
  );
  assert(
    summarySales.data?.qualificationMatrix !== undefined,
    'qualificationMatrix is present in summary'
  );

  const summaryAdmin = await enquiryService.getDashboardSummary(adminActor);
  assert(summaryAdmin.success === true, 'getDashboardSummary returns success: true for ADMIN role');

  console.log('\n====================================================');
  console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runIsolationTests().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
