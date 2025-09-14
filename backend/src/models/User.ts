import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  googleId?: string;
  avatar?: string;
  roles: string[];
  preferences: {
    language: 'en' | 'gu';
    currency: string;
    theme: 'light' | 'dark';
    notifications: {
      email: boolean;
      push: boolean;
      digest: 'daily' | 'weekly' | 'none';
    };
    platforms: string[];
  };
  refreshTokens: string[];
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  generatePasswordResetToken(): string;
  changedPasswordAfter(JWTTimestamp: number): boolean;
}

const userSchema = new Schema<IUser>({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please enter a valid email',
    ],
  },
  phone: {
    type: String,
    sparse: true,
    match: [/^\+?[\d\s-()]+$/, 'Please enter a valid phone number'],
  },
  passwordHash: {
    type: String,
    required: function(this: IUser) {
      return !this.googleId; // Password required only if not OAuth user
    },
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  googleId: {
    type: String,
    sparse: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  roles: {
    type: [String],
    enum: ['user', 'admin', 'moderator'],
    default: ['user'],
  },
  preferences: {
    language: {
      type: String,
      enum: ['en', 'gu'],
      default: 'en',
    },
    currency: {
      type: String,
      default: 'INR',
    },
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light',
    },
    notifications: {
      email: {
        type: Boolean,
        default: true,
      },
      push: {
        type: Boolean,
        default: true,
      },
      digest: {
        type: String,
        enum: ['daily', 'weekly', 'none'],
        default: 'weekly',
      },
    },
    platforms: {
      type: [String],
      default: ['amazon', 'flipkart', 'myntra'],
    },
  },
  refreshTokens: {
    type: [String],
    default: [],
    select: false,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  phoneVerified: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLoginAt: Date,
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.passwordHash;
      delete ret.refreshTokens;
      delete ret.__v;
      return ret;
    },
  },
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ phone: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Instance method to compare password
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Instance method to check if password changed after JWT was issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp: number): boolean {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      (this.passwordChangedAt.getTime() / 1000).toString(),
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Static method to find by email or phone
userSchema.statics.findByEmailOrPhone = function(identifier: string) {
  return this.findOne({
    $or: [
      { email: identifier },
      { phone: identifier }
    ]
  });
};

export const User = mongoose.model<IUser>('User', userSchema);