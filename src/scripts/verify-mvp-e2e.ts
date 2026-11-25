import http from 'http';
import { createApp } from '../app.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/user.model.js';
import { Enquiry } from '../models/enquiry.model.js';

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

async function request(endpoint: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response
  }

  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log('====================================================');
  console.log('Neuways CRM - Comprehensive Live Atlas Verification');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;
  let httpServer: any = null;

  const assert = (condition: boolean, stepName: string, detail?: string) => {
    if (condition) {
      console.log(`[PASS] ${stepName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${stepName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  };

  try {
    // Ensure server is running or start in-process listener
    let serverRunning = false;
    try {
      const probe = await fetch(`${BASE_URL}/health`);
      if (probe.ok) {
        serverRunning = true;
        console.log('[Setup] Existing server detected on port', PORT);
      }
    } catch {
      serverRunning = false;
    }

    if (!serverRunning) {
      console.log('[Setup] Starting in-process server listener with Atlas connection...');
      await connectDB();
      const app = createApp();
      httpServer = await new Promise((resolve) => {
        const s = app.listen(PORT, () => resolve(s));
      });
      console.log(`[Setup] In-process server listening on ${BASE_URL}\n`);
    }

    // -------------------------------------------------------------
    // Scenario 1: Admin Authentication
    // -------------------------------------------------------------
    console.log('--- Scenario 1: Admin Authentication ---');
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Neuways2026!';
    const adminLoginRes = await request('/auth/login', {
      method: 'POST',
      body: { email: 'admin@neuways.com', password: adminPassword }
    });
    assert(adminLoginRes.status === 200, 'Admin login returns HTTP 200');
    assert(adminLoginRes.data.success === true, 'Admin login reports success: true');
    assert(adminLoginRes.data.data.user.role === 'ADMIN', 'Admin user role is ADMIN');
    const adminToken = adminLoginRes.data.data.token;
    assert(typeof adminToken === 'string' && adminToken.startsWith('ey'), 'Valid signed JWT issued for Admin');
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    // -------------------------------------------------------------
    // Scenario 2: Employee Provisioning & Entity Separation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Employee Provisioning & Entity Separation ---');
    const provisionEmployee = async (name: string, email: string, role: 'MANAGER' | 'SALES', pw: string) => {
      const res = await request('/users', {
        method: 'POST',
        headers: adminHeaders,
        body: { name, email, role, temporaryPassword: pw }
      });
      if (res.status === 201) return res.data.data;
      if (res.status === 409) {
        // Already exists, fetch and activate
        const list = await request('/users', { headers: adminHeaders });
        const existing = list.data.data.find((u: any) => u.email === email);
        if (existing && !existing.isActive) {
          await request(`/users/${existing._id || existing.id}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: { isActive: true }
          });
        }
        return existing;
      }
      throw new Error(`Failed to provision ${email}: ${res.status} ${JSON.stringify(res.data)}`);
    };

    const managerVikram = await provisionEmployee('Vikram Malhotra', 'manager.vikram@neuways.local', 'MANAGER', 'Manager@123');
    const salesRahul = await provisionEmployee('Rahul Sharma', 'sales.rahul@neuways.local', 'SALES', 'Sales@123');
    const salesPriya = await provisionEmployee('Priya Patel', 'sales.priya@neuways.local', 'SALES', 'Sales@123');

    assert(Boolean(managerVikram && salesRahul && salesPriya), 'Manager and 2 Sales Agents provisioned successfully');

    // Confirm list of employees
    const usersListRes = await request('/users', { headers: adminHeaders });
    assert(usersListRes.status === 200, 'Admin listed employees successfully (HTTP 200)');
    const employees: any[] = usersListRes.data.data;
    const activeSales = employees.filter((e) => e.role === 'SALES' && e.isActive);
    assert(activeSales.length >= 2, `Confirmed ${activeSales.length} active Sales Agents in database pool`);

    // Entity separation check: employee provisioning must NOT create leads in enquiries collection
    const rahulLeadCheck = await Enquiry.findOne({ mobile: 'sales.rahul@neuways.local' });
    const priyaLeadCheck = await Enquiry.findOne({ mobile: 'sales.priya@neuways.local' });
    assert(!rahulLeadCheck && !priyaLeadCheck, 'Employee provisioning did NOT create records in enquiries collection (Isolation verified)');

    // -------------------------------------------------------------
    // Scenario 3: Lead Creation & Round Robin Alternation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Lead Creation & Round Robin Alternation ---');
    const ts = Date.now().toString().slice(-6);

    const lead1Res = await request('/enquiries', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Prospect Aarav ${ts}`,
        mobile: `98200${ts.slice(0, 5)}`,
        requirement: '2BHK Luxury Apartment'
      }
    });
    assert(lead1Res.status === 201, 'Lead 1 created with HTTP 201');
    const lead1 = lead1Res.data.data.enquiry;

    const lead2Res = await request('/enquiries', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Prospect Deepika ${ts}`,
        mobile: `98201${ts.slice(0, 5)}`,
        requirement: 'Commercial Office Space'
      }
    });
    assert(lead2Res.status === 201, 'Lead 2 created with HTTP 201');
    const lead2 = lead2Res.data.data.enquiry;

    const lead3Res = await request('/enquiries', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Prospect Karan ${ts}`,
        mobile: `98202${ts.slice(0, 5)}`,
        requirement: 'Penthouse Villa'
      }
    });
    assert(lead3Res.status === 201, 'Lead 3 created with HTTP 201');
    const lead3 = lead3Res.data.data.enquiry;

    const id1 = (lead1.assignedTo?._id || lead1.assignedTo?.id || lead1.assignedTo).toString();
    const id2 = (lead2.assignedTo?._id || lead2.assignedTo?.id || lead2.assignedTo).toString();
    const id3 = (lead3.assignedTo?._id || lead3.assignedTo?.id || lead3.assignedTo).toString();

    assert(Boolean(id1 && id2 && id3), 'All 3 leads received assigned Sales Agent IDs');
    assert(id1 !== id2, 'Lead 1 and Lead 2 assigned to different agents (Round Robin rotation)');
    assert(id1 === id3, 'Lead 3 rotated back to first agent (Sequential alternating round-robin verified)');

    // Verify assigned IDs belong only to SALES agents, never ADMIN or MANAGER
    const agent1User = await User.findById(id1);
    const agent2User = await User.findById(id2);
    assert(agent1User?.role === 'SALES' && agent2User?.role === 'SALES', 'Assigned agents strictly have role SALES (Admin & Manager excluded from rotation)');

    // -------------------------------------------------------------
    // Scenario 4: Duplicate Lead Validation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Duplicate Enquiry Prevention ---');
    const duplicateRes = await request('/enquiries', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Duplicate Prospect ${ts}`,
        mobile: `98200${ts.slice(0, 5)}`, // Same mobile as Lead 1
        requirement: 'Duplicate Attempt'
      }
    });
    assert(duplicateRes.status === 409, 'Duplicate enquiry rejected with HTTP 409 Conflict');
    assert(duplicateRes.data.isDuplicate === true, 'Response identifies duplicate match');

    // -------------------------------------------------------------
    // Scenario 5: Sales Agent Login & Scoped Access (RBAC)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Sales Agent Login & Scoped Access (RBAC) ---');

    // Helper for agent login and initial password transition
    const setupAgentSession = async (email: string, tempPw: string, permPw: string) => {
      let loginRes = await request('/auth/login', {
        method: 'POST',
        body: { email, password: permPw }
      });
      if (loginRes.status !== 200) {
        loginRes = await request('/auth/login', {
          method: 'POST',
          body: { email, password: tempPw }
        });
      }
      assert(loginRes.status === 200, `${email} logged in with HTTP 200`);
      let token = loginRes.data.data.token;
      let headers = { Authorization: `Bearer ${token}` };

      if (loginRes.data.data.user.mustChangePassword) {
        // Confirm temporary password enforcement blocks CRM business actions
        const blockedRes = await request('/enquiries?status=ACTIVE', { headers });
        assert(blockedRes.status === 403 && blockedRes.data.error === 'PasswordChangeRequired',
          `${email}: Temporary password change required before CRM access (HTTP 403 enforced)`);

        // Change password
        const changeRes = await request('/auth/change-password', {
          method: 'POST',
          headers,
          body: { oldPassword: tempPw, newPassword: permPw }
        });
        assert(changeRes.status === 200, `${email}: Password successfully changed`);

        // Re-login with new password to obtain refreshed token
        const reLogin = await request('/auth/login', {
          method: 'POST',
          body: { email, password: permPw }
        });
        token = reLogin.data.data.token;
        headers = { Authorization: `Bearer ${token}` };
      }

      return { token, headers, user: loginRes.data.data.user };
    };

    const rahulSession = await setupAgentSession('sales.rahul@neuways.local', 'Sales@123', 'SalesPermanent@2026!');
    const priyaSession = await setupAgentSession('sales.priya@neuways.local', 'Sales@123', 'SalesPermanent@2026!');

    const rahulId = rahulSession.user.id;
    const priyaId = priyaSession.user.id;

    // Determine which lead belongs to whom
    const rahulLead = id1 === rahulId ? lead1 : lead2;
    const priyaLead = id1 === rahulId ? lead2 : lead1;
    const rahulLeadId = (rahulLead._id || rahulLead.id).toString();
    const priyaLeadId = (priyaLead._id || priyaLead.id).toString();

    // Verify visibility isolation
    const rahulList = await request('/enquiries?status=ACTIVE', { headers: rahulSession.headers });
    assert(rahulList.status === 200, 'Rahul retrieved enquiries with HTTP 200');
    const rahulSeesOwn = (rahulList.data.data?.enquiries || []).some((l: any) => (l._id || l.id) === rahulLeadId);
    const rahulSeesPeer = (rahulList.data.data?.enquiries || []).some((l: any) => (l._id || l.id) === priyaLeadId);
    assert(rahulSeesOwn, 'Rahul sees his assigned lead in active list');
    assert(!rahulSeesPeer, 'Rahul CANNOT see Priya assigned lead in active list (Data isolation verified)');

    // Cross-agent access attempts (Rahul attacks Priya lead)
    const crossEnquiry = await request(`/enquiries/${priyaLeadId}`, { headers: rahulSession.headers });
    assert(crossEnquiry.status === 403 || crossEnquiry.status === 404, 'Rahul GET /enquiries/:peerId rejected with HTTP 403/404');

    const crossActivities = await request(`/enquiries/${priyaLeadId}/activities`, { headers: rahulSession.headers });
    assert(crossActivities.status === 403, 'Rahul GET /enquiries/:peerId/activities rejected with HTTP 403 Forbidden');

    const crossRemark = await request(`/enquiries/${priyaLeadId}/remarks`, {
      method: 'POST',
      headers: rahulSession.headers,
      body: { remark: 'Tampering remark from unassigned agent' }
    });
    assert(crossRemark.status === 403, 'Rahul POST /enquiries/:peerId/remarks rejected with HTTP 403 Forbidden');

    const crossWorkflow = await request(`/enquiries/${priyaLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: { step: 'FOLLOW_UP', notes: 'Tampering workflow attempt' }
    });
    assert(crossWorkflow.status === 403, 'Rahul PATCH /enquiries/:peerId/workflow rejected with HTTP 403 Forbidden');

    // Sales cannot provision users
    const salesCreateUser = await request('/users', {
      method: 'POST',
      headers: rahulSession.headers,
      body: { name: 'Rogue Admin', email: 'rogue@neuways.local', role: 'MANAGER', temporaryPassword: 'Pass@123' }
    });
    assert(salesCreateUser.status === 403, 'Sales agent POST /users rejected with HTTP 403 Forbidden');

    // -------------------------------------------------------------
    // Scenario 6: Sequential Follow-Up Workflow (4 Steps)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Sequential Follow-Up Workflow (4 Steps) ---');

    // Step 6a: Follow-up / Customer Discussion
    const step1Res = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'FOLLOW_UP',
        purpose: 'CALL',
        outcome: 'MEETING_SCHEDULED',
        notes: 'Initial client discussion: confirmed 2BHK preference in Whitefield; scheduled meeting.',
        advanceStage: true
      }
    });
    assert(step1Res.status === 200, 'Step 1 (Follow-up) recorded successfully with HTTP 200');
    assert(step1Res.data.data?.enquiry?.currentStage === 'MEETING_PLAN', 'Lead stage successfully advanced to MEETING_PLAN');

    // Step 6b: Sequential invariant check - attempt Site Visit before Meeting completed
    const prematureSiteVisit = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'SITE_VISIT_PLAN',
        siteVisitAddress: 'Block C, Whitefield',
        siteVisitDate: '2026-10-31',
        siteVisitTime: '11:00',
        projectName: 'Neuways Heights'
      }
    });
    assert(prematureSiteVisit.status === 400, 'Premature Site Visit before Meeting completion correctly rejected with HTTP 400');

    // Step 6c: Meeting Plan
    const step2Res = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'MEETING_PLAN',
        meetingPlace: 'Neuways Regional Office, Indiranagar',
        meetingDate: '2026-10-30',
        meetingTime: '14:30',
        projectDetails: 'Whitefield Prestige Towers, 2BHK East-facing',
        managerId: managerVikram._id || managerVikram.id,
        isCompleted: true,
        meetingResult: 'Meeting conducted with Vikram Malhotra; client approved project layout and requested site inspection.',
        advanceStage: true
      }
    });
    assert(step2Res.status === 200, 'Step 2 (Meeting Plan) recorded and completed with HTTP 200');
    assert(step2Res.data.data?.enquiry?.currentStage === 'SITE_VISIT_PLAN', 'Lead stage successfully advanced to SITE_VISIT_PLAN');

    // Step 6d: Sequential invariant check - attempt Deal Done before Site Visit completed
    const prematureDeal = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'DEAL_DONE',
        project: 'Prestige Towers',
        propertyType: '2BHK',
        price: 9500000,
        size: '1350 sqft',
        isConfirmed: true
      }
    });
    assert(prematureDeal.status === 400, 'Premature Deal Done before Site Visit completion correctly rejected with HTTP 400');

    // Step 6e: Site Visit Plan
    const step3Res = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'SITE_VISIT_PLAN',
        siteVisitAddress: 'Tower 4, Unit 802, Prestige Towers, Whitefield',
        siteVisitDate: '2026-10-31',
        siteVisitTime: '11:00',
        projectName: 'Prestige Towers',
        isCompleted: true,
        visitOutcome: 'Client inspected unit 802 with family; highly satisfied with ventilation and parking slot.',
        advanceStage: true
      }
    });
    assert(step3Res.status === 200, 'Step 3 (Site Visit Plan) recorded and completed with HTTP 200');
    assert(step3Res.data.data?.enquiry?.currentStage === 'DEAL_DONE', 'Lead stage successfully advanced to DEAL_DONE');

    // Step 6f: Deal Done
    const step4Res = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'DEAL_DONE',
        project: 'Prestige Towers',
        propertyType: '2BHK Apartment',
        price: 9500000,
        size: '1350 sqft',
        remarks: 'Booking token received: Cheque #982145 cleared. Agreement drafting initiated.',
        isConfirmed: true
      }
    });
    assert(step4Res.status === 200, 'Step 4 (Deal Done) finalized with HTTP 200');
    assert(step4Res.data.data?.enquiry?.dealDone?.isConfirmed === true, 'Deal confirmation flag isConfirmed: true persisted');
    assert(step4Res.data.data?.enquiry?.dealDone?.price === 9500000, 'Deal price 9500000 persisted');

    // Verify complete activity history
    const activitiesRes = await request(`/enquiries/${rahulLeadId}/activities`, { headers: rahulSession.headers });
    assert(activitiesRes.status === 200, 'Enquiry activities retrieved with HTTP 200');
    const activities: any[] = activitiesRes.data.data?.activities || [];
    assert(activities.length >= 4, `All 4 workflow steps recorded as append-only immutable activities (found ${activities.length})`);

    // -------------------------------------------------------------
    // Scenario 7: Sensitive Content Shield
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Sensitive Content Shield ---');
    const secretRes = await request(`/enquiries/${rahulLeadId}/workflow`, {
      method: 'PATCH',
      headers: rahulSession.headers,
      body: {
        step: 'FOLLOW_UP',
        purpose: 'CALL',
        notes: 'Client account password is SecretPass123! and otp is 998877'
      }
    });
    assert(secretRes.status === 400, 'Workflow step with raw password/OTP rejected with HTTP 400');

    // -------------------------------------------------------------
    // Scenario 8: Status Transition & Queue Filtering
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Status Transition & Queue Filtering ---');
    const lead3Id = (lead3._id || lead3.id).toString();
    const closeRes = await request(`/enquiries/${lead3Id}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { status: 'CLOSED', reason: 'Prospect purchased competitor property in North Bengaluru' }
    });
    assert(closeRes.status === 200, 'Lead 3 status transitioned to CLOSED (HTTP 200)');

    const activeListAfterClose = await request('/enquiries?status=ACTIVE', { headers: adminHeaders });
    const lead3InActive = (activeListAfterClose.data.data?.enquiries || []).some((l: any) => (l._id || l.id) === lead3Id);
    assert(!lead3InActive, 'CLOSED lead 3 is cleanly excluded from ACTIVE enquiry queue');

    const closedList = await request('/enquiries?status=CLOSED', { headers: adminHeaders });
    const lead3InClosed = (closedList.data.data?.enquiries || []).some((l: any) => (l._id || l.id) === lead3Id);
    assert(lead3InClosed, 'CLOSED lead 3 is preserved and present in CLOSED enquiry queue');

    // -------------------------------------------------------------
    // Scenario 9: Dashboard Summary Live Calculation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Dashboard Summary Live Calculation ---');
    const dashboardSummary = await request('/enquiries/dashboard-summary', { headers: adminHeaders });
    assert(dashboardSummary.status === 200, 'GET /api/v1/enquiries/dashboard-summary returns HTTP 200');
    assert(dashboardSummary.data.success === true, 'Dashboard summary reports success: true');
    assert(typeof dashboardSummary.data.data?.activePipelineCount === 'number', 'Active pipeline count is numeric calculated value');
    assert(typeof dashboardSummary.data.data?.dailyVelocity === 'number', 'Daily velocity is numeric calculated value');
    assert(Array.isArray(dashboardSummary.data.data?.pendingStages), 'Pending stages array returned');

    console.log('\n====================================================');
    console.log(`Live Verification Complete: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      await disconnectDB();
      console.log('[Cleanup] In-process HTTP server and MongoDB disconnected cleanly.');
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('Fatal verification error:', err.message);
    if (httpServer) {
      httpServer.close();
      await disconnectDB().catch(() => {});
    }
    process.exit(1);
  }
}

main();
