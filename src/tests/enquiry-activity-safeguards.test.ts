import { Types } from "mongoose";
import {
  EnquiryActivity,
  IEnquiryActivity,
  AppendOnlyViolationError,
} from "../models/enquiry-activity.model.js";
import { Enquiry } from "../models/enquiry.model.js";
import { User } from "../models/user.model.js";

async function runActivitySafeguardsTests() {
  console.log("====================================================");
  console.log("Starting EnquiryActivity Append-Only Safeguards Test Suite");
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

  const sampleEnquiryId = new Types.ObjectId();
  const sampleUserId = new Types.ObjectId();

  // -----------------------------------------------------------------
  // Suite 1: Legitimate Activity Creation & Contract Validation
  // -----------------------------------------------------------------
  console.log("--- Suite 1: Legitimate Activity Creation ---");

  // Helper to validate async
  const validateAsync = async (doc: any) => {
    try {
      await doc.validate();
      return undefined;
    } catch (err) {
      return err;
    }
  };

  // Test 1A: Approved event types with modern actor identity
  const modernActivity = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    performedBy: sampleUserId,
    performedByName: "Sarah Agent",
    type: "REMARK_ADDED",
    note: "Customer interested in 3BHK north-facing unit.",
    metadata: { leadScore: 85 },
  });

  const modernValErr = await validateAsync(modernActivity);
  assert(
    modernValErr === undefined,
    "Validates modern REMARK_ADDED activity without errors",
  );
  assert(modernActivity.type === "REMARK_ADDED", "Type is REMARK_ADDED");
  assert(
    modernActivity.performedByName === "Sarah Agent",
    "Captures performedByName snapshot",
  );
  assert(
    modernActivity.createdById?.toString() === sampleUserId.toString(),
    "Synchronizes createdById from performedBy",
  );
  assert(
    modernActivity.createdByName === "Sarah Agent",
    "Synchronizes createdByName from performedByName",
  );
  assert(modernActivity.isNew === true, "Document isNew is true on creation");

  // Test 1B: All approved event types validate successfully
  const approvedTypes = [
    "REMARK_ADDED",
    "ASSIGNMENT_CHANGED",
    "STATUS_CHANGED",
    "DUPLICATE_MATCH_DETECTED",
  ] as const;

  for (const eventType of approvedTypes) {
    const act = new EnquiryActivity({
      enquiryId: sampleEnquiryId,
      performedBy: sampleUserId,
      type: eventType,
      note: `Event of type ${eventType}`,
    });
    const valErr = await validateAsync(act);
    assert(valErr === undefined, `Validates approved event type: ${eventType}`);
  }

  // Test 1C: Legacy types backward compatibility
  const legacyTypes = ["REMARK", "STATUS_CHANGE", "DUPLICATE_ATTEMPT"] as const;
  for (const legType of legacyTypes) {
    const act = new EnquiryActivity({
      enquiryId: sampleEnquiryId,
      createdById: sampleUserId,
      type: legType,
      note: `Legacy event ${legType}`,
    });
    const valErr = await validateAsync(act);
    assert(valErr === undefined, `Validates legacy event type: ${legType}`);
    assert(
      act.performedBy?.toString() === sampleUserId.toString(),
      `Synchronizes performedBy from legacy createdById for ${legType}`,
    );
  }

  // Test 1D: Conflicting actor input synchronization (modern performedBy is authoritative)
  const conflictingUserId = new Types.ObjectId();
  const conflictingActivity = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    performedBy: sampleUserId, // Authoritative modern actor
    createdById: conflictingUserId, // Conflicting legacy actor
    performedByName: "Authoritative Modern Name",
    createdByName: "Conflicting Legacy Name",
    type: "REMARK_ADDED",
    note: "Testing actor conflict resolution",
  });
  const conflictValErr = await validateAsync(conflictingActivity);
  assert(
    conflictValErr === undefined,
    "Validates activity with conflicting actor fields without throwing schema error",
  );
  assert(
    conflictingActivity.createdById?.toString() === sampleUserId.toString(),
    "Authoritative performedBy overrides conflicting createdById to prevent audit trail desynchronization",
  );
  assert(
    conflictingActivity.createdByName === "Authoritative Modern Name",
    "Authoritative performedByName overrides conflicting createdByName",
  );

  // Test 1E: Missing actor values (system event)
  const systemActivity = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    type: "STATUS_CHANGED",
    note: "System auto-closed inactive enquiry",
  });
  const sysValErr = await validateAsync(systemActivity);
  assert(
    sysValErr === undefined,
    "Validates system activity without actor identity",
  );
  assert(
    systemActivity.createdById === null,
    "createdById is null when actor omitted",
  );
  assert(
    systemActivity.performedBy === null,
    "performedBy is null when actor omitted",
  );
  assert(
    systemActivity.createdByName === undefined,
    "createdByName is undefined when actor omitted",
  );
  assert(
    systemActivity.performedByName === undefined,
    "performedByName is undefined when actor omitted",
  );

  // -----------------------------------------------------------------
  // Suite 2: Document-Level Mutation Safeguards
  // -----------------------------------------------------------------
  console.log("\n--- Suite 2: Document-Level Mutation Safeguards ---");

  // Test 2A: save() on existing document (isNew = false) must be rejected
  const existingActivity = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    performedBy: sampleUserId,
    type: "REMARK_ADDED",
    note: "Original immutable note",
  });
  // Simulate an existing document retrieved from database
  existingActivity.isNew = false;
  existingActivity.note = "Attempted illicit modification";

  let docSaveError: any = null;
  try {
    await existingActivity.save();
  } catch (err) {
    docSaveError = err;
  }

  assert(
    docSaveError !== null,
    "Rejects save() on existing activity document (isNew = false)",
  );
  assert(
    docSaveError instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError instance",
  );
  assert(
    docSaveError?.message.includes(
      "append-only: existing activity records cannot be modified",
    ),
    "Error message cites append-only restriction",
  );

  // Test 2B: deleteOne() on document instance must be rejected
  let docDeleteError: any = null;
  try {
    await existingActivity.deleteOne();
  } catch (err) {
    docDeleteError = err;
  }

  assert(
    docDeleteError !== null,
    "Rejects deleteOne() on activity document instance",
  );
  assert(
    docDeleteError instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on doc.deleteOne()",
  );
  assert(
    docDeleteError?.message.includes(
      'document operation "deleteOne" is prohibited',
    ),
    "Cites prohibited document delete operation",
  );

  // Test 2C: Verify document fields remain unchanged after rejected save
  const pristineActivity = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    performedBy: sampleUserId,
    type: "ASSIGNMENT_CHANGED",
    note: "Preserved original audit record",
  });
  pristineActivity.isNew = false;
  try {
    await pristineActivity.save();
  } catch (_e) {
    // Expected rejection
  }
  assert(
    pristineActivity.note === "Preserved original audit record",
    "Existing activity record note is preserved after rejected mutation",
  );
  assert(
    pristineActivity.type === "ASSIGNMENT_CHANGED",
    "Existing activity record type is preserved after rejected mutation",
  );

  // -----------------------------------------------------------------
  // Suite 3: Query-Level Update Safeguards
  // -----------------------------------------------------------------
  console.log("\n--- Suite 3: Query-Level Update Safeguards ---");

  // Test 3A: updateOne query
  let updateOneErr: any = null;
  try {
    await EnquiryActivity.updateOne(
      { _id: new Types.ObjectId() },
      { $set: { note: "Tampered note" } },
    );
  } catch (err) {
    updateOneErr = err;
  }
  assert(updateOneErr !== null, "Rejects EnquiryActivity.updateOne()");
  assert(
    updateOneErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on updateOne",
  );
  assert(
    updateOneErr?.message.includes("updateOne"),
    "Identifies updateOne method",
  );

  // Test 3B: updateMany query
  let updateManyErr: any = null;
  try {
    await EnquiryActivity.updateMany(
      { enquiryId: sampleEnquiryId },
      { $set: { note: "Tampered note" } },
    );
  } catch (err) {
    updateManyErr = err;
  }
  assert(updateManyErr !== null, "Rejects EnquiryActivity.updateMany()");
  assert(
    updateManyErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on updateMany",
  );

  // Test 3C: findOneAndUpdate query
  let findOneAndUpdateErr: any = null;
  try {
    await EnquiryActivity.findOneAndUpdate(
      { _id: new Types.ObjectId() },
      { $set: { note: "Tampered note" } },
    );
  } catch (err) {
    findOneAndUpdateErr = err;
  }
  assert(
    findOneAndUpdateErr !== null,
    "Rejects EnquiryActivity.findOneAndUpdate()",
  );
  assert(
    findOneAndUpdateErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on findOneAndUpdate",
  );

  // Test 3D: findByIdAndUpdate (delegates internally to findOneAndUpdate)
  let findByIdAndUpdateErr: any = null;
  try {
    await EnquiryActivity.findByIdAndUpdate(new Types.ObjectId(), {
      $set: { note: "Tampered note" },
    });
  } catch (err) {
    findByIdAndUpdateErr = err;
  }
  assert(
    findByIdAndUpdateErr !== null,
    "Rejects EnquiryActivity.findByIdAndUpdate()",
  );
  assert(
    findByIdAndUpdateErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on findByIdAndUpdate",
  );

  // Test 3E: replaceOne query
  let replaceOneErr: any = null;
  try {
    await EnquiryActivity.replaceOne(
      { _id: new Types.ObjectId() },
      {
        enquiryId: sampleEnquiryId,
        note: "Replaced content",
        type: "REMARK_ADDED",
      },
    );
  } catch (err) {
    replaceOneErr = err;
  }
  assert(replaceOneErr !== null, "Rejects EnquiryActivity.replaceOne()");
  assert(
    replaceOneErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on replaceOne",
  );

  // -----------------------------------------------------------------
  // Suite 4: Query-Level Delete Safeguards
  // -----------------------------------------------------------------
  console.log("\n--- Suite 4: Query-Level Delete Safeguards ---");

  // Test 4A: deleteOne query
  let deleteOneErr: any = null;
  try {
    await EnquiryActivity.deleteOne({ _id: new Types.ObjectId() });
  } catch (err) {
    deleteOneErr = err;
  }
  assert(deleteOneErr !== null, "Rejects EnquiryActivity.deleteOne() query");
  assert(
    deleteOneErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on deleteOne",
  );

  // Test 4B: deleteMany query
  let deleteManyErr: any = null;
  try {
    await EnquiryActivity.deleteMany({ enquiryId: sampleEnquiryId });
  } catch (err) {
    deleteManyErr = err;
  }
  assert(deleteManyErr !== null, "Rejects EnquiryActivity.deleteMany() query");
  assert(
    deleteManyErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on deleteMany",
  );

  // Test 4C: findOneAndDelete query
  let findOneAndDeleteErr: any = null;
  try {
    await EnquiryActivity.findOneAndDelete({ _id: new Types.ObjectId() });
  } catch (err) {
    findOneAndDeleteErr = err;
  }
  assert(
    findOneAndDeleteErr !== null,
    "Rejects EnquiryActivity.findOneAndDelete() query",
  );
  assert(
    findOneAndDeleteErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on findOneAndDelete",
  );

  // Test 4D: findByIdAndDelete query (delegates internally to findOneAndDelete)
  let findByIdAndDeleteErr: any = null;
  try {
    await EnquiryActivity.findByIdAndDelete(new Types.ObjectId());
  } catch (err) {
    findByIdAndDeleteErr = err;
  }
  assert(
    findByIdAndDeleteErr !== null,
    "Rejects EnquiryActivity.findByIdAndDelete() query",
  );
  assert(
    findByIdAndDeleteErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on findByIdAndDelete",
  );

  // -----------------------------------------------------------------
  // Suite 5: Static Bulk Operations Safeguards
  // -----------------------------------------------------------------
  console.log("\n--- Suite 5: Static Bulk Operations Safeguards ---");

  const bulkMutationOps = [
    {
      name: "updateOne",
      op: {
        updateOne: {
          filter: { _id: sampleEnquiryId },
          update: { $set: { note: "x" } },
        },
      },
    },
    {
      name: "updateMany",
      op: {
        updateMany: {
          filter: { enquiryId: sampleEnquiryId },
          update: { $set: { note: "x" } },
        },
      },
    },
    {
      name: "replaceOne",
      op: {
        replaceOne: {
          filter: { _id: sampleEnquiryId },
          replacement: { note: "x" },
        },
      },
    },
    {
      name: "deleteOne",
      op: { deleteOne: { filter: { _id: sampleEnquiryId } } },
    },
    {
      name: "deleteMany",
      op: { deleteMany: { filter: { enquiryId: sampleEnquiryId } } },
    },
  ];

  for (const { name, op } of bulkMutationOps) {
    let bulkErr: any = null;
    try {
      (EnquiryActivity as any).bulkWrite([op]);
    } catch (err) {
      bulkErr = err;
    }
    assert(bulkErr !== null, `Rejects bulkWrite containing ${name}`);
    assert(
      bulkErr instanceof AppendOnlyViolationError,
      `Throws AppendOnlyViolationError on bulkWrite ${name}`,
    );
    assert(
      bulkErr?.message.includes(
        "bulkWrite update and delete operations are prohibited",
      ),
      `Cites bulkWrite restriction for ${name}`,
    );
  }

  // bulkSave on existing document
  const existingBulkDoc = new EnquiryActivity({
    enquiryId: sampleEnquiryId,
    performedBy: sampleUserId,
    type: "REMARK_ADDED",
    note: "Bulk save target",
  });
  existingBulkDoc.isNew = false;

  let bulkSaveErr: any = null;
  try {
    (EnquiryActivity as any).bulkSave([existingBulkDoc]);
  } catch (err) {
    bulkSaveErr = err;
  }
  assert(
    bulkSaveErr !== null,
    "Rejects bulkSave on existing activity document",
  );
  assert(
    bulkSaveErr instanceof AppendOnlyViolationError,
    "Throws AppendOnlyViolationError on bulkSave",
  );
  assert(
    bulkSaveErr?.message.includes(
      "bulkSave cannot update existing activity records",
    ),
    "Cites bulkSave restriction",
  );

  // -----------------------------------------------------------------
  // Suite 6: Isolation & Non-Interference with Other Models
  // -----------------------------------------------------------------
  console.log("\n--- Suite 6: Non-Interference with Enquiry & User Models ---");

  // Test 5A: Enquiry model does not have append-only restrictions
  const testEnquiry = new Enquiry({
    name: "Isolation Check Lead",
    mobile: "9876543210",
  });
  testEnquiry.isNew = false; // Even if isNew is false, validate should pass without append-only error
  const enquiryValErr = await validateAsync(testEnquiry);
  assert(
    enquiryValErr === undefined,
    "Enquiry model validation is unaffected by EnquiryActivity safeguards",
  );

  // Test 5B: User model does not have append-only restrictions
  const testUser = new User({
    name: "Isolation Check User",
    email: "isolation@Neuways.com",
    passwordHash: "hash",
    role: "SALES",
  });
  testUser.isNew = false;
  const userValErr = await validateAsync(testUser);
  assert(
    userValErr === undefined,
    "User model validation is unaffected by EnquiryActivity safeguards",
  );

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

runActivitySafeguardsTests().catch((err) => {
  console.error("Unhandled activity safeguards test suite error:", err);
  process.exit(1);
});
