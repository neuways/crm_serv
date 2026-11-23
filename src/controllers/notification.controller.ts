import { Request, Response } from 'express';
import { notificationService } from '../services/notification.service.js';
import { AuthUser } from '../types/auth.types.js';

export class NotificationController {
  /**
   * GET /api/v1/notifications
   * Retrieves paginated notifications for authenticated employee.
   */
  async list(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.user as AuthUser;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const unreadOnly = String(req.query.unreadOnly) === 'true';

      const result = await notificationService.getNotifications(actor, { page, limit, unreadOnly });

      if (!result.success) {
        return res.status(result.statusCode || 500).json({
          success: false,
          error: 'NotificationError',
          message: result.message || 'Failed to retrieve notifications'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          notifications: result.notifications,
          unreadCount: result.unreadCount,
          pagination: result.pagination
        }
      });
    } catch (err: any) {
      console.error('[NotificationController] list error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving notifications'
      });
    }
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Retrieves unread count for fast badge indicator updates.
   */
  async getUnreadCount(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.user as AuthUser;
      const result = await notificationService.getUnreadCount(actor);

      return res.status(200).json({
        success: true,
        data: {
          unreadCount: result.unreadCount
        }
      });
    } catch (err: any) {
      console.error('[NotificationController] getUnreadCount error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to retrieve unread notification count'
      });
    }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * Marks a single notification as read.
   */
  async markRead(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.user as AuthUser;
      const { id } = req.params;

      const result = await notificationService.markAsRead(id, actor);

      if (!result.success) {
        return res.status(result.statusCode || 500).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : result.statusCode === 404 ? 'Not Found' : 'BadRequest',
          message: result.message || 'Failed to mark notification as read'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification marked as read',
        data: {
          notification: result.notification
        }
      });
    } catch (err: any) {
      console.error('[NotificationController] markRead error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to mark notification as read'
      });
    }
  }

  /**
   * PATCH /api/v1/notifications/read-all
   * Marks all unread notifications for authenticated user as read.
   */
  async markAllRead(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.user as AuthUser;
      const result = await notificationService.markAllAsRead(actor);

      return res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
        data: {
          markedCount: result.markedCount
        }
      });
    } catch (err: any) {
      console.error('[NotificationController] markAllRead error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to mark all notifications as read'
      });
    }
  }
}

export const notificationController = new NotificationController();
