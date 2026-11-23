/**
 * Neuways CRM - Dashboard Summary Calculations & Completed Deals Test Suite
 *
 * Verifies:
 * 1. Stage-wise lead counts vs activity counts are strictly separated.
 * 2. Pending follow-ups include incomplete activities due today or overdue.
 * 3. Future follow-ups include incomplete activities scheduled from tomorrow onward.
 * 4. Completed activities are strictly excluded from pending & future follow-up summaries.
 * 5. Completed deals are excluded from the Active Leads table.
 * 6. Completed deals endpoint enforces RBAC (Sales sees own, Manager/Admin see all).
 * 7. Completed deal records contain all required business fields.
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { User, IUser } from '../models/user.model.js';
import { FollowUpTask, IFollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
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

async function runTests() {
  console.log('====================================================');
  console.log('Starting Dashboard Data & Completed Deals Test Suite');
  console.log('====================================================\n');

  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Admin User'
  };

  const managerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'manager@neuways.com',
    role: 'MANAGER',
    name: 'Manager User'
  };

  const salesAgentA: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.a@neuways.com',
    role: 'SALES',
    name: 'Agent A'
  };

  const salesAgentB: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent.b@neuways.com',
    role: 'SALES',
    name: 'Agent B'
  };

  const service = new EnquiryService();

  // Ensure readyState is treated as connected for tests
  (mongoose.connection as any).readyState = 1;

  // Mock User.find for manager team scoping
  (User as any).find = function (filter: any) {
    let users: any[] = [];
    if (filter?.managerId?.toString() === managerActor.id) {
      users = [{ _id: new Types.ObjectId(salesAgentA.id) }, { _id: new Types.ObjectId(salesAgentB.id) }];
    }
    return {
      select: () => ({
        lean: () => Promise.resolve(users),
        then: (resolve: any) => Promise.resolve(users).then(resolve)
      }),
      lean: () => Promise.resolve(users),
      then: (resolve: any) => Promise.resolve(users).then(resolve)
    };
  };

  // In-memory test store
  const inMemoryEnquiries: any[] = [];
  const inMemoryTasks: any[] = [];

  // Mock Enquiry.find, countDocuments
  (Enquiry as any).find = function (filter: any) {
    let result = [...inMemoryEnquiries];

    if (filter) {
      if (filter.status) {
        result = result.filter((e) => e.status === filter.status);
      }
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const ids = filter.assignedTo.$in.map((id: any) => id.toString());
          result = result.filter((e) => {
            if (!e.assignedTo) return false;
            const assignedId = e.assignedTo._id ? e.assignedTo._id.toString() : e.assignedTo.toString();
            return ids.includes(assignedId);
          });
        } else {
          result = result.filter((e) => {
            if (!e.assignedTo) return false;
            const assignedId = e.assignedTo._id ? e.assignedTo._id.toString() : e.assignedTo.toString();
            return assignedId === filter.assignedTo.toString();
          });
        }
      }
      if (filter['dealDone.isConfirmed'] && filter['dealDone.isConfirmed'].$ne !== undefined) {
        result = result.filter((e) => e.dealDone?.isConfirmed !== filter['dealDone.isConfirmed'].$ne);
      } else if (filter['dealDone.isConfirmed'] === true) {
        result = result.filter((e) => e.dealDone?.isConfirmed === true);
      }
      if (filter.currentStage && filter.currentStage.$ne !== undefined) {
        result = result.filter((e) => e.currentStage !== filter.currentStage.$ne);
      } else if (filter.currentStage) {
        result = result.filter((e) => e.currentStage === filter.currentStage);
      }
      if (filter.$or && Array.isArray(filter.$or)) {
        result = result.filter((e) =>
          filter.$or.some((cond: any) => {
            if (cond.currentStage) return e.currentStage === cond.currentStage;
            if (cond.name && cond.name.test) return cond.name.test(e.name || '');
            if (cond.mobile && cond.mobile.test) return cond.mobile.test(e.mobile || '');
            if (cond.projectName && cond.projectName.test) return cond.projectName.test(e.projectName || '');
            return false;
          })
        );
      }
    }

    const mockChain: any = {
      populate: () => mockChain,
      sort: () => mockChain,
      select: () => mockChain,
      skip: (s: number) => {
        result = result.slice(s);
        return mockChain;
      },
      limit: (l: number) => {
        result = result.slice(0, l);
        return mockChain;
      },
      lean: () => Promise.resolve(result),
      then: (resolve: any) => resolve(result)
    };
    return mockChain;
  };

  (Enquiry as any).countDocuments = function (filter: any) {
    let count = inMemoryEnquiries.length;
    if (filter) {
      let filtered = [...inMemoryEnquiries];
      if (filter.status) {
        filtered = filtered.filter((e) => e.status === filter.status);
      }
      if (filter.assignedTo) {
        filtered = filtered.filter((e) => {
          if (!e.assignedTo) return false;
          const assignedId = e.assignedTo._id ? e.assignedTo._id.toString() : e.assignedTo.toString();
          return assignedId === filter.assignedTo.toString();
        });
      }
      if (filter['dealDone.isConfirmed'] && filter['dealDone.isConfirmed'].$ne !== undefined) {
        filtered = filtered.filter((e) => e.dealDone?.isConfirmed !== filter['dealDone.isConfirmed'].$ne);
      } else if (filter['dealDone.isConfirmed'] === true) {
        filtered = filtered.filter((e) => e.dealDone?.isConfirmed === true);
      }
      if (filter.currentStage && filter.currentStage.$ne !== undefined) {
        filtered = filtered.filter((e) => e.currentStage !== filter.currentStage.$ne);
      } else if (filter.currentStage) {
        filtered = filtered.filter((e) => e.currentStage === filter.currentStage);
      }
      if (filter.createdAt && filter.createdAt.$gte) {
        filtered = filtered.filter((e) => new Date(e.createdAt) >= filter.createdAt.$gte);
      }
      count = filtered.length;
    }
    return Promise.resolve(count);
  };

  // Mock FollowUpTask.find
  (FollowUpTask as any).find = function (filter: any) {
    let result = [...inMemoryTasks];

    if (filter) {
      if (filter.status) {
        result = result.filter((t) => t.status === filter.status);
      }
      if (filter.assignedTo) {
        result = result.filter(
          (t) => t.assignedTo && t.assignedTo.toString() === filter.assignedTo.toString()
        );
      }
      if (filter.enquiryId && filter.enquiryId.$in) {
        const idStrings = filter.enquiryId.$in.map((id: any) => id.toString());
        result = result.filter((t) => idStrings.includes(t.enquiryId.toString()));
      }
    }

    const mockChain: any = {
      sort: () => mockChain,
      populate: (_field: string, _select: string) => {
        // Mock enquiry population
        const populated = result.map((t) => {
          const enq = inMemoryEnquiries.find((e) => e._id.toString() === t.enquiryId.toString());
          return {
            ...t,
            enquiryId: enq ? { currentStage: enq.currentStage, status: enq.status } : null
          };
        });
        const innerChain: any = {
          sort: () => innerChain,
          lean: () => Promise.resolve(populated),
          then: (resolve: any) => resolve(populated)
        };
        return innerChain;
      },
      lean: () => Promise.resolve(result),
      then: (resolve: any) => resolve(result)
    };
    return mockChain;
  };

  (FollowUpTask as any).countDocuments = function (filter: any) {
    let count = inMemoryTasks.length;
    if (filter?.enquiryId) {
      count = inMemoryTasks.filter(
        (t) => t.enquiryId.toString() === filter.enquiryId.toString()
      ).length;
    }
    return Promise.resolve(count);
  };

  (FollowUpTask as any).updateMany = function () {
    return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
  };

  // -------------------------------------------------------------
  // Test Data Setup
  // -------------------------------------------------------------
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Lead 1: Agent A, Stage 1 (FOLLOW_UP), has overdue pending CALL task
  const lead1Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead1Id,
    name: 'Lead Alpha (Stage 1 Pending)',
    mobile: '+919876500001',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    createdAt: yesterday
  });

  // Task 1: Overdue pending CALL for Lead 1 (due yesterday) -> Pending Follow-up Stage 1 Contacted
  inMemoryTasks.push({
    _id: new Types.ObjectId(),
    enquiryId: lead1Id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'CALL',
    followUpDate: yesterday,
    status: 'PENDING'
  });

  // Lead 2: Agent A, Stage 2 (MEETING_PLAN), has pending MEETING task due today
  const lead2Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead2Id,
    name: 'Lead Beta (Stage 2 Meeting Due Today)',
    mobile: '+919876500002',
    status: 'ACTIVE',
    currentStage: 'MEETING_PLAN',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    createdAt: yesterday
  });

  // Task 2: Meeting due today -> Pending Follow-up Stage 2 Meeting
  inMemoryTasks.push({
    _id: new Types.ObjectId(),
    enquiryId: lead2Id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'MEETING',
    followUpDate: now,
    status: 'PENDING'
  });

  // Lead 3: Agent A, Stage 3 (SITE_VISIT_PLAN), has future SITE_VISIT task scheduled for tomorrow
  const lead3Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead3Id,
    name: 'Lead Gamma (Stage 3 Future Site Visit)',
    mobile: '+919876500003',
    status: 'ACTIVE',
    currentStage: 'SITE_VISIT_PLAN',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    createdAt: yesterday
  });

  // Task 3: Site visit tomorrow -> Future Follow-up Stage 3 Site Visit
  inMemoryTasks.push({
    _id: new Types.ObjectId(),
    enquiryId: lead3Id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'SITE_VISIT',
    followUpDate: tomorrow,
    status: 'PENDING'
  });

  // Lead 4: Agent A, Stage 1 (FOLLOW_UP), has a COMPLETED follow-up task
  const lead4Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead4Id,
    name: 'Lead Delta (Stage 1 Completed Task)',
    mobile: '+919876500004',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: new Types.ObjectId(salesAgentA.id),
    createdAt: yesterday
  });

  // Task 4: COMPLETED task -> MUST NOT BE COUNTED AS PENDING OR FUTURE!
  inMemoryTasks.push({
    _id: new Types.ObjectId(),
    enquiryId: lead4Id,
    assignedTo: new Types.ObjectId(salesAgentA.id),
    purpose: 'CALL',
    followUpDate: yesterday,
    status: 'COMPLETED'
  });

  // Lead 5: Agent A, DEAL_DONE (Completed Deal)
  const lead5Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead5Id,
    name: 'Customer Completed Deal (Agent A)',
    mobile: '+919876500005',
    status: 'ACTIVE',
    currentStage: 'DEAL_DONE',
    assignedTo: { _id: new Types.ObjectId(salesAgentA.id), name: 'Agent A', email: 'agent.a@neuways.com', role: 'SALES' },
    dealDone: {
      project: 'Imperial Palms',
      propertyType: 'Penthouse',
      price: 15000000,
      size: '3200 sqft',
      remarks: 'Full payment received',
      isConfirmed: true,
      confirmedAt: yesterday
    },
    createdAt: yesterday
  });

  // Lead 6: Agent B, DEAL_DONE (Completed Deal for Agent B)
  const lead6Id = new Types.ObjectId();
  inMemoryEnquiries.push({
    _id: lead6Id,
    name: 'Customer Completed Deal (Agent B)',
    mobile: '+919876500006',
    status: 'ACTIVE',
    currentStage: 'DEAL_DONE',
    assignedTo: { _id: new Types.ObjectId(salesAgentB.id), name: 'Agent B', email: 'agent.b@neuways.com', role: 'SALES' },
    dealDone: {
      project: 'Green Vista',
      propertyType: 'Villa',
      price: 8500000,
      size: '2200 sqft',
      remarks: 'Token clearance cleared',
      isConfirmed: true,
      confirmedAt: now
    },
    createdAt: yesterday
  });

  // -------------------------------------------------------------
  // SUITE 1: Dynamic Dashboard Calculations & Summary Separation
  // -------------------------------------------------------------
  console.log('--- Suite 1: Dashboard Follow-up & Pipeline Summary Metrics ---');

  const summaryRes = await service.getDashboardSummary(salesAgentA);
  assert(summaryRes.success === true, 'getDashboardSummary returns success: true');

  const summary = summaryRes.data!;

  // Verify Active Pipeline Count excludes finalized deals (Leads 1, 2, 3, 4 = 4 leads, Lead 5 excluded)
  assert(
    summary.activePipelineCount === 4,
    `Active Pipeline Count excludes completed deals (expected 4, got ${summary.activePipelineCount})`
  );

  // Verify Pending Follow-up Count: Task 1 (Lead 1 - yesterday) + Task 2 (Lead 2 - today) = exactly 2
  assert(
    summary.pendingFollowUpsCount === 2,
    `Pending Follow-ups count includes overdue and today tasks (expected 2, got ${summary.pendingFollowUpsCount})`
  );

  // Verify Future Follow-up Count: Task 3 (Lead 3 - tomorrow) = exactly 1
  assert(
    summary.futureFollowUpsCount === 1,
    `Future Follow-ups count includes activities scheduled from tomorrow onward (expected 1, got ${summary.futureFollowUpsCount})`
  );

  // Verify Completed Task Exclusion: Task 4 is COMPLETED, so total pending + future = 3 (not 4)
  assert(
    summary.pendingFollowUpsCount + summary.futureFollowUpsCount === 3,
    'Completed follow-up tasks are strictly excluded from Pending and Future summaries'
  );

  // Verify Stage 1, Stage 2, Stage 3 Pending Matrix
  const pendingS1 = summary.pendingStages.find((s) => s.stage === 'Stage 1')!;
  const pendingS2 = summary.pendingStages.find((s) => s.stage === 'Stage 2')!;
  const pendingS3 = summary.pendingStages.find((s) => s.stage === 'Stage 3')!;

  assert(pendingS1.contacted === 1, 'Stage 1 Pending Contacted count is 1 (Lead 1 overdue CALL)');
  assert(pendingS1.detailShared === 0, 'Stage 1 Pending Detail Shared count is 0');
  assert(pendingS1.meeting === 'N/A', 'Stage 1 Pending Meeting is N/A');
  assert(pendingS1.siteVisit === 'N/A', 'Stage 1 Pending Site Visit is N/A');

  assert(pendingS2.meeting === 1, 'Stage 2 Pending Meeting count is 1 (Lead 2 today MEETING)');
  assert(pendingS2.contacted === 'N/A', 'Stage 2 Pending Contacted is N/A');
  assert(pendingS2.detailShared === 'N/A', 'Stage 2 Pending Detail Shared is N/A');
  assert(pendingS2.siteVisit === 'N/A', 'Stage 2 Pending Site Visit is N/A');

  assert(pendingS3.siteVisit === 0, 'Stage 3 Pending Site Visit count is 0 (Task 3 is tomorrow, not pending)');
  assert(pendingS3.contacted === 'N/A', 'Stage 3 Pending Contacted is N/A');
  assert(pendingS3.detailShared === 'N/A', 'Stage 3 Pending Detail Shared is N/A');
  assert(pendingS3.meeting === 'N/A', 'Stage 3 Pending Meeting is N/A');

  // Verify Future Matrix: Stage 3 Site Visit has 1, non-applicable cells are N/A
  const futureS1 = summary.futureStages.find((s) => s.stage === 'Stage 1')!;
  const futureS2 = summary.futureStages.find((s) => s.stage === 'Stage 2')!;
  const futureS3 = summary.futureStages.find((s) => s.stage === 'Stage 3')!;

  assert(futureS1.contacted === 0, 'Stage 1 Future Contacted count is 0');
  assert(futureS1.detailShared === 0, 'Stage 1 Future Detail Shared count is 0');
  assert(futureS1.meeting === 'N/A', 'Stage 1 Future Meeting is N/A');
  assert(futureS1.siteVisit === 'N/A', 'Stage 1 Future Site Visit is N/A');

  assert(futureS2.meeting === 0, 'Stage 2 Future Meeting count is 0');
  assert(futureS2.contacted === 'N/A', 'Stage 2 Future Contacted is N/A');
  assert(futureS2.detailShared === 'N/A', 'Stage 2 Future Detail Shared is N/A');
  assert(futureS2.siteVisit === 'N/A', 'Stage 2 Future Site Visit is N/A');

  assert(futureS3.siteVisit === 1, 'Stage 3 Future Site Visit count is 1 (Lead 3 tomorrow SITE_VISIT)');
  assert(futureS3.contacted === 'N/A', 'Stage 3 Future Contacted is N/A');
  assert(futureS3.detailShared === 'N/A', 'Stage 3 Future Detail Shared is N/A');
  assert(futureS3.meeting === 'N/A', 'Stage 3 Future Meeting is N/A');

  // -------------------------------------------------------------
  // SUITE 2: Exclusion of Completed Deals from Active Lead Table
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Active Lead List Excludes Finalized Deals ---');

  const activeLeadsRes = await service.listEnquiries({ status: 'ACTIVE' }, salesAgentA);
  assert(activeLeadsRes.success === true, 'listEnquiries returns success: true');

  const activeLeadIds = activeLeadsRes.enquiries.map((e: any) => e._id.toString());
  assert(
    !activeLeadIds.includes(lead5Id.toString()),
    'Active lead query strictly excludes finalized completed deal Lead 5'
  );
  assert(
    !activeLeadIds.includes(lead6Id.toString()),
    'Active lead query strictly excludes finalized completed deal Lead 6'
  );
  assert(
    activeLeadIds.includes(lead1Id.toString()) && activeLeadIds.includes(lead2Id.toString()),
    'Active pipeline leads (Stage 1, Stage 2) remain present in active leads list'
  );

  // -------------------------------------------------------------
  // SUITE 3: Completed Deals Endpoint & Role-Based Access Control
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: Completed Deals Endpoint & RBAC ---');

  // Agent A should see only Lead 5 (assigned to Agent A)
  const agentADeals = await service.listCompletedDeals({}, salesAgentA);
  assert(agentADeals.success === true, 'listCompletedDeals succeeds for Sales Agent A');
  assert(
    agentADeals.deals.length === 1,
    `Sales Agent A sees only their own completed deal (expected 1, got ${agentADeals.deals.length})`
  );
  assert(
    agentADeals.deals[0]._id.toString() === lead5Id.toString(),
    'Deal returned matches Lead 5 assigned to Agent A'
  );

  // Manager sees all completed deals (Lead 5 + Lead 6)
  const managerDeals = await service.listCompletedDeals({}, managerActor);
  assert(managerDeals.success === true, 'listCompletedDeals succeeds for Manager');
  assert(
    managerDeals.deals.length === 2,
    `Manager sees all organization completed deals (expected 2, got ${managerDeals.deals.length})`
  );

  // Admin sees all completed deals (Lead 5 + Lead 6)
  const adminDeals = await service.listCompletedDeals({}, adminActor);
  assert(adminDeals.success === true, 'listCompletedDeals succeeds for Admin');
  assert(
    adminDeals.deals.length === 2,
    `Admin sees all organization completed deals (expected 2, got ${adminDeals.deals.length})`
  );

  // -------------------------------------------------------------
  // SUITE 4: Deal Attributes & Information Integrity
  // -------------------------------------------------------------
  console.log('\n--- Suite 4: Completed Deal Record Schema & Fields ---');

  const dealSample = agentADeals.deals[0];
  assert(Boolean(dealSample.name), 'Completed deal record preserves customer name');
  assert(Boolean(dealSample.mobile), 'Completed deal record preserves full mobile contact');
  assert(dealSample.dealDone?.project === 'Imperial Palms', 'Preserves confirmed project name');
  assert(dealSample.dealDone?.propertyType === 'Penthouse', 'Preserves confirmed property type');
  assert(dealSample.dealDone?.price === 15000000, 'Preserves final deal price');
  assert(dealSample.dealDone?.size === '3200 sqft', 'Preserves unit size');
  assert(Boolean(dealSample.dealDone?.confirmedAt), 'Preserves deal confirmation timestamp');
  assert(dealSample.dealDone?.isConfirmed === true, 'isConfirmed flag is true');

  // Summary report
  console.log('\n====================================================');
  console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
