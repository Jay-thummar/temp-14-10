import mongoose, { Document, Schema } from 'mongoose';

export interface IProductMaster extends Document {
  _id: mongoose.Types.ObjectId;
  canonicalTitle: string;
  brand: string;
  category: string;
  subcategory?: string;
  description: string;
  images: string[];
  specifications: Record<string, any>;
  normalizedKeys: string[];
  aliases: string[];
  tags: string[];
  averageRating?: number;
  totalReviews?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productMasterSchema = new Schema<IProductMaster>({
  canonicalTitle: {
    type: String,
    required: [true, 'Canonical title is required'],
    trim: true,
    maxlength: [200, 'Title cannot be more than 200 characters'],
  },
  brand: {
    type: String,
    required: [true, 'Brand is required'],
    trim: true,
    maxlength: [50, 'Brand cannot be more than 50 characters'],
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    maxlength: [50, 'Category cannot be more than 50 characters'],
  },
  subcategory: {
    type: String,
    trim: true,
    maxlength: [50, 'Subcategory cannot be more than 50 characters'],
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [2000, 'Description cannot be more than 2000 characters'],
  },
  images: [{
    type: String,
    validate: {
      validator: function(v: string) {
        return /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(v);
      },
      message: 'Please provide a valid image URL',
    },
  }],
  specifications: {
    type: Schema.Types.Mixed,
    default: {},
  },
  normalizedKeys: [{
    type: String,
    lowercase: true,
    trim: true,
  }],
  aliases: [{
    type: String,
    trim: true,
  }],
  tags: [{
    type: String,
    lowercase: true,
    trim: true,
  }],
  averageRating: {
    type: Number,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5'],
  },
  totalReviews: {
    type: Number,
    min: [0, 'Total reviews cannot be negative'],
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
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

// Indexes
productMasterSchema.index({ canonicalTitle: 'text', brand: 'text', description: 'text' });
productMasterSchema.index({ brand: 1 });
productMasterSchema.index({ category: 1, subcategory: 1 });
productMasterSchema.index({ normalizedKeys: 1 });
productMasterSchema.index({ tags: 1 });
productMasterSchema.index({ isActive: 1 });
productMasterSchema.index({ createdAt: -1 });
productMasterSchema.index({ averageRating: -1 });

// Virtual for platform items
productMasterSchema.virtual('platformItems', {
  ref: 'PlatformItem',
  localField: '_id',
  foreignField: 'productMasterId',
});

// Static method to search products
productMasterSchema.statics.searchProducts = function(
  query: string,
  filters: any = {},
  options: any = {}
) {
  const searchQuery: any = {
    isActive: true,
    ...filters,
  };

  if (query) {
    searchQuery.$text = { $search: query };
  }

  return this.find(searchQuery)
    .sort(options.sort || { score: { $meta: 'textScore' }, createdAt: -1 })
    .limit(options.limit || 20)
    .skip(options.skip || 0)
    .populate('platformItems');
};

export const ProductMaster = mongoose.model<IProductMaster>('ProductMaster', productMasterSchema);