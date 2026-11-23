import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPropertyMapping extends Document {
  propertyName: string;
  normalizedName: string;
  agentIds: Types.ObjectId[];
  lastAssignedAgentId?: Types.ObjectId | null;
  lastAssignedIndex: number;
  createdById?: Types.ObjectId | null;
  updatedById?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const propertyMappingSchema = new Schema<IPropertyMapping>(
  {
    propertyName: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    agentIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    lastAssignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastAssignedIndex: {
      type: Number,
      default: -1,
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const PropertyMapping = mongoose.model<IPropertyMapping>(
  'PropertyMapping',
  propertyMappingSchema
);
