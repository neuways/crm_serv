/**
 * Neuways CRM - Company Permission Audit & Deletion Test Suite
 *
 * Covers all 10 Acceptance Scenarios from Section 7:
 * 1. Manager A queries roster -> only sees own team agents and unassigned available agents (never Manager B's agents/emails).
 * 2. Manager A queries GET /api/v1/enquiries/team/roster -> HTTP response does NOT contain any agents assigned to Manager B.
 * 3. Manager A attempts to assign or add an agent belonging to Manager B -> rejected with 403 or 409, does not modify agent.
 * 4. Manager A attempts to view details, follow-ups, remarks, or activity history of a lead assigned to Manager B's team -> rejected with 403 Forbidden.
 * 5. Manager A attempts to reassign or record follow-up on an unassigned lead -> rejected with 403 Forbidden.
 * 6. Sales Agent attempts to access another agent's lead -> rejected with 403 Forbidden.
 * 7. Sales Agent or Manager attempts to delete a lead -> rejected with 403 Forbidden.
 * 8. Sales Agent or Manager attempts to delete an employee account -> rejected with 403 Forbidden.
 * 9. Admin deletes a lead (not in DEAL_DONE state) -> successfully deleted. Finalized deal deletion attempt -> rejected with 400 Bad Request.
 * 10. Admin deletes an employee account (not own account, not another Admin) -> successfully deleted with cascade cleanup.
 */

import http from 'http';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../app.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { PropertyMapping } from '../models/property-mapping.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { userService } from '../services/user.service.js';
import { authService } from '../services/auth.service.js';
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

async function runAuditTests() {
  console.log('====================================================');
  console.log('Neuways CRM - Company Permission Audit & Acceptance Test Suite');
  console.log('====================================================\n');

  // Initialize express test app
  const app = createApp();
  let server: http.Server | undefined;
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server!.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  // ---------------------------------------------------------------------------
  // Mock Data Setup
  // ---------------------------------------------------------------------------
  const adminId = new Types.ObjectId();
  const managerAId = new Types.ObjectId();
  const managerBId = new Types.ObjectId();
  const agentA1Id = new Types.ObjectId(); // Manager A's team
  const agentB1Id = new Types.ObjectId(); // Manager B's team
  const unassignedAgentId = new Types.ObjectId(); // Unassigned active agent

  const usersMap = new Map<string, any>();

  const createMockUserRecord = (fields: Partial<IUser> & { _id: Types.ObjectId; id: string }): any => {
    const doc = {
      ...fields,
      passwordHash: '$2a$12$hashedpwd',
      isActive: fields.isActive !== undefined ? fields.isActive : true,
      isTeamActive: fields.isTeamActive !== undefined ? fields.isTeamActive : true,
      managerId: fields.managerId || null,
      assignedPropertyIds: fields.assignedPropertyIds || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        usersMap.set(this._id.toString(), this);
        return this;
      }
    };
    return doc;
  };

  const adminDoc = createMockUserRecord({
    _id: adminId,
    id: adminId.toString(),
    name: 'Admin Boss',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  });

  const managerADoc = createMockUserRecord({
    _id: managerAId,
    id: managerAId.toString(),
    name: 'Manager Alice',
    email: 'alice.mgr@neuways.com',
    role: 'MANAGER'
  });

  const managerBDoc = createMockUserRecord({
    _id: managerBId,
    id: managerBId.toString(),
    name: 'Manager Bob',
    email: 'bob.mgr@neuways.com',
    role: 'MANAGER'
  });

  const agentA1Doc = createMockUserRecord({
    _id: agentA1Id,
    id: agentA1Id.toString(),
    name: 'Agent Aaron',
    email: 'aaron.sales@neuways.com',
    role: 'SALES',
    managerId: managerAId
  });

  const agentB1Doc = createMockUserRecord({
    _id: agentB1Id,
    id: agentB1Id.toString(),
    name: 'Agent Brian',
    email: 'brian.sales@neuways.com',
    role: 'SALES',
    managerId: managerBId
  });

  const unassignedAgentDoc = createMockUserRecord({
    _id: unassignedAgentId,
    id: unassignedAgentId.toString(),
    name: 'Agent Uma',
    email: 'uma.sales@neuways.com',
    role: 'SALES',
    managerId: null
  });

  usersMap.set(adminId.toString(), adminDoc);
  usersMap.set(managerAId.toString(), managerADoc);
  usersMap.set(managerBId.toString(), managerBDoc);
  usersMap.set(agentA1Id.toString(), agentA1Doc);
  usersMap.set(agentB1Id.toString(), agentB1Doc);
  usersMap.set(unassignedAgentId.toString(), unassignedAgentDoc);

  // Mock Tokens
  const adminActor: AuthUser = { id: adminId.toString(), email: adminDoc.email, role: 'ADMIN', name: adminDoc.name };
  const managerAActor: AuthUser = { id: managerAId.toString(), email: managerADoc.email, role: 'MANAGER', name: managerADoc.name };
  const managerBActor: AuthUser = { id: managerBId.toString(), email: managerBDoc.email, role: 'MANAGER', name: managerBDoc.name };
  const agentA1Actor: AuthUser = { id: agentA1Id.toString(), email: agentA1Doc.email, role: 'SALES', name: agentA1Doc.name };
  const agentB1Actor: AuthUser = { id: agentB1Id.toString(), email: agentB1Doc.email, role: 'SALES', name: agentB1Doc.name };

  const adminToken = authService.generateToken(adminActor);
  const managerAToken = authService.generateToken(managerAActor);
  const managerBToken = authService.generateToken(managerBActor);
  const agentA1Token = authService.generateToken(agentA1Actor);

  // Mock Enquiries
  const leadAId = new Types.ObjectId(); // Assigned to Agent A1
  const leadBId = new Types.ObjectId(); // Assigned to Agent B1
  const unassignedLeadId = new Types.ObjectId(); // Unassigned lead
  const dealDoneLeadId = new Types.ObjectId(); // Deal Done finalized lead

  const enquiriesMap = new Map<string, any>();
  const followUpsMap = new Map<string, any>();
  const activitiesMap = new Map<string, any>();
  const propertyMappingsMap = new Map<string, any>();

  const createMockEnquiry = (fields: any): any => {
    const doc = {
      ...fields,
      assignedTo: fields.assignedTo || fields.assignedToId || null,
      assignedToId: fields.assignedTo || fields.assignedToId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: fields.status || 'ACTIVE',
      currentStage: fields.currentStage || 'FOLLOW_UP',
      dealDone: fields.dealDone || null,
      save: async function () {
        enquiriesMap.set(this._id.toString(), this);
        return this;
      }
    };
    return doc;
  };

  const leadADoc = createMockEnquiry({
    _id: leadAId,
    id: leadAId.toString(),
    name: 'Customer for Team A',
    email: 'customer.a@test.com',
    mobile: '9876543210',
    projectName: 'Palm Residency',
    assignedTo: agentA1Id,
    status: 'ACTIVE'
  });

  const leadBDoc = createMockEnquiry({
    _id: leadBId,
    id: leadBId.toString(),
    name: 'Customer for Team B',
    email: 'customer.b@test.com',
    mobile: '9876543211',
    projectName: 'Azure Bay',
    assignedTo: agentB1Id,
    status: 'ACTIVE'
  });

  const unassignedLeadDoc = createMockEnquiry({
    _id: unassignedLeadId,
    id: unassignedLeadId.toString(),
    name: 'Customer Unassigned',
    email: 'customer.unassigned@test.com',
    mobile: '9876543212',
    projectName: 'Sunset Hills',
    assignedTo: null,
    status: 'ACTIVE'
  });

  const dealDoneLeadDoc = createMockEnquiry({
    _id: dealDoneLeadId,
    id: dealDoneLeadId.toString(),
    name: 'Customer Finalized Deal',
    email: 'customer.done@test.com',
    mobile: '9876543213',
    projectName: 'Golden Crest',
    assignedTo: agentA1Id,
    dealDone: {
      price: 1000000,
      size: '101',
      isConfirmed: true,
      confirmedAt: new Date()
    },
    currentStage: 'DEAL_DONE',
    status: 'CLOSED'
  });

  enquiriesMap.set(leadAId.toString(), leadADoc);
  enquiriesMap.set(leadBId.toString(), leadBDoc);
  enquiriesMap.set(unassignedLeadId.toString(), unassignedLeadDoc);
  enquiriesMap.set(dealDoneLeadId.toString(), dealDoneLeadDoc);

  // Set DB readyState
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

  // ---------------------------------------------------------------------------
  // Model Mocks
  // ---------------------------------------------------------------------------
  User.find = ((filter?: any) => {
    let list = Array.from(usersMap.values());
    if (filter) {
      if (filter.role) {
        list = list.filter((u) => u.role === filter.role);
      }
      if (filter.managerId) {
        const mgrStr = filter.managerId.toString();
        list = list.filter((u) => u.managerId && u.managerId.toString() === mgrStr);
      }
      if (filter.isActive !== undefined) {
        list = list.filter((u) => u.isActive === filter.isActive);
      }
      if (filter.$or && Array.isArray(filter.$or)) {
        list = list.filter((u) => {
          return filter.$or.some((cond: any) => {
            if (cond.managerId) {
              return u.managerId && u.managerId.toString() === cond.managerId.toString();
            }
            if (cond.managerId === null) {
              return u.managerId === null && (cond.isActive === undefined || u.isActive === cond.isActive);
            }
            return false;
          });
        });
      }
    }

    const createChain = (items: any[]) => ({
      populate: () => createChain(items),
      select: (fields?: string) => {
        if (fields && fields === '_id') {
          return createChain(items.map((i) => ({ _id: i._id })));
        }
        return createChain(items);
      },
      sort: () => createChain(items),
      lean: () => Promise.resolve(items),
      then: (fn: any) => Promise.resolve(items).then(fn)
    });

    return createChain(list);
  }) as any;

  User.findById = ((id: any) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : '';
    const item = usersMap.get(idStr) || null;
    return {
      select: () => Promise.resolve(item),
      populate: () => Promise.resolve(item),
      then: (fn: any) => Promise.resolve(item).then(fn)
    };
  }) as any;

  User.findOne = ((filter: any) => {
    let list = Array.from(usersMap.values());
    if (filter._id) {
      list = list.filter((u) => u._id.toString() === filter._id.toString());
    }
    if (filter.role) {
      list = list.filter((u) => u.role === filter.role);
    }
    const item = list[0] || null;
    return Promise.resolve(item);
  }) as any;

  User.findByIdAndDelete = (async (id: any) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : '';
    const item = usersMap.get(idStr);
    usersMap.delete(idStr);
    return item || null;
  }) as any;

  User.updateMany = (async (filter: any, update: any) => {
    let count = 0;
    for (const u of usersMap.values()) {
      if (filter.managerId && u.managerId && u.managerId.toString() === filter.managerId.toString()) {
        if (update.$set && update.$set.managerId === null) {
          u.managerId = null;
          count++;
        }
      }
    }
    return { modifiedCount: count };
  }) as any;

  Enquiry.find = ((filter?: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter && filter.assignedToId) {
      if (filter.assignedToId.$in) {
        const inIds = filter.assignedToId.$in.map((id: any) => id.toString());
        list = list.filter((e) => e.assignedToId && inIds.includes(e.assignedToId.toString()));
      } else {
        const aId = filter.assignedToId.toString();
        list = list.filter((e) => e.assignedToId && e.assignedToId.toString() === aId);
      }
    }
    return {
      populate: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve(list)
            })
          })
        })
      }),
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => Promise.resolve(list)
          })
        })
      }),
      lean: () => Promise.resolve(list),
      then: (fn: any) => Promise.resolve(list).then(fn)
    };
  }) as any;

  Enquiry.findById = ((id: any) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : '';
    const item = enquiriesMap.get(idStr) || null;
    return {
      populate: () => ({
        populate: () => Promise.resolve(item),
        then: (fn: any) => Promise.resolve(item).then(fn)
      }),
      then: (fn: any) => Promise.resolve(item).then(fn)
    };
  }) as any;

  Enquiry.findByIdAndDelete = (async (id: any) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : '';
    const item = enquiriesMap.get(idStr);
    enquiriesMap.delete(idStr);
    return item || null;
  }) as any;

  Enquiry.updateMany = (async (filter: any, update: any) => {
    let count = 0;
    for (const e of enquiriesMap.values()) {
      if (filter.assignedToId && e.assignedToId && e.assignedToId.toString() === filter.assignedToId.toString()) {
        if (update.$set && update.$set.assignedToId === null) {
          e.assignedToId = null;
          count++;
        }
      }
    }
    return { modifiedCount: count };
  }) as any;

  FollowUpTask.deleteMany = (async (filter: any) => {
    return { deletedCount: 1 };
  }) as any;

  EnquiryActivity.deleteMany = (async (filter: any) => {
    return { deletedCount: 1 };
  }) as any;

  PropertyMapping.updateMany = (async (filter: any) => {
    return { modifiedCount: 1 };
  }) as any;

  FollowUpTask.find = (() => ({
    populate: () => ({
      sort: () => Promise.resolve([])
    })
  })) as any;

  EnquiryActivity.find = (() => ({
    populate: () => ({
      sort: () => Promise.resolve([])
    })
  })) as any;

  // Helper fetch function
  const apiCall = async (method: string, path: string, token: string, body?: any) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  };

  try {
    // ---------------------------------------------------------------------------
    // Scenario 1: Manager A queries roster via Service
    // -> only sees own team agents and unassigned available agents.
    // -> does NOT see Manager B's team members or emails.
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Team Roster Scoping (Service) ---');
    const rosterRes = await enquiryService.getTeamRoster(managerAActor);
    assert(rosterRes.success, 'Scenario 1: Manager A successfully retrieves team roster');
    const returnedAgents = rosterRes.agents || [];
    const hasAgentA1 = returnedAgents.some((a) => a.id === agentA1Id.toString());
    const hasUnassignedAgent = returnedAgents.some((a) => a.id === unassignedAgentId.toString());
    const hasAgentB1 = returnedAgents.some((a) => a.id === agentB1Id.toString());
    const hasAgentBEmail = returnedAgents.some((a) => a.email.includes('brian.sales'));

    assert(hasAgentA1, 'Scenario 1: Manager A sees Agent A1 (own team)');
    assert(hasUnassignedAgent, 'Scenario 1: Manager A sees unassigned available Agent Uma');
    assert(!hasAgentB1, 'Scenario 1: Manager A NEVER sees Agent B1 (Manager B team)');
    assert(!hasAgentBEmail, 'Scenario 1: Manager A response NEVER leaks Manager B agent email');

    // ---------------------------------------------------------------------------
    // Scenario 2: Manager A queries GET /api/v1/enquiries/team/roster via HTTP
    // -> response does NOT contain any agents assigned to Manager B.
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 2: GET /api/v1/enquiries/team/roster (HTTP API) ---');
    const httpRoster = await apiCall('GET', '/api/v1/enquiries/team/roster', managerAToken);
    assert(httpRoster.status === 200, 'Scenario 2: HTTP 200 OK returned for team roster');
    const httpAgents = (httpRoster.data as any).data?.agents || [];
    const httpHasAgentB1 = httpAgents.some((a: any) => a.id === agentB1Id.toString());
    const httpHasAgentBEmail = httpAgents.some((a: any) => a.email === agentB1Doc.email);

    assert(!httpHasAgentB1, 'Scenario 2: HTTP response does not contain Agent B1');
    assert(!httpHasAgentBEmail, 'Scenario 2: HTTP response does not leak Agent B1 email');
    assert(httpAgents.some((a: any) => a.id === agentA1Id.toString()), 'Scenario 2: HTTP response contains Agent A1');

    // ---------------------------------------------------------------------------
    // Scenario 3: Manager A attempts to assign or add an agent belonging to Manager B
    // -> rejected with 403 or 409 and does not modify the agent.
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Manager A assigns Agent B1 (belonging to Manager B) ---');
    const assignCrossTeamRes = await enquiryService.assignAgentToTeam(managerAActor, agentB1Id.toString());
    assert(
      !assignCrossTeamRes.success && (assignCrossTeamRes.statusCode === 409 || assignCrossTeamRes.statusCode === 403),
      'Scenario 3: Cross-manager assignment rejected with 409 Conflict / 403 Forbidden',
      `Got status: ${assignCrossTeamRes.statusCode}`
    );
    const agentB1AfterAttempt = usersMap.get(agentB1Id.toString());
    assert(
      agentB1AfterAttempt.managerId.toString() === managerBId.toString(),
      'Scenario 3: Agent B1 managerId was NOT modified by Manager A attempt'
    );

    // ---------------------------------------------------------------------------
    // Scenario 4: Manager A attempts to access Lead B (assigned to Manager B's team)
    // -> details, follow-ups, remarks, activity history all return 403 Forbidden
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Manager A accesses Lead B (cross-team isolation) ---');
    // 4a. Get Details
    const leadBDetail = await enquiryService.getEnquiryById(leadBId.toString(), managerAActor);
    assert(!leadBDetail.success && leadBDetail.statusCode === 403, 'Scenario 4a: getEnquiryById on Lead B returns 403 Forbidden');

    // 4b. Get Follow-ups
    const leadBFollowUps = await enquiryService.getFollowUps(leadBId.toString(), managerAActor);
    assert(!leadBFollowUps.success && leadBFollowUps.statusCode === 403, 'Scenario 4b: getFollowUps on Lead B returns 403 Forbidden');

    // 4c. Add Remark
    const leadBRemark = await enquiryService.addRemark(leadBId.toString(), { remark: 'Illegal remark' }, managerAActor);
    assert(!leadBRemark.success && leadBRemark.statusCode === 403, 'Scenario 4c: addRemark on Lead B returns 403 Forbidden');

    // 4d. Activity History
    const leadBActivities = await enquiryService.getActivityHistory(leadBId.toString(), 1, 20, managerAActor);
    assert(!leadBActivities.success && leadBActivities.statusCode === 403, 'Scenario 4d: getActivityHistory on Lead B returns 403 Forbidden');

    // ---------------------------------------------------------------------------
    // Scenario 5: Manager A attempts to reassign or record follow-up on unassigned lead
    // -> rejected with 403 Forbidden (only Admin can assign unassigned leads)
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 5: Manager A actions on unassigned lead ---');
    // 5a. Manager A attempts to reassign unassigned lead
    const reassignUnassigned = await enquiryService.assignEnquiry(
      unassignedLeadId.toString(),
      agentA1Id.toString(),
      managerAActor
    );
    assert(!reassignUnassigned.success && reassignUnassigned.statusCode === 403, 'Scenario 5a: Manager reassigning unassigned lead returns 403 Forbidden');

    // 5b. Manager A attempts to record follow-up on unassigned lead
    const followUpUnassigned = await enquiryService.createFollowUp(
      unassignedLeadId.toString(),
      {
        purpose: 'CALL',
        outcome: 'CONNECTED',
        followUpDate: '2026-11-01',
        followUpTime: '10:00 AM',
        notes: 'Test follow-up'
      },
      managerAActor
    );
    assert(!followUpUnassigned.success && followUpUnassigned.statusCode === 403, 'Scenario 5b: Manager follow-up on unassigned lead returns 403 Forbidden');

    // ---------------------------------------------------------------------------
    // Scenario 6: Sales Agent attempts to access another agent's lead
    // -> rejected with 403 Forbidden
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 6: Sales Agent A accesses Lead B (cross-agent isolation) ---');
    const agentCrossAccess = await enquiryService.getEnquiryById(leadBId.toString(), agentA1Actor);
    assert(!agentCrossAccess.success && agentCrossAccess.statusCode === 403, 'Scenario 6a: Sales agent accessing another agent lead returns 403 Forbidden');

    const agentCrossFollowUp = await enquiryService.getFollowUps(leadBId.toString(), agentA1Actor);
    assert(!agentCrossFollowUp.success && agentCrossFollowUp.statusCode === 403, 'Scenario 6b: Sales agent viewing another agent follow-ups returns 403 Forbidden');

    // ---------------------------------------------------------------------------
    // Scenario 7: Sales Agent or Manager attempts to delete a lead
    // -> rejected with 403 Forbidden
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 7: Non-Admin attempts to delete lead ---');
    // 7a. Sales Agent via HTTP DELETE
    const salesDeleteLeadHttp = await apiCall('DELETE', `/api/v1/enquiries/${leadAId}`, agentA1Token);
    assert(salesDeleteLeadHttp.status === 403, 'Scenario 7a: Sales Agent HTTP DELETE /enquiries/:id returns 403 Forbidden');

    // 7b. Manager via HTTP DELETE
    const mgrDeleteLeadHttp = await apiCall('DELETE', `/api/v1/enquiries/${leadAId}`, managerAToken);
    assert(mgrDeleteLeadHttp.status === 403, 'Scenario 7b: Manager HTTP DELETE /enquiries/:id returns 403 Forbidden');

    // 7c. Manager via Service directly
    const mgrDeleteService = await enquiryService.deleteEnquiry(leadAId.toString(), managerAActor);
    assert(!mgrDeleteService.success && mgrDeleteService.statusCode === 403, 'Scenario 7c: Manager deleteEnquiry via service returns 403 Forbidden');

    // ---------------------------------------------------------------------------
    // Scenario 8: Sales Agent or Manager attempts to delete an employee account
    // -> rejected with 403 Forbidden
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Non-Admin attempts to delete employee account ---');
    // 8a. Sales Agent via HTTP DELETE
    const salesDeleteUserHttp = await apiCall('DELETE', `/api/v1/users/${agentB1Id}`, agentA1Token);
    assert(salesDeleteUserHttp.status === 403, 'Scenario 8a: Sales Agent HTTP DELETE /users/:id returns 403 Forbidden');

    // 8b. Manager via HTTP DELETE
    const mgrDeleteUserHttp = await apiCall('DELETE', `/api/v1/users/${agentB1Id}`, managerAToken);
    assert(mgrDeleteUserHttp.status === 403, 'Scenario 8b: Manager HTTP DELETE /users/:id returns 403 Forbidden');

    // 8c. Manager via Service directly
    let mgrDeleteUserThrown = false;
    try {
      await userService.deleteEmployee(agentB1Id.toString(), managerAActor);
    } catch (e: any) {
      mgrDeleteUserThrown = true;
      assert(e.statusCode === 403, 'Scenario 8c: Manager deleteEmployee throws 403 Forbidden');
    }
    assert(mgrDeleteUserThrown, 'Scenario 8c: deleteEmployee failed for non-admin');

    // ---------------------------------------------------------------------------
    // Scenario 9: Admin deletes a lead (not in DEAL_DONE state) -> successfully deleted.
    // Finalized deal deletion attempt -> rejected with 400 Bad Request.
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Admin Lead Deletion & Finalized Deal Safeguard ---');
    // 9a. Admin deletes regular lead A via HTTP
    const adminDeleteLeadHttp = await apiCall('DELETE', `/api/v1/enquiries/${leadAId}`, adminToken);
    assert(adminDeleteLeadHttp.status === 200, 'Scenario 9a: Admin successfully deletes lead A (HTTP 200 OK)');
    assert(!enquiriesMap.has(leadAId.toString()), 'Scenario 9a: Lead A was removed from storage');

    // 9b. Admin attempts to delete DEAL_DONE finalized deal
    const adminDeleteDealDoneHttp = await apiCall('DELETE', `/api/v1/enquiries/${dealDoneLeadId}`, adminToken);
    assert(
      adminDeleteDealDoneHttp.status === 400,
      'Scenario 9b: Attempt to delete finalized deal rejected with 400 Bad Request',
      `Got status: ${adminDeleteDealDoneHttp.status}`
    );
    assert(enquiriesMap.has(dealDoneLeadId.toString()), 'Scenario 9b: Finalized deal remains intact in storage');

    // ---------------------------------------------------------------------------
    // Scenario 10: Admin deletes an employee account -> successfully deleted with cascade.
    // Admin cannot delete self or another admin -> 400 Bad Request.
    // ---------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Admin Employee Deletion & Cascade ---');
    // 10a. Admin attempts to delete own account
    const adminDeleteSelf = await apiCall('DELETE', `/api/v1/users/${adminId}`, adminToken);
    assert(adminDeleteSelf.status === 400, 'Scenario 10a: Admin self-deletion rejected with 400 Bad Request');
    assert(usersMap.has(adminId.toString()), 'Scenario 10a: Admin account remains intact');

    // 10b. Admin deletes Manager B -> cascades to reporting agents (Agent B1 becomes unassigned)
    const adminDeleteMgrB = await apiCall('DELETE', `/api/v1/users/${managerBId}`, adminToken);
    assert(adminDeleteMgrB.status === 200, 'Scenario 10b: Admin deletes Manager B (HTTP 200 OK)');
    assert(!usersMap.has(managerBId.toString()), 'Scenario 10b: Manager B was removed from storage');
    const agentB1AfterMgrDelete = usersMap.get(agentB1Id.toString());
    assert(
      agentB1AfterMgrDelete && agentB1AfterMgrDelete.managerId === null,
      'Scenario 10b: Reporting agent B1 managerId cascaded to null (unassigned)'
    );

    // 10c. Admin deletes Sales Agent Uma -> leads unassigned, user removed
    const adminDeleteUma = await apiCall('DELETE', `/api/v1/users/${unassignedAgentId}`, adminToken);
    assert(adminDeleteUma.status === 200, 'Scenario 10c: Admin deletes Sales Agent Uma (HTTP 200 OK)');
    assert(!usersMap.has(unassignedAgentId.toString()), 'Scenario 10c: Agent Uma removed from storage');

    console.log('\n====================================================');
    console.log(`Test Suite Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
    console.log('====================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err: unknown) {
    console.error('Fatal test runner exception:', err);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
  }
}

runAuditTests();
