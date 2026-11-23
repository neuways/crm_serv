import { Schema, model, Document, Types } from 'mongoose';

export interface ISecurityLog extends Document {
  employeeId: Types.ObjectId;
  employeeName: string;
  eventType: 'SENSITIVE_REMARK_REJECTED';
  safeReasonCode: 'PROHIBITED_CREDENTIALS';
  timestamp: Date;
  createdAt: Date;
}

const securityLogSchema = new Schema<ISecurityLog>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Employee ID is required']
    },
    employeeName: {
      type: String,
      required: [true, 'Employee name is required'],
      trim: true
    },
    eventType: {
      type: String,
      enum: {
        values: ['SENSITIVE_REMARK_REJECTED'],
        message: '{VALUE} is not a valid security log event type'
      },
      default: 'SENSITIVE_REMARK_REJECTED',
      required: true
    },
    safeReasonCode: {
      type: String,
      default: 'PROHIBITED_CREDENTIALS',
      required: true,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes for administrative query performance and retention cleanup
securityLogSchema.index({ createdAt: -1 });
securityLogSchema.index({ employeeId: 1, createdAt: -1 });

// Immutability: Prevent modification of existing security log records
securityLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('SecurityLog is append-only: existing security log records cannot be modified'));
  }
  next();
});

export const SecurityLog = model<ISecurityLog>(
  'SecurityLog',
  securityLogSchema,
  'security_logs'
);
