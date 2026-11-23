import { Router } from 'express';
import { securityController } from '../controllers/security.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';

const securityLogsRouter = Router();
const alertsRouter = Router();

// -----------------------------------------------------------------
// Security Logs Endpoints (Restricted to ADMIN only)
// -----------------------------------------------------------------

// GET /api/v1/security-logs - ADMIN only
securityLogsRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  securityController.getSecurityLogs
);

// POST /api/v1/security-logs/cleanup - ADMIN only
securityLogsRouter.post(
  '/cleanup',
  requireAuth,
  requireRole('ADMIN'),
  securityController.triggerCleanup
);

// -----------------------------------------------------------------
// Alerts Endpoints (Restricted to ADMIN only)
// -----------------------------------------------------------------

// GET /api/v1/alerts - ADMIN only
alertsRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  securityController.getAlerts
);

// PATCH /api/v1/alerts/:id/acknowledge - ADMIN only
alertsRouter.patch(
  '/:id/acknowledge',
  requireAuth,
  requireRole('ADMIN'),
  securityController.acknowledgeAlert
);

export { securityLogsRouter, alertsRouter };
