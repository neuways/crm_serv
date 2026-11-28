import { Schema, model, Document, Types } from 'mongoose';

export type UserRole = 'ADMIN' | 'MANAGER' | 'SALES';

export interface IUser extends Document {
  name: string;
  email: string;
  phone?: string | null;
  normalizedPhone?: string | null;
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

export const EMPLOYEE_PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Extracts a normalized 10-digit Indian mobile number (e.g. '9876543210')
 * from inputs like '9876543210', '09876543210', '919876543210', or '+91 9876543210'.
 * Returns undefined if the input does not represent a valid 10-digit Indian mobile.
 */
export const extractNormalized10DigitPhone = (value?: string | null): string | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && EMPLOYEE_PHONE_REGEX.test(digits)) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0') && EMPLOYEE_PHONE_REGEX.test(digits.slice(1))) {
    return digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('91') && EMPLOYEE_PHONE_REGEX.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return undefined;
};

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
    phone: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: (value: string | null | undefined) => {
          if (!value) return true;
          return EMPLOYEE_PHONE_REGEX.test(value);
        },
        message: 'Mobile number must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9'
      }
    },
    normalizedPhone: {
      type: String,
      trim: true,
      default: undefined
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

userSchema.pre('save', function (next) {
  if (this.phone) {
    this.normalizedPhone = extractNormalized10DigitPhone(this.phone);
  } else {
    this.normalizedPhone = undefined;
  }
  next();
});

userSchema.index({ normalizedPhone: 1 }, { sparse: true });

export const User = model<IUser>('User', userSchema, 'users');
