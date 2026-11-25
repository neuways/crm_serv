import { Schema, model, Document, Types } from 'mongoose';

export type ActivityType =
  | 'REMARK_ADDED'
  | 'CALL_ATTEMPT'
  | 'WORK_REPORT_SUBMITTED'
  | 'ASSIGNMENT_CHANGED'
  | 'STATUS_CHANGED'
  | 'DUPLICATE_MATCH_DETECTED'
  | 'WORKFLOW_STAGE_CHANGED'
  | 'MEETING_PLANNED'
  | 'MEETING_COMPLETED'
  | 'MEETING_CANCELLED'
  | 'SITE_VISIT_PLANNED'
  | 'SITE_VISIT_COMPLETED'
  | 'SITE_VISIT_CANCELLED'
  | 'DEAL_COMPLETED'
  | 'TASK_STATUS_CHANGED'
  | 'LEAD_REJECTED'
  | 'DEAL_LOST'
  | 'DO_NOT_CONTACT_ENABLED'
  | 'DO_NOT_CONTACT_REVOKED'
  // Backward-compatible types from Step 3:
  | 'REMARK'
  | 'DUPLICATE_ATTEMPT'
  | 'STATUS_CHANGE';

export class AppendOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppendOnlyViolationError';
  }
}

export interface IEnquiryActivity extends Document {
  enquiryId?: Types.ObjectId | null;
  createdById?: Types.ObjectId | null;
  createdByName?: string;
  performedBy?: Types.ObjectId | null;
  performedByName?: string;
  actorRole?: 'ADMIN' | 'MANAGER' | 'SALES' | 'SYSTEM';
  managerId?: Types.ObjectId | null;
  outcome?: string;
  purpose?: string;
  callDurationSeconds?: number;
  nextFollowUpDate?: Date;
  nextFollowUpTime?: string;
  type: ActivityType;
  note: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const enquiryActivitySchema = new Schema<IEnquiryActivity>(
  {
    enquiryId: {
      type: Schema.Types.ObjectId,
      ref: 'Enquiry',
      default: null,
      required: [
        function (this: IEnquiryActivity) {
          return this.type !== 'WORK_REPORT_SUBMITTED';
        },
        'Activity must be linked to an EnquiryId'
      ]
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    createdByName: {
      type: String,
      trim: true
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    performedByName: {
      type: String,
      trim: true
    },
    actorRole: {
      type: String,
      enum: ['ADMIN', 'MANAGER', 'SALES', 'SYSTEM'],
      index: true
    },
    managerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    outcome: {
      type: String,
      trim: true,
      index: true
    },
    purpose: {
      type: String,
      trim: true
    },
    callDurationSeconds: {
      type: Number,
      min: 0
    },
    nextFollowUpDate: {
      type: Date
    },
    nextFollowUpTime: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      enum: {
        values: [
          'REMARK_ADDED',
          'CALL_ATTEMPT',
          'WORK_REPORT_SUBMITTED',
          'ASSIGNMENT_CHANGED',
          'STATUS_CHANGED',
          'DUPLICATE_MATCH_DETECTED',
          'WORKFLOW_STAGE_CHANGED',
          'MEETING_PLANNED',
          'MEETING_COMPLETED',
          'MEETING_CANCELLED',
          'SITE_VISIT_PLANNED',
          'SITE_VISIT_COMPLETED',
          'SITE_VISIT_CANCELLED',
          'DEAL_COMPLETED',
          'TASK_STATUS_CHANGED',
          'LEAD_REJECTED',
          'DEAL_LOST',
          'DO_NOT_CONTACT_ENABLED',
          'DO_NOT_CONTACT_REVOKED',
          'REMARK',
          'DUPLICATE_ATTEMPT',
          'STATUS_CHANGE'
        ],
        message: '{VALUE} is not a valid activity type'
      },
      default: 'REMARK_ADDED',
      required: true
    },
    note: {
      type: String,
      required: [true, 'Activity note or remark content is required'],
      trim: true
    },
    metadata: {
      type: Schema.Types.Mixed
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// -----------------------------------------------------------------
// Backward-Compatibility Normalization Hook
// -----------------------------------------------------------------
enquiryActivitySchema.pre('validate', function (next) {
  // 1. If modern performedBy is provided, it is authoritative and synchronizes to legacy createdById
  if (this.performedBy) {
    this.createdById = this.performedBy;
  } else if (this.createdById) {
    // 2. If only legacy createdById is provided, populate modern performedBy for backward compatibility
    this.performedBy = this.createdById;
  }

  // 3. If modern performedByName is provided, it is authoritative and synchronizes to createdByName
  if (this.performedByName) {
    this.createdByName = this.performedByName;
  } else if (this.createdByName) {
    // 4. If only legacy createdByName is provided, populate modern performedByName
    this.performedByName = this.createdByName;
  }
  next();
});

// ---------------------------------------------------------------------------------
// Append-Only Safeguards (Application-Level Protection)
// ---------------------------------------------------------------------------------

/**
 * 1. Document-level Save Protection:
 * Prevents modifications to existing activity documents.
 * Legitimate new activity creations (where this.isNew === true) pass through.
 */
enquiryActivitySchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(
      new AppendOnlyViolationError(
        'EnquiryActivity is append-only: existing activity records cannot be modified'
      )
    );
  }
  next();
});

/**
 * 2. Document-level Delete Protection:
 * Prevents deleting an activity document instance via doc.deleteOne().
 */
enquiryActivitySchema.pre('deleteOne', { document: true, query: false }, function (next) {
  return next(
    new AppendOnlyViolationError(
      'EnquiryActivity is append-only: document operation "deleteOne" is prohibited'
    )
  );
});

/**
 * 3. Query-level Update Protections:
 * Intercepts updateOne, updateMany, findOneAndUpdate, replaceOne.
 * (Note: findByIdAndUpdate delegates internally to findOneAndUpdate in Mongoose).
 */
const prohibitedUpdateQueries = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne'
];

for (const method of prohibitedUpdateQueries) {
  enquiryActivitySchema.pre(method as any, function (next) {
    return next(
      new AppendOnlyViolationError(
        `EnquiryActivity is append-only: query operation "${method}" is prohibited`
      )
    );
  });
}

/**
 * 4. Query-level Delete Protections:
 * Intercepts deleteOne, deleteMany, findOneAndDelete, findOneAndRemove.
 * (Note: findByIdAndDelete delegates internally to findOneAndDelete in Mongoose).
 */
const prohibitedDeleteQueries = [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove'
];

for (const method of prohibitedDeleteQueries) {
  enquiryActivitySchema.pre(method as any, { document: false, query: true }, function (next) {
    return next(
      new AppendOnlyViolationError(
        `EnquiryActivity is append-only: query operation "${method}" is prohibited`
      )
    );
  });
}

/**
 * 5. Static bulkWrite Protection:
 * Intercepts bulkWrite batches containing update or delete operations.
 * Raw bulkWrite bypasses Mongoose query middleware, so it is guarded at the model boundary.
 */
enquiryActivitySchema.static(
  'bulkWrite',
  function (this: any, ops: any[], options?: any) {
    if (Array.isArray(ops)) {
      for (const op of ops) {
        if (
          op &&
          (op.updateOne ||
            op.updateMany ||
            op.replaceOne ||
            op.deleteOne ||
            op.deleteMany)
        ) {
          throw new AppendOnlyViolationError(
            'EnquiryActivity is append-only: bulkWrite update and delete operations are prohibited'
          );
        }
      }
    }
    return Object.getPrototypeOf(this).bulkWrite.call(this, ops, options);
  }
);

/**
 * 6. Static bulkSave Protection:
 * Intercepts bulkSave operations attempting to persist modified or non-new documents.
 */
enquiryActivitySchema.static(
  'bulkSave',
  function (this: any, docs: any[], options?: any) {
    if (Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc && (!doc.isNew || (typeof doc.isModified === 'function' && doc.isModified()))) {
          throw new AppendOnlyViolationError(
            'EnquiryActivity is append-only: bulkSave cannot update existing activity records'
          );
        }
      }
    }
    return Object.getPrototypeOf(this).bulkSave.call(this, docs, options);
  }
);

// ---------------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------------
enquiryActivitySchema.index({ enquiryId: 1, createdAt: -1 });
enquiryActivitySchema.index({ createdById: 1 });
enquiryActivitySchema.index({ performedBy: 1, createdAt: -1 });
enquiryActivitySchema.index({ managerId: 1, createdAt: -1 });
enquiryActivitySchema.index({ type: 1 });
enquiryActivitySchema.index({ createdAt: -1, outcome: 1 });

export const EnquiryActivity = model<IEnquiryActivity>(
  'EnquiryActivity',
  enquiryActivitySchema,
  'enquiry_activities'
);
