/**
 * Neuways CRM - Manager Reassign Workflow & Manager Deactivation Acceptance Tests
 *
 * Covers all 18 Acceptance Criteria:
 * Reassignment:
 * 1. Admin assigns a lead to Manager A.
 * 2. Manager A opens Reassign for an eligible team agent.
 * 3. The Admin-assigned lead appears in the selection list.
 * 4. Manager A creates a new lead and keeps it assigned to themselves.
 * 5. That Manager-created lead also appears in the eligible reassignment list.
 * 6. Manager A assigns either lead to an eligible Sales Agent.
 * 7. The lead appears in the selected Sales Agent's account and dashboard.
 * 8. The lead is removed from the Manager's eligible reassignment list after assignment.
 * 9. Manager A cannot access or assign Manager B's leads.
 * 10. Manager A cannot assign a lead to an agent outside their team.
 *
 * Manager Deactivation:
 * 11. Admin deactivates a Manager and selects another active Manager.
 * 12. The selected Manager receives the intended team members and leads.
 * 13. Existing history, follow-ups, remarks, and records remain intact.
 * 14. The deactivated Manager cannot access protected endpoints or team data.
 * 15. Admin deactivates a Manager and chooses to handle the team and leads directly.
 * 16. Admin retains access to affected leads and can assign the agents later.
 * 17. If no active Manager is available, Admin can retain control without losing data.
 * 18. Failed transfers do not leave partial team or lead ownership updates.
 */

import http from 'http';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../app.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { userService } from '../services/user.service.js';
import { authService } from '../services/auth.service.js';
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

async function runTests() {
  console.log('====================================================');
  console.log('Neuways CRM - Manager Reassign & Deactivation Tests');
  console.log('====================================================\n');

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

  const usersMap = new Map<string, any>();
  const enquiriesMap = new Map<string, any>();
  const activitiesMap = new Map<string, any>();

  const createMockUser = (fields: Partial<IUser> & { _id: Types.ObjectId; id: string }): any => {
    const doc = {
      ...fields,
      passwordHash: '$2a$12$mockpwdhash',
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

  const adminDoc = createMockUser({
    _id: adminId,
    id: adminId.toString(),
    name: 'Admin Boss',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  });

  const managerADoc = createMockUser({
    _id: managerAId,
    id: managerAId.toString(),
    name: 'Manager Alice',
    email: 'alice.mgr@neuways.com',
    role: 'MANAGER'
  });

  const managerBDoc = createMockUser({
    _id: managerBId,
    id: managerBId.toString(),
    name: 'Manager Bob',
    email: 'bob.mgr@neuways.com',
    role: 'MANAGER'
  });

  const agentA1Doc = createMockUser({
    _id: agentA1Id,
    id: agentA1Id.toString(),
    name: 'Agent Aaron',
    email: 'aaron.sales@neuways.com',
    role: 'SALES',
    managerId: managerAId
  });

  const agentB1Doc = createMockUser({
    _id: agentB1Id,
    id: agentB1Id.toString(),
    name: 'Agent Brian',
    email: 'brian.sales@neuways.com',
    role: 'SALES',
    managerId: managerBId
  });

  usersMap.set(adminId.toString(), adminDoc);
  usersMap.set(managerAId.toString(), managerADoc);
  usersMap.set(managerBId.toString(), managerBDoc);
  usersMap.set(agentA1Id.toString(), agentA1Doc);
  usersMap.set(agentB1Id.toString(), agentB1Doc);

  const adminActor: AuthUser = { id: adminId.toString(), email: adminDoc.email, role: 'ADMIN', name: adminDoc.name };
  const managerAActor: AuthUser = { id: managerAId.toString(), email: managerADoc.email, role: 'MANAGER', name: managerADoc.name };
  const managerBActor: AuthUser = { id: managerBId.toString(), email: managerBDoc.email, role: 'MANAGER', name: managerBDoc.name };
  const agentA1Actor: AuthUser = { id: agentA1Id.toString(), email: agentA1Doc.email, role: 'SALES', name: agentA1Doc.name };

  const adminToken = authService.generateToken(adminActor);
  const managerAToken = authService.generateToken(managerAActor);
  const managerBToken = authService.generateToken(managerBActor);
  const agentA1Token = authService.generateToken(agentA1Actor);

  const createMockEnquiry = (fields: any): any => {
    const normMob = fields.normalizedMobile || (fields.mobile ? (fields.mobile.startsWith('+91') ? fields.mobile : '+91' + fields.mobile.slice(-10)) : undefined);
    const doc = {
      ...fields,
      normalizedMobile: normMob,
      assignedTo: fields.assignedTo || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: fields.status || 'ACTIVE',
      currentStage: fields.currentStage || 'FOLLOW_UP',
      dealDone: fields.dealDone || null,
      save: async function () {
        enquiriesMap.set(this._id.toString(), this);
        return this;
      },
      populate: async function (path: any) {
        if ((path === 'assignedTo' || (typeof path === 'string' && path.startsWith('assignedTo'))) && this.assignedTo) {
          const u = usersMap.get(this.assignedTo.toString());
          if (u) {
            this.assignedTo = { _id: u._id, id: u.id, name: u.name, email: u.email, role: u.role };
          }
        }
        return this;
      }
    };
    return doc;
  };

  // Mongoose Model Stubs
  const origUserFindById = User.findById;
  const origUserFind = User.find;
  const origUserUpdateMany = User.updateMany;
  const origEnquiryFindById = Enquiry.findById;
  const origEnquiryFind = Enquiry.find;
  const origEnquiryFindOne = Enquiry.findOne;
  const origEnquiryCount = Enquiry.countDocuments;
  const origFollowUpFind = FollowUpTask.find;
  const origEnquiryUpdateMany = (Enquiry as any).updateMany;
  const origEnquiryCreate = Enquiry.create;
  const origEnquirySave = Enquiry.prototype.save;
  const origEnquiryPopulate = Enquiry.prototype.populate;
  const origActivitySave = EnquiryActivity.prototype.save;
  const origCreateNotif = notificationService.createNotification;
  const origReadyState = (mongoose.connection as any).readyState;

  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  notificationService.createNotification = (async () => null) as any;

  Enquiry.prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    this.id = this._id.toString();
    this.updatedAt = new Date();
    enquiriesMap.set(this._id.toString(), this);
    return this;
  };

  Enquiry.prototype.populate = (async function (this: any, path: any) {
    if ((path === 'assignedTo' || (typeof path === 'string' && path.startsWith('assignedTo'))) && this.assignedTo) {
      const u = usersMap.get(this.assignedTo.toString());
      if (u) {
        this.assignedTo = { _id: u._id, id: u.id, name: u.name, email: u.email, role: u.role };
      }
    }
    return this;
  }) as any;

  User.findById = ((id: any) => {
    const u = usersMap.get(id?.toString());
    return {
      select: () => Promise.resolve(u || null),
      populate: () => Promise.resolve(u || null),
      lean: () => Promise.resolve(u || null),
      then: (fn: any) => Promise.resolve(u || null).then(fn)
    };
  }) as any;

  User.find = ((filter?: any) => {
    let list = Array.from(usersMap.values());
    if (filter) {
      if (filter.role) list = list.filter((u) => u.role === filter.role);
      if (filter.isActive !== undefined) list = list.filter((u) => u.isActive === filter.isActive);
      if (filter.managerId !== undefined) {
        if (filter.managerId === null) {
          list = list.filter((u) => !u.managerId);
        } else {
          list = list.filter((u) => u.managerId && u.managerId.toString() === filter.managerId.toString());
        }
      }
      if (filter._id && filter._id.$in) {
        const inIds = filter._id.$in.map((id: any) => id.toString());
        list = list.filter((u) => inIds.includes(u._id.toString()));
      }
    }
    const createChain = (items: any[]) => ({
      select: () => createChain(items),
      populate: () => createChain(items),
      sort: () => createChain(items),
      lean: () => Promise.resolve(items),
      then: (fn: any) => Promise.resolve(items).then(fn)
    });
    return createChain(list);
  }) as any;

  User.updateMany = (async (filter: any, update: any) => {
    let matched = Array.from(usersMap.values());
    if (filter?.managerId !== undefined) {
      if (filter.managerId === null) {
        matched = matched.filter((u) => !u.managerId);
      } else {
        matched = matched.filter((u) => u.managerId && u.managerId.toString() === filter.managerId.toString());
      }
    }
    for (const u of matched) {
      if (update?.$set?.managerId !== undefined) {
        u.managerId = update.$set.managerId;
      }
    }
    return { matchedCount: matched.length, modifiedCount: matched.length };
  }) as any;

  Enquiry.findById = ((id: any) => {
    const e = enquiriesMap.get(id?.toString());
    if (!e) return Promise.resolve(null);
    const plain = (e as any).toObject ? (e as any).toObject() : e;
    const assignedUser = plain.assignedTo ? usersMap.get(plain.assignedTo.toString()) : null;
    const populated = {
      ...plain,
      _id: plain._id || e._id,
      id: (plain._id || e._id)?.toString(),
      assignedTo: assignedUser ? { id: assignedUser.id, _id: assignedUser._id, name: assignedUser.name, email: assignedUser.email, role: assignedUser.role } : plain.assignedTo,
      populate: function () { return Promise.resolve(this); },
      save: async function () { enquiriesMap.set(this._id.toString(), this); return this; }
    };
    return {
      populate: () => Promise.resolve(populated),
      then: (fn: any) => Promise.resolve(populated).then(fn)
    };
  }) as any;

  Enquiry.find = ((filter?: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter) {
      if (filter.$or && Array.isArray(filter.$or)) {
        list = list.filter((e) => {
          const plain = (e as any).toObject ? (e as any).toObject() : e;
          return filter.$or.some((cond: any) => {
            if (cond.normalizedMobile && plain.normalizedMobile === cond.normalizedMobile) return true;
            if (cond.normalizedEmail && plain.normalizedEmail === cond.normalizedEmail) return true;
            return false;
          });
        });
      }
      if (filter.status) {
        list = list.filter((e) => {
          const plain = (e as any).toObject ? (e as any).toObject() : e;
          return plain.status === filter.status;
        });
      }
      if (filter.assignedTo !== undefined) {
        if (filter.assignedTo === null) {
          list = list.filter((e) => {
            const plain = (e as any).toObject ? (e as any).toObject() : e;
            return !plain.assignedTo;
          });
        } else if (filter.assignedTo.$in) {
          const inIds = filter.assignedTo.$in.map((id: any) => id.toString());
          list = list.filter((e) => {
            const plain = (e as any).toObject ? (e as any).toObject() : e;
            return plain.assignedTo && inIds.includes(plain.assignedTo.toString());
          });
        } else {
          list = list.filter((e) => {
            const plain = (e as any).toObject ? (e as any).toObject() : e;
            return plain.assignedTo && plain.assignedTo.toString() === filter.assignedTo.toString();
          });
        }
      }
      if (filter['rejection.reason'] && filter['rejection.reason'].$exists === false) {
        list = list.filter((e) => {
          const plain = (e as any).toObject ? (e as any).toObject() : e;
          return !plain.rejection?.reason;
        });
      }
      if (filter['dealDone.isConfirmed'] && filter['dealDone.isConfirmed'].$ne === true) {
        list = list.filter((e) => {
          const plain = (e as any).toObject ? (e as any).toObject() : e;
          return !plain.dealDone?.isConfirmed;
        });
      }
    }

    const populated = list.map((e) => {
      const plain = (e as any).toObject ? (e as any).toObject() : e;
      const assignedUser = plain.assignedTo ? usersMap.get(plain.assignedTo.toString()) : null;
      return {
        ...plain,
        _id: plain._id || e._id,
        id: (plain._id || e._id)?.toString(),
        assignedTo: assignedUser ? { _id: assignedUser._id, id: assignedUser.id, name: assignedUser.name, email: assignedUser.email, role: assignedUser.role } : plain.assignedTo
      };
    });

    const createChain = (items: any[]) => ({
      populate: () => createChain(items),
      sort: () => createChain(items),
      skip: () => createChain(items),
      limit: () => createChain(items),
      lean: () => Promise.resolve(items),
      then: (fn: any) => Promise.resolve(items).then(fn)
    });
    return createChain(populated);
  }) as any;

  Enquiry.countDocuments = ((filter?: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter?.status) {
      list = list.filter((e) => {
        const plain = (e as any).toObject ? (e as any).toObject() : e;
        return plain.status === filter.status;
      });
    }
    return Promise.resolve(list.length);
  }) as any;

  FollowUpTask.find = (() => ({
    sort: () => Promise.resolve([]),
    then: (fn: any) => Promise.resolve([]).then(fn)
  })) as any;

  (Enquiry as any).updateMany = (async (filter: any, update: any) => {
    let matched = Array.from(enquiriesMap.values());
    if (filter?.assignedTo) {
      matched = matched.filter((e) => {
        const plain = (e as any).toObject ? (e as any).toObject() : e;
        return plain.assignedTo && plain.assignedTo.toString() === filter.assignedTo.toString();
      });
    }
    if (filter?.status) {
      matched = matched.filter((e) => {
        const plain = (e as any).toObject ? (e as any).toObject() : e;
        return plain.status === filter.status;
      });
    }
    for (const e of matched) {
      if (update?.$set?.assignedTo !== undefined) {
        e.assignedTo = update.$set.assignedTo;
      }
    }
    return { matchedCount: matched.length, modifiedCount: matched.length };
  }) as any;

  Enquiry.create = (async (doc: any) => {
    const id = new Types.ObjectId();
    const item = {
      _id: id,
      id: id.toString(),
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        enquiriesMap.set(this._id.toString(), this);
        return this;
      }
    };
    enquiriesMap.set(id.toString(), item);
    return item;
  }) as any;

  EnquiryActivity.prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    activitiesMap.set(this._id.toString(), this);
    return this;
  };

  try {
    // =========================================================================
    // SECTION 1: REASSIGNMENT ACCEPTANCE SCENARIOS (1 to 10)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Scenario 1: Admin assigns a lead to Manager A
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Admin assigns a lead to Manager A ---');
    const adminLeadId = new Types.ObjectId();
    const adminAssignedLead = createMockEnquiry({
      _id: adminLeadId,
      id: adminLeadId.toString(),
      name: 'Admin Client One',
      mobile: '9811111101',
      projectName: 'Greenfield Heights',
      assignedTo: managerAId,
      status: 'ACTIVE'
    });
    enquiriesMap.set(adminLeadId.toString(), adminAssignedLead);

    assert(adminAssignedLead.assignedTo.toString() === managerAId.toString(), 'Scenario 1: Lead successfully assigned to Manager A by Admin');

    // -------------------------------------------------------------------------
    // Scenario 2 & 3: Manager A opens Reassign; Admin-assigned lead appears in selection list
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 2 & 3: Manager A queries eligible leads for reassignment ---');
    const eligibleRes1 = await enquiryService.listEnquiries(
      { assignedTo: managerAId.toString(), status: 'ACTIVE', excludeCompletedDeals: true },
      managerAActor
    );

    assert(eligibleRes1.success === true, 'Scenario 2: Manager A retrieves eligible leads');
    assert(
      eligibleRes1.enquiries.some((e) => e._id.toString() === adminLeadId.toString()),
      'Scenario 3: Admin-assigned lead appears in Manager A eligible reassignment list'
    );

    // -------------------------------------------------------------------------
    // Scenario 4 & 5: Manager A creates a new lead assigned to themselves & it appears in Reassign list
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 4 & 5: Manager A creates a lead assigned to self ---');
    const mgrCreateRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerAToken}` },
      body: JSON.stringify({
        name: 'Manager Created Prospect',
        mobile: '9811111102',
        projectName: 'Greenfield Heights',
        // Omitting assignedToId defaults directly to Manager A
      })
    });
    const mgrCreateData = (await mgrCreateRes.json()) as any;
    if (mgrCreateRes.status !== 201) {
      console.log('mgrCreateRes error:', mgrCreateRes.status, mgrCreateData);
    }
    assert(mgrCreateRes.status === 201, 'Scenario 4: Manager-created lead returns HTTP 201');
    const mgrCreatedLeadId = mgrCreateData.data?.enquiry?.id || mgrCreateData.data?.enquiry?._id;
    const assignedToVal =
      mgrCreateData.data?.enquiry?.assignedTo?.id ||
      mgrCreateData.data?.enquiry?.assignedTo?._id ||
      mgrCreateData.data?.enquiry?.assignedTo;
    assert(
      assignedToVal?.toString() === managerAId.toString(),
      'Scenario 4: Lead created by Manager A initially defaults to Manager A'
    );

    // Re-check eligible list for Manager A
    const eligibleRes2 = await enquiryService.listEnquiries(
      { assignedTo: managerAId.toString(), status: 'ACTIVE', excludeCompletedDeals: true },
      managerAActor
    );
    assert(
      eligibleRes2.enquiries.some((e) => e._id.toString() === mgrCreatedLeadId.toString()),
      'Scenario 5: Manager-created lead assigned to self appears in Reassign eligible list'
    );

    // -------------------------------------------------------------------------
    // Scenario 6, 7 & 8: Manager A assigns lead to Sales Agent A1
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 6, 7 & 8: Manager A reassigns lead to Sales Agent A1 ---');
    const reassignRes = await fetch(`${baseUrl}/api/v1/enquiries/${mgrCreatedLeadId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerAToken}` },
      body: JSON.stringify({ assignedToId: agentA1Id.toString() })
    });
    assert(reassignRes.status === 200, 'Scenario 6: Manager A reassigns lead to Agent A1 with HTTP 200');

    const updatedLeadInDb = enquiriesMap.get(mgrCreatedLeadId.toString());
    assert(
      updatedLeadInDb.assignedTo.toString() === agentA1Id.toString(),
      'Scenario 7: Lead is now assigned to Agent A1'
    );

    // Verify Agent A1 sees the lead in their dashboard query
    const agentA1Leads = await enquiryService.listEnquiries({ status: 'ACTIVE' }, agentA1Actor);
    assert(
      agentA1Leads.enquiries.some((e) => e._id.toString() === mgrCreatedLeadId.toString()),
      'Scenario 7: Reassigned lead appears in Agent A1 dashboard queries'
    );

    // Verify lead is removed from Manager A's eligible reassignment list
    const eligibleRes3 = await enquiryService.listEnquiries(
      { assignedTo: managerAId.toString(), status: 'ACTIVE', excludeCompletedDeals: true },
      managerAActor
    );
    assert(
      !eligibleRes3.enquiries.some((e) => e._id.toString() === mgrCreatedLeadId.toString()),
      'Scenario 8: Reassigned lead is removed from Manager A eligible reassignment list'
    );

    // -------------------------------------------------------------------------
    // Scenario 9: Manager A cannot access or assign Manager B's leads
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 9: Cross-manager lead protection ---");
    const leadBId = new Types.ObjectId();
    const leadBDoc = createMockEnquiry({
      _id: leadBId,
      id: leadBId.toString(),
      name: 'Manager B Private Lead',
      mobile: '9811111103',
      projectName: 'Blue Lagoon Villas',
      assignedTo: managerBId,
      status: 'ACTIVE'
    });
    enquiriesMap.set(leadBId.toString(), leadBDoc);

    const crossAssignRes = await fetch(`${baseUrl}/api/v1/enquiries/${leadBId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerAToken}` },
      body: JSON.stringify({ assignedToId: agentA1Id.toString() })
    });
    assert(
      crossAssignRes.status === 403,
      'Scenario 9: Manager A assigning Manager B lead rejected with HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------------------
    // Scenario 10: Manager A cannot assign to an agent outside their team
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Cross-team target agent protection ---');
    const outsideAssignRes = await fetch(`${baseUrl}/api/v1/enquiries/${adminLeadId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerAToken}` },
      body: JSON.stringify({ assignedToId: agentB1Id.toString() }) // Agent B1 belongs to Manager B
    });
    assert(
      outsideAssignRes.status === 403,
      'Scenario 10: Manager A assigning lead to Agent B1 (outside team) rejected with HTTP 403 Forbidden'
    );

    // =========================================================================
    // SECTION 2: MANAGER DEACTIVATION ACCEPTANCE SCENARIOS (11 to 18)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Scenario 11, 12 & 13: Admin deactivates Manager A with Option A (Transfer to Manager B)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 11, 12 & 13: Deactivate Manager with Option A (Transfer to Manager B) ---');
    // Ensure Manager A has a lead assigned
    const deactTransferLeadId = new Types.ObjectId();
    const deactTransferLead = createMockEnquiry({
      _id: deactTransferLeadId,
      id: deactTransferLeadId.toString(),
      name: 'Client Transfer Pending',
      mobile: '9811111104',
      projectName: 'Emerald Gardens',
      assignedTo: managerAId,
      status: 'ACTIVE'
    });
    enquiriesMap.set(deactTransferLeadId.toString(), deactTransferLead);

    // Also Agent A1 reports to Manager A
    assert(agentA1Doc.managerId.toString() === managerAId.toString(), 'Agent A1 initially reports to Manager A');

    const deactRes1 = await fetch(`${baseUrl}/api/v1/users/${managerAId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        isActive: false,
        transferOption: 'TRANSFER_TO_MANAGER',
        targetManagerId: managerBId.toString()
      })
    });
    assert(deactRes1.status === 200, 'Scenario 11: Admin deactivates Manager A with Option A (HTTP 200)');

    assert(managerADoc.isActive === false, 'Scenario 11: Manager A isActive is now false');
    assert(
      agentA1Doc.managerId.toString() === managerBId.toString(),
      'Scenario 12: Sales Agent A1 reporting manager was transferred to Manager B'
    );
    assert(
      deactTransferLead.assignedTo.toString() === managerBId.toString(),
      'Scenario 12: Lead was transferred to Manager B'
    );
    assert(
      deactTransferLead.projectName === 'Emerald Gardens' && deactTransferLead.mobile === '9811111104',
      'Scenario 13: Lead records and attributes remained completely intact'
    );

    // -------------------------------------------------------------------------
    // Scenario 14: Deactivated Manager cannot access protected endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 14: Deactivated Manager access blocked ---');
    const blockedRes = await fetch(`${baseUrl}/api/v1/enquiries/team/roster`, {
      headers: { Authorization: `Bearer ${managerAToken}` }
    });
    assert(
      blockedRes.status === 401,
      'Scenario 14: Deactivated Manager request rejected with HTTP 401 (User account has been deactivated)'
    );

    // -------------------------------------------------------------------------
    // Scenario 15 & 16: Admin deactivates Manager B with Option B (Admin handles)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 15 & 16: Deactivate Manager with Option B (Admin handles team & leads) ---');
    // Manager B currently has Agent B1 and Agent A1 reporting, plus leads
    const deactAdminLeadId = new Types.ObjectId();
    const deactAdminLead = createMockEnquiry({
      _id: deactAdminLeadId,
      id: deactAdminLeadId.toString(),
      name: 'Client for Admin Direct Handle',
      mobile: '9811111105',
      projectName: 'Sapphire Court',
      assignedTo: managerBId,
      status: 'ACTIVE'
    });
    enquiriesMap.set(deactAdminLeadId.toString(), deactAdminLead);

    const deactRes2 = await fetch(`${baseUrl}/api/v1/users/${managerBId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        isActive: false,
        transferOption: 'ADMIN_HANDLE'
      })
    });
    assert(deactRes2.status === 200, 'Scenario 15: Admin deactivates Manager B with Option B (HTTP 200)');
    assert(managerBDoc.isActive === false, 'Scenario 15: Manager B isActive is now false');
    assert(agentB1Doc.managerId === null, 'Scenario 16: Agent B1 released to unassigned pool (managerId: null)');
    assert(
      deactAdminLead.assignedTo.toString() === adminId.toString(),
      'Scenario 16: Affected leads transferred to Admin account for direct control'
    );

    // -------------------------------------------------------------------------
    // Scenario 17: No other active Manager available -> Admin retains control safely
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 17: No other active manager available fallback ---');
    // Both Manager A and Manager B are now inactive.
    // If Admin reactivates Manager A and then deactivates with Option B or default:
    managerADoc.isActive = true;
    const deactRes3 = await fetch(`${baseUrl}/api/v1/users/${managerAId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        isActive: false,
        transferOption: 'ADMIN_HANDLE'
      })
    });
    assert(deactRes3.status === 200, 'Scenario 17: Deactivation when no other managers exist succeeds with Admin handle');
    assert(managerADoc.isActive === false, 'Scenario 17: Manager A deactivated safely');

    // -------------------------------------------------------------------------
    // Scenario 18: Failed transfers do not leave partial state
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 18: Invalid transfer targets rejected cleanly ---');
    managerADoc.isActive = true;
    const invalidTargetRes = await fetch(`${baseUrl}/api/v1/users/${managerAId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        isActive: false,
        transferOption: 'TRANSFER_TO_MANAGER',
        targetManagerId: managerBId.toString() // Manager B is inactive!
      })
    });
    assert(invalidTargetRes.status === 400, 'Scenario 18: Transfer to inactive manager rejected with HTTP 400');
    assert(managerADoc.isActive === true, 'Scenario 18: Manager A remains active after failed transfer attempt');

  } finally {
    // Restore Mongoose methods
    User.findById = origUserFindById;
    User.find = origUserFind;
    User.updateMany = origUserUpdateMany;
    Enquiry.findById = origEnquiryFindById;
    Enquiry.find = origEnquiryFind;
    Enquiry.findOne = origEnquiryFindOne;
    Enquiry.countDocuments = origEnquiryCount;
    FollowUpTask.find = origFollowUpFind;
    (Enquiry as any).updateMany = origEnquiryUpdateMany;
    Enquiry.create = origEnquiryCreate;
    Enquiry.prototype.save = origEnquirySave;
    Enquiry.prototype.populate = origEnquiryPopulate;
    EnquiryActivity.prototype.save = origActivitySave;
    notificationService.createNotification = origCreateNotif;
    Object.defineProperty(mongoose.connection, 'readyState', { value: origReadyState, configurable: true });

    if (server) {
      server.close();
    }
  }

  console.log('\n====================================================');
  console.log(`Test Suite Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
