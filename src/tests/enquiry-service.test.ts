import { Types } from "mongoose";
import { EnquiryService } from "../services/enquiry.service.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { EnquiryActivity } from "../models/enquiry-activity.model.js";

/**
 * Non-destructive, in-memory mock test suite for EnquiryService.
 * Does not require or connect to any MongoDB database.
 */
async function runTests() {
  console.log("====================================================");
  console.log("Starting In-Memory EnquiryService Unit Test Suite");
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

  const service = new EnquiryService();
  const originalActivitySave = EnquiryActivity.prototype.save;
  EnquiryActivity.prototype.save = function (this: any) {
    return Promise.resolve(this);
  };

  // Helper to construct mock IEnquiry documents
  const createMockEnquiry = (data: Partial<IEnquiry>): IEnquiry => {
    const id = new Types.ObjectId();
    return {
      _id: id,
      id: id.toString(),
      name: data.name || "Sample Lead",
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

  // -----------------------------------------------------------------
  // 1. Validation Tests
  // -----------------------------------------------------------------
  console.log("--- Suite 1: Input Validation ---");

  try {
    await service.createEnquiry({ name: "", mobile: "9876543210" });
    assert(false, "Should reject empty name");
  } catch (err: any) {
    assert(
      err.message.includes("Enquiry name is required"),
      "Rejects empty name",
    );
  }

  try {
    await service.createEnquiry({ name: "Rahul", mobile: "" });
    assert(false, "Should reject empty mobile");
  } catch (err: any) {
    assert(
      err.message.includes("Enquiry mobile number is required"),
      "Rejects empty mobile",
    );
  }

  try {
    await service.createEnquiry({ name: "Rahul", mobile: "12345" });
    assert(false, "Should reject invalid mobile format");
  } catch (err: any) {
    assert(
      err.message.includes("Invalid mobile phone number format"),
      "Rejects short/invalid mobile format",
    );
  }

  try {
    await service.createEnquiry({
      name: "Rahul",
      mobile: "9876543210",
      budgetMin: 5000000,
      budgetMax: 2000000,
    });
    assert(false, "Should reject budgetMin > budgetMax");
  } catch (err: any) {
    assert(
      err.message.includes("Minimum budget cannot exceed maximum budget"),
      "Rejects budgetMin > budgetMax",
    );
  }

  try {
    await service.createEnquiry({
      name: "Rahul",
      mobile: "9876543210",
      assignedToId: "not-a-valid-id",
    });
    assert(false, "Should reject invalid ObjectId for assignedToId");
  } catch (err: any) {
    assert(
      err.message.includes("is not a valid ObjectId"),
      "Rejects invalid assignedToId format",
    );
  }

  // -----------------------------------------------------------------
  // 2. New Enquiry Creation Tests (No Duplicate, Optional Email)
  // -----------------------------------------------------------------
  console.log("\n--- Suite 2: New Enquiry Creation ---");
  {
    const originalFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([]),
    })) as any;

    const originalSave = Enquiry.prototype.save;
    Enquiry.prototype.save = function (this: any) {
      return Promise.resolve(this);
    } as any;

    try {
      const result = await service.createEnquiry({
        name: "Amit Sharma",
        mobile: "9876543210",
        email: "amit@example.com",
        projectName: "Green Meadows",
      });

      assert(
        result.success === true && result.isDuplicate === false,
        "Successfully creates new non-duplicate enquiry",
      );
      if (result.success && !result.isDuplicate) {
        assert(
          result.enquiry.normalizedMobile === "+919876543210",
          "Canonical mobile normalization applied",
        );
        assert(
          result.enquiry.normalizedEmail === "amit@example.com",
          "Email normalization applied",
        );
      }

      // Test safe handling of whitespace-only email (should omit email completely)
      const resultWhitespaceEmail = await service.createEnquiry({
        name: "Sneha Patel",
        mobile: "9876543210",
        email: "   ", // whitespace only
      });

      assert(
        resultWhitespaceEmail.success === true,
        "Successfully creates enquiry with whitespace-only email",
      );
      if (resultWhitespaceEmail.success && !resultWhitespaceEmail.isDuplicate) {
        assert(
          resultWhitespaceEmail.enquiry.email === undefined,
          "Whitespace email safely treated as undefined",
        );
        assert(
          resultWhitespaceEmail.enquiry.normalizedEmail === undefined,
          "Normalized email safely undefined",
        );
      }
    } finally {
      Enquiry.find = originalFind;
      Enquiry.prototype.save = originalSave;
    }
  }

  // -----------------------------------------------------------------
  // 3. Single Duplicate Match Tests (Mobile & Email)
  // -----------------------------------------------------------------
  console.log("\n--- Suite 3: Single Duplicate Detection ---");
  {
    const existingEnquiry = createMockEnquiry({
      name: "Existing Amit",
      mobile: "+91 98765 43210",
      normalizedMobile: "+919876543210",
      email: "amit.old@example.com",
      normalizedEmail: "amit.old@example.com",
    });

    const originalFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([existingEnquiry]),
    })) as any;

    try {
      const result = await service.createEnquiry({
        name: "New Duplicate Attempt",
        mobile: "9876543210",
        email: "different@example.com",
      });

      assert(
        result.success === false && result.isDuplicate === true,
        "Blocks creation when mobile matches",
      );
      if (result.isDuplicate) {
        assert(
          result.duplicateType === "MOBILE_MATCH",
          "Identifies duplicateType as MOBILE_MATCH",
        );
        assert(
          result.matches.mobileMatch?.id === existingEnquiry.id,
          "Populates matching mobile enquiry reference",
        );
        assert(
          result.matchedEnquiries.length === 1,
          "Returns single matched enquiry list",
        );
      }
    } finally {
      Enquiry.find = originalFind;
    }
  }

  {
    const existingEnquiry = createMockEnquiry({
      name: "Existing Lead",
      mobile: "9111122222",
      normalizedMobile: "+919111122222",
      email: "priya@example.com",
      normalizedEmail: "priya@example.com",
    });

    const originalFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([existingEnquiry]),
    })) as any;

    try {
      const result = await service.createEnquiry({
        name: "Priya New Lead",
        mobile: "9999988888",
        email: "  PRIYA@EXAMPLE.COM ",
      });

      assert(
        result.success === false && result.isDuplicate === true,
        "Blocks creation when email matches",
      );
      if (result.isDuplicate) {
        assert(
          result.duplicateType === "EMAIL_MATCH",
          "Identifies duplicateType as EMAIL_MATCH",
        );
        assert(
          result.matches.emailMatch?.id === existingEnquiry.id,
          "Populates matching email enquiry reference",
        );
      }
    } finally {
      Enquiry.find = originalFind;
    }
  }

  // -----------------------------------------------------------------
  // 4. Cross-Field Duplicate Detection (Mobile matches A, Email matches B)
  // -----------------------------------------------------------------
  console.log("\n--- Suite 4: Cross-Field Duplicate Detection ---");
  {
    const enquiryA = createMockEnquiry({
      name: "Lead Alpha",
      normalizedMobile: "+919876543210",
      normalizedEmail: "alpha@example.com",
    });

    const enquiryB = createMockEnquiry({
      name: "Lead Beta",
      normalizedMobile: "+919111122222",
      normalizedEmail: "beta@example.com",
    });

    const originalFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([enquiryA, enquiryB]),
    })) as any;

    try {
      const result = await service.createEnquiry({
        name: "Conflicting Cross Submission",
        mobile: "9876543210",
        email: "beta@example.com",
      });

      assert(
        result.success === false && result.isDuplicate === true,
        "Blocks creation on cross-field match",
      );
      if (result.isDuplicate) {
        assert(
          result.duplicateType === "CROSS_FIELD_MATCH",
          "Categorizes as CROSS_FIELD_MATCH",
        );
        assert(
          result.matchedEnquiries.length === 2,
          "Returns both distinct matching enquiries",
        );
        assert(
          result.matches.mobileMatch?.id === enquiryA.id,
          "Identifies Enquiry A as mobile match",
        );
        assert(
          result.matches.emailMatch?.id === enquiryB.id,
          "Identifies Enquiry B as email match",
        );
        assert(
          result.message.includes(
            "Both matches are returned for explicit resolution",
          ),
          "Message explicitly requests manual resolution rather than auto-merging",
        );
      }
    } finally {
      Enquiry.find = originalFind;
    }
  }

  // -----------------------------------------------------------------
  // 5. Concurrent E11000 Duplicate Key Error Recovery
  // -----------------------------------------------------------------
  console.log("\n--- Suite 5: Concurrent E11000 Race Condition Recovery ---");
  {
    // Case 5A: E11000 with matching record found upon re-query
    const winningEnquiry = createMockEnquiry({
      name: "Winning Concurrent Lead",
      normalizedMobile: "+919876543210",
    });

    let findCalls = 0;
    const originalFind = Enquiry.find;
    Enquiry.find = (() => {
      findCalls++;
      const docs = findCalls === 1 ? [] : [winningEnquiry];
      return {
        populate: () => Promise.resolve(docs),
      };
    }) as any;

    const originalSave = Enquiry.prototype.save;
    Enquiry.prototype.save = function (this: any) {
      const err: any = new Error(
        "E11000 duplicate key error collection: Neuways_crm.enquiries index: unique_active_normalized_mobile",
      );
      err.code = 11000;
      err.name = "MongoServerError";
      return Promise.reject(err);
    } as any;

    try {
      const result = await service.createEnquiry({
        name: "Losing Concurrent Lead",
        mobile: "9876543210",
      });

      assert(
        result.success === false && result.isDuplicate === true,
        "Gracefully intercepts E11000 with matching record",
      );
      if (result.isDuplicate) {
        assert(
          result.duplicateType === "CONCURRENT_COLLISION",
          "Classified as CONCURRENT_COLLISION",
        );
        assert(
          result.matchedEnquiries[0]?.id === winningEnquiry.id,
          "Successfully retrieves winning active record",
        );
      }
    } finally {
      Enquiry.find = originalFind;
      Enquiry.prototype.save = originalSave;
    }
  }

  {
    // Case 5B: E11000 without matching record found upon re-query
    // (e.g. unexpected conflict on another index or transient collision)
    // The service must NOT falsely report a confirmed duplicate, but safely rethrow/propagate.
    const originalFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([]), // Re-query finds no active matching record
    })) as any;

    const originalSave = Enquiry.prototype.save;
    Enquiry.prototype.save = function (this: any) {
      const err: any = new Error(
        "E11000 duplicate key error on unexpected index",
      );
      err.code = 11000;
      err.name = "MongoServerError";
      return Promise.reject(err);
    } as any;

    try {
      await service.createEnquiry({
        name: "Orphan Conflict Lead",
        mobile: "9876543210",
      });
      assert(
        false,
        "Should have thrown error when E11000 has no matching active enquiry",
      );
    } catch (err: any) {
      assert(
        err.message.includes(
          "Database duplicate key conflict occurred, but no active matching enquiry could be retrieved",
        ),
        "Safely propagates unexpected E11000 when no active match is found instead of falsely claiming duplicate",
      );
    } finally {
      Enquiry.find = originalFind;
      Enquiry.prototype.save = originalSave;
    }
  }

  EnquiryActivity.prototype.save = originalActivitySave;

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

runTests().catch((err) => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
