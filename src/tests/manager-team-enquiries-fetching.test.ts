import { Types } from 'mongoose';
import { EnquiryController } from '../controllers/enquiry.controller.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { Enquiry, FollowUpTask, User } from '../models/index.js';
import { AuthUser } from '../types/auth.types.js';

interface MockResponse {
  statusCode: number;
  body: any;
  status: (code: number) => MockResponse;
  json: (data: any) => MockResponse;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    }
  };
  return res;
};

const createMockRequest = (user?: AuthUser): any => ({
  user
});

async function runManagerTeamEnquiriesFetchingTests() {
  console.log('================================================================');
  console.log('Starting Manager Team Enquiries API (GET /api/v1/enquiries/team) Test Suite');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      passed++;
      console.log(`[PASS] ${testName}`);
    } else {
      failed++;
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  };

  const managerId = new Types.ObjectId();
  const otherManagerId = new Types.ObjectId();
  const agentTeamId = new Types.ObjectId();
  const agentOtherTeamId = new Types.ObjectId();
  const adminId = new Types.ObjectId();

  const managerActor: AuthUser = {
    id: managerId.toString(),
    name: 'Manager Vikram',
    email: 'vikram.manager@neuways.com',
    role: 'MANAGER'
  };

  const emptyManagerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Manager Empty',
    email: 'empty.manager@neuways.com',
    role: 'MANAGER'
  };

  const salesAgentActor: AuthUser = {
    id: agentTeamId.toString(),
    name: 'Sales Agent Priya',
    email: 'priya.sales@neuways.com',
    role: 'SALES'
  };

  const adminActor: AuthUser = {
    id: adminId.toString(),
    name: 'System Admin',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  };

  // In-memory data store for tests
  const inMemoryUsers = [
    {
      _id: managerId,
      name: 'Manager Vikram',
      email: 'vikram.manager@neuways.com',
      role: 'MANAGER',
      isActive: true
    },
    {
      _id: agentTeamId,
      name: 'Sales Agent Priya',
      email: 'priya.sales@neuways.com',
      role: 'SALES',
      managerId: managerId,
      isActive: true,
      isTeamActive: true
    },
    {
      _id: agentOtherTeamId,
      name: 'Sales Agent Other',
      email: 'other.sales@neuways.com',
      role: 'SALES',
      managerId: otherManagerId,
      isActive: true,
      isTeamActive: true
    }
  ];

  const inMemoryEnquiries = [
    {
      _id: new Types.ObjectId(),
      name: 'Lead Active Follow-up',
      mobile: '+919876543210',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: agentTeamId,
      dealDone: { isConfirmed: false }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Lead Active Meeting',
      mobile: '+919876543211',
      status: 'ACTIVE',
      currentStage: 'MEETING_PLAN',
      assignedTo: agentTeamId,
      dealDone: { isConfirmed: false }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Lead Completed Deal',
      mobile: '+919876543212',
      status: 'ACTIVE',
      currentStage: 'DEAL_DONE',
      assignedTo: agentTeamId,
      dealDone: { isConfirmed: true, confirmedAt: new Date() }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Lead Rejected',
      mobile: '+919876543213',
      status: 'CLOSED',
      currentStage: 'FOLLOW_UP',
      assignedTo: agentTeamId,
      rejection: { closureType: 'REJECTED', reason: 'Budget too high' }
    },
    {
      _id: new Types.ObjectId(),
      name: 'Lead Deal Lost',
      mobile: '+919876543214',
      status: 'CLOSED',
      currentStage: 'FOLLOW_UP',
      assignedTo: agentTeamId,
      rejection: { closureType: 'DEAL_LOST', reason: 'Lost to Competitor' }
    },
    // Other manager lead
    {
      _id: new Types.ObjectId(),
      name: 'Other Manager Lead',
      mobile: '+919876543299',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: agentOtherTeamId,
      dealDone: { isConfirmed: false }
    }
  ];

  const inMemoryTasks = [
    {
      _id: new Types.ObjectId(),
      enquiryId: inMemoryEnquiries[0]._id,
      assignedTo: agentTeamId,
      status: 'PENDING',
      followUpDate: new Date(Date.now() - 3600000) // 1 hr ago (overdue, pending)
    }
  ];

  // Mock User.find
  (User as any).find = function (filter: any) {
    let list = [...inMemoryUsers];
    if (filter) {
      if (filter.role) list = list.filter((u) => u.role === filter.role);
      if (filter.isActive !== undefined) list = list.filter((u) => u.isActive === filter.isActive);
      if (filter.managerId) list = list.filter((u) => u.managerId && u.managerId.toString() === filter.managerId.toString());
      if (filter._id && filter._id.$in) {
        const strIds = filter._id.$in.map((id: any) => id.toString());
        list = list.filter((u) => strIds.includes(u._id.toString()));
      }
    }
    return {
      select: () => Promise.resolve(list)
    };
  };

  // Mock Enquiry.aggregate to simulate live MongoDB aggregation pipeline
  (Enquiry as any).aggregate = function (pipeline: any[]) {
    // Verify no invalid expressions like $nin are used
    const jsonStr = JSON.stringify(pipeline);
    if (jsonStr.includes('"$nin"')) {
      throw new Error("MongoServerError: Unrecognized expression '$nin'");
    }

    // Evaluate pipeline in memory
    const matchStage = pipeline.find((p) => p.$match);
    const agentIds = matchStage?.$match?.assignedTo?.$in?.map((id: any) => id.toString()) || [];

    const matched = inMemoryEnquiries.filter((e) => agentIds.includes(e.assignedTo.toString()));

    const groupResult: any[] = [];
    for (const agentId of agentIds) {
      const agentLeads = matched.filter((e) => e.assignedTo.toString() === agentId);
      groupResult.push({
        _id: new Types.ObjectId(agentId),
        activeLeadsCount: agentLeads.filter(
          (e) => e.status === 'ACTIVE' && !e.dealDone?.isConfirmed && !['DEAL_DONE', '04. Deal Done'].includes(e.currentStage)
        ).length,
        followUpCount: agentLeads.filter(
          (e) => e.status === 'ACTIVE' && ['FOLLOW_UP', '01. Follow-up'].includes(e.currentStage)
        ).length,
        meetingCount: agentLeads.filter(
          (e) => e.status === 'ACTIVE' && ['MEETING_PLAN', '02. Meeting Plan'].includes(e.currentStage)
        ).length,
        siteVisitCount: agentLeads.filter(
          (e) => e.status === 'ACTIVE' && ['SITE_VISIT_PLAN', '03. Site Visit Plan'].includes(e.currentStage)
        ).length,
        completedDealsCount: agentLeads.filter(
          (e) => ['DEAL_DONE', '04. Deal Done'].includes(e.currentStage) && e.dealDone?.isConfirmed && e.status !== 'CLOSED'
        ).length,
        rejectedCount: agentLeads.filter(
          (e) => e.status === 'CLOSED' && e.rejection?.closureType === 'REJECTED'
        ).length,
        dealLostCount: agentLeads.filter(
          (e) => e.status === 'CLOSED' && e.rejection?.closureType === 'DEAL_LOST'
        ).length,
        legacyClosedCount: agentLeads.filter(
          (e) => e.status === 'CLOSED' && !['REJECTED', 'DEAL_LOST'].includes(e.rejection?.closureType as any) && !e.dealDone?.isConfirmed
        ).length
      });
    }
    return Promise.resolve(groupResult);
  };

  // Mock FollowUpTask.aggregate
  (FollowUpTask as any).aggregate = function (pipeline: any[]) {
    const matchStage = pipeline.find((p) => p.$match);
    const agentIds = matchStage?.$match?.assignedTo?.$in?.map((id: any) => id.toString()) || [];

    const groupResult = agentIds.map((agentId: string) => {
      const tasks = inMemoryTasks.filter((t) => t.assignedTo.toString() === agentId);
      return {
        _id: new Types.ObjectId(agentId),
        pendingFollowUpsCount: tasks.length,
        futureFollowUpsCount: 0
      };
    });
    return Promise.resolve(groupResult);
  };

  const service = new EnquiryService();
  const controller = new EnquiryController(service);

  // --------------------------------------------------------------------------
  // Suite 1: Authentication & Authorization Controls
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Authentication & Authorization Controls ---');

  // Test 1: Unauthenticated request rejected with HTTP 401
  const unauthReq = createMockRequest(undefined);
  const unauthRes = createMockResponse();
  await controller.getTeam(unauthReq, unauthRes as any);
  assert(unauthRes.statusCode === 401, 'Unauthenticated request returns HTTP 401 Unauthorized');
  assert(unauthRes.body?.success === false, 'Unauthenticated response returns success: false');
  assert(unauthRes.body?.error === 'Unauthorized', 'Unauthenticated response error is Unauthorized');

  // --------------------------------------------------------------------------
  // Suite 2: Manager Team Performance Retrieval & Scoping
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: Manager Team Performance Retrieval & Scoping ---');

  // Test 2: Manager retrieves team performance successfully
  const managerReq = createMockRequest(managerActor);
  const managerRes = createMockResponse();
  await controller.getTeam(managerReq, managerRes as any);

  assert(managerRes.statusCode === 200, 'Manager request returns HTTP 200 OK');
  assert(managerRes.body?.success === true, 'Response body success is true');
  assert(managerRes.body?.message === 'Team performance retrieved successfully.', 'Response message is correct');
  assert(managerRes.body?.data !== undefined, 'Response envelope contains data property');
  assert(Array.isArray(managerRes.body?.data?.team), 'data.team is an array');
  assert(Array.isArray(managerRes.body?.team), 'Root team property is preserved for backward compatibility');

  const teamList = managerRes.body?.data?.team || [];
  assert(teamList.length === 1, `Manager Vikram sees exactly 1 team member (expected 1, got ${teamList.length})`);
  assert(teamList[0]?.id === agentTeamId.toString(), 'Returned team member is Sales Agent Priya');
  assert(teamList[0]?.name === 'Sales Agent Priya', 'Team member name matches Priya');

  // Verify cross-manager isolation
  const hasOtherAgent = teamList.some((m: any) => m.id === agentOtherTeamId.toString());
  assert(!hasOtherAgent, 'Sales Agent from another manager is strictly excluded from team');

  // --------------------------------------------------------------------------
  // Suite 3: Team Performance Metrics Accuracy
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: Team Performance Metrics Accuracy ---');

  const priyaMetrics = teamList[0];
  assert(priyaMetrics.activeLeadsCount === 2, `Active leads count is 2 (expected 2, got ${priyaMetrics.activeLeadsCount})`);
  assert(priyaMetrics.stageWorkload?.followUp === 1, `Follow-up count is 1 (expected 1, got ${priyaMetrics.stageWorkload?.followUp})`);
  assert(priyaMetrics.stageWorkload?.meetingPlan === 1, `Meeting plan count is 1 (expected 1, got ${priyaMetrics.stageWorkload?.meetingPlan})`);
  assert(priyaMetrics.stageWorkload?.siteVisitPlan === 0, `Site visit plan count is 0 (expected 0, got ${priyaMetrics.stageWorkload?.siteVisitPlan})`);
  assert(priyaMetrics.completedDealsCount === 1, `Completed deals count is 1 (expected 1, got ${priyaMetrics.completedDealsCount})`);
  assert(priyaMetrics.rejectedCount === 1, `Rejected count is 1 (expected 1, got ${priyaMetrics.rejectedCount})`);
  assert(priyaMetrics.dealLostCount === 1, `Deal Lost count is 1 (expected 1, got ${priyaMetrics.dealLostCount})`);
  assert(priyaMetrics.pendingFollowUpsCount === 1, `Pending follow-ups count is 1 (expected 1, got ${priyaMetrics.pendingFollowUpsCount})`);

  // --------------------------------------------------------------------------
  // Suite 4: Empty Team Handling (Legitimate Empty State)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: Empty Team Handling (Legitimate Empty State) ---');

  const emptyReq = createMockRequest(emptyManagerActor);
  const emptyRes = createMockResponse();
  await controller.getTeam(emptyReq, emptyRes as any);

  assert(emptyRes.statusCode === 200, 'Empty team returns HTTP 200 OK without errors');
  assert(emptyRes.body?.success === true, 'Empty team returns success: true');
  assert(Array.isArray(emptyRes.body?.data?.team) && emptyRes.body?.data?.team.length === 0, 'data.team is empty array');
  assert(Array.isArray(emptyRes.body?.team) && emptyRes.body?.team.length === 0, 'Root team is empty array');

  // --------------------------------------------------------------------------
  // Suite 5: Sales Agent Self-Metrics Access
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 5: Sales Agent Self-Metrics Access ---');

  const salesReq = createMockRequest(salesAgentActor);
  const salesRes = createMockResponse();
  await controller.getTeam(salesReq, salesRes as any);

  assert(salesRes.statusCode === 200, 'Sales agent request returns HTTP 200 OK');
  assert(salesRes.body?.success === true, 'Sales agent response success: true');
  const salesTeam = salesRes.body?.data?.team || [];
  assert(salesTeam.length === 1, 'Sales agent sees exactly 1 record (their own)');
  assert(salesTeam[0]?.id === agentTeamId.toString(), 'Sales agent record matches Priya');

  // --------------------------------------------------------------------------
  // Suite 6: Admin System-Wide Access
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 6: Admin System-Wide Access ---');

  const adminReq = createMockRequest(adminActor);
  const adminRes = createMockResponse();
  await controller.getTeam(adminReq, adminRes as any);

  assert(adminRes.statusCode === 200, 'Admin request returns HTTP 200 OK');
  assert(adminRes.body?.success === true, 'Admin response success: true');
  const adminTeam = adminRes.body?.data?.team || [];
  assert(adminTeam.length === 2, `Admin sees all active sales agents across teams (expected 2, got ${adminTeam.length})`);

  // --------------------------------------------------------------------------
  // Suite 7: Aggregation Operator Syntax Invariance (No $nin expression error)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 7: Aggregation Operator Syntax Invariance ---');

  let aggSyntaxError = false;
  try {
    const rawResult = await service.getTeamPerformance(managerActor);
    assert(rawResult.success === true, 'Service getTeamPerformance returns success: true');
    assert((rawResult.team?.length || 0) > 0, 'Service returns team members without throwing MongoServerError');
  } catch (err: any) {
    aggSyntaxError = true;
    console.error('Unexpected aggregation error:', err);
  }
  assert(!aggSyntaxError, 'Aggregation pipeline executes cleanly without any MongoServerError');

  // Summary
  console.log('\n================================================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed (Total: ${passed + failed})`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runManagerTeamEnquiriesFetchingTests();
