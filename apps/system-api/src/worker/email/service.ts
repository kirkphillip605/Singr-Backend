import type { AppConfig } from '../../config';
import type { AppLogger } from '../../lib/logger';
import type { InvitationJob } from '../../queues/producers';
import type { EmailProvider } from './provider';
import { renderOrganizationInvitationEmail } from './templates';

export class EmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async sendOrganizationInvitation(job: InvitationJob): Promise<void> {
    if (!job.email) {
      this.logger.warn({ job }, 'Skipping invitation email because no email address was provided');
      return;
    }

    const template = renderOrganizationInvitationEmail({
      organizationUserId: job.organizationUserId,
      invitationToken: job.invitationToken,
      invitationBaseUrl: this.config.organization.invitationBaseUrl,
      expiresAtIso: job.invitationExpiresAt,
    });

    if (this.config.email.logEmails) {
      this.logger.info(
        {
          to: job.email,
          subject: template.subject,
          invitationUrl: template.invitationUrl,
          expiresAt: job.invitationExpiresAt,
        },
        'Dispatching organization invitation email',
      );
    }

    await this.provider.send({
      to: job.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  async close(): Promise<void> {
    await this.provider.close();
  }
}
