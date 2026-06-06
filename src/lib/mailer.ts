import pino from "pino";

const logger = pino({ name: "mailer" });

export interface MailerMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function sendStub(message: MailerMessage): void {
  logger.info(
    { to: message.to, subject: message.subject },
    "[stub mailer] Would send email — body logged below",
  );
  logger.debug({ body: message.text }, "[stub mailer] email body");
}

export function send(message: MailerMessage): void {
  sendStub(message);
}

export function sendVerificationEmail(to: string, token: string): void {
  const link = `${process.env["APP_URL"] ?? "http://localhost:4000"}/auth/email/verify?token=${encodeURIComponent(token)}`;
  send({
    to,
    subject: "Verify your email",
    text: `Click this link to verify your email: ${link}`,
    html: `<p>Click <a href="${link}">here</a> to verify your email.</p>`,
  });
}
