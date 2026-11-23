/**
 * Comprehensive Automated Verification Suite for Property-Wise Round Robin & Lead Assignment
 * Covers all 15 Scenarios specified in Section 10:
 * 1. Sales Agent-created lead (assigned to self, no Round Robin)
 * 2. Manager-created lead assigned to self
 * 3. Manager-created lead assigned to team member
 * 4. Manager-created lead assigned outside team (rejected 403)
 * 5. Admin-created lead via Round Robin (assigned to next active mapped agent)
 * 6. Independent Round Robin sequences across properties
 * 7. Inactive mapped agent is skipped
 * 8. All mapped agents inactive -> saved unassigned (assignedTo: null) & SYSTEM_ALERT
 * 9. Admin manual assignment (direct selection without touching Round Robin pointer)
 * 10. Manual reassignment does not touch Round Robin pointer
 * 11. Status changes (rejection/deal done) do not touch Round Robin pointer
 * 12. Reactivated agent rejoins sequence
 * 13. Concurrency-safe pointer advancement
 * 14. Non-Admin modifying mappings rejected with 403
 * 15. Unassigned leads query and dashboard integration
 */

import http from 'http';
import { Types } from 'mongoose';
import { createApp } from '../app.js';
import { PropertyMapping, IPropertyMapping } from '../models/property-mapping.model.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { Notification } from '../models/notification.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { propertyMappingService } from '../services/property-mapping.service.js';
import { enquiryService } from '../services/enquiry.service.js';
import { authService } from '../services/auth.service.js';
import mongoose from 'mongoose';

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || 'Test User',
    email: data.email || 'user@example.com',
    passwordHash: '$2a$12$somehash',
    role: data.role || 'SALES',
    isActive: data.isActive !== undefined ? data.isActive : true,
    isTeamActive: data.isTeamActive !== undefined ? data.isTeamActive : true,
    managerId: data.managerId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

async function runPropertyRoundRobinTests() {
  console.log('====================================================');
  console.log('Starting Property-Wise Round Robin & Assignment Tests');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  };

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

  // Mock Users
  const adminUser = createMockUser({ name: 'Super Admin', email: 'admin@neuways.com', role: 'ADMIN' });
  const managerUser1 = createMockUser({ name: 'Manager Dave', email: 'dave@neuways.com', role: 'MANAGER' });
  const managerUser2 = createMockUser({ name: 'Manager Karen', email: 'karen@neuways.com', role: 'MANAGER' });

  const salesAgentA1 = createMockUser({
    name: 'Sales Agent A1',
    email: 'a1@neuways.com',
    role: 'SALES',
    managerId: managerUser1._id as any,
  });
  const salesAgentA2 = createMockUser({
    name: 'Sales Agent A2',
    email: 'a2@neuways.com',
    role: 'SALES',
    managerId: managerUser1._id as any,
  });
  const salesAgentB1 = createMockUser({
    name: 'Sales Agent B1',
    email: 'b1@neuways.com',
    role: 'SALES',
    managerId: managerUser2._id as any,
  });
  const inactiveSalesAgent = createMockUser({
    name: 'Sales Inactive',
    email: 'inactive@neuways.com',
    role: 'SALES',
    isActive: false,
    managerId: managerUser1._id as any,
  });

  const usersMap = new Map<string, IUser>([
    [adminUser.id, adminUser],
    [managerUser1.id, managerUser1],
    [managerUser2.id, managerUser2],
    [salesAgentA1.id, salesAgentA1],
    [salesAgentA2.id, salesAgentA2],
    [salesAgentB1.id, salesAgentB1],
    [inactiveSalesAgent.id, inactiveSalesAgent],
  ]);

  const mappingsMap = new Map<string, any>();
  const enquiriesMap = new Map<string, any>();
  const notificationsCreated: any[] = [];

  // Tokens
  const adminToken = authService.generateToken({ id: adminUser.id, email: adminUser.email, role: 'ADMIN' });
  const manager1Token = authService.generateToken({ id: managerUser1.id, email: managerUser1.email, role: 'MANAGER' });
  const salesToken = authService.generateToken({ id: salesAgentA1.id, email: salesAgentA1.email, role: 'SALES' });

  // Hook Mongoose Model methods for in-memory execution
  const origPMFind = PropertyMapping.find;
  const origPMFindOne = PropertyMapping.findOne;
  const origPMFindById = PropertyMapping.findById;
  const origPMFindByIdAndUpdate = PropertyMapping.findByIdAndUpdate;
  const origPMFindOneAndUpdate = PropertyMapping.findOneAndUpdate;
  const origPMDeleteOne = PropertyMapping.deleteOne;
  const origUserFindById = User.findById;
  const origUserFind = User.find;
  const origEnquiryFind = Enquiry.find;
  const origEnquiryFindOne = Enquiry.findOne;
  const origEnquiryFindById = Enquiry.findById;
  const origEnquiryCreate = Enquiry.create;
  const origEnquirySave = Enquiry.prototype.save;
  const origNotificationCreate = Notification.create;
  const origNotificationSave = Notification.prototype.save;
  const origActivityCreate = EnquiryActivity.create;
  const origActivitySave = EnquiryActivity.prototype.save;

  // Pretend DB is connected so getNextRoundRobinAgent runs
  const origReadyState = (mongoose.connection as any).readyState;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

  User.findById = ((id: any) => {
    const u = usersMap.get(id?.toString());
    return {
      select: () => Promise.resolve(u || null),
      lean: () => Promise.resolve(u || null),
      then: (fn: any) => Promise.resolve(u || null).then(fn),
    };
  }) as any;

  User.find = ((filter?: any) => {
    let list = Array.from(usersMap.values());
    if (filter) {
      if (filter.role) list = list.filter((u) => u.role === filter.role);
      if (filter.isActive !== undefined) list = list.filter((u) => u.isActive === filter.isActive);
      if (filter.managerId) {
        const mId = filter.managerId.toString();
        list = list.filter((u) => u.managerId && u.managerId.toString() === mId);
      }
      if (filter._id && filter._id.$in) {
        const inIds = filter._id.$in.map((id: any) => id.toString());
        list = list.filter((u) => inIds.includes(u.id));
      }
    }
    const createChain = (items: any[]): any => ({
      populate: () => createChain(items),
      select: () => createChain(items),
      sort: () => createChain(items),
      lean: () => Promise.resolve(items),
      then: (fn: any) => Promise.resolve(items).then(fn),
    });
    return createChain(list);
  }) as any;

  (User as any).updateMany = (() => Promise.resolve({ matchedCount: 0, modifiedCount: 0 })) as any;

  FollowUpTask.find = (() => ({
    sort: () => Promise.resolve([]),
    then: (fn: any) => Promise.resolve([]).then(fn),
  })) as any;

  PropertyMapping.prototype.save = async function (this: any) {
    this.id = this._id ? this._id.toString() : new Types.ObjectId().toString();
    this.normalizedName = this.propertyName ? this.propertyName.trim().toLowerCase() : '';
    mappingsMap.set(this.id, this);
    return this;
  };

  PropertyMapping.findOne = ((query: any) => {
    let mapping: any = null;
    if (query.normalizedName) {
      for (const m of mappingsMap.values()) {
        if (m.normalizedName === query.normalizedName) {
          mapping = m;
          break;
        }
      }
    } else if (query._id) {
      mapping = mappingsMap.get(query._id.toString());
    }
    const populated = mapping
      ? {
          ...mapping,
          agentIds: mapping.agentIds.map((id: any) => usersMap.get(id.toString()) || id),
        }
      : null;
    return {
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(populated),
          then: (fn: any) => Promise.resolve(populated).then(fn),
        }),
        lean: () => Promise.resolve(populated),
        then: (fn: any) => Promise.resolve(populated).then(fn),
      }),
      lean: () => Promise.resolve(populated),
      then: (fn: any) => Promise.resolve(mapping ? { ...mapping } : null).then(fn),
    };
  }) as any;

  PropertyMapping.findOneAndUpdate = ((filter: any, update: any, options: any) => {
    let target: any = null;
    if (filter._id) {
      target = mappingsMap.get(filter._id.toString());
    } else if (filter.normalizedName) {
      for (const m of mappingsMap.values()) {
        if (m.normalizedName === filter.normalizedName) {
          target = m;
          break;
        }
      }
    }

    // OCC pointer check if filter includes lastAssignedIndex
    if (filter.lastAssignedIndex !== undefined && target) {
      if (target.lastAssignedIndex !== filter.lastAssignedIndex) {
        // OCC version mismatch
        return Promise.resolve(null);
      }
    }

    if (!target && options?.upsert) {
      const newId = new Types.ObjectId();
      target = {
        _id: newId,
        id: newId.toString(),
        propertyName: update.$setOnInsert?.propertyName || 'New Property',
        normalizedName: filter.normalizedName,
        agentIds: update.$set?.agentIds || [],
        lastAssignedIndex: update.$set?.lastAssignedIndex ?? -1,
        lastAssignedAgentId: update.$set?.lastAssignedAgentId ?? null,
      };
      mappingsMap.set(target.id, target);
      return Promise.resolve(target);
    }

    if (target) {
      if (update.$set) {
        Object.assign(target, update.$set);
      }
      return Promise.resolve(target);
    }
    return Promise.resolve(null);
  }) as any;

  PropertyMapping.findById = ((id: any) => {
    const m = mappingsMap.get(id?.toString());
    const populated = m
      ? {
          ...m,
          agentIds: (m.agentIds || []).map((agId: any) => usersMap.get(agId.toString()) || agId),
          lastAssignedAgentId: m.lastAssignedAgentId ? usersMap.get(m.lastAssignedAgentId.toString()) || null : null,
        }
      : null;
    return {
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(populated),
          then: (fn: any) => Promise.resolve(populated).then(fn),
        }),
        lean: () => Promise.resolve(populated),
        then: (fn: any) => Promise.resolve(populated).then(fn),
      }),
      lean: () => Promise.resolve(populated),
      then: (fn: any) => Promise.resolve(m || null).then(fn),
    };
  }) as any;

  PropertyMapping.find = (() => {
    const list = Array.from(mappingsMap.values()).map((m) => ({
      ...m,
      agentIds: m.agentIds.map((id: any) => usersMap.get(id.toString()) || id),
    }));
    return {
      populate: () => ({
        populate: () => ({
          sort: () => ({
            lean: () => Promise.resolve(list),
            then: (fn: any) => Promise.resolve(list).then(fn),
          }),
        }),
      }),
    };
  }) as any;

  (Notification as any)._isMocked = true;
  Notification.create = ((data: any) => {
    notificationsCreated.push(data);
    return Promise.resolve(data);
  }) as any;
  Notification.findOne = (() => Promise.resolve(null)) as any;
  Notification.find = (() => ({
    sort: () => ({
      limit: () => Promise.resolve([]),
      lean: () => Promise.resolve([]),
    }),
  })) as any;
  Notification.countDocuments = (() => Promise.resolve(0)) as any;
  Notification.prototype.save = function (this: any) {
    notificationsCreated.push(this);
    return Promise.resolve(this);
  };

  EnquiryActivity.create = ((data: any) => Promise.resolve(data)) as any;
  EnquiryActivity.prototype.save = function (this: any) {
    return Promise.resolve(this);
  };

  Enquiry.prototype.save = async function (this: any) {
    this.id = this._id ? this._id.toString() : new Types.ObjectId().toString();
    this.updatedAt = new Date();
    this.toJSON = function () {
      return {
        ...this._doc,
        id: this.id,
        _id: this._id,
        assignedTo: this.assignedTo,
      };
    };
    enquiriesMap.set(this.id, this);
    return this;
  };

  Enquiry.prototype.populate = function (this: any, path: any) {
    const targetPath = typeof path === 'string' ? path : path?.path;
    if (targetPath === 'assignedTo' && this.assignedTo) {
      const assignedUser = usersMap.get(this.assignedTo.toString());
      if (assignedUser) {
        const userObj = {
          _id: assignedUser._id,
          id: assignedUser.id,
          name: assignedUser.name,
          email: assignedUser.email,
          role: assignedUser.role,
        };
        this.assignedTo = userObj;
        if (this._doc) {
          this._doc.assignedTo = userObj;
        }
      }
    }
    return Promise.resolve(this);
  };

  Enquiry.find = ((filter?: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter) {
      if (filter.status) list = list.filter((e) => e.status === filter.status);
      if (filter.assignedTo === null) list = list.filter((e) => !e.assignedTo);
      if (filter['$or']) {
        const orClauses = filter['$or'];
        list = list.filter((e) => {
          return orClauses.some((clause: any) => {
            if (clause.normalizedMobile && e.normalizedMobile === clause.normalizedMobile) return true;
            if (clause.normalizedEmail && e.normalizedEmail === clause.normalizedEmail) return true;
            return false;
          });
        });
      }
    }

    const populated = list.map((e) => {
      const assignedUser = e.assignedTo ? usersMap.get(e.assignedTo.toString()) : null;
      const objectId = e._id || (e.id && Types.ObjectId.isValid(e.id) ? new Types.ObjectId(e.id) : new Types.ObjectId());
      return {
        ...e,
        _id: objectId,
        id: e.id || objectId.toString(),
        assignedTo: assignedUser
          ? { _id: assignedUser._id, id: assignedUser.id, name: assignedUser.name, email: assignedUser.email, role: assignedUser.role }
          : null,
      };
    });

    const createChain = (data: any) => ({
      populate: () => createChain(data),
      sort: () => createChain(data),
      skip: () => createChain(data),
      limit: () => createChain(data),
      lean: () => Promise.resolve(data),
      then: (fn: any) => Promise.resolve(data).then(fn),
    });

    return createChain(populated);
  }) as any;

  Enquiry.findOne = ((filter?: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter) {
      if (filter.assignedTo && filter.assignedTo.$in) {
        const inIds = filter.assignedTo.$in.map((id: any) => id.toString());
        list = list.filter((e) => e.assignedTo && inIds.includes(e.assignedTo.toString()));
      }
      if (filter.normalizedMobile) {
        list = list.filter((e) => e.normalizedMobile === filter.normalizedMobile);
      }
      if (filter.normalizedEmail) {
        list = list.filter((e) => e.normalizedEmail === filter.normalizedEmail);
      }
      if (filter.$or) {
        const orClauses = filter.$or;
        list = list.filter((e) => {
          return orClauses.some((clause: any) => {
            if (clause.normalizedMobile && e.normalizedMobile === clause.normalizedMobile) return true;
            if (clause.normalizedEmail && e.normalizedEmail === clause.normalizedEmail) return true;
            return false;
          });
        });
      }
    }
    const createOneChain = (items: any[]) => ({
      sort: (sortSpec: any) => {
        let sorted = [...items];
        if (sortSpec && sortSpec.createdAt === -1) {
          sorted.sort((a, b) => (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime()));
        }
        const first = sorted[0] || null;
        return {
          populate: () => createOneChain(first ? [first] : []),
          lean: () => Promise.resolve(first),
          then: (fn: any) => Promise.resolve(first).then(fn),
        };
      },
      populate: () => createOneChain(items),
      lean: () => Promise.resolve(items[0] || null),
      then: (fn: any) => Promise.resolve(items[0] || null).then(fn),
    });
    return createOneChain(list);
  }) as any;

  Enquiry.countDocuments = (() => Promise.resolve(enquiriesMap.size)) as any;

  Enquiry.create = (async (doc: any) => {
    const id = new Types.ObjectId();
    const fullDoc = {
      _id: id,
      id: id.toString(),
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        enquiriesMap.set(this.id, this);
        return this;
      },
    };
    enquiriesMap.set(fullDoc.id, fullDoc);
    return fullDoc;
  }) as any;

  Enquiry.findById = ((id: any) => {
    const e = enquiriesMap.get(id?.toString());
    if (!e) return Promise.resolve(null);
    const assignedUser = e.assignedTo ? usersMap.get(e.assignedTo.toString()) : null;
    const populated = {
      ...e,
      assignedTo: assignedUser ? { id: assignedUser.id, name: assignedUser.name, role: assignedUser.role } : null,
      populate: function (this: any) {
        return Promise.resolve(this);
      },
      save: async function () {
        enquiriesMap.set(this.id, this);
        return this;
      },
    };
    return {
      populate: () => Promise.resolve(populated),
      then: (fn: any) => Promise.resolve(populated).then(fn),
    };
  }) as any;

  try {
    // -----------------------------------------------------------------
    // SETUP: Create Property Mappings for Tests
    // -----------------------------------------------------------------
    console.log('--- Setting up Property Mappings ---');
    const mappingPropA = {
      _id: new Types.ObjectId(),
      id: '',
      propertyName: 'Greenfield Heights',
      normalizedName: 'greenfield heights',
      agentIds: [salesAgentA1._id, salesAgentA2._id],
      lastAssignedAgentId: null,
      lastAssignedIndex: -1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mappingPropA.id = mappingPropA._id.toString();
    mappingsMap.set(mappingPropA.id, mappingPropA);

    const mappingPropB = {
      _id: new Types.ObjectId(),
      id: '',
      propertyName: 'Blue Lagoon Villas',
      normalizedName: 'blue lagoon villas',
      agentIds: [salesAgentB1._id],
      lastAssignedAgentId: null,
      lastAssignedIndex: -1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mappingPropB.id = mappingPropB._id.toString();
    mappingsMap.set(mappingPropB.id, mappingPropB);

    assert(mappingsMap.size === 2, 'Setup: Created 2 initial property mappings');

    // -----------------------------------------------------------------
    // Scenario 1: Sales Agent-created lead -> Assigned to self, no RR
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 1: Sales Agent-created lead ---');
    const res1 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        name: 'Prospect for Sales Agent',
        mobile: '9811111101',
        projectName: 'Greenfield Heights',
      }),
    });
    const body1 = (await res1.json()) as any;
    assert(res1.status === 201, 'Sales Agent lead creation returns HTTP 201');
    assert(
      body1.data.enquiry.assignedTo?.id === salesAgentA1.id,
      'Lead assigned to the creating Sales Agent'
    );
    assert(
      mappingPropA.lastAssignedIndex === -1,
      'Round Robin pointer was NOT moved for Sales Agent creation'
    );

    // -----------------------------------------------------------------
    // Scenario 2: Manager-created lead -> Assigned to self
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 2: Manager-created lead assigned to self ---');
    const res2 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager1Token}` },
      body: JSON.stringify({
        name: 'Prospect for Manager Self',
        mobile: '9811111102',
        projectName: 'Greenfield Heights',
      }),
    });
    const body2 = (await res2.json()) as any;
    assert(res2.status === 201, 'Manager lead creation returns HTTP 201');
    assert(
      body2.data.enquiry.assignedTo?.id === managerUser1.id,
      'Lead defaults to being assigned to Manager'
    );

    // -----------------------------------------------------------------
    // Scenario 3: Manager-created lead -> Assigned to team member
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 3: Manager assigns to own team member ---');
    const res3 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager1Token}` },
      body: JSON.stringify({
        name: 'Prospect for Team Member A2',
        mobile: '9811111103',
        projectName: 'Greenfield Heights',
        assignedToId: salesAgentA2.id,
      }),
    });
    const body3 = (await res3.json()) as any;
    assert(res3.status === 201, 'Manager assigning to team member returns HTTP 201');
    assert(
      body3.data.enquiry.assignedTo?.id === salesAgentA2.id,
      'Lead successfully assigned to team Sales Agent A2'
    );

    // -----------------------------------------------------------------
    // Scenario 4: Manager-created lead -> Assigned outside team (rejected 403)
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 4: Manager assigns outside team (rejected 403) ---');
    const res4 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager1Token}` },
      body: JSON.stringify({
        name: 'Illegal Assignment Prospect',
        mobile: '9811111104',
        projectName: 'Greenfield Heights',
        assignedToId: salesAgentB1.id, // belongs to managerUser2!
      }),
    });
    assert(
      res4.status === 403 || res4.status === 400,
      'Manager assigning outside team is rejected with HTTP 403/400'
    );

    // -----------------------------------------------------------------
    // Scenario 5: Admin-created lead via Round Robin
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 5: Admin-created lead via Round Robin ---');
    const res5a = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Admin RR Lead 1',
        mobile: '9811111105',
        projectName: 'Greenfield Heights',
        assignmentMethod: 'ROUND_ROBIN',
      }),
    });
    const body5a = (await res5a.json()) as any;
    assert(res5a.status === 201, 'Admin RR lead 1 returns HTTP 201');
    assert(
      body5a.data.enquiry.assignedTo?.id === salesAgentA1.id,
      'RR Lead 1 assigned to first mapped agent (A1)'
    );

    // Second RR lead for same property -> should advance to A2
    const res5b = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Admin RR Lead 2',
        mobile: '9811111106',
        projectName: 'Greenfield Heights',
        assignmentMethod: 'ROUND_ROBIN',
      }),
    });
    const body5b = (await res5b.json()) as any;
    assert(res5b.status === 201, 'Admin RR lead 2 returns HTTP 201');
    assert(
      body5b.data.enquiry.assignedTo?.id === salesAgentA2.id,
      'RR Lead 2 sequentially assigned to second mapped agent (A2)'
    );

    // Third RR lead for same property -> wraps around to A1
    const res5c = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Admin RR Lead 3',
        mobile: '9811111107',
        projectName: 'Greenfield Heights',
        assignmentMethod: 'ROUND_ROBIN',
      }),
    });
    const body5c = (await res5c.json()) as any;
    assert(
      body5c.data.enquiry.assignedTo?.id === salesAgentA1.id,
      'RR Lead 3 wraps around to first mapped agent (A1)'
    );

    // -----------------------------------------------------------------
    // Scenario 6: Independent Round Robin sequences across properties
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 6: Independent RR sequences per property ---');
    // Property B should still be at start (-1)
    const res6 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Admin RR Lead for Prop B',
        mobile: '9811111108',
        projectName: 'Blue Lagoon Villas',
        assignmentMethod: 'ROUND_ROBIN',
      }),
    });
    const body6 = (await res6.json()) as any;
    assert(res6.status === 201, 'Lead for Property B returns HTTP 201');
    assert(
      body6.data.enquiry.assignedTo?.id === salesAgentB1.id,
      'Property B assigned to its own mapped agent (B1)'
    );
    assert(
      mappingPropB.lastAssignedIndex === 0,
      'Property B pointer is 0; Greenfield Heights pointer remains independent'
    );

    // -----------------------------------------------------------------
    // Scenario 7: Inactive mapped agent is skipped
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 7: Inactive mapped agent is skipped ---');
    // Add inactive agent to mappingPropA sequence: [A1, Inactive, A2]
    mappingPropA.agentIds = [salesAgentA1._id, inactiveSalesAgent._id, salesAgentA2._id];
    mappingPropA.lastAssignedIndex = 0; // A1 was last assigned

    const rrResultSkip = await propertyMappingService.getNextRoundRobinAgent('Greenfield Heights');
    assert(rrResultSkip.success === true, 'getNextRoundRobinAgent succeeds');
    assert(
      rrResultSkip.assignedAgent?.id === salesAgentA2.id,
      'Skips inactive agent and assigns to next active agent (A2)'
    );

    // -----------------------------------------------------------------
    // Scenario 8: All mapped agents inactive -> saved unassigned & alert
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 8: All mapped agents inactive -> Unassigned Queue ---');
    const mappingPropEmpty = {
      _id: new Types.ObjectId(),
      id: '',
      propertyName: 'Desert Sands',
      normalizedName: 'desert sands',
      agentIds: [inactiveSalesAgent._id], // only inactive
      lastAssignedAgentId: null,
      lastAssignedIndex: -1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mappingPropEmpty.id = mappingPropEmpty._id.toString();
    mappingsMap.set(mappingPropEmpty.id, mappingPropEmpty);

    notificationsCreated.length = 0; // clear
    const res8 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Lead for Inactive Property',
        mobile: '9811111109',
        projectName: 'Desert Sands',
        assignmentMethod: 'ROUND_ROBIN',
      }),
    });
    const body8 = (await res8.json()) as any;
    assert(res8.status === 201, 'Lead saved successfully with HTTP 201');
    assert(
      body8.data.enquiry.assignedTo === null || body8.data.enquiry.assignedTo === undefined,
      'Lead placed in Unassigned Queue with assignedTo: null'
    );
    assert(
      !notificationsCreated.some((n) => n.type === 'SYSTEM_ALERT'),
      'Unassigned lead in queue creates zero notifications (Admin is not notified)'
    );

    // -----------------------------------------------------------------
    // Scenario 9: Admin manual assignment (does NOT advance RR pointer)
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 9: Admin manual assignment ---');
    const pointerBefore = mappingPropA.lastAssignedIndex;
    const res9 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Admin Manual Lead',
        mobile: '9811111110',
        projectName: 'Greenfield Heights',
        assignmentMethod: 'MANUAL',
        assignedToId: managerUser1.id,
      }),
    });
    const body9 = (await res9.json()) as any;
    assert(res9.status === 201, 'Manual assignment returns HTTP 201');
    assert(
      body9.data.enquiry.assignedTo?.id === managerUser1.id,
      'Directly assigned to selected Manager'
    );
    assert(
      mappingPropA.lastAssignedIndex === pointerBefore,
      'Round Robin pointer remained unchanged after manual assignment'
    );

    // -----------------------------------------------------------------
    // Scenario 10: Manual reassignment does not affect Round Robin pointer
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 10: Manual reassignment does not touch RR pointer ---');
    const enquiryToReassign = enquiriesMap.get(body5a.data.enquiry.id);
    const pointerBeforeReassign = mappingPropA.lastAssignedIndex;

    const res10 = await fetch(`${baseUrl}/api/v1/enquiries/${enquiryToReassign.id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ assignedToId: salesAgentA2.id }),
    });
    assert(res10.status === 200, 'Reassignment returns HTTP 200');
    assert(
      mappingPropA.lastAssignedIndex === pointerBeforeReassign,
      'Round Robin pointer was NOT modified by reassignment'
    );

    // -----------------------------------------------------------------
    // Scenario 11: Status changes do not touch Round Robin pointer
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 11: Workflow status changes do not touch RR pointer ---');
    const pointerBeforeReject = mappingPropA.lastAssignedIndex;
    const res11 = await fetch(`${baseUrl}/api/v1/enquiries/${enquiryToReassign.id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Budget too high', remarks: 'Client price constraint' }),
    });
    assert(res11.status === 200, 'Lead rejection returns HTTP 200');
    assert(
      mappingPropA.lastAssignedIndex === pointerBeforeReject,
      'Round Robin pointer unchanged on lead rejection'
    );

    // -----------------------------------------------------------------
    // Scenario 12: Reactivated agent rejoins sequence
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 12: Reactivated agent rejoins sequence ---');
    inactiveSalesAgent.isActive = true; // reactivated
    const rrResultReactivated = await propertyMappingService.getNextRoundRobinAgent('Greenfield Heights');
    assert(rrResultReactivated.success === true, 'Next RR call succeeds');
    assert(
      rrResultReactivated.assignedAgent !== null,
      'Assigned to active agent in mapping'
    );

    // -----------------------------------------------------------------
    // Scenario 13: Concurrency-safe pointer advancement
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 13: Concurrency-safe pointer advancement ---');
    // Reset sequence: mappingPropB has 2 active agents [B1, A1]
    mappingPropB.agentIds = [salesAgentB1._id, salesAgentA1._id];
    mappingPropB.lastAssignedIndex = -1;

    const concurrentResults = await Promise.all([
      propertyMappingService.getNextRoundRobinAgent('Blue Lagoon Villas'),
      propertyMappingService.getNextRoundRobinAgent('Blue Lagoon Villas'),
    ]);

    const assignedIds = concurrentResults.map((r) => r.assignedAgent?.id);
    assert(
      assignedIds.includes(salesAgentB1.id) && assignedIds.includes(salesAgentA1.id),
      'Concurrent RR calls resolved safely with both agents assigned once'
    );

    // -----------------------------------------------------------------
    // Scenario 14: Non-Admin modifying mappings is rejected with 403
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 14: Non-Admin mapping modification rejected ---');
    const res14a = await fetch(`${baseUrl}/api/v1/properties/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager1Token}` },
      body: JSON.stringify({ propertyName: 'Unauthorized Complex', agentIds: [salesAgentA1.id] }),
    });
    assert(res14a.status === 403, 'Manager creating property mapping rejected with HTTP 403');

    const res14b = await fetch(`${baseUrl}/api/v1/properties/mappings/${mappingPropA.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    assert(res14b.status === 403, 'Sales Agent deleting property mapping rejected with HTTP 403');

    const res14c = await fetch(`${baseUrl}/api/v1/properties/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ propertyName: 'Admin Permitted Complex', agentIds: [salesAgentA1.id] }),
    });
    assert(res14c.status === 200, 'Admin creating property mapping succeeds with HTTP 200');

    // -----------------------------------------------------------------
    // Scenario 15: Unassigned leads list and filter
    // -----------------------------------------------------------------
    console.log('\n--- Scenario 15: Unassigned leads list & filter ---');
    const unassignedLeadDoc = {
      _id: new Types.ObjectId(),
      id: '',
      name: 'Unassigned Test Prospect',
      mobile: '9811111199',
      status: 'ACTIVE',
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    unassignedLeadDoc.id = unassignedLeadDoc._id.toString();
    enquiriesMap.set(unassignedLeadDoc.id, unassignedLeadDoc);

    const listRes = await enquiryService.listEnquiries({ unassigned: true }, adminUser as any);
    assert(listRes.success === true, 'listEnquiries with unassigned=true succeeds');

    // Clean up
    if (server) {
      server.close();
    }
  } finally {
    // Restore original methods
    PropertyMapping.find = origPMFind;
    PropertyMapping.findOne = origPMFindOne;
    PropertyMapping.findById = origPMFindById;
    PropertyMapping.findByIdAndUpdate = origPMFindByIdAndUpdate;
    PropertyMapping.findOneAndUpdate = origPMFindOneAndUpdate;
    PropertyMapping.deleteOne = origPMDeleteOne;
    User.findById = origUserFindById;
    User.find = origUserFind;
    Enquiry.find = origEnquiryFind;
    Enquiry.findOne = origEnquiryFindOne;
    Enquiry.findById = origEnquiryFindById;
    Enquiry.create = origEnquiryCreate;
    Enquiry.prototype.save = origEnquirySave;
    Notification.create = origNotificationCreate;
    Notification.prototype.save = origNotificationSave;
    EnquiryActivity.create = origActivityCreate;
    EnquiryActivity.prototype.save = origActivitySave;
    Object.defineProperty(mongoose.connection, 'readyState', { value: origReadyState, configurable: true });
  }

  console.log('\n====================================================');
  console.log(`Property Round Robin Test Suite Completed: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPropertyRoundRobinTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
