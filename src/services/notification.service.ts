import mongoose, { Types } from 'mongoose';
import { Notification, INotification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import {
  CreateNotificationInput,
  GetNotificationsQuery,
  GetNotificationsResult,
  UnreadCountResult,
  MarkReadResult,
  MarkAllReadResult,
  NotificationResponseItem
} from '../types/notification.types.js';
import { AuthUser } from '../types/auth.types.js';

function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }
  return String(err).slice(0, 500);
}

export type CrmEventType =
  | 'LEAD_REASSIGNED'
  | 'STATUS_CHANGED'
  | 'STAGE_ADVANCED'
  | 'LEAD_QUALIFIED'
  | 'REMARK_ADDED'
  | 'FOLLOW_UP_CREATED'
  | 'MEETING_SCHEDULED'
  | 'MEETING_CANCELLED'
  | 'SITE_VISIT_SCHEDULED'
  | 'SITE_VISIT_CANCELLED'
  | 'DEAL_DONE'
  | 'LEAD_REJECTED'
  | 'DEAL_LOST'
  | 'UNASSIGNED_LEAD'
  | 'RE_ENQUIRY';

export interface CrmNotificationEvent {
  eventType: CrmEventType;
  actor: {
    id: string;
    name: string;
    role: string;
  };
  enquiry: {
    _id: any;
    name?: string;
    projectName?: string;
    currentStage?: string;
    assignedTo?: any;
    updatedAt?: Date | string;
    __v?: number;
    [key: string]: any;
  };
  payload?: Record<string, any>;
}

export class NotificationService {
  /**
   * Transforms an INotification document into a standardized client response item.
   */
  private toResponseItem(doc: INotification | any): NotificationResponseItem {
    return {
      id: doc._id ? doc._id.toString() : doc.id,
      recipient: doc.recipient ? doc.recipient.toString() : '',
      sender: doc.sender ? doc.sender.toString() : null,
      senderName: doc.senderName || 'System',
      type: doc.type,
      title: doc.title,
      message: doc.message,
      relatedEnquiryId: doc.relatedEnquiryId ? doc.relatedEnquiryId.toString() : null,
      relatedCustomerName: doc.relatedCustomerName || null,
      relatedStage: doc.relatedStage || null,
      link: doc.link || null,
      isRead: Boolean(doc.isRead),
      readAt: doc.readAt || null,
      metadata: doc.metadata || {},
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  /**
   * Persists an in-app notification with strict idempotency and deduplication safeguards.
   * If an idempotencyKey is supplied and already exists, returns the existing record without creating a duplicate.
   */
  async createNotification(input: CreateNotificationInput): Promise<INotification | null> {
    try {
      if (!input.recipient) {
        return null;
      }

      // If disconnected and not running in an in-memory test harness with mocked model, skip to avoid buffering timeout
      const isConnected = mongoose.connection.readyState === 1 && Boolean((mongoose.connection as any).db);
      const isMocked = Boolean((Notification as any)._isMocked);
      if (!isConnected && !isMocked) {
        return null;
      }

      const recipientId = typeof input.recipient === 'string'
        ? new Types.ObjectId(input.recipient)
        : input.recipient;

      // Deduplication check via idempotency key
      if (input.idempotencyKey && input.idempotencyKey.trim()) {
        const key = input.idempotencyKey.trim();
        const existing = await Notification.findOne({ idempotencyKey: key });
        if (existing) {
          return existing;
        }
      }

      const senderId = input.sender
        ? (typeof input.sender === 'string' ? new Types.ObjectId(input.sender) : input.sender)
        : null;

      const enquiryId = input.relatedEnquiryId
        ? (typeof input.relatedEnquiryId === 'string' ? new Types.ObjectId(input.relatedEnquiryId) : input.relatedEnquiryId)
        : null;

      const notification = new Notification({
        recipient: recipientId,
        sender: senderId,
        senderName: input.senderName?.trim() || 'System',
        type: input.type,
        title: input.title.trim(),
        message: input.message.trim(),
        relatedEnquiryId: enquiryId,
        relatedCustomerName: input.relatedCustomerName?.trim() || null,
        relatedStage: input.relatedStage?.trim() || null,
        link: input.link?.trim() || null,
        isRead: false,
        idempotencyKey: input.idempotencyKey?.trim() || null,
        metadata: input.metadata || {}
      });

      return await notification.save();
    } catch (err: any) {
      // E11000 duplicate key race check for idempotencyKey
      if (err?.code === 11000 || err?.message?.includes('E11000')) {
        if (input.idempotencyKey) {
          const existing = await Notification.findOne({ idempotencyKey: input.idempotencyKey.trim() });
          if (existing) return existing;
        }
      }
      console.error('[NotificationService] Failed to create notification:', err?.message || err);
      return null;
    }
  }

  /**
   * Retrieves paginated notifications with strict role-based isolation:
   * - Sales Agents access strictly their own notifications.
   * - Managers access their own notifications.
   * - Admins access their notifications (or organization notifications if filtered).
   */
  async getNotifications(actor: AuthUser, query: GetNotificationsQuery = {}): Promise<GetNotificationsResult> {
    try {
      const page = Math.max(1, Math.floor(query.page || 1));
      const limit = Math.min(100, Math.max(1, Math.floor(query.limit || 20)));
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {
        recipient: new Types.ObjectId(actor.id)
      };

      if (query.unreadOnly === true || query.unreadOnly === 'true') {
        filter.isRead = false;
      }

      const [docs, total, unreadCount] = await Promise.all([
        Notification.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Notification.countDocuments(filter),
        Notification.countDocuments({ recipient: new Types.ObjectId(actor.id), isRead: false })
      ]);

      const totalPages = Math.ceil(total / limit) || 1;

      return {
        success: true,
        notifications: docs.map((d) => this.toResponseItem(d)),
        unreadCount,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasMore: page < totalPages
        }
      };
    } catch (err: any) {
      console.error('[NotificationService] getNotifications error:', err?.message || err);
      return {
        success: false,
        statusCode: 500,
        message: 'Failed to retrieve notifications',
        notifications: [],
        unreadCount: 0,
        pagination: { total: 0, page: 1, limit: 20, totalPages: 1, hasMore: false }
      };
    }
  }

  /**
   * Retrieves unread count for badge indicators without loading list payload.
   */
  async getUnreadCount(actor: AuthUser): Promise<UnreadCountResult> {
    try {
      const count = await Notification.countDocuments({
        recipient: new Types.ObjectId(actor.id),
        isRead: false
      });
      return {
        success: true,
        unreadCount: count
      };
    } catch (err: any) {
      console.error('[NotificationService] getUnreadCount error:', err?.message || err);
      return {
        success: false,
        unreadCount: 0
      };
    }
  }

  /**
   * Marks a single notification as read, enforcing ownership.
   */
  async markAsRead(notificationId: string, actor: AuthUser): Promise<MarkReadResult> {
    try {
      if (!notificationId || !Types.ObjectId.isValid(notificationId)) {
        return {
          success: false,
          statusCode: 400,
          message: 'Invalid notification ID format'
        };
      }

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        return {
          success: false,
          statusCode: 404,
          message: 'Notification not found'
        };
      }

      // Role authorization: Only recipient (or ADMIN) can mark as read
      if (actor.role !== 'ADMIN' && notification.recipient.toString() !== actor.id) {
        return {
          success: false,
          statusCode: 403,
          message: 'Access denied: You cannot modify notifications belonging to another employee'
        };
      }

      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();

      return {
        success: true,
        notification: this.toResponseItem(notification)
      };
    } catch (err: any) {
      console.error('[NotificationService] markAsRead error:', err?.message || err);
      return {
        success: false,
        statusCode: 500,
        message: 'Failed to mark notification as read'
      };
    }
  }

  /**
   * Marks all notifications for the authenticated user as read.
   */
  async markAllAsRead(actor: AuthUser): Promise<MarkAllReadResult> {
    try {
      const result = await Notification.updateMany(
        {
          recipient: new Types.ObjectId(actor.id),
          isRead: false
        },
        {
          $set: {
            isRead: true,
            readAt: new Date()
          }
        }
      );

      return {
        success: true,
        markedCount: result.modifiedCount || 0
      };
    } catch (err: any) {
      console.error('[NotificationService] markAllAsRead error:', err?.message || err);
      return {
        success: false,
        statusCode: 500,
        message: 'Failed to mark all notifications as read',
        markedCount: 0
      };
    }
  }

  /**
   * Helper to retrieve active Admin IDs, safely working in both MongoDB Atlas and mocked test environments.
   */
  async getActiveAdminIds(excludeUserId?: string): Promise<string[]> {
    try {
      if (mongoose.connection.readyState === 1 || (User as any)._isMocked) {
        const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id');
        const ids = (admins || [])
          .map((a: any) => (a._id ? a._id.toString() : a.id ? a.id.toString() : ''))
          .filter((id: string) => Boolean(id) && (!excludeUserId || id !== excludeUserId));
        return ids;
      }
    } catch (err: any) {
      console.error('[NotificationService] Error fetching active admin IDs:', sanitizeErrorMessage(err));
    }
    return [];
  }

  /**
   * Centralized global CRM event dispatcher for all approved CRM lifecycle events.
   * Isolates notification dispatch so that notification failures never abort or roll back core CRM transactions.
   */
  async dispatchCrmEvent(event: CrmNotificationEvent): Promise<void> {
    try {
      const { eventType, actor, enquiry, payload = {} } = event;
      if (!enquiry || !enquiry._id) return;

      const enquiryId = enquiry._id.toString();
      const customerName = enquiry.name || payload.customerName || 'Lead';
      const projectName = enquiry.projectName || payload.projectName || 'General';
      const stage = enquiry.currentStage || payload.currentStage || 'FOLLOW_UP';

      switch (eventType) {
        case 'LEAD_REASSIGNED': {
          const {
            isReassignment,
            isSameAgent,
            assigneeId,
            assigneeName,
            assigneeRole,
            previousAssigneeName,
            assignmentVersion = (enquiry as any).__v ?? (enquiry.updatedAt ? new Date(enquiry.updatedAt).getTime() : 0),
            metadata = {}
          } = payload;

          const notificationsToDispatch: CreateNotificationInput[] = [];

          // 1. Assignee notification (Strict Rule: ONLY Sales Agents receive lead assignment notifications, not if same agent)
          if (assigneeRole === 'SALES' && !isSameAgent && assigneeId) {
            const notifType = isReassignment ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED';
            const notifTitle = isReassignment ? `Lead Reassigned: ${customerName}` : `Lead Assigned: ${customerName}`;
            const notifMsg = isReassignment
              ? `Lead "${customerName}" has been reassigned to you${previousAssigneeName ? ` from ${previousAssigneeName}` : ''}.`
              : `Lead "${customerName}" has been assigned to you.`;

            notificationsToDispatch.push({
              recipient: assigneeId,
              sender: actor?.id || null,
              senderName: actor?.name || 'Management',
              type: notifType,
              title: notifTitle,
              message: notifMsg,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: stage,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `lead_assigned_${enquiryId}_${assigneeId}_${assignmentVersion}`,
              metadata
            });
          }

          // 2. Manager reassignment -> All active Admins receive LEAD_REASSIGNED
          if (isReassignment && !isSameAgent && actor?.role === 'MANAGER') {
            const activeAdminIds = await this.getActiveAdminIds();
            for (const admId of activeAdminIds) {
              notificationsToDispatch.push({
                recipient: admId,
                sender: actor.id,
                senderName: actor.name,
                type: 'LEAD_REASSIGNED',
                title: `Lead Reassigned: ${customerName}`,
                message: `Manager ${actor.name} reassigned lead "${customerName}" to ${assigneeName || 'Agent'}${previousAssigneeName ? ` from ${previousAssigneeName}` : ''}.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: stage,
                link: `/sales/leads/${enquiryId}/workflow`,
                idempotencyKey: `lead_reassigned_admin_${enquiryId}_${admId}_${assignmentVersion}`,
                metadata: {
                  ...metadata,
                  eventType: 'LEAD_REASSIGNED',
                  actorName: actor.name,
                  actorRole: actor.role,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }

          await Promise.allSettled(notificationsToDispatch.map((n) => this.createNotification(n)));
          break;
        }

        case 'STATUS_CHANGED': {
          const {
            currentStatus,
            newStatus,
            reason,
            statusVersion = (enquiry as any).__v ?? (enquiry.updatedAt ? new Date(enquiry.updatedAt).getTime() : Date.now())
          } = payload;

          const reasonStr = reason ? ` Reason: ${reason}` : '';
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);

          const promises = activeAdminIds.map((admId) =>
            this.createNotification({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'WORKFLOW_UPDATE',
              title: `Lead Status Updated: ${customerName}`,
              message: `${actor.name} (${actor.role}) updated "${customerName}" status from ${currentStatus} to ${newStatus}.${reasonStr}`,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || newStatus,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `lead_status_${enquiryId}_${admId}_${currentStatus}_to_${newStatus}_${statusVersion}`,
              metadata: {
                leadId: enquiryId,
                customerName,
                projectName: enquiry.projectName || 'N/A',
                eventType: 'STATUS_CHANGED',
                previousStatus: currentStatus,
                newStatus,
                actorName: actor.name,
                actorRole: actor.role,
                reason: reason || undefined,
                timestamp: new Date().toISOString()
              }
            })
          );

          await Promise.allSettled(promises);
          break;
        }

        case 'STAGE_ADVANCED': {
          const stageVersion = (enquiry as any).__v ?? (enquiry.updatedAt ? new Date(enquiry.updatedAt).getTime() : 0);
          const projectName = enquiry.projectName?.trim() || 'N/A';
          const schedulerRoleLabel =
            actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

          const title = 'Stage Advanced';
          const message = `Lead "${customerName}" advanced to stage ${enquiry.currentStage}. Performed by ${actor.name} (${schedulerRoleLabel}). Property: ${projectName}.`;

          const stageMeta = {
            leadId: enquiryId,
            customerName,
            projectName,
            eventType: 'STAGE_ADVANCED',
            currentStage: enquiry.currentStage,
            stage: enquiry.currentStage,
            actorName: actor.name,
            actorRole: schedulerRoleLabel,
            timestamp: new Date().toISOString()
          };

          const notifications: CreateNotificationInput[] = [];

          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'WORKFLOW_UPDATE',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || null,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `advance_${enquiryId}_${enquiry.assignedTo.toString()}_${enquiry.currentStage}_${stageVersion}`,
              metadata: stageMeta
            });
          }

          // Responsible Manager (if exists, active, and not already recipient or actor)
          let assignedUser: any = null;
          if (enquiry.assignedTo) {
            const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
            assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
          }
          let teamMgrIdStr: string | null = null;
          if (assignedUser?.managerId) {
            teamMgrIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
          } else if (enquiry.managerId) {
            teamMgrIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
          }
          if (teamMgrIdStr && teamMgrIdStr !== enquiry.assignedTo?.toString() && teamMgrIdStr !== actor.id) {
            const teamMgr = await User.findById(teamMgrIdStr).select('_id role isActive');
            if (teamMgr && teamMgr.role === 'MANAGER' && teamMgr.isActive) {
              notifications.push({
                recipient: teamMgr._id.toString(),
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title,
                message,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: enquiry.currentStage || null,
                link: `/sales/leads/${enquiryId}/workflow`,
                idempotencyKey: `advance_mgr_${enquiryId}_${teamMgr._id.toString()}_${enquiry.currentStage}_${stageVersion}`,
                metadata: stageMeta
              });
            }
          }

          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
          for (const admId of activeAdminIds) {
            notifications.push({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'WORKFLOW_UPDATE',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || null,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `advance_admin_${enquiryId}_${admId}_${enquiry.currentStage}_${stageVersion}`,
              metadata: stageMeta
            });
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'LEAD_QUALIFIED': {
          const { calculatedScore, priority, scoreLabel, notes } = payload;
          const qualifyVersion = (enquiry as any).__v ?? (enquiry.updatedAt ? new Date(enquiry.updatedAt).getTime() : 0);
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);

          const promises = activeAdminIds.map((admId) =>
            this.createNotification({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'WORKFLOW_UPDATE',
              title: `Lead Qualified: ${customerName}`,
              message: `${actor.name} (${actor.role}) qualified lead "${customerName}" (Score: ${calculatedScore}/100, Priority: ${priority}).`,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || 'QUALIFIED',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `qualify_admin_${enquiryId}_${admId}_${qualifyVersion}`,
              metadata: {
                leadId: enquiryId,
                customerName,
                projectName: enquiry.projectName || 'N/A',
                eventType: 'LEAD_QUALIFIED',
                calculatedScore,
                scoreLabel,
                priority,
                actorName: actor.name,
                actorRole: actor.role,
                notes: notes || undefined,
                timestamp: new Date().toISOString()
              }
            })
          );

          await Promise.allSettled(promises);
          break;
        }

        case 'REMARK_ADDED': {
          const { snippet, activityId } = payload;
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);

          const promises = activeAdminIds.map((admId) =>
            this.createNotification({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'NEW_ACTIVITY',
              title: `Remark Added: ${customerName}`,
              message: `${actor.name} (${actor.role}) added a remark on lead "${customerName}": "${snippet}"`,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || null,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `remark_admin_${enquiryId}_${admId}_${activityId}`,
              metadata: {
                leadId: enquiryId,
                customerName,
                projectName: enquiry.projectName || 'N/A',
                eventType: 'REMARK_ADDED',
                remarkSummary: snippet,
                actorName: actor.name,
                actorRole: actor.role,
                timestamp: new Date().toISOString()
              }
            })
          );

          await Promise.allSettled(promises);
          break;
        }

        case 'FOLLOW_UP_CREATED': {
          const { purpose, followUpDate, followUpTime, nextFollowUpDate, nextFollowUpTime, outcome, followUpId } = payload;
          const targetDate = nextFollowUpDate || followUpDate;
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);

          const promises = activeAdminIds.map((admId) =>
            this.createNotification({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'NEW_FOLLOW_UP',
              title: `New Follow-up Scheduled: ${customerName}`,
              message: `${actor.name} (${actor.role}) scheduled a follow-up for "${customerName}" (${purpose}) on ${targetDate}.`,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: enquiry.currentStage || null,
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `followup_admin_${enquiryId}_${admId}_${followUpId}`,
              metadata: {
                leadId: enquiryId,
                customerName,
                projectName: enquiry.projectName || 'N/A',
                eventType: 'NEW_FOLLOW_UP',
                purpose,
                followUpDate,
                followUpTime,
                nextFollowUpDate,
                nextFollowUpTime,
                outcome,
                actorName: actor.name,
                actorRole: actor.role,
                timestamp: new Date().toISOString()
              }
            })
          );

          await Promise.allSettled(promises);
          break;
        }

        case 'MEETING_SCHEDULED': {
          const { date = '', time = '', meetingMgrId, project } = payload;
          const projectName = project || enquiry.projectName?.trim() || 'N/A';
          const displayDate = formatFollowUpDate(date) || date;
          const displayTime = formatFollowUpTime(time) || time;
          const schedulerRoleLabel =
            actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

          const title = 'Meeting Scheduled';
          const message = `A meeting has been scheduled with ${customerName} on ${displayDate} at ${displayTime}. Scheduled by ${actor.name} (${schedulerRoleLabel}). Property: ${projectName}.`;

          const meetingMeta = {
            leadId: enquiryId,
            customerName,
            projectName,
            eventType: 'MEETING_SCHEDULED',
            meetingDate: date,
            meetingTime: time,
            displayMeetingDate: displayDate,
            displayMeetingTime: displayTime,
            scheduledBy: actor.name,
            scheduledByRole: schedulerRoleLabel,
            stage: 'MEETING_PLAN',
            timestamp: new Date().toISOString()
          };

          const notifications: CreateNotificationInput[] = [];

          // 1. Assigned Sales Agent
          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_${enquiryId}_${enquiry.assignedTo.toString()}_${date}_${time}`,
              metadata: meetingMeta
            });
          }

          // 2. Meeting Manager (if specified and different) OR responsible team Manager
          let managerIdToNotify: string | null = null;
          if (meetingMgrId) {
            const mMgr = await User.findById(meetingMgrId).select('_id role isActive');
            if (mMgr && mMgr.isActive) {
              managerIdToNotify = mMgr._id.toString();
            }
          }
          if (!managerIdToNotify) {
            let assignedUser: any = null;
            if (enquiry.assignedTo) {
              const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
              assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
            }
            let teamMgrIdStr: string | null = null;
            if (assignedUser?.managerId) {
              teamMgrIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
            } else if (enquiry.managerId) {
              teamMgrIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
            }
            if (teamMgrIdStr) {
              const teamMgr = await User.findById(teamMgrIdStr).select('_id role isActive');
              if (teamMgr && teamMgr.role === 'MANAGER' && teamMgr.isActive) {
                managerIdToNotify = teamMgr._id.toString();
              }
            }
          }

          if (managerIdToNotify && managerIdToNotify !== enquiry.assignedTo?.toString()) {
            notifications.push({
              recipient: managerIdToNotify,
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_mgr_${enquiryId}_${managerIdToNotify}_${date}_${time}`,
              metadata: meetingMeta
            });
          }

          // 3. Active Admins
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
          for (const admId of activeAdminIds) {
            notifications.push({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_admin_${enquiryId}_${admId}_${date}_${time}`,
              metadata: meetingMeta
            });
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'SITE_VISIT_SCHEDULED': {
          const { date = '', time = '', proj, visitMgrId } = payload;
          const projectName = proj || enquiry.projectName?.trim() || 'Site';
          const displayDate = formatFollowUpDate(date) || date;
          const displayTime = formatFollowUpTime(time) || time;
          const schedulerRoleLabel =
            actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

          const title = 'Site Visit Scheduled';
          const message = `A site visit has been scheduled for ${customerName} at ${projectName} on ${displayDate} at ${displayTime}. Scheduled by ${actor.name} (${schedulerRoleLabel}).`;

          const visitMeta = {
            leadId: enquiryId,
            customerName,
            projectName,
            eventType: 'SITE_VISIT_SCHEDULED',
            siteVisitDate: date,
            siteVisitTime: time,
            displaySiteVisitDate: displayDate,
            displaySiteVisitTime: displayTime,
            scheduledBy: actor.name,
            scheduledByRole: schedulerRoleLabel,
            stage: 'SITE_VISIT_PLAN',
            timestamp: new Date().toISOString()
          };

          const notifications: CreateNotificationInput[] = [];

          // 1. Assigned Sales Agent
          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_${enquiryId}_${enquiry.assignedTo.toString()}_${date}_${time}`,
              metadata: visitMeta
            });
          }

          // 2. Site Visit Manager (if specified and different) OR responsible team Manager
          let managerIdToNotify: string | null = null;
          if (visitMgrId) {
            const vMgr = await User.findById(visitMgrId).select('_id role isActive');
            if (vMgr && vMgr.isActive) {
              managerIdToNotify = vMgr._id.toString();
            }
          }
          if (!managerIdToNotify) {
            let assignedUser: any = null;
            if (enquiry.assignedTo) {
              const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
              assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
            }
            let teamMgrIdStr: string | null = null;
            if (assignedUser?.managerId) {
              teamMgrIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
            } else if (enquiry.managerId) {
              teamMgrIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
            }
            if (teamMgrIdStr) {
              const teamMgr = await User.findById(teamMgrIdStr).select('_id role isActive');
              if (teamMgr && teamMgr.role === 'MANAGER' && teamMgr.isActive) {
                managerIdToNotify = teamMgr._id.toString();
              }
            }
          }

          if (managerIdToNotify && managerIdToNotify !== enquiry.assignedTo?.toString()) {
            notifications.push({
              recipient: managerIdToNotify,
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_mgr_${enquiryId}_${managerIdToNotify}_${date}_${time}`,
              metadata: visitMeta
            });
          }

          // 3. Active Admins
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
          for (const admId of activeAdminIds) {
            notifications.push({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_SCHEDULED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_admin_${enquiryId}_${admId}_${date}_${time}`,
              metadata: visitMeta
            });
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'MEETING_CANCELLED': {
          const { date = '', time = '', meetingMgrId, project, cancellationReason = 'Not specified' } = payload;
          const projectName = project || enquiry.projectName?.trim() || 'N/A';
          const displayDate = formatFollowUpDate(date) || date;
          const displayTime = formatFollowUpTime(time) || time;
          const cancellerRoleLabel =
            actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

          const title = 'Meeting Cancelled';
          const scheduleText = displayDate ? ` on ${displayDate}${displayTime ? ` at ${displayTime}` : ''}` : '';
          const message = `The meeting scheduled with ${customerName}${scheduleText} has been cancelled by ${actor.name} (${cancellerRoleLabel}). Reason: ${cancellationReason}`;

          const cancelledVersion = Date.now();
          const cancelMeta = {
            leadId: enquiryId,
            customerName,
            projectName,
            eventType: 'MEETING_CANCELLED',
            meetingDate: date,
            meetingTime: time,
            displayMeetingDate: displayDate,
            displayMeetingTime: displayTime,
            cancellationReason,
            cancelledBy: actor.name,
            cancelledByRole: cancellerRoleLabel,
            stage: 'MEETING_PLAN',
            timestamp: new Date().toISOString()
          };

          const notifications: CreateNotificationInput[] = [];

          // 1. Assigned Sales Agent
          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_cancel_${enquiryId}_${enquiry.assignedTo.toString()}_${date}_${time}_${cancelledVersion}`,
              metadata: cancelMeta
            });
          }

          // 2. Meeting Manager (if specified and different) OR responsible team Manager
          let managerIdToNotify: string | null = null;
          if (meetingMgrId) {
            const mMgr = await User.findById(meetingMgrId).select('_id role isActive');
            if (mMgr && mMgr.isActive) {
              managerIdToNotify = mMgr._id.toString();
            }
          }
          if (!managerIdToNotify) {
            let assignedUser: any = null;
            if (enquiry.assignedTo) {
              const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
              assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
            }
            let teamMgrIdStr: string | null = null;
            if (assignedUser?.managerId) {
              teamMgrIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
            } else if (enquiry.managerId) {
              teamMgrIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
            }
            if (teamMgrIdStr) {
              const teamMgr = await User.findById(teamMgrIdStr).select('_id role isActive');
              if (teamMgr && teamMgr.role === 'MANAGER' && teamMgr.isActive) {
                managerIdToNotify = teamMgr._id.toString();
              }
            }
          }

          if (managerIdToNotify && managerIdToNotify !== enquiry.assignedTo?.toString()) {
            notifications.push({
              recipient: managerIdToNotify,
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_cancel_mgr_${enquiryId}_${managerIdToNotify}_${date}_${time}_${cancelledVersion}`,
              metadata: cancelMeta
            });
          }

          // 3. Active Admins
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
          for (const admId of activeAdminIds) {
            notifications.push({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'MEETING_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'MEETING_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `meeting_cancel_admin_${enquiryId}_${admId}_${date}_${time}_${cancelledVersion}`,
              metadata: cancelMeta
            });
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'SITE_VISIT_CANCELLED': {
          const { date = '', time = '', proj, visitMgrId, cancellationReason = 'Not specified' } = payload;
          const projectName = proj || enquiry.projectName?.trim() || 'Site';
          const displayDate = formatFollowUpDate(date) || date;
          const displayTime = formatFollowUpTime(time) || time;
          const cancellerRoleLabel =
            actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

          const title = 'Site Visit Cancelled';
          const scheduleText = displayDate ? ` on ${displayDate}${displayTime ? ` at ${displayTime}` : ''}` : '';
          const message = `The site visit scheduled for ${customerName} at ${projectName}${scheduleText} has been cancelled by ${actor.name} (${cancellerRoleLabel}). Reason: ${cancellationReason}`;

          const cancelledVersion = Date.now();
          const visitCancelMeta = {
            leadId: enquiryId,
            customerName,
            projectName,
            eventType: 'SITE_VISIT_CANCELLED',
            siteVisitDate: date,
            siteVisitTime: time,
            displaySiteVisitDate: displayDate,
            displaySiteVisitTime: displayTime,
            cancellationReason,
            cancelledBy: actor.name,
            cancelledByRole: cancellerRoleLabel,
            stage: 'SITE_VISIT_PLAN',
            timestamp: new Date().toISOString()
          };

          const notifications: CreateNotificationInput[] = [];

          // 1. Assigned Sales Agent
          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_cancel_${enquiryId}_${enquiry.assignedTo.toString()}_${date}_${time}_${cancelledVersion}`,
              metadata: visitCancelMeta
            });
          }

          // 2. Site Visit Manager (if specified and different) OR responsible team Manager
          let managerIdToNotify: string | null = null;
          if (visitMgrId) {
            const vMgr = await User.findById(visitMgrId).select('_id role isActive');
            if (vMgr && vMgr.isActive) {
              managerIdToNotify = vMgr._id.toString();
            }
          }
          if (!managerIdToNotify) {
            let assignedUser: any = null;
            if (enquiry.assignedTo) {
              const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
              assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
            }
            let teamMgrIdStr: string | null = null;
            if (assignedUser?.managerId) {
              teamMgrIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
            } else if (enquiry.managerId) {
              teamMgrIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
            }
            if (teamMgrIdStr) {
              const teamMgr = await User.findById(teamMgrIdStr).select('_id role isActive');
              if (teamMgr && teamMgr.role === 'MANAGER' && teamMgr.isActive) {
                managerIdToNotify = teamMgr._id.toString();
              }
            }
          }

          if (managerIdToNotify && managerIdToNotify !== enquiry.assignedTo?.toString()) {
            notifications.push({
              recipient: managerIdToNotify,
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_cancel_mgr_${enquiryId}_${managerIdToNotify}_${date}_${time}_${cancelledVersion}`,
              metadata: visitCancelMeta
            });
          }

          // 3. Active Admins
          const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
          for (const admId of activeAdminIds) {
            notifications.push({
              recipient: admId,
              sender: actor.id,
              senderName: actor.name,
              type: 'SITE_VISIT_CANCELLED',
              title,
              message,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'SITE_VISIT_PLAN',
              link: `/sales/leads/${enquiryId}/workflow`,
              idempotencyKey: `sitevisit_cancel_admin_${enquiryId}_${admId}_${date}_${time}_${cancelledVersion}`,
              metadata: visitCancelMeta
            });
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'DEAL_DONE': {
          const { project = (enquiry.projectName || 'Site') } = payload;
          const notifications: CreateNotificationInput[] = [];

          if (enquiry.assignedTo) {
            notifications.push({
              recipient: enquiry.assignedTo.toString(),
              sender: actor.id,
              senderName: actor.name,
              type: 'WORKFLOW_UPDATE',
              title: `Deal Done Confirmed: ${customerName}`,
              message: `Deal closed successfully for "${customerName}" at ${project}!`,
              relatedEnquiryId: enquiryId,
              relatedCustomerName: customerName,
              relatedStage: 'DEAL_DONE',
              link: `/sales/completed-deals/${enquiryId}`,
              idempotencyKey: `deal_done_${enquiryId}`
            });
          }

          if (mongoose.connection.readyState === 1 || (User as any)._isMocked) {
            const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
            for (const admId of activeAdminIds) {
              notifications.push({
                recipient: admId,
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Company Deal Closed: ${customerName}`,
                message: `Deal closed successfully for "${customerName}" at ${project}!`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'DEAL_DONE',
                link: `/sales/completed-deals/${enquiryId}`,
                idempotencyKey: `deal_done_admin_${enquiryId}_${admId}`
              });
            }

            let managerId = payload.managerId;
            let assignedUserName = payload.assignedUserName;
            if (!managerId && enquiry.assignedTo) {
              const assignedUser = await User.findById(enquiry.assignedTo).select('_id name managerId isActive');
              if (assignedUser?.managerId) {
                managerId = assignedUser.managerId.toString();
              }
              if (assignedUser?.name) {
                assignedUserName = assignedUser.name;
              }
            }

            if (managerId && managerId.toString() !== actor.id) {
              notifications.push({
                recipient: managerId.toString(),
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Team Deal Closed: ${customerName}`,
                message: `Team member ${assignedUserName || 'Sales Agent'} closed deal for "${customerName}" at ${project}!`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'DEAL_DONE',
                link: `/manager/completed-deals`,
                idempotencyKey: `deal_done_mgr_${enquiryId}_${managerId.toString()}`
              });
            }
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'LEAD_REJECTED': {
          const { reason } = payload;
          const notifications: CreateNotificationInput[] = [];

          if (mongoose.connection.readyState === 1 || (User as any)._isMocked) {
            const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
            for (const admId of activeAdminIds) {
              notifications.push({
                recipient: admId,
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Lead Rejected: ${customerName}`,
                message: `Lead "${customerName}" was marked rejected/lost. Reason: ${reason}.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'CLOSED',
                link: `/leads`,
                idempotencyKey: `lead_rejected_${enquiryId}_${admId}`
              });
            }

            let managerId = payload.managerId;
            let assignedUserName = payload.assignedUserName;
            if (!managerId && enquiry.assignedTo) {
              const assignedUser = await User.findById(enquiry.assignedTo).select('_id name managerId isActive');
              if (assignedUser?.managerId) {
                managerId = assignedUser.managerId.toString();
              }
              if (assignedUser?.name) {
                assignedUserName = assignedUser.name;
              }
            }

            if (managerId && managerId.toString() !== actor.id) {
              notifications.push({
                recipient: managerId.toString(),
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Team Lead Rejected: ${customerName}`,
                message: `Team lead "${customerName}" (assigned to ${assignedUserName || 'Sales Agent'}) was marked rejected/lost. Reason: ${reason}.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'CLOSED',
                link: `/manager/rejected-deals`,
                idempotencyKey: `lead_rejected_${enquiryId}_${managerId.toString()}`
              });
            }
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'DEAL_LOST': {
          const { reason } = payload;
          const notifications: CreateNotificationInput[] = [];

          if (mongoose.connection.readyState === 1 || (User as any)._isMocked) {
            const activeAdminIds = await this.getActiveAdminIds(actor.role === 'ADMIN' ? actor.id : undefined);
            for (const admId of activeAdminIds) {
              notifications.push({
                recipient: admId,
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Deal Lost: ${customerName}`,
                message: `Lead "${customerName}" was marked Deal Lost. Reason: ${reason}.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'CLOSED',
                link: `/leads`,
                idempotencyKey: `deal_lost_${enquiryId}_${admId}`
              });
            }

            let managerId = payload.managerId;
            let assignedUserName = payload.assignedUserName;
            if (!managerId && enquiry.assignedTo) {
              const assignedUser = await User.findById(enquiry.assignedTo).select('_id name managerId isActive');
              if (assignedUser?.managerId) {
                managerId = assignedUser.managerId.toString();
              }
              if (assignedUser?.name) {
                assignedUserName = assignedUser.name;
              }
            }

            if (managerId && managerId.toString() !== actor.id) {
              notifications.push({
                recipient: managerId.toString(),
                sender: actor.id,
                senderName: actor.name,
                type: 'WORKFLOW_UPDATE',
                title: `Team Deal Lost: ${customerName}`,
                message: `Team lead "${customerName}" (assigned to ${assignedUserName || 'Sales Agent'}) was marked Deal Lost. Reason: ${reason}.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: 'CLOSED',
                link: `/manager/rejected-deals`,
                idempotencyKey: `deal_lost_${enquiryId}_${managerId.toString()}`
              });
            }

            // REQ-36: Notify assigned Sales Agent when another authorized user marks their lead as Deal Lost
            if (enquiry.assignedTo) {
              const assignedAgentId = enquiry.assignedTo.toString();
              if (assignedAgentId !== actor.id) {
                notifications.push({
                  recipient: assignedAgentId,
                  sender: actor.id,
                  senderName: actor.name,
                  type: 'WORKFLOW_UPDATE',
                  title: `Opportunity Deal Lost: ${customerName}`,
                  message: `Your assigned lead "${customerName}" was marked Deal Lost by ${actor.name}. Reason: ${reason}.`,
                  relatedEnquiryId: enquiryId,
                  relatedCustomerName: customerName,
                  relatedStage: 'CLOSED',
                  link: `/leads`,
                  idempotencyKey: `deal_lost_${enquiryId}_${assignedAgentId}`
                });
              }
            }
          }

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'UNASSIGNED_LEAD': {
          const notifications: CreateNotificationInput[] = [];
          if (mongoose.connection.readyState === 1 || (User as any)._isMocked) {
            const activeAdminIds = await this.getActiveAdminIds();
            for (const admId of activeAdminIds) {
              notifications.push({
                recipient: admId,
                sender: actor?.id || null,
                senderName: actor?.name || 'System',
                type: 'SYSTEM_ALERT',
                title: `Unassigned Lead: ${customerName}`,
                message: `Enquiry "${customerName}" for property "${projectName}" was saved unassigned. Please assign manually.`,
                relatedEnquiryId: enquiryId,
                relatedCustomerName: customerName,
                relatedStage: stage,
                link: `/leads`,
                idempotencyKey: `unassigned_alert_${enquiryId}_${admId}`
              });
            }
          }
          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        case 'RE_ENQUIRY': {
          const { recipientIds = [], previousStatus, metadata = {} } = payload;
          const notifications = (recipientIds as string[]).map((recId: string) => ({
            recipient: recId,
            sender: actor?.id || null,
            senderName: actor?.name || 'System',
            type: 'RETURNING_CUSTOMER_RE_ENQUIRY' as const,
            title: 'Returning Customer — New Lead Created',
            message: `A new enquiry for "${customerName}" (returning customer, previous status: ${previousStatus}) has been created.`,
            relatedEnquiryId: enquiryId,
            relatedCustomerName: customerName,
            relatedStage: stage,
            link: `/sales/leads/${enquiryId}/workflow`,
            idempotencyKey: `re_enquiry_${enquiryId}_${recId}`,
            metadata
          }));

          await Promise.allSettled(notifications.map((n) => this.createNotification(n)));
          break;
        }

        default:
          break;
      }
    } catch (dispatchErr) {
      console.error('[NotificationService] Centralized event dispatch error:', sanitizeErrorMessage(dispatchErr));
    }
  }

  /**
   * Dispatches notifications when a Next Follow-up is scheduled.
   * Recipient rules:
   * - SALES saves: Assigned Sales Agent + Responsible active Manager + All active Admins.
   * - MANAGER saves: Assigned Sales Agent + Responsible active Manager + All active Admins.
   * - ADMIN saves: Assigned Sales Agent + Responsible active Manager + Performing Admin only.
   */
  async notifyNextFollowUpScheduled(input: NextFollowUpNotificationInput): Promise<void> {
    try {
      const { actor, enquiry, followUpId, purpose = 'CALL', nextFollowUpDate, nextFollowUpTime } = input;

      // Strict guard: Next follow-up date and time must both be present and non-empty
      if (!nextFollowUpDate || !String(nextFollowUpDate).trim() || !nextFollowUpTime || !String(nextFollowUpTime).trim()) {
        return;
      }

      const enquiryId = (enquiry._id?.toString() || enquiry.id || '').toString();
      const customerName = enquiry.name?.trim() || 'Valued Prospect';
      const projectName = enquiry.projectName?.trim() || 'N/A';

      const displayDate = formatFollowUpDate(nextFollowUpDate);
      const displayTime = formatFollowUpTime(nextFollowUpTime);

      const schedulerRoleLabel =
        actor.role === 'SALES' ? 'Sales Agent' : actor.role === 'MANAGER' ? 'Manager' : 'Admin';

      const title = 'Next Follow-up Scheduled';
      const message = `A next follow-up has been scheduled for ${customerName} on ${displayDate} at ${displayTime}. Scheduled by ${actor.name} (${schedulerRoleLabel}). Property: ${projectName}.`;
      const link = `/sales/leads/${enquiryId}/workflow`;

      // Resolve eligible active recipients
      const recipientIds = new Set<string>();

      // 1. Assigned Sales Agent (if active)
      let assignedUser: any = null;
      if (enquiry.assignedTo) {
        const assignedIdStr = (enquiry.assignedTo._id || enquiry.assignedTo).toString();
        assignedUser = await User.findById(assignedIdStr).select('_id name role isActive managerId');
        if (assignedUser && assignedUser.isActive) {
          recipientIds.add(assignedUser._id.toString());
        }
      }

      // 2. Responsible active Manager (resolved through team relationship of assigned agent)
      let managerIdStr: string | null = null;
      if (assignedUser?.managerId) {
        managerIdStr = (assignedUser.managerId._id || assignedUser.managerId).toString();
      } else if (enquiry.managerId) {
        managerIdStr = (enquiry.managerId._id || enquiry.managerId).toString();
      }

      if (managerIdStr) {
        const manager = await User.findById(managerIdStr).select('_id role isActive');
        if (manager && manager.role === 'MANAGER' && manager.isActive) {
          recipientIds.add(manager._id.toString());
        }
      }

      // 3. Admin recipients based on actor role
      if (actor.role === 'ADMIN') {
        // Admin saves: performing Admin only
        const performingAdmin = await User.findById(actor.id).select('_id role isActive');
        if (performingAdmin && performingAdmin.role === 'ADMIN' && performingAdmin.isActive) {
          recipientIds.add(performingAdmin._id.toString());
        }
      } else {
        // Sales or Manager saves: all active Admins
        const activeAdminIds = await this.getActiveAdminIds();
        for (const admId of activeAdminIds) {
          recipientIds.add(admId);
        }
      }

      // Dispatch notifications to all eligible active recipients with idempotency keys
      const notificationsToCreate: CreateNotificationInput[] = Array.from(recipientIds).map((recipientId) => ({
        recipient: recipientId,
        sender: actor.id,
        senderName: actor.name,
        type: 'NEW_FOLLOW_UP',
        title,
        message,
        relatedEnquiryId: enquiryId,
        relatedCustomerName: customerName,
        relatedStage: 'FOLLOW_UP',
        link,
        idempotencyKey: `next_followup_${enquiryId}_${recipientId}_${followUpId}`,
        metadata: {
          leadId: enquiryId,
          customerName,
          projectName,
          nextFollowUpDate: displayDate,
          nextFollowUpTime: displayTime,
          purpose,
          scheduledBy: actor.name,
          scheduledByRole: schedulerRoleLabel,
          stage: 'FOLLOW_UP',
          notificationCreatedAt: new Date().toISOString()
        }
      }));

      await Promise.allSettled(notificationsToCreate.map((n) => this.createNotification(n)));
    } catch (dispatchErr) {
      console.error('[NotificationService] notifyNextFollowUpScheduled error:', sanitizeErrorMessage(dispatchErr));
    }
  }
}

export interface NextFollowUpNotificationInput {
  actor: {
    id: string;
    name: string;
    role: string;
  };
  enquiry: {
    _id: any;
    name?: string;
    projectName?: string;
    currentStage?: string;
    assignedTo?: any;
    managerId?: any;
    [key: string]: any;
  };
  followUpId: string;
  purpose?: string;
  nextFollowUpDate: string;
  nextFollowUpTime: string;
}

export function formatFollowUpDate(dateInput: string | Date): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const monthIndex = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const monthStr = months[monthIndex] || ymdMatch[2];
      return `${dayStr} ${monthStr} ${year}`;
    }
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatFollowUpTime(timeInput: string): string {
  if (!timeInput) return '';
  const trimmed = timeInput.trim();
  if (/am|pm/i.test(trimmed)) return trimmed;
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    return `${hourStr}:${minute} ${ampm}`;
  }
  return trimmed;
}

export const notificationService = new NotificationService();
