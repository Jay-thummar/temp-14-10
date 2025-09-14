import twilio from 'twilio';
import { logger } from '../utils/logger';

export interface SMSOptions {
  to: string;
  message: string;
}

class SMSService {
  private client: twilio.Twilio | null = null;
  private fromNumber: string;

  constructor() {
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
    
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    } else {
      logger.warn('Twilio credentials not found. SMS functionality will be disabled.');
    }
  }

  async sendSMS(options: SMSOptions): Promise<void> {
    if (!this.client) {
      if (process.env.NODE_ENV === 'development') {
        // In development, just log the SMS instead of sending
        logger.info(`SMS would be sent to ${options.to}: ${options.message}`);
        return;
      } else {
        throw new Error('SMS service is not configured');
      }
    }

    try {
      // Format phone number (ensure it starts with +)
      let phoneNumber = options.to.trim();
      if (!phoneNumber.startsWith('+')) {
        // Assume Indian number if no country code
        phoneNumber = '+91' + phoneNumber.replace(/^0/, '');
      }

      const message = await this.client.messages.create({
        body: options.message,
        from: this.fromNumber,
        to: phoneNumber,
      });

      logger.info(`SMS sent successfully to ${options.to}`, {
        messageId: message.sid,
        status: message.status,
      });
    } catch (error: any) {
      logger.error('Failed to send SMS:', {
        error: error.message,
        to: options.to,
        code: error.code,
      });
      throw new Error(`Failed to send SMS: ${error.message}`);
    }
  }

  async sendBulkSMS(recipients: string[], message: string): Promise<void> {
    const promises = recipients.map(recipient =>
      this.sendSMS({ to: recipient, message })
    );

    try {
      await Promise.allSettled(promises);
      logger.info(`Bulk SMS sent to ${recipients.length} recipients`);
    } catch (error) {
      logger.error('Failed to send bulk SMS:', error);
      throw error;
    }
  }

  // Send OTP SMS
  async sendOTP(phoneNumber: string, otp: string): Promise<void> {
    const message = `Your ShopCompare verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;
    await this.sendSMS({ to: phoneNumber, message });
  }

  // Send price alert SMS
  async sendPriceAlert(phoneNumber: string, productTitle: string, newPrice: number, platform: string): Promise<void> {
    const message = `🎉 Price Drop Alert! ${productTitle} is now ₹${newPrice} on ${platform}. Check ShopCompare app for details.`;
    await this.sendSMS({ to: phoneNumber, message });
  }

  // Send order confirmation SMS
  async sendOrderConfirmation(phoneNumber: string, orderId: string, amount: number): Promise<void> {
    const message = `Order confirmed! Order ID: ${orderId}, Amount: ₹${amount}. Track your order on ShopCompare app.`;
    await this.sendSMS({ to: phoneNumber, message });
  }

  // Check if SMS service is available
  isAvailable(): boolean {
    return this.client !== null;
  }
}

// Export singleton instance
export const smsService = new SMSService();

// Export convenience function
export const sendSMS = (options: SMSOptions): Promise<void> => {
  return smsService.sendSMS(options);
};