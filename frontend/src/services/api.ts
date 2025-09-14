import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { toast } from 'react-hot-toast';
import { ApiResponse, AuthResponse } from '@/types';

// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token management
class TokenManager {
  private static readonly ACCESS_TOKEN_KEY = 'shopcompare_access_token';
  private static readonly REFRESH_TOKEN_KEY = 'shopcompare_refresh_token';

  static getAccessToken(): string | null {
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  static getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  static setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  static clearTokens(): void {
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = TokenManager.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Add session ID for analytics
    const sessionId = sessionStorage.getItem('session_id') || 
                     crypto.randomUUID?.() || 
                     Math.random().toString(36).substring(2);
    sessionStorage.setItem('session_id', sessionId);
    config.headers['X-Session-ID'] = sessionId;
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for token refresh and error handling
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Handle 401 errors (token expired)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = TokenManager.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        TokenManager.setTokens(accessToken, newRefreshToken);

        // Retry original request
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        TokenManager.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Handle other errors
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.error || 
                        error.message || 
                        'An unexpected error occurred';

    // Don't show toast for certain errors
    const silentErrors = [401, 403, 404];
    if (!silentErrors.includes(error.response?.status || 0)) {
      toast.error(errorMessage);
    }

    return Promise.reject(error);
  }
);

// API service class
export class ApiService {
  // Generic GET request
  static async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await api.get<ApiResponse<T>>(url, config);
    return response.data.data as T;
  }

  // Generic POST request
  static async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await api.post<ApiResponse<T>>(url, data, config);
    return response.data.data as T;
  }

  // Generic PUT request
  static async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await api.put<ApiResponse<T>>(url, data, config);
    return response.data.data as T;
  }

  // Generic DELETE request
  static async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await api.delete<ApiResponse<T>>(url, config);
    return response.data.data as T;
  }

  // Generic PATCH request
  static async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await api.patch<ApiResponse<T>>(url, data, config);
    return response.data.data as T;
  }

  // Upload file
  static async uploadFile<T>(url: string, file: File, onProgress?: (progress: number) => void): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);

    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    };

    const response = await api.post<ApiResponse<T>>(url, formData, config);
    return response.data.data as T;
  }

  // Download file
  static async downloadFile(url: string, filename?: string): Promise<void> {
    const response = await api.get(url, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  // Health check
  static async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await axios.get(`${API_BASE_URL.replace('/api', '')}/health`);
    return response.data;
  }
}

// Auth specific methods
export class AuthService {
  static async login(credentials: { email: string; password: string }): Promise<AuthResponse> {
    const response = await api.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
    const authData = response.data.data!;
    
    TokenManager.setTokens(authData.accessToken, authData.refreshToken);
    return authData;
  }

  static async register(credentials: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  }): Promise<AuthResponse> {
    const response = await api.post<ApiResponse<AuthResponse>>('/auth/register', credentials);
    const authData = response.data.data!;
    
    TokenManager.setTokens(authData.accessToken, authData.refreshToken);
    return authData;
  }

  static async logout(): Promise<void> {
    const refreshToken = TokenManager.getRefreshToken();
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch (error) {
        // Ignore logout errors
      }
    }
    TokenManager.clearTokens();
  }

  static async refreshToken(): Promise<AuthResponse> {
    const refreshToken = TokenManager.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await api.post<ApiResponse<AuthResponse>>('/auth/refresh', {
      refreshToken,
    });
    
    const authData = response.data.data!;
    TokenManager.setTokens(authData.accessToken, authData.refreshToken);
    return authData;
  }

  static async getCurrentUser() {
    return ApiService.get('/auth/me');
  }

  static async forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email });
  }

  static async resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { token, password });
  }

  static async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.put('/auth/change-password', { currentPassword, newPassword });
  }

  static async verifyEmail(token: string): Promise<void> {
    await api.post('/auth/verify-email', { token });
  }

  static async sendEmailVerification(): Promise<void> {
    await api.post('/auth/send-verification');
  }

  static async sendPhoneVerification(): Promise<void> {
    await api.post('/auth/send-phone-verification');
  }

  static async verifyPhone(otp: string): Promise<void> {
    await api.post('/auth/verify-phone', { otp });
  }
}

// Error handling utilities
export const handleApiError = (error: any): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || 
           error.response?.data?.error || 
           error.message || 
           'An unexpected error occurred';
  }
  return error.message || 'An unexpected error occurred';
};

export const isNetworkError = (error: any): boolean => {
  return axios.isAxiosError(error) && !error.response;
};

export default api;