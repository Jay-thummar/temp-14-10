import mongoose, { Document, Schema } from 'mongoose';

export interface ISearchLog extends Document {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  query: string;
  normalizedQuery: string;
  filters: Record<string, any>;
  resultsCount: number;
  latencyMs: number;
  platforms: string[];
  userAgent?: string;
  ipAddress?: string;
  sessionId?: string;
  timestamp: Date;
}

const searchLogSchema = new Schema<ISearchLog>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  query: {
    type: String,
    required: [true, 'Search query is required'],
    trim: true,
    maxlength: [200, 'Query cannot be more than 200 characters'],
  },
  normalizedQuery: {
    type: String,
    required: [true, 'Normalized query is required'],
    lowercase: true,
    trim: true,
    index: true,
  },
  filters: {
    type: Schema.Types.Mixed,
    default: {},
  },
  resultsCount: {
    type: Number,
    required: [true, 'Results count is required'],
    min: [0, 'Results count cannot be negative'],
  },
  latencyMs: {
    type: Number,
    required: [true, 'Latency is required'],
    min: [0, 'Latency cannot be negative'],
  },
  platforms: [{
    type: String,
    enum: ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other'],
    lowercase: true,
  }],
  userAgent: {
    type: String,
    maxlength: [500, 'User agent cannot be more than 500 characters'],
  },
  ipAddress: {
    type: String,
    validate: {
      validator: function(v: string) {
        return !v || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-fA-F:]+$/.test(v);
      },
      message: 'Please provide a valid IP address',
    },
  },
  sessionId: {
    type: String,
    index: true,
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: false, // We use custom timestamp field
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.ipAddress; // Don't expose IP in JSON
      return ret;
    },
  },
});

// Indexes
searchLogSchema.index({ timestamp: -1 });
searchLogSchema.index({ userId: 1, timestamp: -1 });
searchLogSchema.index({ normalizedQuery: 1, timestamp: -1 });
searchLogSchema.index({ platforms: 1 });

// TTL index to automatically delete old search logs (keep 3 months)
searchLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Static method to get popular searches
searchLogSchema.statics.getPopularSearches = function(days: number = 7, limit: number = 10) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { timestamp: { $gte: startDate } } },
    {
      $group: {
        _id: '$normalizedQuery',
        count: { $sum: 1 },
        avgLatency: { $avg: '$latencyMs' },
        avgResults: { $avg: '$resultsCount' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
};

// Static method to get user's search history
searchLogSchema.statics.getUserSearchHistory = function(userId: string, limit: number = 20) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('query filters resultsCount timestamp');
};

// Static method to get search analytics
searchLogSchema.statics.getSearchAnalytics = function(days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { timestamp: { $gte: startDate } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        },
        totalSearches: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        avgLatency: { $avg: '$latencyMs' },
        avgResults: { $avg: '$resultsCount' },
      },
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' },
      },
    },
    {
      $project: {
        uniqueUsers: 0, // Remove the array, keep only the count
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);
};

export const SearchLog = mongoose.model<ISearchLog>('SearchLog', searchLogSchema);