import { Schema, model, Document, Types } from 'mongoose';
import { normalizeMobile, normalizeEmail } from '../utils/normalization.js';

export type PreferredContactMethod = 'CALL' | 'WHATSAPP' | 'EMAIL';
export type EnquiryStatus = 'ACTIVE' | 'CLOSED';
export type WorkflowStage = 'FOLLOW_UP' | 'MEETING_PLAN' | 'SITE_VISIT_PLAN' | 'DEAL_DONE';

export interface ICancellationHistoryItem {
  cancellationReason: string;
  cancelledAt: Date;
  cancelledBy?: Types.ObjectId | null;
  cancelledByName?: string;
  previousDate?: string;
  previousTime?: string;
}

export interface IMeetingPlan {
  meetingPlace?: string;
  meetingDate?: string;
  meetingTime?: string;
  projectDetails?: string;
  managerId?: Types.ObjectId | null;
  managerName?: string;
  remarks?: string;
  meetingResult?: string;
  isCompleted: boolean;
  completedAt?: Date;
  updatedAt?: Date;
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  isCancelled?: boolean;
  cancellationReason?: string;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId | null;
  cancelledByName?: string;
  previousDate?: string;
  previousTime?: string;
  cancellationHistory?: ICancellationHistoryItem[];
}

export interface ISiteVisitPlan {
  siteVisitAddress?: string;
  siteVisitDate?: string;
  siteVisitTime?: string;
  projectName?: string;
  managerId?: Types.ObjectId | null;
  managerName?: string;
  remarks?: string;
  visitOutcome?: string;
  isCompleted: boolean;
  completedAt?: Date;
  updatedAt?: Date;
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  isCancelled?: boolean;
  cancellationReason?: string;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId | null;
  cancelledByName?: string;
  previousDate?: string;
  previousTime?: string;
  cancellationHistory?: ICancellationHistoryItem[];
}

export interface IDealDone {
  project?: string;
  propertyType?: string;
  price?: number;
  size?: string;
  remarks?: string;
  isConfirmed: boolean;
  confirmedAt?: Date;
}

export type BudgetStatus = 'VERIFIED_BUDGET' | 'LOAN_PRE_APPROVED' | 'STRETCH_BUDGET' | 'UNCONFIRMED';
export type PurchaseTimeline = 'IMMEDIATE' | 'WITHIN_30_DAYS' | 'WITHIN_90_DAYS' | 'ABOVE_90_DAYS';
export type DecisionMaker = 'SOLE_DECISION_MAKER' | 'JOINT_DECISION_MAKER' | 'INFLUENCER_ONLY';
export type RequirementClarity = 'SPECIFIC_UNIT_TYPE' | 'GENERAL_REQUIREMENT' | 'EXPLORATORY';
export type LeadPriority = 'HOT' | 'POSSIBLE';
export type ReadinessPercentage = '10%' | '20%' | '50%' | '70%' | '80%' | '100%';

export interface ILeadQualification {
  budgetStatus?: BudgetStatus;
  timeline?: PurchaseTimeline;
  decisionMaker?: DecisionMaker;
  needClarity?: RequirementClarity;
  priority?: LeadPriority;
  readinessScore?: number;
  scoreLabel?: ReadinessPercentage;
  calculatedScore?: number;
  notes?: string;
  isQualified: boolean;
  qualifiedAt?: Date;
  qualifiedBy?: Types.ObjectId | null;
  qualifiedByName?: string;
}

export type ClosureType = 'REJECTED' | 'DEAL_LOST';

export const PREDEFINED_REJECTION_REASONS = [
  'Budget too high',
  'Property not suitable',
  'Location issue',
  'Payment/loan issue',
  'Chose another property/competitor',
  'Not interested',
  'Other'
] as const;

export type RejectionReason = typeof PREDEFINED_REJECTION_REASONS[number];

/**
 * REQ-36: Dedicated Predefined Reasons for Lead Rejection (Early-stage disqualification)
 */
export const REJECTED_REASONS = [
  'Not interested',
  'Location issue',
  'Budget mismatch',
  'Budget too high',
  'Property not suitable',
  'Invalid enquiry',
  'Other'
] as const;

export type RejectedReason = typeof REJECTED_REASONS[number];

/**
 * REQ-36: Dedicated Predefined Reasons for Deal Lost (Late-stage opportunity loss)
 */
export const DEAL_LOST_REASONS = [
  'Chose another property/competitor',
  'Chose another property / competitor',
  'Payment/loan issue',
  'Payment / loan issue',
  'Pricing issue',
  'Property preference changed',
  'Other'
] as const;

export type DealLostReason = typeof DEAL_LOST_REASONS[number];

/**
 * Combined list of all permitted closure reasons for Mongoose validation & backward compatibility
 */
export const ALL_CLOSURE_REASONS = Array.from(
  new Set([
    ...PREDEFINED_REJECTION_REASONS,
    ...REJECTED_REASONS,
    ...DEAL_LOST_REASONS
  ])
) as string[];

export interface IRejectionDetails {
  closureType?: ClosureType;
  reason: string;
  remarks?: string;
  rejectedBy?: Types.ObjectId | null;
  rejectedByName?: string;
  rejectedAt: Date;
  previousStage: WorkflowStage;
}

export interface IEnquiry extends Document {
  name: string;
  mobile: string;
  normalizedMobile: string;
  email?: string;
  normalizedEmail?: string;
  projectName?: string;
  preferredLocation?: string;
  requirement?: string;
  budgetMin?: number;
  budgetMax?: number;
  description?: string;
  source?: string;
  preferredContactMethod?: PreferredContactMethod;
  preferredContactTiming?: string;
  isDoNotContact?: boolean;
  status: EnquiryStatus;
  isActive: boolean;
  assignedTo?: Types.ObjectId | null;
  currentStage: WorkflowStage;
  meetingPlan?: IMeetingPlan;
  siteVisitPlan?: ISiteVisitPlan;
  dealDone?: IDealDone;
  qualification?: ILeadQualification;
  rejection?: IRejectionDetails;
  previousEnquiryId?: Types.ObjectId | null;
  isReEnquiry?: boolean;
  importId?: string;
  importRowNumber?: number;
  unassignedReason?: string;
  managerId?: Types.ObjectId | null;
  createdById?: Types.ObjectId | null;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const rejectionDetailsSchema = new Schema<IRejectionDetails>(
  {
    closureType: {
      type: String,
      trim: true,
      enum: {
        values: ['REJECTED', 'DEAL_LOST'],
        message: '{VALUE} is not a valid closure type'
      },
      required: false
    },
    reason: {
      type: String,
      trim: true,
      enum: {
        values: ALL_CLOSURE_REASONS,
        message: '{VALUE} is not a valid closure reason'
      }
    },
    remarks: {
      type: String,
      trim: true
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedByName: {
      type: String,
      trim: true
    },
    rejectedAt: {
      type: Date
    },
    previousStage: {
      type: String,
      enum: ['FOLLOW_UP', 'MEETING_PLAN', 'SITE_VISIT_PLAN', 'DEAL_DONE']
    }
  },
  { _id: false }
);

const enquirySchema = new Schema<IEnquiry>(
  {
    name: {
      type: String,
      required: [true, 'Enquiry name is required'],
      trim: true
    },
    mobile: {
      type: String,
      required: [true, 'Enquiry mobile number is required'],
      trim: true
    },
    normalizedMobile: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      trim: true
    },
    normalizedEmail: {
      type: String,
      lowercase: true,
      trim: true
    },
    projectName: {
      type: String,
      trim: true
    },
    preferredLocation: {
      type: String,
      trim: true,
      maxlength: [200, 'Preferred location cannot exceed 200 characters']
    },
    requirement: {
      type: String,
      trim: true
    },
    budgetMin: {
      type: Number,
      min: [0, 'Budget minimum cannot be negative']
    },
    budgetMax: {
      type: Number,
      min: [0, 'Budget maximum cannot be negative']
    },
    description: {
      type: String,
      trim: true
    },
    source: {
      type: String,
      trim: true
    },
    preferredContactMethod: {
      type: String,
      enum: {
        values: ['CALL', 'WHATSAPP', 'EMAIL'],
        message: '{VALUE} is not a valid contact method. Allowed: CALL, WHATSAPP, EMAIL'
      }
    },
    preferredContactTiming: {
      type: String,
      trim: true
    },
    isDoNotContact: {
      type: Boolean,
      default: false,
      index: true
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'CLOSED'],
        message: '{VALUE} is not a valid enquiry status'
      },
      default: 'ACTIVE'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    currentStage: {
      type: String,
      enum: {
        values: ['FOLLOW_UP', 'MEETING_PLAN', 'SITE_VISIT_PLAN', 'DEAL_DONE'],
        message: '{VALUE} is not a valid workflow stage'
      },
      default: 'FOLLOW_UP'
    },
    meetingPlan: {
      meetingPlace: { type: String, trim: true },
      meetingDate: { type: String, trim: true },
      meetingTime: { type: String, trim: true },
      projectDetails: { type: String, trim: true },
      managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      managerName: { type: String, trim: true },
      remarks: { type: String, trim: true },
      meetingResult: { type: String, trim: true },
      isCompleted: { type: Boolean, default: false },
      completedAt: { type: Date },
      updatedAt: { type: Date },
      status: {
        type: String,
        enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED']
      },
      isCancelled: { type: Boolean, default: false },
      cancellationReason: { type: String, trim: true },
      cancelledAt: { type: Date },
      cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      cancelledByName: { type: String, trim: true },
      previousDate: { type: String, trim: true },
      previousTime: { type: String, trim: true },
      cancellationHistory: [
        {
          cancellationReason: { type: String, trim: true },
          cancelledAt: { type: Date, default: Date.now },
          cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          cancelledByName: { type: String, trim: true },
          previousDate: { type: String, trim: true },
          previousTime: { type: String, trim: true }
        }
      ]
    },
    siteVisitPlan: {
      siteVisitAddress: { type: String, trim: true },
      siteVisitDate: { type: String, trim: true },
      siteVisitTime: { type: String, trim: true },
      projectName: { type: String, trim: true },
      managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      managerName: { type: String, trim: true },
      remarks: { type: String, trim: true },
      visitOutcome: { type: String, trim: true },
      isCompleted: { type: Boolean, default: false },
      completedAt: { type: Date },
      updatedAt: { type: Date },
      status: {
        type: String,
        enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED']
      },
      isCancelled: { type: Boolean, default: false },
      cancellationReason: { type: String, trim: true },
      cancelledAt: { type: Date },
      cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      cancelledByName: { type: String, trim: true },
      previousDate: { type: String, trim: true },
      previousTime: { type: String, trim: true },
      cancellationHistory: [
        {
          cancellationReason: { type: String, trim: true },
          cancelledAt: { type: Date, default: Date.now },
          cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          cancelledByName: { type: String, trim: true },
          previousDate: { type: String, trim: true },
          previousTime: { type: String, trim: true }
        }
      ]
    },
    dealDone: {
      project: { type: String, trim: true },
      propertyType: { type: String, trim: true },
      price: { type: Number, min: 0 },
      size: { type: String, trim: true },
      remarks: { type: String, trim: true },
      isConfirmed: { type: Boolean, default: false },
      confirmedAt: { type: Date }
    },
    qualification: {
      budgetStatus: {
        type: String,
        enum: {
          values: ['VERIFIED_BUDGET', 'LOAN_PRE_APPROVED', 'STRETCH_BUDGET', 'UNCONFIRMED'],
          message: '{VALUE} is not a valid budget status'
        }
      },
      timeline: {
        type: String,
        enum: {
          values: ['IMMEDIATE', 'WITHIN_30_DAYS', 'WITHIN_90_DAYS', 'ABOVE_90_DAYS'],
          message: '{VALUE} is not a valid timeline'
        }
      },
      decisionMaker: {
        type: String,
        enum: {
          values: ['SOLE_DECISION_MAKER', 'JOINT_DECISION_MAKER', 'INFLUENCER_ONLY'],
          message: '{VALUE} is not a valid decision maker role'
        }
      },
      needClarity: {
        type: String,
        enum: {
          values: ['SPECIFIC_UNIT_TYPE', 'GENERAL_REQUIREMENT', 'EXPLORATORY'],
          message: '{VALUE} is not a valid need clarity value'
        }
      },
      priority: {
        type: String,
        enum: {
          values: ['HOT', 'POSSIBLE'],
          message: '{VALUE} is not a valid lead priority'
        }
      },
      readinessScore: {
        type: Number
      },
      scoreLabel: {
        type: String,
        enum: {
          values: ['10%', '20%', '50%', '70%', '80%', '100%'],
          message: '{VALUE} is not a valid score label'
        }
      },
      calculatedScore: {
        type: Number,
        min: 0,
        max: 100
      },
      notes: { type: String, trim: true },
      isQualified: { type: Boolean, default: false },
      qualifiedAt: { type: Date },
      qualifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      qualifiedByName: { type: String, trim: true }
    },
    rejection: {
      type: rejectionDetailsSchema,
      default: undefined
    },
    previousEnquiryId: {
      type: Schema.Types.ObjectId,
      ref: 'Enquiry',
      default: null,
      index: true
    },
    isReEnquiry: {
      type: Boolean,
      default: false
    },
    importId: {
      type: String,
      trim: true,
      index: true,
      sparse: true
    },
    importRowNumber: {
      type: Number
    },
    unassignedReason: {
      type: String,
      trim: true
    },
    managerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    createdByName: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret: Record<string, any>) {
        if (ret.rejection && !ret.rejection.reason) {
          delete ret.rejection;
        }
        return ret;
      }
    },
    toObject: {
      transform: function (doc, ret: Record<string, any>) {
        if (ret.rejection && !ret.rejection.reason) {
          delete ret.rejection;
        }
        return ret;
      }
    }
  }
);

// ---------------------------------------------------------------------------------
// Document Pre-Validation Hook: Normalization & Lifecycle Synchronization
// ---------------------------------------------------------------------------------
enquirySchema.pre('validate', function (next) {
  // Mobile normalization
  if (this.mobile) {
    try {
      this.normalizedMobile = normalizeMobile(this.mobile);
    } catch (err) {
      return next(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Email normalization
  if (this.email) {
    this.normalizedEmail = normalizeEmail(this.email);
  } else {
    this.normalizedEmail = undefined;
  }

  // Prevent contradictory document state
  if (this.status === 'CLOSED' && this.isActive === true && this.isModified('isActive') && !this.isModified('status')) {
    return next(new Error('Contradictory state: status is CLOSED but isActive is set to true'));
  }
  if (this.status === 'ACTIVE' && this.isActive === false && this.isModified('isActive') && !this.isModified('status')) {
    return next(new Error('Contradictory state: status is ACTIVE but isActive is set to false'));
  }

  // Synchronize isActive flag with enquiry status
  if (this.status === 'CLOSED') {
    this.isActive = false;
  } else if (this.status === 'ACTIVE') {
    this.isActive = true;
    this.rejection = undefined;
  }

  // Lifecycle invariant: unrejected leads must never hold empty or incomplete rejection metadata
  if (!this.rejection?.reason) {
    this.rejection = undefined;
  }

  next();
});

// ---------------------------------------------------------------------------------
// Query Middleware: Enforce Lifecycle Invariant on Query Updates (updateOne, findOneAndUpdate)
// ---------------------------------------------------------------------------------
enquirySchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function (next) {
  const update = this.getUpdate() as Record<string, any> | null;
  if (!update) return next();

  const hasSet = Boolean(update.$set);
  const status = update.$set?.status ?? update.status;
  const isActive = update.$set?.isActive ?? update.isActive;

  // Prevent contradictory updates
  if (status === 'CLOSED' && isActive === true) {
    return next(new Error('Contradictory update rejected: status cannot be CLOSED while isActive is true'));
  }
  if (status === 'ACTIVE' && isActive === false) {
    return next(new Error('Contradictory update rejected: status cannot be ACTIVE while isActive is false'));
  }

  // Synchronize isActive when status is updated
  if (status === 'CLOSED') {
    if (hasSet) {
      update.$set.isActive = false;
    } else {
      update.isActive = false;
    }
  } else if (status === 'ACTIVE') {
    if (hasSet) {
      update.$set.isActive = true;
    } else {
      update.isActive = true;
    }
  }

  // Synchronize status when isActive is updated without explicit status
  if (status === undefined && isActive !== undefined) {
    if (isActive === false) {
      if (hasSet) {
        update.$set.status = 'CLOSED';
      } else {
        update.status = 'CLOSED';
      }
    } else if (isActive === true) {
      if (hasSet) {
        update.$set.status = 'ACTIVE';
      } else {
        update.status = 'ACTIVE';
      }
    }
  }

  // Normalize mobile if modified in query update
  const mobile = update.$set?.mobile ?? update.mobile;
  if (mobile) {
    try {
      const normalized = normalizeMobile(mobile);
      if (hasSet) {
        update.$set.normalizedMobile = normalized;
      } else {
        update.normalizedMobile = normalized;
      }
    } catch (err) {
      return next(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Normalize email if modified in query update
  if (hasSet && 'email' in update.$set) {
    update.$set.normalizedEmail = normalizeEmail(update.$set.email);
  } else if ('email' in update) {
    update.normalizedEmail = normalizeEmail(update.email);
  }

  next();
});

// ---------------------------------------------------------------------------------
// Database Indexes
// ---------------------------------------------------------------------------------

// 1. Unique partial index on normalizedMobile for active enquiries
enquirySchema.index(
  { normalizedMobile: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'unique_active_normalized_mobile'
  }
);

// 2. Unique partial index on normalizedEmail for active enquiries where email is a string
enquirySchema.index(
  { normalizedEmail: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isActive: true,
      normalizedEmail: { $type: 'string' }
    },
    name: 'unique_active_normalized_email'
  }
);

// 3. Query support indexes
enquirySchema.index({ assignedTo: 1, status: 1 });
enquirySchema.index({ assignedTo: 1, managerId: 1, status: 1 });
enquirySchema.index({ unassignedReason: 1 });
enquirySchema.index({ createdAt: -1 });
enquirySchema.index({ importId: 1, importRowNumber: 1 }, { sparse: true });

export const Enquiry = model<IEnquiry>('Enquiry', enquirySchema, 'enquiries');
