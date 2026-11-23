import http from "http";
import { Types } from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { User, IUser } from "../models/user.model.js";
import { authService } from "../services/auth.service.js";
import { enquiryService } from "../services/enquiry.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { env } from "../config/env.js";
import { IEnquiry } from "../models/enquiry.model.js";

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Employee",
    email: data.email || "employee@Neuways.com",
    passwordHash: data.passwordHash || "",
    role: data.role || "SALES",
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

const createMockEnquiry = (data: Partial<IEnquiry>): IEnquiry => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Lead",
    mobile: data.mobile || "9876543210",
    normalizedMobile: data.normalizedMobile || "+919876543210",
    status: "ACTIVE",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IEnquiry;
};

async function runAuthTests() {
  console.log("====================================================");
  console.log("Starting In-Memory Authentication & RBAC Test Suite");
  console.log("====================================================\n");

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || "Assertion failed"}`);
      failed++;
    }
  };

  const app = createApp();
  let server: http.Server | undefined;
  let baseUrl = "";

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server!.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  try {
    // ---------------------------------------------------------------
    // Suite 1: Password Hashing & Verification
    // ---------------------------------------------------------------
    console.log("--- Suite 1: Password Hashing & Verification ---");
    const plainPassword = "SuperSecretPassword123!";
    const hash = await authService.hashPassword(plainPassword);

    assert(hash !== plainPassword, "Password is not stored in plaintext");
    assert(hash.startsWith("$2"), "Produces valid bcrypt hash signature");

    const isMatch = await authService.verifyPassword(plainPassword, hash);
    assert(isMatch === true, "Verifies correct password against hash");

    const isWrongMatch = await authService.verifyPassword(
      "WrongPassword123!",
      hash,
    );
    assert(isWrongMatch === false, "Rejects incorrect password");

    // Verify Mongoose schema toJSON transform strips passwordHash
    const testUserDoc = new User({
      name: "Serial Test",
      email: "serial@Neuways.com",
      passwordHash: hash,
      role: "SALES",
    });
    const serializedJson = testUserDoc.toJSON();
    assert(
      serializedJson.passwordHash === undefined,
      "Schema toJSON transform strips passwordHash",
    );

    // ---------------------------------------------------------------
    // Suite 2: POST /api/v1/auth/login
    // ---------------------------------------------------------------
    console.log("\n--- Suite 2: POST /api/v1/auth/login ---");
    const mockUser = createMockUser({
      email: "sales.agent@Neuways.com",
      passwordHash: hash,
      role: "SALES",
      isActive: true,
    });

    const originalFindOne = User.findOne;

    // Test 2A: Valid login
    User.findOne = ((query: any) => ({
      select: () => {
        if (query.email === "sales.agent@Neuways.com") {
          return Promise.resolve(mockUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    const validLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sales.agent@Neuways.com",
        password: plainPassword,
      }),
    });
    const validLoginBody = (await validLoginRes.json()) as any;

    assert(
      validLoginRes.status === 200,
      "Returns HTTP 200 on valid credentials",
    );
    assert(validLoginBody.success === true, "Response specifies success: true");
    assert(
      typeof validLoginBody.data.token === "string",
      "Returns signed JWT access token",
    );
    assert(
      validLoginBody.data.user.email === "sales.agent@Neuways.com",
      "Returns user profile",
    );
    assert(
      validLoginBody.data.user.passwordHash === undefined,
      "Never returns passwordHash in API response",
    );

    // Test 2B: Wrong password (generic error)
    const wrongPassRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sales.agent@Neuways.com",
        password: "IncorrectPassword!",
      }),
    });
    const wrongPassBody = (await wrongPassRes.json()) as any;

    assert(
      wrongPassRes.status === 401,
      "Returns HTTP 401 on incorrect password",
    );
    assert(
      wrongPassBody.message === "Invalid email or password",
      "Uses generic error message",
    );

    // Test 2C: Non-existent email (generic error)
    const nonExistentRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@Neuways.com",
        password: plainPassword,
      }),
    });
    const nonExistentBody = (await nonExistentRes.json()) as any;

    assert(
      nonExistentRes.status === 401,
      "Returns HTTP 401 on non-existent email",
    );
    assert(
      nonExistentBody.message === "Invalid email or password",
      "Uses identical generic message to prevent enumeration",
    );

    // Test 2D: Deactivated account (isActive: false)
    const inactiveUser = createMockUser({
      email: "inactive@Neuways.com",
      passwordHash: hash,
      isActive: false,
    });

    User.findOne = ((query: any) => ({
      select: () => {
        if (query.email === "inactive@Neuways.com") {
          return Promise.resolve(inactiveUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    const inactiveRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "inactive@Neuways.com",
        password: plainPassword,
      }),
    });
    const inactiveBody = (await inactiveRes.json()) as any;

    assert(
      inactiveRes.status === 401,
      "Returns HTTP 401 for deactivated account",
    );
    assert(
      inactiveBody.message.includes("Account is deactivated"),
      "Informs that account is deactivated",
    );

    // Restore findOne
    User.findOne = originalFindOne;

    // ---------------------------------------------------------------
    // Suite 3: Token Verification & Middleware Guards
    // ---------------------------------------------------------------
    console.log(
      "\n--- Suite 3: Token Verification & requireAuth Middleware ---",
    );
    const activeSalesUser = createMockUser({
      name: "Priya Sales",
      email: "priya@Neuways.com",
      role: "SALES",
      isActive: true,
    });

    const originalFindById = User.findById;
    User.findById = ((id: any) => ({
      select: () => {
        if (id.toString() === activeSalesUser.id) {
          return Promise.resolve(activeSalesUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    // Mock enquiry service create to return success
    const originalCreateEnquiry = enquiryService.createEnquiry;
    enquiryService.createEnquiry = async () => ({
      success: true,
      isDuplicate: false,
      enquiry: createMockEnquiry({ name: "Lead for Auth Test" }),
    });

    // Test 3A: Request with no token
    const noTokenRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    assert(
      noTokenRes.status === 401,
      "Rejects request missing Authorization header with HTTP 401",
    );

    // Test 3B: Malformed Authorization header
    const malformedHeaderRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic not-a-bearer-token",
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    assert(
      malformedHeaderRes.status === 401,
      "Rejects malformed Authorization header with HTTP 401",
    );

    // Test 3C: Invalid / Tampered Token
    const tamperedTokenRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.tampered.token",
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    assert(
      tamperedTokenRes.status === 401,
      "Rejects tampered JWT token with HTTP 401",
    );

    // Test 3C-2: Disallowed Algorithm (none)
    const noneAlgorithmToken = jwt.sign(
      { sub: activeSalesUser.id, email: activeSalesUser.email, role: "SALES" },
      "",
      { algorithm: "none" },
    );
    const noneAlgRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${noneAlgorithmToken}`,
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    assert(
      noneAlgRes.status === 401,
      "Rejects token signed with disallowed algorithm (none) with HTTP 401",
    );

    // Test 3D: Expired Token
    const expiredToken = jwt.sign(
      { sub: activeSalesUser.id, email: activeSalesUser.email, role: "SALES" },
      env.JWT_SECRET,
      { expiresIn: "-1s" }, // Expired 1 second ago
    );

    const expiredTokenRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${expiredToken}`,
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    assert(
      expiredTokenRes.status === 401,
      "Rejects expired JWT token with HTTP 401",
    );

    // Test 3E: User deleted from database after token was issued
    const orphanToken = authService.generateToken({
      id: new Types.ObjectId().toString(),
      email: "deleted@Neuways.com",
      role: "SALES",
    });

    const orphanRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${orphanToken}`,
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    const orphanBody = (await orphanRes.json()) as any;
    assert(
      orphanRes.status === 401,
      "Rejects token if user no longer exists in DB",
    );
    assert(
      orphanBody.message.includes("User account no longer exists"),
      "Identifies non-existent user",
    );

    // Test 3F: User deactivated in database after token was issued
    const deactivatedDbUser = createMockUser({
      name: "Deactivated User",
      email: "deactivated@Neuways.com",
      role: "SALES",
      isActive: false,
    });

    User.findById = ((id: any) => ({
      select: () => {
        if (id.toString() === deactivatedDbUser.id) {
          return Promise.resolve(deactivatedDbUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    const deactivatedToken = authService.generateToken({
      id: deactivatedDbUser.id,
      email: deactivatedDbUser.email,
      role: "SALES",
    });

    const deactivatedRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deactivatedToken}`,
      },
      body: JSON.stringify({ name: "Test", mobile: "9876543210" }),
    });
    const deactivatedBody = (await deactivatedRes.json()) as any;
    assert(
      deactivatedRes.status === 401,
      "Rejects token if user was deactivated in DB",
    );
    assert(
      deactivatedBody.message.includes("deactivated"),
      "Identifies deactivated account",
    );

    // ---------------------------------------------------------------
    // Suite 4: Role Authorization & Current DB Role Enforcement
    // ---------------------------------------------------------------
    console.log("\n--- Suite 4: Role-Based Authorization & DB Invariant ---");

    // User whose DB role was changed from ADMIN to SALES after token was issued
    const demotedDbUser = createMockUser({
      name: "Demoted User",
      email: "demoted@Neuways.com",
      role: "SALES", // Current DB role is SALES
      isActive: true,
    });

    User.findById = ((id: any) => ({
      select: () => {
        if (id.toString() === demotedDbUser.id) {
          return Promise.resolve(demotedDbUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    // Token was minted when user was 'ADMIN'
    const oldAdminToken = authService.generateToken({
      id: demotedDbUser.id,
      email: demotedDbUser.email,
      role: "ADMIN", // Claim in token is ADMIN
    });

    const verifiedRole = await new Promise<string>((resolve) => {
      const mockReq: any = {
        headers: { authorization: `Bearer ${oldAdminToken}` },
      };
      const mockRes: any = { status: () => ({ json: () => {} }) };
      requireAuth(mockReq, mockRes, () => {
        resolve(mockReq.user.role);
      });
    });

    assert(
      verifiedRole === "SALES",
      "Overrides old token role claim with fresh role from MongoDB",
    );

    // ---------------------------------------------------------------
    // Suite 5: Protected Enquiry Route Regression
    // ---------------------------------------------------------------
    console.log("\n--- Suite 5: Protected Enquiry Route Regression ---");

    // Set User.findById back to valid active sales user
    User.findById = ((id: any) => ({
      select: () => {
        if (id.toString() === activeSalesUser.id) {
          return Promise.resolve(activeSalesUser);
        }
        return Promise.resolve(null);
      },
    })) as any;

    const validToken = authService.generateToken({
      id: activeSalesUser.id,
      email: activeSalesUser.email,
      role: "SALES",
    });

    const validProtectedRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        name: "Protected Lead",
        mobile: "9876543210",
      }),
    });
    const validProtectedBody = (await validProtectedRes.json()) as any;

    assert(
      validProtectedRes.status === 201,
      "Allows authenticated SALES agent to create enquiry (HTTP 201)",
    );
    assert(
      validProtectedBody.success === true,
      "Enquiry response envelope intact",
    );

    // Restore mocks
    User.findById = originalFindById;
    enquiryService.createEnquiry = originalCreateEnquiry;
  } finally {
    if (server) {
      server.close();
    }
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log("\n====================================================");
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("====================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch((err) => {
  console.error("Unhandled auth test suite error:", err);
  process.exit(1);
});
