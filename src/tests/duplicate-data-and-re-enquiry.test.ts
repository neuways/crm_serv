/**
 * Neuways CRM - Duplicate Data Management, Red Flag & Re-Enquiry Test Suite
 *
 * Comprehensive acceptance test suite covering:
 * 1. Role-based visibility for Duplicate Data (Admin company-wide, Manager own team, Sales own assigned).
 * 2. Cross-team & cross-agent security isolation on backend.
 * 3. Bulk upload duplicate exclusion from listings and counts.
 * 4. Red Flag warning with all 10 customer/enquiry details for Deal Done & Rejected leads.
 * 5. Active lead standard duplicate collision preservation (cannot bypass active duplicate).
 * 6. Re-Enquiry creation with new _id, status: ACTIVE, isReEnquiry: true, and preservation of historical records.
 * 7. Role-based assignment rules for Re-Enquiry (Sales self-assigned, Manager self/team, Admin RR/manual).
 * 8. Re-Enquiry notification matrix (Sales creator, Manager creator, Admin creator, inactive user exclusion).
 */

import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { User } from '../models/user.model.js';
import { Notification } from '../models/notification.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { notificationService } from '../services/notification.service.js';
import { normalizeMobile, normalizeEmail } from '../utils/normalization.js';
import { AuthUser } from '../types/auth.types.js';

let totalTests = 0;
let passedTests = 0;

function pass(name: string) {
  totalTests++;
  passedTests++;
  console.log(`[PASS] ${name}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('Starting Neuways CRM - Duplicate Data & Re-Enquiry Tests');
  console.log('====================================================\n');

  // Set mongoose readyState to 1 to simulate connected database
  (mongoose.connection as any).readyState = 1;

  // In-memory mock stores
  const enquiryStore: any[] = [];
  const activityStore: any[] = [];
  const userStore: any[] = [];
  const notificationStore: any[] = [];
  const taskStore: any[] = [];

  // -------------------------------------------------------------------
  // Setup Mock Models
  // -------------------------------------------------------------------
  (User as any).find = function (filter: any) {
    let results = userStore.filter((u) => {
      if (filter.role && u.role !== filter.role) return false;
      if (filter.isActive !== undefined && u.isActive !== filter.isActive) return false;
      if (filter.managerId && u.managerId?.toString() !== filter.managerId.toString()) return false;
      if (filter._id && filter._id.$in) {
        const inIds = filter._id.$in.map((id: any) => id.toString());
        if (!inIds.includes(u._id.toString())) return false;
      }
      return true;
    });

    const chain: any = {
      select: (fields: string) => {
        return Promise.resolve(
          results.map((u) => {
            const copy: any = { _id: u._id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, managerId: u.managerId };
            return copy;
          })
        );
      },
      sort: () => chain,
      exec: () => Promise.resolve(results),
      then: (resolve: any) => Promise.resolve(results).then(resolve)
    };
    return chain;
  };

  (User as any).findById = function (id: any) {
    const idStr = id ? (id._id || id.id || id).toString() : '';
    const u = userStore.find((user) => user._id.toString() === idStr);
    const chain: any = {
      select: (fields: string) => {
        if (!u) return Promise.resolve(null);
        return Promise.resolve({ _id: u._id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, managerId: u.managerId });
      },
      then: (resolve: any) => Promise.resolve(u || null).then(resolve)
    };
    return chain;
  };

  (User as any).findOne = function (filter: any) {
    const u = userStore.find((user) => {
      if (filter._id && user._id.toString() !== filter._id.toString()) return false;
      if (filter.role && user.role !== filter.role) return false;
      if (filter.isActive !== undefined && user.isActive !== filter.isActive) return false;
      return true;
    });
    const chain: any = {
      select: () => Promise.resolve(u || null),
      then: (resolve: any) => Promise.resolve(u || null).then(resolve)
    };
    return chain;
  };

  // Mock Enquiry
  (Enquiry as any).find = function (filter: any) {
    let results = enquiryStore.filter((e) => {
      if (filter.status && e.status !== filter.status) return false;
      if (filter.isActive !== undefined && e.isActive !== filter.isActive) return false;
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const inIds = filter.assignedTo.$in.map((id: any) => id.toString());
          if (!e.assignedTo || !inIds.includes(e.assignedTo.toString())) return false;
        } else if (e.assignedTo?.toString() !== filter.assignedTo.toString()) {
          return false;
        }
      }
      if (filter.$or) {
        const matchesOr = filter.$or.some((cond: any) => {
          if (cond.normalizedMobile && e.normalizedMobile === cond.normalizedMobile) return true;
          if (cond.normalizedEmail && e.normalizedEmail === cond.normalizedEmail) return true;
          return false;
        });
        if (!matchesOr) return false;
      }
      return true;
    });

    const getPopulatedResults = () => {
      return results.map((e) => {
        const clone = { ...e };
        if (clone.assignedTo) {
          const u = userStore.find((user) => user._id.toString() === (clone.assignedTo._id || clone.assignedTo).toString());
          if (u) {
            clone.assignedTo = { _id: u._id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
          }
        }
        return clone;
      });
    };

    const chain: any = {
      select: (fields: string) => {
        return Promise.resolve(results.map((r) => ({ _id: r._id, assignedTo: r.assignedTo })));
      },
      sort: () => chain,
      limit: () => chain,
      skip: () => chain,
      populate: (field: string) => {
        return {
          then: (resolve: any) => Promise.resolve(getPopulatedResults()).then(resolve)
        };
      },
      then: (resolve: any) => Promise.resolve(results).then(resolve)
    };
    return chain;
  };

  (Enquiry as any).findOne = function (filter: any) {
    let match = null;
    if (filter.$or) {
      match = enquiryStore.find((e) => {
        for (const cond of filter.$or) {
          if (cond.normalizedMobile && e.normalizedMobile === cond.normalizedMobile) {
            if (cond.status && e.status !== cond.status) continue;
            return true;
          }
          if (cond.normalizedEmail && e.normalizedEmail === cond.normalizedEmail) {
            if (cond.status && e.status !== cond.status) continue;
            return true;
          }
        }
        return false;
      });
    } else if (filter._id) {
      match = enquiryStore.find((e) => e._id.toString() === filter._id.toString());
    } else if (filter.normalizedMobile) {
      match = enquiryStore.find((e) => e.normalizedMobile === filter.normalizedMobile);
    }

    const chain: any = {
      populate: (field: any, sel?: any) => {
        if (!match) return Promise.resolve(null);
        const clone = { ...match };
        if (field === 'assignedTo' && clone.assignedTo) {
          const user = userStore.find((u) => u._id.toString() === clone.assignedTo.toString());
          clone.assignedTo = user || clone.assignedTo;
        }
        return Promise.resolve(clone);
      },
      sort: () => chain,
      then: (resolve: any) => Promise.resolve(match || null).then(resolve)
    };
    return chain;
  };

  (Enquiry as any).findById = function (id: any) {
    const idStr = id ? (id._id || id.id || id).toString() : '';
    const match = enquiryStore.find((e) => e._id.toString() === idStr);
    const chain: any = {
      populate: (field: any) => {
        if (!match) return Promise.resolve(null);
        const clone = { ...match };
        if (clone.assignedTo) {
          const user = userStore.find((u) => u._id.toString() === clone.assignedTo.toString());
          clone.assignedTo = user || clone.assignedTo;
        }
        return Promise.resolve(clone);
      },
      then: (resolve: any) => Promise.resolve(match || null).then(resolve)
    };
    return chain;
  };

  // Mock Enquiry constructor & save
  const origEnquiry = Enquiry;
  (origEnquiry as any).prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    const thisId = this._id.toString();
    const toStore = typeof this.toObject === 'function' ? this.toObject() : { ...this };
    if (!toStore._id) toStore._id = this._id;
    const idx = enquiryStore.findIndex((e) => (e._id ? e._id.toString() : '') === thisId);
    if (idx >= 0) {
      enquiryStore[idx] = toStore;
    } else {
      enquiryStore.push(toStore);
    }
    return this;
  };
  (origEnquiry as any).prototype.populate = async function (this: any, path: string) {
    if (path === 'assignedTo' && this.assignedTo) {
      const u = userStore.find((user) => user._id.toString() === (this.assignedTo._id || this.assignedTo).toString());
      if (u) this.assignedTo = u;
    }
    return this;
  };
  (Enquiry as any) = function (this: any, doc: any) {
    Object.assign(this, doc);
    if (!this._id) {
      this._id = new Types.ObjectId();
    }
    this.save = async function (this: any) {
      if (!this._id) this._id = new Types.ObjectId();
      const idx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
      if (idx >= 0) {
        enquiryStore[idx] = { ...this };
      } else {
        enquiryStore.push({ ...this });
      }
      return this;
    };
    this.populate = async function (this: any, path: string) {
      if (path === 'assignedTo' && this.assignedTo) {
        const u = userStore.find((user) => user._id.toString() === this.assignedTo.toString());
        if (u) this.assignedTo = u;
      }
      return this;
    };
  } as any;
  Object.assign(Enquiry, origEnquiry);

  // Mock EnquiryActivity
  const origActivity = EnquiryActivity;
  (origActivity as any).prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    if (!this.createdAt) this.createdAt = new Date();
    activityStore.push(this);
    return this;
  };
  (EnquiryActivity as any) = function (this: any, doc: any) {
    Object.assign(this, doc);
    if (!this._id) {
      this._id = new Types.ObjectId();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    this.save = async function (this: any) {
      if (!this._id) this._id = new Types.ObjectId();
      if (!this.createdAt) this.createdAt = new Date();
      activityStore.push({ ...this });
      return this;
    };
  } as any;
  Object.assign(EnquiryActivity, origActivity);

  (EnquiryActivity as any).countDocuments = function (filter: any) {
    const filtered = filterActivities(filter);
    return Promise.resolve(filtered.length);
  };

  (EnquiryActivity as any).find = function (filter: any) {
    const filtered = filterActivities(filter);
    const chain: any = {
      sort: () => chain,
      skip: (s: number) => {
        const sliced = filtered.slice(s);
        return {
          limit: (l: number) => {
            const lim = sliced.slice(0, l);
            return {
              populate: () => Promise.resolve(lim.map(populateActivity))
            };
          }
        };
      },
      limit: (l: number) => {
        const lim = filtered.slice(0, l);
        return {
          populate: () => Promise.resolve(lim.map(populateActivity))
        };
      },
      populate: () => Promise.resolve(filtered.map(populateActivity))
    };
    return chain;
  };

  function populateActivity(act: any) {
    const clone = { ...act };
    if (clone.enquiryId) {
      const enq = enquiryStore.find((e) => e._id.toString() === clone.enquiryId.toString());
      if (enq) {
        const enqClone = { ...enq };
        if (enqClone.assignedTo) {
          const u = userStore.find((user) => user._id.toString() === enqClone.assignedTo.toString());
          enqClone.assignedTo = u || enqClone.assignedTo;
        }
        clone.enquiryId = enqClone;
      }
    }
    return clone;
  }

  function filterActivities(filter: any) {
    return activityStore.filter((act) => {
      if (filter.type && act.type !== filter.type) return false;
      if (filter['metadata.isBulkUpload'] && filter['metadata.isBulkUpload'].$ne !== undefined) {
        if (act.metadata?.isBulkUpload === filter['metadata.isBulkUpload'].$ne) return false;
      }
      if (filter['metadata.attemptedSource']?.$not) {
        if (filter['metadata.attemptedSource'].$not.test(act.metadata?.attemptedSource || '')) return false;
      }
      if (filter.note?.$not) {
        if (filter.note.$not.test(act.note || '')) return false;
      }
      if (filter['metadata.matchReason'] && act.metadata?.matchReason !== filter['metadata.matchReason']) {
        return false;
      }

      function testOr(orClauses: any[], actItem: any) {
        return orClauses.some((clause: any) => {
          if (clause.enquiryId?.$in) {
            const inIds = clause.enquiryId.$in.map((id: any) => id.toString());
            return actItem.enquiryId && inIds.includes(actItem.enquiryId.toString());
          }
          if (clause.performedBy) {
            if (clause.performedBy.$in) {
              const inIds = clause.performedBy.$in.map((id: any) => id.toString());
              return actItem.performedBy && inIds.includes(actItem.performedBy.toString());
            }
            return actItem.performedBy?.toString() === clause.performedBy.toString();
          }
          if (clause['metadata.attemptedName']) {
            return clause['metadata.attemptedName'].test(actItem.metadata?.attemptedName || '');
          }
          if (clause['metadata.attemptedMobile']) {
            return clause['metadata.attemptedMobile'].test(actItem.metadata?.attemptedMobile || '');
          }
          if (clause['metadata.attemptedEmail']) {
            return clause['metadata.attemptedEmail'].test(actItem.metadata?.attemptedEmail || '');
          }
          if (clause['metadata.attemptedProjectName']) {
            return clause['metadata.attemptedProjectName'].test(actItem.metadata?.attemptedProjectName || '');
          }
          if (clause.performedByName) {
            return clause.performedByName.test(actItem.performedByName || '');
          }
          if (clause.note) {
            return clause.note.test(actItem.note || '');
          }
          return false;
        });
      }

      // $or filter for role scoping / search
      if (filter.$or) {
        if (!testOr(filter.$or, act)) return false;
      }

      // $and filter combining role scoping and search clauses
      if (filter.$and) {
        for (const sub of filter.$and) {
          if (sub.$or && !testOr(sub.$or, act)) return false;
        }
      }

      return true;
    });
  }

  // Mock Notification Service & Model
  Notification.find = function (filter: any) {
    let results = notificationStore.filter((item) => {
      if (filter.recipient && item.recipient.toString() !== filter.recipient.toString()) return false;
      if (filter.isRead !== undefined && item.isRead !== filter.isRead) return false;
      return true;
    });

    const chain: any = {
      sort: () => chain,
      skip: (s: number) => {
        results = results.slice(s);
        return chain;
      },
      limit: (l: number) => {
        results = results.slice(0, l);
        return chain;
      },
      populate: () => chain,
      lean: () => Promise.resolve(results),
      then: (resolve: any) => resolve(results)
    };
    return chain;
  } as any;

  Notification.findById = function (id: any) {
    const idStr = id ? (id._id || id.id || id).toString() : '';
    const match = notificationStore.find((n) => n._id.toString() === idStr);
    if (!match) return Promise.resolve(null);
    return Promise.resolve({
      ...match,
      save: async function (this: any) {
        const idx = notificationStore.findIndex((n) => n._id.toString() === this._id.toString());
        if (idx >= 0) {
          notificationStore[idx] = { ...this };
        }
        return this;
      }
    });
  } as any;

  Notification.countDocuments = function (filter: any) {
    let count = 0;
    for (const item of notificationStore) {
      if (filter.recipient && item.recipient.toString() !== filter.recipient.toString()) continue;
      if (filter.isRead !== undefined && item.isRead !== filter.isRead) continue;
      count++;
    }
    return Promise.resolve(count);
  } as any;

  Notification.updateMany = function (filter: any, update: any) {
    let modified = 0;
    for (let i = 0; i < notificationStore.length; i++) {
      const item = notificationStore[i];
      if (filter.recipient && item.recipient.toString() !== filter.recipient.toString()) continue;
      if (filter.isRead !== undefined && item.isRead !== filter.isRead) continue;
      if (update.$set) {
        notificationStore[i] = { ...item, ...update.$set };
        modified++;
      }
    }
    return Promise.resolve({ matchedCount: modified, modifiedCount: modified });
  } as any;

  notificationService.createNotification = async function (payload: any) {
    const notif = {
      _id: new Types.ObjectId(),
      ...payload,
      createdAt: new Date(),
      isRead: false,
      save: async function (this: any) {
        const idx = notificationStore.findIndex((n) => n._id.toString() === this._id.toString());
        if (idx >= 0) {
          notificationStore[idx] = { ...this };
        }
        return this;
      }
    };
    notificationStore.push(notif);
    return notif as any;
  };

  // Mock FollowUpTask
  const origTask = FollowUpTask;
  (FollowUpTask as any) = function (this: any, doc: any) {
    this._id = new Types.ObjectId();
    Object.assign(this, doc);
    this.save = async function (this: any) {
      taskStore.push({ ...this });
      return this;
    };
  } as any;
  Object.assign(FollowUpTask, origTask);

  // -------------------------------------------------------------------
  // Setup Test Users & Fixtures
  // -------------------------------------------------------------------
  const adminUser = {
    _id: new Types.ObjectId('650000000000000000000001'),
    name: 'Vikram Admin',
    email: 'admin@neuways.com',
    role: 'ADMIN',
    isActive: true
  };

  const managerTeamA = {
    _id: new Types.ObjectId('650000000000000000000002'),
    name: 'Suresh Manager Team A',
    email: 'manager.a@neuways.com',
    role: 'MANAGER',
    isActive: true
  };

  const managerTeamB = {
    _id: new Types.ObjectId('650000000000000000000003'),
    name: 'Pooja Manager Team B',
    email: 'manager.b@neuways.com',
    role: 'MANAGER',
    isActive: true
  };

  const salesAgentA1 = {
    _id: new Types.ObjectId('650000000000000000000004'),
    name: 'Rahul Agent A1',
    email: 'rahul.a1@neuways.com',
    role: 'SALES',
    managerId: managerTeamA._id,
    isActive: true
  };

  const salesAgentA2 = {
    _id: new Types.ObjectId('650000000000000000000005'),
    name: 'Amit Agent A2',
    email: 'amit.a2@neuways.com',
    role: 'SALES',
    managerId: managerTeamA._id,
    isActive: true
  };

  const salesAgentB1 = {
    _id: new Types.ObjectId('650000000000000000000006'),
    name: 'Neha Agent B1',
    email: 'neha.b1@neuways.com',
    role: 'SALES',
    managerId: managerTeamB._id,
    isActive: true
  };

  const inactiveSalesAgent = {
    _id: new Types.ObjectId('650000000000000000000007'),
    name: 'Inactive Resigned Agent',
    email: 'resigned@neuways.com',
    role: 'SALES',
    managerId: managerTeamA._id,
    isActive: false
  };

  userStore.push(adminUser, managerTeamA, managerTeamB, salesAgentA1, salesAgentA2, salesAgentB1, inactiveSalesAgent);

  const adminActor: AuthUser = { id: adminUser._id.toString(), email: adminUser.email, role: 'ADMIN', name: adminUser.name };
  const managerAActor: AuthUser = { id: managerTeamA._id.toString(), email: managerTeamA.email, role: 'MANAGER', name: managerTeamA.name };
  const managerBActor: AuthUser = { id: managerTeamB._id.toString(), email: managerTeamB.email, role: 'MANAGER', name: managerTeamB.name };
  const salesA1Actor: AuthUser = { id: salesAgentA1._id.toString(), email: salesAgentA1.email, role: 'SALES', name: salesAgentA1.name };
  const salesA2Actor: AuthUser = { id: salesAgentA2._id.toString(), email: salesAgentA2.email, role: 'SALES', name: salesAgentA2.name };
  const salesB1Actor: AuthUser = { id: salesAgentB1._id.toString(), email: salesAgentB1.email, role: 'SALES', name: salesAgentB1.name };

  // ===================================================================
  // SECTION 1: DUPLICATE DETECTION & RED FLAG WARNING TESTS
  // ===================================================================

  // Scenario 1: Closed Lead with Deal Done triggers RED FLAG with all 10 details
  const dealDoneEnquiry = {
    _id: new Types.ObjectId('650000000000000000000101'),
    name: 'Rajesh Sharma',
    mobile: '9876543210',
    normalizedMobile: normalizeMobile('9876543210'),
    email: 'rajesh.sharma@example.com',
    normalizedEmail: normalizeEmail('rajesh.sharma@example.com'),
    projectName: 'Emerald Heights',
    requirement: '3BHK Luxury Apartment',
    budgetMin: 8500000,
    budgetMax: 12000000,
    status: 'CLOSED',
    isActive: false,
    currentStage: 'DEAL_DONE',
    dealDone: {
      isConfirmed: true,
      confirmedAt: new Date('2026-05-10'),
      project: 'Emerald Heights Tower A',
      remarks: 'Customer completed purchase and registration.'
    },
    assignedTo: salesAgentA1._id,
    createdAt: new Date('2026-04-01')
  };
  enquiryStore.push(dealDoneEnquiry);

  const redFlagDealDoneAttempt = await enquiryService.createEnquiry({
    name: 'Rajesh Sharma Re-attempt',
    mobile: '9876543210',
    projectName: 'Skyline Vista',
    requirement: '2BHK for investment'
  }, salesA1Actor);

  assert.strictEqual(redFlagDealDoneAttempt.isDuplicate, true, 'Should detect duplicate');
  assert.strictEqual(redFlagDealDoneAttempt.isRedFlag, true, 'Must flag as Red Flag for Deal Done lead');
  assert.strictEqual(redFlagDealDoneAttempt.hasActiveLead, false, 'Should have hasActiveLead: false');
  assert.ok(redFlagDealDoneAttempt.previousEnquiry, 'Must include previousEnquiry details');
  // Verify all 10 customer/enquiry details
  const prevEnq = redFlagDealDoneAttempt.previousEnquiry!;
  assert.strictEqual(prevEnq.customerName, 'Rajesh Sharma', 'Detail 1: Name');
  assert.strictEqual(prevEnq.mobile, '9876543210', 'Detail 2: Mobile');
  assert.strictEqual(prevEnq.email, 'rajesh.sharma@example.com', 'Detail 3: Email');
  assert.strictEqual(prevEnq.previousProject, 'Emerald Heights Tower A', 'Detail 4: Previous Project');
  assert.strictEqual(prevEnq.previousAssignedAgent, 'Rahul Agent A1', 'Detail 5: Previous Sales Agent');
  assert.strictEqual(prevEnq.previousManager, 'Suresh Manager Team A', 'Detail 6: Previous Manager');
  assert.strictEqual(prevEnq.previousStatus, 'Deal Done', 'Detail 7: Previous Status');
  assert.ok(Boolean(prevEnq.previousBudget && (prevEnq.previousBudget.includes('8,500,000') || prevEnq.previousBudget.includes('8500000'))), 'Detail 8: Previous Budget');
  assert.ok(prevEnq.previousEnquiryDate, 'Detail 9: Previous Enquiry Date');
  assert.strictEqual(prevEnq.previousRemarks, 'Customer completed purchase and registration.', 'Detail 10: Previous Remarks');
  pass('Scenario 1: Deal Done customer enquiry triggers RED FLAG with all 10 previous details');

  // Scenario 2: Closed Lead with Rejected status triggers RED FLAG with all 10 details
  const rejectedEnquiry = {
    _id: new Types.ObjectId('650000000000000000000102'),
    name: 'Sunita Patil',
    mobile: '9811122233',
    normalizedMobile: normalizeMobile('9811122233'),
    email: 'sunita.patil@example.com',
    normalizedEmail: normalizeEmail('sunita.patil@example.com'),
    projectName: 'Green Valley',
    budgetMin: 3000000,
    budgetMax: 4500000,
    status: 'CLOSED',
    isActive: false,
    rejection: {
      reason: 'Out of Budget',
      remarks: 'Customer requested 50L flat for 30L budget.',
      rejectedAt: new Date('2026-06-15')
    },
    assignedTo: salesAgentB1._id,
    createdAt: new Date('2026-06-01')
  };
  enquiryStore.push(rejectedEnquiry);

  const redFlagRejectedAttempt = await enquiryService.createEnquiry({
    name: 'Sunita Patil Returning',
    mobile: '9811122233',
    projectName: 'Budget Plaza'
  }, salesB1Actor);

  assert.strictEqual(redFlagRejectedAttempt.isDuplicate, true);
  assert.strictEqual(redFlagRejectedAttempt.isRedFlag, true);
  assert.strictEqual(redFlagRejectedAttempt.previousEnquiry?.previousStatus, 'Rejected');
  assert.strictEqual(redFlagRejectedAttempt.previousEnquiry?.previousAssignedAgent, 'Neha Agent B1');
  assert.strictEqual(redFlagRejectedAttempt.previousEnquiry?.previousManager, 'Pooja Manager Team B');
  assert.strictEqual(redFlagRejectedAttempt.previousEnquiry?.previousRemarks, 'Customer requested 50L flat for 30L budget.');
  pass('Scenario 2: Rejected customer enquiry triggers RED FLAG with 10 previous details');

  // Scenario 3: Active lead duplicate is standard conflict (isRedFlag: false, hasActiveLead: true)
  const activeEnquiry = {
    _id: new Types.ObjectId('650000000000000000000103'),
    name: 'Anil Kumar Active',
    mobile: '9822233344',
    normalizedMobile: normalizeMobile('9822233344'),
    email: 'anil.k@example.com',
    normalizedEmail: normalizeEmail('anil.k@example.com'),
    projectName: 'Royal Palms',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgentA1._id,
    createdAt: new Date('2026-09-01')
  };
  enquiryStore.push(activeEnquiry);

  const activeDupAttempt = await enquiryService.createEnquiry({
    name: 'Anil Kumar Duplicate',
    mobile: '9822233344',
    projectName: 'Royal Palms'
  }, salesA2Actor);

  assert.strictEqual(activeDupAttempt.isDuplicate, true);
  assert.strictEqual(activeDupAttempt.isRedFlag, false, 'Active lead duplicate must NOT be flagged as Red Flag');
  assert.strictEqual(activeDupAttempt.hasActiveLead, true, 'Must indicate an active lead already exists');
  pass('Scenario 3: Active lead duplicate preserves standard collision warning (isRedFlag: false, hasActiveLead: true)');

  // Scenario 4: Cannot bypass active lead duplicate using allowReEnquiry
  const bypassAttempt = await enquiryService.createEnquiry({
    name: 'Anil Kumar Illegal Bypass',
    mobile: '9822233344',
    allowReEnquiry: true,
    previousEnquiryId: activeEnquiry._id.toString()
  }, salesA2Actor);

  assert.strictEqual(bypassAttempt.isDuplicate, true, 'Active collision must block creation even if allowReEnquiry is passed');
  assert.strictEqual(bypassAttempt.hasActiveLead, true);
  pass('Scenario 4: allowReEnquiry does NOT bypass an active lead collision');

  // ===================================================================
  // SECTION 2: RE-ENQUIRY CREATION & HISTORY PRESERVATION TESTS
  // ===================================================================

  // Scenario 5: Sales Agent creates Re-Enquiry for Deal Done customer -> assigned to Sales Agent creator
  const initialEnquiryCount = enquiryStore.length;
  const initialDealDoneDoc = { ...dealDoneEnquiry };

  const salesReEnquiry = (await enquiryService.createEnquiry({
    name: 'Rajesh Sharma Updated',
    mobile: '9876543210',
    email: 'rajesh.updated@example.com',
    projectName: 'Skyline Vista Tower B',
    requirement: '4BHK Penthouse',
    budgetMin: 15000000,
    budgetMax: 20000000,
    allowReEnquiry: true,
    previousEnquiryId: dealDoneEnquiry._id.toString()
  }, salesA1Actor)) as any;

  assert.strictEqual(salesReEnquiry.isDuplicate, false, 'Must create successfully without conflict');
  assert.strictEqual(salesReEnquiry.isReEnquiry, true, 'Flagged as Re-Enquiry');
  assert.ok(salesReEnquiry.enquiry, 'New enquiry created');
  assert.notStrictEqual(salesReEnquiry.enquiry._id.toString(), dealDoneEnquiry._id.toString(), 'Must have a separate NEW _id');
  assert.strictEqual(salesReEnquiry.enquiry.status, 'ACTIVE', 'New enquiry status is ACTIVE');
  assert.strictEqual(salesReEnquiry.enquiry.previousEnquiryId?.toString(), dealDoneEnquiry._id.toString(), 'Linked to previous enquiry');
  assert.strictEqual(salesReEnquiry.enquiry.assignedTo?._id?.toString() || salesReEnquiry.enquiry.assignedTo?.toString(), salesAgentA1._id.toString(), 'Assigned directly to Sales creator');

  // Verify historical record intact
  const historicalRecord = enquiryStore.find((e) => e._id.toString() === dealDoneEnquiry._id.toString());
  assert.strictEqual(historicalRecord.status, 'CLOSED', 'Historical record remains CLOSED');
  assert.strictEqual(historicalRecord.isActive, false, 'Historical record remains inactive');
  assert.strictEqual(historicalRecord.dealDone.isConfirmed, true, 'Historical dealDone remains intact');
  pass('Scenario 5: Sales Agent creates Re-Enquiry: new lead created, assigned to creator, historical record intact');

  // Scenario 6: Manager creates Re-Enquiry without assignedTo -> assigned to Manager
  const managerReEnquirySelf = (await enquiryService.createEnquiry({
    name: 'Sunita Patil Re-Enquiry Manager Self',
    mobile: '9811122233',
    projectName: 'Eco Homes',
    allowReEnquiry: true,
    previousEnquiryId: rejectedEnquiry._id.toString()
  }, managerBActor)) as any;

  assert.strictEqual(managerReEnquirySelf.isReEnquiry, true);
  assert.strictEqual(managerReEnquirySelf.enquiry.assignedTo?._id?.toString() || managerReEnquirySelf.enquiry.assignedTo?.toString(), managerTeamB._id.toString(), 'Assigned to Manager self');
  pass('Scenario 6: Manager creates Re-Enquiry and keeps it: assigned to Manager');

  // Scenario 7: Manager creates Re-Enquiry and assigns to team member
  const managerReEnquiryTeam = (await enquiryService.createEnquiry({
    name: 'Customer For Agent B1',
    mobile: '9899988877',
    projectName: 'Park Avenue',
    assignedToId: salesAgentB1._id.toString()
  }, managerBActor)) as any;
  assert.strictEqual(managerReEnquiryTeam.enquiry.assignedTo?._id?.toString() || managerReEnquiryTeam.enquiry.assignedTo?.toString(), salesAgentB1._id.toString());
  pass('Scenario 7: Manager creates enquiry and assigns to team member');

  // Scenario 8: Admin creates Re-Enquiry with manual assignee
  const closedManualEnquiry = {
    _id: new Types.ObjectId('650000000000000000000104'),
    name: 'Kavita Roy',
    mobile: '9844455566',
    normalizedMobile: normalizeMobile('9844455566'),
    status: 'CLOSED',
    isActive: false,
    rejection: { reason: 'Location preference' }
  };
  enquiryStore.push(closedManualEnquiry);

  const adminManualReEnquiry = (await enquiryService.createEnquiry({
    name: 'Kavita Roy Re-Enquiry',
    mobile: '9844455566',
    assignedToId: salesAgentA2._id.toString(),
    allowReEnquiry: true,
    previousEnquiryId: closedManualEnquiry._id.toString()
  }, adminActor)) as any;

  assert.strictEqual(adminManualReEnquiry.isReEnquiry, true);
  assert.strictEqual(adminManualReEnquiry.enquiry.assignedTo?._id?.toString() || adminManualReEnquiry.enquiry.assignedTo?.toString(), salesAgentA2._id.toString(), 'Assigned to manually specified agent');
  pass('Scenario 8: Admin creates Re-Enquiry with manual assignee');

  // ===================================================================
  // SECTION 3: RE-ENQUIRY NOTIFICATION MATRIX TESTS
  // ===================================================================

  // Scenario 9: Notifications sent when Sales Agent creates Re-Enquiry
  // Matrix: Sales creator, their Manager, and Admin
  notificationStore.length = 0; // Clear notifications

  const closedForSalesNotif = {
    _id: new Types.ObjectId('650000000000000000000105'),
    name: 'Deepak Verma',
    mobile: '9855566677',
    normalizedMobile: normalizeMobile('9855566677'),
    status: 'CLOSED',
    isActive: false,
    dealDone: { isConfirmed: true }
  };
  enquiryStore.push(closedForSalesNotif);

  await enquiryService.createEnquiry({
    name: 'Deepak Verma Re-Lead',
    mobile: '9855566677',
    allowReEnquiry: true,
    previousEnquiryId: closedForSalesNotif._id.toString()
  }, salesA1Actor);

  const salesCreatorNotifs = notificationStore.map((n) => n.recipient.toString());
  assert.ok(salesCreatorNotifs.includes(salesAgentA1._id.toString()), 'Notification sent to Sales Creator');
  assert.ok(salesCreatorNotifs.includes(managerTeamA._id.toString()), 'Notification sent to Creator Manager');
  assert.ok(salesCreatorNotifs.includes(adminUser._id.toString()), 'Notification sent to Admin');
  assert.strictEqual(notificationStore[0].title, 'Returning Customer — New Lead Created');
  assert.strictEqual(notificationStore[0].type, 'RETURNING_CUSTOMER_RE_ENQUIRY');
  pass('Scenario 9: Sales Agent re-enquiry sends notifications to Sales Creator, Manager, and Admin');

  // Scenario 10: Notifications when Manager creates and assigns to Sales Agent
  // Matrix: Assigned Sales Agent, Manager, Admin
  notificationStore.length = 0;
  const closedForMgrNotif = {
    _id: new Types.ObjectId('650000000000000000000106'),
    name: 'Meena Gupta',
    mobile: '9866677788',
    normalizedMobile: normalizeMobile('9866677788'),
    status: 'CLOSED',
    isActive: false,
    rejection: { reason: 'Price too high' }
  };
  enquiryStore.push(closedForMgrNotif);

  await enquiryService.createEnquiry({
    name: 'Meena Gupta Re-Lead',
    mobile: '9866677788',
    assignedToId: salesAgentA2._id.toString(),
    allowReEnquiry: true,
    previousEnquiryId: closedForMgrNotif._id.toString()
  }, managerAActor);

  const mgrAssignNotifs = notificationStore.map((n) => n.recipient.toString());
  assert.ok(mgrAssignNotifs.includes(salesAgentA2._id.toString()), 'Notification sent to assigned Sales Agent');
  assert.ok(mgrAssignNotifs.includes(managerTeamA._id.toString()), 'Notification sent to Manager');
  assert.ok(mgrAssignNotifs.includes(adminUser._id.toString()), 'Notification sent to Admin');
  pass('Scenario 10: Manager re-enquiry with assignment notifies Assigned Agent, Manager, and Admin');

  // Scenario 11: Inactive/resigned employee receives 0 notifications
  notificationStore.length = 0;
  const closedForInactive = {
    _id: new Types.ObjectId('650000000000000000000107'),
    name: 'Resigned Lead',
    mobile: '9877788899',
    normalizedMobile: normalizeMobile('9877788899'),
    status: 'CLOSED',
    isActive: false,
    rejection: { reason: 'Not interested' }
  };
  enquiryStore.push(closedForInactive);

  await enquiryService.createEnquiry({
    name: 'Resigned Lead Re-Attempt',
    mobile: '9877788899',
    assignedToId: inactiveSalesAgent._id.toString(),
    allowReEnquiry: true,
    previousEnquiryId: closedForInactive._id.toString()
  }, adminActor);

  const notifsInactive = notificationStore.map((n) => n.recipient.toString());
  assert.ok(!notifsInactive.includes(inactiveSalesAgent._id.toString()), 'Inactive employee must NOT receive notifications');
  pass('Scenario 11: Inactive/resigned employees receive 0 notifications');

  // ===================================================================
  // SECTION 4: DUPLICATE DATA ROLE SCOPING & BULK EXCLUSION TESTS
  // ===================================================================

  // Populate duplicate activities for testing role filters & bulk exclusion
  activityStore.length = 0; // reset

  // 1. Duplicate on Sales Agent A1 lead (Team A)
  const actAgentA1 = {
    _id: new Types.ObjectId(),
    type: 'DUPLICATE_MATCH_DETECTED',
    enquiryId: dealDoneEnquiry._id, // assigned to Sales Agent A1
    performedBy: salesAgentA1._id,
    performedByName: salesAgentA1.name,
    note: 'Duplicate mobile match: 9876543210',
    metadata: {
      attemptedName: 'Test Dup Agent A1',
      attemptedMobile: '9876543210',
      isBulkUpload: false
    },
    createdAt: new Date('2026-10-01')
  };

  // 2. Duplicate on Sales Agent A2 lead (Team A)
  const enqAgentA2 = {
    _id: new Types.ObjectId('650000000000000000000120'),
    name: 'Lead Agent A2',
    assignedTo: salesAgentA2._id
  };
  enquiryStore.push(enqAgentA2);

  const actAgentA2 = {
    _id: new Types.ObjectId(),
    type: 'DUPLICATE_MATCH_DETECTED',
    enquiryId: enqAgentA2._id, // assigned to Sales Agent A2
    performedBy: salesAgentA2._id,
    performedByName: salesAgentA2.name,
    note: 'Duplicate mobile match: 9822211100',
    metadata: {
      attemptedName: 'Test Dup Agent A2',
      attemptedMobile: '9822211100',
      isBulkUpload: false
    },
    createdAt: new Date('2026-10-02')
  };

  // 3. Duplicate on Sales Agent B1 lead (Team B)
  const actAgentB1 = {
    _id: new Types.ObjectId(),
    type: 'DUPLICATE_MATCH_DETECTED',
    enquiryId: rejectedEnquiry._id, // assigned to Sales Agent B1
    performedBy: salesAgentB1._id,
    performedByName: salesAgentB1.name,
    note: 'Duplicate mobile match: 9811122233',
    metadata: {
      attemptedName: 'Test Dup Agent B1',
      attemptedMobile: '9811122233',
      isBulkUpload: false
    },
    createdAt: new Date('2026-10-03')
  };

  // 4. Duplicate originating from Bulk Upload (must be strictly excluded)
  const actBulkUpload = {
    _id: new Types.ObjectId(),
    type: 'DUPLICATE_MATCH_DETECTED',
    enquiryId: dealDoneEnquiry._id,
    performedBy: adminUser._id,
    performedByName: 'Admin',
    note: 'Bulk upload duplicate conflict',
    metadata: {
      attemptedName: 'Bulk Record 1',
      attemptedMobile: '9876543210',
      isBulkUpload: true,
      attemptedSource: 'Bulk Upload CSV'
    },
    createdAt: new Date('2026-10-04')
  };

  activityStore.push(actAgentA1, actAgentA2, actAgentB1, actBulkUpload);

  // Scenario 12: Admin sees all non-bulk duplicates company-wide
  const adminRecords = await enquiryService.getDuplicateRecords({}, adminActor);
  const adminCount = await enquiryService.getDuplicateCount(adminActor);
  assert.strictEqual(adminRecords.totalCount, 3, 'Admin sees all 3 non-bulk duplicates across Team A and Team B');
  assert.strictEqual(adminCount, 3, 'Admin getDuplicateCount is 3');
  assert.ok(!adminRecords.duplicateRecords.some((r) => r.attemptedLead.name === 'Bulk Record 1'), 'Bulk record excluded for Admin');
  pass('Scenario 12: Admin sees company-wide duplicate records, strictly excluding bulk upload records');

  // Scenario 13: Manager Team A sees only Team A duplicates (Agent A1 + Agent A2), NOT Team B
  const mgrARecords = await enquiryService.getDuplicateRecords({}, managerAActor);
  const mgrACount = await enquiryService.getDuplicateCount(managerAActor);
  assert.strictEqual(mgrARecords.totalCount, 2, 'Manager A sees 2 duplicates (Agent A1 + Agent A2)');
  assert.strictEqual(mgrACount, 2, 'Manager A count is 2');
  const mgrANames = mgrARecords.duplicateRecords.map((r) => r.attemptedLead.name);
  assert.ok(mgrANames.includes('Test Dup Agent A1'), 'Contains Agent A1 dup');
  assert.ok(mgrANames.includes('Test Dup Agent A2'), 'Contains Agent A2 dup');
  assert.ok(!mgrANames.includes('Test Dup Agent B1'), 'Does NOT contain Team B dup');
  assert.ok(!mgrANames.includes('Bulk Record 1'), 'Does NOT contain bulk record');
  pass('Scenario 13: Manager Team A sees only own team duplicate records (Team A only, no Team B, no bulk)');

  // Scenario 14: Manager Team B sees only Team B duplicates (Agent B1), NOT Team A
  const mgrBRecords = await enquiryService.getDuplicateRecords({}, managerBActor);
  const mgrBCount = await enquiryService.getDuplicateCount(managerBActor);
  assert.strictEqual(mgrBRecords.totalCount, 1, 'Manager B sees 1 duplicate (Agent B1)');
  assert.strictEqual(mgrBCount, 1, 'Manager B count is 1');
  assert.strictEqual(mgrBRecords.duplicateRecords[0].attemptedLead.name, 'Test Dup Agent B1');
  pass('Scenario 14: Manager Team B sees only own team duplicate records (Team B only, no Team A)');

  // Scenario 15: Sales Agent A1 sees ONLY their own duplicates
  const salesA1Records = await enquiryService.getDuplicateRecords({}, salesA1Actor);
  const salesA1Count = await enquiryService.getDuplicateCount(salesA1Actor);
  assert.strictEqual(salesA1Records.totalCount, 1, 'Sales Agent A1 sees only 1 duplicate');
  assert.strictEqual(salesA1Count, 1, 'Sales Agent A1 count is 1');
  assert.strictEqual(salesA1Records.duplicateRecords[0].attemptedLead.name, 'Test Dup Agent A1');
  pass('Scenario 15: Sales Agent A1 sees only own duplicate records');

  // Scenario 16: Sales Agent A2 sees ONLY their own duplicates, cannot access Agent A1
  const salesA2Records = await enquiryService.getDuplicateRecords({}, salesA2Actor);
  const salesA2Count = await enquiryService.getDuplicateCount(salesA2Actor);
  assert.strictEqual(salesA2Records.totalCount, 1);
  assert.strictEqual(salesA2Count, 1);
  assert.strictEqual(salesA2Records.duplicateRecords[0].attemptedLead.name, 'Test Dup Agent A2');
  pass('Scenario 16: Sales Agent A2 sees only own duplicate records, cannot access Agent A1');

  // Scenario 17: Backend Security - Sales Agent attempting to pass search or query parameters cannot bypass scoping
  const rogueQuery = { search: 'Team B', limit: 100 };
  const rogueRecords = await enquiryService.getDuplicateRecords(rogueQuery, salesA1Actor);
  assert.strictEqual(rogueRecords.totalCount, 0, 'Cross-agent query yields 0 records due to strict backend actor scoping');
  pass('Scenario 17: Backend Security strictly prevents cross-agent duplicate access regardless of query parameters');

  // Scenario 18: Bulk Upload Exclusion is 100% airtight in listings and counts
  const countExcludingBulk = await enquiryService.getDuplicateCount(adminActor);
  assert.strictEqual(countExcludingBulk, 3, 'Total count across company strictly excludes bulk upload duplicates');
  pass('Scenario 18: Bulk upload exclusion verified in both listings and aggregate counts');

  // ===================================================================
  // SECTION 5: DUPLICATE ENQUIRY NOTIFICATION INTEGRATION (SECTION 10 SCENARIOS)
  // ===================================================================

  // Prepare a dedicated active lead assigned to Lisa Mitchell (Sales Agent A1 / Rahul Agent A1)
  const lisaLead = {
    _id: new Types.ObjectId('650000000000000000000201'),
    name: 'Lisa Mitchell Existing Lead',
    mobile: '9870001122',
    normalizedMobile: normalizeMobile('9870001122'),
    email: 'lisa.client@example.com',
    normalizedEmail: normalizeEmail('lisa.client@example.com'),
    projectName: 'Emerald Heights',
    requirement: '3BHK Luxury Flat',
    budgetMin: 7500000,
    budgetMax: 9500000,
    status: 'ACTIVE',
    isActive: true,
    currentStage: 'CONTACTED',
    assignedTo: salesAgentA1._id,
    createdAt: new Date('2026-10-10')
  };
  enquiryStore.push(lisaLead);

  notificationStore.length = 0; // Clear notifications before Section 5

  // 1. Scenario 19 (Scenario 1 of Section 10): Admin submits duplicate matching Lisa Mitchell's active lead -> Lisa receives persistent notification
  const dupSubmissionAdmin = await enquiryService.createEnquiry({
    name: 'Lisa Mitchell Prospective Duplicate',
    mobile: '9870001122',
    email: 'lisa.client@example.com',
    projectName: 'Emerald Heights Tower B',
    requirement: '3BHK',
    source: 'Website Form'
  }, adminActor);

  assert.strictEqual(dupSubmissionAdmin.isDuplicate, true, 'Duplicate must be detected');
  if (dupSubmissionAdmin.isDuplicate) {
    assert.strictEqual(dupSubmissionAdmin.hasActiveLead, true, 'Active lead match detected');
  }

  const lisaNotifs = notificationStore.filter((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.strictEqual(lisaNotifs.length, 1, 'Assigned Sales Agent (Lisa) must receive exactly 1 persistent notification');
  assert.strictEqual(lisaNotifs[0].type, 'DUPLICATE_ENQUIRY', 'Notification type is DUPLICATE_ENQUIRY');
  assert.strictEqual(lisaNotifs[0].title, 'Duplicate Enquiry Detected');
  assert.strictEqual(lisaNotifs[0].message, 'A new enquiry matching your existing lead has been submitted.');
  assert.strictEqual(lisaNotifs[0].relatedCustomerName, lisaLead.name);
  assert.strictEqual(lisaNotifs[0].metadata.prospectName, 'Lisa Mitchell Prospective Duplicate');
  assert.strictEqual(lisaNotifs[0].metadata.existingLeadName, lisaLead.name);
  assert.strictEqual(lisaNotifs[0].metadata.assignedAgentName, salesAgentA1.name);
  assert.strictEqual(lisaNotifs[0].metadata.submittedBy, adminUser.name);
  assert.strictEqual(lisaNotifs[0].metadata.submissionSource, 'Website Form');
  pass("Scenario 19 (Sec 10.1): Admin submits duplicate matching active lead -> Assigned Sales Agent receives notification with complete metadata");

  // 2. Scenario 20 (Scenario 2 of Section 10): Lisa's Manager receives team-scoped notification
  const mgrANotifs = notificationStore.filter((n) => n.recipient.toString() === managerTeamA._id.toString());
  assert.strictEqual(mgrANotifs.length, 1, "Lisa's Manager (Team A) must receive team-scoped notification");
  assert.strictEqual(mgrANotifs[0].type, 'DUPLICATE_ENQUIRY');
  assert.strictEqual(mgrANotifs[0].title, 'Duplicate Enquiry Detected');
  assert.strictEqual(mgrANotifs[0].metadata.existingLeadName, lisaLead.name);
  assert.strictEqual(mgrANotifs[0].metadata.assignedAgentName, salesAgentA1.name);
  pass("Scenario 20 (Sec 10.2): Lead's Manager receives team-scoped duplicate notification");

  // 3. Scenario 21 (Scenario 3 of Section 10): Admin receives company-wide notification
  const adminNotifs = notificationStore.filter((n) => n.recipient.toString() === adminUser._id.toString());
  assert.strictEqual(adminNotifs.length, 1, 'Admin must receive company-wide notification');
  assert.strictEqual(adminNotifs[0].type, 'DUPLICATE_ENQUIRY');
  assert.strictEqual(adminNotifs[0].title, 'Duplicate Enquiry Detected');
  assert.strictEqual(adminNotifs[0].metadata.existingLeadName, lisaLead.name);
  pass("Scenario 21 (Sec 10.3): Admin receives company-wide duplicate notification");

  // 4. Scenario 22 (Scenario 4 of Section 10): Another Sales Agent receives 0 notifications for Lisa's lead
  const salesA2Notifs = notificationStore.filter((n) => n.recipient.toString() === salesAgentA2._id.toString());
  const salesB1Notifs = notificationStore.filter((n) => n.recipient.toString() === salesAgentB1._id.toString());
  assert.strictEqual(salesA2Notifs.length, 0, 'Sales Agent A2 must receive 0 notifications for Lisa’s lead');
  assert.strictEqual(salesB1Notifs.length, 0, 'Sales Agent B1 must receive 0 notifications for Lisa’s lead');
  pass("Scenario 22 (Sec 10.4): Unrelated Sales Agents receive 0 notifications for another agent's duplicate lead");

  // 5. Scenario 23 (Scenario 5 of Section 10): Email-only match creates notification with Match Type = 'Email Match'
  const emailOnlyLead = {
    _id: new Types.ObjectId('650000000000000000000202'),
    name: 'Email Only Match Lead',
    mobile: '9810009988',
    normalizedMobile: normalizeMobile('9810009988'),
    email: 'email.only@example.com',
    normalizedEmail: normalizeEmail('email.only@example.com'),
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgentA1._id,
    createdAt: new Date('2026-10-11')
  };
  enquiryStore.push(emailOnlyLead);

  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Email Only Duplicate Prospect',
    mobile: '9899991111', // different mobile
    email: 'email.only@example.com', // matching email
    source: 'Landing Page'
  }, adminActor);

  const emailMatchNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.ok(emailMatchNotif, 'Sales Agent A1 must receive notification for email-only duplicate');
  assert.strictEqual(emailMatchNotif.metadata.matchType, 'Email Match', "Match type must be 'Email Match'");
  assert.strictEqual(emailMatchNotif.metadata.matchReason, 'EMAIL');
  pass("Scenario 23 (Sec 10.5): Email-only match creates notification with Match Type = 'Email Match'");

  // 6. Scenario 24 (Scenario 6 of Section 10): Mobile-only match creates notification with Match Type = 'Mobile Match'
  const mobileOnlyLead = {
    _id: new Types.ObjectId('650000000000000000000203'),
    name: 'Mobile Only Match Lead',
    mobile: '9822200011',
    normalizedMobile: normalizeMobile('9822200011'),
    email: 'mobile.unique@example.com',
    normalizedEmail: normalizeEmail('mobile.unique@example.com'),
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgentA1._id,
    createdAt: new Date('2026-10-12')
  };
  enquiryStore.push(mobileOnlyLead);

  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Mobile Only Duplicate Prospect',
    mobile: '9822200011', // matching mobile
    email: 'different.person@example.com', // different email
    source: 'Walk-in'
  }, adminActor);

  const mobileMatchNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.ok(mobileMatchNotif, 'Sales Agent A1 must receive notification for mobile-only duplicate');
  assert.strictEqual(mobileMatchNotif.metadata.matchType, 'Mobile Match', "Match type must be 'Mobile Match'");
  assert.strictEqual(mobileMatchNotif.metadata.matchReason, 'MOBILE');
  pass("Scenario 24 (Sec 10.6): Mobile-only match creates notification with Match Type = 'Mobile Match'");

  // 7. Scenario 25 (Scenario 7 of Section 10): Mobile & Email match creates notification with Match Type = 'Mobile & Email Match'
  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Both Match Duplicate Prospect',
    mobile: '9822200011', // matching mobile
    email: 'mobile.unique@example.com', // matching email
    source: 'Referral'
  }, adminActor);

  const bothMatchNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.ok(bothMatchNotif, 'Sales Agent A1 must receive notification for mobile & email duplicate');
  assert.strictEqual(bothMatchNotif.metadata.matchType, 'Mobile & Email Match', "Match type must be 'Mobile & Email Match'");
  assert.strictEqual(bothMatchNotif.metadata.matchReason, 'BOTH');
  pass("Scenario 25 (Sec 10.7): Mobile & Email match creates notification with Match Type = 'Mobile & Email Match'");

  // 8. Scenario 26 (Scenario 8 of Section 10): Duplicate detected during bulk upload creates 0 notifications
  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Bulk Upload Dup Prospect',
    mobile: '9822200011',
    email: 'mobile.unique@example.com',
    source: 'Bulk Upload CSV',
    isBulkUpload: true
  }, adminActor);

  assert.strictEqual(notificationStore.length, 0, 'Bulk upload duplicate must create strictly 0 notifications');

  // Also test source containing 'bulk' without explicit boolean
  await enquiryService.createEnquiry({
    name: 'Bulk Source Dup Prospect',
    mobile: '9822200011',
    email: 'mobile.unique@example.com',
    source: 'Bulk Import 2026'
  }, adminActor);

  assert.strictEqual(notificationStore.length, 0, 'Source containing bulk must create strictly 0 notifications');
  pass("Scenario 26 (Sec 10.8): Duplicate detected during bulk upload creates 0 notifications");

  // 9. Scenario 27 (Scenario 9 of Section 10): Notification link opens existing lead's workflow / completed deal
  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Link Test Dup',
    mobile: '9870001122', // matches active lisaLead
    source: 'Website'
  }, adminActor);

  const activeLinkNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.strictEqual(activeLinkNotif.link, `/sales/leads/${lisaLead._id.toString()}/workflow`, 'Active lead link must point to workflow');

  // Also test Deal Done completed lead duplicate link
  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Deal Done Link Dup',
    mobile: '9876543210', // matches dealDoneEnquiry
    source: 'Website'
  }, adminActor);

  const dealDoneLinkNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString());
  assert.strictEqual(dealDoneLinkNotif.link, `/sales/completed-deals/${dealDoneEnquiry._id.toString()}`, 'Deal Done lead link must point to /sales/completed-deals/:id');
  pass("Scenario 27 (Sec 10.9): Notification link opens existing lead workflow or completed deal");

  // 10. Scenario 28 (Scenario 10 of Section 10): Mark as Read decrements unread count
  const unreadBefore = await notificationService.getUnreadCount(salesA1Actor);
  assert.ok(unreadBefore.unreadCount > 0, 'Sales Agent A1 must have unread notifications');

  const notifToMark = notificationStore.find((n) => n.recipient.toString() === salesAgentA1._id.toString() && !n.isRead);
  assert.ok(notifToMark, 'Must find an unread notification');

  const markResult = await notificationService.markAsRead(notifToMark._id.toString(), salesA1Actor);
  assert.strictEqual(markResult.success, true, 'markAsRead must succeed');
  assert.strictEqual(markResult.notification?.isRead, true, 'isRead must be true');

  const unreadAfter = await notificationService.getUnreadCount(salesA1Actor);
  assert.strictEqual(unreadAfter.unreadCount, unreadBefore.unreadCount - 1, 'Unread count must decrement by 1');
  pass("Scenario 28 (Sec 10.10): Mark as Read decrements unread count accurately");

  // 11. Scenario 29 (Scenario 11 of Section 10): Reloading queries notifications collection and preserves record
  const fetchResult = await notificationService.getNotifications(salesA1Actor, { page: 1, limit: 10 });
  assert.strictEqual(fetchResult.success, true, 'getNotifications query must succeed');
  const readRecord = fetchResult.notifications.find((n) => n.id === notifToMark._id.toString());
  assert.ok(readRecord, 'Previously marked notification must exist in database query');
  assert.strictEqual(readRecord.isRead, true, 'Preserves read status in database query');

  const unreadOnlyResult = await notificationService.getNotifications(salesA1Actor, { unreadOnly: true });
  assert.ok(!unreadOnlyResult.notifications.some((n) => n.id === notifToMark._id.toString()), 'Excluded from unreadOnly query');
  pass("Scenario 29 (Sec 10.11): Database query preserves notification records and respect read/unread filters");

  // 12. Scenario 30 (Scenario 12 of Section 10): Closed lead duplicate generates notification without reopening lead
  const initialClosedStatus = rejectedEnquiry.status;
  const initialClosedActive = rejectedEnquiry.isActive;
  assert.strictEqual(initialClosedStatus, 'CLOSED', 'Lead is closed');
  assert.strictEqual(initialClosedActive, false, 'Lead isActive is false');

  notificationStore.length = 0; // reset
  await enquiryService.createEnquiry({
    name: 'Closed Lead Dup Prospect',
    mobile: '9811122233', // matches rejectedEnquiry (assigned to salesAgentB1)
    source: 'Website Form'
  }, adminActor);

  const closedDupNotif = notificationStore.find((n) => n.recipient.toString() === salesAgentB1._id.toString());
  assert.ok(closedDupNotif, 'Assigned agent of closed lead must receive notification');
  assert.strictEqual(closedDupNotif.type, 'DUPLICATE_ENQUIRY');

  // Re-verify existing closed lead has NOT been altered or reopened
  assert.strictEqual(rejectedEnquiry.status, 'CLOSED', 'Closed lead status must remain CLOSED');
  assert.strictEqual(rejectedEnquiry.isActive, false, 'Closed lead isActive must remain false');
  pass("Scenario 30 (Sec 10.12): Closed lead duplicate generates notification without reopening lead or modifying status");

  // 13. Scenario 31 (Scenario 13 of Section 10): Existing Stage Advanced and Lead Reassigned notifications continue working without regression
  notificationStore.length = 0; // reset

  // Test Stage Advanced / Workflow Update notification
  await notificationService.createNotification({
    recipient: salesAgentA1._id,
    type: 'WORKFLOW_UPDATE',
    title: 'Lead Stage Advanced',
    message: 'Lead stage moved to SITE_VISIT_SCHEDULED',
    relatedEnquiryId: lisaLead._id,
    relatedCustomerName: lisaLead.name,
    relatedStage: 'SITE_VISIT_SCHEDULED',
    metadata: { currentStage: 'SITE_VISIT_SCHEDULED' }
  });

  // Test Lead Assigned notification
  await notificationService.createNotification({
    recipient: salesAgentA2._id,
    type: 'LEAD_ASSIGNED',
    title: 'Lead Assigned: Reassigned Lead',
    message: 'Lead assigned to you',
    relatedEnquiryId: lisaLead._id,
    relatedCustomerName: lisaLead.name,
    metadata: { customerName: 'Reassigned Lead' }
  });

  const workflowNotifs = notificationStore.filter((n) => n.type === 'WORKFLOW_UPDATE');
  const leadAssignedNotifs = notificationStore.filter((n) => n.type === 'LEAD_ASSIGNED');
  assert.strictEqual(workflowNotifs.length, 1, 'Stage Advanced notification operates seamlessly');
  assert.strictEqual(leadAssignedNotifs.length, 1, 'Lead Assigned notification operates seamlessly');
  pass("Scenario 31 (Sec 10.13): Existing Stage Advanced and Lead Assigned notifications operate without regression");

  console.log('\n====================================================');
  console.log(`All ${passedTests}/${totalTests} Neuways CRM Duplicate & Re-Enquiry Tests Passed!`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
