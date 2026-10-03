import { sendSmtpMail, smtpConfigured } from "../notify/smtp.js";

const APP_NAME = process.env.APP_NAME?.trim() || "Par HR";

export async function sendLoginOtpEmail(to: string, code: string, expiresMinutes: number): Promise<void> {
  const result = await sendSmtpMail({
    to,
    subject: `${APP_NAME} login code: ${code}`,
    body: [
      `Your ${APP_NAME} login verification code is: ${code}`,
      "",
      `This code expires in ${expiresMinutes} minutes.`,
      "If you did not try to sign in, contact HR immediately.",
      "",
      "- HR Team",
    ].join("\n"),
    bccHr: false,
  });
  if (result.skipped) {
    console.log(`[auth] login OTP for ${to}: ${code}`);
  }
  if (!smtpConfigured() && !result.skipped) {
    console.warn(`[auth] SMTP not configured - login OTP for ${to}: ${code}`);
  }
}

export async function sendPasswordResetEmail(to: string, code: string, expiresMinutes: number): Promise<void> {
  const result = await sendSmtpMail({
    to,
    subject: `${APP_NAME} password reset code: ${code}`,
    body: [
      `Your ${APP_NAME} password reset code is: ${code}`,
      "",
      `This code expires in ${expiresMinutes} minutes.`,
      "If you did not request a reset, ignore this email or contact HR.",
      "",
      "- HR Team",
    ].join("\n"),
    bccHr: false,
  });
  if (result.skipped) {
    console.log(`[auth] password reset OTP for ${to}: ${code}`);
  }
}

export async function sendAccountSetupEmail(input: {
  to: string;
  name: string;
  code: string;
  setupUrl: string;
  expiresMinutes: number;
}): Promise<void> {
  const result = await sendSmtpMail({
    to: input.to,
    subject: `Set up your ${APP_NAME} password`,
    body: [
      `Hi ${input.name},`,
      "",
      `Your HR dashboard account is ready.`,
      "",
      `1. Open: ${input.setupUrl}`,
      `2. Enter this code: ${input.code}`,
      "3. Choose your password (at least 8 characters)",
      "",
      `The code expires in ${input.expiresMinutes} minutes.`,
      "",
      "After that, sign in with your password - we will send a verification code to this email each time.",
      "",
      "- HR Team",
    ].join("\n"),
    bccHr: false,
  });
  if (result.skipped) {
    console.log(`[auth] account setup for ${input.to}: code=${input.code} url=${input.setupUrl}`);
  }
}

export async function sendWelcomeEmail(input: {
  to: string;
  name: string;
  role: string;
  temporaryPassword?: string;
}): Promise<void> {
  const loginUrl = process.env.APP_LOGIN_URL?.trim() || "http://localhost:5173/login";
  const lines = [
    `Hi ${input.name},`,
    "",
    `An ${APP_NAME} account has been created for you.`,
    `Role: ${input.role}`,
    `Sign in at: ${loginUrl}`,
    "",
    "You will enter your password, then a verification code sent to this email.",
  ];
  if (input.temporaryPassword) {
    lines.push("", `Temporary password: ${input.temporaryPassword}`, "You will be asked to change it after signing in.");
  }
  lines.push("", "- HR Team");

  const result = await sendSmtpMail({
    to: input.to,
    subject: `Welcome to ${APP_NAME}`,
    body: lines.join("\n"),
    bccHr: false,
  });
  if (result.skipped) {
    console.log(`[auth] welcome email skipped for ${input.to}`);
  }
}
