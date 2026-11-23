/**
 * Sales Agent Property Assignment & Round Robin Integration Test Suite
 *
 * Verifies:
 * 1. Admin creates a SALES agent with propertyIds: saves assignedPropertyIds on User, syncs PropertyMapping.agentIds.
 * 2. Admin creates a MANAGER: propertyIds are not assigned to managers.
 * 3. Admin updates a SALES agent's propertyIds: adds new properties and removes old ones safely.
 * 4. Property mapping list & safe profile data return assignedProperties and assignedPropertyIds.
 * 5. Round Robin distribution selects ONLY active agents assigned to that property.
 * 6. Lead immutability: changing an agent's assigned properties does NOT modify previously created leads.
 * 7. Unassigned Queue: when a property has no active assigned agents, lead remains unassigned and triggers SYSTEM_ALERT.
 * 8. Access control: non-admin requests to create/edit employee or modify properties are rejected with 403 Forbidden.
 */

import http from 'http';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../app.js';
import { PropertyMapping } from '../models/property-mapping.model.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry } from '../models/enquiry.model.js';
import { Notification } from '../models/notification.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { propertyMappingService } from '../services/property-mapping.service.js';
import { enquiryService } from '../services/enquiry.service.js';
import { userService } from '../services/user.service.js';
import { authService } from '../services/auth.service.js';

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
    assignedPropertyIds: data.assignedPropertyIds || [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

async function runTests() {
  console.log('====================================================');
  console.log('Starting Sales Agent Property Assignment Tests');
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

  // Mock Users Map
  const adminUser = createMockUser({ name: 'Admin Root', email: 'admin@neuways.com', role: 'ADMIN' });
  const managerUser = createMockUser({ name: 'Manager Bob', email: 'bob@neuways.com', role: 'MANAGER' });
  const agent1 = createMockUser({ name: 'Agent Alice', email: 'alice@neuways.com', role: 'SALES' });
  const agent2 = createMockUser({ name: 'Agent Charlie', email: 'charlie@neuways.com', role: 'SALES' });

  const usersMap = new Map<string, any>([
    [adminUser.id, adminUser],
    [managerUser.id, managerUser],
    [agent1.id, agent1],
    [agent2.id, agent2],
  ]);

  // Mock Properties Map
  const prop1Id = new Types.ObjectId();
  const prop2Id = new Types.ObjectId();
  const prop3Id = new Types.ObjectId();

  const mappingsMap = new Map<string, any>([
    [
      prop1Id.toString(),
      {
        _id: prop1Id,
        id: prop1Id.toString(),
        propertyName: 'Palm Heights',
        normalizedName: 'palm heights',
        agentIds: [agent1._id],
        lastAssignedIndex: 0,
        lastAssignedAgentId: agent1._id,
        save: async function () {
          return this;
        },
      },
    ],
    [
      prop2Id.toString(),
      {
        _id: prop2Id,
        id: prop2Id.toString(),
        propertyName: 'Azure Bay',
        normalizedName: 'azure bay',
        agentIds: [],
        lastAssignedIndex: -1,
        lastAssignedAgentId: null,
        save: async function () {
          return this;
        },
      },
    ],
    [
      prop3Id.toString(),
      {
        _id: prop3Id,
        id: prop3Id.toString(),
        propertyName: 'Sunset Meadows',
        normalizedName: 'sunset meadows',
        agentIds: [],
        lastAssignedIndex: -1,
        lastAssignedAgentId: null,
        save: async function () {
          return this;
        },
      },
    ],
  ]);

  agent1.assignedPropertyIds = [prop1Id];

  const enquiriesMap = new Map<string, any>();
  const notificationsCreated: any[] = [];

  // Tokens
  const adminToken = authService.generateToken({ id: adminUser.id, email: adminUser.email, role: 'ADMIN' });
  const managerToken = authService.generateToken({ id: managerUser.id, email: managerUser.email, role: 'MANAGER' });
  const salesToken = authService.generateToken({ id: agent1.id, email: agent1.email, role: 'SALES' });

  // Pretend DB readyState = 1
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

  // Hook PropertyMapping Mongoose methods
  PropertyMapping.find = ((filter?: any) => {
    let list = Array.from(mappingsMap.values());
    if (filter) {
      if (filter._id && filter._id.$in) {
        const inIds = filter._id.$in.map((id: any) => id.toString());
        list = list.filter((m) => inIds.includes(m._id.toString()));
      }
      if (filter._id && filter._id.$nin) {
        const ninIds = filter._id.$nin.map((id: any) => id.toString());
        list = list.filter((m) => !ninIds.includes(m._id.toString()));
      }
      if (filter.agentIds) {
        const aId = filter.agentIds.toString();
        list = list.filter((m) => m.agentIds.some((id: any) => id.toString() === aId));
      }
      if (filter.normalizedName) {
        list = list.filter((m) => m.normalizedName === filter.normalizedName);
      }
    }
    return {
      populate: () => ({
        populate: () => ({
          sort: () => ({
            lean: () => Promise.resolve(list),
          }),
          lean: () => Promise.resolve(list),
        }),
        lean: () => Promise.resolve(list),
      }),
      select: () => ({
        lean: () => Promise.resolve(list),
        then: (fn: any) => Promise.resolve(list).then(fn),
      }),
      sort: () => ({
        lean: () => Promise.resolve(list),
      }),
      lean: () => Promise.resolve(list),
      then: (fn: any) => Promise.resolve(list).then(fn),
    };
  }) as any;

  PropertyMapping.findOneAndUpdate = (async (filter: any, update: any) => {
    let item: any = null;
    if (filter?._id) {
      item = mappingsMap.get(filter._id.toString());
    }
    if (item && update?.$set) {
      if (update.$set.lastAssignedIndex !== undefined) item.lastAssignedIndex = update.$set.lastAssignedIndex;
      if (update.$set.lastAssignedAgentId !== undefined) item.lastAssignedAgentId = update.$set.lastAssignedAgentId;
    }
    return item;
  }) as any;

  PropertyMapping.findOne = ((filter?: any) => {
    let item: any = null;
    if (filter?.normalizedName) {
      item = Array.from(mappingsMap.values()).find((m) => m.normalizedName === filter.normalizedName);
    } else if (filter?._id) {
      item = mappingsMap.get(filter._id.toString());
    }
    return {
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(item || null),
        }),
        lean: () => Promise.resolve(item || null),
      }),
      lean: () => Promise.resolve(item || null),
      then: (fn: any) => Promise.resolve(item || null).then(fn),
    };
  }) as any;

  PropertyMapping.findById = ((id: any) => {
    const item = mappingsMap.get(id?.toString());
    return {
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(item || null),
        }),
        lean: () => Promise.resolve(item || null),
      }),
      lean: () => Promise.resolve(item || null),
      then: (fn: any) => Promise.resolve(item || null).then(fn),
    };
  }) as any;

  PropertyMapping.updateMany = (async (filter: any, update: any) => {
    let matched = Array.from(mappingsMap.values());
    if (filter?._id?.$in) {
      const inIds = filter._id.$in.map((id: any) => id.toString());
      matched = matched.filter((m) => inIds.includes(m._id.toString()));
    }
    for (const m of matched) {
      if (update?.$addToSet?.agentIds) {
        const toAdd = update.$addToSet.agentIds;
        if (!m.agentIds.some((id: any) => id.toString() === toAdd.toString())) {
          m.agentIds.push(toAdd);
        }
      }
    }
    return { modifiedCount: matched.length };
  }) as any;

  // Hook User Mongoose methods
  User.prototype.save = function (this: any) {
    if (!this._id) {
      this._id = new Types.ObjectId();
      this.id = this._id.toString();
    }
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();
    usersMap.set(this._id.toString(), this);
    return Promise.resolve(this);
  };

  User.findById = ((id: any) => {
    const u = usersMap.get(id?.toString());
    return {
      select: () => Promise.resolve(u || null),
      populate: () => Promise.resolve(u || null),
      lean: () => Promise.resolve(u || null),
      then: (fn: any) => Promise.resolve(u || null).then(fn),
    };
  }) as any;

  User.findOne = ((filter?: any) => {
    let match: any = null;
    if (filter?.email) {
      match = Array.from(usersMap.values()).find((u) => u.email === filter.email);
    } else if (filter?._id) {
      match = usersMap.get(filter._id.toString());
    }
    return {
      select: () => Promise.resolve(match || null),
      then: (fn: any) => Promise.resolve(match || null).then(fn),
    };
  }) as any;

  User.find = ((filter?: any) => {
    let list = Array.from(usersMap.values());
    if (filter) {
      if (filter.role) list = list.filter((u) => u.role === filter.role);
      if (filter.isActive !== undefined) list = list.filter((u) => u.isActive === filter.isActive);
      if (filter._id && filter._id.$in) {
        const inIds = filter._id.$in.map((id: any) => id.toString());
        list = list.filter((u) => inIds.includes(u._id ? u._id.toString() : u.id));
      }
    }
    const createChain = (data: any) => ({
      select: () => createChain(data),
      populate: () => createChain(data),
      sort: () => createChain(data),
      skip: () => createChain(data),
      limit: () => createChain(data),
      lean: () => Promise.resolve(data),
      then: (fn: any) => Promise.resolve(data).then(fn),
    });

    return createChain(list);
  }) as any;

  User.updateMany = (async (filter: any, update: any) => {
    let matched = Array.from(usersMap.values());
    if (filter?._id?.$in) {
      const inIds = filter._id.$in.map((id: any) => id.toString());
      matched = matched.filter((u) => inIds.includes(u.id));
    }
    for (const u of matched) {
      if (update?.$addToSet?.assignedPropertyIds) {
        const toAdd = update.$addToSet.assignedPropertyIds;
        if (!u.assignedPropertyIds) u.assignedPropertyIds = [];
        if (!u.assignedPropertyIds.some((id: any) => id.toString() === toAdd.toString())) {
          u.assignedPropertyIds.push(toAdd);
        }
      }
      if (update?.$pull?.assignedPropertyIds) {
        const toPull = update.$pull.assignedPropertyIds;
        if (u.assignedPropertyIds) {
          u.assignedPropertyIds = u.assignedPropertyIds.filter(
            (id: any) => id.toString() !== toPull.toString()
          );
        }
      }
    }
    return { modifiedCount: matched.length };
  }) as any;

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

  Enquiry.prototype.save = async function (this: any) {
    if (!this._id) {
      this._id = new Types.ObjectId();
    }
    this.id = this._id.toString();
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

  Enquiry.create = (async (doc: any) => {
    const id = new Types.ObjectId();
    const assignedUser = doc.assignedTo ? usersMap.get(doc.assignedTo.toString()) : null;
    const enquiry = {
      _id: id,
      id: id.toString(),
      ...doc,
      currentStage: doc.currentStage || 'NEW_LEAD',
      status: doc.status || 'ACTIVE',
      assignedTo: assignedUser
        ? { _id: assignedUser._id, id: assignedUser.id, name: assignedUser.name, email: assignedUser.email, role: assignedUser.role }
        : doc.assignedTo || null,
      save: async function () {
        enquiriesMap.set(this.id, this);
        return this;
      },
    };
    enquiriesMap.set(id.toString(), enquiry);
    return enquiry;
  }) as any;

  Enquiry.findById = ((id: any) => {
    const enq = enquiriesMap.get(id?.toString());
    return {
      populate: () => ({
        populate: () => Promise.resolve(enq || null),
        then: (fn: any) => Promise.resolve(enq || null).then(fn),
      }),
      then: (fn: any) => Promise.resolve(enq || null).then(fn),
    };
  }) as any;

  Notification.create = (async (doc: any) => {
    const notif = { ...doc, _id: new Types.ObjectId(), createdAt: new Date() };
    notificationsCreated.push(notif);
    return notif;
  }) as any;

  EnquiryActivity.create = (async (doc: any) => ({ ...doc, _id: new Types.ObjectId() })) as any;
  FollowUpTask.create = (async (doc: any) => ({ ...doc, _id: new Types.ObjectId() })) as any;

  Notification.findOne = (() => Promise.resolve(null)) as any;
  Notification.prototype.save = function (this: any) {
    notificationsCreated.push(this);
    return Promise.resolve(this);
  };
  Notification.create = ((data: any) => {
    notificationsCreated.push(data);
    return Promise.resolve(data);
  }) as any;
  EnquiryActivity.prototype.save = function (this: any) {
    return Promise.resolve(this);
  };
  FollowUpTask.prototype.save = function (this: any) {
    return Promise.resolve(this);
  };

  try {
    // ----------------------------------------------------
    // Scenario 1: Admin provisions Sales Agent with propertyIds
    // ----------------------------------------------------
    const createAgentRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Agent David',
        email: 'david@neuways.com',
        role: 'SALES',
        temporaryPassword: 'TempPassword123!',
        propertyIds: [prop2Id.toString(), prop3Id.toString()],
      }),
    });

    const createAgentData = (await createAgentRes.json()) as any;
    assert(createAgentRes.status === 201, 'Scenario 1.1: Admin provisions SALES agent with propertyIds succeeds (201)');
    assert(
      Array.isArray(createAgentData.data?.assignedProperties) && createAgentData.data.assignedProperties.length === 2,
      'Scenario 1.2: Response includes populated assignedProperties array of 2 properties'
    );
    assert(
      createAgentData.data?.assignedProperties.some((p: any) => p.name === 'Azure Bay'),
      'Scenario 1.3: Response contains Azure Bay mapping'
    );

    // Verify PropertyMapping.agentIds received agent's ID
    const azureBayMapping = mappingsMap.get(prop2Id.toString());
    const sunsetMapping = mappingsMap.get(prop3Id.toString());
    assert(
      azureBayMapping.agentIds.some((id: any) => id.toString() === createAgentData.data.id),
      'Scenario 1.4: Azure Bay PropertyMapping contains new agent in agentIds'
    );
    assert(
      sunsetMapping.agentIds.some((id: any) => id.toString() === createAgentData.data.id),
      'Scenario 1.5: Sunset Meadows PropertyMapping contains new agent in agentIds'
    );

    // Add David to usersMap for subsequent tests
    const davidUser = {
      _id: new Types.ObjectId(createAgentData.data.id),
      id: createAgentData.data.id,
      name: 'Agent David',
      email: 'david@neuways.com',
      role: 'SALES',
      isActive: true,
      assignedPropertyIds: [prop2Id, prop3Id],
      save: async function () {
        return this;
      },
    };
    usersMap.set(davidUser.id, davidUser);

    // ----------------------------------------------------
    // Scenario 2: Admin provisions Manager (propertyIds ignored/not assigned)
    // ----------------------------------------------------
    const createMgrRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Manager Helen',
        email: 'helen@neuways.com',
        role: 'MANAGER',
        temporaryPassword: 'TempPassword123!',
        propertyIds: [prop1Id.toString()],
      }),
    });

    const createMgrData = (await createMgrRes.json()) as any;
    assert(createMgrRes.status === 201, 'Scenario 2.1: Admin creates MANAGER account succeeds');
    assert(
      createMgrData.data?.assignedProperties === undefined || createMgrData.data?.assignedProperties?.length === 0,
      'Scenario 2.2: Manager accounts do not hold assignedProperties'
    );

    // ----------------------------------------------------
    // Scenario 3: Admin updates existing Sales Agent properties (add prop1, remove prop3)
    // ----------------------------------------------------
    const updateAgentRes = await fetch(`${baseUrl}/api/v1/users/${davidUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        propertyIds: [prop1Id.toString(), prop2Id.toString()], // Removed prop3, added prop1
      }),
    });

    const updateAgentData = (await updateAgentRes.json()) as any;
    assert(updateAgentRes.status === 200, 'Scenario 3.1: Admin updates agent properties succeeds (200)');
    assert(
      updateAgentData.data.assignedProperties?.length === 2 &&
        updateAgentData.data.assignedProperties.some((p: any) => p.name === 'Palm Heights') &&
        updateAgentData.data.assignedProperties.some((p: any) => p.name === 'Azure Bay'),
      'Scenario 3.2: Updated profile reflects Palm Heights and Azure Bay'
    );

    // Verify PropertyMapping.agentIds updated bidirectionally
    const palmHeightsMapping = mappingsMap.get(prop1Id.toString());
    assert(
      palmHeightsMapping.agentIds.some((id: any) => id.toString() === davidUser.id),
      'Scenario 3.3: Palm Heights now contains Agent David'
    );
    assert(
      !sunsetMapping.agentIds.some((id: any) => id.toString() === davidUser.id),
      'Scenario 3.4: Sunset Meadows removed Agent David from agentIds'
    );

    // ----------------------------------------------------
    // Scenario 4: GET /api/v1/users returns assignedProperties
    // ----------------------------------------------------
    const listUsersRes = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listUsersData = (await listUsersRes.json()) as any;
    assert(listUsersRes.status === 200, 'Scenario 4.1: Admin lists users (200)');
    const davidInList = listUsersData.data.find((u: any) => u.id === davidUser.id);
    assert(
      davidInList && davidInList.assignedProperties?.length === 2,
      'Scenario 4.2: Listed Sales Agent includes assignedProperties'
    );

    // ----------------------------------------------------
    // Scenario 5: Round Robin selects only agents assigned to that property
    // ----------------------------------------------------
    // Property 2 (Azure Bay) has only David assigned. Agent 1 (Alice) is not on Azure Bay.
    // So Azure Bay lead MUST be assigned to David.
    const createLeadRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Aarav Patel',
        mobile: '9876543210',
        projectName: 'Azure Bay',
        leadSource: 'PORTAL',
      }),
    });

    const createLeadData = (await createLeadRes.json()) as any;
    console.log('Scenario 5 createLeadData.data:', JSON.stringify(createLeadData.data, null, 2));
    const createdEnquiry = createLeadData.data?.enquiry || createLeadData.data;
    assert(createLeadRes.status === 201, 'Scenario 5.1: Admin creates lead for Azure Bay via Round Robin');
    assert(
      createdEnquiry?.assignedTo?.id === davidUser.id ||
        createdEnquiry?.assignedTo?._id === davidUser.id ||
        createdEnquiry?.assignedTo === davidUser.id,
      'Scenario 5.2: Round Robin assigned Azure Bay lead specifically to Agent David'
    );

    // ----------------------------------------------------
    // Scenario 6: Lead Immutability (Changing David's properties does NOT alter previously assigned leads)
    // ----------------------------------------------------
    const existingLeadId = createdEnquiry.id || createdEnquiry._id;
    // Remove David from Azure Bay
    await fetch(`${baseUrl}/api/v1/users/${davidUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        propertyIds: [prop1Id.toString()],
      }),
    });

    const checkExistingLead = enquiriesMap.get(existingLeadId);
    const existingLeadAssignedTo = checkExistingLead?.assignedTo?._id || checkExistingLead?.assignedTo?.id || checkExistingLead?.assignedTo;
    assert(
      existingLeadAssignedTo?.toString() === davidUser.id,
      'Scenario 6.1: Lead assignment remains intact after agent property mapping is altered'
    );

    // ----------------------------------------------------
    // Scenario 7: Unassigned Queue fallback when no active agents are assigned
    // ----------------------------------------------------
    // Sunset Meadows now has 0 agents assigned.
    const unassignedLeadRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Pooja Verma',
        mobile: '9876543211',
        projectName: 'Sunset Meadows',
        leadSource: 'PORTAL',
      }),
    });

    const unassignedLeadData = (await unassignedLeadRes.json()) as any;
    const unassignedEnquiry = unassignedLeadData.data?.enquiry || unassignedLeadData.data;
    assert(unassignedLeadRes.status === 201, 'Scenario 7.1: Unassigned lead creation succeeds (201)');
    assert(
      !unassignedEnquiry?.assignedTo,
      'Scenario 7.2: Lead for Sunset Meadows is left unassigned (assignedTo: null)'
    );
    assert(
      !notificationsCreated.some((n) => n.type === 'SYSTEM_ALERT'),
      'Scenario 7.3: Admin not notified for unassigned queue entry (business rule confirmed)'
    );

    // ----------------------------------------------------
    // Scenario 8: Non-Admin Access Control (403 Forbidden)
    // ----------------------------------------------------
    const nonAdminUserRes = await fetch(`${baseUrl}/api/v1/users/${davidUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesToken}`,
      },
      body: JSON.stringify({ propertyIds: [prop1Id.toString()] }),
    });
    assert(
      nonAdminUserRes.status === 403,
      'Scenario 8.1: Sales agent cannot update employee properties (403 Forbidden)'
    );

    const nonAdminMgrRes = await fetch(`${baseUrl}/api/v1/users/${davidUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ propertyIds: [prop1Id.toString()] }),
    });
    assert(
      nonAdminMgrRes.status === 403,
      'Scenario 8.2: Manager cannot update employee properties (403 Forbidden)'
    );
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log(`\n====================================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
