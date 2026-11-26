import http from "http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { User, IUser } from "../models/user.model.js";
import {
  EnquiryActivity,
  AppendOnlyViolationError,
} from "../models/enquiry-activity.model.js";
import { authService } from "../services/auth.service.js";

interface MockEnquiryDoc {
  _id: Types.ObjectId;
  id: string;
  name: string;
  mobile: string;
  normalizedMobile: string;
  email?: string;
  normalizedEmail?: string;
  status: "ACTIVE" | "CLOSED";
  isActive: boolean;
  assignedTo: any;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockEnquiryDoc>;
  populate: (path: string, select?: string) => Promise<MockEnquiryDoc>;
}

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
  data: Partial<MockEnquiryDoc>,
  usersMap: Map<string, IUser>,
): MockEnquiryDoc => {
  const id = new Types.ObjectId();
  const doc: MockEnquiryDoc = {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Prospect",
    mobile: data.mobile || "9876543210",
    normalizedMobile: data.normalizedMobile || "+919876543210",
    email: data.email,
    normalizedEmail: data.normalizedEmail,
    status: data.status || "ACTIVE",
    isActive:
      data.isActive !== undefined ? data.isActive : data.status !== "CLOSED",
    assignedTo: data.assignedTo || null,
    createdAt: data.createdAt || new Date("2026-01-01T10:00:00.000Z"),
    updatedAt: data.updatedAt || new Date("2026-01-01T10:00:00.000Z"),
    save: async function () {
      this.updatedAt = new Date();
      if (this.status === "ACTIVE") {
        this.isActive = true;
      } else if (this.status === "CLOSED") {
        this.isActive = false;
      }
      return this;
    },
    populate: async function (path: string, _select?: string) {
      if (path === "assignedTo" && this.assignedTo) {
        const uid = (
          this.assignedTo._id ||
          this.assignedTo.id ||
          this.assignedTo
        ).toString();
        const assignedUser = usersMap.get(uid);
        if (assignedUser) {
          this.assignedTo = {
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
  return doc;
};

async function runPhase3Tests() {
  console.log("====================================================");
  console.log("Starting Step 11 Phase 3 Integration Test Suite");
  console.log("Assignment, Status & Duplicate Event Integration");
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
    name: "Admin Director",
    email: "admin@Neuways.com",
    role: "ADMIN",
  });
  const managerUser = createMockUser({
    name: "Manager Lead",
    email: "manager@Neuways.com",
    role: "MANAGER",
  });
  const salesAgent1 = createMockUser({
    name: "Sales Agent Alpha",
    email: "sales.alpha@Neuways.com",
    role: "SALES",
    managerId: managerUser._id as any,
  });
  const salesAgent2 = createMockUser({
    name: "Sales Agent Beta",
    email: "sales.beta@Neuways.com",
    role: "SALES",
    managerId: managerUser._id as any,
  });
  const deactivatedUser = createMockUser({
    name: "Former Employee",
    email: "deactivated@Neuways.com",
    role: "SALES",
    isActive: false,
  });

  const usersMap = new Map<string, IUser>([
    [adminUser.id, adminUser],
    [managerUser.id, managerUser],
    [salesAgent1.id, salesAgent1],
    [salesAgent2.id, salesAgent2],
    [deactivatedUser.id, deactivatedUser],
  ]);

  const enquiriesMap = new Map<string, MockEnquiryDoc>();
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
  const salesToken1 = authService.generateToken({
    id: salesAgent1.id,
    email: salesAgent1.email,
    role: "SALES",
  });
  const salesToken2 = authService.generateToken({
    id: salesAgent2.id,
    email: salesAgent2.email,
    role: "SALES",
  });

  // Save original model methods
  const originalUserFindById = User.findById;
  const originalEnquiryFindById = Enquiry.findById;
  const originalEnquiryFind = Enquiry.find;
  const originalActivityFind = EnquiryActivity.find;
  const originalActivityCount = EnquiryActivity.countDocuments;
  const originalActivitySave = EnquiryActivity.prototype.save;

  // Intercept User queries
  User.findById = ((id: any) => ({
    select: () => {
      const u = usersMap.get(id?.toString());
      return Promise.resolve(u || null);
    },
  })) as any;

  // Intercept Enquiry.findById
  Enquiry.findById = ((id: any) => {
    const e = enquiriesMap.get(id?.toString());
    return Promise.resolve(e || null);
  }) as any;

  // Intercept Enquiry.find (used by findDuplicates)
  Enquiry.find = ((filter: any) => {
    let list = Array.from(enquiriesMap.values());
    if (filter && filter.$or && Array.isArray(filter.$or)) {
      list = list.filter((e) => {
        return filter.$or.some((cond: any) => {
          if (
            cond.normalizedMobile &&
            e.normalizedMobile === cond.normalizedMobile
          )
            return true;
          if (
            cond.normalizedEmail &&
            e.normalizedEmail === cond.normalizedEmail
          )
            return true;
          return false;
        });
      });
    }
    return {
      populate: () => Promise.resolve(list),
      select: () => Promise.resolve(list),
    };
  }) as any;

  // Intercept EnquiryActivity save
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

  // Intercept EnquiryActivity.find
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
            const sliced = sorted.slice(skipCount, skipCount + limitCount);
            return Promise.resolve(sliced);
          },
        }),
      }),
    };
  }) as any;

  // Intercept EnquiryActivity.countDocuments
  EnquiryActivity.countDocuments = ((filter: any) => {
    const enquiryIdStr = filter?.enquiryId?.toString();
    const matched = savedActivities.filter(
      (a) => a.enquiryId && a.enquiryId.toString() === enquiryIdStr,
    );
    return Promise.resolve(matched.length);
  }) as any;

  try {
    // -----------------------------------------------------------------
    // Suite 1: Manual Enquiry Assignment & ASSIGNMENT_CHANGED Events
    // -----------------------------------------------------------------
    console.log("--- Suite 1: Manual Assignment & Events ---");

    // Setup an unassigned active enquiry
    const unassignedLead = createMockEnquiry(
      { name: "Unassigned Active Lead", status: "ACTIVE", assignedTo: null },
      usersMap,
    );
    enquiriesMap.set(unassignedLead.id, unassignedLead);

    // Setup a closed enquiry
    const closedLead = createMockEnquiry(
      { name: "Archived Deal", status: "CLOSED", isActive: false },
      usersMap,
    );
    enquiriesMap.set(closedLead.id, closedLead);

    // 1A: ADMIN assigns unassigned active enquiry -> HTTP 200, creates ASSIGNMENT_CHANGED event
    const assignRes1 = await fetch(
      `${baseUrl}/api/v1/enquiries/${unassignedLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const assignBody1 = (await assignRes1.json()) as any;

    assert(assignRes1.status === 200, "ADMIN assignment returns HTTP 200 OK");
    assert(assignBody1.success === true, "Response indicates success: true");
    assert(
      assignBody1.data.enquiry.assignedTo.name === "Sales Agent Alpha",
      "Enquiry populated with assignee name",
    );

    // Check saved activity record
    const assignActivity1 = savedActivities.find(
      (a) =>
        a.enquiryId.toString() === unassignedLead.id &&
        a.type === "ASSIGNMENT_CHANGED",
    );
    assert(
      Boolean(assignActivity1),
      "Creates exactly one ASSIGNMENT_CHANGED activity event",
    );
    assert(
      assignActivity1.metadata.previousAssigneeId === null,
      "Activity records previousAssigneeId as null for initial assignment",
    );
    assert(
      assignActivity1.metadata.newAssigneeId === salesAgent1.id,
      "Activity records newAssigneeId correctly",
    );
    assert(
      assignActivity1.metadata.newAssigneeName === "Sales Agent Alpha",
      "Activity records newAssigneeName",
    );
    assert(
      assignActivity1.performedByName === "Admin Director",
      "Activity records performedByName as Admin Director",
    );

    // 1B: MANAGER cannot reassign Sales-held lead (HTTP 403), CAN assign Manager-held lead (HTTP 200)
    const blockedMgrAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${unassignedLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    assert(
      blockedMgrAssignRes.status === 403,
      "MANAGER reassignment of a Sales-held lead returns HTTP 403 Forbidden",
    );

    const managerHeldLead = createMockEnquiry(
      {
        name: "Manager Held Lead",
        status: "ACTIVE",
        assignedTo: managerUser._id as Types.ObjectId,
      },
      usersMap,
    );
    enquiriesMap.set(managerHeldLead.id, managerHeldLead);

    const assignRes2 = await fetch(
      `${baseUrl}/api/v1/enquiries/${managerHeldLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    const assignBody2 = (await assignRes2.json()) as any;

    assert(
      assignRes2.status === 200,
      "MANAGER assignment of manager-held lead returns HTTP 200 OK",
    );
    assert(
      assignBody2.data.enquiry.assignedTo.name === "Sales Agent Beta",
      "Updated to Agent Beta",
    );

    const assignActivity2 = savedActivities.filter(
      (a) =>
        a.enquiryId.toString() === managerHeldLead.id &&
        a.type === "ASSIGNMENT_CHANGED",
    )[0];
    assert(
      Boolean(assignActivity2),
      "Creates ASSIGNMENT_CHANGED event on manager-held lead assignment",
    );
    assert(
      assignActivity2.metadata.previousAssigneeId === managerUser.id,
      "Records previousAssigneeId as Manager Lead",
    );
    assert(
      assignActivity2.metadata.previousAssigneeName === "Manager Lead",
      "Records previousAssigneeName as Manager Lead",
    );
    assert(
      assignActivity2.metadata.newAssigneeId === salesAgent2.id,
      "Records newAssigneeId as Agent Beta",
    );
    assert(
      assignActivity2.performedByName === "Manager Lead",
      "Records performedByName as Manager Lead",
    );

    // 1C: SALES attempts assignment -> HTTP 403 Forbidden
    const salesAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${unassignedLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken1}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    assert(
      salesAssignRes.status === 403,
      "SALES role assignment attempt returns HTTP 403 Forbidden",
    );

    // 1D: Assignment blocked on CLOSED enquiry -> HTTP 400 Bad Request
    const initialActivitiesCount = savedActivities.length;
    const closedAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${closedLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    const closedAssignBody = (await closedAssignRes.json()) as any;

    assert(
      closedAssignRes.status === 400,
      "Assignment on CLOSED enquiry returns HTTP 400 Bad Request",
    );
    assert(
      closedAssignBody.message.includes("Cannot assign a CLOSED enquiry"),
      "Returns expected error message explaining CLOSED enquiries cannot be assigned",
    );
    assert(
      savedActivities.length === initialActivitiesCount,
      "No activity event created on blocked assignment",
    );

    // 1E: Assignment to deactivated user -> HTTP 400 Bad Request
    const deactAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${unassignedLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: deactivatedUser.id }),
      },
    );
    assert(
      deactAssignRes.status === 400,
      "Assignment to deactivated employee returns HTTP 400 Bad Request",
    );

    // 1F: Unauthenticated assignment attempt -> HTTP 401 Unauthorized
    const unauthAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${unassignedLead.id}/assign`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: salesAgent1.id }),
      },
    );
    assert(
      unauthAssignRes.status === 401,
      "Unauthenticated assignment returns HTTP 401 Unauthorized",
    );

    // 1G: Consistency & Safety: Activity creation failure triggers compensating rollback and HTTP 500
    const failAssignLead = createMockEnquiry(
      {
        name: "Lead for Activity Failure Test",
        status: "ACTIVE",
        assignedTo: salesAgent1._id,
      },
      usersMap,
    );
    enquiriesMap.set(failAssignLead.id, failAssignLead);

    const currentActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function (this: any) {
      if (this.enquiryId?.toString() === failAssignLead.id) {
        throw new Error(
          "Simulated database write failure on activity collection",
        );
      }
      return currentActivitySave.call(this);
    };

    const failAssignRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${failAssignLead.id}/assign`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ assignedToId: salesAgent2.id }),
      },
    );
    const failAssignBody = (await failAssignRes.json()) as any;

    assert(
      failAssignRes.status === 500,
      "Returns HTTP 500 when mandatory audit activity write fails",
    );
    assert(
      failAssignBody.success === false,
      "Does NOT report success when audit write failed",
    );
    assert(
      (
        failAssignLead.assignedTo?._id ||
        failAssignLead.assignedTo?.id ||
        failAssignLead.assignedTo
      ).toString() === salesAgent1.id,
      "Compensating rollback successfully reverted assignedTo to original assignee",
    );

    EnquiryActivity.prototype.save = currentActivitySave;

    // -----------------------------------------------------------------
    // Suite 2: Status Changes & STATUS_CHANGED Events
    // -----------------------------------------------------------------
    console.log("\n--- Suite 2: Status Changes & Events ---");

    // Create fresh test enquiries
    const activeLead1 = createMockEnquiry(
      {
        name: "Lead for Closing",
        status: "ACTIVE",
        assignedTo: salesAgent1._id,
      },
      usersMap,
    );
    enquiriesMap.set(activeLead1.id, activeLead1);

    const activeLead2 = createMockEnquiry(
      {
        name: "Lead for Sales Auth",
        status: "ACTIVE",
        assignedTo: salesAgent2._id,
      },
      usersMap,
    );
    enquiriesMap.set(activeLead2.id, activeLead2);

    // 2A: Closing ACTIVE enquiry without reason -> HTTP 400 Bad Request
    const noReasonRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: "CLOSED" }),
      },
    );
    const noReasonBody = (await noReasonRes.json()) as any;

    assert(
      noReasonRes.status === 400,
      "Closing ACTIVE enquiry without reason returns HTTP 400 Bad Request",
    );
    assert(
      noReasonBody.message.includes("closing reason is mandatory"),
      "ErrorMessage states closing reason is mandatory",
    );
    assert(activeLead1.status === "ACTIVE", "Enquiry status remains ACTIVE");

    // 2B: ADMIN closes ACTIVE enquiry with reason -> HTTP 200, creates STATUS_CHANGED event, isActive becomes false
    const closeRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          status: "CLOSED",
          reason: "Customer purchased from competitor.",
        }),
      },
    );
    const closeBody = (await closeRes.json()) as any;

    assert(
      closeRes.status === 200,
      "ADMIN closing with reason returns HTTP 200 OK",
    );
    assert(closeBody.success === true, "Response specifies success: true");
    assert(
      closeBody.data.statusChanged === true,
      "Response indicates statusChanged: true",
    );
    assert(activeLead1.status === "CLOSED", "Enquiry status updated to CLOSED");
    assert(
      activeLead1.isActive === false,
      "Enquiry isActive synchronized to false",
    );

    const closeActivity = savedActivities.find(
      (a) =>
        a.enquiryId.toString() === activeLead1.id &&
        a.type === "STATUS_CHANGED" &&
        a.metadata.newStatus === "CLOSED",
    );
    assert(Boolean(closeActivity), "Creates STATUS_CHANGED activity event");
    assert(
      closeActivity.metadata.previousStatus === "ACTIVE",
      "Metadata tracks previousStatus: ACTIVE",
    );
    assert(
      closeActivity.metadata.newStatus === "CLOSED",
      "Metadata tracks newStatus: CLOSED",
    );
    assert(
      closeActivity.metadata.reason === "Customer purchased from competitor.",
      "Metadata tracks closing reason",
    );
    assert(
      closeActivity.performedByName === "Admin Director",
      "Metadata tracks performedByName",
    );

    // 2C: SALES role changes status of an enquiry assigned to them -> HTTP 200 Allowed
    const salesLead = createMockEnquiry(
      {
        name: "Sales Agent Lead",
        status: "ACTIVE",
        assignedTo: salesAgent1._id,
      },
      usersMap,
    );
    enquiriesMap.set(salesLead.id, salesLead);

    const salesStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${salesLead.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken1}`,
        },
        body: JSON.stringify({
          status: "CLOSED",
          reason: "Client opted for next quarter.",
        }),
      },
    );
    assert(
      salesStatusRes.status === 200,
      "SALES can change status of assigned enquiry (HTTP 200)",
    );
    assert(
      salesLead.status === "CLOSED",
      "Status changed to CLOSED by assigned salesperson",
    );

    // 2D: SALES role attempts to change status of an enquiry NOT assigned to them -> HTTP 403 Forbidden
    const forbiddenStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead2.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${salesToken1}`, // Token is Agent 1, lead is assigned to Agent 2
        },
        body: JSON.stringify({
          status: "CLOSED",
          reason: "Attempted unauthorized closure",
        }),
      },
    );
    assert(
      forbiddenStatusRes.status === 403,
      "SALES changing unassigned enquiry status returns HTTP 403 Forbidden",
    );
    assert(
      activeLead2.status === "ACTIVE",
      "Unassigned enquiry status remained unchanged",
    );

    // 2E: MANAGER reopens CLOSED enquiry -> HTTP 200, creates STATUS_CHANGED event, isActive becomes true
    const reopenRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          status: "ACTIVE",
          reason: "Prospect re-engaged via email.",
        }),
      },
    );
    const reopenBody = (await reopenRes.json()) as any;

    assert(
      reopenRes.status === 200,
      "MANAGER reopening CLOSED enquiry returns HTTP 200 OK",
    );
    assert(
      activeLead1.status === "ACTIVE",
      "Status transitioned from CLOSED to ACTIVE",
    );
    assert(activeLead1.isActive === true, "isActive synchronized to true");

    const reopenActivity = savedActivities.find(
      (a) =>
        a.enquiryId.toString() === activeLead1.id &&
        a.type === "STATUS_CHANGED" &&
        a.metadata.previousStatus === "CLOSED" &&
        a.metadata.newStatus === "ACTIVE",
    );
    assert(
      Boolean(reopenActivity),
      "Creates STATUS_CHANGED activity event on reopen",
    );
    assert(
      reopenActivity.performedByName === "Manager Lead",
      "Tracks manager name on reopen event",
    );

    // 2F: No-op status change -> HTTP 200, statusChanged: false, no new event created
    const countBeforeNoOp = savedActivities.length;
    const noOpRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: "ACTIVE" }), // Already ACTIVE
      },
    );
    const noOpBody = (await noOpRes.json()) as any;

    assert(noOpRes.status === 200, "No-op status request returns HTTP 200 OK");
    assert(
      noOpBody.data.statusChanged === false,
      "statusChanged flag is false on no-op",
    );
    assert(
      savedActivities.length === countBeforeNoOp,
      "No duplicate activity event created on no-op",
    );

    // 2G: Non-existent enquiry -> HTTP 404 Not Found
    const fakeId = new Types.ObjectId().toString();
    const notFoundStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${fakeId}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: "CLOSED", reason: "Testing not found" }),
      },
    );
    assert(
      notFoundStatusRes.status === 404,
      "Status update on non-existent enquiry returns HTTP 404",
    );

    // 2H: Invalid status enum value -> HTTP 400 Bad Request
    const invalidStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: "PENDING" }),
      },
    );
    assert(
      invalidStatusRes.status === 400,
      "Invalid status enum returns HTTP 400 Bad Request",
    );

    // 2I: Unauthenticated status update -> HTTP 401
    const unauthStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${activeLead1.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED", reason: "Unauthorized" }),
      },
    );
    assert(
      unauthStatusRes.status === 401,
      "Unauthenticated status update returns HTTP 401",
    );

    // 2J: Consistency & Safety: Status activity creation failure triggers compensating rollback and HTTP 500
    const failStatusLead = createMockEnquiry(
      {
        name: "Lead for Status Activity Failure",
        status: "ACTIVE",
        assignedTo: salesAgent1._id,
      },
      usersMap,
    );
    enquiriesMap.set(failStatusLead.id, failStatusLead);

    EnquiryActivity.prototype.save = async function (this: any) {
      if (this.enquiryId?.toString() === failStatusLead.id) {
        throw new Error("Simulated database write failure on status activity");
      }
      return currentActivitySave.call(this);
    };

    const failStatusRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${failStatusLead.id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          status: "CLOSED",
          reason: "Attempting closure with failing activity",
        }),
      },
    );
    const failStatusBody = (await failStatusRes.json()) as any;

    assert(
      failStatusRes.status === 500,
      "Returns HTTP 500 when status audit activity write fails",
    );
    assert(
      failStatusBody.success === false,
      "Does NOT report success when status audit write failed",
    );
    assert(
      failStatusLead.status === "ACTIVE",
      "Compensating rollback successfully reverted status to ACTIVE",
    );
    assert(
      failStatusLead.isActive === true,
      "Compensating rollback restored isActive to true",
    );

    EnquiryActivity.prototype.save = currentActivitySave;

    // -----------------------------------------------------------------
    // Suite 3: Duplicate Match Events Across ACTIVE and CLOSED
    // -----------------------------------------------------------------
    console.log("\n--- Suite 3: Duplicate Match Events (ACTIVE & CLOSED) ---");

    // Setup active enquiry with mobile +919111111111
    const activeDupLead = createMockEnquiry(
      {
        name: "Existing Active Client",
        mobile: "9111111111",
        normalizedMobile: "+919111111111",
        email: "active.client@example.com",
        normalizedEmail: "active.client@example.com",
        status: "ACTIVE",
      },
      usersMap,
    );
    enquiriesMap.set(activeDupLead.id, activeDupLead);

    // Setup closed enquiry with email closed.lead@example.com
    const closedDupLead = createMockEnquiry(
      {
        name: "Existing Closed Client",
        mobile: "9222222222",
        normalizedMobile: "+919222222222",
        email: "closed.lead@example.com",
        normalizedEmail: "closed.lead@example.com",
        status: "CLOSED",
        isActive: false,
      },
      usersMap,
    );
    enquiriesMap.set(closedDupLead.id, closedDupLead);

    // 3A: Creating enquiry with mobile matching active enquiry -> HTTP 409, logs DUPLICATE_MATCH_DETECTED
    const dupRes1 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${salesToken1}`,
      },
      body: JSON.stringify({
        name: "Duplicate Prospect 1",
        mobile: "9111111111",
      }),
    });
    const dupBody1 = (await dupRes1.json()) as any;

    assert(
      dupRes1.status === 409,
      "Duplicate mobile matching ACTIVE enquiry returns HTTP 409 Conflict",
    );
    assert(dupBody1.isDuplicate === true, "Response has isDuplicate: true");
    assert(
      dupBody1.duplicateType === "MOBILE_MATCH",
      "Duplicate type is MOBILE_MATCH",
    );

    // Privacy check on response data
    assert(
      dupBody1.data.matchedEnquiries[0].mobile === undefined,
      "Privacy: Matched enquiry summary stripped customer mobile number",
    );
    assert(
      dupBody1.data.matchedEnquiries[0].email === undefined,
      "Privacy: Matched enquiry summary stripped customer email address",
    );

    const dupActivity1 = savedActivities.find(
      (a) =>
        a.enquiryId.toString() === activeDupLead.id &&
        a.type === "DUPLICATE_MATCH_DETECTED",
    );
    assert(
      Boolean(dupActivity1),
      "Creates DUPLICATE_MATCH_DETECTED activity event on matched active enquiry",
    );
    assert(
      dupActivity1.metadata.matchReason === "MOBILE",
      "Activity metadata tracks matchReason: MOBILE",
    );
    assert(
      dupActivity1.performedByName === "Sales Agent Alpha",
      "Activity captures submitting employee name",
    );

    // 3B: Creating enquiry with email matching CLOSED enquiry -> HTTP 409, logs DUPLICATE_MATCH_DETECTED on CLOSED enquiry
    const dupRes2 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        name: "Duplicate Prospect 2",
        mobile: "9333333333",
        email: "closed.lead@example.com",
      }),
    });
    const dupBody2 = (await dupRes2.json()) as any;

    assert(
      dupRes2.status === 409,
      "Duplicate email matching CLOSED enquiry returns HTTP 409 Conflict",
    );
    assert(
      dupBody2.isDuplicate === true,
      "Detects duplicate against CLOSED enquiry",
    );

    const dupActivity2 = savedActivities.find(
      (a) =>
        a.enquiryId.toString() === closedDupLead.id &&
        a.type === "DUPLICATE_MATCH_DETECTED",
    );
    assert(
      Boolean(dupActivity2),
      "Creates DUPLICATE_MATCH_DETECTED activity event on matched CLOSED enquiry",
    );
    assert(
      dupActivity2.metadata.matchReason === "EMAIL",
      "Activity metadata tracks matchReason: EMAIL",
    );
    assert(
      dupActivity2.performedByName === "Manager Lead",
      "Captures manager name on duplicate event",
    );

    // 3C: Cross-field duplicate (mobile matches Active, email matches Closed) -> logs on BOTH enquiries
    const dupRes3 = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "Cross Duplicate Prospect",
        mobile: "9111111111", // Matches activeDupLead
        email: "closed.lead@example.com", // Matches closedDupLead
      }),
    });
    const dupBody3 = (await dupRes3.json()) as any;

    assert(
      dupRes3.status === 409,
      "Cross-field collision returns HTTP 409 Conflict",
    );
    assert(
      dupBody3.duplicateType === "CROSS_FIELD_MATCH",
      "Identifies CROSS_FIELD_MATCH",
    );
    assert(
      dupBody3.data.matchedEnquiries.length === 2,
      "Returns both matched enquiries for manual review",
    );

    // Check duplicate activity created on BOTH enquiries
    const activeDupEvents = savedActivities.filter(
      (a) =>
        a.enquiryId.toString() === activeDupLead.id &&
        a.type === "DUPLICATE_MATCH_DETECTED",
    );
    const closedDupEvents = savedActivities.filter(
      (a) =>
        a.enquiryId.toString() === closedDupLead.id &&
        a.type === "DUPLICATE_MATCH_DETECTED",
    );

    assert(
      activeDupEvents.length >= 2,
      "Logged second DUPLICATE_MATCH_DETECTED event on active enquiry",
    );
    assert(
      closedDupEvents.length >= 2,
      "Logged second DUPLICATE_MATCH_DETECTED event on closed enquiry",
    );

    // 3D: Repeated duplicate attempt creates separate event (append-only timeline)
    const countBeforeRepeat = savedActivities.length;
    await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${salesToken1}`,
      },
      body: JSON.stringify({
        name: "Duplicate Prospect 1 Retry",
        mobile: "9111111111",
      }),
    });
    assert(
      savedActivities.length === countBeforeRepeat + 1,
      "Repeated duplicate attempt logs a new distinct activity",
    );

    // 3E: Consistency & Safety: Partial failure across multiple duplicate matches
    const partialLeadA = createMockEnquiry(
      {
        name: "Partial Match Lead A",
        mobile: "9444444444",
        normalizedMobile: "+919444444444",
        status: "ACTIVE",
      },
      usersMap,
    );
    enquiriesMap.set(partialLeadA.id, partialLeadA);

    const partialLeadB = createMockEnquiry(
      {
        name: "Partial Match Lead B",
        email: "partial.b@example.com",
        normalizedEmail: "partial.b@example.com",
        status: "CLOSED",
        isActive: false,
      },
      usersMap,
    );
    enquiriesMap.set(partialLeadB.id, partialLeadB);

    // Make EnquiryActivity save fail ONLY for Lead B (partial failure)
    EnquiryActivity.prototype.save = async function (this: any) {
      if (this.enquiryId?.toString() === partialLeadB.id) {
        throw new Error(
          "Simulated database write failure on Lead B duplicate activity",
        );
      }
      return currentActivitySave.call(this);
    };

    const partialDupRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "Partial Duplicate Attempt",
        mobile: "9444444444", // Matches Lead A
        email: "partial.b@example.com", // Matches Lead B
      }),
    });
    const partialDupBody = (await partialDupRes.json()) as any;

    assert(
      partialDupRes.status === 500,
      "Partial audit failure across multiple matches returns HTTP 500",
    );
    assert(
      partialDupBody.success === false,
      "Does NOT report successful duplicate resolution (409) when audit event write failed",
    );
    assert(
      partialDupBody.error === "Internal Server Error",
      "Surfaces Internal Server Error",
    );

    // Lead A did record an activity, Lead B failed
    const leadAEvents = savedActivities.filter(
      (a) =>
        a.enquiryId.toString() === partialLeadA.id &&
        a.type === "DUPLICATE_MATCH_DETECTED",
    );
    assert(
      leadAEvents.length >= 1,
      "Lead A successfully received duplicate activity before Lead B failed",
    );

    EnquiryActivity.prototype.save = currentActivitySave;

    // -----------------------------------------------------------------
    // Suite 4: Activity History Retrieval (GET /:id/activities)
    // -----------------------------------------------------------------
    console.log("\n--- Suite 4: Activity History Retrieval ---");

    // Create an enquiry with multiple activity events in sequence
    const historyLead = createMockEnquiry(
      { name: "Audit Timeline Lead", status: "ACTIVE", assignedTo: salesAgent1._id },
      usersMap,
    );
    enquiriesMap.set(historyLead.id, historyLead);

    // Seed events with distinct timestamps:
    // Event 1: REMARK_ADDED (oldest)
    savedActivities.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      enquiryId: historyLead._id,
      performedBy: adminUser._id,
      performedByName: "Admin Director",
      type: "REMARK_ADDED",
      note: "Initial discussion completed.",
      metadata: {},
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    // Event 2: ASSIGNMENT_CHANGED
    savedActivities.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      enquiryId: historyLead._id,
      performedBy: managerUser._id,
      performedByName: "Manager Lead",
      type: "ASSIGNMENT_CHANGED",
      note: "Assigned to Sales Agent Alpha",
      metadata: {
        newAssigneeId: salesAgent1.id,
        newAssigneeName: "Sales Agent Alpha",
      },
      createdAt: new Date("2026-01-01T11:00:00.000Z"),
    });

    // Event 3: STATUS_CHANGED
    savedActivities.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      enquiryId: historyLead._id,
      performedBy: salesAgent1._id,
      performedByName: "Sales Agent Alpha",
      type: "STATUS_CHANGED",
      note: "Status changed from ACTIVE to CLOSED",
      metadata: {
        previousStatus: "ACTIVE",
        newStatus: "CLOSED",
        reason: "Project completed.",
      },
      createdAt: new Date("2026-01-01T12:00:00.000Z"),
    });

    // Event 4: DUPLICATE_MATCH_DETECTED (newest)
    savedActivities.push({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      enquiryId: historyLead._id,
      performedBy: adminUser._id,
      performedByName: "Admin Director",
      type: "DUPLICATE_MATCH_DETECTED",
      note: "Duplicate enquiry creation attempt detected via MOBILE match",
      metadata: { matchReason: "MOBILE" },
      createdAt: new Date("2026-01-01T13:00:00.000Z"),
    });

    // 4A: Fetch activities (default pagination: page 1, limit 20) -> newest-first
    const getActRes1 = await fetch(
      `${baseUrl}/api/v1/enquiries/${historyLead.id}/activities`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    const getActBody1 = (await getActRes1.json()) as any;

    assert(getActRes1.status === 200, "GET /activities returns HTTP 200 OK");
    assert(getActBody1.success === true, "Response specifies success: true");
    assert(
      getActBody1.data.activities.length === 4,
      "Returns all 4 activity records",
    );
    assert(
      getActBody1.data.activities[0].type === "DUPLICATE_MATCH_DETECTED",
      "First record is newest (DUPLICATE_MATCH_DETECTED)",
    );
    assert(
      getActBody1.data.activities[3].type === "REMARK_ADDED",
      "Last record is oldest (REMARK_ADDED)",
    );
    assert(getActBody1.data.pagination.total === 4, "Pagination total is 4");
    assert(getActBody1.data.pagination.page === 1, "Pagination page is 1");
    assert(getActBody1.data.pagination.limit === 20, "Pagination limit is 20");
    assert(
      getActBody1.data.pagination.hasMore === false,
      "hasMore is false when all records returned",
    );

    // 4B: SALES role can also view activities
    const getActResSales = await fetch(
      `${baseUrl}/api/v1/enquiries/${historyLead.id}/activities`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${salesToken1}` },
      },
    );
    assert(
      getActResSales.status === 200,
      "SALES role can access activity history",
    );

    // 4C: Custom pagination: page 1, limit 2
    const getActResPage1 = await fetch(
      `${baseUrl}/api/v1/enquiries/${historyLead.id}/activities?page=1&limit=2`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${managerToken}` },
      },
    );
    const getActBodyPage1 = (await getActResPage1.json()) as any;

    assert(
      getActBodyPage1.data.activities.length === 2,
      "Page 1 returns exactly 2 records",
    );
    assert(
      getActBodyPage1.data.pagination.totalPages === 2,
      "Total pages is 2",
    );
    assert(
      getActBodyPage1.data.pagination.hasMore === true,
      "hasMore is true for page 1",
    );
    assert(
      getActBodyPage1.data.activities[0].type === "DUPLICATE_MATCH_DETECTED",
      "Page 1 first record is newest",
    );

    // Custom pagination: page 2, limit 2
    const getActResPage2 = await fetch(
      `${baseUrl}/api/v1/enquiries/${historyLead.id}/activities?page=2&limit=2`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${managerToken}` },
      },
    );
    const getActBodyPage2 = (await getActResPage2.json()) as any;

    assert(
      getActBodyPage2.data.activities.length === 2,
      "Page 2 returns remaining 2 records",
    );
    assert(getActBodyPage2.data.pagination.page === 2, "Pagination page is 2");
    assert(
      getActBodyPage2.data.pagination.hasMore === false,
      "hasMore is false for final page",
    );
    assert(
      getActBodyPage2.data.activities[1].type === "REMARK_ADDED",
      "Page 2 last record is oldest",
    );

    // 4D: Non-existent enquiry -> HTTP 404 Not Found
    const notFoundActRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${fakeId}/activities`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    assert(
      notFoundActRes.status === 404,
      "GET /activities for non-existent enquiry returns HTTP 404",
    );

    // 4E: Invalid enquiry ID format -> HTTP 400 Bad Request
    const invalidActRes = await fetch(
      `${baseUrl}/api/v1/enquiries/invalid-id/activities`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    assert(
      invalidActRes.status === 400,
      "GET /activities with invalid ID returns HTTP 400",
    );

    // 4F: Unauthenticated request -> HTTP 401 Unauthorized
    const unauthActRes = await fetch(
      `${baseUrl}/api/v1/enquiries/${historyLead.id}/activities`,
    );
    assert(
      unauthActRes.status === 401,
      "Unauthenticated GET /activities returns HTTP 401",
    );
  } finally {
    // Restore original methods
    User.findById = originalUserFindById;
    Enquiry.findById = originalEnquiryFindById;
    Enquiry.find = originalEnquiryFind;
    EnquiryActivity.find = originalActivityFind;
    EnquiryActivity.countDocuments = originalActivityCount;
    EnquiryActivity.prototype.save = originalActivitySave;

    if (server) {
      server.close();
    }
  }

  console.log("\n====================================================");
  console.log(
    `Phase 3 Test Suite Finished: ${passed} passed, ${failed} failed`,
  );
  console.log("====================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error("Unhandled test execution error:", err);
  process.exit(1);
});
