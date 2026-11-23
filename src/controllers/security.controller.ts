import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { securityService, SecurityService } from '../services/security.service.js';
import { sanitizeErrorMessage } from '../config/db.js';
import { AlertStatus } from '../models/alert.model.js';

export class SecurityController {
  constructor(private service: SecurityService = securityService) {}

  /**
   * HTTP GET /api/v1/security-logs
   * Retrieves paginated restricted security logs, sorted newest-first.
   * Restricted to ADMIN employees.
   */
  getSecurityLogs = async (req: Request, res: Response): Promise<Response> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      if (isNaN(page) || page < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Page must be a positive integer'
        });
      }

      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Limit must be a positive integer'
        });
      }

      const result = await this.service.getSecurityLogs(page, limit);
      return res.status(200).json({
        success: true,
        data: {
          logs: result.logs,
          pagination: result.pagination
        }
      });
    } catch (err: unknown) {
      console.error(
        '[SecurityController] Failed to retrieve security logs:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving security logs.'
      });
    }
  };

  /**
   * HTTP GET /api/v1/alerts
   * Retrieves paginated system alerts, sorted newest-first.
   * Restricted to ADMIN employees.
   */
  getAlerts = async (req: Request, res: Response): Promise<Response> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as AlertStatus | undefined;

      if (isNaN(page) || page < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Page must be a positive integer'
        });
      }

      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Limit must be a positive integer'
        });
      }

      if (status && !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid status filter: must be OPEN, ACKNOWLEDGED, or RESOLVED'
        });
      }

      const result = await this.service.getAlerts(page, limit, status);
      return res.status(200).json({
        success: true,
        data: {
          alerts: result.alerts,
          pagination: result.pagination
        }
      });
    } catch (err: unknown) {
      console.error(
        '[SecurityController] Failed to retrieve alerts:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving system alerts.'
      });
    }
  };

  /**
   * HTTP PATCH /api/v1/alerts/:id/acknowledge
   * Transitions an OPEN alert to ACKNOWLEDGED.
   * Restricted to ADMIN employees.
   */
  acknowledgeAlert = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: alertId } = req.params;

      if (!alertId || !Types.ObjectId.isValid(alertId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid alert ID format: must be a valid MongoDB ObjectId'
        });
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.acknowledgeAlert(alertId, req.user);

      if (!result.success) {
        const errorTitle = result.statusCode === 404 ? 'Not Found' : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Alert acknowledged successfully.',
        data: {
          alert: result.alert
        }
      });
    } catch (err: unknown) {
      console.error(
        '[SecurityController] Failed to acknowledge alert:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while acknowledging the alert.'
      });
    }
  };

  /**
   * HTTP POST /api/v1/security-logs/cleanup
   * Triggers retention cleanup on demand for security logs older than 365 days.
   * Restricted to ADMIN employees.
   */
  triggerCleanup = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.runRetentionCleanup();

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Security log retention cleanup failed after bounded retries.',
          data: result
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Security log retention cleanup completed successfully.',
        data: result
      });
    } catch (err: unknown) {
      console.error(
        '[SecurityController] Unexpected error during retention cleanup:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during retention cleanup.'
      });
    }
  };
}

export const securityController = new SecurityController();
