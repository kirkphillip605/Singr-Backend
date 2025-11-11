export type InvitationEmailTemplateInput = {
  organizationUserId: string;
  invitationToken: string | null;
  invitationBaseUrl: string;
  expiresAtIso?: string | null;
};

export type RenderedEmailTemplate = {
  subject: string;
  html: string;
  text: string;
  invitationUrl: string | null;
};

export function renderOrganizationInvitationEmail(
  input: InvitationEmailTemplateInput,
): RenderedEmailTemplate {
  const invitationUrl = buildInvitationUrl(input.invitationBaseUrl, input.invitationToken);
  const expiresText = input.expiresAtIso ? new Date(input.expiresAtIso).toLocaleString() : null;

  const subject = 'You have been invited to manage a Singr venue';
  const textBodyLines = [
    'Hello!',
    'You have been invited to join a Singr customer organization.',
  ];

  if (invitationUrl) {
    textBodyLines.push(`Accept your invite: ${invitationUrl}`);
  }

  if (expiresText) {
    textBodyLines.push(`This invitation expires on ${expiresText}.`);
  }

  textBodyLines.push('If you were not expecting this email you can safely ignore it.');

  const text = textBodyLines.join('\n\n');

  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2 style="color: #111827;">Singr Invitation</h2>
    <p>Hello!</p>
    <p>You have been invited to join a Singr customer organization.</p>
    ${
      invitationUrl
        ? `<p><a href="${invitationUrl}" style="background-color:#111827;color:#ffffff;padding:12px 18px;border-radius:4px;text-decoration:none;display:inline-block;">Accept invitation</a></p>`
        : ''
    }
    ${
      expiresText
        ? `<p style="color:#6b7280;font-size:14px;">This invitation expires on ${expiresText}.</p>`
        : ''
    }
    <p style="color:#6b7280;font-size:14px;">If you did not expect this invitation you can safely ignore this message.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:32px;" />
    <p style="color:#9ca3af;font-size:12px;">Invitation reference: ${input.organizationUserId}</p>
  </body>
</html>`;

  return {
    subject,
    html,
    text,
    invitationUrl,
  };
}

function buildInvitationUrl(baseUrl: string, token: string | null): string | null {
  if (!token) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  } catch {
    return null;
  }
}
