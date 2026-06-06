// Login-card image generation (research.md §6, Principle V).
//
// Renders a small PNG with the child's display name, username, and a credential
// *hint* (which method was set) — NEVER the raw password/PIN. Generation is
// best-effort and runs after the authoritative child create (FR-011), so this
// module only produces bytes; persistence/backfill is the caller's concern.

import { createCanvas } from "@napi-rs/canvas";

export interface LoginCardInput {
  displayName: string;
  username: string;
  /** Which credential the child uses — only the *kind* is shown, never the value. */
  credentialKind: "password" | "pin";
}

export interface RenderedCard {
  bytes: Buffer;
  contentType: string;
}

const WIDTH = 600;
const HEIGHT = 360;

export function renderLoginCard(child: LoginCardInput): RenderedCard {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Accent header bar
  ctx.fillStyle = "#6366f1";
  ctx.fillRect(0, 0, WIDTH, 72);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("Modrs.ai — Login Card", 32, 47);

  // Child display name
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText(child.displayName, 32, 150);

  // Username
  ctx.fillStyle = "#94a3b8";
  ctx.font = "22px sans-serif";
  ctx.fillText("Username", 32, 200);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(child.username, 32, 234);

  // Credential hint (kind only — never the secret, Principle V)
  const hint =
    child.credentialKind === "pin"
      ? "Sign in with your 4-digit PIN"
      : "Sign in with your password";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "20px sans-serif";
  ctx.fillText(hint, 32, 300);

  return { bytes: canvas.toBuffer("image/png"), contentType: "image/png" };
}
