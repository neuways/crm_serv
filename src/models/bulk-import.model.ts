import mongoose, { Schema, model, Document, Types } from 'mongoose';
import { UserRole } from './user.model.js';

export type BulkImportStatus =
  | 'PENDING_CONFIRMATION'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export type ImportRowErrorCategory = 'DUPLICATE' | 'INVALID' | 'FAILED';

export interface IImportRowError {
  rowNumber: number;
  customerIdentifier?: string;
  reason: string;
  field?: string;
  category: ImportRowErrorCategory;
  details?: string;
}

export interface IBulkImportAssignmentConfig {
  method: 'ROUND_ROBIN' | 'MANUAL' | 'SELF';
  assignedToId?: Types.ObjectId | null;
  assignedToName?: string;
}

export interface IBulkImport extends Document {
  importId: string;
  uploadedBy: Types.ObjectId;
  uploadedByName: string;
  userRole: UserRole;
  originalFilename: string;
  fileSize: number;
  source: 'BULK_UPLOAD';
  totalRows: number;
  processedRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  failedCount: number;
  assignedCount: number;
  unassignedCount: number;
  currentBatch: number;
  totalBatches: number;
  status: BulkImportStatus;
  assignmentConfig: IBulkImportAssignmentConfig;
  columnMapping: Record<string, string>;
  detectedHeaders: string[];
  rowErrors: IImportRowError[];
  stagedRows?: Array<Record<string, any>>;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  cancelRequested?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const importRowErrorSchema = new Schema<IImportRowError>(
  {
    rowNumber: { type: Number, required: true },
    customerIdentifier: { type: String, trim: true },
    reason: { type: String, required: true, trim: true },
    field: { type: String, trim: true },
    category: {
      type: String,
      enum: ['DUPLICATE', 'INVALID', 'FAILED'],
      required: true
    },
    details: { type: String, trim: true }
  },
  { _id: false }
);

const bulkImportAssignmentConfigSchema = new Schema<IBulkImportAssignmentConfig>(
  {
    method: {
      type: String,
      enum: ['ROUND_ROBIN', 'MANUAL', 'SELF'],
      required: true
    },
    assignedToId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedToName: {
      type: String,
      trim: true
    }
  },
  { _id: false }
);

const bulkImportSchema = new Schema<IBulkImport>(
  {
    importId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    uploadedByName: {
      type: String,
      required: true,
      trim: true
    },
    userRole: {
      type: String,
      enum: ['ADMIN', 'MANAGER', 'SALES'],
      required: true
    },
    originalFilename: {
      type: String,
      required: true,
      trim: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    source: {
      type: String,
      default: 'BULK_UPLOAD',
      trim: true
    },
    totalRows: {
      type: Number,
      default: 0
    },
    processedRows: {
      type: Number,
      default: 0
    },
    importedCount: {
      type: Number,
      default: 0
    },
    duplicateCount: {
      type: Number,
      default: 0
    },
    invalidCount: {
      type: Number,
      default: 0
    },
    failedCount: {
      type: Number,
      default: 0
    },
    assignedCount: {
      type: Number,
      default: 0
    },
    unassignedCount: {
      type: Number,
      default: 0
    },
    currentBatch: {
      type: Number,
      default: 0
    },
    totalBatches: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['PENDING_CONFIRMATION', 'QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'],
      default: 'PENDING_CONFIRMATION',
      index: true
    },
    assignmentConfig: {
      type: bulkImportAssignmentConfigSchema,
      required: true
    },
    columnMapping: {
      type: Map,
      of: String,
      default: () => new Map()
    },
    detectedHeaders: {
      type: [String],
      default: []
    },
    rowErrors: {
      type: [importRowErrorSchema],
      default: []
    },
    stagedRows: {
      type: [Schema.Types.Mixed],
      default: undefined
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    },
    errorMessage: {
      type: String,
      trim: true
    },
    cancelRequested: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Compound index for active import lock check per user
bulkImportSchema.index({ uploadedBy: 1, status: 1 });
bulkImportSchema.index({ createdAt: -1 });

export const BulkImport = model<IBulkImport>('BulkImport', bulkImportSchema, 'bulk_imports');
