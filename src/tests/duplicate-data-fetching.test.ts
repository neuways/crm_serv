import { Types } from 'mongoose';
import { EnquiryController } from '../controllers/enquiry.controller.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { AuthUser } from '../types/auth.types.js';

interface MockResponse {
  statusCode: number;
  body: any;
  status: (code: number) => MockResponse;
  json: (data: any) => MockResponse;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    }
  };
  return res;
};

const createMockRequest = (query: Record<string, any> = {}, user?: AuthUser): any => ({
  query,
  user
});

async function runDuplicateDataFetchingTests() {
  console.log('====================================================');
  console.log('Starting Duplicate Data Fetching Targeted Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      passed++;
      console.log(`[PASS] ${testName}`);
    } else {
      failed++;
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  };

  const adminUser: AuthUser = {
    id: '650000000000000000000001',
    name: 'Super Admin',
    email: 'admin@neuways.com',
    role: 'ADMIN'
  };

  const managerUser: AuthUser = {
    id: '650000000000000000000002',
    name: 'Sales Manager Amit',
    email: 'manager.amit@neuways.com',
    role: 'MANAGER'
  };

  const salesUser: AuthUser = {
    id: '650000000000000000000003',
    name: 'Sales Rahul',
    email: 'sales.rahul@neuways.com',
    role: 'SALES'
  };

  // -----------------------------------------------------------------
  // Suite 1: Controller Response Envelope Structure
  // -----------------------------------------------------------------
  console.log('--- Suite 1: Controller Response Envelope Structure ---');
  {
    let capturedQuery: any = null;
    let capturedActor: any = null;

    const mockResult = {
      duplicateRecords: [
        {
          id: 'act-101',
          createdAt: new Date(),
          matchReason: 'MOBILE',
          performedByName: 'Admin',
          performedById: '650000000000000000000001',
          reviewStatus: 'PENDING_REVIEW',
          duplicateReference: 'Direct Lead Submission',
          attemptedLead: {
            name: 'Attempted Lead',
            mobile: '9876543210',
            email: 'test@example.com',
            source: 'Website'
          },
          previousEnquiry: {
            id: 'enq-101',
            name: 'Existing Lead',
            mobile: '9876543210',
            status: 'ACTIVE',
            isDealDone: false,
            isRejected: false,
            assignedTo: null,
            createdAt: new Date()
          }
        }
      ],
      totalCount: 1,
      pagination: {
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1
      }
    };

    const mockService = {
      getDuplicateRecords: async (query: any, actor: AuthUser) => {
        capturedQuery = query;
        capturedActor = actor;
        return mockResult;
      },
      getDuplicateCount: async (actor: AuthUser, params: any) => {
        return 1;
      }
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);

    const req = createMockRequest(
      {
        page: '1',
        limit: '15',
        search: 'Attempted',
        matchReason: 'MOBILE',
        includeBulk: 'true',
        source: 'ALL'
      },
      adminUser
    );
    const res = createMockResponse();

    await controller.getDuplicates(req, res as any);

    assert(res.statusCode === 200, 'HTTP 200 returned on successful duplicate query');
    assert(res.body.success === true, 'Response contains success: true');
    assert(typeof res.body.message === 'string', 'Response contains user-friendly confirmation message');
    assert(res.body.data !== undefined, 'CRITICAL: Response contains "data" envelope for frontend consumers');
    assert(Array.isArray(res.body.data.duplicateRecords), 'res.body.data.duplicateRecords is an array');
    assert(res.body.data.duplicateRecords.length === 1, 'res.body.data.duplicateRecords contains expected item');
    assert(res.body.data.totalCount === 1, 'res.body.data.totalCount matches result count');
    assert(res.body.data.pagination?.page === 1, 'res.body.data.pagination is populated');
    assert(Array.isArray(res.body.duplicateRecords), 'Root-level duplicateRecords preserved for backward compatibility');
    assert(res.body.totalCount === 1, 'Root-level totalCount preserved for backward compatibility');

    // Verify query parameters forwarded to service
    assert(capturedQuery.page === 1, 'page parameter correctly parsed as number');
    assert(capturedQuery.limit === 15, 'limit parameter correctly parsed as number');
    assert(capturedQuery.search === 'Attempted', 'search term correctly forwarded');
    assert(capturedQuery.matchReason === 'MOBILE', 'matchReason correctly forwarded');
    assert(capturedQuery.includeBulk === true, 'includeBulk correctly parsed and forwarded as boolean');
    assert(capturedQuery.source === 'ALL', 'source filter correctly forwarded');
    assert(capturedActor.role === 'ADMIN', 'Actor role correctly passed as ADMIN');
  }

  // -----------------------------------------------------------------
  // Suite 2: Empty Database Result (Zero Records Handling)
  // -----------------------------------------------------------------
  console.log('\n--- Suite 2: Empty Database Result Handling ---');
  {
    const emptyResult = {
      duplicateRecords: [],
      totalCount: 0,
      pagination: {
        total: 0,
        page: 1,
        limit: 15,
        totalPages: 1
      }
    };

    const mockService = {
      getDuplicateRecords: async () => emptyResult,
      getDuplicateCount: async () => 0
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({ page: '1', limit: '15' }, adminUser);
    const res = createMockResponse();

    await controller.getDuplicates(req, res as any);

    assert(res.statusCode === 200, 'Empty database returns HTTP 200 (not an error)');
    assert(res.body.success === true, 'Envelope success is true for empty records');
    assert(res.body.data !== undefined, 'Empty result has data property defined');
    assert(Array.isArray(res.body.data.duplicateRecords), 'data.duplicateRecords is empty array');
    assert(res.body.data.duplicateRecords.length === 0, 'data.duplicateRecords has length 0');
    assert(res.body.data.totalCount === 0, 'data.totalCount is 0');

    // Simulate frontend DuplicateDataPage guard:
    // const payload = res.data || (res.duplicateRecords ? res : null);
    // if (res.success && payload) { setRecords(payload.duplicateRecords); setError(null); }
    const frontendPayload = res.body.data || (res.body.duplicateRecords ? res.body : null);
    const frontendSuccess = res.body.success && Boolean(frontendPayload);
    assert(frontendSuccess === true, 'Frontend guard (res.success && payload) passes on empty records');
  }

  // -----------------------------------------------------------------
  // Suite 3: Quick Duplicate Count Endpoint
  // -----------------------------------------------------------------
  console.log('\n--- Suite 3: Quick Duplicate Count Endpoint ---');
  {
    let capturedCountParams: any = null;
    const mockService = {
      getDuplicateRecords: async () => ({ duplicateRecords: [], totalCount: 0, pagination: { total: 0, page: 1, limit: 15, totalPages: 1 } }),
      getDuplicateCount: async (actor: AuthUser, params: any) => {
        capturedCountParams = params;
        return 42;
      }
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({ includeBulk: 'true', source: 'BULK' }, adminUser);
    const res = createMockResponse();

    await controller.getDuplicatesCount(req, res as any);

    assert(res.statusCode === 200, 'Duplicates count returns HTTP 200');
    assert(res.body.success === true, 'Duplicates count success is true');
    assert(res.body.count === 42, 'Duplicates count root count is 42');
    assert(res.body.data !== undefined, 'Duplicates count data wrapper is present');
    assert(res.body.data.totalCount === 42, 'data.totalCount is 42 for client enquiryService compatibility');
    assert(res.body.data.count === 42, 'data.count is 42 for alternative client access');
    assert(capturedCountParams.includeBulk === true, 'includeBulk correctly passed to count service');
    assert(capturedCountParams.source === 'BULK', 'source correctly passed to count service');
  }

  // -----------------------------------------------------------------
  // Suite 4: Authentication & Authorization Safeguards
  // -----------------------------------------------------------------
  console.log('\n--- Suite 4: Authentication & Authorization Safeguards ---');
  {
    const mockService = {
      getDuplicateRecords: async () => ({ duplicateRecords: [], totalCount: 0, pagination: { total: 0, page: 1, limit: 15, totalPages: 1 } }),
      getDuplicateCount: async () => 0
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);

    // Unauthenticated request
    const unauthReq = createMockRequest({}, undefined);
    const unauthRes = createMockResponse();
    await controller.getDuplicates(unauthReq, unauthRes as any);

    assert(unauthRes.statusCode === 401, 'Unauthenticated getDuplicates rejected with HTTP 401');
    assert(unauthRes.body.success === false, 'success is false');
    assert(unauthRes.body.error === 'Unauthorized', 'Error title is Unauthorized');

    const unauthCountRes = createMockResponse();
    await controller.getDuplicatesCount(unauthReq, unauthCountRes as any);
    assert(unauthCountRes.statusCode === 401, 'Unauthenticated getDuplicatesCount rejected with HTTP 401');

    // Scoped request checks for Manager and Sales
    let managerActorSeen: any = null;
    let salesActorSeen: any = null;

    const scopedMockService = {
      getDuplicateRecords: async (query: any, actor: AuthUser) => {
        if (actor.role === 'MANAGER') managerActorSeen = actor;
        if (actor.role === 'SALES') salesActorSeen = actor;
        return { duplicateRecords: [], totalCount: 0, pagination: { total: 0, page: 1, limit: 15, totalPages: 1 } };
      },
      getDuplicateCount: async () => 0
    } as unknown as EnquiryService;

    const scopedController = new EnquiryController(scopedMockService);

    const mgrReq = createMockRequest({}, managerUser);
    const mgrRes = createMockResponse();
    await scopedController.getDuplicates(mgrReq, mgrRes as any);
    assert(managerActorSeen?.role === 'MANAGER', 'Manager actor preserved for team-scoped query');

    const salesReq = createMockRequest({}, salesUser);
    const salesRes = createMockResponse();
    await scopedController.getDuplicates(salesReq, salesRes as any);
    assert(salesActorSeen?.role === 'SALES', 'Sales actor preserved for self-scoped query');
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`Duplicate Data Fetching Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runDuplicateDataFetchingTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
