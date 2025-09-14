import mongoose, { Document, Schema } from 'mongoose';

export interface IPlatformItem extends Document {
  _id: mongoose.Types.ObjectId;
  productMasterId: mongoose.Types.ObjectId;
  platform: string;
  platformSku: string;
  title: string;
  price: number;
  originalPrice?: number;
  currency: string;
  discount?: number;
  shipping: {
    cost: number;
    currency: string;
    estimatedDays: number;
    isFree: boolean;
  };
  stockStatus: 'in_stock' | 'out_of_stock' | 'limited_stock' | 'preorder';
  productUrl: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  couponMeta: {
    available: boolean;
    codes: string[];
    maxDiscount?: number;
    description?: string;
  };
  specifications: Record<string, any>;
  lastScrapedAt: Date;
  isActive: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const platformItemSchema = new Schema<IPlatformItem>({
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
  platformSku: {
    type: String,
    required: [true, 'Platform SKU is required'],
    trim: true,
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [300, 'Title cannot be more than 300 characters'],
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
  discount: {
    type: Number,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot be more than 100%'],
  },
  shipping: {
    cost: {
      type: Number,
      required: true,
      min: [0, 'Shipping cost cannot be negative'],
      default: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
    },
    estimatedDays: {
      type: Number,
      required: true,
      min: [0, 'Estimated delivery days cannot be negative'],
      default: 7,
    },
    isFree: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  stockStatus: {
    type: String,
    required: [true, 'Stock status is required'],
    enum: ['in_stock', 'out_of_stock', 'limited_stock', 'preorder'],
    default: 'in_stock',
  },
  productUrl: {
    type: String,
    required: [true, 'Product URL is required'],
    validate: {
      validator: function(v: string) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'Please provide a valid URL',
    },
  },
  imageUrl: {
    type: String,
    validate: {
      validator: function(v: string) {
        return !v || /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(v);
      },
      message: 'Please provide a valid image URL',
    },
  },
  rating: {
    type: Number,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5'],
  },
  reviewCount: {
    type: Number,
    min: [0, 'Review count cannot be negative'],
    default: 0,
  },
  couponMeta: {
    available: {
      type: Boolean,
      required: true,
      default: false,
    },
    codes: [{
      type: String,
      uppercase: true,
      trim: true,
    }],
    maxDiscount: {
      type: Number,
      min: [0, 'Max discount cannot be negative'],
    },
    description: {
      type: String,
      maxlength: [200, 'Coupon description cannot be more than 200 characters'],
    },
  },
  specifications: {
    type: Schema.Types.Mixed,
    default: {},
  },
  lastScrapedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
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
platformItemSchema.index({ platform: 1, platformSku: 1 }, { unique: true });
platformItemSchema.index({ productMasterId: 1, platform: 1 });
platformItemSchema.index({ platform: 1, price: 1 });
platformItemSchema.index({ stockStatus: 1, isActive: 1 });
platformItemSchema.index({ lastScrapedAt: -1 });
platformItemSchema.index({ createdAt: -1 });

// Virtual for total price (including shipping)
platformItemSchema.virtual('totalPrice').get(function() {
  return this.price + (this.shipping.isFree ? 0 : this.shipping.cost);
});

// Virtual for discount percentage
platformItemSchema.virtual('discountPercentage').get(function() {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  return this.discount || 0;
});

// Static method to find cheapest item for a product
platformItemSchema.statics.findCheapest = function(productMasterId: string, platforms?: string[]) {
  const query: any = {
    productMasterId,
    isActive: true,
    stockStatus: { $in: ['in_stock', 'limited_stock'] },
  };

  if (platforms && platforms.length > 0) {
    query.platform = { $in: platforms };
  }

  return this.findOne(query).sort({ price: 1 });
};

// Static method to get price range for a product
platformItemSchema.statics.getPriceRange = function(productMasterId: string, platforms?: string[]) {
  const matchStage: any = {
    productMasterId: new mongoose.Types.ObjectId(productMasterId),
    isActive: true,
    stockStatus: { $in: ['in_stock', 'limited_stock'] },
  };

  if (platforms && platforms.length > 0) {
    matchStage.platform = { $in: platforms };
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$productMasterId',
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
        avgPrice: { $avg: '$price' },
        count: { $sum: 1 },
      },
    },
  ]);
};

export const PlatformItem = mongoose.model<IPlatformItem>('PlatformItem', platformItemSchema);