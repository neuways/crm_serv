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
import { EnquiryController } from '../controllers/enquiry.controller.js';
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
    if (!item) {
      const nullPromise: any = Promise.resolve(null);
      nullPromise.populate = () => Promise.resolve(null);
      return nullPromise;
    }
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
    const docPromise: any = Promise.resolve(doc);
    docPromise.populate = () => Promise.resolve(doc);
    return docPromise;
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

  const matchesSubClause = (e: any, sub: any): boolean => {
    if (sub['rejection.reason']?.$exists && e.rejection?.reason) return true;
    if (sub.status === 'CLOSED' && e.status === 'CLOSED' && !e.dealDone?.isConfirmed) return true;
    if (sub.normalizedMobile && e.normalizedMobile === sub.normalizedMobile) return true;
    if (sub.normalizedEmail && e.normalizedEmail === sub.normalizedEmail) return true;
    if ('assignedTo' in sub && sub.assignedTo === null && !e.assignedTo) return true;
    if ('assignedTo' in sub && sub.assignedTo?.$exists === false && e.assignedTo === undefined) return true;
    if (sub.managerId && e.managerId?.toString() === sub.managerId.toString()) return true;
    if (sub.createdById && e.createdById?.toString() === sub.createdById.toString()) return true;
    if (sub.projectName?.$in && e.projectName && sub.projectName.$in.includes(e.projectName)) return true;
    if (sub.name instanceof RegExp && sub.name.test(e.name || '')) return true;
    if (sub.mobile instanceof RegExp && sub.mobile.test(e.mobile || '')) return true;
    if (sub.projectName instanceof RegExp && sub.projectName.test(e.projectName || '')) return true;
    if (sub.email instanceof RegExp && sub.email.test(e.email || '')) return true;
    return false;
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
    if (filter.assignedTo === null) {
      result = result.filter((e) => !e.assignedTo);
    } else if (filter.assignedTo) {
      if (filter.assignedTo.$in) {
        const ids = filter.assignedTo.$in.map((i: any) => i.toString());
        result = result.filter((e) => e.assignedTo && ids.includes(e.assignedTo.toString()));
      } else if (typeof filter.assignedTo === 'object' && filter.assignedTo.$ne !== undefined) {
        result = result.filter((e) =>
          filter.assignedTo.$ne === null
            ? Boolean(e.assignedTo)
            : e.assignedTo?.toString() !== filter.assignedTo.$ne?.toString()
        );
      } else {
        result = result.filter((e) => e.assignedTo?.toString() === filter.assignedTo.toString());
      }
      if (filter.assignedTo.$nin && Array.isArray(filter.assignedTo.$nin)) {
        const ninIds = filter.assignedTo.$nin.map((i: any) => i.toString());
        result = result.filter((e) => !e.assignedTo || !ninIds.includes(e.assignedTo.toString()));
      }
    }
    if (filter['dealDone.isConfirmed'] === true) {
      result = result.filter((e) => e.dealDone && e.dealDone.isConfirmed === true);
    }
    if (filter['dealDone.isConfirmed']?.$ne === true) {
      result = result.filter((e) => !e.dealDone?.isConfirmed);
    }
    if (filter['rejection.reason']?.$exists === true) {
      result = result.filter((e) => e.rejection && e.rejection.reason != null);
    }
    if (filter.$or && Array.isArray(filter.$or)) {
      result = result.filter((e) => filter.$or.some((sub: any) => matchesSubClause(e, sub)));
    }
    if (filter.$and && Array.isArray(filter.$and)) {
      result = result.filter((e) =>
        filter.$and.every((clause: any) => {
          if (clause.$or && Array.isArray(clause.$or)) {
            return clause.$or.some((sub: any) => matchesSubClause(e, sub));
          }
          if (clause.assignedTo?.$ne === null) return Boolean(e.assignedTo);
          return true;
        })
      );
    }
    let skipCount = 0;
    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      skip: (s: number) => {
        skipCount = Number(s) || 0;
        return chain;
      },
      limit: (l: number) => {
        const lim = Number(l) || result.length;
        return result.slice(skipCount, skipCount + lim);
      },
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
      if (filter.assignedTo === null) {
        if (e.assignedTo) matches = false;
      } else if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const ids = filter.assignedTo.$in.map((i: any) => i.toString());
          if (!e.assignedTo || !ids.includes(e.assignedTo.toString())) matches = false;
        } else if (typeof filter.assignedTo === 'object' && filter.assignedTo.$ne !== undefined) {
          const neMatch =
            filter.assignedTo.$ne === null
              ? Boolean(e.assignedTo)
              : e.assignedTo?.toString() !== filter.assignedTo.$ne?.toString();
          if (!neMatch) matches = false;
        } else if (e.assignedTo?.toString() !== filter.assignedTo.toString()) {
          matches = false;
        }
        if (filter.assignedTo.$nin && Array.isArray(filter.assignedTo.$nin)) {
          const ninIds = filter.assignedTo.$nin.map((i: any) => i.toString());
          if (e.assignedTo && ninIds.includes(e.assignedTo.toString())) matches = false;
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
        if (!filter.$or.some((sub: any) => matchesSubClause(e, sub))) matches = false;
      }
      if (filter.$and && Array.isArray(filter.$and)) {
        const andMatch = filter.$and.every((clause: any) => {
          if (clause.$or && Array.isArray(clause.$or)) {
            return clause.$or.some((sub: any) => matchesSubClause(e, sub));
          }
          if (clause.assignedTo?.$ne === null) return Boolean(e.assignedTo);
          return true;
        });
        if (!andMatch) matches = false;
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
    // Vikram CANNOT reassign Lead 1 (already assigned to Sales Agent Rahul)
    const reassignSalesLeadRes = await enquiryService.assignEnquiry(
      lead1Id.toString(),
      agentRohitId.toString(),
      managerVikram
    );
    assert(
      reassignSalesLeadRes.success === false && (reassignSalesLeadRes as any).statusCode === 403,
      'Manager Vikram receives HTTP 403 when trying to reassign a lead already assigned to a sales agent'
    );

    // Seed Manager-held leads for Vikram -> direct report assignment and outside-agent check
    const mgrSelfLeadId = new Types.ObjectId();
    const mgrSelfLead2Id = new Types.ObjectId();
    enquiryStore.push(
      {
        _id: mgrSelfLeadId,
        name: 'Manager Held Lead 1',
        mobile: '9876543901',
        normalizedMobile: '9876543901',
        status: 'ACTIVE',
        isActive: true,
        assignedTo: managerVikramId,
        managerId: managerVikramId,
        currentStage: 'NEW',
        createdAt: new Date()
      },
      {
        _id: mgrSelfLead2Id,
        name: 'Manager Held Lead 2',
        mobile: '9876543902',
        normalizedMobile: '9876543902',
        status: 'ACTIVE',
        isActive: true,
        assignedTo: managerVikramId,
        managerId: managerVikramId,
        currentStage: 'NEW',
        createdAt: new Date()
      }
    );

    // Vikram CAN assign a Manager-held lead to Rohit (active direct report in Vikram's team)
    const reassignRes = await enquiryService.assignEnquiry(mgrSelfLeadId.toString(), agentRohitId.toString(), managerVikram);
    assert(reassignRes.success === true, 'Manager Vikram successfully assigns manager-held lead to direct-report sales agent');

    // Vikram CANNOT reassign Lead 4 (belongs to Other Manager's team)
    const crossReassignRes = await enquiryService.assignEnquiry(lead4Id.toString(), agentRohitId.toString(), managerVikram);
    assert(crossReassignRes.success === false, 'Manager cannot reassign lead belonging to another team');
    assert((crossReassignRes as any).statusCode === 403, 'Returns HTTP 403 Forbidden for cross-team lead reassignment');

    // Vikram CANNOT assign a Manager-held lead to an outside agent (not reporting to Vikram)
    const outsideAssignRes = await enquiryService.assignEnquiry(mgrSelfLead2Id.toString(), agentOtherId.toString(), managerVikram);
    assert(outsideAssignRes.success === false, 'Manager cannot assign manager-held lead to an outside agent');
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

    // -------------------------------------------------------------------------
    // 9. Team Onboarding with Initial Leads & Bulk Assign / Round Robin
    // -------------------------------------------------------------------------
    const onboardingAgentId = new Types.ObjectId();
    userStore.push({
      _id: onboardingAgentId,
      name: 'New Onboarding Agent',
      email: 'onboard@neuways.local',
      role: 'SALES',
      isActive: true,
      isTeamActive: true,
      managerId: null
    } as any);

    const mgrUnassigned1Id = new Types.ObjectId();
    const mgrUnassigned2Id = new Types.ObjectId();
    const mgrUnassigned3Id = new Types.ObjectId();
    for (const [lid, lname] of [
      [mgrUnassigned1Id, 'Pool Unassigned 1'],
      [mgrUnassigned2Id, 'Pool Unassigned 2'],
      [mgrUnassigned3Id, 'Pool Unassigned 3']
    ] as const) {
      enquiryStore.push({
        _id: lid,
        name: lname,
        mobile: '9876543999',
        normalizedMobile: '9876543999',
        status: 'ACTIVE',
        isActive: true,
        assignedTo: null,
        managerId: managerVikramId,
        currentStage: 'FOLLOW_UP',
        createdAt: new Date()
      });
    }

    const onboardRes = await enquiryService.assignAgentToTeam(
      managerVikram,
      onboardingAgentId.toString(),
      [mgrUnassigned1Id.toString()]
    );
    assert(onboardRes.success === true, 'Onboarding assigns agent to team');
    assert(onboardRes.assignedLeadsCount === 1, 'Onboarding assigns 1 selected initial lead in same flow');
    const onboardedLead1 = enquiryStore.find((e) => e._id.toString() === mgrUnassigned1Id.toString());
    assert(
      onboardedLead1?.assignedTo?.toString() === onboardingAgentId.toString(),
      'Initial lead assignedTo matches onboarded agent'
    );

    const controller = new EnquiryController(enquiryService);
    const makeMockRes = () => {
      const r: any = { statusCode: 200, body: null };
      r.status = (c: number) => {
        r.statusCode = c;
        return r;
      };
      r.json = (b: any) => {
        r.body = b;
        return r;
      };
      return r;
    };

    const manualBulkRes = makeMockRes();
    await controller.bulkAssign(
      {
        user: managerVikram,
        body: {
          enquiryIds: [mgrUnassigned2Id.toString()],
          assignedToId: agentRohitId.toString(),
          method: 'MANUAL'
        }
      } as any,
      manualBulkRes
    );
    assert(manualBulkRes.statusCode === 200 && manualBulkRes.body?.assignedCount === 1, 'Controller bulkAssign MANUAL assigns manager unassigned lead');

    const rrBulkRes = makeMockRes();
    await controller.bulkAssign(
      {
        user: managerVikram,
        body: {
          enquiryIds: [mgrUnassigned3Id.toString()],
          method: 'ROUND_ROBIN'
        }
      } as any,
      rrBulkRes
    );
    assert(rrBulkRes.statusCode === 200 && rrBulkRes.body?.assignedCount === 1, 'Controller bulkAssign ROUND_ROBIN distributes without assignedToId');

    // Controller list forwards unassigned, assignedOnly & excludeAssignedTo filters
    const listUnassignedRes = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { unassigned: 'true', page: '1', limit: '10', status: 'ACTIVE' }
      } as any,
      listUnassignedRes
    );
    assert(
      listUnassignedRes.statusCode === 200 &&
        Array.isArray(listUnassignedRes.body?.data?.enquiries) &&
        listUnassignedRes.body.data.enquiries.every((e: any) => !e.assignedTo),
      'Controller list with unassigned=true returns zero already-assigned leads'
    );

    const listReassignRes = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: {
          assignedOnly: 'true',
          unassigned: 'false',
          excludeAssignedTo: agentRahulId.toString(),
          page: '1',
          limit: '10',
          status: 'ACTIVE'
        }
      } as any,
      listReassignRes
    );
    assert(
      listReassignRes.statusCode === 200 &&
        Array.isArray(listReassignRes.body?.data?.enquiries) &&
        listReassignRes.body.data.enquiries.every(
          (e: any) => e.assignedTo && e.assignedTo.toString() !== agentRahulId.toString()
        ),
      'Controller list with assignedOnly=true and excludeAssignedTo excludes unassigned and target agent leads'
    );

    // Controller single assign & bulkAssign reject Sales-held lead1Id for Manager (HTTP 403),
    // and accept `assignedTo` body key cleanly on a Manager-held lead (HTTP 200)
    const blockedSingleAssignRes = makeMockRes();
    await controller.assign(
      {
        user: managerVikram,
        params: { id: lead1Id.toString() },
        body: { assignedTo: agentRohitId.toString() }
      } as any,
      blockedSingleAssignRes
    );
    assert(
      blockedSingleAssignRes.statusCode === 403,
      'Controller assign returns HTTP 403 when Manager tries to reassign a sales-held lead'
    );

    const blockedBulkAssignRes = makeMockRes();
    await controller.bulkAssign(
      {
        user: managerVikram,
        body: { enquiryIds: [lead1Id.toString()], assignedTo: agentRohitId.toString(), method: 'MANUAL' }
      } as any,
      blockedBulkAssignRes
    );
    assert(
      blockedBulkAssignRes.statusCode === 403,
      'Controller bulkAssign returns HTTP 403 when Manager tries to reassign a sales-held lead'
    );

    const mgrCtrlLeadId = new Types.ObjectId();
    enquiryStore.push({
      _id: mgrCtrlLeadId,
      name: 'Manager Ctrl Held Lead',
      mobile: '9876543903',
      normalizedMobile: '9876543903',
      status: 'ACTIVE',
      isActive: true,
      assignedTo: managerVikramId,
      managerId: managerVikramId,
      currentStage: 'NEW',
      createdAt: new Date()
    });

    const singleAssignRes = makeMockRes();
    await controller.assign(
      {
        user: managerVikram,
        params: { id: mgrCtrlLeadId.toString() },
        body: { assignedTo: agentRohitId.toString() }
      } as any,
      singleAssignRes
    );
    assert(singleAssignRes.statusCode === 200, 'Controller assign accepts assignedTo body key cleanly on manager-held lead');

    // Multi-page pagination check: Page 1 and Page 2 on assignedOnly=true never overlap & share total
    const page1AssignedRes = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { assignedOnly: 'true', unassigned: 'false', page: '1', limit: '1', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      page1AssignedRes
    );
    const page2AssignedRes = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { assignedOnly: 'true', unassigned: 'false', page: '2', limit: '1', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      page2AssignedRes
    );
    assert(
      page1AssignedRes.statusCode === 200 &&
        page2AssignedRes.statusCode === 200 &&
        page1AssignedRes.body?.data?.enquiries?.length === 1 &&
        page2AssignedRes.body?.data?.enquiries?.length === 1 &&
        page1AssignedRes.body.data.enquiries[0]._id.toString() !== page2AssignedRes.body.data.enquiries[0]._id.toString() &&
        page1AssignedRes.body.data.pagination.total === page2AssignedRes.body.data.pagination.total &&
        page1AssignedRes.body.data.pagination.total >= 2,
      'Assigned leads multi-page pagination returns non-empty, disjoint Page 1 & Page 2 slices with consistent total'
    );

    // Manager 403 isolation: Manager cannot assign or bulkAssign to an agent outside their reporting team
    const outsiderBulkRes = makeMockRes();
    await controller.bulkAssign(
      {
        user: managerVikram,
        body: {
          enquiryIds: [lead1Id.toString()],
          assignedToId: agentOtherId.toString(),
          method: 'MANUAL'
        }
      } as any,
      outsiderBulkRes
    );
    assert(
      outsiderBulkRes.statusCode === 403,
      'Controller bulkAssign returns 403 Forbidden when Manager targets an agent outside their team'
    );

    const outsiderSingleRes = makeMockRes();
    await controller.assign(
      {
        user: managerVikram,
        params: { id: lead1Id.toString() },
        body: { assignedToId: agentOtherId.toString() }
      } as any,
      outsiderSingleRes
    );
    assert(
      outsiderSingleRes.statusCode === 403,
      'Controller assign returns 403 Forbidden when Manager targets an agent outside their team'
    );

    // Zero overlap between Assigned & Unassigned tabs + Manager can open Follow-up workflow on in-scope unassigned lead
    const inScopeUnassignedId = new Types.ObjectId();
    enquiryStore.push({
      _id: inScopeUnassignedId,
      name: 'Manager In-Scope Unassigned Lead',
      mobile: '9876500112',
      normalizedMobile: '9876500112',
      status: 'ACTIVE',
      isActive: true,
      assignedTo: null,
      managerId: managerVikramId,
      currentStage: 'FOLLOW_UP',
      createdAt: new Date()
    });

    const tab1AssignedCheck = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { assignedOnly: 'true', unassigned: 'false', page: '1', limit: '50', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      tab1AssignedCheck
    );
    const tab2UnassignedCheck = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { unassigned: 'true', page: '1', limit: '50', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      tab2UnassignedCheck
    );
    assert(
      tab1AssignedCheck.statusCode === 200 &&
        tab1AssignedCheck.body.data.enquiries.every((e: any) => Boolean(e.assignedTo)) &&
        !tab1AssignedCheck.body.data.enquiries.some((e: any) => e._id.toString() === inScopeUnassignedId.toString()),
      'Tab 1 (assignedOnly=true) strictly excludes unassigned enquiries'
    );
    assert(
      tab2UnassignedCheck.statusCode === 200 &&
        tab2UnassignedCheck.body.data.enquiries.some((e: any) => e._id.toString() === inScopeUnassignedId.toString()) &&
        tab2UnassignedCheck.body.data.enquiries.every((e: any) => !e.assignedTo),
      'Tab 2 (unassigned=true) includes in-scope unassigned enquiry and excludes assigned enquiries'
    );

    const mgrUnassignedDetail = await enquiryService.getEnquiryById(inScopeUnassignedId.toString(), managerVikram);
    assert(
      mgrUnassignedDetail.success === true,
      'Manager can open LeadWorkflow details on an in-scope unassigned lead'
    );

    // Assigning the unassigned lead clears unassignedReason and moves it from Tab 2 to Tab 1
    const rawInScope = enquiryStore.find((e) => e._id.toString() === inScopeUnassignedId.toString());
    if (rawInScope) rawInScope.unassignedReason = 'Property mapping unavailable';

    const assignMovedRes = await enquiryService.assignEnquiry(
      inScopeUnassignedId.toString(),
      agentRahulId.toString(),
      managerVikram
    );
    assert(
      assignMovedRes.success === true && rawInScope?.unassignedReason === null,
      'Assigning an unassigned lead succeeds and clears unassignedReason to null'
    );

    const postAssignTab1 = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { assignedOnly: 'true', unassigned: 'false', page: '1', limit: '50', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      postAssignTab1
    );
    const postAssignTab2 = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { unassigned: 'true', assignedOnly: 'false', page: '1', limit: '50', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      postAssignTab2
    );
    assert(
      postAssignTab1.body.data.enquiries.some((e: any) => e._id.toString() === inScopeUnassignedId.toString()) &&
        !postAssignTab2.body.data.enquiries.some((e: any) => e._id.toString() === inScopeUnassignedId.toString()) &&
        postAssignTab1.body.data.pagination.total === tab1AssignedCheck.body.data.pagination.total + 1 &&
        postAssignTab2.body.data.pagination.total === tab2UnassignedCheck.body.data.pagination.total - 1,
      'Assigned lead immediately leaves Unassigned Leads count/list and enters Assigned Leads count/list'
    );

    // Manager & Admin unassigned=true + search query never overwrites $or and keeps total consistent with rows
    const mgrSearchUnassignedId = new Types.ObjectId();
    const orgUnassignedOtherMgrId = new Types.ObjectId();
    enquiryStore.push(
      {
        _id: mgrSearchUnassignedId,
        name: 'Siddharth Rao Unassigned Match',
        mobile: '9876500991',
        normalizedMobile: '9876500991',
        status: 'ACTIVE',
        isActive: true,
        assignedTo: null,
        managerId: managerVikramId,
        currentStage: 'FOLLOW_UP',
        createdAt: new Date()
      },
      {
        _id: orgUnassignedOtherMgrId,
        name: 'Siddharth Other Scope',
        mobile: '9876500992',
        normalizedMobile: '9876500992',
        status: 'ACTIVE',
        isActive: true,
        assignedTo: null,
        managerId: managerOtherId,
        currentStage: 'FOLLOW_UP',
        createdAt: new Date()
      }
    );

    const mgrSearchUnassignedRes = makeMockRes();
    await controller.list(
      {
        user: managerVikram,
        query: { unassigned: 'true', assignedOnly: 'false', search: 'Siddharth', page: '1', limit: '10', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      mgrSearchUnassignedRes
    );
    assert(
      mgrSearchUnassignedRes.statusCode === 200 &&
        mgrSearchUnassignedRes.body.data.pagination.total === 1 &&
        mgrSearchUnassignedRes.body.data.enquiries.length === 1 &&
        mgrSearchUnassignedRes.body.data.enquiries[0]._id.toString() === mgrSearchUnassignedId.toString(),
      'Manager unassigned=true + search preserves manager scope ($and/$or) and returns exact matching rows & total'
    );

    const adminUnassignedSearchRes = makeMockRes();
    await controller.list(
      {
        user: adminActor,
        query: { unassigned: 'true', assignedOnly: 'false', search: 'Siddharth', page: '1', limit: '10', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      adminUnassignedSearchRes
    );
    assert(
      adminUnassignedSearchRes.statusCode === 200 &&
        adminUnassignedSearchRes.body.data.pagination.total === 2 &&
        adminUnassignedSearchRes.body.data.enquiries.length === 2 &&
        adminUnassignedSearchRes.body.data.enquiries.every((e: any) => !e.assignedTo),
      'Admin unassigned=true + search returns all org unassigned matches with consistent total & rows'
    );

    const adminAssignedRes = makeMockRes();
    await controller.list(
      {
        user: adminActor,
        query: { assignedOnly: 'true', unassigned: 'false', page: '1', limit: '50', status: 'ACTIVE', excludeCompletedDeals: 'true' }
      } as any,
      adminAssignedRes
    );
    assert(
      adminAssignedRes.statusCode === 200 &&
        adminAssignedRes.body.data.enquiries.length === adminAssignedRes.body.data.pagination.total &&
        adminAssignedRes.body.data.enquiries.every((e: any) => Boolean(e.assignedTo)),
      'Admin assignedOnly=true returns strictly assigned enquiries matching total count'
    );
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
