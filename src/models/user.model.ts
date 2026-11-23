import { Schema, model, Document, Types } from 'mongoose';

export type UserRole = 'ADMIN' | 'MANAGER' | 'SALES';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  googleSub?: string;
  role: UserRole;
  isActive: boolean;
  isTeamActive?: boolean;
  mustChangePassword?: boolean;
  managerId?: any;
  assignedPropertyIds?: any[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'User name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'User email is required'],
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false // Excluded from default queries to prevent accidental leakage in API responses
    },
    googleSub: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      select: false // Excluded from default queries to protect third-party identity IDs
    },
    role: {
      type: String,
      enum: {
        values: ['ADMIN', 'MANAGER', 'SALES'],
        message: '{VALUE} is not a valid role. Allowed roles are: ADMIN, MANAGER, SALES'
      },
      required: [true, 'User role must be explicitly specified']
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isTeamActive: {
      type: Boolean,
      default: true
    },
    mustChangePassword: {
      type: Boolean,
      default: false
    },
    managerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedPropertyIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'PropertyMapping'
      }
    ]
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        delete ret.googleSub;
        return ret;
      }
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        delete ret.googleSub;
        return ret;
      }
    }
  }
);

export const User = model<IUser>('User', userSchema, 'users');
