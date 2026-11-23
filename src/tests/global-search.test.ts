/**
 * Neuways CRM - Global Search and Role-Based Scoping Test Suite
 *
 * Verifies:
 * 1. Search Query Capabilities:
 *    - Search by customer name (case-insensitive substring)
 *    - Search by phone number (exact, substring, and formatted with + / hyphens)
 *    - Search by property/project name (projectName, dealDone.project, meetingPlan, siteVisitPlan)
 * 2. Role-Based Permissions & Isolation:
 *    - SALES agent sees ONLY leads assigned to their own user ID
 *    - MANAGER sees ONLY leads assigned to themselves and their team members (managerId)
 *    - ADMIN sees organization-wide permitted leads
 * 3. Security & Input Sanitization:
 *    - Regex special characters (+, [, ], *, ?, (, )) do not crash backend or throw SyntaxError
 *    - Single enquiry access control (getEnquiryById) strictly enforces Sales and Manager ownership
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { User } from '../models/user.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
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

async function runGlobalSearchTests() {
  (mongoose.connection as any).readyState = 1;

  // Mock FollowUpTask.find
  (FollowUpTask as any).find = function () {
    const chain: any = {
      sort: () => Promise.resolve([])
    };
    return chain;
  };
  console.log('====================================================');
  console.log('Starting Global CRM Search & Scoping Test Suite');
  console.log('====================================================\n');

  // Setup actors
  const adminActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin@neuways.com',
    role: 'ADMIN',
    name: 'Admin User'
  };

  const managerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'manager.vikram@neuways.local',
    role: 'MANAGER',
    name: 'Vikram Manager'
  };

  const otherManagerActor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'other.manager@neuways.local',
    role: 'MANAGER',
    name: 'Other Manager'
  };

  const agent1Actor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent1@neuways.local',
    role: 'SALES',
    name: 'Sales Agent 1 (Under Vikram)'
  };

  const agent2Actor: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'agent2@neuways.local',
    role: 'SALES',
    name: 'Sales Agent 2 (Under Other Manager)'
  };

  // Mock User store
  const userStore = [
    {
      _id: new Types.ObjectId(adminActor.id),
      name: adminActor.name,
      email: adminActor.email,
      role: 'ADMIN',
      isActive: true
    },
    {
      _id: new Types.ObjectId(managerActor.id),
      name: managerActor.name,
      email: managerActor.email,
      role: 'MANAGER',
      isActive: true
    },
    {
      _id: new Types.ObjectId(otherManagerActor.id),
      name: otherManagerActor.name,
      email: otherManagerActor.email,
      role: 'MANAGER',
      isActive: true
    },
    {
      _id: new Types.ObjectId(agent1Actor.id),
      name: agent1Actor.name,
      email: agent1Actor.email,
      role: 'SALES',
      managerId: new Types.ObjectId(managerActor.id),
      isActive: true
    },
    {
      _id: new Types.ObjectId(agent2Actor.id),
      name: agent2Actor.name,
      email: agent2Actor.email,
      role: 'SALES',
      managerId: new Types.ObjectId(otherManagerActor.id),
      isActive: true
    }
  ];

  // Mock Enquiry store
  const enquiryStore = [
    {
      _id: new Types.ObjectId(),
      name: 'Ananya Sharma',
      mobile: '+919876543210',
      normalizedMobile: '9876543210',
      email: 'ananya@gmail.com',
      projectName: 'Prestige Lakeside Habitat',
      status: 'ACTIVE',
      currentStage: 'FOLLOW_UP',
      assignedTo: new Types.ObjectId(agent1Actor.id),
      createdAt: new Date()
    },
    {
      _id: new Types.ObjectId(),
      name: 'Rohan Verma',
      mobile: '9820011223',
      normalizedMobile: '9820011223',
      email: 'rohan@yahoo.com',
      projectName: 'Sobha Dream Acres',
      status: 'ACTIVE',
      currentStage: 'MEETING_PLAN',
      assignedTo: new Types.ObjectId(agent2Actor.id),
      createdAt: new Date()
    },
    {
      _id: new Types.ObjectId(),
      name: 'Sunil Kumar',
      mobile: '9845012345',
      normalizedMobile: '9845012345',
      email: 'sunil@outlook.com',
      status: 'ACTIVE',
      currentStage: 'DEAL_DONE',
      dealDone: {
        isConfirmed: true,
        project: 'Brigade Gateway',
        propertyType: '3 BHK Luxury',
        price: 15000000
      },
      assignedTo: new Types.ObjectId(agent1Actor.id),
      createdAt: new Date()
    },
    {
      _id: new Types.ObjectId(),
      name: 'Kavita Reddy',
      mobile: '9811122334',
      normalizedMobile: '9811122334',
      email: 'kavita@domain.com',
      projectName: 'Godrej Woods',
      status: 'ACTIVE',
      currentStage: 'SITE_VISIT_PLAN',
      assignedTo: new Types.ObjectId(managerActor.id),
      createdAt: new Date()
    }
  ];

  // Mock User.find and User.findById
  (User as any).find = function (filter: any) {
    let result = [...userStore];
    if (filter && filter.managerId) {
      result = result.filter(
        (u) => u.managerId && u.managerId.toString() === filter.managerId.toString()
      );
    }
    const chain: any = {
      select: () => chain,
      lean: () => Promise.resolve(result),
      then: (res: any) => res(result)
    };
    return chain;
  };

  (User as any).findById = function (id: any) {
    const user = userStore.find((u) => u._id.toString() === id.toString());
    const chain: any = {
      select: () => chain,
      then: (res: any) => res(user || null)
    };
    return chain;
  };

  // Mock Enquiry.find and Enquiry.countDocuments
  (Enquiry as any).find = function (filter: any) {
    let result = [...enquiryStore];

    if (filter) {
      if (filter.status) {
        result = result.filter((e) => e.status === filter.status);
      }
      if (filter.assignedTo) {
        if (filter.assignedTo.$in) {
          const allowedStr = filter.assignedTo.$in.map((id: any) => id.toString());
          result = result.filter(
            (e) => e.assignedTo && allowedStr.includes(e.assignedTo.toString())
          );
        } else {
          result = result.filter(
            (e) => e.assignedTo && e.assignedTo.toString() === filter.assignedTo.toString()
          );
        }
      }
      if (filter['dealDone.isConfirmed'] && filter['dealDone.isConfirmed'].$ne !== undefined) {
        result = result.filter((e) => e.dealDone?.isConfirmed !== filter['dealDone.isConfirmed'].$ne);
      } else if (filter['dealDone.isConfirmed'] === true) {
        result = result.filter((e) => e.dealDone?.isConfirmed === true);
      }
      if (filter.currentStage && filter.currentStage.$ne !== undefined) {
        result = result.filter((e) => e.currentStage !== filter.currentStage.$ne);
      } else if (filter.currentStage) {
        result = result.filter((e) => e.currentStage === filter.currentStage);
      }

      if (filter.$or && Array.isArray(filter.$or)) {
        result = result.filter((e) =>
          filter.$or.some((cond: any) => {
            if (cond.name && cond.name.test && cond.name.test(e.name || '')) return true;
            if (cond.mobile && cond.mobile.test && cond.mobile.test(e.mobile || '')) return true;
            if (cond.normalizedMobile && cond.normalizedMobile.test && cond.normalizedMobile.test(e.normalizedMobile || '')) return true;
            if (cond.projectName && cond.projectName.test && cond.projectName.test(e.projectName || '')) return true;
            if (cond.email && cond.email.test && cond.email.test(e.email || '')) return true;
            if (cond['dealDone.project'] && cond['dealDone.project'].test && cond['dealDone.project'].test(e.dealDone?.project || '')) return true;
            return false;
          })
        );
      }
    }

    const chain: any = {
      populate: () => chain,
      sort: () => chain,
      skip: (s: number) => {
        result = result.slice(s);
        return chain;
      },
      limit: (l: number) => {
        result = result.slice(0, l);
        return chain;
      },
      then: (res: any) => res(result)
    };
    return chain;
  };

  (Enquiry as any).countDocuments = function (filter: any) {
    const chain: any = (Enquiry as any).find(filter);
    return {
      then: async (res: any) => {
        const items = await chain;
        return res(items.length);
      }
    };
  };

  (Enquiry as any).findById = function (id: any) {
    const enq = enquiryStore.find((e) => e._id.toString() === id.toString());
    const chain: any = {
      populate: () => chain,
      then: (res: any) => res(enq || null)
    };
    return chain;
  };

  // -------------------------------------------------------------
  // Suite 1: Text Search Across Fields
  // -------------------------------------------------------------
  console.log('--- Suite 1: Query Capabilities (Name, Phone, Project) ---');

  // Search by customer name
  const nameSearch = await enquiryService.listEnquiries(
    { search: 'Ananya', excludeCompletedDeals: false },
    adminActor
  );
  assert(nameSearch.success === true, 'Search by customer name succeeds');
  assert(nameSearch.enquiries.length === 1, 'Returns exactly 1 matching customer');
  assert(nameSearch.enquiries[0].name === 'Ananya Sharma', 'Matched expected customer Ananya Sharma');

  // Search by phone number with formatting
  const phoneSearch = await enquiryService.listEnquiries(
    { search: '9876543210', excludeCompletedDeals: false },
    adminActor
  );
  assert(phoneSearch.success === true, 'Search by raw 10-digit phone number succeeds');
  assert(phoneSearch.enquiries.length === 1, 'Returns phone match');
  assert(phoneSearch.enquiries[0].mobile === '+919876543210', 'Correctly matches lead with +91 prefix');

  // Search with regex special characters like '+' and '()'
  const specialCharSearch = await enquiryService.listEnquiries(
    { search: '+91 (98765)', excludeCompletedDeals: false },
    adminActor
  );
  assert(specialCharSearch.success === true, 'Search query with special characters (+, parentheses) succeeds without regex crash');
  assert(specialCharSearch.enquiries.length === 1, 'Matches digits from formatted phone input');

  // Search by project name
  const projectSearch = await enquiryService.listEnquiries(
    { search: 'Sobha', excludeCompletedDeals: false },
    adminActor
  );
  assert(projectSearch.success === true, 'Search by project name succeeds');
  assert(projectSearch.enquiries.length === 1, 'Returns matching project lead');
  assert(projectSearch.enquiries[0].projectName === 'Sobha Dream Acres', 'Matched Sobha Dream Acres');

  // Search by completed deal property
  const completedDealSearch = await enquiryService.listEnquiries(
    { search: 'Brigade Gateway', excludeCompletedDeals: false },
    adminActor
  );
  assert(completedDealSearch.success === true, 'Search matches property name inside confirmed deal');
  assert(completedDealSearch.enquiries.length === 1, 'Found completed deal with Brigade Gateway');
  assert(completedDealSearch.enquiries[0].name === 'Sunil Kumar', 'Matched customer Sunil Kumar');

  // -------------------------------------------------------------
  // Suite 2: Role-Based Access Scoping & Isolation
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Role Scoping (Sales vs Manager vs Admin) ---');

  // Sales Agent 1 search
  const agent1All = await enquiryService.listEnquiries(
    { search: 'a', excludeCompletedDeals: false },
    agent1Actor
  );
  assert(agent1All.success === true, 'Sales Agent 1 search succeeds');
  const agent1LeadNames = agent1All.enquiries.map((e) => e.name);
  assert(
    agent1LeadNames.includes('Ananya Sharma') && agent1LeadNames.includes('Sunil Kumar'),
    'Agent 1 sees their assigned leads (Ananya Sharma & Sunil Kumar)'
  );
  assert(
    !agent1LeadNames.includes('Rohan Verma'),
    'Agent 1 CANNOT see Rohan Verma (assigned to Agent 2)'
  );
  assert(
    !agent1LeadNames.includes('Kavita Reddy'),
    'Agent 1 CANNOT see Kavita Reddy (assigned to Manager)'
  );

  // Sales Agent 2 search
  const agent2All = await enquiryService.listEnquiries(
    { search: 'a', excludeCompletedDeals: false },
    agent2Actor
  );
  const agent2LeadNames = agent2All.enquiries.map((e) => e.name);
  assert(
    agent2LeadNames.includes('Rohan Verma'),
    'Agent 2 sees their own assigned lead Rohan Verma'
  );
  assert(
    !agent2LeadNames.includes('Ananya Sharma'),
    'Agent 2 CANNOT see Agent 1 assigned lead Ananya Sharma'
  );

  // Manager Vikram search (manages Agent 1 + has Kavita Reddy directly assigned)
  const managerSearch = await enquiryService.listEnquiries(
    { search: 'a', excludeCompletedDeals: false },
    managerActor
  );
  assert(managerSearch.success === true, 'Manager Vikram search succeeds');
  const managerLeadNames = managerSearch.enquiries.map((e) => e.name);
  assert(
    managerLeadNames.includes('Ananya Sharma') &&
    managerLeadNames.includes('Sunil Kumar') &&
    managerLeadNames.includes('Kavita Reddy'),
    'Manager Vikram sees their own lead (Kavita Reddy) AND team member Agent 1 leads (Ananya, Sunil)'
  );
  assert(
    !managerLeadNames.includes('Rohan Verma'),
    'Manager Vikram CANNOT see Rohan Verma (belongs to Other Manager team)'
  );

  // Admin search (sees all organization leads)
  const adminSearch = await enquiryService.listEnquiries(
    { search: 'a', excludeCompletedDeals: false },
    adminActor
  );
  assert(adminSearch.success === true, 'Admin search succeeds');
  const adminLeadNames = adminSearch.enquiries.map((e) => e.name);
  assert(
    adminLeadNames.includes('Ananya Sharma') &&
    adminLeadNames.includes('Rohan Verma') &&
    adminLeadNames.includes('Sunil Kumar') &&
    adminLeadNames.includes('Kavita Reddy'),
    'Admin sees organization-wide permitted leads across all agents and managers'
  );

  // -------------------------------------------------------------
  // Suite 3: Single Enquiry Access Scoping (getEnquiryById)
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: Single Enquiry Access Scoping (getEnquiryById) ---');

  const leadAnanyaId = enquiryStore[0]._id.toString(); // Assigned to Agent 1 (Under Vikram)
  const leadRohanId = enquiryStore[1]._id.toString();  // Assigned to Agent 2 (Under Other Manager)

  // Agent 1 views own lead
  const a1Own = await enquiryService.getEnquiryById(leadAnanyaId, agent1Actor);
  assert(a1Own.success === true, 'Agent 1 can access own assigned lead Ananya');

  // Agent 1 views Agent 2 lead
  const a1Forbidden = await enquiryService.getEnquiryById(leadRohanId, agent1Actor);
  assert(a1Forbidden.success === false, 'Agent 1 is rejected viewing Agent 2 lead');
  assert(a1Forbidden.statusCode === 403, 'Returns HTTP 403 Forbidden for cross-agent enquiry access');

  // Manager Vikram views team member Agent 1 lead
  const mgrTeamAccess = await enquiryService.getEnquiryById(leadAnanyaId, managerActor);
  assert(mgrTeamAccess.success === true, 'Manager Vikram can access team member Agent 1 lead');

  // Manager Vikram views Other Manager team lead
  const mgrForbidden = await enquiryService.getEnquiryById(leadRohanId, managerActor);
  assert(mgrForbidden.success === false, 'Manager Vikram is rejected viewing Other Manager team lead');
  assert(mgrForbidden.statusCode === 403, 'Returns HTTP 403 Forbidden for cross-team enquiry access');

  // Admin views any lead
  const adminAccess = await enquiryService.getEnquiryById(leadRohanId, adminActor);
  assert(adminAccess.success === true, 'Admin can view any lead across teams');

  console.log('\n====================================================');
  console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed (Total: ${totalTests})`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runGlobalSearchTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
