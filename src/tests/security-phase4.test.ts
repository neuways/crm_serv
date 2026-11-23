import http from "http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { User, IUser } from "../models/user.model.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { EnquiryActivity } from "../models/enquiry-activity.model.js";
import { SecurityLog, ISecurityLog } from "../models/security-log.model.js";
import { Alert, IAlert, AlertStatus } from "../models/alert.model.js";
import { authService } from "../services/auth.service.js";
import {
  securityService,
  setEmailDispatcherForTest,
} from "../services/security.service.js";

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Test User",
    email: data.email || "user@Neuways.com",
    role: data.role || "SALES",
    isActive: data.isActive !== undefined ? data.isActive : true,
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
    name: data.name || "Sample Prospect",
    mobile: data.mobile || "9876543210",
    normalizedMobile: "+919876543210",
    status: data.status || "ACTIVE",
    isActive: data.isActive !== undefined ? data.isActive : true,
    assignedTo: data.assignedTo || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      return this;
    },
    populate: async function () {
      return this;
    },
  } as unknown as IEnquiry;
};

async function runSecurityPhase4Tests() {
  console.log("====================================================");
  console.log("Starting Step 11 Phase 4 Test Suite");
  console.log("Restricted Security Logs, Retention Cleanup & Alerts");
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

  // Users
  const adminUser = createMockUser({
    name: "Admin Director",
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
  });

  const usersMap = new Map<string, IUser>([
    [adminUser.id, adminUser],
    [managerUser.id, managerUser],
    [salesUser.id, salesUser],
  ]);

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

  // In-memory data stores
  const enquiriesMap = new Map<string, IEnquiry>();
  const savedActivities: any[] = [];
  const savedSecurityLogs: any[] = [];
  const savedAlerts: any[] = [];

  // Track email dispatches
  let emailDispatchCount = 0;
  setEmailDispatcherForTest(async (_alert: IAlert) => {
    emailDispatchCount++;
    return { sent: true };
  });

  // Hook User.findById
  const origUserFindById = User.findById;
  User.findById = ((id: any) => ({
    select: () => {
      const u = usersMap.get(id?.toString());
      return Promise.resolve(u || null);
    },
  })) as any;

  // Hook Enquiry.findById
  const origEnquiryFindById = Enquiry.findById;
  Enquiry.findById = ((id: any) => {
    const e = enquiriesMap.get(id?.toString());
    return Promise.resolve(e || null);
  }) as any;

  // Hook EnquiryActivity.prototype.save & find & countDocuments
  const origActivitySave = EnquiryActivity.prototype.save;
  EnquiryActivity.prototype.save = async function (this: any) {
    const doc = {
      _id: this._id || new Types.ObjectId(),
      id: (this._id || new Types.ObjectId()).toString(),
      enquiryId: this.enquiryId,
      performedBy: this.performedBy,
      performedByName: this.performedByName,
      type: this.type,
      note: this.note,
      metadata: this.metadata || {},
      createdAt: this.createdAt || new Date(),
    };
    savedActivities.push(doc);
    return doc as any;
  };

  const origActivityFind = EnquiryActivity.find;
  EnquiryActivity.find = ((filter: any) => {
    const enquiryIdStr = filter?.enquiryId?.toString();
    const matched = savedActivities.filter(
      (a) => a.enquiryId && a.enquiryId.toString() === enquiryIdStr,
    );
    return {
      sort: (_sortObj: any) => ({
        skip: (skipCount: number) => ({
          limit: (limitCount: number) => {
            const sorted = [...matched].sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            );
            return Promise.resolve(
              sorted.slice(skipCount, skipCount + limitCount),
            );
          },
        }),
      }),
    };
  }) as any;

  const origActivityCount = EnquiryActivity.countDocuments;
  EnquiryActivity.countDocuments = ((filter: any) => {
    const enquiryIdStr = filter?.enquiryId?.toString();
    const matched = savedActivities.filter(
      (a) => a.enquiryId && a.enquiryId.toString() === enquiryIdStr,
    );
    return Promise.resolve(matched.length);
  }) as any;

  // Hook SecurityLog.prototype.save
  const origSecurityLogSave = SecurityLog.prototype.save;
  SecurityLog.prototype.save = async function (this: any) {
    const doc = {
      _id: this._id || new Types.ObjectId(),
      id: (this._id || new Types.ObjectId()).toString(),
      employeeId: this.employeeId,
      employeeName: this.employeeName,
      eventType: this.eventType,
      safeReasonCode: this.safeReasonCode,
      timestamp: this.timestamp || new Date(),
      createdAt: this.createdAt || new Date(),
    };
    savedSecurityLogs.push(doc);
    return doc as any;
  };

  // Hook SecurityLog.find & countDocuments
  const origSecurityLogFind = SecurityLog.find;
  SecurityLog.find = ((_filter: any) => ({
    sort: (_sortObj: any) => ({
      skip: (skipCount: number) => ({
        limit: (limitCount: number) => {
          const sorted = [...savedSecurityLogs].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          return Promise.resolve(
            sorted.slice(skipCount, skipCount + limitCount),
          );
        },
      }),
    }),
  })) as any;

  const origSecurityLogCount = SecurityLog.countDocuments;
  SecurityLog.countDocuments = (() =>
    Promise.resolve(savedSecurityLogs.length)) as any;

  // Hook SecurityLog.deleteMany
  const origSecurityLogDeleteMany = SecurityLog.deleteMany;
  SecurityLog.deleteMany = (async (filter: any) => {
    const ltDate = filter?.createdAt?.$lt
      ? new Date(filter.createdAt.$lt).getTime()
      : 0;
    const initialCount = savedSecurityLogs.length;
    const remaining = savedSecurityLogs.filter((doc) => {
      const docTime = new Date(doc.createdAt).getTime();
      return docTime >= ltDate; // retain if >= cutoffDate
    });
    savedSecurityLogs.length = 0;
    savedSecurityLogs.push(...remaining);
    const deletedCount = initialCount - remaining.length;
    return { deletedCount, acknowledged: true };
  }) as any;

  // Hook Alert.prototype.save
  const origAlertSave = Alert.prototype.save;
  Alert.prototype.save = async function (this: any) {
    const existingIndex = savedAlerts.findIndex((a) => a.id === this.id);
    if (existingIndex >= 0) {
      savedAlerts[existingIndex] = this;
      return this;
    }
    const doc = {
      _id: this._id || new Types.ObjectId(),
      id: (this._id || new Types.ObjectId()).toString(),
      type: this.type,
      status: this.status || "OPEN",
      severity: this.severity || "CRITICAL",
      title: this.title,
      message: this.message,
      incidentKey: this.incidentKey,
      details: this.details || {},
      acknowledgedBy: this.acknowledgedBy || null,
      acknowledgedByName: this.acknowledgedByName || null,
      acknowledgedAt: this.acknowledgedAt || null,
      resolvedAt: this.resolvedAt || null,
      emailSent: this.emailSent || false,
      emailSentAt: this.emailSentAt || null,
      createdAt: this.createdAt || new Date(),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    };
    savedAlerts.push(doc);
    return doc as any;
  };

  // Hook Alert.find & countDocuments & findOne & findById & updateMany
  const origAlertFind = Alert.find;
  Alert.find = ((filter: any) => {
    let list = [...savedAlerts];
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }
    return {
      sort: (_sortObj: any) => ({
        skip: (skipCount: number) => ({
          limit: (limitCount: number) => {
            const sorted = list.sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            );
            return Promise.resolve(
              sorted.slice(skipCount, skipCount + limitCount),
            );
          },
        }),
      }),
    };
  }) as any;

  const origAlertCount = Alert.countDocuments;
  Alert.countDocuments = ((filter: any) => {
    let list = [...savedAlerts];
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }
    return Promise.resolve(list.length);
  }) as any;

  const origAlertFindOne = Alert.findOne;
  Alert.findOne = ((filter: any) => {
    let matched = savedAlerts.find((a) => {
      let match = true;
      if (filter.incidentKey && a.incidentKey !== filter.incidentKey)
        match = false;
      if (filter.status?.$in && !filter.status.$in.includes(a.status))
        match = false;
      return match;
    });
    return Promise.resolve(
      matched
        ? {
            ...matched,
            save: async function () {
              return this;
            },
          }
        : null,
    );
  }) as any;

  const origAlertFindById = Alert.findById;
  Alert.findById = ((id: any) => {
    const alert = savedAlerts.find((a) => a.id === id?.toString());
    if (!alert) return Promise.resolve(null);
    return Promise.resolve({
      ...alert,
      save: async function () {
        const idx = savedAlerts.findIndex((a) => a.id === alert.id);
        if (idx >= 0) savedAlerts[idx] = this;
        return this;
      },
    });
  }) as any;

  const origAlertUpdateMany = Alert.updateMany;
  Alert.updateMany = ((filter: any, update: any) => {
    let updatedCount = 0;
    savedAlerts.forEach((a) => {
      let matches = true;
      if (filter.incidentKey && a.incidentKey !== filter.incidentKey)
        matches = false;
      if (filter.status?.$in && !filter.status.$in.includes(a.status))
        matches = false;
      if (matches) {
        if (update.$set?.status) a.status = update.$set.status;
        if (update.$set?.resolvedAt) a.resolvedAt = update.$set.resolvedAt;
        updatedCount++;
      }
    });
    return Promise.resolve({ modifiedCount: updatedCount });
  }) as any;

  try {
    // -----------------------------------------------------------------
    // Suite 1: Sensitive Remark Rejection & Metadata-Only Security Logging
    // -----------------------------------------------------------------
    console.log(
      "--- Suite 1: Sensitive Remark Rejection & Security Logging ---",
    );

    const testEnquiry = createMockEnquiry({
      name: "Sensitive Test Lead",
      status: "ACTIVE",
      assignedTo: salesUser._id,
    });
    enquiriesMap.set(testEnquiry.id, testEnquiry);

    const initialActivityCount = savedActivities.length;
    const initialSecurityLogCount = savedSecurityLogs.length;

    // 1A: Attempting to add a remark with credential / password / OTP pattern
    const prohibitedSecret = "secret_pass_1234";
    const remarkWithPassword = `Please use password: ${prohibitedSecret} to log into client server.`;

    const rejectRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${testEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({ remark: remarkWithPassword }),
      },
    );
    const rejectBody = (await rejectRes.json()) as any;

    assert(
      rejectRes.status === 400,
      "Prohibited remark is rejected with HTTP 400 Bad Request",
    );
    assert(rejectBody.success === false, "Response specifies success: false");
    assert(
      rejectBody.message.includes("prohibited sensitive content"),
      "Identifies prohibited sensitive content",
    );
    assert(
      !JSON.stringify(rejectBody).includes(prohibitedSecret),
      "Privacy: Prohibited secret is NEVER echoed in response body",
    );

    // 1B & 1C: Exactly one SecurityLog created with metadata only
    assert(
      savedSecurityLogs.length === initialSecurityLogCount + 1,
      "Exactly one SecurityLog entry was persisted",
    );
    const latestSecurityLog = savedSecurityLogs[savedSecurityLogs.length - 1];

    assert(
      latestSecurityLog.employeeId.toString() === salesUser.id,
      "SecurityLog tracks employeeId snapshot",
    );
    assert(
      latestSecurityLog.employeeName === "Sales Agent Alpha",
      "SecurityLog tracks employeeName snapshot",
    );
    assert(
      latestSecurityLog.eventType === "SENSITIVE_REMARK_REJECTED",
      "SecurityLog specifies eventType SENSITIVE_REMARK_REJECTED",
    );
    assert(
      latestSecurityLog.safeReasonCode === "PROHIBITED_CREDENTIALS",
      "SecurityLog specifies safeReasonCode",
    );

    // 1D: Verifies absence of sensitive text, secrets, or enquiryId in SecurityLog
    const rawLogJson = JSON.stringify(latestSecurityLog);
    assert(
      !rawLogJson.includes(prohibitedSecret),
      "SecurityLog does NOT contain the secret password",
    );
    assert(
      !rawLogJson.includes("Please use password"),
      "SecurityLog does NOT contain any remark text",
    );
    assert(
      latestSecurityLog.enquiryId === undefined,
      "SecurityLog does NOT store enquiryId (strictly preserved privacy)",
    );

    // 1E: Verifies zero records in EnquiryActivity
    assert(
      savedActivities.length === initialActivityCount,
      "Prohibited remark was NEVER saved to EnquiryActivity",
    );

    // 1F: Security-log persistence failure handling -> Returns HTTP 500
    const currentSecurityLogSave = SecurityLog.prototype.save;
    SecurityLog.prototype.save = async function () {
      throw new Error("Simulated security log storage failure");
    };

    const failLogRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${testEnquiry.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          remark: "My secret token is Bearer eyJhbGciOiJIUzI1NiJ9",
        }),
      },
    );
    const failLogBody = (await failLogRes.json()) as any;

    assert(
      failLogRes.status === 500,
      "Returns HTTP 500 when mandatory security log persistence fails",
    );
    assert(
      failLogBody.success === false,
      "Does NOT pretend security log was saved on storage failure",
    );
    assert(
      failLogBody.message.includes(
        "Failed to record mandatory security log event",
      ),
      "Controlled error message returned",
    );

    SecurityLog.prototype.save = currentSecurityLogSave;

    // -----------------------------------------------------------------
    // Suite 2: Role-Based Authorization for Security Logs & System Alerts
    // -----------------------------------------------------------------
    console.log("\n--- Suite 2: Role-Based Authorization (ADMIN Only) ---");

    // 2A: ADMIN can read security logs (HTTP 200)
    const adminLogsRes = await fetch(`${baseUrl}/api/v1/security-logs`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminLogsBody = (await adminLogsRes.json()) as any;

    assert(
      adminLogsRes.status === 200,
      "ADMIN access to GET /security-logs returns HTTP 200 OK",
    );
    assert(adminLogsBody.success === true, "Response specifies success: true");
    assert(Array.isArray(adminLogsBody.data.logs), "Returns logs array");
    assert(
      adminLogsBody.data.pagination.page === 1,
      "Includes pagination metadata",
    );

    // 2B: MANAGER denied security logs (HTTP 403)
    const mgrLogsRes = await fetch(`${baseUrl}/api/v1/security-logs`, {
      method: "GET",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert(
      mgrLogsRes.status === 403,
      "MANAGER access to GET /security-logs returns HTTP 403 Forbidden",
    );

    // 2C: SALES denied security logs (HTTP 403)
    const salesLogsRes = await fetch(`${baseUrl}/api/v1/security-logs`, {
      method: "GET",
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    assert(
      salesLogsRes.status === 403,
      "SALES access to GET /security-logs returns HTTP 403 Forbidden",
    );

    // 2D: Unauthenticated denied (HTTP 401)
    const unauthLogsRes = await fetch(`${baseUrl}/api/v1/security-logs`);
    assert(
      unauthLogsRes.status === 401,
      "Unauthenticated access to GET /security-logs returns HTTP 401 Unauthorized",
    );

    // 2E: ADMIN can read system alerts (HTTP 200)
    const adminAlertsRes = await fetch(`${baseUrl}/api/v1/alerts`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminAlertsRes.status === 200,
      "ADMIN access to GET /alerts returns HTTP 200 OK",
    );

    // 2F: MANAGER denied alerts (HTTP 403)
    const mgrAlertsRes = await fetch(`${baseUrl}/api/v1/alerts`, {
      method: "GET",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert(
      mgrAlertsRes.status === 403,
      "MANAGER access to GET /alerts returns HTTP 403 Forbidden",
    );

    // 2G: SALES denied alerts (HTTP 403)
    const salesAlertsRes = await fetch(`${baseUrl}/api/v1/alerts`, {
      method: "GET",
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    assert(
      salesAlertsRes.status === 403,
      "SALES access to GET /alerts returns HTTP 403 Forbidden",
    );

    // 2H: Unauthenticated denied alerts (HTTP 401)
    const unauthAlertsRes = await fetch(`${baseUrl}/api/v1/alerts`);
    assert(
      unauthAlertsRes.status === 401,
      "Unauthenticated access to GET /alerts returns HTTP 401",
    );

    // 2I: Separation: Ordinary activity-history API NEVER contains security logs
    const actRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${testEnquiry.id}/activities`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    const actBody = (await actRes.json()) as any;
    const hasSecLogType = actBody.data.activities.some(
      (a: any) => a.type === "SENSITIVE_REMARK_REJECTED",
    );
    assert(
      hasSecLogType === false,
      "Enquiry activities API NEVER contains SENSITIVE_REMARK_REJECTED logs",
    );

    // -----------------------------------------------------------------
    // Suite 3: Retention Cleanup Engine (365-Day UTC Cutoff & Idempotency)
    // -----------------------------------------------------------------
    console.log(
      "\n--- Suite 3: Retention Cleanup (365-Day Policy & Idempotency) ---",
    );

    // Clear test store and seed specific ages
    savedSecurityLogs.length = 0;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Seed test logs:
    // 1. 400 days old (should be DELETED)
    savedSecurityLogs.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      employeeId: salesUser._id,
      employeeName: "Sales Agent Alpha",
      eventType: "SENSITIVE_REMARK_REJECTED",
      safeReasonCode: "PROHIBITED_CREDENTIALS",
      createdAt: new Date(now - 400 * dayMs),
    });

    // 2. 366 days old (should be DELETED)
    savedSecurityLogs.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      employeeId: salesUser._id,
      employeeName: "Sales Agent Alpha",
      eventType: "SENSITIVE_REMARK_REJECTED",
      safeReasonCode: "PROHIBITED_CREDENTIALS",
      createdAt: new Date(now - 366 * dayMs),
    });

    // 3. Exactly 365 days old (should be RETAINED: >= cutoffDate)
    savedSecurityLogs.push({
      _id: new Types.ObjectId(),
      id: "exact-365d-log",
      employeeId: salesUser._id,
      employeeName: "Sales Agent Alpha",
      eventType: "SENSITIVE_REMARK_REJECTED",
      safeReasonCode: "PROHIBITED_CREDENTIALS",
      createdAt: new Date(now - 365 * dayMs + 1000), // 1 second newer than strict 365.000 days
    });

    // 4. 200 days old (should be RETAINED)
    savedSecurityLogs.push({
      _id: new Types.ObjectId(),
      id: "recent-200d-log",
      employeeId: salesUser._id,
      employeeName: "Sales Agent Alpha",
      eventType: "SENSITIVE_REMARK_REJECTED",
      safeReasonCode: "PROHIBITED_CREDENTIALS",
      createdAt: new Date(now - 200 * dayMs),
    });

    // 5. 5 days old (should be RETAINED)
    savedSecurityLogs.push({
      _id: new Types.ObjectId(),
      id: "recent-5d-log",
      employeeId: salesUser._id,
      employeeName: "Sales Agent Alpha",
      eventType: "SENSITIVE_REMARK_REJECTED",
      safeReasonCode: "PROHIBITED_CREDENTIALS",
      createdAt: new Date(now - 5 * dayMs),
    });

    assert(
      savedSecurityLogs.length === 5,
      "Seeded 5 test security logs of varying ages",
    );

    // 3A & 3B: Execute cleanup
    const cleanupResult1 = await securityService.runRetentionCleanup();

    assert(cleanupResult1.success === true, "Retention cleanup succeeded");
    assert(
      cleanupResult1.deletedCount === 2,
      "Exactly 2 records (>365 days old) were deleted",
    );
    assert(savedSecurityLogs.length === 3, "Exactly 3 records were retained");

    // 3C: Verify the retained records are the newer ones
    const retainedIds = savedSecurityLogs.map((l) => l.id);
    assert(
      retainedIds.includes("exact-365d-log"),
      "Record at cutoff boundary was RETAINED",
    );
    assert(
      retainedIds.includes("recent-200d-log"),
      "Record 200 days old was RETAINED",
    );
    assert(
      retainedIds.includes("recent-5d-log"),
      "Record 5 days old was RETAINED",
    );

    // 3D: Idempotency test: Immediately rerun cleanup
    const cleanupResult2 = await securityService.runRetentionCleanup();
    assert(
      cleanupResult2.success === true,
      "Rerunning retention cleanup succeeds",
    );
    assert(
      cleanupResult2.deletedCount === 0,
      "Idempotent: Deleted 0 records on immediate rerun",
    );
    assert(
      savedSecurityLogs.length === 3,
      "Idempotent: Same 3 records remain preserved",
    );

    // 3E: Bounded retry test: Force deleteMany failure and verify bounded retry
    let retryAttempts = 0;
    const currentDeleteMany = SecurityLog.deleteMany;
    SecurityLog.deleteMany = (async () => {
      retryAttempts++;
      throw new Error("Simulated database lock failure during deletion");
    }) as any;

    const failingCleanupResult = await securityService.runRetentionCleanup({
      maxRetries: 3,
    });

    assert(
      failingCleanupResult.success === false,
      "Failing cleanup reports success: false",
    );
    assert(
      retryAttempts === 3,
      "Bounded retry: Stopped after exactly 3 attempts",
    );
    assert(
      failingCleanupResult.attempts === 3,
      "Result specifies 3 attempts taken",
    );

    SecurityLog.deleteMany = currentDeleteMany;

    // -----------------------------------------------------------------
    // Suite 4: Persistent Alerts, Deduplication & Email Notification
    // -----------------------------------------------------------------
    console.log("\n--- Suite 4: Persistent Alerts & Email Notification ---");

    // Verify alert creation from previous failing cleanup
    const unresolvedAlerts = savedAlerts.filter(
      (a) => a.incidentKey === "RETENTION_CLEANUP" && a.status === "OPEN",
    );
    assert(
      unresolvedAlerts.length === 1,
      "Exactly one OPEN alert was created for cleanup failure",
    );
    const cleanupAlert = unresolvedAlerts[0];

    assert(
      cleanupAlert.type === "RETENTION_CLEANUP_FAILURE",
      "Alert type is RETENTION_CLEANUP_FAILURE",
    );
    assert(cleanupAlert.severity === "CRITICAL", "Alert severity is CRITICAL");
    assert(
      cleanupAlert.emailSent === true,
      "emailSent flag is true after successful dispatch",
    );
    assert(
      emailDispatchCount === 1,
      "Exactly one email was dispatched on initial incident failure",
    );

    // 4C: Deduplication test: Subsequent failure for same incident does NOT duplicate alert or email
    const preCountAlerts = savedAlerts.length;
    const preCountEmails = emailDispatchCount;

    // Trigger another failure
    SecurityLog.deleteMany = (async () => {
      throw new Error("Second consecutive failure on cleanup");
    }) as any;

    await securityService.runRetentionCleanup({ maxRetries: 2 });
    SecurityLog.deleteMany = currentDeleteMany;

    assert(
      savedAlerts.length === preCountAlerts,
      "Deduplication: Did NOT create duplicate alert",
    );
    assert(
      emailDispatchCount === preCountEmails,
      "Deduplication: Did NOT send duplicate email for same incident",
    );

    // 4D & 4E: Successful later cleanup auto-resolves existing alerts without a recovery email
    const preResolveEmailCount = emailDispatchCount;
    const resolveResult = await securityService.runRetentionCleanup();

    assert(resolveResult.success === true, "Later cleanup succeeded");
    const existingIncidentAlert = savedAlerts.find(
      (a) => a.incidentKey === "RETENTION_CLEANUP",
    );
    assert(
      existingIncidentAlert?.status === "RESOLVED",
      "Existing cleanup alert automatically transitioned to RESOLVED",
    );
    assert(
      Boolean(existingIncidentAlert?.resolvedAt),
      "resolvedAt timestamp recorded on auto-resolution",
    );
    assert(
      emailDispatchCount === preResolveEmailCount,
      "Recovery: No recovery email was sent when incident was resolved",
    );

    // -----------------------------------------------------------------
    // Suite 5: Alert Lifecycle & Admin Acknowledgement API
    // -----------------------------------------------------------------
    console.log(
      "\n--- Suite 5: Alert Lifecycle & Admin Acknowledgement API ---",
    );

    // Create a new OPEN alert for testing acknowledgement
    const alertToAcknowledge = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      type: "RETENTION_CLEANUP_FAILURE",
      status: "OPEN",
      severity: "CRITICAL",
      title: "Manual Test Alert",
      message: "Failed to purge security logs",
      incidentKey: "RETENTION_CLEANUP_TEST",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    savedAlerts.push(alertToAcknowledge);

    // 5A: ADMIN acknowledges OPEN alert (HTTP 200)
    const ackRes = await fetch(
      `${baseUrl}/api/v1/alerts/${alertToAcknowledge.id}/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    const ackBody = (await ackRes.json()) as any;

    assert(ackRes.status === 200, "ADMIN acknowledgement returns HTTP 200 OK");
    assert(ackBody.success === true, "Response indicates success: true");
    assert(
      ackBody.data.alert.status === "ACKNOWLEDGED",
      "Status transitioned to ACKNOWLEDGED",
    );
    assert(
      ackBody.data.alert.acknowledgedByName === "Admin Director",
      "Captures acknowledging admin name",
    );

    // 5B: Acknowledging an already ACKNOWLEDGED alert -> HTTP 400 Bad Request
    const reAckRes = await fetch(
      `${baseUrl}/api/v1/alerts/${alertToAcknowledge.id}/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    const reAckBody = (await reAckRes.json()) as any;

    assert(
      reAckRes.status === 400,
      "Re-acknowledging ACKNOWLEDGED alert returns HTTP 400 Bad Request",
    );
    assert(
      reAckBody.message.includes("Only OPEN alerts can be acknowledged"),
      "ErrorMessage states only OPEN alerts can be acknowledged",
    );

    // 5C: Acknowledging a RESOLVED alert -> HTTP 400 Bad Request
    const resolvedAlert = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      type: "RETENTION_CLEANUP_FAILURE",
      status: "RESOLVED",
      severity: "CRITICAL",
      title: "Resolved Test Alert",
      message: "Already resolved",
      incidentKey: "RESOLVED_INCIDENT",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    savedAlerts.push(resolvedAlert);

    const ackResolvedRes = await fetch(
      `${baseUrl}/api/v1/alerts/${resolvedAlert.id}/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    assert(
      ackResolvedRes.status === 400,
      "Acknowledging RESOLVED alert returns HTTP 400 Bad Request",
    );

    // 5D: SALES attempting acknowledgement -> HTTP 403 Forbidden
    const salesAckRes = await fetch(
      `${baseUrl}/api/v1/alerts/${alertToAcknowledge.id}/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken}`,
        },
      },
    );
    assert(
      salesAckRes.status === 403,
      "SALES role acknowledgement attempt returns HTTP 403 Forbidden",
    );

    // 5E: Malformed alert ID -> HTTP 400 Bad Request
    const malformedAckRes = await fetch(
      `${baseUrl}/api/v1/alerts/invalid-id/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    assert(
      malformedAckRes.status === 400,
      "Malformed alert ID returns HTTP 400 Bad Request",
    );

    // 5F: Non-existent alert ID -> HTTP 404 Not Found
    const fakeAlertId = new Types.ObjectId().toString();
    const notFoundAckRes = await fetch(
      `${baseUrl}/api/v1/alerts/${fakeAlertId}/acknowledge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    assert(
      notFoundAckRes.status === 404,
      "Non-existent alert ID returns HTTP 404 Not Found",
    );
  } finally {
    // Restore hooks
    User.findById = origUserFindById;
    Enquiry.findById = origEnquiryFindById;
    EnquiryActivity.prototype.save = origActivitySave;
    EnquiryActivity.find = origActivityFind;
    EnquiryActivity.countDocuments = origActivityCount;
    SecurityLog.prototype.save = origSecurityLogSave;
    SecurityLog.find = origSecurityLogFind;
    SecurityLog.countDocuments = origSecurityLogCount;
    SecurityLog.deleteMany = origSecurityLogDeleteMany;
    Alert.prototype.save = origAlertSave;
    Alert.find = origAlertFind;
    Alert.countDocuments = origAlertCount;
    Alert.findOne = origAlertFindOne;
    Alert.findById = origAlertFindById;
    Alert.updateMany = origAlertUpdateMany;

    if (server) {
      server.close();
    }
  }

  console.log("\n====================================================");
  console.log(
    `Phase 4 Test Suite Finished: ${passed} passed, ${failed} failed`,
  );
  console.log("====================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityPhase4Tests().catch((err) => {
  console.error("Unhandled Phase 4 test execution error:", err);
  process.exit(1);
});
