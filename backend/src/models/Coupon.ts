import mongoose, { Document, Schema } from 'mongoose';

export interface ICoupon extends Document {
  _id: mongoose.Types.ObjectId;
  platform: string;
  code: string;
  title: string;
  description: string;
  discountType: 'percentage' | 'fixed' | 'cashback' | 'free_shipping';
  discountValue: number;
  maxDiscount?: number;
  minOrderValue?: number;
  currency: string;
  categories: string[];
  validFrom: Date;
  validTill: Date;
  usageLimit?: number;
  usedCount: number;
  isActive: boolean;
  terms: string[];
  sourceUrl?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>({
  platform: {
    type: String,
    required: [true, 'Platform is required'],
    enum: ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other'],
    lowercase: true,
    index: true,
  },
  code: {
    type: String,
    required: [true, 'Coupon code is required'],
    uppercase: true,
    trim: true,
    maxlength: [50, 'Coupon code cannot be more than 50 characters'],
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters'],
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters'],
  },
  discountType: {
    type: String,
    required: [true, 'Discount type is required'],
    enum: ['percentage', 'fixed', 'cashback', 'free_shipping'],
  },
  discountValue: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: [0, 'Discount value cannot be negative'],
  },
  maxDiscount: {
    type: Number,
    min: [0, 'Max discount cannot be negative'],
  },
  minOrderValue: {
    type: Number,
    min: [0, 'Min order value cannot be negative'],
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    default: 'INR',
    uppercase: true,
  },
  categories: [{
    type: String,
    lowercase: true,
    trim: true,
  }],
  validFrom: {
    type: Date,
    required: [true, 'Valid from date is required'],
    index: true,
  },
  validTill: {
    type: Date,
    required: [true, 'Valid till date is required'],
    index: true,
  },
  usageLimit: {
    type: Number,
    min: [1, 'Usage limit must be at least 1'],
  },
  usedCount: {
    type: Number,
    required: [true, 'Used count is required'],
    min: [0, 'Used count cannot be negative'],
    default: 0,
  },
  isActive: {
    type: Boolean,
    required: [true, 'Active status is required'],
    default: true,
    index: true,
  },
  terms: [{
    type: String,
    maxlength: [200, 'Each term cannot be more than 200 characters'],
  }],
  sourceUrl: {
    type: String,
    validate: {
      validator: function(v: string) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Please provide a valid URL',
    },
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
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
couponSchema.index({ platform: 1, code: 1 }, { unique: true });
couponSchema.index({ platform: 1, isActive: 1, validTill: -1 });
couponSchema.index({ categories: 1, isActive: 1 });
couponSchema.index({ validFrom: 1, validTill: 1 });

// Virtual for is valid
couponSchema.virtual('isValid').get(function() {
  const now = new Date();
  return (
    this.isActive &&
    this.validFrom <= now &&
    this.validTill >= now &&
    (!this.usageLimit || this.usedCount < this.usageLimit)
  );
});

// Virtual for days remaining
couponSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  const diff = this.validTill.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Pre-save middleware to validate dates
couponSchema.pre('save', function(next) {
  if (this.validFrom >= this.validTill) {
    return next(new Error('Valid from date must be before valid till date'));
  }
  next();
});

// Static method to get active coupons for platform
couponSchema.statics.getActiveCoupons = function(
  platform: string,
  category?: string,
  limit: number = 10
) {
  const now = new Date();
  const query: any = {
    platform,
    isActive: true,
    validFrom: { $lte: now },
    validTill: { $gte: now },
  };

  if (category) {
    query.categories = category;
  }

  return this.find(query)
    .sort({ discountValue: -1, validTill: 1 })
    .limit(limit);
};

// Static method to get best coupon for order
couponSchema.statics.getBestCouponForOrder = function(
  platform: string,
  orderValue: number,
  category?: string
) {
  const now = new Date();
  const query: any = {
    platform,
    isActive: true,
    validFrom: { $lte: now },
    validTill: { $gte: now },
    $or: [
      { minOrderValue: { $exists: false } },
      { minOrderValue: { $lte: orderValue } },
    ],
  };

  if (category) {
    query.categories = category;
  }

  return this.findOne(query).sort({ discountValue: -1 });
};

// Static method to get expiring coupons
couponSchema.statics.getExpiringCoupons = function(days: number = 7) {
  const now = new Date();
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  return this.find({
    isActive: true,
    validFrom: { $lte: now },
    validTill: { $gte: now, $lte: expiryDate },
  }).sort({ validTill: 1 });
};

// Instance method to calculate discount
couponSchema.methods.calculateDiscount = function(orderValue: number): number {
  if (!this.isValid || (this.minOrderValue && orderValue < this.minOrderValue)) {
    return 0;
  }

  let discount = 0;
  switch (this.discountType) {
    case 'percentage':
      discount = (orderValue * this.discountValue) / 100;
      if (this.maxDiscount) {
        discount = Math.min(discount, this.maxDiscount);
      }
      break;
    case 'fixed':
    case 'cashback':
      discount = this.discountValue;
      break;
    case 'free_shipping':
      // This would need to be calculated based on shipping cost
      discount = 0;
      break;
  }

  return Math.round(discount * 100) / 100; // Round to 2 decimal places
};

// Instance method to increment usage
couponSchema.methods.incrementUsage = function() {
  this.usedCount += 1;
  if (this.usageLimit && this.usedCount >= this.usageLimit) {
    this.isActive = false;
  }
  return this.save();
};

export const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema);