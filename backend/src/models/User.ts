import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface RefreshToken {
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface UserDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  googleId?: string;
  roles: string[];
  preferences?: Record<string, unknown>;
  refreshTokens: RefreshToken[];
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new Schema<RefreshToken>({
  tokenHash: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { _id: false });

const UserSchema = new Schema<UserDoc>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String },
  passwordHash: { type: String, required: true },
  googleId: { type: String },
  roles: { type: [String], default: ['user'] },
  preferences: { type: Schema.Types.Mixed },
  refreshTokens: { type: [RefreshTokenSchema], default: [] }
}, { timestamps: true });

export const User: Model<UserDoc> = mongoose.models.User || mongoose.model<UserDoc>('User', UserSchema);

