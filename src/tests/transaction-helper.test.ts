import mongoose, { ClientSession, Types } from "mongoose";
import { supportsTransactions, withOptionalTransaction } from "../config/db.js";
import { enquiryService } from "../services/enquiry.service.js";
import { Enquiry, IEnquiry } from "../models/enquiry.model.js";
import { User, IUser } from "../models/user.model.js";
import { EnquiryActivity } from "../models/enquiry-activity.model.js";

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
  save: (options?: { session?: ClientSession }) => Promise<MockEnquiryDoc>;
  populate: (path: string, select?: string) => Promise<MockEnquiryDoc>;
}

const createMockUser = (data: Partial<IUser>): IUser => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || "Test Employee",
    email: data.email || "employee@Neuways.com",
    role: data.role || "SALES",
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IUser;
};

const createMockEnquiry = (
  data: Partial<MockEnquiryDoc>,
  saveTracker?: { sessions: (ClientSession | undefined)[] },
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
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function (options?: { session?: ClientSession }) {
      if (saveTracker) {
        saveTracker.sessions.push(options?.session);
      }
      this.updatedAt = new Date();
      if (this.status === "ACTIVE") {
        this.isActive = true;
      } else if (this.status === "CLOSED") {
        this.isActive = false;
      }
      return this;
    },
    populate: async function (_path: string, _select?: string) {
      return this;
    },
  };
  return doc;
};

async function runTransactionHelperTests() {
  console.log("====================================================");
  console.log("Starting Phase 3.1: Transaction Helper & Readiness Suite");
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

  // -----------------------------------------------------------------
  // Suite 1: Topology Detection & Session Lifecycle
  // -----------------------------------------------------------------
  console.log("--- Suite 1: Topology Detection & Session Lifecycle ---");

  // 1A: Disconnected connection (readyState !== 1)
  {
    const origReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 0,
      configurable: true,
    });

    let sessionCalled = false;
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => {
      sessionCalled = true;
      return {} as any;
    }) as any;

    try {
      assert(
        supportsTransactions() === false,
        "supportsTransactions returns false when disconnected (readyState: 0)",
      );

      let workReceivedSession: any = "not-called";
      const result = await withOptionalTransaction(async (session) => {
        workReceivedSession = session;
        return "executed";
      });

      assert(
        result === "executed",
        "Work executes successfully in fallback mode",
      );
      assert(
        workReceivedSession === null,
        "Session passed to work is null when disconnected",
      );
      assert(
        sessionCalled === false,
        "mongoose.startSession is NOT called when disconnected",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      mongoose.startSession = origStartSession;
    }
  }

  // 1B: Standalone MongoDB topology (Single)
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: {
        description: { type: "Single" },
      },
    };

    let sessionCalled = false;
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => {
      sessionCalled = true;
      return {} as any;
    }) as any;

    try {
      assert(
        supportsTransactions() === false,
        "supportsTransactions returns false for standalone Single topology",
      );

      let passedSession: any = "unset";
      await withOptionalTransaction(async (session) => {
        passedSession = session;
      });

      assert(
        passedSession === null,
        "Passes null session for standalone Single topology",
      );
      assert(
        sessionCalled === false,
        "Does not start session for standalone topology",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
    }
  }

  // 1C: Supported ReplicaSet topology (ReplicaSetWithPrimary)
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: {
        description: { type: "ReplicaSetWithPrimary" },
      },
    };

    let endSessionCalled: boolean = false;
    let withTxCalled: boolean = false;
    const mockSession = {
      id: "mock-session-123",
      withTransaction: async function (callback: () => Promise<any>) {
        withTxCalled = true;
        return callback();
      },
      endSession: async function () {
        endSessionCalled = true;
      },
    };

    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    try {
      assert(
        supportsTransactions() === true,
        "supportsTransactions returns true for ReplicaSetWithPrimary",
      );

      let sessionPassedToWork: any = null;
      const res = await withOptionalTransaction(async (session) => {
        sessionPassedToWork = session;
        return "success-value";
      });

      assert(res === "success-value", "Returns result of transactional work");
      assert(Boolean(withTxCalled), "Invokes session.withTransaction()");
      assert(
        sessionPassedToWork === mockSession,
        "Passes live session to transactional work callback",
      );
      assert(
        Boolean(endSessionCalled),
        "Always calls session.endSession() in finally block",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
    }
  }

  // 1D: Sharded topology (Sharded)
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: {
        description: { type: "Sharded" },
      },
    };

    let endSessionCalled: boolean = false;
    const mockSession = {
      withTransaction: async (cb: () => Promise<any>) => cb(),
      endSession: async () => {
        endSessionCalled = true;
      },
    };
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    try {
      assert(
        supportsTransactions() === true,
        "supportsTransactions returns true for Sharded topology",
      );
      await withOptionalTransaction(async () => {});
      assert(
        Boolean(endSessionCalled),
        "Ends session cleanly for Sharded topology",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
    }
  }

  // 1E: Error inside transaction rethrows, ends session, and does NOT silently retry non-transactionally
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: {
        description: { type: "ReplicaSetWithPrimary" },
      },
    };

    let endSessionCalled: boolean = false;
    let attempts = 0;
    const mockSession = {
      withTransaction: async function (callback: () => Promise<any>) {
        return callback(); // when callback throws, it throws out
      },
      endSession: async function () {
        endSessionCalled = true;
      },
    };

    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    try {
      await withOptionalTransaction(async (_session) => {
        attempts++;
        throw new Error("Simulated write conflict inside transaction");
      });
      assert(false, "Should have thrown on transactional error");
    } catch (err: any) {
      assert(
        err.message === "Simulated write conflict inside transaction",
        "Propagates original transaction error directly",
      );
      assert(
        Boolean(endSessionCalled),
        "Session is ended even when transaction throws",
      );
      assert(
        attempts === 1,
        "Does NOT silently retry or fall back to non-transactional write",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
    }
  }

  // -----------------------------------------------------------------
  // Suite 2: Session Propagation to Transactional Writes
  // -----------------------------------------------------------------
  console.log("\n--- Suite 2: Session Propagation to Model Writes ---");

  const adminUser = createMockUser({
    name: "Admin Lead",
    email: "admin@Neuways.com",
    role: "ADMIN",
  });
  const salesAgent = createMockUser({
    name: "Sales Rep",
    email: "sales@Neuways.com",
    role: "SALES",
  });

  // Hook User.findById
  const origUserFindById = User.findById;
  User.findById = ((id: any) => ({
    select: () => {
      if (id?.toString() === salesAgent.id) return Promise.resolve(salesAgent);
      if (id?.toString() === adminUser.id) return Promise.resolve(adminUser);
      return Promise.resolve(null);
    },
  })) as any;

  // 2A: assignEnquiry propagates exact session to enquiry.save and activity.save
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: { description: { type: "ReplicaSetWithPrimary" } },
    };

    const testSession = { id: "test-session-assign" } as any;
    const mockSession = {
      withTransaction: async (cb: () => Promise<any>) => cb(),
      endSession: async () => {},
    };

    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    const saveTracker = { sessions: [] as (ClientSession | undefined)[] };
    const enquiryDoc = createMockEnquiry(
      { name: "Assign Lead", status: "ACTIVE" },
      saveTracker,
    );

    const origEnquiryFindById = Enquiry.findById;
    Enquiry.findById = (() => Promise.resolve(enquiryDoc)) as any;

    let activitySaveSession: any = "unset";
    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function (this: any, options?: any) {
      activitySaveSession = options?.session;
      return this;
    };

    try {
      const res = await enquiryService.assignEnquiry(
        enquiryDoc.id,
        salesAgent.id,
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );

      assert(
        res.success === true,
        "assignEnquiry succeeds in transactional mode",
      );
      assert(saveTracker.sessions.length >= 1, "Enquiry save was invoked");
      assert(
        saveTracker.sessions[0] === (mockSession as any),
        "Enquiry.save received active transaction session",
      );
      assert(
        activitySaveSession === (mockSession as any),
        "EnquiryActivity.save received exact same transaction session",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
      Enquiry.findById = origEnquiryFindById;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // 2B: changeStatus propagates exact session to enquiry.save and activity.save
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: { description: { type: "ReplicaSetWithPrimary" } },
    };

    const mockSession = {
      withTransaction: async (cb: () => Promise<any>) => cb(),
      endSession: async () => {},
    };
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    const saveTracker = { sessions: [] as (ClientSession | undefined)[] };
    const enquiryDoc = createMockEnquiry(
      { name: "Status Lead", status: "ACTIVE", assignedTo: salesAgent._id },
      saveTracker,
    );

    const origEnquiryFindById = Enquiry.findById;
    Enquiry.findById = (() => Promise.resolve(enquiryDoc)) as any;

    let activitySaveSession: any = "unset";
    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function (this: any, options?: any) {
      activitySaveSession = options?.session;
      return this;
    };

    try {
      const res = await enquiryService.changeStatus(
        enquiryDoc.id,
        { status: "CLOSED", reason: "Customer completed purchase" },
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );

      assert(
        res.success === true,
        "changeStatus succeeds in transactional mode",
      );
      assert(
        saveTracker.sessions[0] === (mockSession as any),
        "Enquiry.save in changeStatus received transaction session",
      );
      assert(
        activitySaveSession === (mockSession as any),
        "EnquiryActivity.save in changeStatus received exact same transaction session",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
      Enquiry.findById = origEnquiryFindById;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // -----------------------------------------------------------------
  // Suite 3: Transaction Abort & All-or-Nothing Guarantees
  // -----------------------------------------------------------------
  console.log("\n--- Suite 3: Transaction Abort & All-or-Nothing ---");

  // 3A: Activity failure in assignEnquiry causes transaction abort and returns 500
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: { description: { type: "ReplicaSetWithPrimary" } },
    };

    let transactionAborted: boolean = false;
    const mockSession = {
      withTransaction: async (cb: () => Promise<any>) => {
        try {
          return await cb();
        } catch (err) {
          transactionAborted = true;
          throw err;
        }
      },
      endSession: async () => {},
    };
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    const enquiryDoc = createMockEnquiry({
      name: "Failing Assign Lead",
      status: "ACTIVE",
    });
    const origEnquiryFindById = Enquiry.findById;
    Enquiry.findById = (() => Promise.resolve(enquiryDoc)) as any;

    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function () {
      throw new Error("Database failure saving assignment activity");
    };

    try {
      const res = await enquiryService.assignEnquiry(
        enquiryDoc.id,
        salesAgent.id,
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );

      assert(
        res.success === false,
        "assignEnquiry returns success: false on transactional failure",
      );
      if (!res.success) {
        assert(res.statusCode === 500, "Returns HTTP 500 status code");
        assert(
          res.message.includes("Transaction was aborted"),
          "Message explicitly reports transaction was aborted",
        );
      }
      assert(
        Boolean(transactionAborted),
        "withTransaction aborted the transaction",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
      Enquiry.findById = origEnquiryFindById;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // 3B: Multiple duplicate events: all-or-nothing guarantee under transaction
  {
    const origReadyState = mongoose.connection.readyState;
    const origClient = (mongoose.connection as any).client;
    Object.defineProperty(mongoose.connection, "readyState", {
      value: 1,
      configurable: true,
    });
    (mongoose.connection as any).client = {
      topology: { description: { type: "ReplicaSetWithPrimary" } },
    };

    let transactionAborted: boolean = false;
    const mockSession = {
      withTransaction: async (cb: () => Promise<any>) => {
        try {
          return await cb();
        } catch (err) {
          transactionAborted = true;
          throw err;
        }
      },
      endSession: async () => {},
    };
    const origStartSession = mongoose.startSession;
    mongoose.startSession = (async () => mockSession as any) as any;

    const matchLeadA = createMockEnquiry({
      name: "Dup Match A",
      mobile: "9111111111",
      normalizedMobile: "+919111111111",
      status: "ACTIVE",
    });
    const matchLeadB = createMockEnquiry({
      name: "Dup Match B",
      email: "dup.b@example.com",
      normalizedEmail: "dup.b@example.com",
      status: "CLOSED",
      isActive: false,
    });

    const origEnquiryFind = Enquiry.find;
    Enquiry.find = (() => ({
      populate: () => Promise.resolve([matchLeadA, matchLeadB]),
    })) as any;

    const savedInTx: string[] = [];
    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function (this: any) {
      if (this.enquiryId?.toString() === matchLeadB.id) {
        throw new Error("Storage write error on second duplicate event");
      }
      savedInTx.push(this.enquiryId?.toString());
      return this;
    };

    try {
      await enquiryService.createEnquiry(
        {
          name: "New Prospect Cross Match",
          mobile: "9111111111",
          email: "dup.b@example.com",
        },
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );
      assert(
        false,
        "Should have thrown error on aborted duplicate transaction",
      );
    } catch (err: any) {
      assert(
        Boolean(transactionAborted),
        "Transaction was aborted when Lead B activity failed",
      );
      assert(
        err.message.includes("Storage write error on second duplicate event"),
        "Propagates original transaction abort error",
      );
    } finally {
      Object.defineProperty(mongoose.connection, "readyState", {
        value: origReadyState,
        configurable: true,
      });
      (mongoose.connection as any).client = origClient;
      mongoose.startSession = origStartSession;
      Enquiry.find = origEnquiryFind;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // -----------------------------------------------------------------
  // Suite 4: Fallback Compensating Rollback Verification
  // -----------------------------------------------------------------
  console.log(
    "\n--- Suite 4: Non-Transactional Fallback & Compensating Rollback ---",
  );

  // 4A: assignEnquiry in fallback mode reverts assignedTo when activity write fails
  {
    const prevAssigneeId = new Types.ObjectId();
    const fallbackEnquiry = createMockEnquiry({
      name: "Fallback Assign Lead",
      status: "ACTIVE",
      assignedTo: prevAssigneeId,
    });

    const origEnquiryFindById = Enquiry.findById;
    Enquiry.findById = (() => Promise.resolve(fallbackEnquiry)) as any;

    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function () {
      throw new Error("Fallback activity write failed");
    };

    try {
      const res = await enquiryService.assignEnquiry(
        fallbackEnquiry.id,
        salesAgent.id,
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );

      assert(
        res.success === false,
        "Fallback returns success: false when activity write fails",
      );
      if (!res.success) {
        assert(res.statusCode === 500, "Fallback returns HTTP 500 status code");
        assert(
          res.message.includes("Assignment was rolled back"),
          "Message explicitly reports assignment was rolled back",
        );
      }
      assert(
        fallbackEnquiry.assignedTo?.toString() === prevAssigneeId.toString(),
        "Compensating rollback successfully restored assignedTo to previous assignee",
      );
    } finally {
      Enquiry.findById = origEnquiryFindById;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // 4B: changeStatus in fallback mode reverts status when activity write fails
  {
    const fallbackStatusEnquiry = createMockEnquiry({
      name: "Fallback Status Lead",
      status: "ACTIVE",
      assignedTo: salesAgent._id,
    });

    const origEnquiryFindById = Enquiry.findById;
    Enquiry.findById = (() => Promise.resolve(fallbackStatusEnquiry)) as any;

    const origActivitySave = EnquiryActivity.prototype.save;
    EnquiryActivity.prototype.save = async function () {
      throw new Error("Fallback status activity write failed");
    };

    try {
      const res = await enquiryService.changeStatus(
        fallbackStatusEnquiry.id,
        { status: "CLOSED", reason: "Closing reason" },
        {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        },
      );

      assert(
        res.success === false,
        "Fallback returns success: false on status activity failure",
      );
      if (!res.success) {
        assert(res.statusCode === 500, "Fallback returns HTTP 500 status code");
        assert(
          res.message.includes("Status change was rolled back"),
          "Message explicitly reports status change was rolled back",
        );
      }
      assert(
        fallbackStatusEnquiry.status === "ACTIVE",
        "Compensating rollback restored status to ACTIVE",
      );
      assert(
        fallbackStatusEnquiry.isActive === true,
        "Compensating rollback restored isActive to true",
      );
    } finally {
      Enquiry.findById = origEnquiryFindById;
      EnquiryActivity.prototype.save = origActivitySave;
    }
  }

  // Restore User.findById
  User.findById = origUserFindById;

  console.log("\n====================================================");
  console.log(
    `Phase 3.1 Test Suite Finished: ${passed} passed, ${failed} failed`,
  );
  console.log("====================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTransactionHelperTests().catch((err) => {
  console.error("Unhandled transaction test error:", err);
  process.exit(1);
});
