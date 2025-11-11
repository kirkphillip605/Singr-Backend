import nodemailer from 'nodemailer';

import type { AppConfig } from '../../config';
import type { AppLogger } from '../../lib/logger';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
  close(): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  constructor(private readonly logger: AppLogger) {}

  async send(message: EmailMessage): Promise<void> {
    this.logger.info(
      {
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      'Email message logged (console provider)',
    );
  }

  async close(): Promise<void> {
    // no-op
  }
}

class SmtpEmailProvider implements EmailProvider {
  private readonly transporter = nodemailer.createTransport({
    host: this.options.host,
    port: this.options.port,
    secure: this.options.secure,
    auth:
      this.options.username && this.options.password
        ? { user: this.options.username, pass: this.options.password }
        : undefined,
  });

  constructor(
    private readonly options: {
      host: string;
      port: number;
      secure: boolean;
      username: string | null;
      password: string | null;
      fromAddress: string;
      fromName: string;
    },
    private readonly logger: AppLogger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: {
        name: this.options.fromName,
        address: this.options.fromAddress,
      },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  async close(): Promise<void> {
    if (typeof (this.transporter as { close?: () => void }).close === 'function') {
      try {
        await (this.transporter as unknown as { close: () => Promise<void> | void }).close();
      } catch (error) {
        this.logger.warn({ err: error }, 'Failed to close SMTP transporter');
      }
    }
  }
}

export function createEmailProvider(config: AppConfig, logger: AppLogger): EmailProvider {
  if (config.email.provider === 'smtp' && config.email.smtp) {
    return new SmtpEmailProvider(
      {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        username: config.email.smtp.username,
        password: config.email.smtp.password,
        fromAddress: config.email.fromAddress,
        fromName: config.email.fromName,
      },
      logger,
    );
  }

  return new ConsoleEmailProvider(logger);
}
