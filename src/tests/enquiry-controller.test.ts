import { Types } from 'mongoose';
import { EnquiryController } from '../controllers/enquiry.controller.js';
import { EnquiryService } from '../services/enquiry.service.js';
import { IEnquiry } from '../models/enquiry.model.js';
import { CreateEnquiryResult } from '../types/enquiry.types.js';

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

const createMockRequest = (body: any): any => ({
  body
});

const createMockEnquiry = (data: Partial<IEnquiry>): IEnquiry => {
  const id = new Types.ObjectId();
  return {
    _id: id,
    id: id.toString(),
    name: data.name || 'Sample Lead',
    mobile: data.mobile || '9876543210',
    normalizedMobile: data.normalizedMobile || '+919876543210',
    email: data.email,
    normalizedEmail: data.normalizedEmail,
    status: data.status || 'ACTIVE',
    isActive: data.isActive !== undefined ? data.isActive : true,
    assignedTo: data.assignedTo || null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as unknown as IEnquiry;
};

async function runControllerTests() {
  console.log('====================================================');
  console.log('Starting In-Memory EnquiryController Unit Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  };

  // -----------------------------------------------------------------
  // 1. Success Case: New Enquiry Created (HTTP 201)
  // -----------------------------------------------------------------
  console.log('--- Suite 1: Successful Enquiry Creation ---');
  {
    const mockCreatedDoc = createMockEnquiry({
      name: 'Rohan Gupta',
      normalizedMobile: '+919876543210',
      email: 'rohan@example.com'
    });

    const mockService = {
      createEnquiry: async (): Promise<CreateEnquiryResult> => ({
        success: true,
        isDuplicate: false,
        enquiry: mockCreatedDoc
      })
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({
      name: 'Rohan Gupta',
      mobile: '9876543210',
      email: 'rohan@example.com',
      projectName: 'Orchid Heights'
    });
    const res = createMockResponse();

    await controller.create(req, res as any);

    assert(res.statusCode === 201, 'Returns HTTP 201 Created on successful enquiry creation');
    assert(res.body.success === true, 'Response envelope has success: true');
    assert(res.body.message === 'Enquiry created successfully.', 'Response contains success confirmation message');
    assert(res.body.data.enquiry.name === 'Rohan Gupta', 'Response data contains the created enquiry payload');
  }

  // -----------------------------------------------------------------
  // 2. Duplicate Match Case (HTTP 409 Conflict)
  // -----------------------------------------------------------------
  console.log('\n--- Suite 2: Duplicate Enquiry Detection ---');
  {
    const existingDoc = createMockEnquiry({
      name: 'Existing Customer',
      normalizedMobile: '+919876543210'
    });

    const mockService = {
      createEnquiry: async (): Promise<CreateEnquiryResult> => ({
        success: false,
        isDuplicate: true,
        duplicateType: 'MOBILE_MATCH',
        message: 'An active enquiry with this mobile number already exists.',
        matches: { mobileMatch: existingDoc },
        matchedEnquiries: [existingDoc]
      })
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({
      name: 'Duplicate Rohan',
      mobile: '9876543210'
    });
    const res = createMockResponse();

    await controller.create(req, res as any);

    assert(res.statusCode === 409, 'Returns HTTP 409 Conflict on active duplicate');
    assert(res.body.success === false, 'Envelope has success: false');
    assert(res.body.isDuplicate === true, 'Envelope has isDuplicate: true');
    assert(res.body.duplicateType === 'MOBILE_MATCH', 'Specifies duplicateType: MOBILE_MATCH');
    assert(res.body.data.matchedEnquiries.length === 1, 'Preserves matched enquiries in data envelope for UI');
    assert(res.body.data.matches.mobileMatch.id === existingDoc.id, 'Preserves mobileMatch reference in data.matches');
  }

  // -----------------------------------------------------------------
  // 3. Cross-Field Duplicate Match Case (HTTP 409 Conflict)
  // -----------------------------------------------------------------
  console.log('\n--- Suite 3: Cross-Field Duplicate Detection ---');
  {
    const docA = createMockEnquiry({
      name: 'Lead A',
      normalizedMobile: '+919876543210'
    });
    const docB = createMockEnquiry({
      name: 'Lead B',
      email: 'leadb@example.com',
      normalizedEmail: 'leadb@example.com'
    });

    const mockService = {
      createEnquiry: async (): Promise<CreateEnquiryResult> => ({
        success: false,
        isDuplicate: true,
        duplicateType: 'CROSS_FIELD_MATCH',
        message: 'The submitted mobile number matches one active enquiry, and the email matches a different active enquiry. Both matches are returned for explicit resolution.',
        matches: { mobileMatch: docA, emailMatch: docB },
        matchedEnquiries: [docA, docB]
      })
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({
      name: 'Cross Match Lead',
      mobile: '9876543210',
      email: 'leadb@example.com'
    });
    const res = createMockResponse();

    await controller.create(req, res as any);

    assert(res.statusCode === 409, 'Returns HTTP 409 on cross-field collision');
    assert(res.body.duplicateType === 'CROSS_FIELD_MATCH', 'Identifies duplicateType as CROSS_FIELD_MATCH');
    assert(res.body.data.matchedEnquiries.length === 2, 'Returns both distinct matching enquiries without merging');
    assert(res.body.data.matches.mobileMatch.id === docA.id, 'Preserves Lead A as mobile match');
    assert(res.body.data.matches.emailMatch.id === docB.id, 'Preserves Lead B as email match');
  }

  // -----------------------------------------------------------------
  // 4. Invalid Input Cases (HTTP 400 Bad Request)
  // -----------------------------------------------------------------
  console.log('\n--- Suite 4: Invalid Input Validation ---');
  {
    const mockService = {} as unknown as EnquiryService;
    const controller = new EnquiryController(mockService);

    // Missing Name
    const reqNoName = createMockRequest({ mobile: '9876543210' });
    const resNoName = createMockResponse();
    await controller.create(reqNoName, resNoName as any);
    assert(resNoName.statusCode === 400, 'Returns HTTP 400 when name is missing');
    assert(resNoName.body.error === 'Validation Error', 'Error type is Validation Error');
    assert(resNoName.body.message.includes('Enquiry name is required'), 'Identifies missing name requirement');

    // Missing Mobile
    const reqNoMobile = createMockRequest({ name: 'Valid Name' });
    const resNoMobile = createMockResponse();
    await controller.create(reqNoMobile, resNoMobile as any);
    assert(resNoMobile.statusCode === 400, 'Returns HTTP 400 when mobile is missing');
    assert(resNoMobile.body.message.includes('Enquiry mobile number is required'), 'Identifies missing mobile requirement');

    // Invalid Email Format
    const reqBadEmail = createMockRequest({ name: 'Valid Name', mobile: '9876543210', email: 'not-an-email' });
    const resBadEmail = createMockResponse();
    await controller.create(reqBadEmail, resBadEmail as any);
    assert(resBadEmail.statusCode === 400, 'Returns HTTP 400 on invalid email syntax');
    assert(resBadEmail.body.message.includes('Invalid email address format'), 'Identifies email format error');

    // Budget Minimum exceeds Maximum
    const reqBadBudget = createMockRequest({
      name: 'Valid Name',
      mobile: '9876543210',
      budgetMin: 5000000,
      budgetMax: 2000000
    });
    const resBadBudget = createMockResponse();
    await controller.create(reqBadBudget, resBadBudget as any);
    assert(resBadBudget.statusCode === 400, 'Returns HTTP 400 when budgetMin > budgetMax');
    assert(resBadBudget.body.message.includes('Minimum budget cannot exceed maximum budget'), 'Catches budget constraint violation');
  }

  // -----------------------------------------------------------------
  // 5. Unexpected Server / Database Error (HTTP 500 Internal Server Error)
  // -----------------------------------------------------------------
  console.log('\n--- Suite 5: Unexpected Server Error Handling ---');
  {
    const mockService = {
      createEnquiry: async (): Promise<never> => {
        throw new Error('MongoServerSelectionError: connect ECONNREFUSED 10.0.0.1:27017 with sensitive auth db_user:secret_pass');
      }
    } as unknown as EnquiryService;

    const controller = new EnquiryController(mockService);
    const req = createMockRequest({
      name: 'Valid Name',
      mobile: '9876543210'
    });
    const res = createMockResponse();

    await controller.create(req, res as any);

    assert(res.statusCode === 500, 'Returns HTTP 500 on unexpected service exception');
    assert(res.body.success === false, 'Envelope specifies success: false');
    assert(res.body.error === 'Internal Server Error', 'Specifies Internal Server Error');
    assert(
      res.body.message === 'An unexpected error occurred while processing the enquiry.',
      'Sanitized safe message returned to client'
    );
    assert(!JSON.stringify(res.body).includes('secret_pass'), 'Never exposes database credentials in client response');
    assert(!JSON.stringify(res.body).includes('ECONNREFUSED'), 'Never exposes internal stack or driver traces in response');
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runControllerTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
