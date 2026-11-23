import { Schema, model, Document, Types } from 'mongoose';
import { NotificationType } from '../types/notification.types.js';

export interface INotification extends Document {
  recipient: Types.ObjectId;
  sender?: Types.ObjectId | null;
  senderName: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEnquiryId?: Types.ObjectId | null;
  relatedCustomerName?: string | null;
  relatedStage?: string | null;
  link?: string | null;
  isRead: boolean;
  readAt?: Date | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Notification recipient is required'],
      index: true
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    senderName: {
      type: String,
      default: 'System',
      trim: true
    },
    type: {
      type: String,
      required: [true, 'Notification type is required'],
      enum: {
        values: [
          'NEW_LEAD_ASSIGNED',
          'LEAD_ASSIGNED',
          'LEAD_REASSIGNED',
          'NEW_ACTIVITY',
          'NEW_FOLLOW_UP',
          'MEETING_SCHEDULED',
          'MEETING_CANCELLED',
          'SITE_VISIT_SCHEDULED',
          'SITE_VISIT_CANCELLED',
          'WORKFLOW_UPDATE',
          'SYSTEM_ALERT',
          'RETURNING_CUSTOMER_RE_ENQUIRY',
          'DUPLICATE_ENQUIRY'
        ],
        message: '{VALUE} is not a valid notification type'
      },
      trim: true
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true
    },
    relatedEnquiryId: {
      type: Schema.Types.ObjectId,
      ref: 'Enquiry',
      default: null,
      index: true
    },
    relatedCustomerName: {
      type: String,
      default: null,
      trim: true
    },
    relatedStage: {
      type: String,
      default: null,
      trim: true
    },
    link: {
      type: String,
      default: null,
      trim: true
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    },
    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Compound index for querying user notifications sorted by recent / read status
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
