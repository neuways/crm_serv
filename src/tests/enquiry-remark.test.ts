import http from "http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { User, IUser } from "../models/user.model.js";
import {
  EnquiryActivity,
  IEnquiryActivity,
  AppendOnlyViolationError,
} from "../models/enquiry-activity.model.js";
import { SecurityLog } from "../models/security-log.model.js";
import { authService } from "../services/auth.service.js";

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    ...data,
    _id: id,
    id: id.toString(),
    name: data.name || "Test User",
    email: data.email || "user@Neuways.com",
    passwordHash: "$2a$12$somehash",
    role: data.role || "SALES",
    isActive: data.isActive !== undefined ? data.isActive : true,
    managerId: data.managerId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

const createMockEnquiry = (data: Partial<IEnquiry>): IEnquiry => {
  const id = new Types.ObjectId();
  return {
    ...data,
    _id: id,
    id: id.toString(),
    name: data.name || "Test Prospect",
    mobile: data.mobile || "9876543210",
    normalizedMobile: data.normalizedMobile || "+919876543210",
    email: data.email || "lead@example.com",
    status: data.status || "ACTIVE",
    isActive: data.isActive !== undefined ? data.isActive : true,
    assignedTo: data.assignedTo || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IEnquiry;
};

async function runRemarkTests() {
  console.log("====================================================");
  console.log("Starting Enquiry Remark API & Validation Test Suite");
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
    name: "Manager Lead",
    email: "manager@Neuways.com",
    role: "MANAGER",
  });
  const salesUser = createMockUser({
    name: "Sales Agent Alpha",
    email: "sales@Neuways.com",
    role: "SALES",
    managerId: managerUser._id,
  });

  const usersMap = new Map<string, IUser>([
    [adminUser.id, adminUser],
    [managerUser.id, managerUser],
    [salesUser.id, salesUser],
  ]);

  const enquiriesMap = new Map<string, IEnquiry>();
  const savedActivities: any[] = [];

  // Generate Tokens
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
    id: salesUser.id,
    email: salesUser.email,
    role: "SALES",
  });

  // Hook Models
  const originalUserFindById = User.findById;
  const originalEnquiryFindById = Enquiry.findById;
  const originalActivitySave = EnquiryActivity.prototype.save;
  const originalSecurityLogSave = SecurityLog.prototype.save;

  SecurityLog.prototype.save = async function (this: any) {
    return this;
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

  // Intercept EnquiryActivity save to capture records in-memory while preserving append-only checks
  EnquiryActivity.prototype.save = async function (this: any) {
    if (!this.isNew) {
      throw new AppendOnlyViolationError(
        "EnquiryActivity is append-only: existing activity records cannot be modified",
      );
    }
    const doc = {
      _id: this._id || new Types.ObjectId(),
      id: (this._id || new Types.ObjectId()).toString(),
      enquiryId: this.enquiryId,
      performedBy: this.performedBy,
      performedByName: this.performedByName,
      createdById: this.createdById || this.performedBy,
      createdByName: this.createdByName || this.performedByName,
      type: this.type,
      note: this.note,
      metadata: this.metadata || {},
      createdAt: this.createdAt || new Date(),
    };
    savedActivities.push(doc);
    return doc as any;
  };

  try {
    // Standard Active Enquiry
    const activeEnquiry = createMockEnquiry({
      name: "Active Prospect",
      status: "ACTIVE",
      assignedTo: salesUser._id,
    });
    enquiriesMap.set(activeEnquiry.id, activeEnquiry);

    // CLOSED Enquiry
    const closedEnquiry = createMockEnquiry({
      name: "Closed Deal Lead",
      status: "CLOSED",
      isActive: false,
      assignedTo: salesUser._id,
    });
    enquiriesMap.set(closedEnquiry.id, closedEnquiry);

    // -----------------------------------------------------------------
    // Suite 1: Role-Based Authorization for Remark Creation
    // -----------------------------------------------------------------
    console.log("--- Suite 1: Role-Based Authorization ---");

    // 1A: ADMIN successful remark creation
    const adminRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "ADMIN confirmed budget approval." }),
      },
    );
    const adminBody = (await adminRes.json()) as any;

    assert(
      adminRes.status === 201,
      "ADMIN remark creation returns HTTP 201 Created",
    );
    assert(adminBody.success === true, "Response specifies success: true");
    assert(
      adminBody.data.activity.type === "REMARK_ADDED",
      "Activity type is REMARK_ADDED",
    );
    assert(
      adminBody.data.activity.performedByName === "Admin Boss",
      "Captures ADMIN name snapshot",
    );

    // 1B: MANAGER successful remark creation
    const managerRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          remark: "MANAGER assigned priority follow-up.",
        }),
      },
    );
    const managerBody = (await managerRes.json()) as any;

    assert(
      managerRes.status === 201,
      "MANAGER remark creation returns HTTP 201 Created",
    );
    assert(
      managerBody.data.activity.performedByName === "Manager Lead",
      "Captures MANAGER name snapshot",
    );

    // 1C: SALES successful remark creation
    const salesRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "SALES conducted physical site inspection.",
        }),
      },
    );
    const salesBody = (await salesRes.json()) as any;

    assert(
      salesRes.status === 201,
      "SALES remark creation returns HTTP 201 Created",
    );
    assert(
      salesBody.data.activity.performedByName === "Sales Agent Alpha",
      "Captures SALES name snapshot",
    );

    // 1D: Missing Authentication (HTTP 401)
    const unauthRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: "Unauthenticated attempt" }),
      },
    );
    assert(
      unauthRes.status === 401,
      "Rejects unauthenticated remark creation with HTTP 401",
    );

    // -----------------------------------------------------------------
    // Suite 2: Enquiry Lifecycle & Parameter Validation
    // -----------------------------------------------------------------
    console.log(
      "\n--- Suite 2: Enquiry Validation & CLOSED Enquiry Behavior ---",
    );

    // 2A: Remarks on CLOSED enquiry succeed (Requirement: CLOSED enquiries can receive remarks)
    const closedRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${closedEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "Client reopened contact after initial closing.",
        }),
      },
    );
    const closedBody = (await closedRes.json()) as any;

    assert(
      closedRes.status === 201,
      "CLOSED enquiry can receive remarks (HTTP 201 Created)",
    );
    assert(
      closedBody.success === true,
      "Response specifies success: true for CLOSED enquiry",
    );

    // 2B: Missing Enquiry (HTTP 404)
    const nonExistentId = new Types.ObjectId().toString();
    const missingEnquiryRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${nonExistentId}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "Valid remark on missing enquiry" }),
      },
    );
    const missingEnquiryBody = (await missingEnquiryRes.json()) as any;

    assert(
      missingEnquiryRes.status === 404,
      "Returns HTTP 404 when enquiry not found",
    );
    assert(
      missingEnquiryBody.message === "Enquiry not found",
      "Message identifies Enquiry not found",
    );

    // 2C: Invalid Enquiry ID Format (HTTP 400)
    const invalidIdRes = await fetch(
      `${baseUrl}/api/v1/enquiries/invalid-not-id/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "Valid remark on bad id" }),
      },
    );
    assert(
      invalidIdRes.status === 400,
      "Returns HTTP 400 on malformed enquiry ID",
    );

    // -----------------------------------------------------------------
    // Suite 3: Remark Input & Length Validation
    // -----------------------------------------------------------------
    console.log("\n--- Suite 3: Remark Content Validation ---");

    // 3A: Empty remark (HTTP 400)
    const emptyRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "" }),
      },
    );
    const emptyBody = (await emptyRes.json()) as any;
    assert(emptyRes.status === 400, "Rejects empty remark with HTTP 400");
    assert(
      emptyBody.message.includes("cannot be empty"),
      "Identifies empty remark error",
    );

    // 3B: Whitespace-only remark (HTTP 400)
    const whitespaceRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "    \n\t   " }),
      },
    );
    assert(
      whitespaceRes.status === 400,
      "Rejects whitespace-only remark with HTTP 400",
    );

    // 3C: Over 2,000 characters remark (HTTP 400)
    const overLengthRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ remark: "A".repeat(2001) }),
      },
    );
    const overLengthBody = (await overLengthRes.json()) as any;
    assert(
      overLengthRes.status === 400,
      "Rejects remarks exceeding 2,000 characters with HTTP 400",
    );
    assert(
      overLengthBody.message.includes("2000 characters"),
      "Identifies 2000 character limit",
    );

    // -----------------------------------------------------------------
    // Suite 4: Sensitive-Content Detection (Credentials & OTPs)
    // -----------------------------------------------------------------
    console.log(
      "\n--- Suite 4: Prohibited Secrets Detection (Credentials & OTPs) ---",
    );

    const activitiesBeforeSecretAttempts = savedActivities.length;

    // 4A: Password in remark (HTTP 400)
    const passwordRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "Customer told me password: SuperSecret123!",
        }),
      },
    );
    const passwordBody = (await passwordRes.json()) as any;

    assert(
      passwordRes.status === 400,
      "Rejects password in remark with HTTP 400",
    );
    assert(
      passwordBody.message.includes("prohibited sensitive content"),
      "Identifies prohibited content violation",
    );
    assert(
      !JSON.stringify(passwordBody).includes("SuperSecret123!"),
      "Never leaks secret in response payload",
    );

    // 4B: API Key / Bearer Token in remark (HTTP 400)
    const tokenRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark:
            "Used Bearer abcdef1234567890abcdef1234567890 to authenticate",
        }),
      },
    );
    assert(tokenRes.status === 400, "Rejects Bearer token with HTTP 400");

    // 4C: OTP in remark (HTTP 400)
    const otpRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "Client OTP is 849201 for portal verification.",
        }),
      },
    );
    const otpBody = (await otpRes.json()) as any;

    assert(otpRes.status === 400, "Rejects OTP in remark with HTTP 400");
    assert(
      otpBody.message.includes("prohibited sensitive content"),
      "Identifies OTP as prohibited",
    );
    assert(
      !JSON.stringify(otpBody).includes("849201"),
      "Never leaks OTP in response payload",
    );

    // 4D: Invariant: Nothing was saved for prohibited secret attempts
    assert(
      savedActivities.length === activitiesBeforeSecretAttempts,
      "Zero activities saved in EnquiryActivity when secrets/credentials are detected",
    );

    // -----------------------------------------------------------------
    // Suite 5: Contact Details Warning & Confirmation Flow
    // -----------------------------------------------------------------
    console.log("\n--- Suite 5: Contact Details Warning & Confirmation ---");

    // 5A: Mobile detected without confirmation (HTTP 400 Warning)
    const mobileWarnRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark:
            "Client can also be reached on mobile 9876543210 during weekends.",
          confirmContactDetails: false,
        }),
      },
    );
    const mobileWarnBody = (await mobileWarnRes.json()) as any;

    assert(
      mobileWarnRes.status === 400,
      "Returns HTTP 400 warning when mobile detected without confirmation",
    );
    assert(
      mobileWarnBody.requiresConfirmation === true,
      "Response specifies requiresConfirmation: true",
    );
    assert(
      mobileWarnBody.data.detectedTypes.includes("MOBILE"),
      "Lists MOBILE in detectedTypes",
    );

    // 5B: Email detected without confirmation (HTTP 400 Warning)
    const emailWarnRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "Send payment receipt to buyer@example.com directly.",
        }),
      },
    );
    const emailWarnBody = (await emailWarnRes.json()) as any;

    assert(
      emailWarnRes.status === 400,
      "Returns HTTP 400 warning when email detected without confirmation",
    );
    assert(
      emailWarnBody.requiresConfirmation === true,
      "Response specifies requiresConfirmation: true",
    );
    assert(
      emailWarnBody.data.detectedTypes.includes("EMAIL"),
      "Lists EMAIL in detectedTypes",
    );

    // 5C: Both Mobile and Email detected without confirmation (HTTP 400 Warning)
    const bothWarnRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark:
            "Alternate: call +91 98765 43210 or email lead.vip@company.org",
        }),
      },
    );
    const bothWarnBody = (await bothWarnRes.json()) as any;

    assert(
      bothWarnRes.status === 400,
      "Returns HTTP 400 warning on mobile + email",
    );
    assert(
      bothWarnBody.data.detectedTypes.includes("MOBILE"),
      "Includes MOBILE in detected types",
    );
    assert(
      bothWarnBody.data.detectedTypes.includes("EMAIL"),
      "Includes EMAIL in detected types",
    );

    // 5D: Explicit confirmation saves remark with confirmation metadata (HTTP 201)
    const countBeforeConfirmedSave = savedActivities.length;
    const confirmRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark:
            "Alternate: call +91 98765 43210 or email lead.vip@company.org",
          confirmContactDetails: true,
        }),
      },
    );
    const confirmBody = (await confirmRes.json()) as any;

    assert(
      confirmRes.status === 201,
      "Explicit confirmation allows saving remark (HTTP 201 Created)",
    );
    assert(confirmBody.success === true, "Response specifies success: true");
    assert(
      confirmBody.data.activity.metadata.contactDetailsWarningConfirmed ===
        true,
      "Sets contactDetailsWarningConfirmed: true in activity metadata",
    );
    assert(
      confirmBody.data.activity.metadata.detectedContactTypes.includes(
        "MOBILE",
      ) &&
        confirmBody.data.activity.metadata.detectedContactTypes.includes(
          "EMAIL",
        ),
      "Preserves detectedContactTypes in activity metadata",
    );
    assert(
      savedActivities.length === countBeforeConfirmedSave + 1,
      "Exactly one activity record was saved",
    );

    // -----------------------------------------------------------------
    // Suite 6: Append-Only Safeguard Verification on Saved Remark
    // -----------------------------------------------------------------
    console.log("\n--- Suite 6: Immutability Verification on Saved Remark ---");

    // Attempting to modify an activity via doc.save() with isNew=false must fail
    const lastSaved = savedActivities[savedActivities.length - 1];
    const activityDoc = new EnquiryActivity(lastSaved);
    activityDoc.isNew = false;
    activityDoc.note = "Illicit tamper of audit note";

    let tamperError: any = null;
    try {
      await activityDoc.save();
    } catch (err) {
      tamperError = err;
    }

    assert(tamperError !== null, "Existing remark activity cannot be modified");
    assert(
      tamperError instanceof AppendOnlyViolationError,
      "Throws AppendOnlyViolationError",
    );
  } finally {
    User.findById = originalUserFindById;
    Enquiry.findById = originalEnquiryFindById;
    EnquiryActivity.prototype.save = originalActivitySave;
    SecurityLog.prototype.save = originalSecurityLogSave;
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

runRemarkTests().catch((err) => {
  console.error("Unhandled remark test suite error:", err);
  process.exit(1);
});
