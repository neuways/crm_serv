import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { Enquiry, EnquiryActivity, FollowUpTask, User } from '../models/index.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { PREDEFINED_REJECTION_REASONS } from '../models/enquiry.model.js';
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
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject)
      };
      return emptyChain as any;
    }
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      }
    };
    const chain: any = {
      populate: () => chain,
      lean: () => Promise.resolve(doc),
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject)
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
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
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
      if (filter.assignedTo && e.assignedTo?.toString() !== filter.assignedTo.toString()) matches = false;
      if (filter.currentStage && Array.isArray(filter.currentStage.$in) && !filter.currentStage.$in.includes(e.currentStage)) matches = false;
      if (filter['dealDone.isConfirmed'] === true && (!e.dealDone || !e.dealDone.isConfirmed)) matches = false;
      if (filter['dealDone.isConfirmed']?.$ne === true && e.dealDone?.isConfirmed === true) matches = false;
      if (filter['rejection.reason']) {
        if (filter['rejection.reason'].$exists === false && e.rejection?.reason) {
          matches = false;
        }
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

  (FollowUpTask as any).find = () => {
    const tasks = [...taskStore];
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve(tasks),
      then: (resolve: any, reject: any) => Promise.resolve(tasks).then(resolve, reject)
    };
    return chain as any;
  };

  (User as any).findById = (id: any) => {
    const idStr = id?.toString();
    const user = userStore.find((u) => (u._id?.toString() || u.id?.toString()) === idStr);
    return {
      select: () => Promise.resolve(user),
      lean: () => Promise.resolve(user),
      then: (resolve: any, reject: any) => Promise.resolve(user).then(resolve, reject)
    } as any;
  };

  (User as any).find = (query: any = {}) => {
    let users = [...userStore];
    if (query.managerId) {
      users = users.filter((u) => u.managerId?.toString() === query.managerId.toString());
    }
    return {
      select: () => ({
        lean: () => Promise.resolve(users),
        then: (resolve: any, reject: any) => Promise.resolve(users).then(resolve, reject)
      }),
      lean: () => Promise.resolve(users),
      then: (resolve: any, reject: any) => Promise.resolve(users).then(resolve, reject)
    } as any;
  };
}

async function runLeadRejectionTests() {
  console.log('====================================================');
  console.log('Starting Lead Rejection / Lost Workflow Test Suite');
  console.log('====================================================\n');

  setupMocks();

  const service = new EnquiryService();
  (service as any).ensureInitialTasksForActiveEnquiries = () => Promise.resolve();

  // Actors
  const managerVikramId = new Types.ObjectId();
  const salesRahulId = new Types.ObjectId();
  const salesPriyaId = new Types.ObjectId();
  const adminId = new Types.ObjectId();

  const managerVikram: AuthUser = { id: managerVikramId.toString(), name: 'Manager Vikram', role: 'MANAGER', email: 'manager@neuways.local' };
  const salesRahul: AuthUser = { id: salesRahulId.toString(), name: 'Rahul Sharma', role: 'SALES', email: 'sales.rahul@neuways.local' };
  const salesPriya: AuthUser = { id: salesPriyaId.toString(), name: 'Priya Patel', role: 'SALES', email: 'sales.priya@neuways.local' };
  const adminUser: AuthUser = { id: adminId.toString(), name: 'Admin User', role: 'ADMIN', email: 'admin@neuways.com' };

  userStore.push(
    { _id: managerVikramId, name: 'Manager Vikram', role: 'MANAGER', isActive: true },
    { _id: salesRahulId, name: 'Rahul Sharma', role: 'SALES', managerId: managerVikramId, isActive: true },
    { _id: salesPriyaId, name: 'Priya Patel', role: 'SALES', managerId: null, isActive: true },
    { _id: adminId, name: 'Admin User', role: 'ADMIN', isActive: true }
  );

  // Seed Leads
  const lead1Id = new Types.ObjectId(); // Assigned to Rahul (Stage 1)
  const lead2Id = new Types.ObjectId(); // Assigned to Priya (Stage 2)
  const lead3Id = new Types.ObjectId(); // Finalized Deal Done lead

  enquiryStore.push(
    {
      _id: lead1Id,
      id: lead1Id.toString(),
      name: 'Amit Verma',
      mobile: '9876543210',
      status: 'ACTIVE',
      isActive: true,
      assignedTo: salesRahulId,
      currentStage: 'FOLLOW_UP',
      projectName: 'Green Heights'
    },
    {
      _id: lead2Id,
      id: lead2Id.toString(),
      name: 'Sunita Mehra',
      mobile: '9876543211',
      status: 'ACTIVE',
      isActive: true,
      assignedTo: salesPriyaId,
      currentStage: 'MEETING_PLAN',
      meetingPlan: { isCompleted: true },
      projectName: 'Skyline Residency'
    },
    {
      _id: lead3Id,
      id: lead3Id.toString(),
      name: 'Rajesh Khanna',
      mobile: '9876543212',
      status: 'ACTIVE',
      isActive: true,
      assignedTo: salesRahulId,
      currentStage: 'DEAL_DONE',
      dealDone: { isConfirmed: true, project: 'Elite Villas', price: 9500000 },
      projectName: 'Elite Villas'
    }
  );

  // ---------------------------------------------------------------------------
  // Suite 1: Input Validations & Predefined Reasons
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Input Validation & Predefined Reasons ---');

  // Test 1: Empty rejection reason rejected
  try {
    const res = await service.rejectEnquiry(lead1Id.toString(), { reason: '' }, salesRahul);
    assert(res.success === false, 'Rejects empty rejection reason');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    pass('Empty rejection reason is rejected with HTTP 400');
  } catch (err) {
    fail('Empty rejection reason is rejected with HTTP 400', err);
  }

  // Test 2: Invalid reason not in predefined list rejected
  try {
    const res = await service.rejectEnquiry(lead1Id.toString(), { reason: 'Invalid Custom Reason' }, salesRahul);
    assert(res.success === false, 'Rejects unrecognized rejection reason');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    assert(res.message?.includes('Allowed reasons'), 'Lists allowed reasons');
    pass('Unrecognized rejection reason rejected with allowed reasons list');
  } catch (err) {
    fail('Unrecognized rejection reason rejected with allowed reasons list', err);
  }

  // Test 3: Reason "Other" without mandatory remarks rejected
  try {
    const res = await service.rejectEnquiry(lead1Id.toString(), { reason: 'Other', remarks: '' }, salesRahul);
    assert(res.success === false, 'Rejects "Other" without remarks');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    assert(res.message?.includes('mandatory'), 'Requires mandatory remarks');
    pass('Rejection reason "Other" without remarks is rejected with HTTP 400');
  } catch (err) {
    fail('Rejection reason "Other" without remarks is rejected with HTTP 400', err);
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Role-Based Access Control (RBAC)
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Role-Based Access Control & Ownership Scoping ---');

  // Test 4: Sales agent cannot reject peer agent's lead
  try {
    const res = await service.rejectEnquiry(lead2Id.toString(), { reason: 'Budget too high' }, salesRahul);
    assert(res.success === false, 'Cross-agent rejection rejected');
    assert(res.statusCode === 403, 'Returns HTTP 403 Forbidden');
    pass('Sales Agent cannot reject lead assigned to another agent (HTTP 403)');
  } catch (err) {
    fail('Sales Agent cannot reject lead assigned to another agent (HTTP 403)', err);
  }

  // Test 5: Manager can reject lead assigned to member of their team
  try {
    const res = await service.rejectEnquiry(lead1Id.toString(), { reason: 'Budget too high', remarks: 'Client wants under 40L' }, managerVikram);
    assert(res.success === true, 'Manager allowed to reject team lead');
    assert(res.enquiry?.status === 'CLOSED', 'Status changed to CLOSED');
    assert(res.enquiry?.rejection?.reason === 'Budget too high', 'Rejection reason saved');
    assert(res.enquiry?.rejection?.previousStage === 'FOLLOW_UP', 'Previous stage captured');
    assert(res.enquiry?.rejection?.rejectedByName === 'Manager Vikram', 'Rejection actor captured');
    pass('Manager can reject lead assigned to their team member');
  } catch (err) {
    fail('Manager can reject lead assigned to their team member', err);
  }

  // Test 6: Manager cannot reject lead outside their team
  try {
    const res = await service.rejectEnquiry(lead2Id.toString(), { reason: 'Location issue' }, managerVikram);
    assert(res.success === false, 'Manager rejected for outside-team lead');
    assert(res.statusCode === 403, 'Returns HTTP 403 Forbidden');
    pass('Manager cannot reject lead outside their assigned team (HTTP 403)');
  } catch (err) {
    fail('Manager cannot reject lead outside their assigned team (HTTP 403)', err);
  }

  // Test 7: Sales Agent can reject their own assigned lead with reason "Other" and remarks
  try {
    const res = await service.rejectEnquiry(
      lead2Id.toString(),
      { reason: 'Other', remarks: 'Client shifted overseas permanently' },
      salesPriya
    );
    assert(res.success === true, 'Sales Priya rejects own lead');
    assert(res.enquiry?.status === 'CLOSED', 'Status is CLOSED');
    assert(res.enquiry?.rejection?.reason === 'Other', 'Reason is Other');
    assert(res.enquiry?.rejection?.remarks === 'Client shifted overseas permanently', 'Remarks saved');
    assert(res.enquiry?.rejection?.previousStage === 'MEETING_PLAN', 'Captured previous stage MEETING_PLAN');
    assert(res.enquiry?.rejection?.rejectedByName === 'Priya Patel', 'Actor captured as Priya Patel');
    pass('Sales Agent successfully marks assigned lead as Rejected with reason "Other" and remarks');
  } catch (err) {
    fail('Sales Agent successfully marks assigned lead as Rejected with reason "Other" and remarks', err);
  }

  // ---------------------------------------------------------------------------
  // Suite 3: State Invariants & Invariant Safeguards
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: State Invariants & Invariant Safeguards ---');

  // Test 8: Cannot re-reject an already rejected lead
  try {
    const res = await service.rejectEnquiry(lead1Id.toString(), { reason: 'Not interested' }, adminUser);
    assert(res.success === false, 'Duplicate rejection blocked');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    assert(res.message?.includes('already been marked as closed/rejected'), 'Informs lead is already closed');
    pass('Duplicate rejection submission is rejected with HTTP 400');
  } catch (err) {
    fail('Duplicate rejection submission is rejected with HTTP 400', err);
  }

  // Test 9: Cannot reject finalized completed deal
  try {
    const res = await service.rejectEnquiry(lead3Id.toString(), { reason: 'Not interested' }, adminUser);
    assert(res.success === false, 'Completed deal rejection blocked');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    assert(res.message?.includes('completed deal'), 'Informs completed deal cannot be rejected');
    pass('Finalized completed deal cannot be rejected (HTTP 400)');
  } catch (err) {
    fail('Finalized completed deal cannot be rejected (HTTP 400)', err);
  }

  // Test 10: Cannot update workflow step or advance a rejected lead
  try {
    const res = await service.saveWorkflowStep(
      lead1Id.toString(),
      { step: 'FOLLOW_UP', notes: 'Trying to update rejected lead' },
      salesRahul
    );
    assert(res.success === false, 'Workflow update on rejected lead blocked');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    assert(res.message?.includes('Cannot update workflow'), 'Explains closed/rejected guard');
    pass('Rejected lead cannot advance workflow or be marked Deal Done (HTTP 400)');
  } catch (err) {
    fail('Rejected lead cannot advance workflow or be marked Deal Done (HTTP 400)', err);
  }

  // Test 11: Cannot qualify a rejected lead
  try {
    const res = await service.qualifyLead(
      lead1Id.toString(),
      { budgetStatus: 'VERIFIED_BUDGET', timeline: 'IMMEDIATE' } as any,
      salesRahul
    );
    assert(res.success === false, 'Qualification on rejected lead blocked');
    assert(res.statusCode === 400, 'Returns HTTP 400');
    pass('Rejected lead cannot be qualified in qualification matrix (HTTP 400)');
  } catch (err) {
    fail('Rejected lead cannot be qualified in qualification matrix (HTTP 400)', err);
  }

  // Test 12: Activity audit log contains immutable STATUS_CHANGED record
  try {
    const rejectionAct = activityStore.find((a) => a.enquiryId.toString() === lead2Id.toString() && a.type === 'STATUS_CHANGED');
    assert(Boolean(rejectionAct), 'STATUS_CHANGED activity event created');
    assert(rejectionAct.note.includes('[Lead Rejected / Lost]'), 'Activity note specifies rejection');
    assert(rejectionAct.note.includes('Previous Stage: MEETING_PLAN'), 'Note includes previous stage');
    assert(rejectionAct.note.includes('Reason: Other'), 'Note includes reason');
    assert(rejectionAct.performedByName === 'Priya Patel', 'Recorded who performed rejection');
    pass('Immutable STATUS_CHANGED activity event records who, when, previous stage, reason, and remarks');
  } catch (err) {
    fail('Immutable STATUS_CHANGED activity event records who, when, previous stage, reason, and remarks', err);
  }

  // ---------------------------------------------------------------------------
  // Suite 4: Dashboard Metrics & Query Scoping
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Dashboard Metrics & Query Scoping ---');

  // Test 13: Dashboard summary excludes rejected leads from active pipeline
  try {
    const summaryRes = await service.getDashboardSummary(adminUser);
    assert(summaryRes.success === true, 'getDashboardSummary succeeds');
    assert(summaryRes.data?.activePipelineCount === 0, `Active pipeline excludes rejected leads (expected 0, got ${summaryRes.data?.activePipelineCount})`);
    assert(summaryRes.data?.completedDealsCount === 1, `Completed deals count remains exactly 1 (got ${summaryRes.data?.completedDealsCount})`);
    assert(summaryRes.data?.rejectedCount === 2, `Dashboard summary provides rejectedCount (expected 2, got ${summaryRes.data?.rejectedCount})`);
    pass('Dashboard metrics exclude rejected leads from active pipeline and accurately report rejectedCount');
  } catch (err) {
    fail('Dashboard metrics exclude rejected leads from active pipeline and accurately report rejectedCount', err);
  }

  // Test 14: listEnquiries with rejected=true returns real persisted rejected records
  try {
    const listRes = await service.listEnquiries({ rejected: true }, adminUser);
    assert(listRes.success === true, 'listEnquiries with rejected=true succeeds');
    assert(listRes.enquiries.length === 2, `Admin sees all 2 rejected leads (got ${listRes.enquiries.length})`);
    assert(listRes.enquiries.every((e) => e.status === 'CLOSED'), 'All returned enquiries have status CLOSED');
    assert(listRes.enquiries.every((e) => Boolean(e.rejection?.reason)), 'All returned enquiries have rejection reason');
    pass('Admin listEnquiries with rejected=true retrieves all organization rejected leads');
  } catch (err) {
    fail('Admin listEnquiries with rejected=true retrieves all organization rejected leads', err);
  }

  // Test 15: Sales listEnquiries with rejected=true returns only their own rejected leads
  try {
    const salesList = await service.listEnquiries({ rejected: true }, salesPriya);
    assert(salesList.success === true, 'listEnquiries for Sales Priya succeeds');
    assert(salesList.enquiries.length === 1, `Priya sees only her 1 rejected lead (got ${salesList.enquiries.length})`);
    assert(salesList.enquiries[0].name === 'Sunita Mehra', 'Returned Priya\'s lead Sunita Mehra');
    pass('Sales Agent listEnquiries with rejected=true is strictly scoped to own rejected leads');
  } catch (err) {
    fail('Sales Agent listEnquiries with rejected=true is strictly scoped to own rejected leads', err);
  }

  // ---------------------------------------------------------------------------
  // Suite 5: Active Lead Filtering, Isolation & Workflow Continuity
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Active Lead Filtering, Isolation & Workflow Continuity ---');

  // Seed a fresh active lead for Rahul to test active pipeline continuity
  const activeLeadId = new Types.ObjectId();
  enquiryStore.push({
    _id: activeLeadId,
    id: activeLeadId.toString(),
    name: 'Karan Kapoor',
    mobile: '9876543299',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesRahulId,
    currentStage: 'FOLLOW_UP',
    projectName: 'Sunrise Apartments'
  });

  // Test 16: Active enquiry list strictly excludes rejected and completed leads
  try {
    const activeList = await service.listEnquiries({ status: 'ACTIVE' }, adminUser);
    assert(activeList.success === true, 'listEnquiries with status=ACTIVE succeeds');
    assert(activeList.enquiries.some((e) => e.name === 'Karan Kapoor'), 'Contains active lead Karan Kapoor');
    assert(!activeList.enquiries.some((e) => e.name === 'Amit Verma'), 'Excludes rejected lead Amit Verma from active leads');
    assert(!activeList.enquiries.some((e) => e.name === 'Sunita Mehra'), 'Excludes rejected lead Sunita Mehra from active leads');
    assert(!activeList.enquiries.some((e) => e.name === 'Rajesh Khanna'), 'Excludes completed deal Rajesh Khanna from active leads');
    pass('A rejected lead disappears from active New Leads after refresh/status=ACTIVE');
  } catch (err) {
    fail('A rejected lead disappears from active New Leads after refresh/status=ACTIVE', err);
  }

  // Test 17: Query with rejected=false explicitly excludes rejected leads
  try {
    const nonRejectedList = await service.listEnquiries({ rejected: false }, adminUser);
    assert(nonRejectedList.success === true, 'listEnquiries with rejected=false succeeds');
    assert(!nonRejectedList.enquiries.some((e) => Boolean(e.rejection?.reason)), 'No leads in rejected=false have rejection details');
    assert(!nonRejectedList.enquiries.some((e) => e.status === 'CLOSED'), 'No CLOSED leads in rejected=false list');
    pass('listEnquiries with rejected=false strictly excludes all rejected records');
  } catch (err) {
    fail('listEnquiries with rejected=false strictly excludes all rejected records', err);
  }

  // Test 18: Authorized detail page remains accessible and preserves rejection details
  try {
    const detailRes = await service.getEnquiryById(lead1Id.toString(), adminUser);
    assert(detailRes.success === true, 'getEnquiryById for rejected lead succeeds');
    assert(detailRes.enquiry?.rejection?.reason === 'Budget too high', 'Preserves rejection reason');
    assert(detailRes.enquiry?.rejection?.previousStage === 'FOLLOW_UP', 'Preserves previous workflow stage');
    assert(detailRes.enquiry?.rejection?.rejectedByName === 'Manager Vikram', 'Preserves rejectedBy actor name');
    assert(detailRes.enquiry?.status === 'CLOSED', 'Preserves CLOSED status');
    assert(detailRes.enquiry?.assignedTo?.toString() === salesRahulId.toString(), 'Preserves responsible Sales Agent');
    pass('Authorized detail view remains accessible and preserves rejection details');
  } catch (err) {
    fail('Authorized detail view remains accessible and preserves rejection details', err);
  }

  // Test 19: Normal active lead still appears in New Leads and can continue through workflow
  try {
    const advanceRes = await service.saveWorkflowStep(
      activeLeadId.toString(),
      { step: 'FOLLOW_UP', notes: 'Discussed initial budget and unit floor plans.' },
      salesRahul
    );
    assert(advanceRes.success === true, 'Normal active lead continues through workflow successfully');
    pass('Normal active lead still appears in New Leads and can continue through workflow');
  } catch (err) {
    fail('Normal active lead still appears in New Leads and can continue through workflow', err);
  }

  // Test 20: Completed deals remain in Completed Deals, separated from rejected leads
  try {
    const dealsRes = await service.listCompletedDeals({}, adminUser);
    assert(dealsRes.success === true, 'listCompletedDeals succeeds');
    assert(dealsRes.deals.some((d) => d.name === 'Rajesh Khanna'), 'Completed deals includes confirmed deal Rajesh Khanna');
    assert(!dealsRes.deals.some((d) => Boolean(d.rejection?.reason)), 'Completed deals NEVER includes rejected leads');
    assert(!dealsRes.deals.some((d) => d.name === 'Amit Verma'), 'Rejected lead Amit Verma is not in Completed Deals');
    pass('Completed deals remain in Completed Deals, distinct from rejected leads');
  } catch (err) {
    fail('Completed deals remain in Completed Deals, distinct from rejected leads', err);
  }

  console.log('\n====================================================');
  console.log(`Lead Rejection Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLeadRejectionTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
