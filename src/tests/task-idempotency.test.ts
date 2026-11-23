/**
 * Neuways CRM - REC-01 Database-Level Task Idempotency Test Suite
 *
 * Verifies:
 * 1. One initial task per enquiry on lead creation / assignment
 * 2. Multiple manual follow-up tasks on same enquiry remain valid and are not blocked by the index
 * 3. Concurrent initial task reconciliation runs cleanly with zero duplicate tasks
 * 4. Multi-instance simulation: two independent service instances executing reconciliation concurrently
 * 5. Explicit error code 11000 duplicate key interception handled idempotently without throwing
 * 6. Pre-inspection safety check correctly detects duplicates if any were to exist
 * 7. Existing task preservation (dates, ownership, status, notes)
 * 8. Repeated reconciliation idempotency (10 consecutive executions produce 0 duplicate records)
 * 9. Schema-level index configuration verification
 */

import mongoose, { Types } from 'mongoose';
import { Enquiry } from '../models/enquiry.model.js';
import { User } from '../models/user.model.js';
import { FollowUpTask, IFollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { EnquiryService, enquiryService, isInitialTaskDuplicateKeyError } from '../services/enquiry.service.js';
import { notificationService } from '../services/notification.service.js';
import { AuthUser } from '../types/auth.types.js';

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string, detail?: any) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    if (detail) console.error('  Detail:', detail);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTaskIdempotencyTests() {
  (mongoose.connection as any).readyState = 1;

  console.log('========================================================================');
  console.log('Neuways CRM - Phase 1A.2: REC-01 Database-Level Task Idempotency Tests');
  console.log('========================================================================\n');

  // Suppress real external notification timeouts
  (notificationService as any).createNotification = () => Promise.resolve({ success: true });
  (EnquiryActivity as any).prototype.save = function () {
    return Promise.resolve(this);
  };
  (Enquiry as any).prototype.populate = function () {
    return Promise.resolve(this);
  };

  // In-memory data store for isolated unit verification
  const userStore: any[] = [];
  const enquiryStore: any[] = [];
  const taskStore: any[] = [];

  const agentId = new Types.ObjectId();
  const agentUser: AuthUser = {
    id: agentId.toString(),
    email: 'agent.idempotency@neuways.com',
    role: 'SALES',
    name: 'Idempotency Agent'
  };

  const adminUser: AuthUser = {
    id: new Types.ObjectId().toString(),
    email: 'admin.idempotency@neuways.com',
    role: 'ADMIN',
    name: 'Admin Tester'
  };

  userStore.push({
    _id: agentId,
    name: 'Idempotency Agent',
    email: 'agent.idempotency@neuways.com',
    role: 'SALES',
    isActive: true,
    isTeamActive: true
  });

  // Mock User
  (User as any).findById = function (id: any) {
    const found = userStore.find((u) => u._id.toString() === id?.toString());
    const chain: any = {
      select: () => chain,
      populate: () => chain,
      lean: () => Promise.resolve(found || null),
      exec: () => Promise.resolve(found || null),
      then: (fn: any) => Promise.resolve(found || null).then(fn)
    };
    return chain;
  };
  (User as any).find = function (filter: any = {}) {
    let result = [...userStore];
    if (filter.role) result = result.filter((u) => u.role === filter.role);
    if (filter.isActive !== undefined) result = result.filter((u) => u.isActive === filter.isActive);
    if (filter._id?.$in) {
      const ids = filter._id.$in.map((i: any) => i.toString());
      result = result.filter((u) => ids.includes(u._id.toString()));
    }
    const chain: any = {
      select: () => chain,
      lean: () => Promise.resolve(result),
      exec: () => Promise.resolve(result),
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };

  // Mock Enquiry
  (Enquiry as any).findById = function (id: any) {
    const found = enquiryStore.find((e) => e._id.toString() === id.toString());
    return Promise.resolve(found || null);
  };
  (Enquiry as any).find = function (filter: any = {}) {
    let result = [...enquiryStore];
    if (filter.status) result = result.filter((e) => e.status === filter.status);
    if (filter.assignedTo && filter.assignedTo.$ne === null) {
      result = result.filter((e) => e.assignedTo !== null && e.assignedTo !== undefined);
    }
    const chain = {
      select: () => chain,
      lean: () => Promise.resolve(result),
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      populate: () => chain,
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };
  (Enquiry as any).prototype.save = function () {
    const existingIdx = enquiryStore.findIndex((e) => e._id.toString() === this._id.toString());
    if (existingIdx >= 0) {
      enquiryStore[existingIdx] = this;
    } else {
      enquiryStore.push(this);
    }
    return Promise.resolve(this);
  };

  // Helper simulating unique index enforcement:
  // In MongoDB, unique index on { enquiryId: 1 } with partialFilterExpression: { isInitialTask: true }
  // rejects any new insert where isInitialTask === true if an existing task for that enquiry has isInitialTask === true.
  function validatePartialUniqueIndex(doc: any) {
    if (doc.isInitialTask === true) {
      const enquiryIdStr = (doc.enquiryId?._id || doc.enquiryId).toString();
      const duplicate = taskStore.find(
        (t) => (t.enquiryId?._id || t.enquiryId).toString() === enquiryIdStr && t.isInitialTask === true && t._id.toString() !== doc._id?.toString()
      );
      if (duplicate) {
        const mongoError: any = new Error(
          `E11000 duplicate key error collection: follow_up_tasks index: unique_initial_task_per_enquiry dup key: { enquiryId: ObjectId('${enquiryIdStr}') }`
        );
        mongoError.code = 11000;
        mongoError.codeName = 'DuplicateKey';
        mongoError.name = 'MongoServerError';
        throw mongoError;
      }
    }
  }

  // Mock FollowUpTask
  (FollowUpTask as any).find = function (filter: any = {}) {
    let result = [...taskStore];
    if (filter.enquiryId) {
      if (filter.enquiryId.$in) {
        const idStrings = new Set(filter.enquiryId.$in.map((id: any) => id.toString()));
        result = result.filter((t) => idStrings.has((t.enquiryId?._id || t.enquiryId).toString()));
      } else {
        result = result.filter(
          (t) => (t.enquiryId?._id || t.enquiryId).toString() === filter.enquiryId.toString()
        );
      }
    }
    const chain = {
      select: () => chain,
      lean: () => Promise.resolve(result),
      sort: () => chain,
      then: (fn: any) => Promise.resolve(result).then(fn)
    };
    return chain;
  };

  (FollowUpTask as any).countDocuments = function (filter: any = {}) {
    let result = [...taskStore];
    if (filter.enquiryId) {
      result = result.filter((t) => (t.enquiryId?._id || t.enquiryId).toString() === filter.enquiryId.toString());
    }
    return Promise.resolve(result.length);
  };

  (FollowUpTask as any).prototype.save = function () {
    validatePartialUniqueIndex(this);
    const existingIdx = taskStore.findIndex((t) => t._id?.toString() === this._id?.toString());
    if (existingIdx >= 0) {
      taskStore[existingIdx] = this;
    } else {
      if (!this._id) this._id = new Types.ObjectId();
      taskStore.push(this);
    }
    return Promise.resolve(this);
  };

  (FollowUpTask as any).insertMany = function (docs: any[], options: any = {}) {
    const inserted: any[] = [];
    const writeErrors: any[] = [];

    for (let i = 0; i < docs.length; i++) {
      const doc = { ...docs[i], _id: docs[i]._id || new Types.ObjectId() };
      try {
        validatePartialUniqueIndex(doc);
        taskStore.push(doc);
        inserted.push(doc);
      } catch (err: any) {
        if (err.code === 11000) {
          writeErrors.push({
            index: i,
            code: 11000,
            errmsg: err.message
          });
        } else {
          throw err;
        }
      }
    }

    if (writeErrors.length > 0) {
      const bulkError: any = new Error('E11000 duplicate key error in bulk write');
      bulkError.name = 'MongoBulkWriteError';
      bulkError.code = 11000;
      bulkError.writeErrors = writeErrors;
      bulkError.insertedDocs = inserted;
      return Promise.reject(bulkError);
    }

    return Promise.resolve(inserted);
  };

  (FollowUpTask as any).aggregate = function (pipeline: any[] = []) {
    // In-memory aggregation mock for checkInitialTaskSafety
    let working = [...taskStore];
    for (const stage of pipeline) {
      if (stage.$match) {
        if (stage.$match.$or) {
          working = working.filter((t) => {
            return stage.$match.$or.some((cond: any) => {
              if (cond.isInitialTask !== undefined && t.isInitialTask === cond.isInitialTask) return true;
              if (cond.notes !== undefined && t.notes === cond.notes) return true;
              return false;
            });
          });
        }
      }
      if (stage.$group) {
        const groups = new Map<string, any>();
        for (const item of working) {
          const key = (item.enquiryId?._id || item.enquiryId).toString();
          if (!groups.has(key)) {
            groups.set(key, { _id: key, count: 0, taskIds: [] });
          }
          const g = groups.get(key);
          g.count++;
          g.taskIds.push(item._id);
        }
        working = Array.from(groups.values());
      }
      if (stage.$match && stage.$match.count) {
        if (stage.$match.count.$gt !== undefined) {
          const threshold = stage.$match.count.$gt;
          working = working.filter((g) => g.count > threshold);
        }
      }
    }
    return Promise.resolve(working);
  };

  // =========================================================================
  // TEST 1: Schema-Level Index Configuration Verification
  // =========================================================================
  console.log('--- Test 1: Mongoose Schema Partial Unique Index Verification ---');
  const schemaIndexes = FollowUpTask.schema.indexes();
  const partialUniqueIndex = schemaIndexes.find((idx: any) => {
    const keys = idx[0];
    const opts = idx[1];
    return (
      keys.enquiryId === 1 &&
      opts?.unique === true &&
      opts?.partialFilterExpression?.isInitialTask === true
    );
  });

  assert(Boolean(partialUniqueIndex), 'FollowUpTask schema defines unique index on { enquiryId: 1 }');
  const indexOptions = partialUniqueIndex![1] as any;
  assert(indexOptions?.unique === true, 'Index enforces unique: true');
  assert(
    indexOptions?.partialFilterExpression?.isInitialTask === true,
    'Index uses partialFilterExpression: { isInitialTask: true }'
  );
  assert(
    indexOptions?.name === 'unique_initial_task_per_enquiry',
    'Index has explicit name "unique_initial_task_per_enquiry"'
  );

  // =========================================================================
  // TEST 2: Single Initial Task Creation on Lead Creation & Assignment
  // =========================================================================
  console.log('\n--- Test 2: Single Initial Task Creation on createEnquiry ---');
  const createResult = await enquiryService.createEnquiry(
    {
      name: 'Rohan Sharma',
      mobile: '9876543210',
      email: 'rohan.sharma@example.com',
      assignedToId: agentId.toString(),
      preferredContactMethod: 'CALL',
      preferredContactTiming: '11:00 AM'
    },
    adminUser
  );

  assert(createResult.success === true, 'createEnquiry succeeded');
  assert('enquiry' in createResult && Boolean((createResult as any).enquiry), 'createResult contains enquiry');
  const createdEnquiryId = (createResult as any).enquiry._id.toString();

  const createdTasks = taskStore.filter(
    (t) => (t.enquiryId?._id || t.enquiryId).toString() === createdEnquiryId
  );
  assert(createdTasks.length === 1, 'Exactly 1 FollowUpTask created on lead creation');
  assert(createdTasks[0].isInitialTask === true, 'Initial task has isInitialTask: true');
  assert(createdTasks[0].status === 'PENDING', 'Initial task is PENDING');
  assert(
    (createdTasks[0].assignedTo?._id || createdTasks[0].assignedTo).toString() === agentId.toString(),
    'Initial task assigned to assigned Sales Agent'
  );

  // =========================================================================
  // TEST 3: Multiple Manual Tasks on Same Lead Are Allowed & Not Blocked
  // =========================================================================
  console.log('\n--- Test 3: Multiple Manual Tasks Permitted on Same Lead ---');
  // Manual follow-up tasks (e.g. agent logging call, rescheduling, meeting) do NOT have isInitialTask: true
  const manualTask1 = new FollowUpTask({
    enquiryId: new Types.ObjectId(createdEnquiryId),
    assignedTo: agentId,
    purpose: 'CALL',
    followUpDate: new Date(),
    followUpTime: '02:00 PM',
    notes: 'Agent manual call log 1',
    status: 'COMPLETED',
    isInitialTask: false
  });
  await manualTask1.save();

  const manualTask2 = new FollowUpTask({
    enquiryId: new Types.ObjectId(createdEnquiryId),
    assignedTo: agentId,
    purpose: 'SITE_VISIT',
    followUpDate: new Date(Date.now() + 86400000),
    followUpTime: '04:00 PM',
    notes: 'Agent scheduled site visit',
    status: 'PENDING' // isInitialTask defaults to false
  });
  await manualTask2.save();

  const manualTask3 = new FollowUpTask({
    enquiryId: new Types.ObjectId(createdEnquiryId),
    assignedTo: agentId,
    purpose: 'WHATSAPP',
    followUpDate: new Date(Date.now() + 172800000),
    followUpTime: '10:00 AM',
    notes: 'Agent follow up via WhatsApp',
    status: 'PENDING'
  });
  await manualTask3.save();

  const allTasksForLead = taskStore.filter(
    (t) => (t.enquiryId?._id || t.enquiryId).toString() === createdEnquiryId
  );
  assert(allTasksForLead.length === 4, 'Lead has 1 initial task + 3 manual tasks (total 4)');
  const initialCountForLead = allTasksForLead.filter((t) => t.isInitialTask === true).length;
  assert(initialCountForLead === 1, 'Only 1 task marked as isInitialTask: true');

  // =========================================================================
  // TEST 4: Direct Second Initial Task Rejection via Partial Unique Index
  // =========================================================================
  console.log('\n--- Test 4: Database-Level Uniqueness Enforcement (E11000) ---');
  let duplicateKeyErrorCaught = false;
  try {
    const secondInitialTask = new FollowUpTask({
      enquiryId: new Types.ObjectId(createdEnquiryId),
      assignedTo: agentId,
      purpose: 'CALL',
      followUpDate: new Date(),
      followUpTime: '11:00 AM',
      notes: 'Rogue duplicate initial task attempt',
      status: 'PENDING',
      isInitialTask: true
    });
    await secondInitialTask.save();
  } catch (err: any) {
    if (err.code === 11000 && err.name === 'MongoServerError') {
      duplicateKeyErrorCaught = true;
    }
  }
  assert(duplicateKeyErrorCaught, 'Attempting to save a 2nd initial task throws E11000 duplicate key error');

  // Verify taskStore still has only 4 tasks (no duplicate inserted)
  const tasksAfterRejectedSave = taskStore.filter(
    (t) => (t.enquiryId?._id || t.enquiryId).toString() === createdEnquiryId
  );
  assert(tasksAfterRejectedSave.length === 4, 'Task store unchanged after rejected duplicate save');

  // =========================================================================
  // TEST 5: Graceful E11000 Handling on createEnquiry and Reconciliation Races
  // =========================================================================
  console.log('\n--- Test 5: Safe Interception of E11000 on Write-Paths ---');
  // Seed an unassigned lead, then assign it
  const unassignedLead = new Enquiry({
    _id: new Types.ObjectId(),
    name: 'Anita Roy',
    mobile: '9123456780',
    email: 'anita.roy@example.com',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: null
  });
  await unassignedLead.save();

  const assignResult = await enquiryService.assignEnquiry(
    unassignedLead._id.toString(),
    agentId.toString(),
    adminUser
  );
  assert(assignResult.success === true, 'assignEnquiry succeeded');
  const anitaTasks = taskStore.filter(
    (t) => (t.enquiryId?._id || t.enquiryId).toString() === unassignedLead._id.toString()
  );
  assert(anitaTasks.length === 1, 'Anita has exactly 1 initial task created on assignment');
  assert(anitaTasks[0].isInitialTask === true, 'Anita task has isInitialTask: true');

  // =========================================================================
  // TEST 6: Simulated Multi-Instance Concurrent Reconciliation
  // =========================================================================
  console.log('\n--- Test 6: Multi-Instance Concurrent Reconciliation ---');
  // Create 3 active leads without tasks to simulate server startup where tasks were missing
  const leadA = new Enquiry({
    _id: new Types.ObjectId(),
    name: 'Client Alpha',
    mobile: '9000000001',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentId
  });
  const leadB = new Enquiry({
    _id: new Types.ObjectId(),
    name: 'Client Beta',
    mobile: '9000000002',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentId
  });
  const leadC = new Enquiry({
    _id: new Types.ObjectId(),
    name: 'Client Gamma',
    mobile: '9000000003',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentId
  });
  await leadA.save();
  await leadB.save();
  await leadC.save();

  // Create two separate EnquiryService instances to simulate horizontal multi-instance processes
  const instance1 = new EnquiryService();
  const instance2 = new EnquiryService();

  // Trigger reconciliation concurrently on both instances
  // Because they are separate instances, they do NOT share an in-memory initialTasksInProgress mutex!
  // Database-level uniqueness must prevent duplicate task creation!
  const [res1, res2] = await Promise.allSettled([
    instance1.ensureInitialTasksForActiveEnquiries(),
    instance2.ensureInitialTasksForActiveEnquiries()
  ]);

  assert(res1.status === 'fulfilled', 'Instance 1 reconciliation finished cleanly without exception');
  assert(res2.status === 'fulfilled', 'Instance 2 reconciliation finished cleanly without exception');

  const tasksAlpha = taskStore.filter((t) => (t.enquiryId?._id || t.enquiryId).toString() === leadA._id.toString());
  const tasksBeta = taskStore.filter((t) => (t.enquiryId?._id || t.enquiryId).toString() === leadB._id.toString());
  const tasksGamma = taskStore.filter((t) => (t.enquiryId?._id || t.enquiryId).toString() === leadC._id.toString());

  assert(tasksAlpha.length === 1, 'Client Alpha has exactly 1 task created across concurrent instances');
  assert(tasksBeta.length === 1, 'Client Beta has exactly 1 task created across concurrent instances');
  assert(tasksGamma.length === 1, 'Client Gamma has exactly 1 task created across concurrent instances');
  assert(tasksAlpha[0].isInitialTask === true, 'Client Alpha task isInitialTask is true');
  assert(tasksBeta[0].isInitialTask === true, 'Client Beta task isInitialTask is true');
  assert(tasksGamma[0].isInitialTask === true, 'Client Gamma task isInitialTask is true');

  // =========================================================================
  // TEST 7: Pre-Inspection Safety Check Method
  // =========================================================================
  console.log('\n--- Test 7: Pre-Inspection Safety Check ---');
  const safetyClean = await enquiryService.checkInitialTaskSafety();
  assert(safetyClean.safe === true, 'checkInitialTaskSafety returns safe: true when no duplicates exist');
  assert(safetyClean.duplicateCount === 0, 'duplicateCount is 0');
  assert(safetyClean.duplicates.length === 0, 'duplicates array is empty');

  // Now simulate a corrupt duplicate scenario directly in taskStore to verify detector works
  const fakeDuplicateTask = {
    _id: new Types.ObjectId(),
    enquiryId: leadA._id,
    assignedTo: agentId,
    purpose: 'CALL',
    followUpDate: new Date(),
    followUpTime: '10:00 AM',
    notes: 'System initialized pending follow-up task',
    status: 'PENDING',
    isInitialTask: true
  };
  taskStore.push(fakeDuplicateTask);

  const safetyDirty = await enquiryService.checkInitialTaskSafety();
  assert(safetyDirty.safe === false, 'checkInitialTaskSafety detects duplicate when artificially injected');
  assert(safetyDirty.duplicateCount === 1, 'duplicateCount is 1');
  assert(safetyDirty.duplicates[0].enquiryId === leadA._id.toString(), 'Detected duplicate points to leadA');
  assert(safetyDirty.duplicates[0].count === 2, 'Detected duplicate has count 2');

  // Remove the injected fake duplicate
  taskStore.pop();
  const safetyRestored = await enquiryService.checkInitialTaskSafety();
  assert(safetyRestored.safe === true, 'checkInitialTaskSafety returns safe: true after cleanup');

  // =========================================================================
  // TEST 8: Repeated Reconciliation Idempotency (10 Consecutive Invocations)
  // =========================================================================
  console.log('\n--- Test 8: Repeated Reconciliation Idempotency (10 Calls) ---');
  const countBefore = taskStore.length;

  for (let i = 0; i < 10; i++) {
    await enquiryService.ensureInitialTasksForActiveEnquiries();
  }

  const countAfter = taskStore.length;
  assert(
    countAfter === countBefore,
    `10 consecutive ensureInitialTasks calls produced 0 new tasks (Before: ${countBefore}, After: ${countAfter})`
  );

  // =========================================================================
  // TEST 9: Existing Data Preservation and Ownership
  // =========================================================================
  console.log('\n--- Test 9: Existing Task Preservation & Ownership Integrity ---');
  for (const t of taskStore) {
    assert(Boolean(t.enquiryId), `Task ${t._id} maintains enquiryId`);
    assert(Boolean(t.assignedTo), `Task ${t._id} maintains assignedTo`);
    assert(Boolean(t.status), `Task ${t._id} maintains status`);
    assert(Boolean(t.purpose), `Task ${t._id} maintains purpose`);
  }

  // =========================================================================
  // TEST 10: Granular Error Handling & Index-Specific Validation
  // =========================================================================
  console.log('\n--- Test 10: Granular Error Handling & Index Specificity ---');

  // 10.1 isInitialTaskDuplicateKeyError unit validation
  const validDupKeyIndex = {
    code: 11000,
    message: "E11000 duplicate key error collection: follow_up_tasks index: unique_initial_task_per_enquiry dup key: { enquiryId: ObjectId('6ae09795ea2b42d91bde2dd0') }"
  };
  assert(isInitialTaskDuplicateKeyError(validDupKeyIndex) === true, '10.1A: Identifies E11000 from expected unique_initial_task_per_enquiry index');

  const validDupKeyPattern = {
    code: 11000,
    keyPattern: { enquiryId: 1 },
    keyValue: { enquiryId: new Types.ObjectId() },
    message: 'E11000 duplicate key error'
  };
  assert(isInitialTaskDuplicateKeyError(validDupKeyPattern) === true, '10.1B: Identifies E11000 with keyPattern { enquiryId: 1 }');

  const unrelatedDupKey = {
    code: 11000,
    keyPattern: { customId: 1 },
    message: "E11000 duplicate key error collection: follow_up_tasks index: custom_idx dup key: { customId: 'C123' }"
  };
  assert(isInitialTaskDuplicateKeyError(unrelatedDupKey) === false, '10.1C: Rejects E11000 from unrelated index');

  const validationError121 = {
    code: 121,
    name: 'MongoServerError',
    message: 'Document failed validation'
  };
  assert(isInitialTaskDuplicateKeyError(validationError121) === false, '10.1D: Rejects schema validation error 121');

  const networkError = {
    name: 'MongoNetworkError',
    message: 'connection 1 to ac-raal0st-shard-00-02 closed: ECONNRESET'
  };
  assert(isInitialTaskDuplicateKeyError(networkError) === false, '10.1E: Rejects network connection error');

  // 10.2 Bulk Write Inspection: Only expected E11000
  console.log('\n--- Test 10.2: Bulk insertMany with only expected E11000 ---');
  let capturedWarnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    capturedWarnings.push(args.map(a => String(a)).join(' '));
  };

  // Create an active lead needing a task
  const leadTest10 = new Enquiry({
    _id: new Types.ObjectId(),
    name: 'Test 10 Lead',
    mobile: '9111111111',
    status: 'ACTIVE',
    isActive: true,
    assignedTo: agentId
  });
  await leadTest10.save();

  // Mock FollowUpTask.insertMany to simulate a pure duplicate-key error on expected index
  const originalInsertMany = (FollowUpTask as any).insertMany;
  (FollowUpTask as any).insertMany = () => {
    const bulkErr: any = new Error('BulkWriteError');
    bulkErr.name = 'MongoBulkWriteError';
    bulkErr.writeErrors = [
      {
        index: 0,
        code: 11000,
        errmsg: "E11000 duplicate key error collection: follow_up_tasks index: unique_initial_task_per_enquiry dup key: { enquiryId: ObjectId('" + leadTest10._id.toString() + "') }"
      }
    ];
    return Promise.reject(bulkErr);
  };

  capturedWarnings = [];
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(capturedWarnings.length === 0, '10.2: Bulk error with ONLY expected E11000 is cleanly handled with 0 warnings');

  // 10.3 Bulk Write Inspection: Mixed E11000 and validation error 121
  console.log('\n--- Test 10.3: Bulk insertMany with mixed E11000 and validation error 121 ---');
  (FollowUpTask as any).insertMany = () => {
    const bulkErr: any = new Error('BulkWriteError');
    bulkErr.name = 'MongoBulkWriteError';
    bulkErr.writeErrors = [
      {
        index: 0,
        code: 11000,
        errmsg: "E11000 duplicate key error collection: follow_up_tasks index: unique_initial_task_per_enquiry dup key: { enquiryId: ObjectId('" + leadTest10._id.toString() + "') }"
      },
      {
        index: 1,
        code: 121,
        errmsg: 'Document failed validation'
      }
    ];
    return Promise.reject(bulkErr);
  };

  capturedWarnings = [];
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(capturedWarnings.length === 1, '10.3A: Mixed bulk error does NOT swallow validation error 121');
  assert(capturedWarnings[0].includes('unexpected write error'), '10.3B: Logs unexpected write error warning');
  assert(capturedWarnings[0].includes('Document failed validation'), '10.3C: Warning details the non-duplicate validation error');

  // 10.4 Bulk Write Inspection: Unrelated duplicate-key error
  console.log('\n--- Test 10.4: Bulk insertMany with unrelated duplicate-key error ---');
  (FollowUpTask as any).insertMany = () => {
    const bulkErr: any = new Error('BulkWriteError');
    bulkErr.name = 'MongoBulkWriteError';
    bulkErr.writeErrors = [
      {
        index: 0,
        code: 11000,
        errmsg: "E11000 duplicate key error collection: follow_up_tasks index: agent_code_1 dup key: { agentCode: 'AC123' }"
      }
    ];
    return Promise.reject(bulkErr);
  };

  capturedWarnings = [];
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(capturedWarnings.length === 1, '10.4A: Unrelated duplicate-key error is NOT swallowed');
  assert(capturedWarnings[0].includes('agent_code_1'), '10.4B: Warning details the unrelated index collision');

  // 10.5 Bulk Write Inspection: Network error
  console.log('\n--- Test 10.5: Bulk insertMany with network/connection error ---');
  (FollowUpTask as any).insertMany = () => {
    const netErr: any = new Error('connection closed: ECONNRESET');
    netErr.name = 'MongoNetworkError';
    return Promise.reject(netErr);
  };

  capturedWarnings = [];
  await enquiryService.ensureInitialTasksForActiveEnquiries();
  assert(capturedWarnings.length === 1, '10.5A: Network error is NOT swallowed');
  assert(capturedWarnings[0].includes('ECONNRESET'), '10.5B: Warning details the network connection error');

  // Restore mocks
  (FollowUpTask as any).insertMany = originalInsertMany;
  console.warn = originalWarn;

  // 10.6 Successful manual task creation
  console.log('\n--- Test 10.6: Successful manual task creation ---');
  const manualTaskA = new FollowUpTask({
    enquiryId: leadTest10._id,
    assignedTo: agentId,
    purpose: 'CALL',
    followUpDate: new Date(),
    followUpTime: '03:00 PM',
    notes: 'Manual Follow-up A: Call completed',
    status: 'COMPLETED',
    isInitialTask: false
  });
  await manualTaskA.save();

  const manualTaskB = new FollowUpTask({
    enquiryId: leadTest10._id,
    assignedTo: agentId,
    purpose: 'MEETING',
    followUpDate: new Date(),
    followUpTime: '05:00 PM',
    notes: 'Manual Follow-up B: In-person discussion',
    status: 'PENDING'
  });
  await manualTaskB.save();

  const tasksForLead10 = taskStore.filter(
    (t) => (t.enquiryId?._id || t.enquiryId).toString() === leadTest10._id.toString()
  );
  assert(tasksForLead10.length === 2, '10.6: Multiple manual follow-up tasks successfully created without error');

  console.log('\n========================================================================');
  console.log(`Phase 1A.2 REC-01 Idempotency Tests: ${passedAssertions}/${totalAssertions} assertions PASSED`);
  console.log('========================================================================\n');
}

runTaskIdempotencyTests().catch((err) => {
  console.error('Fatal error in task idempotency test suite:', err);
  process.exit(1);
});
