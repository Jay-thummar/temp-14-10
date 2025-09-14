import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User, IUser } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { generateToken, generateRefreshToken, JWTPayload } from '../middleware/auth';
import { sendEmail } from './emailService';
import { sendSMS } from './smsService';

export interface AuthResponse {
  user: Partial<IUser>;
  accessToken: string;
  refreshToken: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface GoogleAuthData {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
}

export class AuthService {
  // Register new user
  static async register(userData: RegisterData): Promise<AuthResponse> {
    // Check if user already exists
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      throw new AppError('User with this email already exists', 400);
    }

    // Check phone number if provided
    if (userData.phone) {
      const existingPhone = await User.findOne({ phone: userData.phone });
      if (existingPhone) {
        throw new AppError('User with this phone number already exists', 400);
      }
    }

    // Create new user
    const user = await User.create({
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      passwordHash: userData.password, // Will be hashed by pre-save middleware
    });

    // Generate tokens
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
    };

    const accessToken = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store hashed refresh token
    const hashedRefreshToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
    user.refreshTokens.push(hashedRefreshToken);
    await user.save();

    // Send welcome email
    try {
      await this.sendWelcomeEmail(user);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  // Login user
  static async login(loginData: LoginData): Promise<AuthResponse> {
    const { email, password } = loginData;

    // Find user and include password field
    const user = await User.findOne({ email }).select('+passwordHash +refreshTokens');
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid email or password', 401);
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 401);
    }

    // Generate tokens
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
    };

    const accessToken = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store hashed refresh token (limit to 5 active tokens)
    const hashedRefreshToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
    user.refreshTokens.push(hashedRefreshToken);
    
    // Keep only the last 5 refresh tokens
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }

    // Update last login time
    user.lastLoginAt = new Date();
    await user.save();

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  // Google OAuth login/register
  static async googleAuth(googleData: GoogleAuthData): Promise<AuthResponse> {
    let user = await User.findOne({ googleId: googleData.googleId });

    if (!user) {
      // Check if user exists with same email
      user = await User.findOne({ email: googleData.email });
      if (user) {
        // Link Google account to existing user
        user.googleId = googleData.googleId;
        if (googleData.avatar) user.avatar = googleData.avatar;
        user.emailVerified = true;
      } else {
        // Create new user
        user = await User.create({
          name: googleData.name,
          email: googleData.email,
          googleId: googleData.googleId,
          avatar: googleData.avatar,
          emailVerified: true,
        });
      }
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 401);
    }

    // Generate tokens
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
    };

    const accessToken = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store hashed refresh token
    const hashedRefreshToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push(hashedRefreshToken);
    
    // Keep only the last 5 refresh tokens
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }

    // Update last login time
    user.lastLoginAt = new Date();
    await user.save();

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  // Refresh access token
  static async refreshToken(user: IUser, oldRefreshToken: string): Promise<AuthResponse> {
    // Generate new tokens
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
    };

    const accessToken = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Replace old refresh token with new one
    const oldHashedToken = jwt.sign({ token: oldRefreshToken }, process.env.JWT_SECRET!);
    const newHashedToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
    
    const tokenIndex = user.refreshTokens.indexOf(oldHashedToken);
    if (tokenIndex > -1) {
      user.refreshTokens[tokenIndex] = newHashedToken;
      await user.save();
    }

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  // Logout user (remove refresh token)
  static async logout(user: IUser, refreshToken: string): Promise<void> {
    const hashedToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
    user.refreshTokens = user.refreshTokens.filter(token => token !== hashedToken);
    await user.save();
  }

  // Logout from all devices
  static async logoutAll(user: IUser): Promise<void> {
    user.refreshTokens = [];
    await user.save();
  }

  // Change password
  static async changePassword(
    user: IUser,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    // Verify current password
    if (!(await user.comparePassword(currentPassword))) {
      throw new AppError('Current password is incorrect', 400);
    }

    // Update password
    user.passwordHash = newPassword; // Will be hashed by pre-save middleware
    user.refreshTokens = []; // Invalidate all refresh tokens
    await user.save();
  }

  // Forgot password
  static async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('No user found with this email address', 404);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Store reset token in user (you might want to add these fields to User model)
    // user.passwordResetToken = hashedResetToken;
    // user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // await user.save({ validateBeforeSave: false });

    // Send reset email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request - ShopCompare',
        template: 'password-reset',
        data: {
          name: user.name,
          resetUrl: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`,
        },
      });
    } catch (error) {
      // user.passwordResetToken = undefined;
      // user.passwordResetExpires = undefined;
      // await user.save({ validateBeforeSave: false });
      throw new AppError('Failed to send password reset email', 500);
    }
  }

  // Send email verification
  static async sendEmailVerification(user: IUser): Promise<void> {
    if (user.emailVerified) {
      throw new AppError('Email is already verified', 400);
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // You might want to store this token in the user model or cache
    // For now, we'll generate a JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email, type: 'email_verification' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    try {
      await sendEmail({
        to: user.email,
        subject: 'Verify Your Email - ShopCompare',
        template: 'email-verification',
        data: {
          name: user.name,
          verificationUrl: `${process.env.FRONTEND_URL}/verify-email?token=${token}`,
        },
      });
    } catch (error) {
      throw new AppError('Failed to send verification email', 500);
    }
  }

  // Verify email
  static async verifyEmail(token: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      
      if (decoded.type !== 'email_verification') {
        throw new AppError('Invalid verification token', 400);
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (user.emailVerified) {
        throw new AppError('Email is already verified', 400);
      }

      user.emailVerified = true;
      await user.save();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid or expired verification token', 400);
      }
      throw error;
    }
  }

  // Send phone verification OTP
  static async sendPhoneVerification(user: IUser): Promise<void> {
    if (!user.phone) {
      throw new AppError('Phone number is required', 400);
    }

    if (user.phoneVerified) {
      throw new AppError('Phone is already verified', 400);
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in cache (Redis) with 5-minute expiry
    // await CacheService.set(`phone_otp:${user._id}`, otp, 300);

    try {
      await sendSMS({
        to: user.phone,
        message: `Your ShopCompare verification code is: ${otp}. Valid for 5 minutes.`,
      });
    } catch (error) {
      throw new AppError('Failed to send verification SMS', 500);
    }
  }

  // Verify phone OTP
  static async verifyPhone(user: IUser, otp: string): Promise<void> {
    // Get stored OTP from cache
    // const storedOtp = await CacheService.get(`phone_otp:${user._id}`);
    
    // For demo purposes, accept any 6-digit OTP
    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('Invalid OTP format', 400);
    }

    // if (!storedOtp || storedOtp !== otp) {
    //   throw new AppError('Invalid or expired OTP', 400);
    // }

    user.phoneVerified = true;
    await user.save();

    // Remove OTP from cache
    // await CacheService.del(`phone_otp:${user._id}`);
  }

  // Send welcome email
  private static async sendWelcomeEmail(user: IUser): Promise<void> {
    await sendEmail({
      to: user.email,
      subject: 'Welcome to ShopCompare!',
      template: 'welcome',
      data: {
        name: user.name,
        loginUrl: `${process.env.FRONTEND_URL}/login`,
      },
    });
  }

  // Sanitize user data (remove sensitive fields)
  private static sanitizeUser(user: IUser): Partial<IUser> {
    const userObj = user.toJSON();
    delete userObj.passwordHash;
    delete userObj.refreshTokens;
    return userObj;
  }
}