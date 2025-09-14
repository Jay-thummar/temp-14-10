import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  _id: mongoose.Types.ObjectId;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  payload: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  processingTime?: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<IJob>({
  type: {
    type: String,
    required: [true, 'Job type is required'],
    enum: [
      'scrape_product',
      'scrape_search',
      'update_price_history',
      'send_price_alert',
      'process_watchlist',
      'cleanup_old_data',
      'generate_sitemap',
      'backup_database',
      'send_digest_email',
      'update_product_ratings',
      'sync_affiliate_data',
      'other'
    ],
    index: true,
  },
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  priority: {
    type: Number,
    required: [true, 'Priority is required'],
    min: [1, 'Priority must be at least 1'],
    max: [10, 'Priority cannot be more than 10'],
    default: 5,
    index: true,
  },
  payload: {
    type: Schema.Types.Mixed,
    required: [true, 'Payload is required'],
    default: {},
  },
  result: {
    type: Schema.Types.Mixed,
  },
  error: {
    type: String,
    maxlength: [2000, 'Error message cannot be more than 2000 characters'],
  },
  attempts: {
    type: Number,
    required: [true, 'Attempts is required'],
    min: [0, 'Attempts cannot be negative'],
    default: 0,
  },
  maxAttempts: {
    type: Number,
    required: [true, 'Max attempts is required'],
    min: [1, 'Max attempts must be at least 1'],
    default: 3,
  },
  nextRunAt: {
    type: Date,
    index: true,
  },
  startedAt: {
    type: Date,
  },
  completedAt: {
    type: Date,
  },
  processingTime: {
    type: Number,
    min: [0, 'Processing time cannot be negative'],
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
jobSchema.index({ status: 1, priority: -1, createdAt: 1 });
jobSchema.index({ type: 1, status: 1 });
jobSchema.index({ nextRunAt: 1, status: 1 });
jobSchema.index({ createdAt: -1 });

// TTL index to automatically delete completed jobs after 30 days
jobSchema.index(
  { completedAt: 1 },
  { 
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { status: { $in: ['completed', 'failed', 'cancelled'] } }
  }
);

// Virtual for duration
jobSchema.virtual('duration').get(function() {
  if (this.startedAt && this.completedAt) {
    return this.completedAt.getTime() - this.startedAt.getTime();
  }
  return null;
});

// Virtual for is running
jobSchema.virtual('isRunning').get(function() {
  return this.status === 'running';
});

// Virtual for can retry
jobSchema.virtual('canRetry').get(function() {
  return this.status === 'failed' && this.attempts < this.maxAttempts;
});

// Pre-save middleware to set nextRunAt for pending jobs
jobSchema.pre('save', function(next) {
  if (this.status === 'pending' && !this.nextRunAt) {
    this.nextRunAt = new Date();
  }
  next();
});

// Static method to get next job to process
jobSchema.statics.getNextJob = function(types?: string[]) {
  const query: any = {
    status: 'pending',
    nextRunAt: { $lte: new Date() },
  };

  if (types && types.length > 0) {
    query.type = { $in: types };
  }

  return this.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'running',
        startedAt: new Date(),
        attempts: { $inc: 1 },
      },
    },
    {
      sort: { priority: -1, createdAt: 1 },
      new: true,
    }
  );
};

// Static method to get job statistics
jobSchema.statics.getJobStats = function(hours: number = 24) {
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hours);

  return this.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          type: '$type',
          status: '$status',
        },
        count: { $sum: 1 },
        avgProcessingTime: { $avg: '$processingTime' },
        avgAttempts: { $avg: '$attempts' },
      },
    },
    {
      $group: {
        _id: '$_id.type',
        stats: {
          $push: {
            status: '$_id.status',
            count: '$count',
            avgProcessingTime: '$avgProcessingTime',
            avgAttempts: '$avgAttempts',
          },
        },
        totalJobs: { $sum: '$count' },
      },
    },
    { $sort: { totalJobs: -1 } },
  ]);
};

// Instance method to mark as completed
jobSchema.methods.markCompleted = function(result?: any) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.result = result;
  if (this.startedAt) {
    this.processingTime = this.completedAt.getTime() - this.startedAt.getTime();
  }
  return this.save();
};

// Instance method to mark as failed
jobSchema.methods.markFailed = function(error: string) {
  this.status = this.attempts >= this.maxAttempts ? 'failed' : 'pending';
  this.error = error;
  this.completedAt = new Date();
  
  // Set next run time for retry (exponential backoff)
  if (this.status === 'pending') {
    const delay = Math.pow(2, this.attempts) * 60 * 1000; // Exponential backoff in minutes
    this.nextRunAt = new Date(Date.now() + delay);
  }
  
  if (this.startedAt) {
    this.processingTime = this.completedAt.getTime() - this.startedAt.getTime();
  }
  
  return this.save();
};

// Instance method to retry job
jobSchema.methods.retry = function() {
  if (this.canRetry) {
    this.status = 'pending';
    this.nextRunAt = new Date();
    this.error = undefined;
    this.startedAt = undefined;
    this.completedAt = undefined;
    this.processingTime = undefined;
    return this.save();
  }
  throw new Error('Job cannot be retried');
};

export const Job = mongoose.model<IJob>('Job', jobSchema);