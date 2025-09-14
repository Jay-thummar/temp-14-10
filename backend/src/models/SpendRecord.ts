import mongoose, { Document, Schema } from 'mongoose';

export interface ISpendRecord extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  productMasterId?: mongoose.Types.ObjectId;
  platform: string;
  amount: number;
  currency: string;
  orderDate: Date;
  orderUrl?: string;
  orderId?: string;
  productTitle?: string;
  category?: string;
  paymentMethod?: string;
  status: 'pending' | 'confirmed' | 'delivered' | 'cancelled' | 'returned';
  notes?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const spendRecordSchema = new Schema<ISpendRecord>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  productMasterId: {
    type: Schema.Types.ObjectId,
    ref: 'ProductMaster',
    index: true,
  },
  platform: {
    type: String,
    required: [true, 'Platform is required'],
    enum: ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other'],
    lowercase: true,
    index: true,
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative'],
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    default: 'INR',
    uppercase: true,
  },
  orderDate: {
    type: Date,
    required: [true, 'Order date is required'],
    index: true,
  },
  orderUrl: {
    type: String,
    validate: {
      validator: function(v: string) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Please provide a valid URL',
    },
  },
  orderId: {
    type: String,
    trim: true,
    maxlength: [100, 'Order ID cannot be more than 100 characters'],
  },
  productTitle: {
    type: String,
    trim: true,
    maxlength: [300, 'Product title cannot be more than 300 characters'],
  },
  category: {
    type: String,
    trim: true,
    maxlength: [50, 'Category cannot be more than 50 characters'],
  },
  paymentMethod: {
    type: String,
    enum: ['credit_card', 'debit_card', 'upi', 'net_banking', 'wallet', 'cod', 'emi', 'other'],
    lowercase: true,
  },
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: ['pending', 'confirmed', 'delivered', 'cancelled', 'returned'],
    default: 'pending',
    index: true,
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot be more than 500 characters'],
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
spendRecordSchema.index({ userId: 1, orderDate: -1 });
spendRecordSchema.index({ userId: 1, platform: 1, orderDate: -1 });
spendRecordSchema.index({ userId: 1, status: 1 });
spendRecordSchema.index({ platform: 1, orderDate: -1 });

// Virtual for product details
spendRecordSchema.virtual('product', {
  ref: 'ProductMaster',
  localField: 'productMasterId',
  foreignField: '_id',
  justOne: true,
});

// Static method to get user's spending summary
spendRecordSchema.statics.getSpendingSummary = function(
  userId: string,
  startDate?: Date,
  endDate?: Date
) {
  const matchStage: any = {
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: ['confirmed', 'delivered'] },
  };

  if (startDate || endDate) {
    matchStage.orderDate = {};
    if (startDate) matchStage.orderDate.$gte = startDate;
    if (endDate) matchStage.orderDate.$lte = endDate;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$amount' },
        byPlatform: {
          $push: {
            platform: '$platform',
            amount: '$amount',
          },
        },
        byCategory: {
          $push: {
            category: '$category',
            amount: '$amount',
          },
        },
      },
    },
    {
      $addFields: {
        platformSummary: {
          $reduce: {
            input: '$byPlatform',
            initialValue: {},
            in: {
              $mergeObjects: [
                '$$value',
                {
                  $arrayToObject: [[{
                    k: '$$this.platform',
                    v: {
                      $add: [
                        { $ifNull: [{ $getField: { field: '$$this.platform', input: '$$value' } }, 0] },
                        '$$this.amount'
                      ]
                    }
                  }]]
                }
              ]
            }
          }
        },
      },
    },
    {
      $project: {
        byPlatform: 0,
        byCategory: 0,
      },
    },
  ]);
};

// Static method to get monthly spending trend
spendRecordSchema.statics.getMonthlySpendingTrend = function(
  userId: string,
  months: number = 12
) {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        orderDate: { $gte: startDate },
        status: { $in: ['confirmed', 'delivered'] },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$orderDate' },
          month: { $month: '$orderDate' },
        },
        totalAmount: { $sum: '$amount' },
        orderCount: { $sum: 1 },
        avgOrderValue: { $avg: '$amount' },
      },
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 },
    },
  ]);
};

// Static method to get platform-wise spending
spendRecordSchema.statics.getPlatformSpending = function(
  userId: string,
  startDate?: Date,
  endDate?: Date
) {
  const matchStage: any = {
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: ['confirmed', 'delivered'] },
  };

  if (startDate || endDate) {
    matchStage.orderDate = {};
    if (startDate) matchStage.orderDate.$gte = startDate;
    if (endDate) matchStage.orderDate.$lte = endDate;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$platform',
        totalAmount: { $sum: '$amount' },
        orderCount: { $sum: 1 },
        avgOrderValue: { $avg: '$amount' },
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);
};

export const SpendRecord = mongoose.model<ISpendRecord>('SpendRecord', spendRecordSchema);