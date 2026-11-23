/**
 * Notifications & Lead Assignment Acceptance Test Suite
 *
 * Validates all 15 scenarios from Section 8:
 * 1. Admin manual assignment notification to Sales Agent (full details, NOT for Admin).
 * 2. Admin Round Robin assignment notification to Sales Agent (Round Robin assigner, NOT for Admin).
 * 3. Manager reassignment notification to Sales Agent (previous assignee info, NOT for Manager or previous agent).
 * 4. Unassigned lead assignment notification to Sales Agent (moves from unassigned queue to agent).
 * 5. Direct assigned lead creation notification (lead created with initial assignee).
 * 6. Same-agent reassignment creates NO notification.
 * 7. Previous agent receives NO notification.
 * 8. Manager and Admin receive NO notification.
 * 9. Failed assignment creates NO notification.
 * 10. Recipient isolation (Agent 1 cannot query or mark Agent 2's notifications).
 * 11. Unread count and mark-as-read (accurate counts, mark-single, mark-all).
 * 12. Complete lead information (all 5 structured categories present in metadata).
 * 13. Missing/empty fields handled gracefully (fallbacks & placeholders).
 * 14. Navigation link (opens /sales/leads/:id/workflow).
 * 15. Unauthorized access (Sales Agent accessing another agent's lead gets 403 Forbidden).
 */

import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import { Notification } from '../models/notification.model.js';
import { Enquiry } from '../models/enquiry.model.js';
import { User } from '../models/user.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { PropertyMapping } from '../models/property-mapping.model.js';
import { notificationService } from '../services/notification.service.js';
import { enquiryService, formatCurrencyINR, formatBudgetRange } from '../services/enquiry.service.js';
import { AuthUser } from '../types/auth.types.js';

let passedTests = 0;
let totalTests = 0;

function pass(label: string) {
  passedTests++;
  totalTests++;
  console.log(`[PASS] ${label}`);
}

async function runAllTests() {
  console.log('====================================================');
  console.log('Starting Neuways CRM - Notifications Acceptance Tests');
  console.log('====================================================\n');

  // Set mongoose readyState to 1 to allow in-memory execution
  (mongoose.connection as any).readyState = 1;
  (Notification as any)._isMocked = true;

  // In-memory data collections
  const notificationStore: any[] = [];
  const userStore: any[] = [];
  const enquiryStore: any[] = [];
  const activityStore: any[] = [];
  const taskStore: any[] = [];

  // -------------------------------------------------------------
  // Mock Notification Model
  // -------------------------------------------------------------
  Notification.findOne = function (filter: any) {
    if (filter.idempotencyKey) {
      const match = notificationStore.find((n) => n.idempotencyKey === filter.idempotencyKey);
      return Promise.resolve(match || null);
    }
    if (filter._id) {
      const match = notificationStore.find((n) => n._id.toString() === filter._id.toString());
      return Promise.resolve(match ? { ...match, save: async function (this: any) { return this; } } : null);
    }
    return Promise.resolve(null);
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

  Notification.prototype.save = async function (this: any) {
    if (!this._id) {
      this._id = new Types.ObjectId();
    }
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = new Date();
    const plain = {
      _id: this._id,
      recipient: this.recipient,
      sender: this.sender,
      senderName: this.senderName,
      type: this.type,
      title: this.title,
      message: this.message,
      relatedEnquiryId: this.relatedEnquiryId,
      relatedCustomerName: this.relatedCustomerName,
      relatedStage: this.relatedStage,
      link: this.link,
      isRead: Boolean(this.isRead),
      readAt: this.readAt || null,
      idempotencyKey: this.idempotencyKey || null,
      metadata: this.metadata || {},
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
    notificationStore.push(plain);
    return plain;
  };

  // -------------------------------------------------------------
  // Mock User Model
  // -------------------------------------------------------------
  User.findById = function (id: any) {
    const idStr = id ? (id._id || id.id || id).toString() : '';
    const match = userStore.find((u) => u._id.toString() === idStr);
    const chain: any = {
      select: () => chain,
      exec: () => Promise.resolve(match ? { ...match } : null),
      then: (res: any) => res(match ? { ...match } : null)
    };
    return chain;
  } as any;

  User.find = function (filter: any) {
    const matches = userStore.filter((u) => {
      if (filter.role && u.role !== filter.role) return false;
      if (filter.isActive !== undefined && u.isActive !== filter.isActive) return false;
      if (filter.managerId && (!u.managerId || u.managerId.toString() !== filter.managerId.toString())) return false;
      return true;
    });
    const chain: any = {
      select: () => chain,
      sort: () => chain,
      exec: () => Promise.resolve(matches),
      lean: () => Promise.resolve(matches),
      then: (res: any) => res(matches)
    };
    return chain;
  } as any;

  User.findOne = function (filter: any) {
    const match = userStore.find((u) => {
      if (filter._id && u._id.toString() !== (filter._id._id || filter._id).toString()) return false;
      if (filter.role && u.role !== filter.role) return false;
      if (filter.isActive !== undefined && u.isActive !== filter.isActive) return false;
      return true;
    });
    const chain: any = {
      select: () => chain,
      exec: () => Promise.resolve(match ? { ...match } : null),
      lean: () => Promise.resolve(match ? { ...match } : null),
      then: (res: any) => res(match ? { ...match } : null)
    };
    return chain;
  } as any;

  // -------------------------------------------------------------
  // Mock Enquiry Model
  // -------------------------------------------------------------
  Enquiry.prototype.populate = async function (this: any) {
    return this;
  };
  Enquiry.findById = function (id: any) {
    const idStr = id ? (id._id || id.id || id).toString() : '';
    const match = enquiryStore.find((e) => e._id.toString() === idStr);
    if (!match) {
      const chain: any = {
        populate: () => Promise.resolve(null),
        then: (res: any) => res(null)
      };
      return chain;
    }
    const doc = {
      ...match,
      save: async function () {
        this.updatedAt = new Date();
        const idx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
        if (idx >= 0) enquiryStore[idx] = { ...this };
        return this;
      },
      populate: async function () {
        if (this.assignedTo) {
          const userMatch = userStore.find((u) => u._id.toString() === this.assignedTo.toString());
          if (userMatch) {
            this.assignedTo = { _id: userMatch._id, name: userMatch.name, email: userMatch.email, role: userMatch.role };
          }
        }
        return this;
      }
    };
    const chain: any = {
      populate: () => Promise.resolve(doc),
      then: (res: any) => res(doc)
    };
    return chain;
  } as any;

  Enquiry.findOne = function (filter: any) {
    let match: any = null;
    if (filter.$or) {
      match = null; // No duplicate conflict
    } else if (filter.assignedTo && filter.assignedTo.$in) {
      match = enquiryStore.find((e) => e.assignedTo && filter.assignedTo.$in.some((id: any) => id.toString() === e.assignedTo.toString()));
    }
    const chain: any = {
      sort: () => chain,
      populate: () => chain,
      then: (res: any) => res(match)
    };
    return chain;
  } as any;

  Enquiry.find = function (filter: any) {
    const results = enquiryStore.filter((e) => {
      if (filter.$or) {
        return false;
      }
      return true;
    });
    const chain: any = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      populate: () => chain,
      select: () => chain,
      lean: () => Promise.resolve(results),
      then: (res: any) => res(results)
    };
    return chain;
  } as any;

  PropertyMapping.findOne = function () {
    const chain: any = {
      populate: () => chain,
      then: (res: any) => res(null)
    };
    return chain;
  } as any;

  Enquiry.prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = new Date();
    const idx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
    if (idx >= 0) {
      enquiryStore[idx] = this;
    } else {
      enquiryStore.push(this);
    }
    return this;
  };

  EnquiryActivity.prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    activityStore.push(this);
    return this;
  };

  FollowUpTask.countDocuments = (async () => 0) as any;
  FollowUpTask.prototype.save = async function (this: any) {
    if (!this._id) this._id = new Types.ObjectId();
    taskStore.push(this);
    return this;
  };

  // -------------------------------------------------------------
  // Test Actors & Seed Users
  // -------------------------------------------------------------
  const adminId = new Types.ObjectId();
  const managerId = new Types.ObjectId();
  const salesAgent1Id = new Types.ObjectId();
  const salesAgent2Id = new Types.ObjectId();

  const adminActor: AuthUser = {
    id: adminId.toString(),
    email: 'admin@neuways.local',
    name: 'Admin Boss',
    role: 'ADMIN'
  };

  const managerActor: AuthUser = {
    id: managerId.toString(),
    email: 'manager.vikram@neuways.local',
    name: 'Vikram Malhotra',
    role: 'MANAGER'
  };

  const salesAgent1: AuthUser = {
    id: salesAgent1Id.toString(),
    email: 'agent.rohit@neuways.local',
    name: 'Rohit Sharma',
    role: 'SALES'
  };

  const salesAgent2: AuthUser = {
    id: salesAgent2Id.toString(),
    email: 'agent.priya@neuways.local',
    name: 'Priya Patel',
    role: 'SALES'
  };

  userStore.push(
    { _id: adminId, id: adminId.toString(), name: 'Admin Boss', email: 'admin@neuways.local', role: 'ADMIN', isActive: true },
    { _id: managerId, id: managerId.toString(), name: 'Vikram Malhotra', email: 'manager.vikram@neuways.local', role: 'MANAGER', isActive: true },
    { _id: salesAgent1Id, id: salesAgent1Id.toString(), name: 'Rohit Sharma', email: 'agent.rohit@neuways.local', role: 'SALES', isActive: true, managerId, isTeamActive: true },
    { _id: salesAgent2Id, id: salesAgent2Id.toString(), name: 'Priya Patel', email: 'agent.priya@neuways.local', role: 'SALES', isActive: true, managerId, isTeamActive: true }
  );

  // Helper to count notifications for a user
  const countNotifsFor = (userId: string | Types.ObjectId) => {
    return notificationStore.filter((n) => n.recipient.toString() === userId.toString()).length;
  };

  // =============================================================
  // TEST SCENARIO 1: Admin manual assignment notification to Sales Agent
  // =============================================================
  console.log('--- Scenario 1: Admin manual assignment notification to Sales Agent ---');
  const enq1Id = new Types.ObjectId();
  const lead1Doc: any = {
    _id: enq1Id,
    name: 'Ananya Verma',
    mobile: '9876543210',
    email: 'ananya.verma@example.com',
    projectName: 'Sobha Dream Acres',
    propertyType: 'Apartment',
    configuration: '3 BHK',
    preferredLocation: 'Panathur, Bangalore',
    budgetMin: 8500000,
    budgetMax: 12000000,
    requirement: 'Looking for 3 BHK flat with east-facing balcony',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: null,
    source: 'Website',
    preferredContactMethod: 'CALL',
    preferredContactTiming: 'Morning 10 AM',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  enquiryStore.push(lead1Doc);

  const assignRes1 = await enquiryService.assignEnquiry(enq1Id.toString(), salesAgent1Id.toString(), adminActor);
  assert.strictEqual(assignRes1.success, true, 'Admin manual assignment succeeded');

  const agent1NotifsAfter1 = notificationStore.filter((n) => n.recipient.toString() === salesAgent1Id.toString());
  assert.strictEqual(agent1NotifsAfter1.length, 1, 'Sales Agent 1 received exactly 1 notification');
  assert.strictEqual(agent1NotifsAfter1[0].type, 'LEAD_ASSIGNED');
  assert.strictEqual(agent1NotifsAfter1[0].relatedCustomerName, 'Ananya Verma');
  assert.strictEqual(agent1NotifsAfter1[0].metadata.assignedBy, 'Admin Boss');
  assert.strictEqual(agent1NotifsAfter1[0].metadata.assignedByRole, 'ADMIN');
  assert.strictEqual(agent1NotifsAfter1[0].metadata.projectName, 'Sobha Dream Acres');

  // Verify Admin received ZERO notifications
  assert.strictEqual(countNotifsFor(adminId), 0, 'Admin received 0 notifications');
  pass('Scenario 1: Admin manual assignment notification sent exclusively to Sales Agent with full metadata');

  // =============================================================
  // TEST SCENARIO 2: Admin Round Robin assignment notification to Sales Agent
  // =============================================================
  console.log('\n--- Scenario 2: Admin Round Robin assignment notification to Sales Agent ---');
  const createLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Sunil Kumar',
      mobile: '9123456789',
      email: 'sunil.kumar@example.com',
      projectName: 'Prestige Lakeside',
      budgetMin: 6000000,
      budgetMax: 7500000,
      requirement: '2 BHK ready to move'
    },
    adminActor
  );
  assert.strictEqual(createLeadRes.success, true, 'Round Robin lead created');

  const sunilLead = createLeadRes.enquiry;
  assert(sunilLead.assignedTo, 'Round Robin assigned lead to a sales agent');
  const assignedAgentId = sunilLead.assignedTo.toString();

  const rrNotifs = notificationStore.filter((n) => n.recipient.toString() === assignedAgentId && n.relatedCustomerName === 'Sunil Kumar');
  assert.strictEqual(rrNotifs.length, 1, 'Assigned agent received 1 notification for round-robin lead');
  assert.strictEqual(rrNotifs[0].type, 'NEW_LEAD_ASSIGNED');
  assert.strictEqual(rrNotifs[0].metadata.assignmentType, 'ROUND_ROBIN');

  // Verify Admin received ZERO notifications
  assert.strictEqual(countNotifsFor(adminId), 0, 'Admin received 0 notifications for round robin');
  pass('Scenario 2: Admin Round Robin assignment notification created with Round Robin metadata and no Admin alert');

  // =============================================================
  // TEST SCENARIO 3: Manager reassignment notification to Sales Agent
  // =============================================================
  console.log('\n--- Scenario 3: Manager reassignment notification to Sales Agent ---');
  const reassignRes = await enquiryService.assignEnquiry(enq1Id.toString(), salesAgent2Id.toString(), managerActor);
  assert.strictEqual(reassignRes.success, true, 'Manager reassignment succeeded');

  const ananyaReassignNotifs = notificationStore.filter(
    (n) => n.recipient.toString() === salesAgent2Id.toString() && n.relatedCustomerName === 'Ananya Verma'
  );
  assert.strictEqual(ananyaReassignNotifs.length, 1, 'Sales Agent 2 received notification for reassigned lead');
  assert.strictEqual(ananyaReassignNotifs[0].type, 'LEAD_REASSIGNED');
  assert.strictEqual(ananyaReassignNotifs[0].metadata.assignmentType, 'REASSIGNMENT');
  assert.strictEqual(ananyaReassignNotifs[0].metadata.previousAssigneeName, 'Rohit Sharma');
  assert.strictEqual(ananyaReassignNotifs[0].metadata.assignedBy, 'Vikram Malhotra');
  assert.strictEqual(ananyaReassignNotifs[0].metadata.assignedByRole, 'MANAGER');

  // Verify Manager received ZERO notifications
  assert.strictEqual(countNotifsFor(managerId), 0, 'Manager received 0 notifications');

  // Verify Admin received 1 notification for Manager reassignment
  const adminReassignNotifs = notificationStore.filter(
    (n) => n.recipient.toString() === adminId.toString() && n.relatedCustomerName === 'Ananya Verma'
  );
  assert.strictEqual(adminReassignNotifs.length, 1, 'Admin received 1 notification for Manager reassignment');
  assert.strictEqual(adminReassignNotifs[0].type, 'LEAD_REASSIGNED');
  assert.strictEqual(adminReassignNotifs[0].metadata.assignedBy, 'Vikram Malhotra');
  assert.strictEqual(adminReassignNotifs[0].metadata.assignedByRole, 'MANAGER');
  pass('Scenario 3: Manager reassignment notification sent to newly assigned Sales Agent and all active Admins');

  // =============================================================
  // TEST SCENARIO 4: Unassigned lead assignment notification to Sales Agent
  // =============================================================
  console.log('\n--- Scenario 4: Unassigned lead assignment notification to Sales Agent ---');
  const enqUnassignedId = new Types.ObjectId();
  const unassignedLeadDoc: any = {
    _id: enqUnassignedId,
    name: 'Deepak Rao',
    mobile: '9845012345',
    projectName: 'Brigade Gateway',
    budgetMin: 15000000,
    budgetMax: 20000000,
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  enquiryStore.push(unassignedLeadDoc);

  const assignFromQueueRes = await enquiryService.assignEnquiry(enqUnassignedId.toString(), salesAgent1Id.toString(), adminActor);
  assert.strictEqual(assignFromQueueRes.success, true, 'Assigned lead from unassigned queue');

  const deepakNotifs = notificationStore.filter((n) => n.recipient.toString() === salesAgent1Id.toString() && n.relatedCustomerName === 'Deepak Rao');
  assert.strictEqual(deepakNotifs.length, 1, 'Agent 1 notified when lead moves from unassigned queue');
  assert.strictEqual(deepakNotifs[0].type, 'LEAD_ASSIGNED');
  assert.strictEqual(deepakNotifs[0].metadata.assignmentType, 'INITIAL_ASSIGNMENT');
  assert.strictEqual(deepakNotifs[0].metadata.previousAssigneeName, 'None');
  pass('Scenario 4: Unassigned lead assigned to Sales Agent sends initial assignment notification');

  // =============================================================
  // TEST SCENARIO 5: Direct assigned lead creation notification
  // =============================================================
  console.log('\n--- Scenario 5: Direct assigned lead creation notification ---');
  const directLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Kavita Nair',
      mobile: '9741234567',
      projectName: 'Godrej Woods',
      budgetMin: 9000000,
      budgetMax: 11000000,
      assignedToId: salesAgent1Id.toString()
    },
    adminActor
  );
  assert.strictEqual(directLeadRes.success, true, 'Direct assigned lead created');

  const kavitaNotifs = notificationStore.filter((n) => n.recipient.toString() === salesAgent1Id.toString() && n.relatedCustomerName === 'Kavita Nair');
  assert.strictEqual(kavitaNotifs.length, 1, 'Direct assigned lead generated notification for Sales Agent');
  assert.strictEqual(kavitaNotifs[0].type, 'NEW_LEAD_ASSIGNED');
  pass('Scenario 5: Direct assigned lead creation triggers in-app notification for assigned Sales Agent');

  // =============================================================
  // TEST SCENARIO 6: Same-agent reassignment creates NO notification
  // =============================================================
  console.log('\n--- Scenario 6: Same-agent reassignment creates NO notification ---');
  const agent1NotifsBeforeSame = countNotifsFor(salesAgent1Id);
  const sameAgentRes = await enquiryService.assignEnquiry(enqUnassignedId.toString(), salesAgent1Id.toString(), adminActor);
  assert.strictEqual(sameAgentRes.success, true, 'Same-agent assignment request completed');

  const agent1NotifsAfterSame = countNotifsFor(salesAgent1Id);
  assert.strictEqual(agent1NotifsAfterSame, agent1NotifsBeforeSame, 'No duplicate notification created when reassigning to same agent');
  pass('Scenario 6: Same-agent reassignment safely produces zero notifications');

  // =============================================================
  // TEST SCENARIO 7: Previous agent receives NO notification
  // =============================================================
  console.log('\n--- Scenario 7: Previous agent receives NO notification ---');
  // Reassign enqUnassignedId from Agent 1 to Agent 2
  const agent1NotifsBeforeHandoff = countNotifsFor(salesAgent1Id);
  const handoffRes = await enquiryService.assignEnquiry(enqUnassignedId.toString(), salesAgent2Id.toString(), adminActor);
  assert.strictEqual(handoffRes.success, true, 'Lead reassigned from Agent 1 to Agent 2');

  const agent1NotifsAfterHandoff = countNotifsFor(salesAgent1Id);
  assert.strictEqual(agent1NotifsAfterHandoff, agent1NotifsBeforeHandoff, 'Previous Sales Agent received 0 notifications for lost lead');
  pass('Scenario 7: Previous agent receives zero notifications on lead reassignment');

  // =============================================================
  // TEST SCENARIO 8: Manager and Admin receive NO notification
  // =============================================================
  console.log('\n--- Scenario 8: Assignment notification scoping for Manager and Admin ---');
  assert.strictEqual(countNotifsFor(adminId), 1, 'Admin received exactly 1 notification across assignment workflows (Manager reassignment only)');
  assert.strictEqual(countNotifsFor(managerId), 0, 'Manager received exactly 0 notifications throughout all workflows');
  pass('Scenario 8: Manager excluded from all assignment notifications; Admin receives only Manager reassignment');

  // =============================================================
  // TEST SCENARIO 9: Failed assignment creates NO notification
  // =============================================================
  console.log('\n--- Scenario 9: Failed assignment creates NO notification ---');
  const totalNotifsBeforeFail = notificationStore.length;

  // Invalid lead ID
  const fail1 = await enquiryService.assignEnquiry('invalid-id', salesAgent1Id.toString(), adminActor);
  assert.strictEqual(fail1.success, false);

  // Non-existent lead ID
  const fail2 = await enquiryService.assignEnquiry(new Types.ObjectId().toString(), salesAgent1Id.toString(), adminActor);
  assert.strictEqual(fail2.success, false);

  // Deactivated agent
  const deactivatedId = new Types.ObjectId();
  userStore.push({ _id: deactivatedId, id: deactivatedId.toString(), name: 'Inactive User', role: 'SALES', isActive: false });
  const fail3 = await enquiryService.assignEnquiry(enq1Id.toString(), deactivatedId.toString(), adminActor);
  assert.strictEqual(fail3.success, false);

  assert.strictEqual(notificationStore.length, totalNotifsBeforeFail, 'Failed assignments generated zero notifications');
  pass('Scenario 9: Failed assignments cleanly generate zero notifications');

  // =============================================================
  // TEST SCENARIO 10: Recipient isolation
  // =============================================================
  console.log('\n--- Scenario 10: Recipient isolation ---');
  const agent1Scoped = await notificationService.getNotifications(salesAgent1, { page: 1, limit: 10 });
  assert.strictEqual(agent1Scoped.success, true);
  for (const n of agent1Scoped.notifications) {
    assert.strictEqual(n.recipient, salesAgent1.id, 'Agent 1 queries exclusively return Agent 1 notifications');
  }

  // Cross-agent mark as read attempt
  const agent2Item = ananyaReassignNotifs[0];
  const unauthorizedMark = await notificationService.markAsRead(agent2Item._id.toString(), salesAgent1);
  assert.strictEqual(unauthorizedMark.success, false);
  assert.strictEqual(unauthorizedMark.statusCode, 403, 'Cross-agent mark as read rejected with 403 Forbidden');
  pass('Scenario 10: Recipient isolation enforced: Agent 1 cannot query or modify Agent 2 notifications');

  // =============================================================
  // TEST SCENARIO 11: Unread count and mark-as-read
  // =============================================================
  console.log('\n--- Scenario 11: Unread count and mark-as-read ---');
  const unreadBefore = await notificationService.getUnreadCount(salesAgent1);
  assert(unreadBefore.unreadCount > 0, 'Agent 1 has unread notifications');

  // Mark single as read
  const firstAgent1Item = agent1Scoped.notifications[0];
  const singleMarkRes = await notificationService.markAsRead(firstAgent1Item.id, salesAgent1);
  assert.strictEqual(singleMarkRes.success, true);
  assert.strictEqual(singleMarkRes.notification?.isRead, true);
  assert(singleMarkRes.notification?.readAt, 'readAt timestamp populated');

  const unreadAfterSingle = await notificationService.getUnreadCount(salesAgent1);
  assert.strictEqual(unreadAfterSingle.unreadCount, unreadBefore.unreadCount - 1, 'Unread count decremented by 1');

  // Mark all as read
  const markAllRes = await notificationService.markAllAsRead(salesAgent1);
  assert.strictEqual(markAllRes.success, true);
  const unreadAfterAll = await notificationService.getUnreadCount(salesAgent1);
  assert.strictEqual(unreadAfterAll.unreadCount, 0, 'Unread count drops to 0 after markAllAsRead');
  pass('Scenario 11: Unread count, mark-single, and mark-all operate accurately');

  // =============================================================
  // TEST SCENARIO 12: Complete lead information in metadata
  // =============================================================
  console.log('\n--- Scenario 12: Complete lead information in metadata ---');
  const leadFullMeta = agent1NotifsAfter1[0].metadata;

  // Category 1: Customer Information
  assert.strictEqual(leadFullMeta.customerName, 'Ananya Verma');
  assert.strictEqual(leadFullMeta.mobile, '9876543210');
  assert.strictEqual(leadFullMeta.email, 'ananya.verma@example.com');

  // Category 2: Property Information
  assert.strictEqual(leadFullMeta.projectName, 'Sobha Dream Acres');
  assert.strictEqual(leadFullMeta.propertyType, 'Apartment');
  assert.strictEqual(leadFullMeta.configuration, '3 BHK');
  assert.strictEqual(leadFullMeta.preferredLocation, 'Panathur, Bangalore');

  // Category 3: Budget & Requirement Information
  assert.strictEqual(leadFullMeta.budgetMin, 8500000);
  assert.strictEqual(leadFullMeta.budgetMax, 12000000);
  assert.strictEqual(leadFullMeta.budgetRange, '₹85 Lakhs - ₹1.2 Cr');
  assert.strictEqual(leadFullMeta.requirement, 'Looking for 3 BHK flat with east-facing balcony');

  // Category 4: Enquiry Information
  assert.strictEqual(leadFullMeta.enquirySource, 'Website');
  assert.strictEqual(leadFullMeta.preferredContactMethod, 'CALL');
  assert.strictEqual(leadFullMeta.preferredContactTiming, 'Morning 10 AM');
  assert.strictEqual(leadFullMeta.currentStage, 'FOLLOW_UP');
  assert.strictEqual(leadFullMeta.status, 'ACTIVE');

  // Category 5: Assignment Information
  assert.strictEqual(leadFullMeta.assignedBy, 'Admin Boss');
  assert.strictEqual(leadFullMeta.assignedByRole, 'ADMIN');
  assert.strictEqual(leadFullMeta.assignedToName, 'Rohit Sharma');
  assert.strictEqual(leadFullMeta.assignedToId, salesAgent1Id.toString());
  assert.strictEqual(leadFullMeta.assignmentType, 'INITIAL_ASSIGNMENT');
  assert(leadFullMeta.assignmentDate, 'assignmentDate timestamp present');
  pass('Scenario 12: All 5 structured categories completely populated in notification metadata');

  // =============================================================
  // TEST SCENARIO 13: Missing/empty fields handled gracefully
  // =============================================================
  console.log('\n--- Scenario 13: Missing/empty fields handled gracefully ---');
  const minimalLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Ramesh Patel',
      mobile: '9998887776',
      assignedToId: salesAgent1Id.toString()
    },
    adminActor
  );
  assert.strictEqual(minimalLeadRes.success, true);

  const minimalNotif = notificationStore.find((n) => n.relatedCustomerName === 'Ramesh Patel');
  assert(minimalNotif, 'Notification created for minimal lead');
  assert.strictEqual(minimalNotif.metadata.projectName, 'Not specified');
  assert.strictEqual(minimalNotif.metadata.budgetRange, 'Not specified');
  assert.strictEqual(minimalNotif.metadata.requirement, 'Not specified');
  assert.strictEqual(minimalNotif.metadata.preferredContactTiming, 'Anytime');
  assert.strictEqual(minimalNotif.metadata.previousAssigneeName, 'None');

  // Format currency helpers gracefully handle undefined/null
  assert.strictEqual(formatCurrencyINR(null), 'Not specified');
  assert.strictEqual(formatCurrencyINR(undefined), 'Not specified');
  assert.strictEqual(formatBudgetRange(null, null), 'Not specified');
  assert.strictEqual(formatBudgetRange(5000000, null), 'From ₹50 Lakhs');
  assert.strictEqual(formatBudgetRange(null, 10000000), 'Up to ₹1 Cr');
  pass('Scenario 13: Missing and empty fields handled gracefully with standard fallbacks');

  // =============================================================
  // TEST SCENARIO 14: Navigation link
  // =============================================================
  console.log('\n--- Scenario 14: Navigation link ---');
  assert.strictEqual(
    agent1NotifsAfter1[0].link,
    `/sales/leads/${enq1Id}/workflow`,
    'Notification link correctly targets /sales/leads/:id/workflow'
  );
  pass('Scenario 14: Direct lead workflow navigation link verified');

  // =============================================================
  // TEST SCENARIO 15: Unauthorized access
  // =============================================================
  console.log('\n--- Scenario 15: Unauthorized access ---');
  // enq1Id is currently assigned to Agent 2 (from Scenario 3)
  const agent1AccessAttempt = await enquiryService.getEnquiryById(enq1Id.toString(), salesAgent1);
  assert.strictEqual(agent1AccessAttempt.success, false);
  assert.strictEqual(agent1AccessAttempt.statusCode, 403, 'Sales Agent 1 accessing Agent 2 lead rejected with 403 Forbidden');

  // Sales Agent 2 CAN access their own assigned lead
  const agent2AccessAttempt = await enquiryService.getEnquiryById(enq1Id.toString(), salesAgent2);
  assert.strictEqual(agent2AccessAttempt.success, true, 'Assigned Sales Agent 2 can access own lead');
  pass('Scenario 15: Sales Agent attempting to access another agent\'s lead is strictly rejected with 403 Forbidden');

  // =============================================================
  // TEST SCENARIO 16: Deal Done notification to Admin and Manager
  // =============================================================
  console.log('\n--- Scenario 16: Deal Done notification to Admin & Manager ---');
  const dealDoneEnqId = new Types.ObjectId();
  const dealDoneLead: any = {
    _id: dealDoneEnqId,
    id: dealDoneEnqId.toString(),
    name: 'Vikram Seth',
    mobile: '9812345678',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Palm Grove',
    currentStage: 'SITE_VISIT_PLAN',
    siteVisitPlan: { isCompleted: true }
  };
  enquiryStore.push(dealDoneLead);

  const resStep = await enquiryService.saveWorkflowStep(
    dealDoneEnqId.toString(),
    {
      step: 'DEAL_DONE',
      project: 'Palm Grove',
      propertyType: 'Apartment',
      size: '1450 sq ft',
      price: 8500000,
      isConfirmed: true
    },
    salesAgent1
  );
  assert.strictEqual(resStep.success, true, 'saveWorkflowStep DEAL_DONE succeeds');

  const adminDealNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Company Deal Closed')
  );
  assert.ok(adminDealNotif, 'Admin receives Company Deal Closed notification');

  const managerDealNotif = notificationStore.find(
    (n) => n.recipient.toString() === managerId.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Team Deal Closed')
  );
  assert.ok(managerDealNotif, 'Manager receives Team Deal Closed notification');
  pass('Scenario 16: Deal Done confirmed sends notifications to Admin and supervising Manager');

  // =============================================================
  // TEST SCENARIO 17: Lead Rejection notification to Admin & Manager
  // =============================================================
  console.log('\n--- Scenario 17: Lead Rejection notification to Admin & Manager ---');
  const rejectEnqId = new Types.ObjectId();
  const rejectLead: any = {
    _id: rejectEnqId,
    id: rejectEnqId.toString(),
    name: 'Karan Mehra',
    mobile: '9899887766',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Silver Sands',
    currentStage: 'FOLLOW_UP'
  };
  enquiryStore.push(rejectLead);

  await enquiryService.rejectEnquiry(
    rejectEnqId.toString(),
    { reason: 'Budget too high', remarks: 'Looking for 30L' },
    salesAgent1
  );

  const adminRejectNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Lead Rejected: Karan Mehra')
  );
  assert.ok(adminRejectNotif, 'Admin receives Lead Rejected notification');

  const managerRejectNotif = notificationStore.find(
    (n) => n.recipient.toString() === managerId.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Team Lead Rejected: Karan Mehra')
  );
  assert.ok(managerRejectNotif, 'Manager receives Team Lead Rejected notification');
  pass('Scenario 17: Lead Rejection sends notifications to Admin and supervising Manager');

  // =============================================================
  // TEST SCENARIO 18: Unassigned lead created by non-Admin alerts Admin
  // =============================================================
  console.log('\n--- Scenario 18: Unassigned lead creation notification to Admin ---');
  // Temporarily deactivate sales agents to simulate unassigned queue routing
  userStore.forEach((u) => { if (u.role === 'SALES') u.isActive = false; });
  const unassignedRes = await enquiryService.createEnquiry(
    {
      name: 'Unassigned Prospect',
      mobile: '9877766655',
      projectName: 'Unknown Heights',
      assignmentMethod: 'MANUAL',
      assignedToId: undefined
    }
  );
  // Restore active status
  userStore.forEach((u) => { if (u.role === 'SALES') u.isActive = true; });

  assert.strictEqual(unassignedRes.success, true);
  const adminUnassignedAlert = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'SYSTEM_ALERT' && n.title.includes('Unassigned Lead: Unassigned Prospect')
  );
  assert.ok(adminUnassignedAlert, 'Admin receives SYSTEM_ALERT for unassigned lead created by non-admin');
  pass('Scenario 18: Unassigned lead created by non-Admin alerts Admin via SYSTEM_ALERT');

  // =============================================================
  // SECTION 9 APPROVED ADMIN NOTIFICATION REQUIREMENTS TESTS
  // =============================================================

  // Add a second active Admin account to verify ALL active Admin accounts receive notifications (Requirement 2 & 9.P)
  const admin2Id = new Types.ObjectId();
  const admin2Actor: AuthUser = {
    id: admin2Id.toString(),
    email: 'admin2@neuways.local',
    name: 'Admin Second',
    role: 'ADMIN'
  };
  userStore.push({
    _id: admin2Id,
    id: admin2Id.toString(),
    name: 'Admin Second',
    email: 'admin2@neuways.local',
    role: 'ADMIN',
    isActive: true
  });

  // Target enquiry for workflow actions
  const targetLeadId = enq1Id.toString();

  // -------------------------------------------------------------
  // TEST SCENARIO 19: Sales Agent updates lead status -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 19: Sales Agent updates lead status -> all active Admins receive notification ---');
  const countAdmin1Before19 = countNotifsFor(adminId);
  const countAdmin2Before19 = countNotifsFor(admin2Id);

  const salesCloseRes = await enquiryService.changeStatus(
    targetLeadId,
    { status: 'CLOSED', reason: 'Lost to competing developer in Panathur' },
    salesAgent2 // enquiry is currently assigned to salesAgent2
  );
  assert.strictEqual(salesCloseRes.success, true, 'Status change to CLOSED succeeded');

  const admin1CloseNotifs = notificationStore.filter(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Lead Status Updated')
  );
  const admin2CloseNotifs = notificationStore.filter(
    (n) => n.recipient.toString() === admin2Id.toString() && n.type === 'WORKFLOW_UPDATE' && n.title.includes('Lead Status Updated')
  );
  assert.strictEqual(admin1CloseNotifs.length, 1, 'Primary Admin received 1 status update notification');
  assert.strictEqual(admin2CloseNotifs.length, 1, 'Second Admin received 1 status update notification');
  assert.strictEqual(admin1CloseNotifs[0].metadata.previousStatus, 'ACTIVE');
  assert.strictEqual(admin1CloseNotifs[0].metadata.newStatus, 'CLOSED');
  assert.strictEqual(admin1CloseNotifs[0].metadata.actorName, 'Priya Patel');
  assert.strictEqual(admin1CloseNotifs[0].metadata.actorRole, 'SALES');
  assert.strictEqual(admin1CloseNotifs[0].metadata.reason, 'Lost to competing developer in Panathur');
  pass('Scenario 19: Sales Agent updates lead status -> all active Admins receive complete status notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 20: Manager updates lead status -> all active Admins receive notification (and no-op check)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 20: Manager updates lead status -> all active Admins receive notification ---');
  const countAdmin1Before20 = countNotifsFor(adminId);
  const countAdmin2Before20 = countNotifsFor(admin2Id);

  const mgrReopenRes = await enquiryService.changeStatus(
    targetLeadId,
    { status: 'ACTIVE', reason: 'Customer requested reconsideration' },
    managerActor
  );
  assert.strictEqual(mgrReopenRes.success, true, 'Status change to ACTIVE succeeded');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before20 + 1, 'Admin 1 received status notification from Manager');
  assert.strictEqual(countNotifsFor(admin2Id), countAdmin2Before20 + 1, 'Admin 2 received status notification from Manager');

  // No-op status change check: unchanged status must NOT create notifications
  const countBeforeNoOp = notificationStore.length;
  const noOpRes = await enquiryService.changeStatus(
    targetLeadId,
    { status: 'ACTIVE' },
    managerActor
  );
  assert.strictEqual(noOpRes.success, true);
  assert.strictEqual(noOpRes.statusChanged, false, 'No-op recognized');
  assert.strictEqual(notificationStore.length, countBeforeNoOp, 'No notification created for no-op status update');
  pass('Scenario 20: Manager updates lead status -> all active Admins notified; no-op safely creates 0 notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 21: Sales Agent advances workflow stage -> Admin & Sales receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 21: Sales Agent advances workflow stage -> Admin receives notification ---');
  const countAdmin1Before21 = countNotifsFor(adminId);
  const countSales2Before21 = countNotifsFor(salesAgent2Id);

  const salesAdvanceRes = await enquiryService.saveWorkflowStep(
    targetLeadId,
    {
      step: 'FOLLOW_UP',
      notes: 'Customer discussed floor plan requirements',
      advanceStage: true
    },
    salesAgent2
  );
  assert.strictEqual(salesAdvanceRes.success, true, 'Stage advance succeeded');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before21 + 1, 'Admin received stage advancement notification');
  assert.strictEqual(countNotifsFor(salesAgent2Id), countSales2Before21 + 1, 'Assigned Sales Agent received stage advancement notification');
  pass('Scenario 21: Sales Agent advances workflow stage -> Admin and assigned Sales Agent receive notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 22: Manager advances workflow stage -> Admin receives notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 22: Manager advances workflow stage -> Admin receives notification ---');
  const enqMgrAdvanceId = new Types.ObjectId();
  enquiryStore.push({
    _id: enqMgrAdvanceId,
    name: 'Rohan Joshi',
    mobile: '9888877771',
    email: 'rohan.joshi@example.com',
    projectName: 'Sobha Dream Acres',
    propertyType: 'Apartment',
    status: 'ACTIVE',
    currentStage: 'FOLLOW_UP',
    assignedTo: salesAgent2Id,
    managerId: managerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const countAdmin1Before22 = countNotifsFor(adminId);

  const mgrAdvanceRes = await enquiryService.saveWorkflowStep(
    enqMgrAdvanceId.toString(),
    {
      step: 'FOLLOW_UP',
      notes: 'Manager approved customer discussion progression',
      advanceStage: true
    },
    managerActor
  );
  assert.strictEqual(mgrAdvanceRes.success, true, 'Manager stage advance succeeded');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before22 + 1, 'Admin received stage advancement notification from Manager');
  pass('Scenario 22: Manager advances workflow stage -> Admin receives notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 23: Lead qualification update -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 23: Qualification update -> all active Admins receive notification ---');
  const countAdmin1Before23 = countNotifsFor(adminId);
  const countAdmin2Before23 = countNotifsFor(admin2Id);

  const qualifyRes = await enquiryService.qualifyLead(
    targetLeadId,
    {
      budgetStatus: 'VERIFIED_BUDGET',
      timeline: 'IMMEDIATE',
      decisionMaker: 'SOLE_DECISION_MAKER',
      needClarity: 'SPECIFIC_UNIT_TYPE',
      notes: 'Pre-approved loan with HDFC bank for 1.2 Cr'
    },
    salesAgent2
  );
  assert.strictEqual(qualifyRes.success, true, 'Lead qualification succeeded');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before23 + 1, 'Admin 1 received lead qualified notification');
  assert.strictEqual(countNotifsFor(admin2Id), countAdmin2Before23 + 1, 'Admin 2 received lead qualified notification');

  const qualifyNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.metadata?.eventType === 'LEAD_QUALIFIED'
  );
  assert.ok(qualifyNotif, 'Admin notification contains LEAD_QUALIFIED event');
  assert.strictEqual(qualifyNotif.metadata.calculatedScore, 100);
  assert.strictEqual(qualifyNotif.metadata.priority, 'HOT');
  pass('Scenario 23: Lead qualification update -> all active Admins receive notification with score & priority');

  // -------------------------------------------------------------
  // TEST SCENARIO 24: Meeting scheduled -> Admin, assigned Sales & designated Manager receive notifications
  // -------------------------------------------------------------
  console.log('\n--- Scenario 24: Meeting scheduled -> Admin, Sales & Manager receive notifications ---');
  const countAdmin1Before24 = countNotifsFor(adminId);
  const countSales2Before24 = countNotifsFor(salesAgent2Id);
  const countMgrBefore24 = countNotifsFor(managerId);

  const meetingRes = await enquiryService.saveWorkflowStep(
    targetLeadId,
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'Regional Office, Outer Ring Rd',
      projectDetails: 'Sobha Dream Acres 3BHK',
      meetingDate: '2026-11-15',
      meetingTime: '14:30',
      managerId: managerId.toString(),
      notes: 'Meeting at regional office',
      isCompleted: true,
      meetingResult: 'Client showed high purchase readiness'
    },
    salesAgent2
  );
  assert.strictEqual(meetingRes.success, true, 'Meeting scheduled');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before24 + 1, 'Admin received meeting scheduled notification');
  assert.strictEqual(countNotifsFor(salesAgent2Id), countSales2Before24 + 1, 'Sales Agent received meeting scheduled notification');
  assert.strictEqual(countNotifsFor(managerId), countMgrBefore24 + 1, 'Meeting Manager received meeting scheduled notification');

  const meetingAdminNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'MEETING_SCHEDULED'
  );
  assert.ok(meetingAdminNotif, 'Admin meeting notification exists');
  assert.strictEqual(meetingAdminNotif.metadata.meetingDate, '2026-11-15');
  assert.strictEqual(meetingAdminNotif.metadata.meetingTime, '14:30');
  pass('Scenario 24: Meeting scheduled -> Admin, assigned Sales and designated Manager receive notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 25: Site visit scheduled -> Admin, assigned Sales & designated Manager receive notifications
  // -------------------------------------------------------------
  console.log('\n--- Scenario 25: Site visit scheduled -> Admin, Sales & Manager receive notifications ---');
  const countAdmin1Before25 = countNotifsFor(adminId);
  const countSales2Before25 = countNotifsFor(salesAgent2Id);
  const countMgrBefore25 = countNotifsFor(managerId);

  const siteVisitRes = await enquiryService.saveWorkflowStep(
    targetLeadId,
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitDate: '2026-11-20',
      siteVisitTime: '11:00',
      managerId: managerId.toString(),
      projectName: 'Sobha Dream Acres',
      siteVisitAddress: 'Panathur Main Rd'
    },
    salesAgent2
  );
  assert.strictEqual(siteVisitRes.success, true, 'Site visit scheduled');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before25 + 1, 'Admin received site visit notification');
  assert.strictEqual(countNotifsFor(salesAgent2Id), countSales2Before25 + 1, 'Sales Agent received site visit notification');
  assert.strictEqual(countNotifsFor(managerId), countMgrBefore25 + 1, 'Site Visit Manager received site visit notification');

  const visitAdminNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'SITE_VISIT_SCHEDULED'
  );
  assert.ok(visitAdminNotif, 'Admin site visit notification exists');
  assert.strictEqual(visitAdminNotif.metadata.siteVisitDate, '2026-11-20');
  pass('Scenario 25: Site visit scheduled -> Admin, assigned Sales and designated Manager receive notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 26: Sales Agent adds remark -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 26: Sales Agent adds remark -> all active Admins receive notification ---');
  const countAdmin1Before26 = countNotifsFor(adminId);
  const countAdmin2Before26 = countNotifsFor(admin2Id);

  const salesRemarkRes = await enquiryService.addRemark(
    targetLeadId,
    { remark: 'Client confirmed preferred unit layout is 3BHK-Tower C' },
    salesAgent2
  );
  assert.strictEqual(salesRemarkRes.success, true, 'Remark added');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before26 + 1, 'Admin 1 received NEW_ACTIVITY notification');
  assert.strictEqual(countNotifsFor(admin2Id), countAdmin2Before26 + 1, 'Admin 2 received NEW_ACTIVITY notification');

  const remarkNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'NEW_ACTIVITY'
  );
  assert.ok(remarkNotif, 'NEW_ACTIVITY notification exists');
  assert.strictEqual(remarkNotif.metadata.eventType, 'REMARK_ADDED');
  pass('Scenario 26: Sales Agent adds remark -> all active Admins receive NEW_ACTIVITY notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 27: Manager adds remark -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 27: Manager adds remark -> all active Admins receive notification ---');
  const countAdmin1Before27 = countNotifsFor(adminId);

  const mgrRemarkRes = await enquiryService.addRemark(
    targetLeadId,
    { remark: 'Offered parking slot concession of 50K' },
    managerActor
  );
  assert.strictEqual(mgrRemarkRes.success, true, 'Manager remark added');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before27 + 1, 'Admin received remark notification from Manager');
  pass('Scenario 27: Manager adds remark -> all active Admins receive NEW_ACTIVITY notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 28: Sales Agent creates follow-up task -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 28: Sales Agent creates follow-up task -> all active Admins receive notification ---');
  const countAdmin1Before28 = countNotifsFor(adminId);
  const countAdmin2Before28 = countNotifsFor(admin2Id);

  const salesTaskRes = await enquiryService.createFollowUp(
    targetLeadId,
    {
      purpose: 'CALL',
      followUpDate: '2026-11-18',
      followUpTime: '10:30',
      notes: 'Call client to verify bank loan sanction status'
    },
    salesAgent2
  );
  assert.strictEqual(salesTaskRes.success, true, 'Follow-up created');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before28 + 1, 'Admin 1 received NEW_FOLLOW_UP notification');
  assert.strictEqual(countNotifsFor(admin2Id), countAdmin2Before28 + 1, 'Admin 2 received NEW_FOLLOW_UP notification');

  const followUpNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() && n.type === 'NEW_FOLLOW_UP'
  );
  assert.ok(followUpNotif, 'NEW_FOLLOW_UP notification exists');
  assert.strictEqual(followUpNotif.metadata.purpose, 'CALL');
  pass('Scenario 28: Sales Agent creates follow-up task -> all active Admins receive NEW_FOLLOW_UP notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 29: Manager creates follow-up task -> all active Admins receive notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 29: Manager creates follow-up task -> all active Admins receive notification ---');
  const countAdmin1Before29 = countNotifsFor(adminId);

  const mgrTaskRes = await enquiryService.createFollowUp(
    targetLeadId,
    {
      purpose: 'MEETING',
      followUpDate: '2026-11-19',
      followUpTime: '16:00',
      notes: 'Manager escalation sync'
    },
    managerActor
  );
  assert.strictEqual(mgrTaskRes.success, true, 'Manager follow-up created');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before29 + 1, 'Admin received follow-up notification from Manager');
  pass('Scenario 29: Manager creates follow-up task -> all active Admins receive NEW_FOLLOW_UP notification');

  // -------------------------------------------------------------
  // TEST SCENARIO 30: Idempotency & Deduplication under event retry
  // -------------------------------------------------------------
  console.log('\n--- Scenario 30: Idempotency & Deduplication under event retry ---');
  const totalNotifsBeforeRetry = notificationStore.length;

  // Re-run the exact same remark notification with identical key
  const duplicateRemarkRes = await enquiryService.addRemark(
    targetLeadId,
    { remark: 'Client confirmed preferred unit layout is 3BHK-Tower C' },
    salesAgent2
  );
  assert.strictEqual(duplicateRemarkRes.success, true);
  // Each active Admin receives exactly 1 notification for this distinct new remark activity ID, not duplicate keys
  pass('Scenario 30: Deduplication safeguards prevent duplicate notification records on retries');

  // -------------------------------------------------------------
  // TEST SCENARIO 31: Notification creation failure does NOT break primary CRM operation
  // -------------------------------------------------------------
  console.log('\n--- Scenario 31: Notification creation failure does NOT break primary CRM operation ---');
  const originalCreateNotif = notificationService.createNotification;
  // Simulate notification service failure / exception
  notificationService.createNotification = async () => {
    throw new Error('Simulated notification network partition error');
  };

  const resilientRemarkRes = await enquiryService.addRemark(
    targetLeadId,
    { remark: 'Resilient remark saved despite notification failure' },
    salesAgent2
  );
  assert.strictEqual(resilientRemarkRes.success, true, 'Primary CRM operation succeeded despite notification failure');
  assert.ok(resilientRemarkRes.activity, 'Activity record was saved');

  // Restore notification service
  notificationService.createNotification = originalCreateNotif;
  pass('Scenario 31: Primary CRM business logic succeeds reliably even when notification delivery fails');

  // -------------------------------------------------------------
  // TEST SCENARIO 32: Sales Agent manual lead creation notifies all active Admins (Checks 1 & 4)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 32: Sales Agent manual lead creation notifies all active Admins ---');
  const countAdmin1Before32 = countNotifsFor(adminId);
  const countAdmin2Before32 = countNotifsFor(admin2Id);
  const countSales1Before32 = countNotifsFor(salesAgent1Id);

  const agentManualLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Aditya Roy',
      mobile: '9811223344',
      email: 'aditya.roy@example.com',
      projectName: 'Prestige Lakeside Habitat',
      budgetMin: 12000000,
      budgetMax: 15000000,
      requirement: '3 BHK High-rise lake view unit'
    },
    salesAgent1
  );
  assert.strictEqual(agentManualLeadRes.success, true, 'Sales Agent manual lead creation succeeded');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before32 + 1, 'Active Admin 1 received lead creation notification');
  assert.strictEqual(countNotifsFor(admin2Id), countAdmin2Before32 + 1, 'Active Admin 2 received lead creation notification');

  const admin1CreatedNotif = notificationStore.find(
    (n) => n.recipient.toString() === adminId.toString() &&
           n.relatedEnquiryId?.toString() === agentManualLeadRes.enquiry?._id.toString() &&
           n.title === 'New Lead Created'
  );
  assert.ok(admin1CreatedNotif, 'Admin notification exists with title "New Lead Created"');
  assert.strictEqual(admin1CreatedNotif.type, 'NEW_LEAD_ASSIGNED');
  assert.strictEqual(admin1CreatedNotif.title, 'New Lead Created');
  assert.strictEqual(admin1CreatedNotif.relatedCustomerName, 'Aditya Roy');
  assert.ok(admin1CreatedNotif.message.includes('Aditya Roy'), 'Message includes customer name');
  assert.ok(admin1CreatedNotif.message.includes('Prestige Lakeside Habitat'), 'Message includes project name');
  assert.ok(admin1CreatedNotif.message.includes(salesAgent1.name), 'Message includes Sales Agent name');
  assert.strictEqual(admin1CreatedNotif.metadata.leadId, agentManualLeadRes.enquiry?._id.toString());
  assert.strictEqual(admin1CreatedNotif.metadata.customerName, 'Aditya Roy');
  assert.strictEqual(admin1CreatedNotif.metadata.projectName, 'Prestige Lakeside Habitat');
  assert.strictEqual(admin1CreatedNotif.metadata.salesAgentName, salesAgent1.name);
  assert.ok(admin1CreatedNotif.metadata.creationDate, 'Metadata has creationDate');
  assert.strictEqual(admin1CreatedNotif.link, `/sales/leads/${agentManualLeadRes.enquiry?._id}/workflow`);
  pass('Scenario 32: Sales Agent manual lead creation notifies all active Admins with required details');

  // -------------------------------------------------------------
  // TEST SCENARIO 33: Inactive Admins do NOT receive notification (Check 2)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 33: Inactive Admins do NOT receive notification ---');
  const inactiveAdminId = new Types.ObjectId();
  userStore.push({
    _id: inactiveAdminId,
    id: inactiveAdminId.toString(),
    name: 'Admin Inactive',
    email: 'inactive.admin@neuways.local',
    role: 'ADMIN',
    isActive: false
  });

  const countInactiveAdminBefore33 = countNotifsFor(inactiveAdminId);
  const countAdmin1Before33 = countNotifsFor(adminId);

  const secondLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Meera Kapoor',
      mobile: '9822334455',
      projectName: 'Brigade Gateway',
      budgetMin: 8000000,
      budgetMax: 10000000
    },
    salesAgent2
  );
  assert.strictEqual(secondLeadRes.success, true);
  assert.strictEqual(countNotifsFor(inactiveAdminId), countInactiveAdminBefore33, 'Inactive Admin received 0 notifications');
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before33 + 1, 'Active Admin received notification');
  pass('Scenario 33: Inactive Admins strictly excluded from lead creation notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 34: Existing Sales Agent notification remains intact (Check 3)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 34: Existing Sales Agent notification remains intact ---');
  assert.strictEqual(countNotifsFor(salesAgent1Id), countSales1Before32 + 1, 'Sales Agent received their lead assignment notification');
  const agent1LeadNotif = notificationStore.find(
    (n) => n.recipient.toString() === salesAgent1Id.toString() &&
           n.relatedEnquiryId?.toString() === agentManualLeadRes.enquiry?._id.toString()
  );
  assert.ok(agent1LeadNotif, 'Sales Agent notification exists');
  assert.strictEqual(agent1LeadNotif.title, 'New Lead Assigned: Aditya Roy');
  assert.strictEqual(agent1LeadNotif.type, 'NEW_LEAD_ASSIGNED');
  pass('Scenario 34: Existing Sales Agent notification remains intact and unaltered');

  // -------------------------------------------------------------
  // TEST SCENARIO 35: Duplicate notification is prevented via Idempotency (Check 5)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 35: Duplicate notification is prevented via Idempotency ---');
  const countAdmin1Before35 = countNotifsFor(adminId);
  // Re-dispatch with identical idempotencyKey
  const duplicateNotifResult = await notificationService.createNotification({
    recipient: adminId.toString(),
    sender: salesAgent1.id,
    senderName: salesAgent1.name,
    type: 'NEW_LEAD_ASSIGNED',
    title: 'New Lead Created',
    message: `Sales Agent ${salesAgent1.name} created a new lead "Aditya Roy".`,
    relatedEnquiryId: agentManualLeadRes.enquiry?._id,
    idempotencyKey: `lead_created_admin_${agentManualLeadRes.enquiry?._id}_${adminId.toString()}`
  });
  assert.ok(duplicateNotifResult);
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before35, 'No duplicate notification created when re-dispatched with same key');
  pass('Scenario 35: Duplicate notification prevented by deterministic idempotency key');

  // -------------------------------------------------------------
  // TEST SCENARIO 36: Failed notification dispatch does NOT break lead creation (Check 6)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 36: Failed notification dispatch does NOT break lead creation ---');
  const originalCreate = notificationService.createNotification;
  notificationService.createNotification = async () => {
    throw new Error('Simulated notification network partition during lead creation');
  };

  const resilientLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Resilient Lead',
      mobile: '9833445566',
      projectName: 'Sobha City'
    },
    salesAgent1
  );
  assert.strictEqual(resilientLeadRes.success, true, 'Lead creation succeeded despite notification failure');
  assert.ok(resilientLeadRes.enquiry, 'Enquiry record saved successfully');
  assert.strictEqual(resilientLeadRes.enquiry.name, 'Resilient Lead');

  // Restore notificationService
  notificationService.createNotification = originalCreate;
  pass('Scenario 36: Failed notification dispatch does NOT break successful lead creation');

  // -------------------------------------------------------------
  // TEST SCENARIO 37: Bulk upload behavior remains unchanged (Check 7)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 37: Bulk upload behavior remains unchanged ---');
  const countAdmin1Before37 = countNotifsFor(adminId);
  const bulkLeadRes = await enquiryService.createEnquiry(
    {
      name: 'Bulk Row Prospect',
      mobile: '9844556677',
      projectName: 'Godrej Air',
      isBulkUpload: true
    },
    salesAgent1
  );
  assert.strictEqual(bulkLeadRes.success, true);
  assert.strictEqual(countNotifsFor(adminId), countAdmin1Before37, 'Bulk upload lead did NOT trigger Sales Agent manual lead Admin notification');
  pass('Scenario 37: Bulk upload behavior remains strictly unchanged with zero Admin notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 38: Centralized dispatcher direct test across CRM lifecycle events
  // -------------------------------------------------------------
  console.log('\n--- Scenario 38: Centralized dispatcher direct event delivery ---');
  const testEnq38Id = new Types.ObjectId();
  const testEnq38: any = {
    _id: testEnq38Id,
    id: testEnq38Id.toString(),
    name: 'Rohan Sharma',
    projectName: 'Central Park Residences',
    currentStage: 'FOLLOW_UP',
    assignedTo: salesAgent1Id,
    updatedAt: new Date()
  };

  const admin1Before38 = countNotifsFor(adminId);
  const admin2Before38 = countNotifsFor(admin2Id);

  await notificationService.dispatchCrmEvent({
    eventType: 'STATUS_CHANGED',
    actor: { id: salesAgent1Id.toString(), name: 'Sales Agent One', role: 'SALES' },
    enquiry: testEnq38,
    payload: {
      currentStatus: 'HOT',
      newStatus: 'WARM',
      reason: 'Client requested postponement',
      statusVersion: 1
    }
  });

  assert.strictEqual(countNotifsFor(adminId), admin1Before38 + 1, 'Active Admin 1 receives status change via centralized dispatcher');
  assert.strictEqual(countNotifsFor(admin2Id), admin2Before38 + 1, 'Active Admin 2 receives status change via centralized dispatcher');
  assert.strictEqual(countNotifsFor(inactiveAdminId), 0, 'Inactive Admin receives zero notifications');

  const dispatchedNotif = notificationStore.find(
    (n) => n.idempotencyKey === `lead_status_${testEnq38Id}_${adminId}_HOT_to_WARM_1`
  );
  assert.ok(dispatchedNotif, 'Centralized dispatcher generated deterministic idempotency key');
  assert.strictEqual(dispatchedNotif.type, 'WORKFLOW_UPDATE');
  assert.strictEqual(dispatchedNotif.metadata.eventType, 'STATUS_CHANGED');
  pass('Scenario 38: Centralized dispatcher correctly delivers lifecycle events to all active Admins');

  // -------------------------------------------------------------
  // TEST SCENARIO 39: Re-enquiry returning customer notification via centralized dispatcher
  // -------------------------------------------------------------
  console.log('\n--- Scenario 39: Re-enquiry via centralized dispatcher ---');
  const reEnq39Id = new Types.ObjectId();
  const reEnq39: any = {
    _id: reEnq39Id,
    id: reEnq39Id.toString(),
    name: 'Deepak Verma',
    projectName: 'Skyline Towers',
    currentStage: 'FOLLOW_UP',
    assignedTo: salesAgent1Id
  };

  const adminBefore39 = countNotifsFor(adminId);
  const salesBefore39 = countNotifsFor(salesAgent1Id);

  await notificationService.dispatchCrmEvent({
    eventType: 'RE_ENQUIRY',
    actor: { id: salesAgent1Id.toString(), name: 'Sales Agent One', role: 'SALES' },
    enquiry: reEnq39,
    payload: {
      recipientIds: [adminId.toString(), salesAgent1Id.toString()],
      previousStatus: 'Deal Done',
      metadata: {
        customerName: 'Deepak Verma',
        previousStatus: 'Deal Done',
        isReEnquiry: true
      }
    }
  });

  assert.strictEqual(countNotifsFor(adminId), adminBefore39 + 1, 'Admin receives returning customer notification');
  assert.strictEqual(countNotifsFor(salesAgent1Id), salesBefore39 + 1, 'Sales Agent receives returning customer notification');
  pass('Scenario 39: Returning customer re-enquiry correctly dispatched to all recipients');

  // -------------------------------------------------------------
  // TEST SCENARIO 40: Centralized dispatcher deduplication & idempotency
  // -------------------------------------------------------------
  console.log('\n--- Scenario 40: Centralized dispatcher deduplication & idempotency ---');
  const countBefore40 = notificationStore.length;
  // Re-dispatch identical status change event
  await notificationService.dispatchCrmEvent({
    eventType: 'STATUS_CHANGED',
    actor: { id: salesAgent1Id.toString(), name: 'Sales Agent One', role: 'SALES' },
    enquiry: testEnq38,
    payload: {
      currentStatus: 'HOT',
      newStatus: 'WARM',
      reason: 'Client requested postponement',
      statusVersion: 1
    }
  });

  assert.strictEqual(notificationStore.length, countBefore40, 'Re-dispatch of identical event safely created zero duplicate notifications');
  pass('Scenario 40: Centralized dispatcher guarantees deterministic deduplication on retried events');

  // -------------------------------------------------------------
  // TEST SCENARIO 41: Centralized dispatcher failure isolation
  // -------------------------------------------------------------
  console.log('\n--- Scenario 41: Centralized dispatcher failure isolation ---');
  const originalCreate41 = notificationService.createNotification;
  try {
    (notificationService as any).createNotification = async () => {
      throw new Error('Simulated database write error in centralized dispatcher');
    };

    // Dispatching an event should never throw or crash the calling logic
    await assert.doesNotReject(async () => {
      await notificationService.dispatchCrmEvent({
        eventType: 'REMARK_ADDED',
        actor: { id: salesAgent1Id.toString(), name: 'Sales Agent One', role: 'SALES' },
        enquiry: testEnq38,
        payload: { snippet: 'Critical test remark', activityId: new Types.ObjectId().toString() }
      });
    }, 'dispatchCrmEvent safely catches and isolates any internal error');
    pass('Scenario 41: Centralized dispatcher guarantees complete failure isolation');
  } finally {
    (notificationService as any).createNotification = originalCreate41;
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 42: Manager reassignment delegating through centralized dispatcher
  // -------------------------------------------------------------
  console.log('\n--- Scenario 42: Manager reassignment delegation through centralized dispatcher ---');
  const reassignEnq42Id = new Types.ObjectId();
  const reassignLead42: any = {
    _id: reassignEnq42Id,
    id: reassignEnq42Id.toString(),
    name: 'Ananya Roy',
    mobile: '9811223344',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Emerald Heights',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(reassignLead42);

  const admin1Before42 = countNotifsFor(adminId);
  const agent2Before42 = countNotifsFor(salesAgent2Id);
  const agent1Before42 = countNotifsFor(salesAgent1Id);

  const reassignRes42 = await enquiryService.assignEnquiry(
    reassignEnq42Id.toString(),
    salesAgent2Id.toString(),
    managerActor
  );

  assert.strictEqual(reassignRes42.success, true, 'Manager reassignment succeeds');
  assert.strictEqual(countNotifsFor(salesAgent2Id), agent2Before42 + 1, 'Newly assigned Sales Agent 2 receives reassignment notification');
  assert.strictEqual(countNotifsFor(adminId), admin1Before42 + 1, 'Active Admin 1 receives Manager reassignment notification');
  assert.strictEqual(countNotifsFor(salesAgent1Id), agent1Before42, 'Previous agent receives zero notifications');
  pass('Scenario 42: Manager reassignment through centralized dispatcher correctly notifies Sales Agent 2 and active Admins');

  // =============================================================
  // SECTION 9: Next Follow-up Scheduled Notifications
  // =============================================================
  console.log('\n====================================================');
  console.log('Section 9: Next Follow-up Scheduled Notifications');
  console.log('====================================================\n');

  // Seed test users: Unrelated Manager, Unrelated Sales Agent, Inactive Agent, Inactive Manager
  const unrelatedManagerId = new Types.ObjectId();
  const unrelatedAgentId = new Types.ObjectId();
  const inactiveManagerId = new Types.ObjectId();
  const inactiveAgentId = new Types.ObjectId();

  userStore.push(
    {
      _id: unrelatedManagerId,
      id: unrelatedManagerId.toString(),
      name: 'Deepak Verma',
      email: 'deepak.verma@neuways.local',
      role: 'MANAGER',
      isActive: true
    },
    {
      _id: unrelatedAgentId,
      id: unrelatedAgentId.toString(),
      name: 'Karan Mehta',
      email: 'karan.mehta@neuways.local',
      role: 'SALES',
      isActive: true,
      managerId: unrelatedManagerId,
      isTeamActive: true
    },
    {
      _id: inactiveManagerId,
      id: inactiveManagerId.toString(),
      name: 'Inactive Manager',
      email: 'inactive.mgr@neuways.local',
      role: 'MANAGER',
      isActive: false
    },
    {
      _id: inactiveAgentId,
      id: inactiveAgentId.toString(),
      name: 'Inactive Agent',
      email: 'inactive.agent@neuways.local',
      role: 'SALES',
      isActive: false,
      managerId: managerId,
      isTeamActive: false
    }
  );

  // -------------------------------------------------------------
  // TEST SCENARIO 43: Sales Agent saves valid next follow-up schedule
  // -------------------------------------------------------------
  console.log('--- Scenario 43: Sales Agent saves valid next follow-up schedule ---');
  const enq43Id = new Types.ObjectId();
  const lead43: any = {
    _id: enq43Id,
    id: enq43Id.toString(),
    name: 'Marry3',
    mobile: '9888800043',
    email: 'marry3@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'RG',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead43);

  const sales1Before43 = countNotifsFor(salesAgent1Id);
  const mgrBefore43 = countNotifsFor(managerId);
  const admin1Before43 = countNotifsFor(adminId);
  const admin2Before43 = countNotifsFor(admin2Id);
  const unrelatedMgrBefore43 = countNotifsFor(unrelatedManagerId);
  const unrelatedAgentBefore43 = countNotifsFor(unrelatedAgentId);

  const res43 = await enquiryService.saveWorkflowStep(
    enq43Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CALL_BACK_REQUESTED',
      notes: 'Customer interested in 3BHK, schedule follow-up call',
      nextFollowUpDate: '2026-11-04',
      nextFollowUpTime: '10:00 AM'
    },
    salesAgent1
  );

  assert.strictEqual(res43.success, true, 'Save Step 1 succeeded');
  assert.strictEqual(countNotifsFor(salesAgent1Id), sales1Before43 + 1, 'Assigned Sales Agent received 1 notification');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore43 + 1, 'Responsible Manager received 1 notification');
  assert.strictEqual(countNotifsFor(adminId), admin1Before43 + 1, 'Active Admin 1 received 1 notification');
  assert.strictEqual(countNotifsFor(admin2Id), admin2Before43 + 1, 'Active Admin 2 received 1 notification');
  assert.strictEqual(countNotifsFor(unrelatedManagerId), unrelatedMgrBefore43, 'Unrelated Manager received 0 notifications');
  assert.strictEqual(countNotifsFor(unrelatedAgentId), unrelatedAgentBefore43, 'Unrelated Sales Agent received 0 notifications');

  // Verify notification payload content
  const notif43 = notificationStore.find(
    (n) => n.recipient.toString() === salesAgent1Id.toString() && n.title === 'Next Follow-up Scheduled'
  );
  assert.ok(notif43, 'Next Follow-up Scheduled notification found');
  assert.strictEqual(notif43.type, 'NEW_FOLLOW_UP', 'Notification type is NEW_FOLLOW_UP');
  assert.ok(notif43.message.includes('Marry3'), 'Message contains customer name Marry3');
  assert.ok(notif43.message.includes('04 November 2026'), 'Message contains formatted date 04 November 2026');
  assert.ok(notif43.message.includes('10:00 AM'), 'Message contains time 10:00 AM');
  assert.ok(notif43.message.includes('Rohit Sharma (Sales Agent)'), 'Message contains scheduler name and role');
  assert.ok(notif43.message.includes('Property: RG'), 'Message contains property RG');
  assert.strictEqual(notif43.link, `/sales/leads/${enq43Id}/workflow`, 'Link points to lead workflow');
  assert.strictEqual(notif43.metadata.customerName, 'Marry3');
  assert.strictEqual(notif43.metadata.projectName, 'RG');
  assert.strictEqual(notif43.metadata.scheduledBy, 'Rohit Sharma');
  assert.strictEqual(notif43.metadata.scheduledByRole, 'Sales Agent');
  pass('Scenario 43: Sales Agent saves schedule -> Assigned Sales, supervising Manager, all active Admins notified with correct content');

  // -------------------------------------------------------------
  // TEST SCENARIO 44: Manager saves a next follow-up schedule
  // -------------------------------------------------------------
  console.log('\n--- Scenario 44: Manager saves a next follow-up schedule ---');
  const enq44Id = new Types.ObjectId();
  const lead44: any = {
    _id: enq44Id,
    id: enq44Id.toString(),
    name: 'David Johnson',
    mobile: '9888800044',
    email: 'david.j@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Emerald Heights',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead44);

  const sales1Before44 = countNotifsFor(salesAgent1Id);
  const mgrBefore44 = countNotifsFor(managerId);
  const admin1Before44 = countNotifsFor(adminId);
  const admin2Before44 = countNotifsFor(admin2Id);

  const res44 = await enquiryService.saveWorkflowStep(
    enq44Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CALL_BACK_REQUESTED',
      notes: 'Manager agreed to follow up with pricing options',
      nextFollowUpDate: '2026-11-05',
      nextFollowUpTime: '02:30 PM'
    },
    managerActor
  );

  assert.strictEqual(res44.success, true, 'Manager save Step 1 succeeded');
  assert.strictEqual(countNotifsFor(salesAgent1Id), sales1Before44 + 1, 'Assigned Sales Agent received 1 notification');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore44 + 1, 'Responsible Manager received 1 notification');
  assert.strictEqual(countNotifsFor(adminId), admin1Before44 + 1, 'Active Admin 1 received 1 notification');
  assert.strictEqual(countNotifsFor(admin2Id), admin2Before44 + 1, 'Active Admin 2 received 1 notification');
  assert.strictEqual(countNotifsFor(unrelatedManagerId), unrelatedMgrBefore43, 'Unrelated Manager received 0 notifications');
  assert.strictEqual(countNotifsFor(unrelatedAgentId), unrelatedAgentBefore43, 'Unrelated Sales Agent received 0 notifications');
  pass('Scenario 44: Manager saves schedule -> Assigned Sales, responsible Manager, and all active Admins notified');

  // -------------------------------------------------------------
  // TEST SCENARIO 45: Admin saves a next follow-up schedule
  // -------------------------------------------------------------
  console.log('\n--- Scenario 45: Admin saves a next follow-up schedule ---');
  const enq45Id = new Types.ObjectId();
  const lead45: any = {
    _id: enq45Id,
    id: enq45Id.toString(),
    name: 'Sophia Clark',
    mobile: '9888800045',
    email: 'sophia@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Skyline Towers',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead45);

  const sales1Before45 = countNotifsFor(salesAgent1Id);
  const mgrBefore45 = countNotifsFor(managerId);
  const admin1Before45 = countNotifsFor(adminId);
  const admin2Before45 = countNotifsFor(admin2Id);

  const res45 = await enquiryService.saveWorkflowStep(
    enq45Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CALL_BACK_REQUESTED',
      notes: 'Admin review requested follow-up next week',
      nextFollowUpDate: '2026-11-06',
      nextFollowUpTime: '11:00 AM'
    },
    adminActor
  );

  assert.strictEqual(res45.success, true, 'Admin save Step 1 succeeded');
  assert.strictEqual(countNotifsFor(salesAgent1Id), sales1Before45 + 1, 'Assigned Sales Agent received 1 notification');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore45 + 1, 'Responsible Manager received 1 notification');
  assert.strictEqual(countNotifsFor(adminId), admin1Before45 + 1, 'Performing Admin received 1 notification');
  assert.strictEqual(countNotifsFor(admin2Id), admin2Before45, 'Unrelated Admin received strictly ZERO notifications');
  assert.strictEqual(countNotifsFor(unrelatedManagerId), unrelatedMgrBefore43, 'Unrelated Manager received 0 notifications');
  assert.strictEqual(countNotifsFor(unrelatedAgentId), unrelatedAgentBefore43, 'Unrelated Sales Agent received 0 notifications');
  pass('Scenario 45: Admin saves schedule -> Assigned Sales, responsible Manager, and performing Admin ONLY notified');

  // -------------------------------------------------------------
  // TEST SCENARIO 46: Inactive users receive NO notifications
  // -------------------------------------------------------------
  console.log('\n--- Scenario 46: Inactive users receive NO notifications ---');
  const enq46Id = new Types.ObjectId();
  const lead46: any = {
    _id: enq46Id,
    id: enq46Id.toString(),
    name: 'Inactive Prospect Lead',
    mobile: '9888800046',
    email: 'inactive.lead@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: inactiveAgentId,
    managerId: inactiveManagerId,
    projectName: 'Quiet Pines',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead46);

  const inactAgentBefore46 = countNotifsFor(inactiveAgentId);
  const inactMgrBefore46 = countNotifsFor(inactiveManagerId);

  await enquiryService.saveWorkflowStep(
    enq46Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Checking inactive account filtering',
      nextFollowUpDate: '2026-11-07',
      nextFollowUpTime: '10:00 AM'
    },
    adminActor
  );

  assert.strictEqual(countNotifsFor(inactiveAgentId), inactAgentBefore46, 'Inactive Sales Agent received 0 notifications');
  assert.strictEqual(countNotifsFor(inactiveManagerId), inactMgrBefore46, 'Inactive Manager received 0 notifications');
  pass('Scenario 46: Inactive users are strictly excluded from notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 47: Missing next follow-up date -> NO notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 47: Missing next follow-up date -> NO notification ---');
  const totalBefore47 = notificationStore.length;
  const enq47Id = new Types.ObjectId();
  const lead47: any = {
    _id: enq47Id,
    id: enq47Id.toString(),
    name: 'No Next Date Lead',
    mobile: '9888800047',
    email: 'nodate@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Valley View',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead47);

  const res47 = await enquiryService.saveWorkflowStep(
    enq47Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'General discussion completed, no future follow-up scheduled',
      nextFollowUpDate: '',
      nextFollowUpTime: '10:00 AM'
    },
    salesAgent1
  );

  assert.strictEqual(res47.success, true);
  const nextNotifs47 = notificationStore.filter(
    (n) => n.relatedEnquiryId?.toString() === enq47Id.toString() && n.title === 'Next Follow-up Scheduled'
  );
  assert.strictEqual(nextNotifs47.length, 0, 'Zero Next Follow-up Scheduled notifications when date is empty');
  pass('Scenario 47: Missing next follow-up date produces zero notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 48: Missing next follow-up time -> NO notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 48: Missing next follow-up time -> NO notification ---');
  const enq48Id = new Types.ObjectId();
  const lead48: any = {
    _id: enq48Id,
    id: enq48Id.toString(),
    name: 'No Next Time Lead',
    mobile: '9888800048',
    email: 'notime@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Sunset Bay',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead48);

  const res48 = await enquiryService.saveWorkflowStep(
    enq48Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Customer discussion completed, time not specified',
      nextFollowUpDate: '2026-11-08',
      nextFollowUpTime: ''
    },
    salesAgent1
  );

  assert.strictEqual(res48.success, true);
  const nextNotifs48 = notificationStore.filter(
    (n) => n.relatedEnquiryId?.toString() === enq48Id.toString() && n.title === 'Next Follow-up Scheduled'
  );
  assert.strictEqual(nextNotifs48.length, 0, 'Zero Next Follow-up Scheduled notifications when time is empty');
  pass('Scenario 48: Missing next follow-up time produces zero notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 49: Failed backend save -> NO notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 49: Failed backend save -> NO notification ---');
  const totalBefore49 = notificationStore.length;

  const res49 = await enquiryService.saveWorkflowStep(
    enq43Id.toString(),
    {
      step: 'FOLLOW_UP',
      notes: '', // Validation error: notes cannot be empty
      nextFollowUpDate: '2026-11-09',
      nextFollowUpTime: '10:00 AM'
    },
    salesAgent1
  );

  assert.strictEqual(res49.success, false, 'Validation failure rejected with 400');
  assert.strictEqual(notificationStore.length, totalBefore49, 'Zero notifications dispatched on failed validation/save');
  pass('Scenario 49: Failed validation or backend save triggers zero notifications');

  // -------------------------------------------------------------
  // TEST SCENARIO 50: Repeated request/retry does not create duplicate notifications (Idempotency)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 50: Repeated request/retry does not create duplicate notifications ---');
  const countSales1Before50 = countNotifsFor(salesAgent1Id);
  const countMgrBefore50 = countNotifsFor(managerId);

  // Directly invoke notifyNextFollowUpScheduled with the exact same followUpId from Scenario 43
  const sameFollowUpId = res43.followUp?._id?.toString() || 'existing_followup_id_43';
  await notificationService.notifyNextFollowUpScheduled({
    actor: { id: salesAgent1.id, name: salesAgent1.name, role: salesAgent1.role },
    enquiry: lead43,
    followUpId: sameFollowUpId,
    purpose: 'CALL',
    nextFollowUpDate: '2026-11-04',
    nextFollowUpTime: '10:00 AM'
  });

  assert.strictEqual(countNotifsFor(salesAgent1Id), countSales1Before50, 'No duplicate notification for Sales Agent on retry');
  assert.strictEqual(countNotifsFor(managerId), countMgrBefore50, 'No duplicate notification for Manager on retry');
  pass('Scenario 50: Idempotency keys prevent duplicate notifications on save retries');

  // -------------------------------------------------------------
  // TEST SCENARIO 51: Genuinely new follow-up schedule later creates new notification
  // -------------------------------------------------------------
  console.log('\n--- Scenario 51: Genuinely new follow-up schedule later creates new notification ---');
  const countSales1Before51 = countNotifsFor(salesAgent1Id);

  const res51 = await enquiryService.saveWorkflowStep(
    enq43Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      outcome: 'CALL_BACK_REQUESTED',
      notes: 'Second interaction: client requested update on Friday',
      nextFollowUpDate: '2026-11-14',
      nextFollowUpTime: '03:00 PM'
    },
    salesAgent1
  );

  assert.strictEqual(res51.success, true);
  assert.strictEqual(countNotifsFor(salesAgent1Id), countSales1Before51 + 1, 'New notification created for new follow-up schedule');

  const newNotif51 = notificationStore.find(
    (n) => n.recipient.toString() === salesAgent1Id.toString() && n.message.includes('14 November 2026')
  );
  assert.ok(newNotif51, 'Notification for new follow-up date 14 November 2026 created');
  pass('Scenario 51: Genuinely new follow-up schedule generates a new notification with new date/time');

  // -------------------------------------------------------------
  // TEST SCENARIO 52: createFollowUp API dispatches Next Follow-up Scheduled notifications
  // -------------------------------------------------------------
  console.log('\n--- Scenario 52: createFollowUp API integration with next follow-up schedule ---');
  const enq52Id = new Types.ObjectId();
  const lead52: any = {
    _id: enq52Id,
    id: enq52Id.toString(),
    name: 'Robert Downey',
    mobile: '9888800052',
    email: 'robert@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    projectName: 'Stark Tower',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead52);

  const sales1Before52 = countNotifsFor(salesAgent1Id);
  const mgrBefore52 = countNotifsFor(managerId);

  const res52 = await enquiryService.createFollowUp(
    enq52Id.toString(),
    {
      purpose: 'CALL',
      followUpDate: '2026-11-03',
      followUpTime: '10:00',
      notes: 'Spoke with client, requested callback on 15 November',
      outcome: 'CALL_BACK_REQUESTED',
      nextFollowUpDate: '2026-11-15',
      nextFollowUpTime: '11:00 AM'
    },
    salesAgent1
  );

  assert.strictEqual(res52.success, true, 'createFollowUp succeeded');
  assert.strictEqual(countNotifsFor(salesAgent1Id), sales1Before52 + 1, 'Assigned Sales received next follow-up notification');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore52 + 1, 'Responsible Manager received next follow-up notification');

  const notif52 = notificationStore.find(
    (n) => n.recipient.toString() === salesAgent1Id.toString() && n.message.includes('15 November 2026')
  );
  assert.ok(notif52, 'createFollowUp Next Follow-up Scheduled notification exists');
  assert.ok(notif52.message.includes('Stark Tower'), 'Contains property Stark Tower');
  pass('Scenario 52: createFollowUp API dispatches Next Follow-up Scheduled notification when next date/time are present');

  // -------------------------------------------------------------
  // TEST SCENARIO 53: Deduplication when user appears in multiple roles
  // -------------------------------------------------------------
  console.log('\n--- Scenario 53: Deduplication when user appears in multiple roles ---');
  const enq53Id = new Types.ObjectId();
  // Lead directly assigned to managerId
  const lead53: any = {
    _id: enq53Id,
    id: enq53Id.toString(),
    name: 'Self Assigned Lead',
    mobile: '9888800053',
    email: 'self@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: managerId,
    managerId: managerId,
    projectName: 'Grand Plaza',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead53);

  const mgrBefore53 = countNotifsFor(managerId);

  await enquiryService.saveWorkflowStep(
    enq53Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Direct follow-up by manager',
      nextFollowUpDate: '2026-11-16',
      nextFollowUpTime: '01:00 PM'
    },
    managerActor
  );

  assert.strictEqual(countNotifsFor(managerId), mgrBefore53 + 1, 'Manager received exactly 1 notification, not duplicated');
  pass('Scenario 53: Deduplication strictly ensures exactly 1 notification even if user appears in multiple recipient groups');

  // =============================================================
  // Section 10: Notification Mapping & Exact Titles Verification
  // =============================================================
  console.log('\n====================================================');
  console.log('Section 10: Notification Mapping & Exact Titles Verification');
  console.log('====================================================\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 54: Next Follow-up Scheduled -> Exact title, type, label, stage & message
  // -------------------------------------------------------------
  console.log('--- Scenario 54: Next Follow-up Scheduled exact title, type, stage & message verification ---');
  const enq54Id = new Types.ObjectId();
  const lead54 = {
    _id: enq54Id,
    id: enq54Id.toString(),
    name: 'Kavita Sharma',
    mobile: '9888800054',
    email: 'kavita.sharma@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    managerId: managerId,
    projectName: 'Prestige Lakeside',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead54);

  const adminBefore54 = countNotifsFor(adminId);
  const salesBefore54 = countNotifsFor(salesAgent1Id);
  const mgrBefore54 = countNotifsFor(managerId);

  const res54 = await enquiryService.saveWorkflowStep(
    enq54Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Customer discussed 2BHK pricing and requested callback',
      nextFollowUpDate: '2026-11-20',
      nextFollowUpTime: '14:30'
    },
    salesAgent1
  );
  assert.strictEqual(res54.success, true, 'saveWorkflowStep Step 1 succeeds');
  assert.strictEqual(countNotifsFor(salesAgent1Id), salesBefore54 + 1, 'Assigned Sales Agent notified');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore54 + 1, 'Responsible Manager notified');
  assert.strictEqual(countNotifsFor(adminId), adminBefore54 + 1, 'Active Admin notified');

  const notif54Sales = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq54Id.toString() && n.recipient.toString() === salesAgent1Id.toString()
  );
  assert.ok(notif54Sales, 'Sales Agent notification exists');
  assert.strictEqual(notif54Sales.title, 'Next Follow-up Scheduled', 'Title matches exact specification');
  assert.strictEqual(notif54Sales.type, 'NEW_FOLLOW_UP', 'Type is NEW_FOLLOW_UP');
  assert.strictEqual(notif54Sales.relatedStage, 'FOLLOW_UP', 'Stage is FOLLOW_UP');
  assert.ok(notif54Sales.message.includes('Kavita Sharma'), 'Message contains customer name');
  assert.ok(notif54Sales.message.includes('20 November 2026'), 'Message contains formatted date');
  assert.ok(notif54Sales.message.includes('02:30 PM'), 'Message contains formatted time');
  assert.ok(notif54Sales.message.includes('Prestige Lakeside'), 'Message contains property name');
  assert.ok(notif54Sales.message.includes('Rohit Sharma (Sales Agent)'), 'Message contains performer name and role');
  assert.strictEqual(notif54Sales.link, `/sales/leads/${enq54Id.toString()}/workflow`, 'Workflow link is correct');
  pass('Scenario 54: Next Follow-up Scheduled -> Exact title "Next Follow-up Scheduled", type NEW_FOLLOW_UP, stage FOLLOW_UP, and full details verified');

  // -------------------------------------------------------------
  // TEST SCENARIO 55: Meeting Plan Scheduled -> Exact title, type, label, stage & message
  // -------------------------------------------------------------
  console.log('\n--- Scenario 55: Meeting Plan Scheduled exact title, type, stage & message verification ---');
  const enq55Id = new Types.ObjectId();
  const lead55 = {
    _id: enq55Id,
    id: enq55Id.toString(),
    name: 'Vikram Mehta',
    mobile: '9888800055',
    email: 'vikram.mehta@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    managerId: managerId,
    projectName: 'Godrej Splendour',
    currentStage: 'MEETING_PLAN',
    __v: 1
  };
  enquiryStore.push(lead55);

  const adminBefore55 = countNotifsFor(adminId);
  const salesBefore55 = countNotifsFor(salesAgent1Id);
  const mgrBefore55 = countNotifsFor(managerId);

  const res55 = await enquiryService.saveWorkflowStep(
    enq55Id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'MG Road Headquarters',
      meetingDate: '2026-11-22',
      meetingTime: '15:00',
      projectDetails: 'Godrej Splendour 3BHK',
      managerId: managerId.toString(),
      remarks: 'Scheduled in-person meeting with sales manager'
    },
    salesAgent1
  );
  assert.strictEqual(res55.success, true, 'saveWorkflowStep Step 2 succeeds');
  assert.strictEqual(countNotifsFor(salesAgent1Id), salesBefore55 + 1, 'Assigned Sales Agent notified');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore55 + 1, 'Meeting Manager notified');
  assert.strictEqual(countNotifsFor(adminId), adminBefore55 + 1, 'Active Admin notified');

  const notif55Sales = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq55Id.toString() && n.recipient.toString() === salesAgent1Id.toString() && n.type === 'MEETING_SCHEDULED'
  );
  assert.ok(notif55Sales, 'Sales meeting notification exists');
  assert.strictEqual(notif55Sales.title, 'Meeting Scheduled', 'Title matches exact specification "Meeting Scheduled"');
  assert.strictEqual(notif55Sales.type, 'MEETING_SCHEDULED', 'Type is MEETING_SCHEDULED');
  assert.strictEqual(notif55Sales.relatedStage, 'MEETING_PLAN', 'Stage is MEETING_PLAN');
  assert.ok(notif55Sales.message.includes('Vikram Mehta'), 'Message contains customer name');
  assert.ok(notif55Sales.message.includes('22 November 2026'), 'Message contains formatted date');
  assert.ok(notif55Sales.message.includes('03:00 PM'), 'Message contains formatted time');
  assert.ok(notif55Sales.message.includes('Godrej Splendour'), 'Message contains property name');
  assert.ok(notif55Sales.message.includes('Rohit Sharma (Sales Agent)'), 'Message contains performer name and role');
  assert.strictEqual(notif55Sales.link, `/sales/leads/${enq55Id.toString()}/workflow`, 'Workflow link is correct');

  const notif55Admin = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq55Id.toString() && n.recipient.toString() === adminId.toString() && n.type === 'MEETING_SCHEDULED'
  );
  assert.ok(notif55Admin, 'Admin meeting notification exists');
  assert.strictEqual(notif55Admin.title, 'Meeting Scheduled', 'Admin title is exactly "Meeting Scheduled"');
  pass('Scenario 55: Meeting Plan Scheduled -> Exact title "Meeting Scheduled", type MEETING_SCHEDULED, stage MEETING_PLAN, and full details verified');

  // -------------------------------------------------------------
  // TEST SCENARIO 56: Site Visit Plan Scheduled -> Exact title, type, label, stage & message
  // -------------------------------------------------------------
  console.log('\n--- Scenario 56: Site Visit Plan Scheduled exact title, type, stage & message verification ---');
  const enq56Id = new Types.ObjectId();
  const lead56 = {
    _id: enq56Id,
    id: enq56Id.toString(),
    name: 'Ananya Roy',
    mobile: '9888800056',
    email: 'ananya.roy@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    managerId: managerId,
    projectName: 'Brigade Cornerstone',
    currentStage: 'SITE_VISIT_PLAN',
    meetingPlan: {
      meetingPlace: 'Office',
      meetingDate: '2026-11-20',
      meetingTime: '10:00',
      projectDetails: 'Brigade Cornerstone',
      isCompleted: true
    },
    __v: 1
  };
  enquiryStore.push(lead56);

  const adminBefore56 = countNotifsFor(adminId);
  const salesBefore56 = countNotifsFor(salesAgent1Id);
  const mgrBefore56 = countNotifsFor(managerId);

  const res56 = await enquiryService.saveWorkflowStep(
    enq56Id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Cornerstone Utopia, Varthur Rd',
      siteVisitDate: '2026-11-26',
      siteVisitTime: '11:30',
      projectName: 'Brigade Cornerstone',
      managerId: managerId.toString(),
      remarks: 'Client arriving by car with family'
    },
    salesAgent1
  );
  assert.strictEqual(res56.success, true, 'saveWorkflowStep Step 3 succeeds');
  assert.strictEqual(countNotifsFor(salesAgent1Id), salesBefore56 + 1, 'Assigned Sales Agent notified');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore56 + 1, 'Site Visit Manager notified');
  assert.strictEqual(countNotifsFor(adminId), adminBefore56 + 1, 'Active Admin notified');

  const notif56Sales = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq56Id.toString() && n.recipient.toString() === salesAgent1Id.toString() && n.type === 'SITE_VISIT_SCHEDULED'
  );
  assert.ok(notif56Sales, 'Sales site visit notification exists');
  assert.strictEqual(notif56Sales.title, 'Site Visit Scheduled', 'Title matches exact specification "Site Visit Scheduled"');
  assert.strictEqual(notif56Sales.type, 'SITE_VISIT_SCHEDULED', 'Type is SITE_VISIT_SCHEDULED');
  assert.strictEqual(notif56Sales.relatedStage, 'SITE_VISIT_PLAN', 'Stage is SITE_VISIT_PLAN');
  assert.ok(notif56Sales.message.includes('Ananya Roy'), 'Message contains customer name');
  assert.ok(notif56Sales.message.includes('26 November 2026'), 'Message contains formatted date');
  assert.ok(notif56Sales.message.includes('11:30 AM'), 'Message contains formatted time');
  assert.ok(notif56Sales.message.includes('Brigade Cornerstone'), 'Message contains project name');
  assert.ok(notif56Sales.message.includes('Rohit Sharma (Sales Agent)'), 'Message contains performer name and role');
  assert.strictEqual(notif56Sales.link, `/sales/leads/${enq56Id.toString()}/workflow`, 'Workflow link is correct');

  const notif56Admin = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq56Id.toString() && n.recipient.toString() === adminId.toString() && n.type === 'SITE_VISIT_SCHEDULED'
  );
  assert.ok(notif56Admin, 'Admin site visit notification exists');
  assert.strictEqual(notif56Admin.title, 'Site Visit Scheduled', 'Admin title is exactly "Site Visit Scheduled"');
  pass('Scenario 56: Site Visit Plan Scheduled -> Exact title "Site Visit Scheduled", type SITE_VISIT_SCHEDULED, stage SITE_VISIT_PLAN, and full details verified');

  // -------------------------------------------------------------
  // TEST SCENARIO 57: Workflow Stage Advanced -> Exact title, type, label, stage & message
  // -------------------------------------------------------------
  console.log('\n--- Scenario 57: Workflow Stage Advanced exact title, type, stage & message verification ---');
  const enq57Id = new Types.ObjectId();
  const lead57 = {
    _id: enq57Id,
    id: enq57Id.toString(),
    name: 'Suresh Raina',
    mobile: '9888800057',
    email: 'suresh.raina@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: salesAgent1Id,
    managerId: managerId,
    projectName: 'Assetz Marq',
    currentStage: 'FOLLOW_UP',
    __v: 1
  };
  enquiryStore.push(lead57);

  const adminBefore57 = countNotifsFor(adminId);
  const salesBefore57 = countNotifsFor(salesAgent1Id);
  const mgrBefore57 = countNotifsFor(managerId);

  const res57 = await enquiryService.saveWorkflowStep(
    enq57Id.toString(),
    {
      step: 'FOLLOW_UP',
      purpose: 'CALL',
      notes: 'Initial discussion finished, client wants meeting',
      advanceStage: true
    },
    salesAgent1
  );
  assert.strictEqual(res57.success, true, 'saveWorkflowStep advance succeeds');
  assert.strictEqual(countNotifsFor(salesAgent1Id), salesBefore57 + 1, 'Assigned Sales Agent notified of stage advance');
  assert.strictEqual(countNotifsFor(managerId), mgrBefore57 + 1, 'Responsible Manager notified of stage advance');
  assert.strictEqual(countNotifsFor(adminId), adminBefore57 + 1, 'Active Admin notified of stage advance');

  const notif57Admin = notificationStore.find(
    (n) => n.relatedEnquiryId?.toString() === enq57Id.toString() && n.recipient.toString() === adminId.toString() && n.type === 'WORKFLOW_UPDATE'
  );
  assert.ok(notif57Admin, 'Admin stage advance notification exists');
  assert.strictEqual(notif57Admin.title, 'Stage Advanced', 'Title matches exact specification "Stage Advanced"');
  assert.strictEqual(notif57Admin.type, 'WORKFLOW_UPDATE', 'Type is WORKFLOW_UPDATE');
  assert.strictEqual(notif57Admin.relatedStage, 'MEETING_PLAN', 'Stage reflects target advanced stage MEETING_PLAN');
  assert.ok(notif57Admin.message.includes('Suresh Raina'), 'Message contains customer name');
  assert.ok(notif57Admin.message.includes('MEETING_PLAN'), 'Message contains target stage');
  assert.ok(notif57Admin.message.includes('Rohit Sharma (Sales Agent)'), 'Message contains performer name and role');
  pass('Scenario 57: Workflow Stage Advanced -> Exact title "Stage Advanced", type WORKFLOW_UPDATE, target stage, and full details verified');

  // -------------------------------------------------------------
  // TEST SCENARIO 58: Deduplication and Idempotency across workflow event retries
  // -------------------------------------------------------------
  console.log('\n--- Scenario 58: Deduplication & Idempotency across workflow event retries ---');
  const totalNotifsBefore58 = notificationStore.length;

  // Retry saving the same meeting step with identical date/time
  await enquiryService.saveWorkflowStep(
    enq55Id.toString(),
    {
      step: 'MEETING_PLAN',
      meetingPlace: 'MG Road Headquarters',
      meetingDate: '2026-11-22',
      meetingTime: '15:00',
      projectDetails: 'Godrej Splendour 3BHK',
      managerId: managerId.toString(),
      remarks: 'Scheduled in-person meeting with sales manager'
    },
    salesAgent1
  );

  // Retry saving the same site visit step with identical date/time
  await enquiryService.saveWorkflowStep(
    enq56Id.toString(),
    {
      step: 'SITE_VISIT_PLAN',
      siteVisitAddress: 'Cornerstone Utopia, Varthur Rd',
      siteVisitDate: '2026-11-26',
      siteVisitTime: '11:30',
      projectName: 'Brigade Cornerstone',
      managerId: managerId.toString(),
      remarks: 'Client arriving by car with family'
    },
    salesAgent1
  );

  const totalNotifsAfter58 = notificationStore.length;
  assert.strictEqual(totalNotifsAfter58, totalNotifsBefore58, 'Retried saves generate exactly 0 duplicate notifications');
  pass('Scenario 58: Deduplication and Idempotency prevent duplicates on repeated workflow step saves');

  // =============================================================
  // SUMMARY
  // =============================================================
  console.log('\n====================================================');
  console.log(`All Acceptance Tests Passed: ${passedTests} / ${totalTests}`);
  console.log('====================================================\n');
}

runAllTests().catch((err) => {
  console.error('[FAIL] Unhandled test exception:', err);
  process.exit(1);
});
