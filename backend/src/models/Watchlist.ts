import mongoose, { Document, Schema } from 'mongoose';

export interface IWatchlist extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  productMasterId: mongoose.Types.ObjectId;
  targetPrice?: number;
  currency: string;
  platformPreferences: string[];
  alertFrequency: 'instant' | 'daily' | 'weekly';
  isEnabled: boolean;
  lastAlertSent?: Date;
  alertCount: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const watchlistSchema = new Schema<IWatchlist>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  productMasterId: {
    type: Schema.Types.ObjectId,
    ref: 'ProductMaster',
    required: [true, 'Product master ID is required'],
    index: true,
  },
  targetPrice: {
    type: Number,
    min: [0, 'Target price cannot be negative'],
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    default: 'INR',
    uppercase: true,
  },
  platformPreferences: [{
    type: String,
    enum: ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other'],
    lowercase: true,
  }],
  alertFrequency: {
    type: String,
    enum: ['instant', 'daily', 'weekly'],
    default: 'instant',
  },
  isEnabled: {
    type: Boolean,
    default: true,
  },
  lastAlertSent: {
    type: Date,
  },
  alertCount: {
    type: Number,
    default: 0,
    min: [0, 'Alert count cannot be negative'],
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot be more than 500 characters'],
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Compound indexes
watchlistSchema.index({ userId: 1, productMasterId: 1 }, { unique: true });
watchlistSchema.index({ userId: 1, isEnabled: 1 });
watchlistSchema.index({ productMasterId: 1 });
watchlistSchema.index({ createdAt: -1 });
watchlistSchema.index({ isEnabled: 1, alertFrequency: 1 });

// Virtual for product details
watchlistSchema.virtual('product', {
  ref: 'ProductMaster',
  localField: 'productMasterId',
  foreignField: '_id',
  justOne: true,
});

// Virtual for user details
watchlistSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true,
});

// Static method to get user's watchlist with product details
watchlistSchema.statics.getUserWatchlistWithProducts = function(userId: string) {
  return this.find({ userId, isEnabled: true })
    .populate('product')
    .sort({ createdAt: -1 });
};

// Static method to get products being watched by multiple users
watchlistSchema.statics.getPopularWatchedProducts = function(limit: number = 10) {
  return this.aggregate([
    { $match: { isEnabled: true } },
    {
      $group: {
        _id: '$productMasterId',
        watchCount: { $sum: 1 },
        avgTargetPrice: { $avg: '$targetPrice' },
      },
    },
    { $sort: { watchCount: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'productmasters',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
  ]);
};

// Instance method to check if alert should be sent
watchlistSchema.methods.shouldSendAlert = function(): boolean {
  if (!this.isEnabled) return false;
  
  if (!this.lastAlertSent) return true;
  
  const now = new Date();
  const lastAlert = this.lastAlertSent;
  const hoursSinceLastAlert = (now.getTime() - lastAlert.getTime()) / (1000 * 60 * 60);
  
  switch (this.alertFrequency) {
    case 'instant':
      return hoursSinceLastAlert >= 1; // At least 1 hour gap for instant alerts
    case 'daily':
      return hoursSinceLastAlert >= 24;
    case 'weekly':
      return hoursSinceLastAlert >= 168; // 24 * 7
    default:
      return false;
  }
};

export const Watchlist = mongoose.model<IWatchlist>('Watchlist', watchlistSchema);