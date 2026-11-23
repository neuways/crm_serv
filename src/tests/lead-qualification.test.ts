/**
 * Lead Qualification & Readiness Scoring Test Suite
 *
 * Validates:
 * 1. BANT-aligned 4-dimension scoring engine & boundary mapping to 10%, 20%, 50%, 70%, 80%, 100%.
 * 2. Lead qualification persistence, schema subdocument, and audit logging.
 * 3. Role-based authorization: Sales agent isolation for qualification (403 Forbidden).
 * 4. Closed lead and finalized deal guards (400 Bad Request).
 * 5. Dashboard summary qualificationMatrix aggregation (unscored vs scored state).
 */

import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { computeLeadQualification } from '../utils/qualification-scoring.js';
import { enquiryService } from '../services/enquiry.service.js';
import { Enquiry } from '../models/enquiry.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { AuthUser } from '../types/auth.types.js';

let passedTests = 0;
function pass(label: string) {
  passedTests++;
  console.log(`[PASS] ${label}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('Starting Lead Qualification & Readiness Test Suite');
  console.log('====================================================\n');

  // Fast in-memory mock for EnquiryActivity
  EnquiryActivity.prototype.save = function (this: any) {
    return Promise.resolve(this);
  } as any;

  // -------------------------------------------------------------
  // SUITE 1: Deterministic Scoring Model & Percentage Buckets
  // -------------------------------------------------------------
  console.log('--- Suite 1: Scoring Model & Percentage Mapping ---');

  // Case 1: 100% Bucket (Score >= 90)
  // Budget: 30 + Timeline: 30 + DecisionMaker: 20 + Need: 20 = 100
  const maxScore = computeLeadQualification({
    budgetStatus: 'VERIFIED_BUDGET',
    timeline: 'IMMEDIATE',
    decisionMaker: 'SOLE_DECISION_MAKER',
    needClarity: 'SPECIFIC_UNIT_TYPE'
  });
  assert.strictEqual(maxScore.calculatedScore, 100);
  assert.strictEqual(maxScore.scoreLabel, '100%');
  assert.strictEqual(maxScore.readinessScore, 100);
  assert.strictEqual(maxScore.priority, 'HOT');
  pass('Max BANT criteria computes 100 pts -> 100% Readiness & HOT priority');

  // Case 2: 80% Bucket (Score: 75 - 89)
  // Budget: 25 + Timeline: 25 + DecisionMaker: 15 + Need: 15(need is 10 if General) = 75
  const eightyScore = computeLeadQualification({
    budgetStatus: 'LOAN_PRE_APPROVED', // 25
    timeline: 'WITHIN_30_DAYS',        // 25
    decisionMaker: 'JOINT_DECISION_MAKER', // 15
    needClarity: 'GENERAL_REQUIREMENT' // 10 => Total = 75
  });
  assert.strictEqual(eightyScore.calculatedScore, 75);
  assert.strictEqual(eightyScore.scoreLabel, '80%');
  assert.strictEqual(eightyScore.readinessScore, 80);
  assert.strictEqual(eightyScore.priority, 'HOT');
  pass('75 points maps cleanly to 80% Readiness bucket & HOT priority');

  // Case 3: 70% Bucket (Score: 60 - 74)
  // Budget: 15 + Timeline: 15 + DecisionMaker: 20 + Need: 10 = 60
  const seventyScore = computeLeadQualification({
    budgetStatus: 'STRETCH_BUDGET',   // 15
    timeline: 'WITHIN_90_DAYS',       // 15
    decisionMaker: 'SOLE_DECISION_MAKER', // 20
    needClarity: 'GENERAL_REQUIREMENT' // 10 => Total = 60
  });
  assert.strictEqual(seventyScore.calculatedScore, 60);
  assert.strictEqual(seventyScore.scoreLabel, '70%');
  assert.strictEqual(seventyScore.readinessScore, 70);
  assert.strictEqual(seventyScore.priority, 'HOT');
  pass('60 points maps cleanly to 70% Readiness bucket');

  // Case 4: 50% Bucket (Score: 40 - 59)
  // Budget: 15 + Timeline: 15 + DecisionMaker: 15 + Need: 5 = 50
  const fiftyScore = computeLeadQualification({
    budgetStatus: 'STRETCH_BUDGET',        // 15
    timeline: 'WITHIN_90_DAYS',            // 15
    decisionMaker: 'JOINT_DECISION_MAKER', // 15
    needClarity: 'EXPLORATORY'             // 5 => Total = 50
  });
  assert.strictEqual(fiftyScore.calculatedScore, 50);
  assert.strictEqual(fiftyScore.scoreLabel, '50%');
  assert.strictEqual(fiftyScore.readinessScore, 50);
  assert.strictEqual(fiftyScore.priority, 'POSSIBLE');
  pass('50 points maps cleanly to 50% Readiness bucket & POSSIBLE priority');

  // Case 5: 20% Bucket (Score: 25 - 39)
  // Budget: 0 + Timeline: 5 + DecisionMaker: 20 + Need: 10 = 35
  const twentyScore = computeLeadQualification({
    budgetStatus: 'UNCONFIRMED',           // 0
    timeline: 'ABOVE_90_DAYS',             // 5
    decisionMaker: 'SOLE_DECISION_MAKER',  // 20
    needClarity: 'GENERAL_REQUIREMENT'     // 10 => Total = 35
  });
  assert.strictEqual(twentyScore.calculatedScore, 35);
  assert.strictEqual(twentyScore.scoreLabel, '20%');
  assert.strictEqual(twentyScore.readinessScore, 20);
  assert.strictEqual(twentyScore.priority, 'POSSIBLE');
  pass('35 points maps cleanly to 20% Readiness bucket & POSSIBLE priority');

  // Case 6: 10% Bucket (Score: 0 - 24)
  // Budget: 0 + Timeline: 5 + DecisionMaker: 5 + Need: 5 = 15
  const tenScore = computeLeadQualification({
    budgetStatus: 'UNCONFIRMED',           // 0
    timeline: 'ABOVE_90_DAYS',             // 5
    decisionMaker: 'INFLUENCER_ONLY',      // 5
    needClarity: 'EXPLORATORY'             // 5 => Total = 15
  });
  assert.strictEqual(tenScore.calculatedScore, 15);
  assert.strictEqual(tenScore.scoreLabel, '10%');
  assert.strictEqual(tenScore.readinessScore, 10);
  assert.strictEqual(tenScore.priority, 'POSSIBLE');
  pass('15 points maps cleanly to 10% Readiness bucket & POSSIBLE priority');

  // Explicit priority override support
  const explicitHot = computeLeadQualification({
    budgetStatus: 'UNCONFIRMED',
    timeline: 'ABOVE_90_DAYS',
    priority: 'HOT'
  });
  assert.strictEqual(explicitHot.priority, 'HOT');
  pass('Explicit agent priority override is honored');

  // -------------------------------------------------------------
  // SUITE 2: Lead Qualification Persistence & Authorization
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Qualification Service & RBAC ---');

  const agentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.a@neuways.local',
    name: 'Agent Alice',
    role: 'SALES'
  };

  const agentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.b@neuways.local',
    name: 'Agent Bob',
    role: 'SALES'
  };

  // Mock lead store
  const mockLeadA = {
    _id: new Types.ObjectId(),
    name: 'Prospect Alpha',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(agentA.id),
    qualification: undefined as any,
    save: async function () { return this; },
    populate: async function () { return this; }
  };

  const mockLeadClosed = {
    _id: new Types.ObjectId(),
    name: 'Prospect Closed',
    status: 'CLOSED',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(agentA.id),
    save: async function () { return this; }
  };

  const mockDealDone = {
    _id: new Types.ObjectId(),
    name: 'Prospect Deal Done',
    status: 'ACTIVE',
    currentStage: 'DEAL_DONE',
    dealDone: { isConfirmed: true },
    assignedTo: new Types.ObjectId(agentA.id),
    save: async function () { return this; }
  };

  const origFindById = Enquiry.findById;
  Enquiry.findById = ((id: any) => {
    const idStr = id?.toString();
    let doc: any = null;
    if (idStr === mockLeadA._id.toString()) doc = mockLeadA;
    if (idStr === mockLeadClosed._id.toString()) doc = mockLeadClosed;
    if (idStr === mockDealDone._id.toString()) doc = mockDealDone;
    return {
      populate: async () => doc,
      then: (fn: any) => Promise.resolve(doc).then(fn)
    } as any;
  }) as any;

  // Test 1: Cross-agent tampering is rejected (403 Forbidden)
  const tamperRes = await enquiryService.qualifyLead(
    mockLeadA._id.toString(),
    { budgetStatus: 'VERIFIED_BUDGET' },
    agentB // Agent B tries to qualify Agent A's lead
  );
  assert.strictEqual(tamperRes.success, false);
  assert.strictEqual(tamperRes.statusCode, 403);
  pass('Rejects qualification by unassigned sales agent with HTTP 403 Forbidden');

  // Test 2: Closed lead guard (400 Bad Request)
  const closedRes = await enquiryService.qualifyLead(
    mockLeadClosed._id.toString(),
    { budgetStatus: 'VERIFIED_BUDGET' },
    agentA
  );
  assert.strictEqual(closedRes.success, false);
  assert.strictEqual(closedRes.statusCode, 400);
  pass('Rejects qualification of closed lead with HTTP 400 Bad Request');

  // Test 3: Finalized deal guard (400 Bad Request)
  const dealRes = await enquiryService.qualifyLead(
    mockDealDone._id.toString(),
    { budgetStatus: 'VERIFIED_BUDGET' },
    agentA
  );
  assert.strictEqual(dealRes.success, false);
  assert.strictEqual(dealRes.statusCode, 400);
  pass('Rejects qualification of finalized deal with HTTP 400 Bad Request');

  // Test 4: Assigned sales agent qualifies active lead successfully
  const validRes = await enquiryService.qualifyLead(
    mockLeadA._id.toString(),
    {
      budgetStatus: 'VERIFIED_BUDGET',
      timeline: 'IMMEDIATE',
      decisionMaker: 'SOLE_DECISION_MAKER',
      needClarity: 'SPECIFIC_UNIT_TYPE',
      notes: 'Customer pre-verified liquid funds for luxury 3BHK unit'
    },
    agentA
  );
  assert.strictEqual(validRes.success, true);
  assert.strictEqual(mockLeadA.qualification.isQualified, true);
  assert.strictEqual(mockLeadA.qualification.scoreLabel, '100%');
  assert.strictEqual(mockLeadA.qualification.priority, 'HOT');
  assert.strictEqual(mockLeadA.qualification.notes, 'Customer pre-verified liquid funds for luxury 3BHK unit');
  pass('Assigned sales agent qualifies active lead and persists complete qualification subdocument');

  // -------------------------------------------------------------
  // SUITE 3: Dashboard Summary Qualification Matrix Aggregation
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: Dashboard Summary Qualification Aggregation ---');

  const origReadyState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

  const origCountDocuments = Enquiry.countDocuments;
  const origFind = Enquiry.find;
  const origTaskFind = FollowUpTask.find;
  const origTaskCount = FollowUpTask.countDocuments;
  FollowUpTask.countDocuments = (() => Promise.resolve(10)) as any;
  (enquiryService as any).ensureInitialTasksForActiveEnquiries = async function () {};

  // Mock Enquiry collection for summary
  const activeEnquiriesList = [
    {
      _id: mockLeadA._id,
      name: 'Prospect Alpha',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(agentA.id),
      qualification: {
        isQualified: true,
        scoreLabel: '100%',
        priority: 'HOT',
        readinessScore: 100,
        calculatedScore: 100
      }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Prospect Beta',
      status: 'ACTIVE',
      currentStage: 'MEETING_PLAN',
      assignedTo: new Types.ObjectId(agentA.id),
      qualification: {
        isQualified: true,
        scoreLabel: '70%',
        priority: 'POSSIBLE',
        readinessScore: 70,
        calculatedScore: 65
      }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Prospect Gamma',
      status: 'ACTIVE',
      currentStage: 'SITE_VISIT_PLAN',
      assignedTo: new Types.ObjectId(agentA.id),
      qualification: undefined // Unscored lead
    }
  ];

  Enquiry.countDocuments = (() => Promise.resolve(3)) as any;
  Enquiry.find = (() => ({
    select: () => ({
      lean: () => Promise.resolve(activeEnquiriesList),
      then: (fn: any) => Promise.resolve(activeEnquiriesList).then(fn)
    }),
    lean: () => Promise.resolve(activeEnquiriesList),
    then: (fn: any) => Promise.resolve(activeEnquiriesList).then(fn)
  })) as any;

  FollowUpTask.find = (() => ({
    sort: () => ({
      populate: () => ({
        lean: () => Promise.resolve([])
      })
    })
  })) as any;

  const summary = await enquiryService.getDashboardSummary(agentA);
  assert.strictEqual(summary.success, true);
  const qMatrix = summary.data?.qualificationMatrix;
  assert(qMatrix !== undefined, 'qualificationMatrix must be present');
  assert.strictEqual(qMatrix?.isPopulated, true, 'isPopulated is true when scored leads exist');
  assert.strictEqual(qMatrix?.totalActiveLeads, 3, 'Total active leads is 3');
  assert.strictEqual(qMatrix?.scoredLeadsCount, 2, 'Scored leads count is 2');
  assert.strictEqual(qMatrix?.unscoredLeadsCount, 1, 'Unscored leads count is 1');
  assert.strictEqual(qMatrix?.scoredPercentage, 67, 'Scored percentage is 67% (2/3)');

  // Validate Hot row: Alpha is 100% Hot => index 5 is 1
  assert.strictEqual(qMatrix?.hotRow.values[5], 1, 'Hot 100% column is 1');
  // Validate Poss row: Beta is 70% Poss => index 3 is 1
  assert.strictEqual(qMatrix?.possRow.values[3], 1, 'Poss 70% column is 1');
  pass('qualificationMatrix aggregates live active pipeline leads into exact Hot/Poss percentage buckets');

  // Restore mocks
  Object.defineProperty(mongoose.connection, 'readyState', { value: origReadyState, configurable: true });
  Enquiry.findById = origFindById;
  Enquiry.find = origFind;
  Enquiry.countDocuments = origCountDocuments;
  FollowUpTask.find = origTaskFind;
  FollowUpTask.countDocuments = origTaskCount;

  console.log('\n====================================================');
  console.log(`Test Results: ${passedTests} Passed, 0 Failed`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
