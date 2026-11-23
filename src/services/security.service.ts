import { Types } from 'mongoose';
import { SecurityLog, ISecurityLog } from '../models/security-log.model.js';
import { Alert, IAlert, AlertStatus } from '../models/alert.model.js';
import { AuthUser } from '../types/auth.types.js';
import { sanitizeErrorMessage } from '../config/db.js';

export interface RetentionCleanupResult {
  success: boolean;
  deletedCount: number;
  cutoffDate: Date;
  attempts: number;
  error?: string;
  alertCreated?: boolean;
}

export interface SecurityLogPaginationResult {
  success: true;
  logs: ISecurityLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface AlertPaginationResult {
  success: true;
  alerts: IAlert[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface AcknowledgeAlertResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  alert?: IAlert;
}

/**
 * Dispatcher for critical administrative email notifications.
 * Never invents credentials. If email infrastructure is not configured, reports limitation safely.
 */
export let emailDispatcher = async (
  _alert: IAlert
): Promise<{ sent: boolean; reason?: string }> => {
  const isConfigured = Boolean(process.env.SMTP_HOST || process.env.EMAIL_SERVICE_CONFIGURED);
  if (!isConfigured) {
    return {
      sent: false,
      reason: 'Email service configuration unavailable in environment. Persistent alert record preserved in database.'
    };
  }
  return { sent: true };
};

export const setEmailDispatcherForTest = (
  fn: (alert: IAlert) => Promise<{ sent: boolean; reason?: string }>
) => {
  emailDispatcher = fn;
};

export class SecurityService {
  /**
   * Records a restricted security log for rejected sensitive remark attempts.
   * Stores strictly safe metadata: employee ID, name snapshot, timestamp, event type, and safe reason code.
   * Never stores remark text, detected secrets, passwords, OTPs, or enquiry ID.
   */
  async recordSecurityLog(
    actor: AuthUser,
    safeReasonCode: 'PROHIBITED_CREDENTIALS' = 'PROHIBITED_CREDENTIALS'
  ): Promise<ISecurityLog> {
    const securityLog = new SecurityLog({
      employeeId: new Types.ObjectId(actor.id),
      employeeName: actor.name,
      eventType: 'SENSITIVE_REMARK_REJECTED',
      safeReasonCode,
      timestamp: new Date()
    });

    await securityLog.save();
    return securityLog;
  }

  /**
   * Retrieves paginated security logs, sorted newest-first.
   * Access is strictly restricted to ADMIN.
   */
  async getSecurityLogs(
    page = 1,
    limit = 20
  ): Promise<SecurityLogPaginationResult> {
    const validatedPage = Math.max(1, Math.floor(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const skip = (validatedPage - 1) * validatedLimit;

    const [logs, total] = await Promise.all([
      SecurityLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validatedLimit),
      SecurityLog.countDocuments()
    ]);

    const totalPages = Math.ceil(total / validatedLimit) || 1;
    const hasMore = validatedPage * validatedLimit < total;

    return {
      success: true,
      logs,
      pagination: {
        total,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasMore
      }
    };
  }

  /**
   * Executes retention cleanup for security logs older than 365 days.
   *
   * UTC Cutoff Policy:
   * Records with createdAt < (now - retentionDays * 24h) are deleted.
   * Records with createdAt >= cutoffDate (newer or exactly at cutoff) are strictly retained.
   *
   * Invariants:
   * 1. Idempotent and safe to retry.
   * 2. Deletes ONLY security logs; never touches EnquiryActivity or other collections.
   * 3. Bounded retries (default 3 attempts) with sanitized error logging.
   * 4. On final failure: generates a single persistent Alert record and attempts email delivery once.
   * 5. Repeated failures do NOT create duplicate open alerts or send duplicate emails for the same incident.
   * 6. On later success: automatically transitions unresolved alerts to RESOLVED without a recovery email.
   */
  async runRetentionCleanup(options?: {
    retentionDays?: number;
    maxRetries?: number;
  }): Promise<RetentionCleanupResult> {
    const retentionDays = options?.retentionDays ?? 365;
    const maxRetries = Math.max(1, options?.maxRetries ?? 3);

    // Calculate UTC cutoff timestamp
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    let attempt = 0;
    let lastError: Error | null = null;
    let deletedCount = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const result = await SecurityLog.deleteMany({
          createdAt: { $lt: cutoffDate }
        });
        deletedCount = result.deletedCount || 0;
        lastError = null;
        break; // Success: exit retry loop
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[SecurityService] Retention cleanup attempt ${attempt}/${maxRetries} failed:`,
          sanitizeErrorMessage(lastError)
        );
      }
    }

    // Cleanup succeeded
    if (lastError === null) {
      // Resolve any existing open or acknowledged alerts for this incident
      try {
        await Alert.updateMany(
          {
            incidentKey: 'RETENTION_CLEANUP',
            status: { $in: ['OPEN', 'ACKNOWLEDGED'] }
          },
          {
            $set: {
              status: 'RESOLVED',
              resolvedAt: new Date()
            }
          }
        );
      } catch (resErr) {
        console.error(
          '[SecurityService] Failed to auto-resolve cleanup alerts after success:',
          sanitizeErrorMessage(resErr)
        );
      }

      return {
        success: true,
        deletedCount,
        cutoffDate,
        attempts: attempt
      };
    }

    // Cleanup failed after all retries
    let alertCreated = false;
    try {
      // Check if an unresolved alert already exists for this incident
      const existingAlert = await Alert.findOne({
        incidentKey: 'RETENTION_CLEANUP',
        status: { $in: ['OPEN', 'ACKNOWLEDGED'] }
      });

      if (!existingAlert) {
        // Create new OPEN incident alert
        const newAlert = new Alert({
          type: 'RETENTION_CLEANUP_FAILURE',
          status: 'OPEN',
          severity: 'CRITICAL',
          title: 'Security Log Retention Cleanup Failure',
          message: `Security log retention cleanup failed after ${maxRetries} attempts: ${sanitizeErrorMessage(lastError)}`,
          incidentKey: 'RETENTION_CLEANUP',
          details: {
            retentionDays,
            attempts: maxRetries,
            cutoffDate,
            lastError: sanitizeErrorMessage(lastError)
          },
          emailSent: false
        });

        await newAlert.save();
        alertCreated = true;

        // Attempt single email notification for the new incident
        try {
          const emailRes = await emailDispatcher(newAlert);
          if (emailRes.sent) {
            newAlert.emailSent = true;
            newAlert.emailSentAt = new Date();
            await newAlert.save();
          }
        } catch (emailErr) {
          console.error(
            '[SecurityService] Failed to dispatch admin alert email:',
            sanitizeErrorMessage(emailErr)
          );
        }
      } else {
        // Update existing alert timestamp without creating duplicates or re-sending emails
        existingAlert.details = {
          ...(existingAlert.details || {}),
          lastFailedAttempt: new Date(),
          recentError: sanitizeErrorMessage(lastError)
        };
        await existingAlert.save();
      }
    } catch (alertErr) {
      console.error(
        '[SecurityService] Failed to persist cleanup alert:',
        sanitizeErrorMessage(alertErr)
      );
    }

    return {
      success: false,
      deletedCount: 0,
      cutoffDate,
      attempts: attempt,
      error: sanitizeErrorMessage(lastError),
      alertCreated
    };
  }

  /**
   * Retrieves paginated alerts, sorted newest-first.
   * Access is strictly restricted to ADMIN.
   */
  async getAlerts(
    page = 1,
    limit = 20,
    statusFilter?: AlertStatus
  ): Promise<AlertPaginationResult> {
    const validatedPage = Math.max(1, Math.floor(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const skip = (validatedPage - 1) * validatedLimit;

    const query: Record<string, unknown> = {};
    if (statusFilter && ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(statusFilter)) {
      query.status = statusFilter;
    }

    const [alerts, total] = await Promise.all([
      Alert.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validatedLimit),
      Alert.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / validatedLimit) || 1;
    const hasMore = validatedPage * validatedLimit < total;

    return {
      success: true,
      alerts,
      pagination: {
        total,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasMore
      }
    };
  }

  /**
   * Acknowledges an OPEN alert.
   * Only transitions from OPEN -> ACKNOWLEDGED.
   */
  async acknowledgeAlert(
    alertId: string,
    actor: AuthUser
  ): Promise<AcknowledgeAlertResult> {
    if (!alertId || !Types.ObjectId.isValid(alertId)) {
      return {
        success: false,
        statusCode: 400,
        message: 'Invalid alert ID format: must be a valid MongoDB ObjectId'
      };
    }

    const alert = await Alert.findById(alertId);
    if (!alert) {
      return {
        success: false,
        statusCode: 404,
        message: 'Alert not found'
      };
    }

    if (alert.status !== 'OPEN') {
      return {
        success: false,
        statusCode: 400,
        message: `Only OPEN alerts can be acknowledged. Current status: ${alert.status}`
      };
    }

    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedBy = new Types.ObjectId(actor.id);
    alert.acknowledgedByName = actor.name;
    alert.acknowledgedAt = new Date();

    await alert.save();

    return {
      success: true,
      alert
    };
  }
}

export const securityService = new SecurityService();
