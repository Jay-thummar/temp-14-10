import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/User';
import { AppError, catchAsync } from './errorHandler';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export interface JWTPayload {
  id: string;
  email: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

// Generate JWT token
export const generateToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
};

// Generate refresh token
export const generateRefreshToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
};

// Verify JWT token
export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
};

// Verify refresh token
export const verifyRefreshToken = (token: string): JWTPayload => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as JWTPayload;
};

// Middleware to protect routes
export const protect = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  // 1) Getting token and check if it's there
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  // 2) Verification token
  let decoded: JWTPayload;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError('Your token has expired! Please log in again.', 401));
    } else if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid token. Please log in again!', 401));
    } else {
      return next(new AppError('Token verification failed. Please log in again!', 401));
    }
  }

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id).select('+passwordHash');
  if (!currentUser) {
    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }

  // 4) Check if user is active
  if (!currentUser.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // 5) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat!)) {
    return next(new AppError('User recently changed password! Please log in again.', 401));
  }

  // Grant access to protected route
  req.user = currentUser;
  next();
});

// Middleware to restrict to certain roles
export const restrictTo = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('You are not logged in!', 401));
    }

    const userRoles = req.user.roles;
    const hasPermission = roles.some(role => userRoles.includes(role));

    if (!hasPermission) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }

    next();
  };
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = verifyToken(token);
    const currentUser = await User.findById(decoded.id);
    
    if (currentUser && currentUser.isActive && !currentUser.changedPasswordAfter(decoded.iat!)) {
      req.user = currentUser;
    }
  } catch (error) {
    // Silently fail for optional auth
  }

  next();
});

// Middleware to check if user owns the resource
export const checkOwnership = (resourceUserIdField: string = 'userId') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('You are not logged in!', 401));
    }

    const resourceUserId = req.body[resourceUserIdField] || req.params[resourceUserIdField];
    
    if (resourceUserId && resourceUserId.toString() !== req.user._id.toString()) {
      // Allow admins to access any resource
      if (!req.user.roles.includes('admin')) {
        return next(new AppError('You can only access your own resources', 403));
      }
    }

    next();
  };
};

// Middleware to validate refresh token
export const validateRefreshToken = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new AppError('Refresh token is required', 400));
  }

  let decoded: JWTPayload;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError('Refresh token has expired! Please log in again.', 401));
    } else if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid refresh token. Please log in again!', 401));
    } else {
      return next(new AppError('Refresh token verification failed. Please log in again!', 401));
    }
  }

  // Check if user still exists
  const currentUser = await User.findById(decoded.id).select('+refreshTokens');
  if (!currentUser) {
    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }

  // Check if refresh token exists in user's refresh tokens
  const hashedRefreshToken = jwt.sign({ token: refreshToken }, process.env.JWT_SECRET!);
  if (!currentUser.refreshTokens.includes(hashedRefreshToken)) {
    return next(new AppError('Invalid refresh token. Please log in again!', 401));
  }

  // Check if user is active
  if (!currentUser.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  req.user = currentUser;
  next();
});

// Middleware to log user activity
export const logUserActivity = (action: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user) {
      // Update last activity timestamp
      User.findByIdAndUpdate(req.user._id, {
        lastLoginAt: new Date(),
      }).catch(err => {
        console.error('Failed to update user activity:', err);
      });
    }
    next();
  };
};