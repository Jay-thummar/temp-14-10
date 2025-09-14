import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

export interface EmailOptions {
  to: string;
  subject: string;
  template: string;
  data: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private templates: Map<string, (data: any) => { html: string; text: string }>;

  constructor() {
    this.templates = new Map();
    this.setupTransporter();
    this.loadTemplates();
  }

  private setupTransporter() {
    // Configure based on environment
    if (process.env.NODE_ENV === 'production') {
      // Use SendGrid in production
      this.transporter = nodemailer.createTransporter({
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY!,
        },
      });
    } else {
      // Use Ethereal for development/testing
      this.transporter = nodemailer.createTransporter({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass',
        },
      });
    }
  }

  private loadTemplates() {
    // Welcome email template
    this.templates.set('welcome', (data) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to ShopCompare</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; }
            .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ShopCompare!</h1>
            </div>
            <div class="content">
              <h2>Hi ${data.name},</h2>
              <p>Welcome to ShopCompare - your ultimate shopping companion! We're excited to have you on board.</p>
              <p>With ShopCompare, you can:</p>
              <ul>
                <li>🔍 Search across multiple e-commerce platforms</li>
                <li>💰 Track price changes and get alerts</li>
                <li>📊 View price history and trends</li>
                <li>👀 Create watchlists for your favorite products</li>
                <li>💳 Track your spending across platforms</li>
              </ul>
              <p>Ready to start saving money on your purchases?</p>
              <a href="${data.loginUrl}" class="button">Get Started</a>
              <p>If you have any questions, feel free to reach out to our support team.</p>
              <p>Happy shopping!</p>
              <p>The ShopCompare Team</p>
            </div>
            <div class="footer">
              <p>© 2024 ShopCompare. All rights reserved.</p>
              <p>You received this email because you signed up for a ShopCompare account.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to ShopCompare!
        
        Hi ${data.name},
        
        Welcome to ShopCompare - your ultimate shopping companion! We're excited to have you on board.
        
        With ShopCompare, you can:
        - Search across multiple e-commerce platforms
        - Track price changes and get alerts
        - View price history and trends
        - Create watchlists for your favorite products
        - Track your spending across platforms
        
        Ready to start saving money on your purchases? Visit: ${data.loginUrl}
        
        If you have any questions, feel free to reach out to our support team.
        
        Happy shopping!
        The ShopCompare Team
      `,
    }));

    // Email verification template
    this.templates.set('email-verification', (data) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Verify Your Email</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; }
            .button { display: inline-block; background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Verify Your Email</h1>
            </div>
            <div class="content">
              <h2>Hi ${data.name},</h2>
              <p>Thank you for signing up with ShopCompare! To complete your registration, please verify your email address.</p>
              <p>Click the button below to verify your email:</p>
              <a href="${data.verificationUrl}" class="button">Verify Email</a>
              <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
              <p><a href="${data.verificationUrl}">${data.verificationUrl}</a></p>
              <p>This verification link will expire in 1 hour.</p>
              <p>If you didn't create an account with ShopCompare, please ignore this email.</p>
              <p>Best regards,<br>The ShopCompare Team</p>
            </div>
            <div class="footer">
              <p>© 2024 ShopCompare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Verify Your Email
        
        Hi ${data.name},
        
        Thank you for signing up with ShopCompare! To complete your registration, please verify your email address.
        
        Visit this link to verify your email: ${data.verificationUrl}
        
        This verification link will expire in 1 hour.
        
        If you didn't create an account with ShopCompare, please ignore this email.
        
        Best regards,
        The ShopCompare Team
      `,
    }));

    // Password reset template
    this.templates.set('password-reset', (data) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Reset Your Password</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; }
            .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #666; }
            .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Reset Your Password</h1>
            </div>
            <div class="content">
              <h2>Hi ${data.name},</h2>
              <p>We received a request to reset your password for your ShopCompare account.</p>
              <p>Click the button below to reset your password:</p>
              <a href="${data.resetUrl}" class="button">Reset Password</a>
              <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
              <p><a href="${data.resetUrl}">${data.resetUrl}</a></p>
              <div class="warning">
                <p><strong>Security Notice:</strong></p>
                <ul>
                  <li>This password reset link will expire in 10 minutes</li>
                  <li>If you didn't request a password reset, please ignore this email</li>
                  <li>Your password will remain unchanged unless you click the link above</li>
                </ul>
              </div>
              <p>If you're having trouble with your account, please contact our support team.</p>
              <p>Best regards,<br>The ShopCompare Team</p>
            </div>
            <div class="footer">
              <p>© 2024 ShopCompare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Reset Your Password
        
        Hi ${data.name},
        
        We received a request to reset your password for your ShopCompare account.
        
        Visit this link to reset your password: ${data.resetUrl}
        
        Security Notice:
        - This password reset link will expire in 10 minutes
        - If you didn't request a password reset, please ignore this email
        - Your password will remain unchanged unless you click the link above
        
        If you're having trouble with your account, please contact our support team.
        
        Best regards,
        The ShopCompare Team
      `,
    }));

    // Price alert template
    this.templates.set('price-alert', (data) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Price Drop Alert!</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #16a34a; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; }
            .product { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .price { font-size: 24px; font-weight: bold; color: #16a34a; }
            .old-price { text-decoration: line-through; color: #6b7280; margin-right: 10px; }
            .button { display: inline-block; background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Price Drop Alert!</h1>
            </div>
            <div class="content">
              <h2>Hi ${data.name},</h2>
              <p>Great news! The price has dropped for a product on your watchlist:</p>
              <div class="product">
                <h3>${data.productTitle}</h3>
                <p><strong>Platform:</strong> ${data.platform}</p>
                <p class="price">
                  <span class="old-price">₹${data.oldPrice}</span>
                  ₹${data.newPrice}
                </p>
                <p><strong>You save:</strong> ₹${data.savings} (${data.discountPercentage}%)</p>
                <a href="${data.productUrl}" class="button">View Product</a>
              </div>
              <p>Don't wait too long - prices can change quickly!</p>
              <p>Happy shopping!</p>
              <p>The ShopCompare Team</p>
            </div>
            <div class="footer">
              <p>© 2024 ShopCompare. All rights reserved.</p>
              <p>You can manage your watchlist and alert preferences in your account settings.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Price Drop Alert!
        
        Hi ${data.name},
        
        Great news! The price has dropped for a product on your watchlist:
        
        Product: ${data.productTitle}
        Platform: ${data.platform}
        Old Price: ₹${data.oldPrice}
        New Price: ₹${data.newPrice}
        You save: ₹${data.savings} (${data.discountPercentage}%)
        
        View Product: ${data.productUrl}
        
        Don't wait too long - prices can change quickly!
        
        Happy shopping!
        The ShopCompare Team
      `,
    }));
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const template = this.templates.get(options.template);
      if (!template) {
        throw new Error(`Email template '${options.template}' not found`);
      }

      const { html, text } = template(options.data);

      const mailOptions = {
        from: `ShopCompare <${process.env.FROM_EMAIL || 'noreply@shopcompare.com'}>`,
        to: options.to,
        subject: options.subject,
        html,
        text,
        attachments: options.attachments,
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Email sent successfully to ${options.to}`, {
        messageId: info.messageId,
        template: options.template,
      });

      // Log preview URL for development
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (error) {
      logger.error('Failed to send email:', error);
      throw error;
    }
  }

  async sendBulkEmail(recipients: string[], options: Omit<EmailOptions, 'to'>): Promise<void> {
    const promises = recipients.map(recipient =>
      this.sendEmail({ ...options, to: recipient })
    );

    try {
      await Promise.all(promises);
      logger.info(`Bulk email sent to ${recipients.length} recipients`);
    } catch (error) {
      logger.error('Failed to send bulk email:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Export convenience function
export const sendEmail = (options: EmailOptions): Promise<void> => {
  return emailService.sendEmail(options);
};