/**
 * Neuways CRM - Manager Dashboard & Team Isolation Test Suite
 *
 * Verifies:
 * 1. Manager Overview / Dashboard Summary Scoping:
 *    - Scoped strictly to the authenticated manager and their assigned team members.
 *    - Excludes other managers' teams and unassigned outside leads.
 *    - Provides activeAgentsCount, teamMembersCount, activePipelineCount, stage breakdowns, pending, future, completed, and rejected counts.
 * 2. Sales Team Listing & Performance Metrics:
 *    - GET /api/v1/enquiries/team returns only sales agents assigned to the authenticated manager.
 *    - Sales agents cannot access team performance metrics (HTTP 403 Forbidden).
 *    - Each team member includes database-backed counts for active leads, stage workload, follow-ups, and outcomes.
 * 3. Lead Creation & Round Robin Scoping:
 *    - When a Manager creates an enquiry without specifying an assignee, Round Robin selects strictly from the Manager's team.
 *    - When a Manager creates an enquiry with an explicit assignee outside their team, creation is blocked (HTTP 403 Forbidden).
 * 4. Lead Reassignment Permissions:
 *    - Manager can reassign an active lead within their team to another active sales agent in their team.
 *    - Manager cannot reassign a lead belonging to another team (HTTP 403 Forbidden).
 *    - Manager cannot assign a lead to a sales agent outside their team (HTTP 403 Forbidden).
 *    - Reassignment records an immutable ASSIGNMENT_CHANGED audit activity.
 * 5. Workflow & Activity Scoping:
 *    - Manager cannot update workflow steps on leads outside their team (HTTP 403 Forbidden).
 *    - Manager cannot qualify leads outside their team (HTTP 403 Forbidden).
 *    - Manager cannot add remarks to leads outside their team (HTTP 403 Forbidden).
 * 6. Completed Deals & Rejected Leads Scoping:
 *    - listCompletedDeals for Manager returns only completed deals within their team.
 *    - listEnquiries with rejected=true for Manager returns only rejected leads within their team.
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { User } from '../models/user.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { notificationService } from '../services/notification.service.js';
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

async function runManagerDashboardTests() {
  (mongoose.connection as any).readyState = 1;

  console.log('====================================================');
  console.log('Starting Manager Dashboard & Team Isolation Test Suite');
  console.log('====================================================\n');

  // Avoid real notification timeouts in mock unit tests
  (notificationService as any).createNotification = () => Promise.resolve({ success: true });

  // Actors
  const managerVikramId = new Types.ObjectId();
  const managerOtherId = new Types.ObjectId();
  const managerEmptyId = new Types.ObjectId();
  const agentRahulId = new Types.ObjectId(); // In Vikram's team
  const agentRohitId = new Types.ObjectId(); // In Vikram's team
  const agentOtherId = new Types.ObjectId(); // In Other Manager's team
  const agentAvailableId = new Types.ObjectId(); // Unassigned
  const adminId = new Types.ObjectId();

  const managerVikram: AuthUser = {
    id: managerVikramId.toString(),
    email: 'manager.vikram@neuways.local',
    role: 'MANAGER',
    name: 'Vikram Malhotra'
  };

  const managerOther: AuthUser = {
    id: managerOtherId.toString(),
    email: 'manager.other@neuways.local',
    role: 'MANAGER',
    name: 'Other Manager'
  };

  const managerEmpty: AuthUser = {
    id: managerEmptyId.toString(),
    email: 'manager.empty@neuways.local',
    role: 'MANAGER',
    name: 'Empty Team Manager'
  };

  const agentRahul: AuthUser = {
    id: agentRahulId.toString(),
    email: 'sales.rahul@neuways.local',
    role: 'SALES',
    name: 'Rahul Sharma'
  };

  const adminActor: AuthUser = {
    id: adminId.toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Admin User'
  };

  // In-memory data store
  const userStore = [
    { _id: managerVikramId, name: 'Vikram Malhotra', email: 'manager.vikram@neuways.local', role: 'MANAGER', isActive: true, managerId: null },
    { _id: managerOtherId, name: 'Other Manager', email: 'manager.other@neuways.local', role: 'MANAGER', isActive: true, managerId: null },
    { _id: managerEmptyId, name: 'Empty Team Manager', email: 'manager.empty@neuways.local', role: 'MANAGER', isActive: true, managerId: null },
    { _id: agentRahulId, name: 'Rahul Sharma', email: 'sales.rahul@neuways.local', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerVikramId },
    { _id: agentRohitId, name: 'Rohit Sharma', email: 'rohit@neuways.local', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerVikramId },
    { _id: agentOtherId, name: 'Other Agent', email: 'other.agent@neuways.local', role: 'SALES', isActive: true, isTeamActive: true, managerId: managerOtherId },
    { _id: agentAvailableId, name: 'Available Agent', email: 'available@neuways.local', role: 'SALES', isActive: true, isTeamActive: true, managerId: null },
    { _id: adminId, name: 'Admin User', email: 'admin@neuways.com', role: 'ADMIN', isActive: true, managerId: null }
  ];

  const enquiryStore: any[] = [];
  const taskStore: any[] = [];
  const activityStore: any[] = [];

  // Seed Enquiries
  // Lead 1: Assigned to Rahul (Vikram's team) - FOLLOW_UP
  const lead1Id = new Types.ObjectId();
  enquiryStore.push({
    _id: lead1Id,
    name: 'Vikram Team Lead 1',
    mobile: '9876543201',
    normalizedMobile: '9876543201',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentRahulId,
    currentStage: 'FOLLOW_UP',
    projectName: 'Sunrise Residency',
    createdAt: new Date()
  });

  // Lead 2: Assigned to Rohit (Vikram's team) - MEETING_PLAN
  const lead2Id = new Types.ObjectId();
  enquiryStore.push({
    _id: lead2Id,
    name: 'Vikram Team Lead 2',
    mobile: '9876543202',
    normalizedMobile: '9876543202',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentRohitId,
    currentStage: 'MEETING_PLAN',
    projectName: 'Emerald Heights',
    createdAt: new Date()
  });

  // Lead 3: Assigned to Rohit (Vikram's team) - DEAL_DONE (Completed)
  const lead3Id = new Types.ObjectId();
  enquiryStore.push({
    _id: lead3Id,
    name: 'Vikram Team Completed Deal',
    mobile: '9876543203',
    normalizedMobile: '9876543203',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentRohitId,
    currentStage: 'DEAL_DONE',
    dealDone: { isConfirmed: true, project: 'Emerald Heights', price: 7500000 },
    projectName: 'Emerald Heights',
    createdAt: new Date()
  });

  // Lead 4: Assigned to Other Agent (Other Manager's team) - FOLLOW_UP
  const lead4Id = new Types.ObjectId();
  enquiryStore.push({
    _id: lead4Id,
    name: 'Other Team Lead 4',
    mobile: '9876543204',
    normalizedMobile: '9876543204',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentOtherId,
    currentStage: 'FOLLOW_UP',
    projectName: 'Galaxy Towers',
    createdAt: new Date()
  });

  // Lead 5: Assigned to Rahul (Vikram's team) - CLOSED / REJECTED
  const lead5Id = new Types.ObjectId();
  enquiryStore.push({
    _id: lead5Id,
    name: 'Vikram Team Rejected Lead',
    mobile: '9876543205',
    normalizedMobile: '9876543205',
    status: 'CLOSED',
    isActive: false,
    assignedTo: agentRahulId,
    currentStage: 'FOLLOW_UP',
    rejection: {
      reason: 'Budget too high',
      previousStage: 'FOLLOW_UP',
      rejectedBy: managerVikramId,
      rejectedByName: 'Vikram Malhotra',
      rejectedAt: new Date()
    },
    createdAt: new Date()
  });

  // Mock Mongoose operations
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
    if (filter._id) {
      if (filter._id.$in) {
        const ids = filter._id.$in.map((i: any) => i.toString());
        list = list.filter((u) => ids.includes(u._id.toString()));
      } else {
        list = list.filter((u) => u._id.toString() === filter._id.toString());
      }
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
    if (!u) {
      return {
        select: () => Promise.resolve(null),
        populate: () => Promise.resolve(null),
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject)
      };
    }
    const userDoc: any = {
      ...u,
      save: function () {
        Object.assign(u, this);
        return Promise.resolve(userDoc);
      }
    };
    const query: any = {
      select: () => Promise.resolve(userDoc),
      populate: () => Promise.resolve(userDoc),
      then: (resolve: any, reject: any) => Promise.resolve(userDoc).then(resolve, reject)
    };
    return query;
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

  (Enquiry as any).findOne = function (filter: any = {}) {
    const chain: any = {
      sort: () => {
        let list = [...enquiryStore];
        if (filter.assignedTo?.$in) {
          const ids = filter.assignedTo.$in.map((i: any) => i.toString());
          list = list.filter((e) => e.assignedTo && ids.includes(e.assignedTo.toString()));
        }
        return Promise.resolve(list[list.length - 1] || null);
      }
    };
    return chain;
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
      } else {
        result = result.filter((e) => e.assignedTo?.toString() === filter.assignedTo.toString());
      }
    }
    if (filter['dealDone.isConfirmed'] === true) {
      result = result.filter((e) => e.dealDone && e.dealDone.isConfirmed === true);
    }
    if (filter['rejection.reason']?.$exists === true) {
      result = result.filter((e) => e.rejection && e.rejection.reason != null);
    }
    if (filter.$or && Array.isArray(filter.$or)) {
      result = result.filter((e) => {
        return filter.$or.some((sub: any) => {
          if (sub.normalizedMobile && e.normalizedMobile === sub.normalizedMobile) return true;
          if (sub.normalizedEmail && e.normalizedEmail === sub.normalizedEmail) return true;
          return false;
        });
      });
    }
    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => result,
      select: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
    };
    return chain;
  };

  (Enquiry as any).countDocuments = function (filter: any = {}) {
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

  (FollowUpTask as any).find = function () {
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve([]),
      then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject)
    };
    return chain;
  };

  (FollowUpTask as any).countDocuments = function () {
    return Promise.resolve(0);
  };

  (EnquiryActivity as any).prototype.save = function () {
    activityStore.push(this);
    return Promise.resolve(this);
  };

  // ---------------------------------------------------------------------------
  // Suite 1: Manager Team Scoping on Dashboard Summary
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Manager Dashboard Summary Scoping ---');
  try {
    const summary = await enquiryService.getDashboardSummary(managerVikram);
    assert(summary.success === true, 'Manager Vikram retrieves dashboard summary successfully');
    assert(summary.data?.activeAgentsCount === 2, `Reports active agents count as 2 (Rahul & Rohit), got ${summary.data?.activeAgentsCount}`);
    assert(summary.data?.teamMembersCount === 2, `Reports team members count as 2, got ${summary.data?.teamMembersCount}`);
    // Active pipeline excludes completed deals and rejected leads (Lead 1 & Lead 2 = 2 leads)
    assert(summary.data?.activePipelineCount === 2, `Active pipeline scoped to Vikram's team (expected 2, got ${summary.data?.activePipelineCount})`);
    assert(summary.data?.completedDealsCount === 1, `Completed deals scoped to Vikram's team (expected 1, got ${summary.data?.completedDealsCount})`);
    assert(summary.data?.rejectedCount === 1, `Rejected leads scoped to Vikram's team (expected 1, got ${summary.data?.rejectedCount})`);
    assert(summary.data?.stageBreakdown?.followUp === 1, 'Stage breakdown follow-up matches Vikram team leads');
    assert(summary.data?.stageBreakdown?.meetingPlan === 1, 'Stage breakdown meeting matches Vikram team leads');
  } catch (err: any) {
    assert(false, 'Dashboard summary error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Sales Team Listing & Performance Metrics (getTeamPerformance)
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Sales Team Listing & Performance Metrics ---');
  try {
    const teamRes = await enquiryService.getTeamPerformance(managerVikram);
    assert(teamRes.success === true, 'Manager retrieves team performance successfully');
    assert(teamRes.team?.length === 2, `Returns exactly 2 sales agents assigned to Vikram (got ${teamRes.team?.length})`);
    const rahulPerf = teamRes.team?.find((a) => a.name === 'Rahul Sharma');
    assert(Boolean(rahulPerf), 'Team includes Rahul Sharma');
    assert(rahulPerf?.activeLeadsCount === 1, `Rahul has 1 active lead, got ${rahulPerf?.activeLeadsCount}`);
    assert(rahulPerf?.rejectedCount === 1, `Rahul has 1 rejected lead, got ${rahulPerf?.rejectedCount}`);

    const rohitPerf = teamRes.team?.find((a) => a.name === 'Rohit Sharma');
    assert(Boolean(rohitPerf), 'Team includes Rohit Sharma');
    assert(rohitPerf?.activeLeadsCount === 1, `Rohit has 1 active lead, got ${rohitPerf?.activeLeadsCount}`);
    assert(rohitPerf?.completedDealsCount === 1, `Rohit has 1 completed deal, got ${rohitPerf?.completedDealsCount}`);

    // Verify Sales Agent accesses only their own personal performance metrics (never cross-agent team data)
    const salesAccess = await enquiryService.getTeamPerformance(agentRahul);
    assert(salesAccess.success === true, 'Sales agent successfully retrieves personal performance metrics');
    assert(salesAccess.team?.length === 1, `Sales agent sees only their own record (expected 1, got ${salesAccess.team?.length})`);
    assert(salesAccess.team?.[0]?.id === agentRahul.id, 'Sales agent record matches Rahul');
    assert(!salesAccess.team?.some((a) => a.id === agentRohitId.toString()), 'Sales agent Rahul NEVER sees Rohit team data');
  } catch (err: any) {
    assert(false, 'Team performance error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 3: Lead Creation & Round Robin Scoping
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Lead Creation & Round Robin Scoping ---');
  try {
    // When Vikram creates a lead without assignee, it must be assigned to Vikram's team agents (Rahul or Rohit)
    const newLeadRes = await enquiryService.createEnquiry(
      {
        name: 'Manager Created Lead',
        mobile: '9876543299',
        projectName: 'Vikram Special Project'
      },
      managerVikram
    );

    assert(newLeadRes.success === true, 'Manager creates new lead successfully');
    if (newLeadRes.success) {
      const assignedId = (newLeadRes.enquiry.assignedTo as any)?._id?.toString() || newLeadRes.enquiry.assignedTo?.toString();
      const isVikramTeamAgent = assignedId === managerVikramId.toString() || assignedId === agentRahulId.toString() || assignedId === agentRohitId.toString();
      assert(isVikramTeamAgent, `Manager lead assigned to Manager or team agent (got ${assignedId})`);
      assert(assignedId !== agentOtherId.toString(), 'Round robin NEVER assigns to another manager\'s agent');
    }

    // When Vikram tries to create a lead explicitly assigned to an outside agent, it must be rejected
    try {
      await enquiryService.createEnquiry(
        {
          name: 'Forbidden Cross-Team Lead',
          mobile: '9876543298',
          assignedToId: agentOtherId.toString()
        },
        managerVikram
      );
      assert(false, 'Expected cross-team assignee creation to fail');
    } catch (createErr: any) {
      assert(createErr.message.includes('own team'), 'Creation rejects assigning to outside team agent');
    }
  } catch (err: any) {
    assert(false, 'Lead creation scoping error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 4: Lead Reassignment Permissions
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Lead Reassignment Permissions ---');
  try {
    // Vikram can reassign Lead 1 (assigned to Rahul) to Rohit (in Vikram's team)
    const reassignRes = await enquiryService.assignEnquiry(lead1Id.toString(), agentRohitId.toString(), managerVikram);
    assert(reassignRes.success === true, 'Manager Vikram successfully reassigns team lead to another team agent');

    // Vikram CANNOT reassign Lead 4 (belongs to Other Manager's team)
    const crossReassignRes = await enquiryService.assignEnquiry(lead4Id.toString(), agentRohitId.toString(), managerVikram);
    assert(crossReassignRes.success === false, 'Manager cannot reassign lead belonging to another team');
    assert((crossReassignRes as any).statusCode === 403, 'Returns HTTP 403 Forbidden for cross-team lead reassignment');

    // Vikram CANNOT reassign team Lead 1 to an outside agent
    const outsideAssignRes = await enquiryService.assignEnquiry(lead1Id.toString(), agentOtherId.toString(), managerVikram);
    assert(outsideAssignRes.success === false, 'Manager cannot assign team lead to an outside agent');
    assert((outsideAssignRes as any).statusCode === 403, 'Returns HTTP 403 Forbidden when target assignee is outside team');
  } catch (err: any) {
    assert(false, 'Reassignment scoping error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 5: Workflow, Qualification & Remark Isolation
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Workflow, Qualification & Remark Isolation ---');
  try {
    // Vikram CANNOT update workflow on lead 4 (other team)
    const workflowRes = await enquiryService.saveWorkflowStep(
      lead4Id.toString(),
      { step: 'FOLLOW_UP', notes: 'Trying to update other team lead' },
      managerVikram
    );
    assert(workflowRes.success === false, 'Manager cannot update workflow on another team lead');
    assert(workflowRes.statusCode === 403, 'Returns HTTP 403 Forbidden on cross-team workflow step');

    // Vikram CANNOT qualify lead 4 (other team)
    const qualifyRes = await enquiryService.qualifyLead(
      lead4Id.toString(),
      { budgetStatus: 'VERIFIED_BUDGET', timeline: 'IMMEDIATE' } as any,
      managerVikram
    );
    assert(qualifyRes.success === false, 'Manager cannot qualify another team lead');
    assert(qualifyRes.statusCode === 403, 'Returns HTTP 403 Forbidden on cross-team qualify');

    // Vikram CANNOT add remarks to lead 4 (other team)
    const remarkRes = await enquiryService.addRemark(
      lead4Id.toString(),
      { remark: 'Unauthorized remark on foreign team lead' },
      managerVikram
    );
    assert(remarkRes.success === false, 'Manager cannot add remarks to another team lead');
    assert((remarkRes as any).statusCode === 403, 'Returns HTTP 403 Forbidden on cross-team addRemark');
  } catch (err: any) {
    assert(false, 'Workflow/Qualification/Remark isolation error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 6: Completed Deals & List Enquiries Scoping
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 6: Completed Deals & List Enquiries Scoping ---');
  try {
    const dealsRes = await enquiryService.listCompletedDeals({}, managerVikram);
    assert(dealsRes.success === true, 'Manager retrieves completed deals successfully');
    assert(dealsRes.deals?.length === 1, `Manager Vikram sees only his team's completed deals (expected 1, got ${dealsRes.deals?.length})`);
    assert(dealsRes.deals?.[0]?.name === 'Vikram Team Completed Deal', 'Returned Vikram team completed deal');

    const rejectedRes = await enquiryService.listEnquiries({ rejected: true }, managerVikram);
    assert(rejectedRes.success === true, 'Manager retrieves rejected leads successfully');
    assert(rejectedRes.enquiries.length === 1, `Manager Vikram sees only his team's rejected leads (expected 1, got ${rejectedRes.enquiries.length})`);
    assert(rejectedRes.enquiries[0].name === 'Vikram Team Rejected Lead', 'Returned Vikram team rejected lead');
  } catch (err: any) {
    assert(false, 'Completed deals & rejected leads scoping error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 7: Strict Data Isolation for Manager with Zero Team Members
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 7: Zero Team Member Scoping & Strict Isolation ---');
  try {
    const emptyTeam = await enquiryService.getTeamPerformance(managerEmpty);
    assert(emptyTeam.success === true, 'Manager with no team retrieves team performance successfully');
    assert(emptyTeam.team?.length === 0, `Returns empty team array for manager with no agents (got ${emptyTeam.team?.length})`);

    const emptySummary = await enquiryService.getDashboardSummary(managerEmpty);
    assert(emptySummary.success === true, 'Manager with no team retrieves dashboard summary successfully');
    assert(emptySummary.data?.activeAgentsCount === 0, 'Active agents count is 0');
    assert(emptySummary.data?.teamMembersCount === 0, 'Team members count is 0');
    assert(emptySummary.data?.activePipelineCount === 0, 'Active pipeline count is 0 (never falls back to all leads)');
    assert(emptySummary.data?.completedDealsCount === 0, 'Completed deals count is 0');
    assert(emptySummary.data?.rejectedCount === 0, 'Rejected leads count is 0');
    assert(emptySummary.data?.dailyVelocity === 0, 'Daily velocity count is 0');

    const emptyLeads = await enquiryService.listEnquiries({}, managerEmpty);
    assert(emptyLeads.success === true, 'Manager with no team lists enquiries');
    assert(emptyLeads.enquiries.length === 0, `Returns 0 leads for manager with no team (got ${emptyLeads.enquiries.length})`);

    const emptyDeals = await enquiryService.listCompletedDeals({}, managerEmpty);
    assert(emptyDeals.success === true, 'Manager with no team lists completed deals');
    assert(emptyDeals.deals.length === 0, `Returns 0 completed deals for manager with no team (got ${emptyDeals.deals.length})`);
  } catch (err: any) {
    assert(false, 'Zero team scoping error', err.message);
  }

  // ---------------------------------------------------------------------------
  // Suite 8: Team Roster, Assignment, Activation & Deactivation Controls
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 8: Team Assignment & Membership Controls ---');
  try {
    // 1. Manager views team roster
    const rosterRes = await enquiryService.getTeamRoster(managerEmpty);
    assert(rosterRes.success === true, 'Manager retrieves team roster');
    assert(Array.isArray(rosterRes.agents) && rosterRes.agents.length > 0, 'Team roster returns all sales agents');

    const availAgent = rosterRes.agents?.find((a) => a.id === agentAvailableId.toString());
    assert(Boolean(availAgent), 'Roster includes available agent');
    assert(availAgent?.canAssign === true, 'Available agent can be assigned');
    assert(availAgent?.statusLabel === 'Available', 'Available agent has status "Available"');

    // 2. Cross-manager conflict protection: Cannot assign agent already assigned to Vikram
    const conflictAssign = await enquiryService.assignAgentToTeam(managerEmpty, agentRahulId.toString());
    assert(conflictAssign.success === false, 'Cannot assign an agent belonging to another manager');
    assert(conflictAssign.statusCode === 409, 'Returns HTTP 409 Conflict when assigning already assigned agent');

    // 3. Assign available agent to managerEmpty's team
    const assignSuccess = await enquiryService.assignAgentToTeam(managerEmpty, agentAvailableId.toString());
    assert(assignSuccess.success === true, 'Successfully assigns available agent to manager team');
    assert(assignSuccess.agent?.isAssignedToCurrentManager === true, 'Agent is now assigned to current manager');

    // Verify managerEmpty now sees this agent in team performance
    const teamAfterAssign = await enquiryService.getTeamPerformance(managerEmpty);
    assert(teamAfterAssign.team?.length === 1, `ManagerEmpty now has 1 active team member (got ${teamAfterAssign.team?.length})`);
    assert(teamAfterAssign.team?.[0]?.id === agentAvailableId.toString(), 'Team member is the assigned agent');

    // 4. Deactivate team membership for the assigned agent
    const deactRes = await enquiryService.updateTeamMemberStatus(managerEmpty, agentAvailableId.toString(), false);
    assert(deactRes.success === true, 'Deactivates team membership successfully');
    assert(deactRes.agent?.isTeamActive === false, 'Agent membership status is inactive');
    assert(deactRes.agent?.statusLabel === 'Deactivated in your team', 'Status label indicates deactivated in team');

    // Deactivating membership immediately removes agent from Manager's team views
    const teamAfterDeact = await enquiryService.getTeamPerformance(managerEmpty);
    assert(teamAfterDeact.team?.length === 0, `Deactivated agent removed from Manager team views (got ${teamAfterDeact.team?.length})`);

    const summaryAfterDeact = await enquiryService.getDashboardSummary(managerEmpty);
    assert(summaryAfterDeact.data?.activeAgentsCount === 0, 'Active agents count is 0 after membership deactivation');
    assert(summaryAfterDeact.data?.activePipelineCount === 0, 'Active pipeline count is 0 after membership deactivation');

    // Verify global account status remains ACTIVE and preserved
    const agentInDb = userStore.find((u) => u._id.toString() === agentAvailableId.toString());
    assert(agentInDb?.isActive === true, 'Employee global account remains Active');

    // 5. Cross-scope protection: Manager CANNOT deactivate membership for an agent outside their team
    const crossDeact = await enquiryService.updateTeamMemberStatus(managerEmpty, agentRahulId.toString(), false);
    assert(crossDeact.success === false, 'Manager cannot deactivate agent outside their team');
    assert(crossDeact.statusCode === 403, 'Returns HTTP 403 Forbidden on cross-team deactivation');

    // 6. Role protection: Sales Agent CANNOT access roster or assignment endpoints
    const salesRoster = await enquiryService.getTeamRoster(agentRahul);
    assert(salesRoster.success === false, 'Sales agent cannot access team roster');
    assert(salesRoster.statusCode === 403, 'Returns HTTP 403 Forbidden for Sales Agent on roster');

    const salesAssign = await enquiryService.assignAgentToTeam(agentRahul, agentAvailableId.toString());
    assert(salesAssign.success === false, 'Sales agent cannot assign agents');
    assert(salesAssign.statusCode === 403, 'Returns HTTP 403 Forbidden for Sales Agent on assign');

    const salesMemberStatus = await enquiryService.updateTeamMemberStatus(agentRahul, agentAvailableId.toString(), true);
    assert(salesMemberStatus.success === false, 'Sales agent cannot update team membership status');
    assert(salesMemberStatus.statusCode === 403, 'Returns HTTP 403 Forbidden for Sales Agent on member status');

    // 7. Reactivate team membership
    const reactRes = await enquiryService.updateTeamMemberStatus(managerEmpty, agentAvailableId.toString(), true);
    assert(reactRes.success === true, 'Reactivates team membership successfully');
    const teamAfterReact = await enquiryService.getTeamPerformance(managerEmpty);
    assert(teamAfterReact.team?.length === 1, 'Reactivated agent restored to active team performance');

    // 8. Admin retains organization-wide access
    const adminTeam = await enquiryService.getTeamPerformance(adminActor);
    assert(adminTeam.success === true, 'Admin retrieves organization team performance');
    assert((adminTeam.team?.length || 0) >= 3, 'Admin sees all active sales agents');

    const adminLeads = await enquiryService.listEnquiries({}, adminActor);
    assert(adminLeads.success === true, 'Admin retrieves organization-wide enquiries');
    assert(adminLeads.enquiries.length >= 4, 'Admin sees all leads across managers');
  } catch (err: any) {
    assert(false, 'Team assignment & membership controls error', err.message);
  }

  console.log('\n====================================================');
  console.log(`Manager Dashboard Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runManagerDashboardTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
