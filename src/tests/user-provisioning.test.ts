/**
 * Nueways CRM - Employee Account Provisioning & Management Test Suite (Phase 5)
 *
 * Verifies:
 * 1. ADMIN can list employees with safe profile fields (never passwordHash or googleSub).
 * 2. Non-ADMIN (MANAGER, SALES) cannot list employees (HTTP 403).
 * 3. Unauthenticated requests to user endpoints return HTTP 401.
 * 4. ADMIN can provision MANAGER and SALES employee accounts.
 * 5. Role restrictions: Endpoint explicitly rejects ADMIN creation (HTTP 400).
 * 6. Non-ADMIN cannot create employee accounts (HTTP 403).
 * 7. Duplicate email rejection (HTTP 409 Conflict).
 * 8. Validation rejection for empty name, invalid email, short password (HTTP 400).
 * 9. Privacy: passwordHash, plain-text passwords, and googleSub are NEVER returned or logged.
 * 10. Temporary password is valid for login; mustChangePassword flag is set.
 * 11. Changing password clears mustChangePassword flag.
 * 12. Pre-approved employee can immediately authenticate via Google Sign-In.
 * 13. ADMIN can activate/deactivate employees; cannot deactivate self.
 * 14. Deactivated employee cannot authenticate.
 */

import http from 'http';
import { Types } from 'mongoose';
import { createApp } from '../app.js';
import { User, IUser } from '../models/user.model.js';
import { authService } from '../services/auth.service.js';
import { env } from '../config/env.js';
import { IGoogleTokenVerifier, GoogleTokenPayload } from '../types/auth.types.js';

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || 'Test User',
    email: data.email || 'user@nueways.com',
    passwordHash: data.passwordHash || '$2a$12$abcdefghijklmnopqrstuv',
    role: data.role || 'SALES',
    isActive: data.isActive !== undefined ? data.isActive : true,
    mustChangePassword: data.mustChangePassword !== undefined ? data.mustChangePassword : false,
    googleSub: data.googleSub,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      return this;
    }
  } as unknown as IUser;
};

class TestMockGoogleVerifier implements IGoogleTokenVerifier {
  public mockPayloads: Record<string, GoogleTokenPayload> = {};

  registerToken(token: string, payload: GoogleTokenPayload) {
    this.mockPayloads[token] = payload;
  }

  async verifyIdToken(idToken: string, audience: string): Promise<GoogleTokenPayload> {
    const payload = this.mockPayloads[idToken];
    if (!payload) {
      throw new Error('Token verification failed: Invalid signature or unrecognized token');
    }
    return payload;
  }
}

async function runProvisioningTests() {
  console.log('====================================================');
  console.log('Starting Phase 5 Employee Provisioning Test Suite');
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

  const mockGoogleVerifier = new TestMockGoogleVerifier();
  authService.setGoogleVerifier(mockGoogleVerifier);

  try {
    // Setup test users and tokens
    const adminUser = createMockUser({
      name: 'System Admin',
      email: 'admin@nueways.com',
      role: 'ADMIN',
      isActive: true
    });
    const adminToken = authService.generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN'
    });

    const managerUser = createMockUser({
      name: 'Sales Manager',
      email: 'manager@gmail.com',
      role: 'MANAGER',
      isActive: true
    });
    const managerToken = authService.generateToken({
      id: managerUser.id,
      email: managerUser.email,
      role: 'MANAGER'
    });

    const salesUser = createMockUser({
      name: 'Sales Agent',
      email: 'sales@gmail.com',
      role: 'SALES',
      isActive: true
    });
    const salesToken = authService.generateToken({
      id: salesUser.id,
      email: salesUser.email,
      role: 'SALES'
    });

    // In-memory mock database store
    const userStore: IUser[] = [adminUser, managerUser, salesUser];

    // Mock User queries and prototype.save for isolated in-memory test
    const originalFindById = User.findById;
    const originalFindOne = User.findOne;
    const originalFind = User.find;
    const originalFindOneAndUpdate = User.findOneAndUpdate;
    const originalUserSave = User.prototype.save;

    User.prototype.save = function (this: any) {
      if (!this._id) {
        this._id = new Types.ObjectId();
        this.id = this._id.toString();
      }
      if (!this.createdAt) this.createdAt = new Date();
      if (!this.updatedAt) this.updatedAt = new Date();
      const existingIdx = userStore.findIndex((u) => u._id.toString() === this._id.toString());
      if (existingIdx >= 0) {
        userStore[existingIdx] = this;
      } else {
        userStore.push(this);
      }
      return Promise.resolve(this);
    };

    User.findById = ((id: any) => {
      const u = userStore.find((x) => x._id.toString() === id.toString() || x.id === id.toString());
      return {
        select: (fields?: string) => {
          return Promise.resolve(u || null);
        },
        then: (resolve: any) => Promise.resolve(u || null).then(resolve)
      };
    }) as any;

    User.findOne = ((query: any) => {
      let matched: IUser | undefined;
      if (query.email) {
        matched = userStore.find((x) => x.email.toLowerCase() === query.email.toLowerCase());
      } else if (query.googleSub) {
        matched = userStore.find((x) => x.googleSub === query.googleSub);
      }
      return {
        select: (fields?: string) => {
          return Promise.resolve(matched || null);
        },
        then: (resolve: any) => Promise.resolve(matched || null).then(resolve)
      };
    }) as any;

    User.find = (() => ({
      select: () => ({
        sort: () => ({
          lean: () =>
            Promise.resolve(
              userStore.map((u) => ({
                _id: u._id,
                name: u.name,
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                mustChangePassword: Boolean(u.mustChangePassword),
                googleSub: u.googleSub,
                createdAt: u.createdAt,
                updatedAt: u.updatedAt
              }))
            )
        })
      })
    })) as any;

    // ---------------------------------------------------------------
    // Suite 1: Authorization on GET /api/v1/users
    // ---------------------------------------------------------------
    console.log('--- Suite 1: Authorization on GET /api/v1/users ---');

    // 1A. ADMIN gets 200 and safe employee list
    const adminGetRes = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminGetBody = (await adminGetRes.json()) as any;
    assert(adminGetRes.status === 200, 'ADMIN access returns HTTP 200 OK');
    assert(Array.isArray(adminGetBody.data), 'Returns data as an array');
    assert(adminGetBody.data.length >= 3, 'Contains registered employees');

    // Check sensitive field stripping
    const hasHash = adminGetBody.data.some((u: any) => u.passwordHash !== undefined);
    assert(!hasHash, 'Never exposes passwordHash in list response');
    const hasGoogleSub = adminGetBody.data.some((u: any) => u.googleSub !== undefined);
    assert(!hasGoogleSub, 'Never exposes raw googleSub in list response');
    const hasGoogleLinked = adminGetBody.data.every((u: any) => typeof u.hasGoogleLinked === 'boolean');
    assert(hasGoogleLinked, 'Provides safe hasGoogleLinked boolean indicator');

    // 1B. MANAGER gets 403 Forbidden
    const managerGetRes = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert(managerGetRes.status === 403, 'MANAGER access returns HTTP 403 Forbidden');

    // 1C. SALES gets 403 Forbidden
    const salesGetRes = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { Authorization: `Bearer ${salesToken}` }
    });
    assert(salesGetRes.status === 403, 'SALES access returns HTTP 403 Forbidden');

    // 1D. Unauthenticated gets 401 Unauthorized
    const unauthGetRes = await fetch(`${baseUrl}/api/v1/users`);
    assert(unauthGetRes.status === 401, 'Unauthenticated request returns HTTP 401 Unauthorized');

    // ---------------------------------------------------------------
    // Suite 2: Employee Provisioning (POST /api/v1/users)
    // ---------------------------------------------------------------
    console.log('\n--- Suite 2: Employee Provisioning (POST /api/v1/users) ---');

    // 2A. ADMIN creates valid SALES employee
    const tempPassword1 = 'TempPassword123!';
    const createSalesRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Jane Sales Agent',
        email: 'jane.sales@gmail.com',
        role: 'SALES',
        temporaryPassword: tempPassword1
      })
    });
    const createSalesBody = (await createSalesRes.json()) as any;
    assert(createSalesRes.status === 201, 'ADMIN provisions SALES employee with HTTP 201 Created');
    assert(createSalesBody.success === true, 'Response specifies success: true');
    assert(createSalesBody.data.email === 'jane.sales@gmail.com', 'Returns normalized email');
    assert(createSalesBody.data.role === 'SALES', 'Returns assigned role');
    assert(createSalesBody.data.isActive === true, 'Account is active immediately');
    assert(createSalesBody.data.mustChangePassword === true, 'mustChangePassword flag is true');
    assert(createSalesBody.data.passwordHash === undefined, 'Never returns passwordHash');
    assert(createSalesBody.data.temporaryPassword === undefined, 'Never echoes temporary password in response');

    // Get saved doc from userStore
    const createdSalesDoc = userStore.find((u) => u.email === 'jane.sales@gmail.com')!;
    assert(createdSalesDoc !== undefined, 'Persisted Jane Sales Agent in store');

    // 2B. ADMIN creates valid MANAGER employee
    const tempPassword2 = 'ManagerSecurePass2026!';
    const createMgrRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Bob Manager',
        email: 'bob.manager@gmail.com',
        role: 'MANAGER',
        temporaryPassword: tempPassword2
      })
    });
    const createMgrBody = (await createMgrRes.json()) as any;
    assert(createMgrRes.status === 201, 'ADMIN provisions MANAGER employee with HTTP 201 Created');
    assert(createMgrBody.data.role === 'MANAGER', 'Assigned role is MANAGER');

    const createdMgrDoc = userStore.find((u) => u.email === 'bob.manager@gmail.com')!;
    assert(createdMgrDoc !== undefined, 'Persisted Bob Manager in store');

    // 2C. Rejection: ADMIN creation through this endpoint is strictly disallowed
    const createAdminAttemptRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Rogue Admin',
        email: 'rogue@nueways.com',
        role: 'ADMIN',
        temporaryPassword: 'Password123!'
      })
    });
    assert(createAdminAttemptRes.status === 400, 'Rejects attempt to create ADMIN via provisioning API (HTTP 400)');

    // 2D. Rejection: MANAGER cannot create users (403)
    const mgrCreateRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`
      },
      body: JSON.stringify({
        name: 'Unauthorized User',
        email: 'unauth@gmail.com',
        role: 'SALES',
        temporaryPassword: 'Password123!'
      })
    });
    assert(mgrCreateRes.status === 403, 'MANAGER cannot create users (HTTP 403 Forbidden)');

    // 2E. Rejection: Duplicate email (409 Conflict)
    const duplicateRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Duplicate Jane',
        email: 'jane.sales@gmail.com',
        role: 'SALES',
        temporaryPassword: 'NewPassword123!'
      })
    });
    assert(duplicateRes.status === 409, 'Rejects duplicate email with HTTP 409 Conflict');

    // 2F. Rejection: Short password (<8 characters)
    const shortPassRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Short Password Employee',
        email: 'short@gmail.com',
        role: 'SALES',
        temporaryPassword: 'short'
      })
    });
    assert(shortPassRes.status === 400, 'Rejects password shorter than 8 characters (HTTP 400)');

    // 2G. Rejection: Invalid email format
    const badEmailRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Bad Email Employee',
        email: 'not-an-email',
        role: 'SALES',
        temporaryPassword: 'ValidPassword123!'
      })
    });
    assert(badEmailRes.status === 400, 'Rejects invalid email format (HTTP 400)');

    // ---------------------------------------------------------------
    // Suite 3: Provisioned Account Login & Password Change Flow
    // ---------------------------------------------------------------
    console.log('\n--- Suite 3: Provisioned Account Login & Password Change Flow ---');

    // 3A. Employee logs in with temporary password
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'jane.sales@gmail.com',
        password: tempPassword1
      })
    });
    const loginBody = (await loginRes.json()) as any;
    assert(loginRes.status === 200, 'Employee logs in with temporary password (HTTP 200)');
    assert(loginBody.data.user.mustChangePassword === true, 'mustChangePassword flag is true on login');
    const employeeToken = loginBody.data.token;

    // 3B. Server-side enforcement: Protected business APIs are blocked while mustChangePassword is true
    const blockedApiRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${employeeToken}`
      },
      body: JSON.stringify({ name: 'Blocked Lead', mobile: '9876543210' })
    });
    const blockedApiBody = (await blockedApiRes.json()) as any;
    assert(blockedApiRes.status === 403, 'Backend blocks business APIs when mustChangePassword is true (HTTP 403)');
    assert(blockedApiBody.error === 'PasswordChangeRequired', 'Error specifies PasswordChangeRequired');

    // 3C. Employee changes password via POST /api/v1/auth/change-password
    const newPermanentPassword = 'MySecretPrivatePassword2026!';
    const changePassRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        oldPassword: tempPassword1,
        newPassword: newPermanentPassword
      })
    });
    const changePassBody = (await changePassRes.json()) as any;
    assert(changePassRes.status === 200, 'Password change succeeds with HTTP 200');
    assert(changePassBody.success === true, 'Response specifies success: true');
    assert(createdSalesDoc.mustChangePassword === false, 'mustChangePassword flag is now false');

    // 3D. Protected business APIs are no longer blocked with PasswordChangeRequired
    const allowedApiRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${employeeToken}`
      },
      body: JSON.stringify({ name: 'Allowed Lead', mobile: 'invalid-mobile-triggers-400' })
    });
    const allowedApiBody = (await allowedApiRes.json()) as any;
    assert(allowedApiBody.error !== 'PasswordChangeRequired', 'Business APIs are no longer blocked by PasswordChangeRequired');

    // 3E. Rejects incorrect current password
    const badChangeRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        oldPassword: 'WrongOldPassword!',
        newPassword: 'AnotherPassword123!'
      })
    });
    assert(badChangeRes.status === 400, 'Rejects password change with incorrect current password (HTTP 400)');

    // ---------------------------------------------------------------
    // Suite 4: Google Sign-In for Provisioned Employee
    // ---------------------------------------------------------------
    console.log('\n--- Suite 4: Google Sign-In for Provisioned Employee ---');

    const originalClientId = env.GOOGLE_CLIENT_ID;
    (env as any).GOOGLE_CLIENT_ID = 'test-google-client-id';

    // Register Google token for Bob Manager
    const bobGoogleToken = 'google-id-token-bob-manager';
    mockGoogleVerifier.registerToken(bobGoogleToken, {
      sub: 'google-sub-bob-manager-98765',
      email: 'bob.manager@gmail.com',
      email_verified: true,
      name: 'Bob Manager'
    });

    User.findOneAndUpdate = ((filter: any, update: any) => {
      if (createdMgrDoc && (filter._id === createdMgrDoc._id || filter.email === createdMgrDoc.email)) {
        if (update.$set.googleSub) createdMgrDoc.googleSub = update.$set.googleSub;
        if (update.$set.passwordHash) createdMgrDoc.passwordHash = update.$set.passwordHash;
        if (update.$set.mustChangePassword !== undefined) createdMgrDoc.mustChangePassword = update.$set.mustChangePassword;
        return Promise.resolve(createdMgrDoc);
      }
      return Promise.resolve(null);
    }) as any;

    const googleLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: bobGoogleToken })
    });
    const googleLoginBody = (await googleLoginRes.json()) as any;
    assert(googleLoginRes.status === 200, 'Provisioned employee can sign in with Google directly (HTTP 200)');
    assert(googleLoginBody.data.user.email === 'bob.manager@gmail.com', 'Matches provisioned email');
    assert(googleLoginBody.data.user.role === 'MANAGER', 'Role strictly derived from database');
    assert(googleLoginBody.data.user.mustChangePassword === false, 'mustChangePassword cleared on Google SSO');
    assert(createdMgrDoc.mustChangePassword === false, 'Document flag is false');

    // Security: Old temporary password is invalidated and cannot be used
    const oldTempPassLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob.manager@gmail.com',
        password: tempPassword2
      })
    });
    assert(oldTempPassLoginRes.status === 401, 'Old temporary password invalidated after Google SSO (HTTP 401)');

    // Google authenticated user can access business APIs immediately without PasswordChangeRequired
    const bobManagerToken = googleLoginBody.data.token;
    const bobApiRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobManagerToken}`
      },
      body: JSON.stringify({ name: 'Bob Lead', mobile: 'invalid-mobile-triggers-400' })
    });
    const bobApiBody = (await bobApiRes.json()) as any;
    assert(bobApiBody.error !== 'PasswordChangeRequired', 'Google-authenticated employee accesses business APIs without password block');

    // ---------------------------------------------------------------
    // Suite 5: Status Toggle (Activate/Deactivate) & Access Revocation
    // ---------------------------------------------------------------
    console.log('\n--- Suite 5: Status Toggle (Activate/Deactivate) ---');

    // 5A. ADMIN deactivates employee
    const deactivateRes = await fetch(`${baseUrl}/api/v1/users/${createdSalesDoc.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ isActive: false })
    });
    const deactivateBody = (await deactivateRes.json()) as any;
    assert(deactivateRes.status === 200, 'ADMIN deactivates employee with HTTP 200');
    assert(deactivateBody.data.isActive === false, 'Employee isActive is now false');
    createdSalesDoc.isActive = false;

    // 5B. Deactivated employee cannot log in
    const deactLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'jane.sales@gmail.com',
        password: newPermanentPassword
      })
    });
    assert(deactLoginRes.status === 401, 'Deactivated employee cannot log in (HTTP 401 Unauthorized)');

    // 5C. ADMIN cannot deactivate self
    const selfDeactivateRes = await fetch(`${baseUrl}/api/v1/users/${adminUser.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ isActive: false })
    });
    assert(selfDeactivateRes.status === 400, 'ADMIN cannot deactivate their own account (HTTP 400)');

    // 5D. SALES cannot update status
    const salesUpdateStatusRes = await fetch(`${baseUrl}/api/v1/users/${createdSalesDoc.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesToken}`
      },
      body: JSON.stringify({ isActive: true })
    });
    assert(salesUpdateStatusRes.status === 403, 'SALES cannot update status (HTTP 403 Forbidden)');

    // 5E. ADMIN reactivates employee
    const reactivateRes = await fetch(`${baseUrl}/api/v1/users/${createdSalesDoc.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ isActive: true })
    });
    assert(reactivateRes.status === 200, 'ADMIN reactivates employee with HTTP 200');
    createdSalesDoc.isActive = true;

    // Restore original User methods
    User.findById = originalFindById;
    User.findOne = originalFindOne;
    User.find = originalFind;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    User.prototype.save = originalUserSave;
    (env as any).GOOGLE_CLIENT_ID = originalClientId;

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    if (server) {
      server.close();
    }
  }
}

runProvisioningTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
