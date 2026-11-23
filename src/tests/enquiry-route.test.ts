import http from "http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { enquiryService } from "../services/enquiry.service.js";
import { IEnquiry } from "../models/enquiry.model.js";
import { CreateEnquiryResult } from "../types/enquiry.types.js";
import { User, IUser } from "../models/user.model.js";
import { authService } from "../services/auth.service.js";

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Route Test User",
    email: data.email || "user@Neuways.com",
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
    name: data.name || "Route Test Lead",
    mobile: data.mobile || "9876543210",
    normalizedMobile: data.normalizedMobile || "+919876543210",
    email: data.email,
    normalizedEmail: data.normalizedEmail,
    status: data.status || "ACTIVE",
    isActive: data.isActive !== undefined ? data.isActive : true,
    assignedTo: data.assignedTo || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IEnquiry;
};

async function runRouteTests() {
  console.log("====================================================");
  console.log("Starting In-Memory Enquiry Route Integration Test");
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

  const activeSalesUser = createMockUser({
    role: "SALES",
    email: "sales@Neuways.com",
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

  const authToken = authService.generateToken({
    id: activeSalesUser.id,
    email: activeSalesUser.email,
    role: "SALES",
  });

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  try {
    // ---------------------------------------------------------------
    // 1. Healthcheck Route Verification
    // ---------------------------------------------------------------
    console.log("--- Test 1: Healthcheck Route ---");
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    const healthBody = (await healthRes.json()) as any;
    // Database is not connected in this in-memory test, expecting 503 degraded
    assert(
      healthRes.status === 503,
      "Health endpoint responds with 503 when DB is offline",
    );
    assert(
      healthBody.database === "disconnected",
      "Health endpoint reports database: disconnected",
    );

    // ---------------------------------------------------------------
    // 2. Route Path & Method Enforcement (GET /api/v1/enquiries requires auth)
    // ---------------------------------------------------------------
    console.log("\n--- Test 2: GET /api/v1/enquiries Authentication Enforcement ---");
    const getRes = await fetch(`${baseUrl}/api/v1/enquiries`);
    assert(
      getRes.status === 401,
      "Unauthenticated GET /api/v1/enquiries returns HTTP 401 Unauthorized",
    );

    const originalList = enquiryService.listEnquiries;
    enquiryService.listEnquiries = async () => ({
      success: true,
      enquiries: [],
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasMore: false,
      },
    });

    const getAuthRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      headers: authHeaders,
    });
    assert(
      getAuthRes.status === 200,
      "Authenticated GET /api/v1/enquiries returns HTTP 200 OK",
    );

    enquiryService.listEnquiries = originalList;

    // ---------------------------------------------------------------
    // 3. Unauthenticated Access Protection (HTTP 401)
    // ---------------------------------------------------------------
    console.log("\n--- Test 3: Unauthenticated Access Rejection (401) ---");
    const unauthRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Unauthenticated Lead",
        mobile: "9876543210",
      }),
    });
    assert(
      unauthRes.status === 401,
      "POST /api/v1/enquiries rejects unauthenticated requests with HTTP 401",
    );

    // ---------------------------------------------------------------
    // 4. POST /api/v1/enquiries - Successful Creation (HTTP 201)
    // ---------------------------------------------------------------
    console.log("\n--- Test 4: POST /api/v1/enquiries - Success (201) ---");
    const mockCreatedDoc = createMockEnquiry({
      name: "Vikas Sharma",
      normalizedMobile: "+919876543210",
      email: "vikas@example.com",
    });

    const originalCreate = enquiryService.createEnquiry;
    enquiryService.createEnquiry = async (): Promise<CreateEnquiryResult> => ({
      success: true,
      isDuplicate: false,
      enquiry: mockCreatedDoc,
    });

    const postSuccessRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Vikas Sharma",
        mobile: "9876543210",
        email: "vikas@example.com",
      }),
    });
    const postSuccessBody = (await postSuccessRes.json()) as any;

    assert(
      postSuccessRes.status === 201,
      "POST /api/v1/enquiries returns HTTP 201 Created",
    );
    assert(postSuccessBody.success === true, "Response body has success: true");
    assert(
      postSuccessBody.data.enquiry.name === "Vikas Sharma",
      "Response contains created enquiry data",
    );

    // ---------------------------------------------------------------
    // 5. POST /api/v1/enquiries - Duplicate Interception (HTTP 409)
    // ---------------------------------------------------------------
    console.log("\n--- Test 5: POST /api/v1/enquiries - Duplicate (409) ---");
    enquiryService.createEnquiry = async (): Promise<CreateEnquiryResult> => ({
      success: false,
      isDuplicate: true,
      duplicateType: "MOBILE_MATCH",
      message: "An active enquiry with this mobile number already exists.",
      matches: { mobileMatch: mockCreatedDoc },
      matchedEnquiries: [mockCreatedDoc],
    });

    const postDupRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Duplicate Vikas",
        mobile: "9876543210",
      }),
    });
    const postDupBody = (await postDupRes.json()) as any;

    assert(
      postDupRes.status === 409,
      "POST /api/v1/enquiries returns HTTP 409 Conflict on duplicate",
    );
    assert(
      postDupBody.isDuplicate === true,
      "Response indicates isDuplicate: true",
    );
    assert(
      postDupBody.duplicateType === "MOBILE_MATCH",
      "Duplicate type is MOBILE_MATCH",
    );
    assert(
      postDupBody.data.matchedEnquiries.length === 1,
      "Preserves matching records for UI resolution",
    );

    // ---------------------------------------------------------------
    // 6. POST /api/v1/enquiries - Cross-Field Conflict (HTTP 409)
    // ---------------------------------------------------------------
    console.log(
      "\n--- Test 6: POST /api/v1/enquiries - Cross-Field Conflict (409) ---",
    );
    const docB = createMockEnquiry({
      name: "Other Lead",
      email: "leadb@example.com",
    });

    enquiryService.createEnquiry = async (): Promise<CreateEnquiryResult> => ({
      success: false,
      isDuplicate: true,
      duplicateType: "CROSS_FIELD_MATCH",
      message:
        "The submitted mobile number matches one active enquiry, and the email matches a different active enquiry. Both matches are returned for explicit resolution.",
      matches: { mobileMatch: mockCreatedDoc, emailMatch: docB },
      matchedEnquiries: [mockCreatedDoc, docB],
    });

    const postCrossRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Cross Lead",
        mobile: "9876543210",
        email: "leadb@example.com",
      }),
    });
    const postCrossBody = (await postCrossRes.json()) as any;

    assert(
      postCrossRes.status === 409,
      "Returns HTTP 409 on cross-field match",
    );
    assert(
      postCrossBody.duplicateType === "CROSS_FIELD_MATCH",
      "Classified as CROSS_FIELD_MATCH",
    );
    assert(
      postCrossBody.data.matchedEnquiries.length === 2,
      "Returns both distinct matching records for manual resolution",
    );

    // Restore original service method
    enquiryService.createEnquiry = originalCreate;

    // ---------------------------------------------------------------
    // 7. POST /api/v1/enquiries - Validation Error (HTTP 400)
    // ---------------------------------------------------------------
    console.log(
      "\n--- Test 7: POST /api/v1/enquiries - Validation Error (400) ---",
    );
    const postInvalidRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "", // Empty name
        mobile: "9876543210",
      }),
    });
    const postInvalidBody = (await postInvalidRes.json()) as any;

    assert(
      postInvalidRes.status === 400,
      "Returns HTTP 400 when name is empty",
    );
    assert(
      postInvalidBody.error === "Validation Error",
      "Error type is Validation Error",
    );

    // ---------------------------------------------------------------
    // 8. Request Body Size Limit Check (HTTP 413)
    // ---------------------------------------------------------------
    console.log("\n--- Test 8: Request Body Limit (>50kb -> 413) ---");
    const oversizedPayload = JSON.stringify({
      name: "Big Payload",
      mobile: "9876543210",
      description: "X".repeat(60 * 1024), // 60KB
    });

    const postOversizedRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: authHeaders,
      body: oversizedPayload,
    });
    const postOversizedBody = (await postOversizedRes.json()) as any;

    assert(
      postOversizedRes.status === 413,
      "Returns HTTP 413 Payload Too Large when body > 50kb",
    );
    assert(
      postOversizedBody.error === "Payload Too Large",
      "Error type is Payload Too Large",
    );
  } finally {
    User.findById = originalFindById;
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

runRouteTests().catch((err) => {
  console.error("Unhandled route test suite error:", err);
  process.exit(1);
});
