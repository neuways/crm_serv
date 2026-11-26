import http from "http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { User, IUser } from "../models/user.model.js";
import { EnquiryActivity } from "../models/enquiry-activity.model.js";
import { authService } from "../services/auth.service.js";

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Employee",
    email: data.email || "employee@Neuways.com",
    passwordHash: "$2a$12$somevalidhash",
    role: data.role || "SALES",
    isActive: data.isActive !== undefined ? data.isActive : true,
    managerId: data.managerId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

const createMockEnquiry = (
  data: Partial<IEnquiry>,
  usersMap: Map<string, IUser>,
): IEnquiry => {
  const id = new Types.ObjectId();
  const doc = {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Lead",
    mobile: data.mobile || "9876543210",
    normalizedMobile: data.normalizedMobile || "+919876543210",
    email: data.email || "lead@example.com",
    normalizedEmail: data.normalizedEmail || "lead@example.com",
    projectName: data.projectName || "Green Acres",
    requirement: data.requirement || "3BHK",
    budgetMin: data.budgetMin !== undefined ? data.budgetMin : 5000000,
    budgetMax: data.budgetMax !== undefined ? data.budgetMax : 8000000,
    status: data.status || "ACTIVE",
    isActive: data.isActive !== undefined ? data.isActive : true,
    assignedTo: data.assignedTo || null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    save: async function () {
      this.updatedAt = new Date();
      return this;
    },
    populate: async function (path: string, _select?: string) {
      if (path === "assignedTo" && this.assignedTo) {
        const assignedUser = usersMap.get(this.assignedTo.toString());
        if (assignedUser) {
          (this as any).assignedTo = {
            id: assignedUser.id,
            name: assignedUser.name,
            email: assignedUser.email,
            role: assignedUser.role,
          };
        }
      }
      return this;
    },
  };
  return doc as unknown as IEnquiry;
};

async function runAssignTests() {
  console.log("====================================================");
  console.log("Starting In-Memory Manual Enquiry Assignment Test Suite");
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

  // Mock Users
  const adminUser = createMockUser({
    name: "Admin Boss",
    email: "admin@Neuways.com",
    role: "ADMIN",
  });
  const managerUser = createMockUser({
    name: "Team Lead",
    email: "manager@Neuways.com",
    role: "MANAGER",
  });
  const salesAgent1 = createMockUser({
    name: "Sales Agent Alpha",
    email: "alpha.sales@Neuways.com",
    role: "SALES",
    managerId: managerUser._id as any,
  });
  const salesAgent2 = createMockUser({
    name: "Sales Agent Beta",
    email: "beta.sales@Neuways.com",
    role: "SALES",
    managerId: managerUser._id as any,
  });
  const inactiveSalesAgent = createMockUser({
    name: "Inactive Agent",
    email: "inactive.sales@Neuways.com",
    role: "SALES",
    isActive: false,
  });

  const usersMap = new Map<string, IUser>([
    [adminUser.id, adminUser],
    [managerUser.id, managerUser],
    [salesAgent1.id, salesAgent1],
    [salesAgent2.id, salesAgent2],
    [inactiveSalesAgent.id, inactiveSalesAgent],
  ]);

  const enquiriesMap = new Map<string, IEnquiry>();

  // Tokens
  const adminToken = authService.generateToken({
    id: adminUser.id,
    email: adminUser.email,
    role: "ADMIN",
  });
  const managerToken = authService.generateToken({
    id: managerUser.id,
    email: managerUser.email,
    role: "MANAGER",
  });
  const salesToken = authService.generateToken({
    id: salesAgent1.id,
    email: salesAgent1.email,
    role: "SALES",
  });

  // Hook Mongoose Model methods
  const originalUserFindById = User.findById;
  const originalEnquiryFindById = Enquiry.findById;
  const originalActivitySave = EnquiryActivity.prototype.save;

  EnquiryActivity.prototype.save = function (this: any) {
    return Promise.resolve(this);
  };

  User.findById = ((id: any) => ({
    select: () => {
      const u = usersMap.get(id?.toString());
      return Promise.resolve(u || null);
    },
  })) as any;

  Enquiry.findById = ((id: any) => {
    const e = enquiriesMap.get(id?.toString());
    return Promise.resolve(e || null);
  }) as any;

  try {
    // -----------------------------------------------------------------
    // 1. ADMIN assigns an unassigned enquiry (HTTP 200)
    // -----------------------------------------------------------------
    console.log("--- Test 1: ADMIN Assigns Unassigned Enquiry ---");
    const enquiry1 = createMockEnquiry(
      { name: "Lead for Admin Assignment", assignedTo: null },
      usersMap,
    );
    enquiriesMap.set(enquiry1.id, enquiry1);

    const res1 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const body1 = (await res1.json()) as any;

    assert(res1.status === 200, "ADMIN assignment returns HTTP 200 OK");
    assert(body1.success === true, "Response specifies success: true");
    assert(
      body1.message === "Enquiry successfully assigned.",
      "Returns confirmation message",
    );
    assert(
      body1.data.enquiry.assignedTo.id === salesAgent1.id,
      "Enquiry assignedTo matches Sales Agent 1",
    );
    assert(
      body1.data.enquiry.assignedTo.name === "Sales Agent Alpha",
      "Assignee name populated",
    );

    // -----------------------------------------------------------------
    // 2. MANAGER assigns a manager-held enquiry (HTTP 200) & blocked on sales-held (HTTP 403)
    // -----------------------------------------------------------------
    console.log("\n--- Test 2: MANAGER Assigns Manager-Held Enquiry & Blocked on Sales-Held ---");
    const enquiry2 = createMockEnquiry(
      {
        name: "Lead Held by Manager",
        assignedTo: managerUser._id as Types.ObjectId,
      },
      usersMap,
    );
    enquiriesMap.set(enquiry2.id, enquiry2);

    const res2 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry2.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    const body2 = (await res2.json()) as any;

    assert(res2.status === 200, "MANAGER assignment of manager-held lead returns HTTP 200 OK");
    assert(body2.success === true, "Response specifies success: true");
    assert(
      body2.data.enquiry.assignedTo.id === salesAgent2.id,
      "Enquiry successfully assigned from Manager to Sales Agent 2",
    );

    const salesHeldLead = createMockEnquiry(
      {
        name: "Lead Held by Sales Agent",
        assignedTo: salesAgent1._id as Types.ObjectId,
      },
      usersMap,
    );
    enquiriesMap.set(salesHeldLead.id, salesHeldLead);

    const res2Blocked = await fetch(
      `${baseUrl}/api/v1/enquiries/${salesHeldLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    const body2Blocked = (await res2Blocked.json()) as any;
    assert(
      res2Blocked.status === 403 && body2Blocked.success === false,
      "MANAGER attempting to reassign a lead held by a Sales Agent returns HTTP 403 Forbidden",
    );

    // -----------------------------------------------------------------
    // 3. Invalid enquiry ID (HTTP 400)
    // -----------------------------------------------------------------
    console.log("\n--- Test 3: Invalid Enquiry ID Format ---");
    const res3 = await fetch(
      `${baseUrl}/api/v1/enquiries/invalid-not-an-id/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const body3 = (await res3.json()) as any;

    assert(res3.status === 400, "Returns HTTP 400 on malformed enquiry ID");
    assert(
      body3.error === "Validation Error",
      "Error indicates Validation Error",
    );
    assert(
      body3.message.includes("Invalid enquiry ID"),
      "Message specifies invalid enquiry ID",
    );

    // -----------------------------------------------------------------
    // 4. Missing enquiry (HTTP 404)
    // -----------------------------------------------------------------
    console.log("\n--- Test 4: Missing Enquiry ---");
    const nonExistentEnquiryId = new Types.ObjectId().toString();
    const res4 = await fetch(
      `${baseUrl}/api/v1/enquiries/${nonExistentEnquiryId}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const body4 = (await res4.json()) as any;

    assert(res4.status === 404, "Returns HTTP 404 when enquiry not found");
    assert(body4.error === "Not Found", "Error indicates Not Found");
    assert(
      body4.message === "Enquiry not found",
      "Message specifies Enquiry not found",
    );

    // -----------------------------------------------------------------
    // 5. Invalid assignee ID (HTTP 400)
    // -----------------------------------------------------------------
    console.log("\n--- Test 5: Invalid Assignee ID Format ---");
    const res5 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: "123-not-an-objectid" }),
      },
    );
    const body5 = (await res5.json()) as any;

    assert(res5.status === 400, "Returns HTTP 400 on malformed assignedToId");
    assert(
      body5.error === "Validation Error",
      "Error indicates Validation Error",
    );
    assert(
      body5.message.includes("assignedToId must be a valid MongoDB ObjectId"),
      "Identifies invalid ObjectId",
    );

    // -----------------------------------------------------------------
    // 6. Missing assignee (HTTP 404)
    // -----------------------------------------------------------------
    console.log("\n--- Test 6: Missing Assignee ---");
    const nonExistentUserId = new Types.ObjectId().toString();
    const res6 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: nonExistentUserId }),
      },
    );
    const body6 = (await res6.json()) as any;

    assert(
      res6.status === 404,
      "Returns HTTP 404 when assignee does not exist",
    );
    assert(body6.error === "Not Found", "Error indicates Not Found");
    assert(
      body6.message === "Assignee employee not found",
      "Message indicates Assignee employee not found",
    );

    // -----------------------------------------------------------------
    // 7. Inactive assignee (HTTP 400)
    // -----------------------------------------------------------------
    console.log("\n--- Test 7: Inactive Assignee ---");
    const res7 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: inactiveSalesAgent.id }),
      },
    );
    const body7 = (await res7.json()) as any;

    assert(
      res7.status === 400,
      "Returns HTTP 400 when assigning to inactive employee",
    );
    assert(
      body7.message.includes("deactivated employee account"),
      "Identifies deactivated account rejection",
    );

    // -----------------------------------------------------------------
    // 8. Unauthenticated request (HTTP 401)
    // -----------------------------------------------------------------
    console.log("\n--- Test 8: Unauthenticated Access ---");
    const res8 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    assert(
      res8.status === 401,
      "Rejects unauthenticated request with HTTP 401",
    );

    // -----------------------------------------------------------------
    // 9. SALES assignment attempt returns 403 (HTTP 403)
    // -----------------------------------------------------------------
    console.log("\n--- Test 9: SALES Assignment Attempt Rejection (403) ---");
    const res9 = await fetch(
      `${baseUrl}/api/v1/enquiries/${enquiry1.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const body9 = (await res9.json()) as any;

    assert(
      res9.status === 403,
      "Rejects SALES assignment attempt with HTTP 403 Forbidden",
    );
    assert(body9.error === "Forbidden", "Error indicates Forbidden");
    assert(
      body9.message.includes(
        "Requires one of the following roles: ADMIN, MANAGER",
      ),
      "Cites required roles",
    );

    // -----------------------------------------------------------------
    // 10. Existing enquiry fields remain unchanged except assignment
    // -----------------------------------------------------------------
    console.log("\n--- Test 10: Invariant Preservation Across Assignment ---");
    const pristineEnquiry = createMockEnquiry(
      {
        name: "Immutable Prospect",
        mobile: "9811122233",
        normalizedMobile: "+919811122233",
        email: "prospect@gmail.com",
        normalizedEmail: "prospect@gmail.com",
        projectName: "Royal Palm",
        requirement: "4BHK Villa",
        budgetMin: 12000000,
        budgetMax: 15000000,
        status: "ACTIVE",
        isActive: true,
        assignedTo: null,
      },
      usersMap,
    );
    enquiriesMap.set(pristineEnquiry.id, pristineEnquiry);

    const res10 = await fetch(
      `${baseUrl}/api/v1/enquiries/${pristineEnquiry.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    const body10 = (await res10.json()) as any;

    assert(res10.status === 200, "Assignment succeeds for field check");
    assert(body10.data.enquiry.name === "Immutable Prospect", "Name unchanged");
    assert(body10.data.enquiry.mobile === "9811122233", "Mobile unchanged");
    assert(
      body10.data.enquiry.normalizedMobile === "+919811122233",
      "Normalized mobile unchanged",
    );
    assert(
      body10.data.enquiry.email === "prospect@gmail.com",
      "Email unchanged",
    );
    assert(
      body10.data.enquiry.normalizedEmail === "prospect@gmail.com",
      "Normalized email unchanged",
    );
    assert(
      body10.data.enquiry.projectName === "Royal Palm",
      "Project name unchanged",
    );
    assert(
      body10.data.enquiry.requirement === "4BHK Villa",
      "Requirement unchanged",
    );
    assert(body10.data.enquiry.budgetMin === 12000000, "Budget min unchanged");
    assert(body10.data.enquiry.budgetMax === 15000000, "Budget max unchanged");
    assert(
      body10.data.enquiry.status === "ACTIVE",
      "Status unchanged (ACTIVE)",
    );
    assert(body10.data.enquiry.isActive === true, "isActive unchanged (true)");
    assert(
      body10.data.enquiry.assignedTo.id === salesAgent2.id,
      "Only assignedTo was updated",
    );
  } finally {
    User.findById = originalUserFindById;
    Enquiry.findById = originalEnquiryFindById;
    EnquiryActivity.prototype.save = originalActivitySave;
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

runAssignTests().catch((err) => {
  console.error("Unhandled assignment test suite error:", err);
  process.exit(1);
});
