/**
 * Neuways CRM - Admin Dashboard & Employee Management RBAC Test Suite
 *
 * Verifies:
 * 1. Admin can list all employees, with manager population.
 * 2. Admin can create Manager and Sales accounts, assigning Sales agents to Managers.
 * 3. Admin can update permitted employee details (name, role, assigned manager, temporary password).
 * 4. Non-ADMIN (SALES, MANAGER) access is strictly forbidden (HTTP 403).
 * 5. Deactivation preserves employee records, and deactivated agents are excluded from Round Robin.
 * 6. getDashboardSummary provides organization-wide stage breakdown and completed deal counts.
 */

import mongoose, { Types } from 'mongoose';
import { User, IUser } from '../models/user.model.js';
import { Enquiry } from '../models/enquiry.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { userService } from '../services/user.service.js';
import { enquiryService } from '../services/enquiry.service.js';
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

async function runAdminDashboardTests() {
  console.log('====================================================');
  console.log('Starting Admin Dashboard & Employee Management Test Suite');
  console.log('====================================================\n');

  (mongoose.connection as any).readyState = 1;

  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin.super@neuways.com',
    role: 'ADMIN',
    name: 'Super Admin'
  };

  const salesActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'sales.agent@neuways.com',
    role: 'SALES',
    name: 'Sales Agent'
  };

  const managerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'team.lead@neuways.com',
    role: 'MANAGER',
    name: 'Team Manager'
  };

  // In-memory test store
  const userStore: any[] = [];
  const enquiryStore: any[] = [];

  // Mock User.find
  (User as any).find = function (filter: any) {
    let result = [...userStore];
    if (filter) {
      if (filter.role) result = result.filter(u => u.role === filter.role);
      if (filter.isActive !== undefined) result = result.filter(u => u.isActive === filter.isActive);
    }
    const chain: any = {
      populate: (field: string) => {
        if (field === 'managerId') {
          result = result.map(u => {
            if (u.managerId) {
              const mgr = userStore.find(m => m._id.toString() === u.managerId.toString());
              return { ...u, managerId: mgr || u.managerId };
            }
            return u;
          });
        }
        return chain;
      },
      select: () => chain,
      sort: () => chain,
      lean: async () => result,
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };

  (User as any).findOne = async function (filter: any) {
    if (filter.email) {
      return userStore.find(u => u.email === filter.email) || null;
    }
    if (filter._id) {
      const match = userStore.find(u => u._id.toString() === filter._id.toString());
      if (filter.role && match && match.role !== filter.role) return null;
      return match || null;
    }
    return null;
  };

  (User as any).findById = function (id: any) {
    const target = userStore.find(u => u._id.toString() === id.toString()) || null;
    const chain: any = {
      populate: (field: string) => {
        if (target && target.managerId) {
          const mgr = userStore.find(m => m._id.toString() === target.managerId.toString());
          if (mgr) {
            target.managerId = mgr;
          }
        }
        return Promise.resolve(target);
      },
      select: () => Promise.resolve(target),
      then: (fn: any) => Promise.resolve(target).then(fn)
    };
    return chain;
  };

  User.prototype.save = async function (this: any) {
    const existingIdx = userStore.findIndex(u => u._id.toString() === this._id.toString());
    if (existingIdx !== -1) {
      userStore[existingIdx] = this;
    } else {
      userStore.push(this);
    }
    return this;
  };

  // Mock Enquiry.countDocuments
  (Enquiry as any).countDocuments = async function (filter: any) {
    let matches = [...enquiryStore];
    if (filter) {
      if (filter.status) matches = matches.filter(e => e.status === filter.status);
      if (filter.currentStage && filter.currentStage.$in) {
        matches = matches.filter(e => filter.currentStage.$in.includes(e.currentStage));
      } else if (filter.currentStage && filter.currentStage.$ne) {
        matches = matches.filter(e => e.currentStage !== filter.currentStage.$ne);
      }
      if (filter['dealDone.isConfirmed'] === true) {
        matches = matches.filter(e => e.dealDone?.isConfirmed === true);
      } else if (filter['dealDone.isConfirmed'] && filter['dealDone.isConfirmed'].$ne === true) {
        matches = matches.filter(e => e.dealDone?.isConfirmed !== true);
      }
    }
    return matches.length;
  };

  (Enquiry as any).find = function () {
    const chain: any = {
      select: () => chain,
      sort: () => chain,
      lean: async () => [...enquiryStore],
      then: (fn: any) => Promise.resolve([...enquiryStore]).then(fn)
    };
    return chain;
  };

  (FollowUpTask as any).find = function () {
    const chain: any = {
      sort: () => chain,
      populate: () => ({
        sort: () => ({ lean: async () => [] }),
        lean: async () => []
      })
    };
    return chain;
  };

  (FollowUpTask as any).countDocuments = async function () {
    return 0;
  };

  (enquiryService as any).ensureInitialTasksForActiveEnquiries = async function () {};

  // --- Suite 1: RBAC Enforcement ---
  console.log('--- Suite 1: RBAC Enforcement for Employee Management ---');
  try {
    await userService.createEmployee({
      name: 'Unauthorized User',
      email: 'unauth@neuways.com',
      role: 'SALES',
      temporaryPassword: 'Password123!'
    }, salesActor);
    assert(false, 'Sales agent should NOT be permitted to create employees');
  } catch (err: any) {
    assert(err.statusCode === 403, 'Sales agent creating employee receives HTTP 403 Forbidden');
  }

  try {
    await userService.createEmployee({
      name: 'Manager Attempt',
      email: 'mgr.attempt@neuways.com',
      role: 'SALES',
      temporaryPassword: 'Password123!'
    }, managerActor);
    assert(false, 'Manager should NOT be permitted to create employees');
  } catch (err: any) {
    assert(err.statusCode === 403, 'Manager creating employee receives HTTP 403 Forbidden');
  }

  try {
    await userService.updateEmployeeStatus(salesActor.id, false, salesActor);
    assert(false, 'Sales agent should NOT be permitted to update employee status');
  } catch (err: any) {
    assert(err.statusCode === 403, 'Sales agent updating employee status receives HTTP 403 Forbidden');
  }

  try {
    await userService.updateEmployee(salesActor.id, { name: 'New Name' }, salesActor);
    assert(false, 'Sales agent should NOT be permitted to update employee details');
  } catch (err: any) {
    assert(err.statusCode === 403, 'Sales agent updating employee details receives HTTP 403 Forbidden');
  }

  // --- Suite 2: Employee Provisioning & Manager Assignment ---
  console.log('\n--- Suite 2: Employee Provisioning & Manager Assignment ---');
  const managerDoc = new User({
    _id: new Types.ObjectId(),
    name: 'Regional Sales Manager',
    email: 'manager.regional@neuways.com',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
    role: 'MANAGER',
    isActive: true
  });
  await managerDoc.save();
  assert(Boolean(managerDoc._id), 'Manager account seeded successfully');

  // Admin provisions Sales agent assigned to this Manager
  const agentEmail = 'sales.rep@neuways.com';
  const createdAgent = await userService.createEmployee({
    name: 'Junior Sales Rep',
    email: agentEmail,
    role: 'SALES',
    temporaryPassword: 'ValidTempPass123!',
    managerId: managerDoc._id.toString()
  }, adminActor);

  assert(createdAgent.role === 'SALES', 'Created agent has role SALES');
  assert(createdAgent.managerId === managerDoc._id.toString(), 'Created agent is assigned to Manager');
  assert(createdAgent.managerName === managerDoc.name, 'Manager name is populated');
  assert(createdAgent.isActive === true, 'Created agent is active by default');

  // --- Suite 3: Editing Permitted Employee Details ---
  console.log('\n--- Suite 3: Editing Permitted Employee Details ---');
  const updatedAgent = await userService.updateEmployee(createdAgent.id, {
    name: 'Senior Sales Representative',
    temporaryPassword: 'NewUpdatedPassword123!'
  }, adminActor);

  assert(updatedAgent.name === 'Senior Sales Representative', 'Employee name updated successfully');
  assert(updatedAgent.mustChangePassword === true, 'mustChangePassword flag is set on password reset');

  // Create another manager to reassign
  const managerDoc2 = new User({
    _id: new Types.ObjectId(),
    name: 'Enterprise Division Manager',
    email: 'mgr2.division@neuways.com',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
    role: 'MANAGER',
    isActive: true
  });
  await managerDoc2.save();

  const reassignedAgent = await userService.updateEmployee(createdAgent.id, {
    managerId: managerDoc2._id.toString()
  }, adminActor);

  assert(reassignedAgent.managerId === managerDoc2._id.toString(), 'Sales agent reassigned to new Manager');
  assert(reassignedAgent.managerName === 'Enterprise Division Manager', 'Populated manager name reflects update');

  // Admin protection: Cannot demote Admin account
  const adminDoc = new User({
    _id: new Types.ObjectId(),
    name: 'Executive Admin Account',
    email: 'admin.protected@neuways.com',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
    role: 'ADMIN',
    isActive: true
  });
  await adminDoc.save();

  try {
    await userService.updateEmployee(adminDoc._id.toString(), {
      role: 'SALES'
    }, adminActor);
    assert(false, 'Admin account should not be demotable');
  } catch (err: any) {
    assert(err.statusCode === 400, 'Attempting to demote Admin receives HTTP 400 Bad Request');
  }

  // --- Suite 4: Deactivation, Invariant Retention & Round Robin Exclusion ---
  console.log('\n--- Suite 4: Deactivation, Invariant Retention & Round Robin Exclusion ---');
  // Deactivate agent
  const deactivated = await userService.updateEmployeeStatus(createdAgent.id, false, adminActor);
  assert(deactivated.isActive === false, 'Agent account deactivated successfully');

  // Invariant check: Record still exists in database
  const foundUser = await User.findById(createdAgent.id);
  assert(Boolean(foundUser), 'Deactivated employee record is preserved in database');
  assert(foundUser?.email === agentEmail, 'Email preserved upon deactivation');

  // Invariant check: Round robin query excludes deactivated agent
  const eligibleAgents = await User.find({ role: 'SALES', isActive: true });
  const includesDeactivated = eligibleAgents.some((a: any) => a._id.toString() === createdAgent.id);
  assert(!includesDeactivated, 'Deactivated sales agent is excluded from Round Robin eligibility');

  // Reactivate agent
  const reactivated = await userService.updateEmployeeStatus(createdAgent.id, true, adminActor);
  assert(reactivated.isActive === true, 'Agent account reactivated successfully');

  // --- Suite 5: Organization-Wide Overview Metrics & Stage Grouping ---
  console.log('\n--- Suite 5: Organization-Wide Overview Metrics & Stage Grouping ---');
  enquiryStore.push(
    { _id: new Types.ObjectId(), currentStage: '01. Follow-up', status: 'ACTIVE' },
    { _id: new Types.ObjectId(), currentStage: '02. Meeting Plan', status: 'ACTIVE' },
    { _id: new Types.ObjectId(), currentStage: '03. Site Visit Plan', status: 'ACTIVE' },
    { _id: new Types.ObjectId(), currentStage: '04. Deal Done', status: 'ACTIVE', dealDone: { isConfirmed: true } }
  );

  const summaryRes = await enquiryService.getDashboardSummary(adminActor);
  assert(summaryRes.success === true, 'getDashboardSummary returns success: true for ADMIN');
  assert(typeof summaryRes.data?.activePipelineCount === 'number', 'Summary contains activePipelineCount');
  assert(typeof summaryRes.data?.pendingFollowUpsCount === 'number', 'Summary contains pendingFollowUpsCount');
  assert(typeof summaryRes.data?.futureFollowUpsCount === 'number', 'Summary contains futureFollowUpsCount');
  assert(typeof summaryRes.data?.completedDealsCount === 'number', 'Summary contains completedDealsCount');
  assert(typeof summaryRes.data?.stageBreakdown?.followUp === 'number', 'Summary contains stageBreakdown.followUp');
  assert(typeof summaryRes.data?.stageBreakdown?.meetingPlan === 'number', 'Summary contains stageBreakdown.meetingPlan');
  assert(typeof summaryRes.data?.stageBreakdown?.siteVisitPlan === 'number', 'Summary contains stageBreakdown.siteVisitPlan');
  assert(typeof summaryRes.data?.stageBreakdown?.dealDone === 'number', 'Summary contains stageBreakdown.dealDone');

  console.log(`\n====================================================`);
  console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log(`====================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdminDashboardTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
