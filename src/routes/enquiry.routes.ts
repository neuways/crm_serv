import { Router } from 'express';
import { enquiryController } from '../controllers/enquiry.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';

const enquiryRouter = Router();

// GET /api/v1/enquiries - Protected: Retrieve paginated enquiries (scoped by role)
enquiryRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.list
);

// GET /api/v1/enquiries/dashboard-summary - Protected: Retrieve aggregated KPI & stage data for dashboard
enquiryRouter.get(
  '/dashboard-summary',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getDashboardSummary
);

// GET /api/v1/enquiries/completed-deals - Protected: Retrieve finalized property deals (scoped by role)
enquiryRouter.get(
  '/completed-deals',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.listCompletedDeals
);

// GET /api/v1/enquiries/duplicates - Protected: Retrieve role-scoped duplicate records (excluding bulk upload)
enquiryRouter.get(
  '/duplicates',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getDuplicates
);

// GET /api/v1/enquiries/duplicates/count - Protected: Retrieve quick total duplicate count for role
enquiryRouter.get(
  '/duplicates/count',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getDuplicatesCount
);

// GET /api/v1/enquiries/managers - Protected: Retrieve active manager accounts for meeting/site visit plans
enquiryRouter.get(
  '/managers',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getManagers
);

// GET /api/v1/enquiries/team - Protected: Retrieve team performance metrics (ADMIN, MANAGER & personal metrics for SALES)
enquiryRouter.get(
  '/team',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getTeam
);

// GET /api/v1/enquiries/team-activity-report - Protected: Retrieve employee daily work & call accountability metrics
enquiryRouter.get(
  '/team-activity-report',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getTeamActivityReport
);

// GET /api/v1/enquiries/activity-feed - Protected: Retrieve role-scoped cross-lead chronological activity stream
enquiryRouter.get(
  '/activity-feed',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getActivityFeed
);

// POST /api/v1/enquiries/work-report/submit - Protected: Submit daily work report upward (Sales -> Manager + Admin, Manager -> Admin)
enquiryRouter.post(
  '/work-report/submit',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.submitWorkReport
);

// GET /api/v1/enquiries/team/roster - Protected: Retrieve all sales agents with team membership status (ADMIN & MANAGER)
enquiryRouter.get(
  '/team/roster',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  enquiryController.getTeamRoster
);

// POST /api/v1/enquiries/team/assign - Protected: Assign available sales agent to manager's team (ADMIN & MANAGER)
enquiryRouter.post(
  '/team/assign',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  enquiryController.assignAgentToTeam
);

// PATCH /api/v1/enquiries/team/members/:agentId/status - Protected: Activate/deactivate team membership (ADMIN & MANAGER)
enquiryRouter.patch(
  '/team/members/:agentId/status',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  enquiryController.updateTeamMemberStatus
);

// POST /api/v1/enquiries - Protected: Only authenticated ADMIN, MANAGER, or SALES employees can create enquiries
enquiryRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.create
);

// POST /api/v1/enquiries/bulk-assign - Protected: Batch assign enquiries (ADMIN & MANAGER)
enquiryRouter.post(
  '/bulk-assign',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  enquiryController.bulkAssign
);

// PATCH /api/v1/enquiries/:id/assign - Protected: Only authenticated ADMIN or MANAGER can assign/reassign enquiries
enquiryRouter.patch(
  '/:id/assign',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  enquiryController.assign
);

// POST /api/v1/enquiries/:id/remarks - Protected: Authenticated ADMIN, MANAGER, or SALES employees can add remarks
enquiryRouter.post(
  '/:id/remarks',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.addRemark
);

// PATCH /api/v1/enquiries/:id/status - Protected: Authenticated ADMIN, MANAGER (any enquiry), SALES (assigned enquiry only)
enquiryRouter.patch(
  '/:id/status',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.changeStatus
);

// PATCH /api/v1/enquiries/:id/reject - Protected: Authenticated ADMIN, MANAGER, or assigned SALES
enquiryRouter.patch(
  '/:id/reject',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.rejectLead
);

// REQ-36: PATCH /api/v1/enquiries/:id/deal-lost - Protected: Authenticated ADMIN, MANAGER, or assigned SALES
enquiryRouter.patch(
  '/:id/deal-lost',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.markDealLost
);

// GET /api/v1/enquiries/:id/activities - Protected: Authenticated ADMIN, MANAGER, or SALES employees can view activity history
enquiryRouter.get(
  '/:id/activities',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getActivities
);

// POST /api/v1/enquiries/:id/follow-ups - Protected: Authenticated employees can record follow-ups
enquiryRouter.post(
  '/:id/follow-ups',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.createFollowUp
);

// POST /api/v1/enquiries/:id/quick-activity - Protected: 1-click call/interaction outcome logging
enquiryRouter.post(
  '/:id/quick-activity',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.logQuickActivity
);

// GET /api/v1/enquiries/:id/follow-ups - Protected: Authenticated employees can view follow-ups
enquiryRouter.get(
  '/:id/follow-ups',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getFollowUps
);

// PATCH /api/v1/enquiries/:id/follow-ups/:taskId/status - Protected: Authenticated employees can update task status
enquiryRouter.patch(
  '/:id/follow-ups/:taskId/status',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.updateTaskStatus
);

// GET /api/v1/enquiries/:id - Protected: Retrieve single enquiry details (scoped by role)
enquiryRouter.get(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getById
);

// PATCH /api/v1/enquiries/:id/workflow - Protected: Record sequential workflow step
enquiryRouter.patch(
  '/:id/workflow',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.saveWorkflowStep
);

// PATCH /api/v1/enquiries/:id/meeting/cancel - Protected: Cancel scheduled meeting plan
enquiryRouter.patch(
  '/:id/meeting/cancel',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.cancelMeetingPlan
);

// PATCH /api/v1/enquiries/:id/site-visit/cancel - Protected: Cancel scheduled site visit plan
enquiryRouter.patch(
  '/:id/site-visit/cancel',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.cancelSiteVisitPlan
);


// PATCH /api/v1/enquiries/:id/qualification - Protected: Record lead qualification scoring
enquiryRouter.patch(
  '/:id/qualification',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.qualifyLead
);

// PATCH /api/v1/enquiries/:id/do-not-contact/enable - Protected: Enable Do Not Contact restriction
enquiryRouter.patch(
  '/:id/do-not-contact/enable',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.enableDoNotContact
);

// PATCH /api/v1/enquiries/:id/do-not-contact/revoke - Protected: Revoke Do Not Contact restriction (MANAGER & ADMIN only)
enquiryRouter.patch(
  '/:id/do-not-contact/revoke',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.revokeDoNotContact
);

// GET /api/v1/enquiries/:id/do-not-contact - Protected: Get Do Not Contact status and history
enquiryRouter.get(
  '/:id/do-not-contact',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  enquiryController.getDoNotContactStatus
);

// DELETE /api/v1/enquiries/:id - Protected: Authenticated ADMIN can delete lead (restricted to ADMIN, 403 for others)
enquiryRouter.delete(
  '/:id',
  requireAuth,
  enquiryController.deleteEnquiry
);

export { enquiryRouter };
