import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const notificationRouter = Router();

// Protected: All notification endpoints require authenticated session
notificationRouter.use(requireAuth);

// GET /api/v1/notifications - List notifications (scoped to authenticated user)
notificationRouter.get('/', notificationController.list);

// GET /api/v1/notifications/unread-count - Fast count for badge display
notificationRouter.get('/unread-count', notificationController.getUnreadCount);

// PATCH /api/v1/notifications/read-all - Mark all user notifications as read
notificationRouter.patch('/read-all', notificationController.markAllRead);

// PATCH /api/v1/notifications/:id/read - Mark single notification as read
notificationRouter.patch('/:id/read', notificationController.markRead);

export { notificationRouter };
