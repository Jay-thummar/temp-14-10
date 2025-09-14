import mongoose, { Document, Schema } from 'mongoose';

export interface IPriceHistory extends Document {
  _id: mongoose.Types.ObjectId;
  platformItemId: mongoose.Types.ObjectId;
  productMasterId: mongoose.Types.ObjectId;
  platform: string;
  price: number;
  originalPrice?: number;
  currency: string;
  stockStatus: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

const priceHistorySchema = new Schema<IPriceHistory>({
  platformItemId: {
    type: Schema.Types.ObjectId,
    ref: 'PlatformItem',
    required: [true, 'Platform item ID is required'],
    index: true,
  },
  productMasterId: {
    type: Schema.Types.ObjectId,
    ref: 'ProductMaster',
    required: [true, 'Product master ID is required'],
    index: true,
  },
  platform: {
    type: String,
    required: [true, 'Platform is required'],
    enum: ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other'],
    lowercase: true,
    index: true,
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative'],
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    default: 'INR',
    uppercase: true,
  },
  stockStatus: {
    type: String,
    required: [true, 'Stock status is required'],
    enum: ['in_stock', 'out_of_stock', 'limited_stock', 'preorder'],
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: false, // We use custom timestamp field
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Compound indexes for efficient queries
priceHistorySchema.index({ platformItemId: 1, timestamp: -1 });
priceHistorySchema.index({ productMasterId: 1, platform: 1, timestamp: -1 });
priceHistorySchema.index({ platform: 1, timestamp: -1 });
priceHistorySchema.index({ timestamp: -1 });

// TTL index to automatically delete old records (keep 1 year of data)
priceHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Static method to get price trend
priceHistorySchema.statics.getPriceTrend = function(
  productMasterId: string,
  platforms?: string[],
  days: number = 30
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const matchStage: any = {
    productMasterId: new mongoose.Types.ObjectId(productMasterId),
    timestamp: { $gte: startDate },
  };

  if (platforms && platforms.length > 0) {
    matchStage.platform = { $in: platforms };
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          platform: '$platform',
        },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { '_id.date': 1, '_id.platform': 1 },
    },
  ]);
};

// Static method to get lowest price in time range
priceHistorySchema.statics.getLowestPriceInRange = function(
  productMasterId: string,
  days: number = 30,
  platforms?: string[]
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const matchStage: any = {
    productMasterId: new mongoose.Types.ObjectId(productMasterId),
    timestamp: { $gte: startDate },
  };

  if (platforms && platforms.length > 0) {
    matchStage.platform = { $in: platforms };
  }

  return this.findOne(matchStage).sort({ price: 1 });
};

export const PriceHistory = mongoose.model<IPriceHistory>('PriceHistory', priceHistorySchema);