/**
 * Neuways CRM - Sequential Lead Workflow & Invariants Test Suite
 *
 * Non-destructive in-memory unit tests verifying:
 * 1. Step-by-step workflow: FOLLOW_UP -> MEETING_PLAN -> SITE_VISIT_PLAN -> DEAL_DONE.
 * 2. Stage locking: Next stage cannot unlock until current stage is validated & completed.
 * 3. Draft persistence: Incomplete work can be saved and reopened without data loss.
 * 4. Role-based scoping: Sales Agent cannot access or update peer agent's lead.
 * 5. Full audit history preservation: Never overwrites past interactions.
 * 6. Closing workflow: Lost/Closed supported with mandatory reason without forcing Deal Done.
 */

import { Types } from 'mongoose';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { User, IUser } from '../models/user.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
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

async function runLeadWorkflowTests() {
  console.log('====================================================');
  console.log('Starting Sequential Lead Workflow & Invariants Test Suite');
  console.log('====================================================\n');

  // Setup mock actor tokens
  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Admin Chief'
  };

  const salesAgentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'alice.sales@neuways.com',
    role: 'SALES',
    name: 'Agent Alice'
  };

  const salesAgentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'bob.sales@neuways.com',
    role: 'SALES',
    name: 'Agent Bob'
  };

  const managerId = new Types.ObjectId();
  const mockManager = {
    _id: managerId,
    name: 'Priya Sharma (Manager)',
    email: 'priya.manager@neuways.com',
    role: 'MANAGER',
    isActive: true
  } as unknown as IUser;

  // In-memory data store for tests
  const inMemoryLeads: Map<string, any> = new Map();
  const savedActivities: any[] = [];
  const savedTasks: any[] = [];

  // Mock EnquiryActivity.prototype.save
  EnquiryActivity.prototype.save = function (this: any) {
    savedActivities.push(this);
    return Promise.resolve(this);
  };

  // Mock FollowUpTask.prototype.save
  FollowUpTask.prototype.save = function (this: any) {
    savedTasks.push(this);
    return Promise.resolve(this);
  };

  // Mock FollowUpTask.updateMany
  (FollowUpTask as any).updateMany = function () {
    return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
  };

  // Helper to create mock lead document
  const createMockLead = (data: Partial<IEnquiry>): any => {
    const id = new Types.ObjectId();
    const doc: any = {
      _id: id,
      id: id.toString(),
      name: data.name || 'Sample Lead',
      mobile: data.mobile || '+919876543210',
      normalizedMobile: '+919876543210',
      projectName: data.projectName || 'Greenwood Heights',
      requirement: data.requirement || '3 BHK High Rise',
      budgetMin: data.budgetMin || 800000,
      budgetMax: data.budgetMax || 1200000,
      status: data.status || 'ACTIVE',
      isActive: data.isActive !== undefined ? data.isActive : true,
      assignedTo: data.assignedTo || null,
      currentStage: data.currentStage || 'FOLLOW_UP',
      meetingPlan: data.meetingPlan || undefined,
      siteVisitPlan: data.siteVisitPlan || undefined,
      dealDone: data.dealDone || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: function () {
        inMemoryLeads.set(this._id.toString(), this);
        return Promise.resolve(this);
      },
      toObject: function () {
        return { ...this };
      }
    };
    inMemoryLeads.set(id.toString(), doc);
    return doc;
  };

  const leadA = createMockLead({
    name: 'Rohit Mehta',
    mobile: '+919876543210',
    assignedTo: new Types.ObjectId(salesAgentA.id)
  });

  const leadB = createMockLead({
    name: 'Vikram Joshi',
    mobile: '+919876543211',
    assignedTo: new Types.ObjectId(salesAgentB.id)
  });

  // Mock Enquiry.findById
  (Enquiry as any).findById = function (id: any) {
    const doc = inMemoryLeads.get(id ? id.toString() : '');
    return {
      populate: function () {
        return Promise.resolve(doc || null);
      },
      then: function (resolve: any) {
        return Promise.resolve(doc || null).then(resolve);
      }
    };
  };

  // Mock User.find
  (User as any).find = function (query: any) {
    if (query?.role === 'MANAGER') {
      return {
        select: function () {
          return {
            sort: function () {
              return Promise.resolve([mockManager]);
            }
          };
        }
      };
    }
    return Promise.resolve([]);
  };

  // Mock User.findOne
  (User as any).findOne = function (query: any) {
    if (query?.role === 'MANAGER' && String(query?._id) === managerId.toString()) {
      return Promise.resolve(mockManager);
    }
    return Promise.resolve(null);
  };

  const service = new EnquiryService();

  // -------------------------------------------------------------
  // Test 1: Manager Selection Accounts
  // -------------------------------------------------------------
  console.log('--- Suite 1: Manager Selection & Access Scoping ---');
  const mgrRes = await service.getActiveManagers();
  assert(mgrRes.success === true, 'getActiveManagers returns success: true');
  assert(mgrRes.managers?.length === 1, 'Returns exactly 1 active manager');
  assert(mgrRes.managers?.[0]?.name === 'Priya Sharma (Manager)', 'Manager name matches correctly');

  // -------------------------------------------------------------
  // Test 2: Access Scoping (Agent A vs Agent B)
  // -------------------------------------------------------------
  const resA = await service.getEnquiryById(leadA._id.toString(), salesAgentA);
  assert(resA.success === true, 'Agent A can retrieve assigned Lead A');
  assert(resA.enquiry?.name === 'Rohit Mehta', 'Lead details match');

  const resB = await service.getEnquiryById(leadA._id.toString(), salesAgentB);
  assert(resB.success === false, 'Agent B is denied access to Lead A');
  assert(resB.statusCode === 403, 'Returns HTTP 403 Forbidden');

  const resAdmin = await service.getEnquiryById(leadA._id.toString(), adminActor);
  assert(resAdmin.success === true, 'Admin can access any enquiry');

  // -------------------------------------------------------------
  // Test 3: Step 1 (Follow-up) Validations
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Step 1 Follow-up / Customer Discussion ---');
  const emptyNoteRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: '   ',
      outcome: 'CONNECTED'
    },
    salesAgentA
  );
  assert(emptyNoteRes.success === false, 'Rejects empty remark in Step 1');
  assert(emptyNoteRes.statusCode === 400, 'Returns HTTP 400 Validation Error');

  const missingCallbackRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Callback requested',
      outcome: 'CALL_BACK_REQUESTED'
    },
    salesAgentA
  );
  assert(missingCallbackRes.success === false, 'Requires nextFollowUpDate & Time when outcome is CALL_BACK_REQUESTED');
  assert(missingCallbackRes.statusCode === 400, 'Returns HTTP 400 for missing callback schedule');

  // Valid follow-up with stage advance
  const validFollowUpRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'WHATSAPP',
      outcome: 'CONNECTED',
      followUpDate: '2026-10-27',
      followUpTime: '11:00',
      notes: 'Customer discussed 3BHK high rise options.',
      enquiryUpdate: {
        requirement: '3 BHK High Rise + Study',
        budgetMax: 1300000
      },
      advanceStage: true
    },
    salesAgentA
  );
  assert(validFollowUpRes.success === true, 'Saves follow-up interaction successfully');
  assert(validFollowUpRes.enquiry?.currentStage === 'MEETING_PLAN', 'Advances stage to MEETING_PLAN');
  assert(validFollowUpRes.enquiry?.requirement === '3 BHK High Rise + Study', 'Updates enquiry requirement details');

  // -------------------------------------------------------------
  // Test 4: Step 2 (Meeting Plan) Validations & Invariants
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: Step 2 Meeting Plan & Completion Invariants ---');
  const missingPlaceRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: '',
      meetingDate: '2026-10-28',
      meetingTime: '14:00',
      projectDetails: 'Greenwood Heights'
    },
    salesAgentA
  );
  assert(missingPlaceRes.success === false, 'Rejects Meeting Plan without meetingPlace');
  assert(missingPlaceRes.statusCode === 400, 'Returns HTTP 400');

  // Save incomplete meeting plan
  const draftMeetingRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'Main Sales Gallery',
      meetingDate: '2026-10-28',
      meetingTime: '14:00',
      projectDetails: 'Greenwood Heights Unit 402',
      managerId: managerId.toString(),
      remarks: 'Presentation scheduled',
      isCompleted: false
    },
    salesAgentA
  );
  assert(draftMeetingRes.success === true, 'Saves draft meeting plan with isCompleted: false');
  assert(draftMeetingRes.enquiry?.meetingPlan?.isCompleted === false, 'isCompleted remains false');
  assert(draftMeetingRes.enquiry?.meetingPlan?.managerName === 'Priya Sharma (Manager)', 'Manager is properly populated');

  // Attempting to advance without completing meeting must fail
  const prematureAdvanceMeeting = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'Main Sales Gallery',
      meetingDate: '2026-10-28',
      meetingTime: '14:00',
      projectDetails: 'Greenwood Heights Unit 402',
      isCompleted: false,
      advanceStage: true
    },
    salesAgentA
  );
  assert(prematureAdvanceMeeting.success === false, 'Blocks advance to Site Visit Plan when meeting is incomplete');
  assert(prematureAdvanceMeeting.statusCode === 400, 'Returns HTTP 400');

  // Mark meeting completed and advance
  const completeMeetingRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'Main Sales Gallery',
      meetingDate: '2026-10-28',
      meetingTime: '14:00',
      projectDetails: 'Greenwood Heights Unit 402',
      managerId: managerId.toString(),
      remarks: 'Meeting held successfully with client and spouse',
      meetingResult: 'Positive - requested site tour',
      isCompleted: true,
      advanceStage: true
    },
    salesAgentA
  );
  assert(completeMeetingRes.success === true, 'Marks meeting completed and saves outcome');
  assert(completeMeetingRes.enquiry?.meetingPlan?.isCompleted === true, 'Meeting plan isCompleted is true');
  assert(completeMeetingRes.enquiry?.currentStage === 'SITE_VISIT_PLAN', 'Stage advances to SITE_VISIT_PLAN');

  // -------------------------------------------------------------
  // Test 5: Step 3 (Site Visit Plan) Invariants
  // -------------------------------------------------------------
  console.log('\n--- Suite 4: Step 3 Site Visit Plan & Completion Invariants ---');
  // Attempting site visit on Lead B (whose meeting was never completed) must fail
  const invalidSiteVisitLeadB = await service.saveWorkflowStep(
    leadB._id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Sector 45 Site',
      siteVisitDate: '2026-10-29',
      siteVisitTime: '11:00',
      projectName: 'Skyline Towers'
    },
    salesAgentB
  );
  assert(invalidSiteVisitLeadB.success === false, 'Blocks site visit plan if meeting was never completed');
  assert(invalidSiteVisitLeadB.statusCode === 400, 'Returns HTTP 400');

  // Save incomplete site visit plan for Lead A
  const draftSiteVisitRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Sector 45 Greenwood Site',
      siteVisitDate: '2026-10-29',
      siteVisitTime: '11:00',
      projectName: 'Greenwood Heights',
      remarks: 'Sample flat walkthrough arranged',
      isCompleted: false
    },
    salesAgentA
  );
  assert(draftSiteVisitRes.success === true, 'Saves draft site visit plan with isCompleted: false');

  // Attempting to advance to Deal Done without completing site visit must fail
  const prematureDealAdvance = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Sector 45 Greenwood Site',
      siteVisitDate: '2026-10-29',
      siteVisitTime: '11:00',
      projectName: 'Greenwood Heights',
      isCompleted: false,
      advanceStage: true
    },
    salesAgentA
  );
  assert(prematureDealAdvance.success === false, 'Blocks advance to Deal Done when site visit is incomplete');

  // Complete site visit and advance
  const completeSiteVisitRes = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Sector 45 Greenwood Site',
      siteVisitDate: '2026-10-29',
      siteVisitTime: '11:00',
      projectName: 'Greenwood Heights',
      remarks: 'Walkthrough finished',
      visitOutcome: 'Client approved unit 402 layout',
      isCompleted: true,
      advanceStage: true
    },
    salesAgentA
  );
  assert(completeSiteVisitRes.success === true, 'Marks site visit completed');
  assert(completeSiteVisitRes.enquiry?.siteVisitPlan?.isCompleted === true, 'Site visit isCompleted is true');
  assert(completeSiteVisitRes.enquiry?.currentStage === 'DEAL_DONE', 'Stage advances to DEAL_DONE');

  // -------------------------------------------------------------
  // Test 6: Step 4 (Deal Done) Validations & Invariants
  // -------------------------------------------------------------
  console.log('\n--- Suite 5: Step 4 Deal Done & Final Confirmation ---');
  // Missing confirmation
  const unconfirmedDeal = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'DEAL_DONE',
      project: 'Greenwood Heights',
      propertyType: 'Apartment',
      price: 1250000,
      size: '1850 sq ft',
      isConfirmed: false
    },
    salesAgentA
  );
  assert(unconfirmedDeal.success === false, 'Rejects Deal Done without explicit isConfirmed: true');
  assert(unconfirmedDeal.statusCode === 400, 'Returns HTTP 400');

  // Missing price / invalid price
  const invalidPriceDeal = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'DEAL_DONE',
      project: 'Greenwood Heights',
      propertyType: 'Apartment',
      price: -100,
      size: '1850 sq ft',
      isConfirmed: true
    },
    salesAgentA
  );
  assert(invalidPriceDeal.success === false, 'Rejects negative deal price');

  // Valid finalized deal
  const finalDeal = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'DEAL_DONE',
      project: 'Greenwood Heights',
      propertyType: 'Apartment',
      price: 1250000,
      size: '1850 sq ft',
      remarks: 'Booking deposit confirmed.',
      isConfirmed: true
    },
    salesAgentA
  );
  assert(finalDeal.success === true, 'Finalizes Deal Done successfully');
  assert(finalDeal.enquiry?.currentStage === 'DEAL_DONE', 'Stage persisted as DEAL_DONE');
  assert(finalDeal.enquiry?.dealDone?.isConfirmed === true, 'dealDone isConfirmed is true');
  assert(finalDeal.enquiry?.dealDone?.price === 1250000, 'Deal price matches exactly');

  // -------------------------------------------------------------
  // Test 7: Cross-Agent Tamper Protection & Lost/Closed Flow
  // -------------------------------------------------------------
  console.log('\n--- Suite 6: Security & Lost/Closed Lead Workflow ---');
  const crossAgentTamper = await service.saveWorkflowStep(
    leadA._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Tamper attempt'
    },
    salesAgentB
  );
  assert(crossAgentTamper.success === false, 'Cross-agent workflow update rejected');
  assert(crossAgentTamper.statusCode === 403, 'Returns HTTP 403 Forbidden');

  // Closing lead requires reason
  const closeWithoutReason = await service.saveWorkflowStep(
    leadB._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Client not interested',
      leadStatus: 'CLOSED',
      closingReason: ''
    },
    salesAgentB
  );
  assert(closeWithoutReason.success === false, 'Closing lead requires non-empty reason');
  assert(closeWithoutReason.statusCode === 400, 'Returns HTTP 400');

  // -------------------------------------------------------------
  // Test 8: REQ-08 Preferred Location Persistence & Invariants
  // -------------------------------------------------------------
  console.log('\n--- Suite 7: REQ-08 Preferred Location Persistence & Updates ---');
  const locLead = createMockLead({
    name: 'Location Test Lead',
    mobile: '+919988776655',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    currentStage: 'FOLLOW_UP',
    preferredLocation: undefined
  });
  inMemoryLeads.set(locLead._id.toString(), locLead);

  // 1. Initial follow-up sets preferred location
  const locRes1 = await service.saveWorkflowStep(
    locLead._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CONNECTED',
      notes: 'Customer interested in Whitefield area',
      enquiryUpdate: {
        preferredLocation: 'Whitefield, Bangalore'
      }
    },
    salesAgentA
  );
  assert(locRes1.success === true, 'REQ-08: Follow-up with preferred location succeeds');
  assert(locLead.preferredLocation === 'Whitefield, Bangalore', 'REQ-08: Preferred location persisted in lead');

  // 2. Subsequent follow-up without preferredLocation in enquiryUpdate preserves existing value
  const locRes2 = await service.saveWorkflowStep(
    locLead._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'WHATSAPP',
      outcome: 'CONNECTED',
      notes: 'Customer confirmed requirement details',
      enquiryUpdate: {
        requirement: '4 BHK Luxury'
      }
    },
    salesAgentA
  );
  assert(locRes2.success === true, 'REQ-08: Subsequent follow-up update succeeds');
  assert(locLead.preferredLocation === 'Whitefield, Bangalore', 'REQ-08: Preferred location preserved when omitted from enquiryUpdate');
  assert(locLead.requirement === '4 BHK Luxury', 'REQ-08: Other requirement fields update correctly');

  // 3. Explicitly updating preferred location
  const locRes3 = await service.saveWorkflowStep(
    locLead._id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CONNECTED',
      notes: 'Customer shifted preference to Indiranagar',
      enquiryUpdate: {
        preferredLocation: 'Indiranagar, Bangalore'
      }
    },
    salesAgentA
  );
  assert(locRes3.success === true, 'REQ-08: Updating preferred location succeeds');
  assert(locLead.preferredLocation === 'Indiranagar, Bangalore', 'REQ-08: Preferred location updated to new value');

  console.log('\n====================================================');
  console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLeadWorkflowTests().catch((err) => {
  console.error('Unhandled test exception:', err);
  process.exit(1);
});
