// API Response types
export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  error?: string;
}

// User types
export interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  roles: string[];
  preferences: UserPreferences;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  language: 'en' | 'gu';
  currency: string;
  theme: 'light' | 'dark' | 'system';
  notifications: {
    email: boolean;
    push: boolean;
    digest: 'daily' | 'weekly' | 'none';
  };
  platforms: string[];
}

// Auth types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// Product types
export interface ProductMaster {
  _id: string;
  canonicalTitle: string;
  brand: string;
  category: string;
  subcategory?: string;
  description: string;
  images: string[];
  specifications: Record<string, any>;
  averageRating?: number;
  totalReviews: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformItem {
  platform: string;
  sku: string;
  title: string;
  price: number;
  originalPrice?: number;
  currency: string;
  discount?: number;
  url: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  stockStatus: 'in_stock' | 'out_of_stock' | 'limited_stock' | 'preorder';
  shipping: {
    cost: number;
    currency: string;
    estimatedDays: number;
    isFree: boolean;
  };
  couponMeta: {
    available: boolean;
    codes: string[];
    description?: string;
    maxDiscount?: number;
  };
  specifications?: Record<string, any>;
  lastScrapedAt: string;
}

export interface SearchResult {
  masterId?: string;
  canonicalTitle: string;
  brand: string;
  category: string;
  subcategory?: string;
  images: string[];
  cheapestPrice: {
    platform: string;
    price: number;
    currency: string;
    url: string;
  };
  platforms: PlatformItem[];
  averageRating?: number;
  totalReviews: number;
  similarity?: number;
  metadata: {
    searchedAt: string;
    resultsCount: number;
    platforms: string[];
  };
}

export interface SearchOptions {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'relevance' | 'price_low' | 'price_high' | 'rating' | 'newest';
  page?: number;
  limit?: number;
  platforms?: string[];
}

export interface SearchMetadata {
  query: string;
  totalResults: number;
  platforms: string[];
  latencyMs: number;
  cached: boolean;
}

// Price history types
export interface PriceHistoryPoint {
  date: string;
  platform: string;
  price: number;
  currency: string;
}

// Watchlist types
export interface WatchlistItem {
  _id: string;
  userId: string;
  productMasterId: string;
  targetPrice?: number;
  currency: string;
  platformPreferences: string[];
  alertFrequency: 'instant' | 'daily' | 'weekly';
  isEnabled: boolean;
  lastAlertSent?: string;
  alertCount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  product?: ProductMaster;
}

// Spend tracking types
export interface SpendRecord {
  _id: string;
  userId: string;
  productMasterId?: string;
  platform: string;
  amount: number;
  currency: string;
  orderDate: string;
  orderUrl?: string;
  orderId?: string;
  productTitle?: string;
  category?: string;
  paymentMethod?: string;
  status: 'pending' | 'confirmed' | 'delivered' | 'cancelled' | 'returned';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  product?: ProductMaster;
}

export interface SpendingSummary {
  totalAmount: number;
  totalOrders: number;
  avgOrderValue: number;
  platformSummary: Record<string, number>;
}

export interface SpendingTrend {
  _id: {
    year: number;
    month: number;
  };
  totalAmount: number;
  orderCount: number;
  avgOrderValue: number;
}

// Search suggestions
export interface SearchSuggestion {
  query: string;
  category?: string;
  popularity: number;
}

// Platform types
export type Platform = 'amazon' | 'flipkart' | 'myntra' | 'snapdeal' | 'paytm' | 'nykaa' | 'ajio';

export const PLATFORMS: Record<Platform, { name: string; color: string; icon: string }> = {
  amazon: { name: 'Amazon', color: '#ff9900', icon: '/icons/amazon.svg' },
  flipkart: { name: 'Flipkart', color: '#2874f0', icon: '/icons/flipkart.svg' },
  myntra: { name: 'Myntra', color: '#ff3e6c', icon: '/icons/myntra.svg' },
  snapdeal: { name: 'Snapdeal', color: '#e60012', icon: '/icons/snapdeal.svg' },
  paytm: { name: 'Paytm', color: '#00baf2', icon: '/icons/paytm.svg' },
  nykaa: { name: 'Nykaa', color: '#fc2779', icon: '/icons/nykaa.svg' },
  ajio: { name: 'Ajio', color: '#d4af37', icon: '/icons/ajio.svg' },
};

// Error types
export interface AppError {
  message: string;
  status?: number;
  code?: string;
}

// Theme types
export type ThemeMode = 'light' | 'dark' | 'system';

// Notification types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Filter types
export interface PriceFilter {
  min?: number;
  max?: number;
}

export interface CategoryFilter {
  category?: string;
  subcategory?: string;
}

export interface PlatformFilter {
  platforms: string[];
}

export interface SortOption {
  value: SearchOptions['sortBy'];
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
  { value: 'rating', label: 'Customer Rating' },
  { value: 'newest', label: 'Newest First' },
];

// Admin types
export interface AdminStats {
  users: {
    total: number;
    active: number;
  };
  products: {
    total: number;
    platformItems: number;
    platformBreakdown: Array<{
      _id: string;
      count: number;
    }>;
  };
  activity: {
    searchesLast24h: number;
  };
  jobs: Array<{
    _id: string;
    stats: Array<{
      status: string;
      count: number;
      avgProcessingTime: number;
      avgAttempts: number;
    }>;
    totalJobs: number;
  }>;
  connectors: Array<{
    platform: string;
    enabled: boolean;
  }>;
}

// Form types
export interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

// Local storage keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'shopcompare_auth_token',
  REFRESH_TOKEN: 'shopcompare_refresh_token',
  USER_PREFERENCES: 'shopcompare_user_preferences',
  SEARCH_HISTORY: 'shopcompare_search_history',
  THEME: 'shopcompare_theme',
  LANGUAGE: 'shopcompare_language',
} as const;