import type { Request, Response, NextFunction } from "express";
import * as authService from "./auth.service.js";

// ── US1: Parent auth ──────────────────────────────────────────────────────────

export async function registerParent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as {
      familyName: string;
      fullName: string;
      email: string;
      password: string;
      dob: string;
      country?: string;
    };

    const tokens = await authService.registerParent({
      familyName: body.familyName,
      fullName: body.fullName,
      email: body.email,
      password: body.password,
      dob: new Date(body.dob),
      ...(body.country !== undefined ? { country: body.country } : {}),
    });

    res.status(201).json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function loginParent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { email: string; password: string; deviceLabel?: string };
    const tokens = await authService.loginParent({
      email: body.email,
      password: body.password,
      ...(body.deviceLabel !== undefined ? { deviceLabel: body.deviceLabel } : {}),
    });
    res.status(200).json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokens = await authService.rotateRefresh(refreshToken);
    res.status(200).json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sid = req.principal?.sid;
    if (sid) await authService.logout(sid);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = req.principal!;
    const me = await authService.getMe(principal.id, principal.type);
    res.status(200).json({ data: me });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.query as { token: string };
    await authService.verifyEmail(token);
    res.status(200).json({ data: { message: "Email verified" } });
  } catch (err) {
    next(err);
  }
}

// ── US2: Child auth ───────────────────────────────────────────────────────────

export async function loginChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      username: string;
      password?: string;
      pin?: string;
      deviceLabel?: string;
    };

    const tokens = await authService.loginChild({
      username: body.username,
      ...(body.password !== undefined ? { password: body.password } : {}),
      ...(body.pin !== undefined ? { pin: body.pin } : {}),
      ...(body.deviceLabel !== undefined ? { deviceLabel: body.deviceLabel } : {}),
    });
    res.status(200).json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

// ── US4: Credential reset ─────────────────────────────────────────────────────

export async function updateChildCredentials(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { childId } = req.params as { childId: string };
    const body = req.body as { username?: string; password?: string; pin?: string };
    const principal = req.principal!;

    await authService.updateChildCredentials(principal.familyId, childId, {
      ...(body.username !== undefined ? { username: body.username } : {}),
      ...(body.password !== undefined ? { password: body.password } : {}),
      ...(body.pin !== undefined ? { pin: body.pin } : {}),
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── US5: Shared device ────────────────────────────────────────────────────────

export async function listSharedChildren(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Family scope is derived from the verified principal, never the request.
    const principal = req.principal!;
    const children = await authService.listFamilyChildrenForPicker(principal.familyId);
    res.status(200).json({ data: children });
  } catch (err) {
    next(err);
  }
}

export async function reauthParent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { deviceId, password } = req.body as { deviceId: string; password: string };
    const principal = req.principal!;
    await authService.reauthParent(principal.id, deviceId, password);
    res.status(200).json({ data: { message: "Re-authenticated" } });
  } catch (err) {
    next(err);
  }
}

// ── US6: OAuth ────────────────────────────────────────────────────────────────

export async function oauthCallback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = req.oauthProfile;

    if (!profile) {
      res
        .status(400)
        .json({ error: { code: "VALIDATION_ERROR", message: "Missing OAuth profile" } });
      return;
    }

    const result = await authService.findOrCreateByOAuth({
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      ...(profile.name !== undefined ? { name: profile.name } : {}),
    });

    if (result.status === "needs_dob") {
      res.status(202).json({ data: { status: "needs_dob", dobToken: result.dobToken } });
    } else {
      res.status(200).json({ data: result.tokens });
    }
  } catch (err) {
    next(err);
  }
}

export async function completeDob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { dobToken, dob } = req.body as { dobToken: string; dob: string };
    const tokens = await authService.completeOAuthDob(dobToken, new Date(dob));
    res.status(200).json({ data: tokens });
  } catch (err) {
    next(err);
  }
}
