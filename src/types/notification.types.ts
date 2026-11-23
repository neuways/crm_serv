import { Types } from 'mongoose';

export type NotificationType =
  | 'NEW_LEAD_ASSIGNED'
  | 'LEAD_ASSIGNED'
  | 'LEAD_REASSIGNED'
  | 'NEW_ACTIVITY'
  | 'NEW_FOLLOW_UP'
  | 'MEETING_SCHEDULED'
  | 'MEETING_CANCELLED'
  | 'SITE_VISIT_SCHEDULED'
  | 'SITE_VISIT_CANCELLED'
  | 'WORKFLOW_UPDATE'
  | 'SYSTEM_ALERT'
  | 'RETURNING_CUSTOMER_RE_ENQUIRY'
  | 'DUPLICATE_ENQUIRY';

export interface LeadNotificationMetadata {
  leadId: string;
  customerName: string;
  mobile: string;
  alternateMobile?: string;
  email?: string;
  projectName?: string;
  propertyType?: string;
  configuration?: string;
  preferredLocation?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetRange?: string;
  requirement?: string;
  description?: string;
  remarks?: string;
  enquirySource?: string;
  preferredContactMethod?: string;
  preferredContactTiming?: string;
  enquiryDate?: string;
  status?: string;
  currentStage?: string;
  assignedBy?: string;
  assignedByRole?: string;
  assignedToName?: string;
  assignedToId?: string;
  assignmentDate?: string;
  assignmentType?: 'INITIAL_ASSIGNMENT' | 'REASSIGNMENT' | 'ROUND_ROBIN';
  previousAssigneeName?: string;
  leadOwner?: string;
  [key: string]: any;
}

export interface CreateNotificationInput {
  recipient: string | Types.ObjectId;
  sender?: string | Types.ObjectId | null;
  senderName?: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEnquiryId?: string | Types.ObjectId | null;
  relatedCustomerName?: string | null;
  relatedStage?: string | null;
  link?: string | null;
  idempotencyKey?: string | null;
  metadata?: LeadNotificationMetadata | Record<string, any>;
}

export interface GetNotificationsQuery {
  page?: number;
  limit?: number;
  unreadOnly?: boolean | string;
}

export interface NotificationResponseItem {
  id: string;
  recipient: string;
  sender?: string | null;
  senderName: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEnquiryId?: string | null;
  relatedCustomerName?: string | null;
  relatedStage?: string | null;
  link?: string | null;
  isRead: boolean;
  readAt?: Date | null;
  metadata?: LeadNotificationMetadata | Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GetNotificationsResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  notifications: NotificationResponseItem[];
  unreadCount: number;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface UnreadCountResult {
  success: boolean;
  unreadCount: number;
}

export interface MarkReadResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  notification?: NotificationResponseItem;
}

export interface MarkAllReadResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  markedCount: number;
}
