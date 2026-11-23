import { Schema, model, Document, Types } from 'mongoose';

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface IAlert extends Document {
  type: string;
  status: AlertStatus;
  severity: AlertSeverity;
  title: string;
  message: string;
  incidentKey: string;
  details?: Record<string, unknown>;
  acknowledgedBy?: Types.ObjectId | null;
  acknowledgedByName?: string | null;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  emailSent: boolean;
  emailSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const alertSchema = new Schema<IAlert>(
  {
    type: {
      type: String,
      default: 'RETENTION_CLEANUP_FAILURE',
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
        message: '{VALUE} is not a valid alert status'
      },
      default: 'OPEN',
      required: true
    },
    severity: {
      type: String,
      enum: {
        values: ['CRITICAL', 'WARNING', 'INFO'],
        message: '{VALUE} is not a valid alert severity'
      },
      default: 'CRITICAL',
      required: true
    },
    title: {
      type: String,
      required: [true, 'Alert title is required'],
      trim: true
    },
    message: {
      type: String,
      required: [true, 'Alert message is required'],
      trim: true
    },
    incidentKey: {
      type: String,
      required: [true, 'Incident key is required for deduplication'],
      trim: true
    },
    details: {
      type: Schema.Types.Mixed,
      default: {}
    },
    acknowledgedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    acknowledgedByName: {
      type: String,
      default: null,
      trim: true
    },
    acknowledgedAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    emailSent: {
      type: Boolean,
      default: false
    },
    emailSentAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes
alertSchema.index({ incidentKey: 1, status: 1 });
alertSchema.index({ createdAt: -1 });
alertSchema.index({ status: 1, createdAt: -1 });

export const Alert = model<IAlert>('Alert', alertSchema, 'alerts');
