import { Schema, model, Document, Types } from 'mongoose';

/**
 * REQ-38: Approved reasons for activating Do Not Contact (DNC) restrictions.
 */
export const DNC_ACTIVATION_REASONS = [
  'CUSTOMER_EXPLICITLY_REQUESTED',
  'LEGAL_REGULATORY_OPT_OUT',
  'OTHER'
] as const;

export type DncActivationReason = typeof DNC_ACTIVATION_REASONS[number];

/**
 * REQ-38: Approved reasons for revoking Do Not Contact (DNC) restrictions.
 */
export const DNC_REVOCATION_REASONS = [
  'CUSTOMER_RENEWED_CONSENT',
  'MANAGER_OVERRIDE',
  'OTHER'
] as const;

export type DncRevocationReason = typeof DNC_REVOCATION_REASONS[number];

export interface IDncHistoryEntry {
  action: 'ENABLED' | 'REVOKED';
  reason: string;
  remarks: string;
  actorId: Types.ObjectId;
  actorName: string;
  timestamp: Date;
  previousState: boolean;
  newState: boolean;
}

export interface IDoNotContact extends Document {
  normalizedMobile: string;
  isDoNotContact: boolean;
  reason?: string;
  remarks?: string;
  activatedBy?: Types.ObjectId | null;
  activatedByName?: string;
  activatedAt?: Date;
  revocationReason?: string;
  revocationRemarks?: string;
  revokedBy?: Types.ObjectId | null;
  revokedByName?: string;
  revokedAt?: Date;
  history: IDncHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const dncHistorySchema = new Schema<IDncHistoryEntry>(
  {
    action: {
      type: String,
      enum: ['ENABLED', 'REVOKED'],
      required: true
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    remarks: {
      type: String,
      required: true,
      trim: true
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    actorName: {
      type: String,
      required: true,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    previousState: {
      type: Boolean,
      required: true
    },
    newState: {
      type: Boolean,
      required: true
    }
  },
  { _id: false }
);

const doNotContactSchema = new Schema<IDoNotContact>(
  {
    normalizedMobile: {
      type: String,
      required: [true, 'Normalized mobile number is required for DNC registry'],
      unique: true,
      trim: true,
      index: true
    },
    isDoNotContact: {
      type: Boolean,
      default: false,
      index: true
    },
    reason: {
      type: String,
      trim: true
    },
    remarks: {
      type: String,
      trim: true
    },
    activatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    activatedByName: {
      type: String,
      trim: true
    },
    activatedAt: {
      type: Date
    },
    revocationReason: {
      type: String,
      trim: true
    },
    revocationRemarks: {
      type: String,
      trim: true
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    revokedByName: {
      type: String,
      trim: true
    },
    revokedAt: {
      type: Date
    },
    history: {
      type: [dncHistorySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

export const DoNotContact = model<IDoNotContact>('DoNotContact', doNotContactSchema, 'do_not_contacts');
