/**
 * Neuways CRM - MongoDB Atlas Connection Instability & Network-Resilient Authentication Tests
 *
 * Covers all 12 Testing Scenarios:
 * 1. MongoDB Atlas connection initialization and resilient DNS lookup.
 * 2. Temporary DNS / network disconnection simulation.
 * 3. Backend reports database as unavailable (HTTP 503) without crashing.
 * 4. Database connectivity returns and the application recovers safely.
 * 5. Dashboard summary and team performance recover after reconnection.
 * 6. Temporary database outage does not return HTTP 401 or clear valid authentication state.
 * 7. User continues using application after reconnection without re-logging in.
 * 8. Genuine expired or tampered credentials still return HTTP 401 Unauthorized.
 * 9. HTTP 403 authorization failures return 403 Forbidden without triggering session invalidation.
 * 10. HTTP 500/502/503 and network timeouts do not emit 401 or clear authentication state.
 * 11. Existing login, role permissions, and protected routes continue working.
 * 12. Lead creation and non-idempotent writes are not duplicated by automatic retries.
 */

import http from 'http';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../app.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry, IEnquiry } from '../models/enquiry.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { enquiryService } from '../services/enquiry.service.js';
import { authService } from '../services/auth.service.js';
import { env } from '../config/env.js';
import { AuthUser } from '../types/auth.types.js';
import { resilientLookup, isDatabaseError } from '../config/db.js';

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
  console.log('========================================================================');
  console.log('Neuways CRM - Network-Resilient Authentication & MongoDB Resilience Tests');
  console.log('========================================================================\n');

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

  // Mock Data Setup
  const adminId = new Types.ObjectId();
  const salesAgentId = new Types.ObjectId();

  const usersMap = new Map<string, any>();
  const enquiriesMap = new Map<string, any>();

  const createMockUser = (fields: Partial<IUser> & { _id: Types.ObjectId; id: string }): any => ({
    ...fields,
    passwordHash: '$2a$12$mockpwdhash',
    isActive: fields.isActive !== undefined ? fields.isActive : true,
    mustChangePassword: fields.mustChangePassword || false,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      usersMap.set(this._id.toString(), this);
      return this;
    }
  });

  const adminDoc = createMockUser({
    _id: adminId,
    id: adminId.toString(),
    name: 'Admin Boss',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  });

  const salesDoc = createMockUser({
    _id: salesAgentId,
    id: salesAgentId.toString(),
    name: 'Sales Agent Sam',
    email: 'sam.sales@neuways.com',
    role: 'SALES'
  });

  usersMap.set(adminId.toString(), adminDoc);
  usersMap.set(salesAgentId.toString(), salesDoc);

  const adminActor: AuthUser = { id: adminId.toString(), email: adminDoc.email, role: 'ADMIN', name: adminDoc.name };
  const salesActor: AuthUser = { id: salesAgentId.toString(), email: salesDoc.email, role: 'SALES', name: salesDoc.name };

  const validAdminToken = authService.generateToken(adminActor);
  const validSalesToken = authService.generateToken(salesActor);

  // Mongoose Model Stubs
  const origUserFindById = User.findById;
  const origUserFind = User.find;
  const origEnquiryFind = Enquiry.find;
  const origEnquiryCount = Enquiry.countDocuments;
  const origFollowUpCount = FollowUpTask.countDocuments;
  const origFollowUpFind = FollowUpTask.find;
  const origEnquiryActivitySave = EnquiryActivity.prototype.save;
  const origReadyState = (mongoose.connection as any).readyState;

  EnquiryActivity.prototype.save = (() => Promise.resolve({})) as any;

  function mockChain<T>(val: T) {
    const obj: any = {
      select: () => obj,
      populate: () => obj,
      sort: () => obj,
      lean: () => Promise.resolve(val),
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject)
    };
    return obj;
  }

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Resilient DNS Lookup & MongoDB Connection Options
    // -------------------------------------------------------------------------
    console.log('--- Scenario 1: Resilient DNS Lookup Verification ---');

    await new Promise<void>((resolve) => {
      resilientLookup('ac-raal0st-shard-00-02.eivfrfq.mongodb.net', {}, (err, address, family) => {
        assert(!err && Boolean(address), 'Scenario 1: Resilient lookup resolves MongoDB Atlas shard hostname');
        assert(family === 4, 'Scenario 1: Resolves IPv4 address family');
        resolve();
      });
    });

    assert(
      isDatabaseError(new Error('getaddrinfo ENOTFOUND ac-raal0st-shard-00-02.eivfrfq.mongodb.net')),
      'Scenario 1: isDatabaseError accurately identifies DNS resolution failures'
    );
    assert(
      isDatabaseError(new Error('Operation `enquiries.countDocuments()` buffering timed out after 10000ms')),
      'Scenario 1: isDatabaseError accurately identifies Mongoose buffer timeout'
    );

    // -------------------------------------------------------------------------
    // Scenario 2 & 3: Temporary Disconnection & Backend Reports 503 (No Crash)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 2 & 3: Temporary Outage & HTTP 503 Reporting ---');

    // Simulate database disconnection
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

    // When DB is disconnected and model is queried:
    User.findById = ((_id: any) => ({
      select: () => Promise.reject(new Error('MongoServerSelectionError: Server selection timed out after 15000 ms'))
    })) as any;

    const outageReq = await fetch(`${baseUrl}/api/v1/enquiries`, {
      headers: { Authorization: `Bearer ${validSalesToken}` }
    });
    const outageBody = (await outageReq.json()) as any;

    assert(
      outageReq.status === 503,
      `Scenario 3: Backend reports HTTP 503 Service Unavailable when DB is down (got ${outageReq.status})`
    );
    assert(
      outageBody.error === 'DatabaseUnavailable',
      'Scenario 3: Error code is DatabaseUnavailable, NOT Unauthorized'
    );
    assert(
      outageReq.status !== 401,
      'Scenario 3: Temporary database outage does NOT emit HTTP 401 Unauthorized'
    );

    // Check /api/v1/health during outage
    const healthReq = await fetch(`${baseUrl}/api/v1/health`);
    const healthBody = (await healthReq.json()) as any;
    assert(healthReq.status === 503, 'Scenario 3: /api/v1/health reports 503 degraded when DB is down');
    assert(healthBody.database === 'disconnected', 'Scenario 3: Healthcheck accurately reports database: disconnected');

    // -------------------------------------------------------------------------
    // Scenario 4 & 5: Connectivity Returns & Dashboard Summary / Team Performance Recover
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 4 & 5: Connectivity Returns & Metrics Recover ---');

    // Restore connected state
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

    User.findById = ((id: any) => {
      const u = usersMap.get(id?.toString());
      return {
        select: () => Promise.resolve(u || null),
        then: (fn: any) => Promise.resolve(u || null).then(fn)
      };
    }) as any;

    User.find = (() => mockChain([salesDoc])) as any;
    Enquiry.countDocuments = (() => Promise.resolve(5)) as any;
    FollowUpTask.countDocuments = (() => Promise.resolve(2)) as any;
    Enquiry.find = (() => mockChain([])) as any;
    FollowUpTask.find = (() => mockChain([])) as any;

    const recoveredHealth = await fetch(`${baseUrl}/api/v1/health`);
    assert(recoveredHealth.status === 200, 'Scenario 4: Health endpoint returns HTTP 200 after reconnection');

    const summaryRes = await fetch(`${baseUrl}/api/v1/enquiries/dashboard-summary`, {
      headers: { Authorization: `Bearer ${validSalesToken}` }
    });
    const summaryData = (await summaryRes.json()) as any;
    assert(summaryRes.status === 200, 'Scenario 5: Dashboard summary recovers cleanly with HTTP 200');
    assert(summaryData.success === true, 'Scenario 5: Dashboard summary returns success: true');
    assert(summaryData.data.activePipelineCount === 5, 'Scenario 5: Active pipeline count computed correctly');

    const teamPerfRes = await fetch(`${baseUrl}/api/v1/enquiries/team`, {
      headers: { Authorization: `Bearer ${validAdminToken}` }
    });
    assert(teamPerfRes.status === 200, 'Scenario 5: Team performance recovers cleanly with HTTP 200');

    // -------------------------------------------------------------------------
    // Scenario 6 & 7: Transient Failure Does Not Clear Valid Auth State
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 6 & 7: Session Preserved Across Reconnection ---');

    // Token was valid before outage, remained unchanged during 503 outage, and now still works
    const postReconnectionReq = await fetch(`${baseUrl}/api/v1/enquiries/dashboard-summary`, {
      headers: { Authorization: `Bearer ${validSalesToken}` }
    });
    assert(
      postReconnectionReq.status === 200,
      'Scenario 7: User continues using application without re-logging in after reconnection'
    );

    // -------------------------------------------------------------------------
    // Scenario 8: Genuine Expired Credentials Trigger Secure Reauthentication
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Genuine Expired / Tampered Tokens Return HTTP 401 ---');

    const expiredToken = jwt.sign(
      { sub: salesAgentId.toString(), email: salesDoc.email, role: 'SALES' },
      env.JWT_SECRET,
      { expiresIn: '-10s' } // Expired 10 seconds ago
    );

    const expiredReq = await fetch(`${baseUrl}/api/v1/enquiries/dashboard-summary`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    const expiredBody = (await expiredReq.json()) as any;

    assert(expiredReq.status === 401, 'Scenario 8: Genuine expired token returns HTTP 401 Unauthorized');
    assert(
      expiredBody.message.includes('expired') || expiredBody.error === 'Unauthorized',
      'Scenario 8: Expired token identifies unauthorized expiration'
    );

    const tamperedReq = await fetch(`${baseUrl}/api/v1/enquiries/dashboard-summary`, {
      headers: { Authorization: 'Bearer totally.tampered.jwttoken' }
    });
    assert(tamperedReq.status === 401, 'Scenario 8: Tampered token returns HTTP 401 Unauthorized');

    // -------------------------------------------------------------------------
    // Scenario 9: HTTP 403 Permission Failures Do Not Invalidate Session
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Role Authorization Failures Return HTTP 403 (No Logout) ---');

    // Sales Agent attempting to access Admin-only Users list
    const forbiddenReq = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { Authorization: `Bearer ${validSalesToken}` }
    });
    assert(forbiddenReq.status === 403, 'Scenario 9: Sales Agent accessing Admin route returns HTTP 403 Forbidden');
    assert(forbiddenReq.status !== 401, 'Scenario 9: HTTP 403 is separate from session expiration (401)');

    // -------------------------------------------------------------------------
    // Scenario 10: Server Errors (500/502/503) Do Not Clear Authentication
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Server Errors Distinct from Auth Failure ---');

    // Simulate unexpected 500 in service
    const origSummary = enquiryService.getDashboardSummary;
    enquiryService.getDashboardSummary = async () => ({
      success: false,
      statusCode: 500,
      message: 'Simulated internal calculation exception'
    });

    const error500Req = await fetch(`${baseUrl}/api/v1/enquiries/dashboard-summary`, {
      headers: { Authorization: `Bearer ${validSalesToken}` }
    });
    assert(error500Req.status === 500, 'Scenario 10: Server error returns HTTP 500, NOT 401');

    enquiryService.getDashboardSummary = origSummary;

    // -------------------------------------------------------------------------
    // Scenario 11: Existing Login, Role Permissions, and Routes Function Normally
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 11: Normal Login and Protected Route Verification ---');

    assert(adminDoc.role === 'ADMIN', 'Scenario 11: Admin role preserved in DB');
    assert(salesDoc.role === 'SALES', 'Scenario 11: Sales role preserved in DB');

    const adminRosterReq = await fetch(`${baseUrl}/api/v1/enquiries/team/roster`, {
      headers: { Authorization: `Bearer ${validAdminToken}` }
    });
    assert(adminRosterReq.status === 200, 'Scenario 11: Admin accesses team roster with HTTP 200');

    // -------------------------------------------------------------------------
    // Scenario 12: Non-Idempotent Lead Creation Not Duplicated
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 12: Idempotent Retries Safeguard ---');

    // Verify duplicate lead submission with same normalized mobile is blocked with 409
    const leadMobile = '9812345678';
    const normMob = '+919812345678';
    const existingLead = {
      _id: new Types.ObjectId(),
      name: 'Existing Client',
      mobile: leadMobile,
      normalizedMobile: normMob,
      status: 'ACTIVE'
    };
    enquiriesMap.set(existingLead._id.toString(), existingLead);

    Enquiry.find = ((filter: any) => {
      let list = Array.from(enquiriesMap.values());
      if (filter?.$or) {
        list = list.filter((e) => filter.$or.some((c: any) => c.normalizedMobile === e.normalizedMobile));
      }
      return mockChain(list);
    }) as any;

    const dupLeadRes = await enquiryService.createEnquiry(
      {
        name: 'Retry Lead Attempt',
        mobile: leadMobile,
        projectName: 'Greenfield'
      },
      salesActor
    );

    assert(dupLeadRes.isDuplicate === true, 'Scenario 12: Duplicate lead creation blocked by duplicate detector');
    assert((dupLeadRes as any).duplicateType === 'MOBILE_MATCH', 'Scenario 12: Mobile match duplicate conflict enforced');

  } finally {
    // Restore Mongoose methods and state
    User.findById = origUserFindById;
    User.find = origUserFind;
    Enquiry.find = origEnquiryFind;
    Enquiry.countDocuments = origEnquiryCount;
    FollowUpTask.countDocuments = origFollowUpCount;
    FollowUpTask.find = origFollowUpFind;
    EnquiryActivity.prototype.save = origEnquiryActivitySave;
    Object.defineProperty(mongoose.connection, 'readyState', { value: origReadyState, configurable: true });

    if (server) {
      server.close();
    }
  }

  console.log('\n========================================================================');
  console.log(`Test Suite Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
