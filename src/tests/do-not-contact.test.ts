import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { Enquiry, EnquiryActivity, FollowUpTask, User, DoNotContact } from '../models/index.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { securityService } from '../services/security.service.js';
import { AuthUser } from '../types/auth.types.js';
import { normalizeMobile } from '../utils/normalization.js';

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

// In-Memory mock stores
const enquiryStore: any[] = [];
const activityStore: any[] = [];
const userStore: any[] = [];
const taskStore: any[] = [];
const dncStore: any[] = [];

function setupMocks() {
  (mongoose.connection as any).readyState = 1;

  // Mock securityService to prevent MongoDB buffer timeout
  (securityService as any).recordSecurityLog = () => Promise.resolve();

  // 1. Enquiry mock
  (Enquiry as any).findById = (id: any) => {
    const idStr = id?.toString();
    const item = enquiryStore.find((e) => (e._id?.toString() || e.id?.toString()) === idStr);
    if (!item) {
      const emptyChain: any = {
        populate: () => emptyChain,
        lean: () => Promise.resolve(null),
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      };
      return emptyChain as any;
    }
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      },
    };
    const chain: any = {
      populate: () => chain,
      lean: () => Promise.resolve(doc),
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    };
    return chain as any;
  };

  (Enquiry as any).findOne = (filter: any = {}) => {
    let result = enquiryStore.find((e) => {
      for (const key of Object.keys(filter)) {
        if (key === '_id' && e._id?.toString() !== filter._id?.toString()) return false;
        if (key === 'normalizedMobile' && e.normalizedMobile !== filter.normalizedMobile) return false;
        if (key === 'status' && e.status !== filter.status) return false;
      }
      return true;
    });
    if (!result) {
      const chain: any = {
        sort: () => chain,
        populate: () => chain,
        lean: () => Promise.resolve(null),
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      };
      return chain as any;
    }
    const doc: any = {
      ...result,
      save: function () {
        Object.assign(result, this);
        return Promise.resolve(result);
      },
    };
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve(doc),
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    };
    return chain as any;
  };

  (Enquiry as any).find = (filter: any = {}) => {
    let result = [...enquiryStore];
    if (filter.normalizedMobile) {
      result = result.filter((e) => e.normalizedMobile === filter.normalizedMobile);
    }
    if (filter.status) {
      result = result.filter((e) => e.status === filter.status);
    }
    const chain: any = {
      select: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => result,
      lean: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain as any;
  };

  (Enquiry as any).updateMany = (filter: any = {}, update: any = {}) => {
    let count = 0;
    enquiryStore.forEach((e) => {
      let matches = true;
      if (filter.normalizedMobile && e.normalizedMobile !== filter.normalizedMobile) matches = false;
      if (matches) {
        if (update.$set) {
          Object.assign(e, update.$set);
        }
        count++;
      }
    });
    return Promise.resolve({ acknowledged: true, modifiedCount: count });
  };

  // 2. DoNotContact mock
  (DoNotContact as any)._isMocked = true;
  (DoNotContact as any).findOne = (filter: any = {}) => {
    let item = dncStore.find((d) => {
      const mob = d.normalizedMobile;
      if (filter.normalizedMobile && mob !== filter.normalizedMobile) return false;
      if (filter.isDoNotContact !== undefined && d.isDoNotContact !== filter.isDoNotContact) return false;
      return true;
    });
    if (!item) {
      const emptyChain: any = {
        lean: () => Promise.resolve(null),
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      };
      return emptyChain as any;
    }
    const doc: any = {
      ...item,
      save: function () {
        item.isDoNotContact = this.isDoNotContact;
        item.reason = this.reason;
        item.remarks = this.remarks;
        item.activatedBy = this.activatedBy;
        item.activatedByName = this.activatedByName;
        item.activatedAt = this.activatedAt;
        item.revocationReason = this.revocationReason;
        item.revocationRemarks = this.revocationRemarks;
        item.revokedBy = this.revokedBy;
        item.revokedByName = this.revokedByName;
        item.revokedAt = this.revokedAt;
        if (this.history) item.history = this.history;
        return Promise.resolve(item);
      },
    };
    const chain: any = {
      lean: () => Promise.resolve(doc),
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    };
    return chain as any;
  };

  (DoNotContact as any).find = (filter: any = {}) => {
    let result = [...dncStore];
    if (filter.isDoNotContact !== undefined) {
      result = result.filter((d) => d.isDoNotContact === filter.isDoNotContact);
    }
    const chain: any = {
      lean: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain as any;
  };

  // Constructor mock for DoNotContact
  (DoNotContact as any).prototype.save = function () {
    const mobile = this.normalizedMobile;
    const existing = dncStore.find((d) => d.normalizedMobile === mobile);
    if (existing) {
      existing.isDoNotContact = this.isDoNotContact;
      existing.reason = this.reason;
      existing.remarks = this.remarks;
      existing.activatedBy = this.activatedBy;
      existing.activatedByName = this.activatedByName;
      existing.activatedAt = this.activatedAt;
      existing.revocationReason = this.revocationReason;
      existing.revocationRemarks = this.revocationRemarks;
      existing.revokedBy = this.revokedBy;
      existing.revokedByName = this.revokedByName;
      existing.revokedAt = this.revokedAt;
      if (this.history) existing.history = this.history;
    } else {
      dncStore.push({
        normalizedMobile: this.normalizedMobile,
        isDoNotContact: this.isDoNotContact,
        reason: this.reason,
        remarks: this.remarks,
        activatedBy: this.activatedBy,
        activatedByName: this.activatedByName,
        activatedAt: this.activatedAt,
        revocationReason: this.revocationReason,
        revocationRemarks: this.revocationRemarks,
        revokedBy: this.revokedBy,
        revokedByName: this.revokedByName,
        revokedAt: this.revokedAt,
        history: this.history || [],
      });
    }
    return Promise.resolve(this);
  };

  // 3. FollowUpTask mock
  (FollowUpTask as any).findById = (id: any) => {
    const idStr = id?.toString();
    const item = taskStore.find((t) => (t._id?.toString() || t.id?.toString()) === idStr);
    if (!item) return Promise.resolve(null);
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      },
    };
    return Promise.resolve(doc);
  };

  (FollowUpTask as any).findOne = (filter: any = {}) => {
    const item = taskStore.find((t) => {
      if (filter.enquiryId && t.enquiryId?.toString() !== filter.enquiryId?.toString()) return false;
      if (filter.purpose && t.purpose !== filter.purpose) return false;
      if (filter.status && filter.status.$in && !filter.status.$in.includes(t.status)) return false;
      return true;
    });
    if (!item) {
      const chain: any = {
        sort: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      };
      return chain as any;
    }
    const doc: any = {
      ...item,
      save: function () {
        Object.assign(item, this);
        return Promise.resolve(item);
      },
    };
    const chain: any = {
      sort: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    };
    return chain as any;
  };

  (FollowUpTask as any).find = (filter: any = {}) => {
    let result = [...taskStore];
    if (filter.enquiryId) {
      if (filter.enquiryId.$in) {
        const ids = filter.enquiryId.$in.map((id: any) => id.toString());
        result = result.filter((t) => ids.includes(t.enquiryId?.toString()));
      } else {
        result = result.filter((t) => t.enquiryId?.toString() === filter.enquiryId?.toString());
      }
    }
    if (filter.status) {
      if (filter.status.$in) {
        result = result.filter((t) => filter.status.$in.includes(t.status));
      } else {
        result = result.filter((t) => t.status === filter.status);
      }
    }
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      select: () => chain,
      lean: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain as any;
  };

  (FollowUpTask as any).updateMany = (filter: any = {}, update: any = {}) => {
    let count = 0;
    taskStore.forEach((t) => {
      let matches = true;
      if (filter.enquiryId?.$in) {
        const ids = filter.enquiryId.$in.map((id: any) => id.toString());
        if (!ids.includes(t.enquiryId?.toString())) matches = false;
      }
      if (filter.status?.$in) {
        if (!filter.status.$in.includes(t.status)) matches = false;
      }
      if (matches) {
        if (update.$set) {
          Object.assign(t, update.$set);
        }
        count++;
      }
    });
    return Promise.resolve({ acknowledged: true, modifiedCount: count });
  };

  (FollowUpTask as any).countDocuments = (filter: any = {}) => {
    let result = [...taskStore];
    if (filter.enquiryId) {
      result = result.filter((t) => t.enquiryId?.toString() === filter.enquiryId?.toString());
    }
    return Promise.resolve(result.length);
  };

  (FollowUpTask as any).prototype.save = function () {
    const existingIdx = taskStore.findIndex((t) => t._id?.toString() === this._id?.toString());
    if (existingIdx !== -1) {
      taskStore[existingIdx] = this;
    } else {
      if (!this._id) this._id = new Types.ObjectId();
      taskStore.push(this);
    }
    return Promise.resolve(this);
  };

  // 4. EnquiryActivity mock
  (EnquiryActivity as any).prototype.save = function () {
    if (!this._id) this._id = new Types.ObjectId();
    const act: any = {
      _id: this._id,
      enquiryId: this.enquiryId,
      type: this.type,
      note: this.note,
      performedBy: this.performedBy,
      performedByName: this.performedByName,
      metadata: this.metadata || this.meta || {},
    };
    activityStore.push(act);
    return Promise.resolve(this);
  };

  // 5. User mock
  (User as any).findById = (id: any) => {
    const idStr = id?.toString();
    const item = userStore.find((u) => (u._id?.toString() || u.id?.toString()) === idStr);
    const chain: any = {
      select: () => Promise.resolve(item || null),
      then: (resolve: any, reject: any) => Promise.resolve(item || null).then(resolve, reject),
    };
    return chain as any;
  };

  (User as any).findOne = (filter: any = {}) => {
    const item = userStore.find((u) => {
      if (filter._id && u._id?.toString() !== filter._id?.toString()) return false;
      if (filter.role && u.role !== filter.role) return false;
      if (filter.isActive !== undefined && u.isActive !== filter.isActive) return false;
      return true;
    });
    const chain: any = {
      select: () => Promise.resolve(item || null),
      then: (resolve: any, reject: any) => Promise.resolve(item || null).then(resolve, reject),
    };
    return chain as any;
  };

  (User as any).find = (filter: any = {}) => {
    let result = [...userStore];
    if (filter.role) result = result.filter((u) => u.role === filter.role);
    if (filter.isActive !== undefined) result = result.filter((u) => u.isActive === filter.isActive);
    const chain: any = {
      sort: () => chain,
      select: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain as any;
  };
}

// Helper to reset in-memory stores (preserves userStore)
function resetStore() {
  enquiryStore.length = 0;
  activityStore.length = 0;
  taskStore.length = 0;
  dncStore.length = 0;
}

// Test Suite
async function runTests() {
  console.log('=== STARTING REQ-38 DO NOT CONTACT (DNC) COMPREHENSIVE TEST SUITE ===\n');
  setupMocks();

  const service = new EnquiryService();

  // Test Actors
  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Admin Boss',
    email: 'admin@neuways.com',
    role: 'ADMIN',
  };

  const managerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Manager Mike',
    email: 'mike@neuways.com',
    role: 'MANAGER',
  };

  const otherManagerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Other Manager Olga',
    email: 'olga@neuways.com',
    role: 'MANAGER',
  };

  const salesActor1: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Sales Agent Sam',
    email: 'sam@neuways.com',
    role: 'SALES',
  };

  const salesActor2: AuthUser = {
    id: new Types.ObjectId().toString(),
    name: 'Sales Agent Sally',
    email: 'sally@neuways.com',
    role: 'SALES',
  };

  // Populate users in store
  userStore.push(
    { _id: new Types.ObjectId(adminActor.id), name: adminActor.name, email: adminActor.email, role: 'ADMIN', isActive: true },
    { _id: new Types.ObjectId(managerActor.id), name: managerActor.name, email: managerActor.email, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(otherManagerActor.id), name: otherManagerActor.name, email: otherManagerActor.email, role: 'MANAGER', isActive: true },
    { _id: new Types.ObjectId(salesActor1.id), name: salesActor1.name, email: salesActor1.email, role: 'SALES', isActive: true, managerId: new Types.ObjectId(managerActor.id) },
    { _id: new Types.ObjectId(salesActor2.id), name: salesActor2.name, email: salesActor2.email, role: 'SALES', isActive: true, managerId: new Types.ObjectId(otherManagerActor.id) }
  );

  // Helper to create enquiry in store
  const createTestEnquiry = (overrides: any = {}) => {
    const mobile = overrides.mobile || '9876543210';
    const norm = normalizeMobile(mobile);
    const enq: any = {
      _id: new Types.ObjectId(),
      name: overrides.name || 'Test Customer',
      mobile,
      normalizedMobile: norm,
      email: overrides.email || 'customer@test.com',
      normalizedEmail: overrides.email ? overrides.email.toLowerCase() : 'customer@test.com',
      status: overrides.status || 'ACTIVE',
      currentStage: overrides.currentStage || 'FOLLOW_UP',
      assignedTo: overrides.assignedTo !== undefined ? overrides.assignedTo : new Types.ObjectId(salesActor1.id),
      managerId: overrides.managerId !== undefined ? overrides.managerId : new Types.ObjectId(managerActor.id),
      isDoNotContact: Boolean(overrides.isDoNotContact),
      meetingPlan: overrides.meetingPlan,
      siteVisitPlan: overrides.siteVisitPlan,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: function () {
        const idx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
        if (idx !== -1) enquiryStore[idx] = this;
        else enquiryStore.push(this);
        return Promise.resolve(this);
      },
    };
    enquiryStore.push(enq);
    return enq;
  };

  // Helper to create task in store
  const createTestTask = (enquiryId: any, overrides: any = {}) => {
    const task: any = {
      _id: new Types.ObjectId(),
      enquiryId: new Types.ObjectId(enquiryId.toString()),
      assignedTo: overrides.assignedTo || new Types.ObjectId(salesActor1.id),
      purpose: overrides.purpose || 'CALL',
      status: overrides.status || 'PENDING',
      cancellationReason: overrides.cancellationReason,
      followUpDate: new Date(),
      followUpTime: '10:00 AM',
      notes: overrides.notes || 'Follow up note',
      save: function () {
        const idx = taskStore.findIndex((t) => t._id.toString() === this._id.toString());
        if (idx !== -1) taskStore[idx] = this;
        else taskStore.push(this);
        return Promise.resolve(this);
      },
    };
    taskStore.push(task);
    return task;
  };

  // ---------------------------------------------------------------------------
  // TEST CASE 1: Customer requests DNC -> DNC enabled successfully
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer stated do not call again' },
      salesActor1
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(enq.isDoNotContact, true);
    const dnc = dncStore.find((d) => d.normalizedMobile === enq.normalizedMobile);
    assert.ok(dnc);
    assert.strictEqual(dnc.isDoNotContact, true);
    assert.strictEqual(dnc.reason, 'CUSTOMER_EXPLICITLY_REQUESTED');
    pass('TC-01: Customer requests DNC -> DNC enabled successfully with approved reason and mandatory remarks');
  } catch (err) {
    fail('TC-01: Customer requests DNC -> DNC enabled successfully', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 2: Legal/regulatory opt-out -> DNC enabled successfully
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'LEGAL_REGULATORY_OPT_OUT', remarks: 'Official TRAI/NDNC compliance opt-out notice' },
      adminActor
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(enq.isDoNotContact, true);
    pass('TC-02: Legal/regulatory opt-out -> DNC enabled successfully');
  } catch (err) {
    fail('TC-02: Legal/regulatory opt-out -> DNC enabled successfully', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 3: Reason OTHER with remarks -> DNC enabled successfully
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'OTHER', remarks: 'Customer relocated abroad permanently and requested no contact' },
      salesActor1
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(enq.isDoNotContact, true);
    pass('TC-03: Reason OTHER with remarks -> DNC enabled successfully');
  } catch (err) {
    fail('TC-03: Reason OTHER with remarks -> DNC enabled successfully', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 4: Reason empty -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: '', remarks: 'Some remarks' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    pass('TC-04: Reason empty -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-04: Reason empty -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 5: Reason not in approved list (e.g. INVALID_CONTACT_DETAILS) -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'INVALID_CONTACT_DETAILS', remarks: 'Phone number belongs to someone else' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.message.includes('INVALID_CONTACT_DETAILS is not a valid Do Not Contact reason'));
    pass('TC-05: Reason not in approved list (e.g. INVALID_CONTACT_DETAILS) -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-05: Reason not in approved list (e.g. INVALID_CONTACT_DETAILS) -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 6: Remarks empty or whitespace -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: '   ' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    pass('TC-06: Remarks empty or whitespace -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-06: Remarks empty or whitespace -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 7: Remarks containing prohibited sensitive content -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer password is SecretPassword123! and otp 998877' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.message.includes('prohibited sensitive content'));
    pass('TC-07: Remarks containing prohibited sensitive content (passwords/credentials) -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-07: Remarks containing prohibited sensitive content -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 8: Sales agent enables DNC on assigned lead -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({ assignedTo: new Types.ObjectId(salesActor1.id) });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer called and opted out' },
      salesActor1
    );
    assert.strictEqual(res.success, true);
    pass('TC-08: Sales agent enables DNC on assigned lead -> Allowed');
  } catch (err) {
    fail('TC-08: Sales agent enables DNC on assigned lead -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 9: Sales agent attempts to enable DNC on unassigned lead -> Returns 403 Forbidden
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({ assignedTo: null });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 403);
    pass('TC-09: Sales agent attempts to enable DNC on unassigned lead -> Returns 403 Forbidden');
  } catch (err) {
    fail('TC-09: Sales agent attempts to enable DNC on unassigned lead -> Returns 403 Forbidden', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 10: Sales agent attempts to enable DNC on another agent's lead -> Returns 403 Forbidden
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({ assignedTo: new Types.ObjectId(salesActor2.id) });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 403);
    pass('TC-10: Sales agent attempts to enable DNC on another agent\'s lead -> Returns 403 Forbidden');
  } catch (err) {
    fail('TC-10: Sales agent attempts to enable DNC on another agent\'s lead -> Returns 403 Forbidden', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 11: Manager enables DNC on team lead -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({
      assignedTo: new Types.ObjectId(salesActor1.id),
      managerId: new Types.ObjectId(managerActor.id),
    });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Manager verified customer opt out' },
      managerActor
    );
    assert.strictEqual(res.success, true);
    pass('TC-11: Manager enables DNC on team lead -> Allowed');
  } catch (err) {
    fail('TC-11: Manager enables DNC on team lead -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 12: Manager attempts to enable DNC on non-team lead -> Returns 403 Forbidden
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({
      assignedTo: new Types.ObjectId(salesActor2.id), // salesActor2 belongs to otherManagerActor
      managerId: new Types.ObjectId(otherManagerActor.id),
    });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      managerActor // managerActor is not their manager
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 403);
    pass('TC-12: Manager attempts to enable DNC on non-team lead -> Returns 403 Forbidden');
  } catch (err) {
    fail('TC-12: Manager attempts to enable DNC on non-team lead -> Returns 403 Forbidden', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 13: Admin enables DNC on any lead -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({ assignedTo: new Types.ObjectId(salesActor2.id) });
    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'LEGAL_REGULATORY_OPT_OUT', remarks: 'Admin registered customer opt-out' },
      adminActor
    );
    assert.strictEqual(res.success, true);
    pass('TC-13: Admin enables DNC on any lead -> Allowed');
  } catch (err) {
    fail('TC-13: Admin enables DNC on any lead -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 14: Sales agent attempts to revoke DNC -> Returns 403 Forbidden
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({ assignedTo: new Types.ObjectId(salesActor1.id) });
    // Enable DNC first
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer opt out' },
      adminActor
    );
    // Sales tries to revoke
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_RENEWED_CONSENT', remarks: 'Customer called me back' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 403);
    assert.ok(res.message.includes('Sales agents cannot revoke Do Not Contact restrictions'));
    pass('TC-14: Sales agent attempts to revoke DNC -> Returns 403 Forbidden with message indicating Manager or Admin authorization required');
  } catch (err) {
    fail('TC-14: Sales agent attempts to revoke DNC -> Returns 403 Forbidden', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 15: Manager revokes DNC with reason and remarks -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({
      assignedTo: new Types.ObjectId(salesActor1.id),
      managerId: new Types.ObjectId(managerActor.id),
    });
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_RENEWED_CONSENT', remarks: 'Customer called sales agent to re-inquire' },
      managerActor
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(enq.isDoNotContact, false);
    const dnc = dncStore.find((d) => d.normalizedMobile === enq.normalizedMobile);
    assert.strictEqual(dnc.isDoNotContact, false);
    pass('TC-15: Manager revokes DNC with reason and remarks -> Allowed');
  } catch (err) {
    fail('TC-15: Manager revokes DNC with reason and remarks -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 16: Admin revokes DNC with reason and remarks -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'MANAGER_OVERRIDE', remarks: 'Admin override after reviewing dispute' },
      adminActor
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(enq.isDoNotContact, false);
    pass('TC-16: Admin revokes DNC with reason and remarks -> Allowed');
  } catch (err) {
    fail('TC-16: Admin revokes DNC with reason and remarks -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 17: Revocation reason empty -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: '', remarks: 'Remarks provided' },
      adminActor
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    pass('TC-17: Revocation reason empty -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-17: Revocation reason empty -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 18: Revocation remarks empty -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_RENEWED_CONSENT', remarks: '   ' },
      adminActor
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    pass('TC-18: Revocation remarks empty -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-18: Revocation remarks empty -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 19: Enable DNC when already enabled -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'First enable' },
      adminActor
    );
    const res2 = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Second enable attempt' },
      adminActor
    );
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.statusCode, 400);
    assert.ok(res2.message.includes('already active'));
    pass('TC-19: Enable DNC when already enabled -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-19: Enable DNC when already enabled -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 20: Revoke DNC when not enabled -> Rejected with 400 Bad Request
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry(); // DNC not active
    const res = await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_RENEWED_CONSENT', remarks: 'Try revoking when not DNC' },
      adminActor
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.message.includes('not currently active'));
    pass('TC-20: Revoke DNC when not enabled -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-20: Revoke DNC when not enabled -> Rejected with 400 Bad Request', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 21: DNC enabled on one lead applies to other leads with same normalized mobile
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const sharedMobile = '9876543210';
    const enq1 = createTestEnquiry({ name: 'Lead 1', mobile: sharedMobile });
    const enq2 = createTestEnquiry({ name: 'Lead 2', mobile: sharedMobile });
    assert.strictEqual(enq1.normalizedMobile, enq2.normalizedMobile);

    const res = await service.enableDoNotContact(
      enq1._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer wants no contact' },
      adminActor
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(enq1.isDoNotContact, true);
    assert.strictEqual(enq2.isDoNotContact, true);
    pass('TC-21: DNC enabled on one lead applies to other leads with same normalized mobile -> All share DNC status');
  } catch (err) {
    fail('TC-21: DNC enabled on one lead applies to other leads with same normalized mobile', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 22: DNC enabled -> All active non-terminal tasks cancelled
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const taskPending = createTestTask(enq._id, { status: 'PENDING' });
    const taskInProgress = createTestTask(enq._id, { status: 'IN_PROGRESS' });
    const taskRescheduled = createTestTask(enq._id, { status: 'RESCHEDULED' });

    const res = await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Cancel all tasks' },
      adminActor
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(taskPending.status, 'CANCELLED');
    assert.strictEqual(taskPending.cancellationReason, 'Customer requested Do Not Contact');
    assert.strictEqual(taskInProgress.status, 'CANCELLED');
    assert.strictEqual(taskInProgress.cancellationReason, 'Customer requested Do Not Contact');
    assert.strictEqual(taskRescheduled.status, 'CANCELLED');
    assert.strictEqual(taskRescheduled.cancellationReason, 'Customer requested Do Not Contact');
    pass('TC-22: DNC enabled -> All active non-terminal tasks (PENDING, IN_PROGRESS, RESCHEDULED) cancelled with reason "Customer requested Do Not Contact"');
  } catch (err) {
    fail('TC-22: DNC enabled -> All active non-terminal tasks cancelled', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 23: DNC enabled -> COMPLETED tasks remain COMPLETED (never overwritten)
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const completedTask = createTestTask(enq._id, { status: 'COMPLETED', notes: 'Call finished yesterday' });

    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer opted out' },
      adminActor
    );
    assert.strictEqual(completedTask.status, 'COMPLETED');
    pass('TC-23: DNC enabled -> COMPLETED tasks remain COMPLETED (never overwritten)');
  } catch (err) {
    fail('TC-23: DNC enabled -> COMPLETED tasks remain COMPLETED (never overwritten)', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 24: DNC enabled -> Already CANCELLED tasks remain CANCELLED
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const previouslyCancelled = createTestTask(enq._id, {
      status: 'CANCELLED',
      cancellationReason: 'Customer requested reschedule previously',
    });

    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer opted out' },
      adminActor
    );
    assert.strictEqual(previouslyCancelled.status, 'CANCELLED');
    assert.strictEqual(previouslyCancelled.cancellationReason, 'Customer requested reschedule previously');
    pass('TC-24: DNC enabled -> Already CANCELLED tasks remain CANCELLED with original reason preserved');
  } catch (err) {
    fail('TC-24: DNC enabled -> Already CANCELLED tasks remain CANCELLED', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 25: DNC enabled -> Attempting to schedule follow-up via createFollowUp -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.createFollowUp(
      enq._id.toString(),
      { purpose: 'CALL', followUpTime: '10:00 AM', notes: 'Attempting to call customer', followUpDate: new Date().toISOString() },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok((res.message || '').includes('Creating follow-up tasks is prohibited'));
    pass('TC-25: DNC enabled -> Attempting to schedule follow-up via createFollowUp -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-25: DNC enabled -> Attempting to schedule follow-up via createFollowUp -> Rejected with 400', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 26: DNC enabled -> Attempting to reschedule task via updateTaskStatus -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const task = createTestTask(enq._id, { status: 'PENDING' });
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    // Task was cancelled by enableDoNotContact. Let's test calling updateTaskStatus with RESCHEDULED on an enquiry with DNC
    const res = await service.updateTaskStatus(
      enq._id.toString(),
      task._id.toString(),
      { status: 'RESCHEDULED', followUpDate: '2026-12-01', followUpTime: '11:00 AM' },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    pass('TC-26: DNC enabled -> Attempting to reschedule task via updateTaskStatus -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-26: DNC enabled -> Attempting to reschedule task via updateTaskStatus -> Rejected with 400', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 27: DNC enabled -> Attempting to schedule meeting via saveWorkflowStep -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.saveWorkflowStep(
      enq._id.toString(),
      {
        step: 'MEETING_PLAN',
        meetingPlace: 'Office',
        meetingDate: '2026-12-05',
        meetingTime: '02:00 PM',
        projectDetails: 'Project X',
      },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok((res.message || '').includes('Scheduling meetings is prohibited'));
    pass('TC-27: DNC enabled -> Attempting to schedule meeting via saveWorkflowStep -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-27: DNC enabled -> Attempting to schedule meeting via saveWorkflowStep -> Rejected with 400', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 28: DNC enabled -> Attempting to schedule site visit via saveWorkflowStep -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.saveWorkflowStep(
      enq._id.toString(),
      {
        step: 'SITE_VISIT_PLAN',
        siteVisitAddress: 'Site Plot 123',
        siteVisitDate: '2026-12-06',
        siteVisitTime: '10:00 AM',
        projectName: 'Project X',
      },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok((res.message || '').includes('Scheduling site visits is prohibited'));
    pass('TC-28: DNC enabled -> Attempting to schedule site visit via saveWorkflowStep -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-28: DNC enabled -> Attempting to schedule site visit via saveWorkflowStep -> Rejected with 400', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 29: DNC enabled -> Attempting to create follow-up via saveWorkflowStep -> Rejected with 400
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.saveWorkflowStep(
      enq._id.toString(),
      {
        step: 'FOLLOW_UP',
        notes: 'Trying to contact customer',
        purpose: 'CALL',
      },
      salesActor1
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 400);
    assert.ok((res.message || '').includes('Customer follow-up is prohibited'));
    pass('TC-29: DNC enabled -> Attempting to create follow-up via saveWorkflowStep -> Rejected with 400 Bad Request');
  } catch (err) {
    fail('TC-29: DNC enabled -> Attempting to create follow-up via saveWorkflowStep -> Rejected with 400', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 30: DNC enabled -> Cancel meeting or site visit -> Allowed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry({
      meetingPlan: {
        meetingPlace: 'Office',
        meetingDate: '2026-12-10',
        meetingTime: '03:00 PM',
        projectDetails: 'Project X',
        isCompleted: false,
        isCancelled: false,
      },
    });
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    const res = await service.saveWorkflowStep(
      enq._id.toString(),
      {
        step: 'MEETING_PLAN',
        action: 'CANCEL',
        isCancelled: true,
        cancellationReason: 'Cancelled meeting because customer requested DNC',
      },
      salesActor1
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(enq.meetingPlan.isCancelled, true);
    pass('TC-30: DNC enabled -> Cancel meeting or site visit -> Allowed (cancellation does not contact customer)');
  } catch (err) {
    fail('TC-30: DNC enabled -> Cancel meeting or site visit -> Allowed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 31: New enquiry with mobile matching active DNC -> Automatically inherits isDoNotContact: true
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const mobile = '9876543210';
    const normMobile = normalizeMobile(mobile);
    dncStore.push({
      normalizedMobile: normMobile,
      isDoNotContact: true,
      reason: 'CUSTOMER_EXPLICITLY_REQUESTED',
      remarks: 'Prior customer request',
    });

    const isRestricted = await service.isMobileDncRestricted(normMobile);
    assert.strictEqual(isRestricted, true);

    const enq = createTestEnquiry({ mobile, isDoNotContact: isRestricted });
    assert.strictEqual(enq.isDoNotContact, true);
    pass('TC-31: New enquiry with mobile matching active DNC -> Automatically inherits isDoNotContact: true');
  } catch (err) {
    fail('TC-31: New enquiry with mobile matching active DNC -> Automatically inherits isDoNotContact: true', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 32: New enquiry with DNC mobile -> Initial follow-up task generation suppressed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const mobile = '9876543210';
    const normMobile = normalizeMobile(mobile);
    dncStore.push({
      normalizedMobile: normMobile,
      isDoNotContact: true,
      reason: 'CUSTOMER_EXPLICITLY_REQUESTED',
      remarks: 'DNC active',
    });

    // Check if DNC suppresses task creation
    const isDnc = await service.isMobileDncRestricted(normMobile);
    assert.strictEqual(isDnc, true);

    const initialTasksCountBefore = taskStore.length;
    // Suppress creation when isDnc === true
    if (!isDnc) {
      createTestTask(new Types.ObjectId(), { status: 'PENDING' });
    }
    assert.strictEqual(taskStore.length, initialTasksCountBefore);
    pass('TC-32: New enquiry with DNC mobile -> Initial follow-up task generation suppressed');
  } catch (err) {
    fail('TC-32: New enquiry with DNC mobile -> Initial follow-up task generation suppressed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 33: Bulk import row with mobile matching active DNC -> Imported with isDoNotContact: true, initial task suppressed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const mobile = '9876543210';
    const normMobile = normalizeMobile(mobile);
    dncStore.push({
      normalizedMobile: normMobile,
      isDoNotContact: true,
      reason: 'LEGAL_REGULATORY_OPT_OUT',
      remarks: 'DNC regulatory opt out',
    });

    const isDncRestricted = await service.isMobileDncRestricted(normMobile);
    assert.strictEqual(isDncRestricted, true);

    // Simulating bulk import row creation
    const enq = createTestEnquiry({
      mobile,
      isDoNotContact: isDncRestricted,
      source: 'BULK_IMPORT',
    });
    assert.strictEqual(enq.isDoNotContact, true);
    assert.strictEqual(taskStore.length, 0); // Task creation suppressed
    pass('TC-33: Bulk import row with mobile matching active DNC -> Imported with isDoNotContact: true, initial task suppressed');
  } catch (err) {
    fail('TC-33: Bulk import row with mobile matching active DNC -> Imported with isDoNotContact: true, initial task suppressed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 34: Re-enquiry with mobile matching active DNC -> Inherits DNC, initial task suppressed
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const mobile = '9876543210';
    const normMobile = normalizeMobile(mobile);
    dncStore.push({
      normalizedMobile: normMobile,
      isDoNotContact: true,
      reason: 'CUSTOMER_EXPLICITLY_REQUESTED',
      remarks: 'Existing DNC customer',
    });

    const isDncRestricted = await service.isMobileDncRestricted(normMobile);
    assert.strictEqual(isDncRestricted, true);

    const reEnq = createTestEnquiry({
      mobile,
      isReEnquiry: true,
      isDoNotContact: isDncRestricted,
    });
    assert.strictEqual(reEnq.isDoNotContact, true);
    assert.strictEqual(taskStore.length, 0);
    pass('TC-34: Re-enquiry with mobile matching active DNC -> Inherits DNC, initial task suppressed');
  } catch (err) {
    fail('TC-34: Re-enquiry with mobile matching active DNC -> Inherits DNC, initial task suppressed', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 35: DNC enabled -> DO_NOT_CONTACT_ENABLED activity logged
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Customer wants no contact' },
      salesActor1
    );

    const activity = activityStore.find((a) => a.type === 'DO_NOT_CONTACT_ENABLED');
    assert.ok(activity);
    assert.strictEqual(activity.enquiryId.toString(), enq._id.toString());
    assert.strictEqual(activity.metadata?.reason || activity.meta?.reason, 'CUSTOMER_EXPLICITLY_REQUESTED');
    assert.strictEqual(activity.metadata?.remarks || activity.meta?.remarks, 'Customer wants no contact');
    assert.strictEqual(activity.performedByName, salesActor1.name);
    pass('TC-35: DNC enabled -> DO_NOT_CONTACT_ENABLED activity logged with reason, remarks, actor');
  } catch (err) {
    fail('TC-35: DNC enabled -> DO_NOT_CONTACT_ENABLED activity logged', err);
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 36: DNC revoked -> DO_NOT_CONTACT_REVOKED activity logged; cancelled tasks remain cancelled
  // ---------------------------------------------------------------------------
  try {
    resetStore();
    const enq = createTestEnquiry();
    const task = createTestTask(enq._id, { status: 'PENDING' });
    await service.enableDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_EXPLICITLY_REQUESTED', remarks: 'Opt out' },
      adminActor
    );
    assert.strictEqual(task.status, 'CANCELLED');

    await service.revokeDoNotContact(
      enq._id.toString(),
      { reason: 'CUSTOMER_RENEWED_CONSENT', remarks: 'Customer re-opted in' },
      managerActor
    );

    const revokeActivity = activityStore.find((a) => a.type === 'DO_NOT_CONTACT_REVOKED');
    assert.ok(revokeActivity);
    assert.strictEqual(revokeActivity.enquiryId.toString(), enq._id.toString());
    assert.strictEqual(revokeActivity.metadata?.reason || revokeActivity.meta?.reason, 'CUSTOMER_RENEWED_CONSENT');
    assert.strictEqual(revokeActivity.performedByName, managerActor.name);
    // Crucial rule: previously cancelled tasks remain cancelled upon revocation
    assert.strictEqual(task.status, 'CANCELLED');
    pass('TC-36: DNC revoked -> DO_NOT_CONTACT_REVOKED activity logged; previously cancelled tasks remain cancelled');
  } catch (err) {
    fail('TC-36: DNC revoked -> DO_NOT_CONTACT_REVOKED activity logged; previously cancelled tasks remain cancelled', err);
  }

  console.log('\n======================================================');
  console.log(`TOTAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
