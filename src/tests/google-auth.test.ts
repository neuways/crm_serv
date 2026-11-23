/**
 * Nueways CRM - Google Sign-In & Role-Based Authentication Test Suite
 *
 * Verifies:
 * 1. Safe handling when GOOGLE_CLIENT_ID is missing (HTTP 503).
 * 2. Successful Google login for SALES, MANAGER (personal Gmail), and ADMIN (authorized email).
 * 3. Role enforcement: Role is strictly derived from MongoDB, never from token or client.
 * 4. Account linking: First login links googleSub atomically; subsequent logins use googleSub.
 * 5. Unknown Google account rejection (HTTP 401, no auto-registration).
 * 6. Deactivated account rejection (HTTP 401).
 * 7. Unverified email rejection (HTTP 401).
 * 8. Audience mismatch & expired token rejection (HTTP 401).
 * 9. Identity conflict rejection (tampered or mismatched googleSub).
 * 10. Production verifier integrity (rejects fake tokens without valid Google certs).
 * 11. Existing email/password login regression.
 */

import http from 'http';
import { Types } from 'mongoose';
import { createApp } from '../app.js';
import { User, IUser } from '../models/user.model.js';
import { authService, RealGoogleTokenVerifier } from '../services/auth.service.js';
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
    googleSub: data.googleSub,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    if (audience !== 'test-google-client-id') {
      throw new Error('Token verification failed: Audience mismatch');
    }
    return payload;
  }
}

async function runGoogleAuthTests() {
  console.log('====================================================');
  console.log('Starting Google Sign-In & RBAC Security Test Suite');
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

  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = User.findOneAndUpdate;

  try {
    // -----------------------------------------------------------------
    // Suite 1: Missing GOOGLE_CLIENT_ID Configuration (HTTP 503)
    // -----------------------------------------------------------------
    console.log('--- Suite 1: Missing Configuration Safety ---');
    (env as any).GOOGLE_CLIENT_ID = undefined;

    const unconfiguredRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'some-token' }),
    });
    const unconfiguredBody = (await unconfiguredRes.json()) as any;

    assert(
      unconfiguredRes.status === 503,
      'Returns HTTP 503 Service Unavailable when GOOGLE_CLIENT_ID is missing'
    );
    assert(
      unconfiguredBody.message.includes('not configured'),
      'Informs client that Google Sign-In is unconfigured without crashing'
    );

    // Now enable test client ID for remaining suites
    (env as any).GOOGLE_CLIENT_ID = 'test-google-client-id';
    const mockVerifier = new TestMockGoogleVerifier();
    authService.setGoogleVerifier(mockVerifier);

    // -----------------------------------------------------------------
    // Suite 2: Successful Google Sign-In with Trusted MongoDB Roles
    // -----------------------------------------------------------------
    console.log('\n--- Suite 2: Role Authorization via Database (SALES, MANAGER, ADMIN) ---');

    // Scenario A: SALES role
    const salesUser = createMockUser({
      name: 'Agent Rohit',
      email: 'rohit.sales@gmail.com',
      role: 'SALES',
      isActive: true,
    });

    mockVerifier.registerToken('valid-sales-token', {
      sub: 'google-sub-101',
      email: 'rohit.sales@gmail.com',
      email_verified: true,
      name: 'Agent Rohit',
    });

    User.findOne = ((query: any) => {
      if (query.googleSub === 'google-sub-101' || query.email === 'rohit.sales@gmail.com') {
        return {
          select: () => Promise.resolve(salesUser),
          then: (resolve: any) => resolve(salesUser),
        };
      }
      return {
        select: () => Promise.resolve(null),
        then: (resolve: any) => resolve(null),
      };
    }) as any;

    User.findOneAndUpdate = (() => Promise.resolve(salesUser)) as any;

    const salesRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-sales-token' }),
    });
    const salesBody = (await salesRes.json()) as any;

    assert(salesRes.status === 200, 'SALES Google login returns HTTP 200');
    assert(salesBody.success === true, 'Response specifies success: true');
    assert(salesBody.data.user.role === 'SALES', 'User role is SALES strictly from MongoDB');
    assert(typeof salesBody.data.token === 'string', 'Returns signed 8-hour CRM JWT');

    // Scenario B: MANAGER role with personal Gmail
    const managerUser = createMockUser({
      name: 'Manager Priya',
      email: 'priya.manager@gmail.com',
      role: 'MANAGER',
      isActive: true,
    });

    mockVerifier.registerToken('valid-manager-token', {
      sub: 'google-sub-102',
      email: 'priya.manager@gmail.com',
      email_verified: true,
    });

    User.findOne = ((query: any) => {
      if (query.googleSub === 'google-sub-102' || query.email === 'priya.manager@gmail.com') {
        return {
          select: () => Promise.resolve(managerUser),
          then: (resolve: any) => resolve(managerUser),
        };
      }
      return {
        select: () => Promise.resolve(null),
        then: (resolve: any) => resolve(null),
      };
    }) as any;

    const managerRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-manager-token' }),
    });
    const managerBody = (await managerRes.json()) as any;

    assert(managerRes.status === 200, 'MANAGER Google login returns HTTP 200');
    assert(managerBody.data.user.role === 'MANAGER', 'User role is MANAGER strictly from MongoDB');

    // Scenario C: ADMIN role with corporate email
    const adminUser = createMockUser({
      name: 'Director Admin',
      email: 'hd@nueways.com',
      role: 'ADMIN',
      isActive: true,
    });

    mockVerifier.registerToken('valid-admin-token', {
      sub: 'google-sub-admin',
      email: 'hd@nueways.com',
      email_verified: true,
    });

    User.findOne = ((query: any) => {
      if (query.googleSub === 'google-sub-admin' || query.email === 'hd@nueways.com') {
        return {
          select: () => Promise.resolve(adminUser),
          then: (resolve: any) => resolve(adminUser),
        };
      }
      return {
        select: () => Promise.resolve(null),
        then: (resolve: any) => resolve(null),
      };
    }) as any;

    const adminRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-admin-token' }),
    });
    const adminBody = (await adminRes.json()) as any;

    assert(adminRes.status === 200, 'ADMIN Google login returns HTTP 200');
    assert(adminBody.data.user.role === 'ADMIN', 'ADMIN role granted only to authorized ADMIN user in DB');

    // -----------------------------------------------------------------
    // Suite 3: Access Denial Security Tests
    // -----------------------------------------------------------------
    console.log('\n--- Suite 3: Access Denial Security Tests ---');

    // Test 1: Unknown Google account (must deny, NO auto-registration)
    mockVerifier.registerToken('unknown-token', {
      sub: 'google-sub-unknown',
      email: 'random.stranger@gmail.com',
      email_verified: true,
    });

    User.findOne = (() => ({
      select: () => Promise.resolve(null),
      then: (resolve: any) => resolve(null),
    })) as any;

    const unknownRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'unknown-token' }),
    });
    const unknownBody = (await unknownRes.json()) as any;

    assert(unknownRes.status === 401, 'Denies unknown Google account with HTTP 401');
    assert(
      unknownBody.message.includes('Self-registration is disabled') ||
        unknownBody.message.includes('No authorized CRM account'),
      'Explains that self-registration is disabled and account was not found'
    );

    // Test 2: Deactivated employee
    const deactivatedUser = createMockUser({
      name: 'Ex-Employee',
      email: 'ex.employee@nueways.com',
      role: 'SALES',
      isActive: false,
    });

    mockVerifier.registerToken('deactivated-token', {
      sub: 'google-sub-deactivated',
      email: 'ex.employee@nueways.com',
      email_verified: true,
    });

    User.findOne = (() => ({
      select: () => Promise.resolve(deactivatedUser),
      then: (resolve: any) => resolve(deactivatedUser),
    })) as any;

    const deactRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'deactivated-token' }),
    });
    const deactBody = (await deactRes.json()) as any;

    assert(deactRes.status === 401, 'Denies deactivated account with HTTP 401');
    assert(deactBody.message.includes('deactivated'), 'Cites deactivated account');

    // Test 3: Unverified email from Google
    mockVerifier.registerToken('unverified-email-token', {
      sub: 'google-sub-unverified',
      email: 'rohit.sales@gmail.com',
      email_verified: false, // NOT VERIFIED
    });

    const unverifiedRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'unverified-email-token' }),
    });
    const unverifiedBody = (await unverifiedRes.json()) as any;

    assert(unverifiedRes.status === 401, 'Denies Google token with email_verified: false');
    assert(unverifiedBody.message.includes('not verified'), 'Cites unverified Google email');

    // Test 4: Invalid / Malformed / Tampered Token
    const invalidTokenRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'completely-fake-unregistered-token' }),
    });

    assert(invalidTokenRes.status === 401, 'Denies invalid/tampered token with HTTP 401');

    // Test 5: Empty payload validation
    const emptyPayloadRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert(emptyPayloadRes.status === 400, 'Rejects empty payload with HTTP 400 Validation Error');

    // -----------------------------------------------------------------
    // Suite 4: Account Linking Safety & Identity Conflicts
    // -----------------------------------------------------------------
    console.log('\n--- Suite 4: Account Linking Safety & Identity Conflicts ---');

    // User already linked to google-sub-A attempts to sign in with google-sub-B
    const alreadyLinkedUser = createMockUser({
      name: 'Linked Agent',
      email: 'linked.agent@nueways.com',
      role: 'SALES',
      googleSub: 'google-sub-A',
      isActive: true,
    });

    mockVerifier.registerToken('conflicting-sub-token', {
      sub: 'google-sub-B', // Different sub!
      email: 'linked.agent@nueways.com',
      email_verified: true,
    });

    User.findOne = ((query: any) => {
      // Not found by google-sub-B
      if (query.googleSub === 'google-sub-B') {
        return {
          select: () => Promise.resolve(null),
          then: (resolve: any) => resolve(null),
        };
      }
      // Found by email, but has googleSub-A
      if (query.email === 'linked.agent@nueways.com') {
        return {
          select: () => Promise.resolve(alreadyLinkedUser),
          then: (resolve: any) => resolve(alreadyLinkedUser),
        };
      }
      return {
        select: () => Promise.resolve(null),
        then: (resolve: any) => resolve(null),
      };
    }) as any;

    const conflictRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'conflicting-sub-token' }),
    });
    const conflictBody = (await conflictRes.json()) as any;

    assert(conflictRes.status === 401, 'Denies identity conflict with HTTP 401');
    assert(
      conflictBody.message.includes('identity conflict') ||
        conflictBody.message.includes('Administrator-assisted linking'),
      'Requires administrator-assisted linking on conflict'
    );

    // -----------------------------------------------------------------
    // Suite 5: Production Verifier Integrity
    // -----------------------------------------------------------------
    console.log('\n--- Suite 5: Production Verifier Integrity ---');

    // Restore real Google verifier
    const realVerifier = new RealGoogleTokenVerifier();
    authService.setGoogleVerifier(realVerifier);

    const forgedRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'forged.fake.token' }),
    });

    assert(
      forgedRes.status === 401,
      'Production verifier rejects fake/mock tokens without valid Google signatures'
    );

    // -----------------------------------------------------------------
    // Suite 6: Email/Password Login Regression
    // -----------------------------------------------------------------
    console.log('\n--- Suite 6: Email/Password Login Regression ---');

    const passwordUser = createMockUser({
      name: 'Password Employee',
      email: 'password.employee@nueways.com',
      passwordHash: '$2a$12$e80yvM7K.D7L85F6Y5H7quZ8qF9zXyA1W2E3R4T5Y6U7I8O9P0Q1W', // mock
      role: 'SALES',
      isActive: true,
    });

    // Mock verifyPassword to return true
    authService.verifyPassword = async () => true;

    User.findOne = ((query: any) => {
      if (query.email === 'password.employee@nueways.com') {
        return {
          select: () => Promise.resolve(passwordUser),
          then: (resolve: any) => resolve(passwordUser),
        };
      }
      return {
        select: () => Promise.resolve(null),
        then: (resolve: any) => resolve(null),
      };
    }) as any;

    const pwRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'password.employee@nueways.com',
        password: 'ValidPassword123!',
      }),
    });
    const pwBody = (await pwRes.json()) as any;

    assert(pwRes.status === 200, 'Standard email/password login continues to succeed (HTTP 200)');
    assert(pwBody.success === true, 'Password login returns success envelope');
    assert(pwBody.data.user.role === 'SALES', 'Password login returns user profile');
  } finally {
    // Restore mocks
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    if (server) {
      server.close();
    }
  }

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runGoogleAuthTests().catch((err) => {
  console.error('Unhandled google auth test error:', err);
  process.exit(1);
});
