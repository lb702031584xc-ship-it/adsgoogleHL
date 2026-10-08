import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
  authenticateSessionRequest,
  createSession,
  extractSessionToken,
  revokeSession,
  type SessionAuthInfo,
} from "../auth/sessions.js";

/**
 * Phase 10 — user auth (one tenant per user).
 * Requires Prisma persistence; registered only when services.prisma exists.
 */

export interface AuthRouteDeps {
  prisma: PrismaClient;
}

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
};

function publicUser(u: PublicUser): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tenantId: u.tenantId,
  };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}${secure}`
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireSession(
  deps: AuthRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!EMAIL_RE.test(email)) {
      throw new ValidationError("A valid email is required");
    }
    if (!name) {
      throw new ValidationError("Name is required");
    }
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }

    const existing = await prisma.user.findFirst({
      where: { email, status: "ACTIVE" },
    });
    if (existing) {
      throw new ConflictError("Email is already registered");
    }

    // Bootstrap: the first admin in the whole table makes this user admin.
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    const role = adminCount === 0 ? "admin" : "member";

    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: email,
        slug: `u-${randomBytes(4).toString("hex")}`,
        status: "ACTIVE",
      },
    });
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email,
        name,
        passwordHash: hashPassword(password),
        role,
        status: "ACTIVE",
      },
    });

    const session = await createSession(prisma, user.id);
    setSessionCookie(reply, session.token);
    return reply.status(201).send({
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      password?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      throw new ValidationError("Email and password are required");
    }

    const user = await prisma.user.findFirst({
      where: { email, status: "ACTIVE" },
    });
    // Same message for unknown email and bad password — no enumeration.
    if (
      !user ||
      !user.passwordHash ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const session = await createSession(prisma, user.id);
    setSessionCookie(reply, session.token);
    return {
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.post("/api/v1/auth/logout", async (request) => {
    const token = extractSessionToken(request);
    if (token) {
      await revokeSession(prisma, token);
    }
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request) => {
    const info = await requireSession(deps, request);
    return { user: publicUser(info) };
  });

  app.get("/api/v1/auth/admin/users", async (request) => {
    const info = await requireSession(deps, request);
    if (info.role !== "admin") {
      throw new ForbiddenError("Admin access required");
    }
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tenantId: u.tenantId,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });
}
