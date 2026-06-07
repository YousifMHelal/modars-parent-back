// Login-card image generation (research.md §6, Principle V).
//
// Renders a printable PNG with the child's display name, username, where to sign in,
// and a credential *hint* (which method was set) — NEVER the raw password/PIN.
// Generation is best-effort and runs after the authoritative child write (FR-011),
// so this module only produces bytes; persistence/backfill is the caller's concern.

import { createCanvas } from "@napi-rs/canvas";

export interface LoginCardInput {
  displayName: string;
  username: string;
  /** Which credential the child uses — only the *kind* is shown, never the value. */
  credentialKind: "password" | "pin";
  /** Where the child signs in (printed so a parent knows the destination). */
  signinUrl: string;
}

export interface RenderedCard {
  bytes: Buffer;
  contentType: string;
}

// A 4:3 card with a white print margin so it sits nicely on a printed page.
const WIDTH = 700;
const HEIGHT = 460;
const MARGIN = 24;
const CARD_X = MARGIN;
const CARD_Y = MARGIN;
const CARD_W = WIDTH - MARGIN * 2;
const CARD_H = HEIGHT - MARGIN * 2;
const PAD = 40; // inner content padding

// Palette
const PAGE_BG = "#ffffff";
const CARD_BG = "#0f172a";
const ACCENT = "#6366f1";
const TEXT_PRIMARY = "#f8fafc";
const TEXT_SECONDARY = "#94a3b8";
const TEXT_MUTED = "#64748b";
const PANEL_BG = "#1e293b";

function roundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderLoginCard(child: LoginCardInput): RenderedCard {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Page background (white print margin around the card).
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Card body
  ctx.fillStyle = CARD_BG;
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 20);
  ctx.fill();

  const contentX = CARD_X + PAD;
  const contentRight = CARD_X + CARD_W - PAD;

  // ── Header: brand mark + title ────────────────────────────────────────────
  const headerY = CARD_Y + PAD;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, contentX, headerY, 40, 40, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("M", contentX + 12, headerY + 21);

  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("Modrs.ai — Login Card", contentX + 56, headerY + 21);
  ctx.textBaseline = "alphabetic";

  // Divider under the header
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, headerY + 60);
  ctx.lineTo(contentRight, headerY + 60);
  ctx.stroke();

  // ── Child name ────────────────────────────────────────────────────────────
  let y = headerY + 92;
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(child.displayName, contentX, y);

  // ── Credentials panel: username + where/how to sign in ────────────────────
  y += 22;
  const panelH = 156;
  ctx.fillStyle = PANEL_BG;
  roundRect(ctx, contentX, y, CARD_W - PAD * 2, panelH, 14);
  ctx.fill();

  const px = contentX + 24;
  let py = y + 34;

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = "15px sans-serif";
  ctx.fillText("USERNAME", px, py);
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = "bold 28px monospace";
  ctx.fillText(child.username, px, py + 32);

  py += 72;
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = "15px sans-serif";
  ctx.fillText("SIGN IN AT", px, py);
  ctx.fillStyle = "#a5b4fc";
  ctx.font = "19px sans-serif";
  ctx.fillText(child.signinUrl, px, py + 26);

  // ── How-to / credential hint (kind only — never the secret, Principle V) ──
  const hint =
    child.credentialKind === "pin"
      ? "Enter the username above, then your 4-digit PIN."
      : "Enter the username above, then your password.";
  y += panelH + 30;
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = "16px sans-serif";
  ctx.fillText(hint, contentX, y);

  // Footer note
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = "14px sans-serif";
  ctx.fillText(
    "Keep this card safe. Your password/PIN is never shown here.",
    contentX,
    CARD_Y + CARD_H - 26,
  );

  return { bytes: canvas.toBuffer("image/png"), contentType: "image/png" };
}
