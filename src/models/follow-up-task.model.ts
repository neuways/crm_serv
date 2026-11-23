import { Schema, model, Document, Types } from 'mongoose';

export type TaskPurpose = 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'OTHER';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED';
export type TaskOutcome = 'CONNECTED' | 'NO_ANSWER' | 'CALL_BACK_REQUESTED' | 'MEETING_SCHEDULED' | 'NOT_INTERESTED' | 'OTHER';

export const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'RESCHEDULED'],
  RESCHEDULED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

export interface IFollowUpTask extends Document {
  enquiryId: Types.ObjectId;
  assignedTo: Types.ObjectId;
  purpose: TaskPurpose;
  customPurpose?: string;
  followUpDate: Date;
  followUpTime: string;
  notes?: string;
  status: TaskStatus;
  outcome?: TaskOutcome;
  nextFollowUpDate?: Date;
  nextFollowUpTime?: string;
  isInitialTask?: boolean;
  cancellationReason?: string;
  previousStatus?: TaskStatus;
  previousFollowUpDate?: Date;
  previousFollowUpTime?: string;
  statusChangedAt?: Date;
  statusChangedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const followUpTaskSchema = new Schema<IFollowUpTask>(
  {
    enquiryId: {
      type: Schema.Types.ObjectId,
      ref: 'Enquiry',
      required: [true, 'Follow-up task must be linked to an Enquiry']
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Follow-up task must be assigned to an agent']
    },
    purpose: {
      type: String,
      enum: {
        values: ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER'],
        message: '{VALUE} is not a valid follow-up purpose'
      },
      required: [true, 'Follow-up purpose is required']
    },
    customPurpose: {
      type: String,
      trim: true,
      required: [
        function (this: IFollowUpTask) {
          return this.purpose === 'OTHER';
        },
        'Custom purpose description is required when purpose is set to OTHER'
      ],
      validate: {
        validator: function (this: IFollowUpTask, val?: string) {
          if (this.purpose === 'OTHER') {
            return typeof val === 'string' && val.trim().length > 0;
          }
          return true;
        },
        message: 'Custom purpose cannot be empty or whitespace only'
      }
    },
    followUpDate: {
      type: Date,
      required: [true, 'Follow-up date is required']
    },
    followUpTime: {
      type: String,
      required: [true, 'Follow-up time is required'],
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'],
        message: '{VALUE} is not a valid task status'
      },
      default: 'PENDING'
    },
    cancellationReason: {
      type: String,
      trim: true
    },
    previousStatus: {
      type: String,
      enum: {
        values: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'],
        message: '{VALUE} is not a valid task status'
      }
    },
    previousFollowUpDate: {
      type: Date
    },
    previousFollowUpTime: {
      type: String,
      trim: true
    },
    statusChangedAt: {
      type: Date
    },
    statusChangedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    outcome: {
      type: String,
      enum: {
        values: ['CONNECTED', 'NO_ANSWER', 'CALL_BACK_REQUESTED', 'MEETING_SCHEDULED', 'NOT_INTERESTED', 'OTHER'],
        message: '{VALUE} is not a valid follow-up outcome'
      },
      default: 'CONNECTED'
    },
    nextFollowUpDate: {
      type: Date,
      required: [
        function (this: IFollowUpTask) {
          return this.outcome === 'CALL_BACK_REQUESTED';
        },
        'Next follow-up date is required when outcome is CALL_BACK_REQUESTED'
      ]
    },
    nextFollowUpTime: {
      type: String,
      trim: true,
      required: [
        function (this: IFollowUpTask) {
          return this.outcome === 'CALL_BACK_REQUESTED';
        },
        'Next follow-up time is required when outcome is CALL_BACK_REQUESTED'
      ]
    },
    isInitialTask: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
followUpTaskSchema.index({ enquiryId: 1 });
followUpTaskSchema.index(
  { enquiryId: 1 },
  {
    unique: true,
    partialFilterExpression: { isInitialTask: true },
    name: 'unique_initial_task_per_enquiry'
  }
);
followUpTaskSchema.index({ assignedTo: 1, status: 1 });
followUpTaskSchema.index({ followUpDate: 1, status: 1 });

export const FollowUpTask = model<IFollowUpTask>(
  'FollowUpTask',
  followUpTaskSchema,
  'follow_up_tasks'
);
