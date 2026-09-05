import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { ApplicationError } from "./errors";
import { assertPublicReviewOpen, isPublicReviewMode, reserveReviewUsage } from "./public-review";
import { isGoogleIapMode, verifyIapRequest, type IapIdentity } from "./iap-auth";
import {
  assertApplicationAuthenticationAvailable,
  type AuthenticationRuntimeEnvironment,
} from "./production-auth-policy";

export const SESSION_COOKIE_NAME = "donghaeng_session";
export const LOCAL_WORKSPACE_TENANT_ID = "local-workspace-tenant";
export const LOCAL_WORKSPACE_USER_ID = "local-workspace-user";
export const LOCAL_WORKSPACE_EMAIL = "local@donghaeng.workspace";

const SESSION_DURATION_MS = 24 * 60 * 60 * 1_000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SENTINEL = "UNINITIALIZED";

export interface Principal {
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthSessionResult {
  principal: Principal;
  expiresAt: string;
  token: string;
}

interface SessionRow {
  tenant_id: unknown;
  user_id: unknown;
  email: unknown;
  display_name: unknown;
  roles_json: unknown;
  expires_at: unknown;
}

interface UserRow {
  id: unknown;
  tenant_id: unknown;
  email: unknown;
  display_name: unknown;
  roles_json: unknown;
  password_salt: unknown;
  password_hash: unknown;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
}

function safeJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((role) => typeof role === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function localWorkspacePassword(environment: AuthenticationRuntimeEnvironment): string {
  if (environment.NODE_ENV === "production") {
    throw new ApplicationError(
      403,
      "LOCAL_BOOTSTRAP_DISABLED",
      "운영 환경에서는 로컬 작업공간 bootstrap을 사용할 수 없습니다.",
    );
  }
  if (environment.DONGHAENG_LOCAL_BOOTSTRAP === "0") {
    throw new ApplicationError(
      403,
      "LOCAL_BOOTSTRAP_DISABLED",
      "로컬 작업공간 bootstrap이 비활성화되어 있습니다.",
    );
  }
  return environment.DONGHAENG_LOCAL_PASSWORD?.trim() || randomBytes(32).toString("base64url");
}

export function assertSameOriginMutation(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApplicationError(403, "CSRF_REJECTED", "교차 사이트 요청은 허용되지 않습니다.");
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new ApplicationError(403, "CSRF_ORIGIN_REQUIRED", "Origin 헤더가 필요합니다.");
    }
    return;
  }

  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host")?.trim();
  // Next may normalize Request.url to localhost while preserving the browser's
  // original Host header. Use that original host for local same-origin checks;
  // production deployments should pin DONGHAENG_APP_ORIGIN explicitly.
  const expectedOrigin =
    process.env.DONGHAENG_APP_ORIGIN?.trim() ||
    (requestHost ? `${requestUrl.protocol}//${requestHost}` : requestUrl.origin);
  if (origin !== expectedOrigin) {
    throw new ApplicationError(403, "CSRF_REJECTED", "허용되지 않은 요청 출처입니다.");
  }
}

export function sessionCookie(token: string, expiresAt: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export class AuthService {
  constructor(
    readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly environment: AuthenticationRuntimeEnvironment = process.env,
  ) {}

  bootstrapLocalWorkspace(): AuthSessionResult {
    assertApplicationAuthenticationAvailable(this.environment);
    if (isGoogleIapMode(this.environment) || isPublicReviewMode(this.environment)) {
      throw new ApplicationError(403, "LOCAL_BOOTSTRAP_DISABLED", "Google 인증 환경에서는 로컬 계정을 생성할 수 없습니다.");
    }
    const password = localWorkspacePassword(this.environment);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const now = this.now().toISOString();

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `UPDATE users
           SET password_salt = ?, password_hash = ?
           WHERE id = ? AND tenant_id = ?
             AND (password_salt = ? OR password_hash = ?)`,
        )
        .run(
          salt,
          passwordHash,
          LOCAL_WORKSPACE_USER_ID,
          LOCAL_WORKSPACE_TENANT_ID,
          PASSWORD_SENTINEL,
          PASSWORD_SENTINEL,
        );
      const result = this.issueSession(
        LOCAL_WORKSPACE_TENANT_ID,
        LOCAL_WORKSPACE_USER_ID,
        now,
      );
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  login(email: string, password: string): AuthSessionResult {
    assertApplicationAuthenticationAvailable(this.environment);
    if (isGoogleIapMode(this.environment) || isPublicReviewMode(this.environment)) {
      throw new ApplicationError(403, "PASSWORD_LOGIN_DISABLED", "이 서비스는 Google 로그인만 지원합니다.");
    }
    const normalized = normalizeEmail(email);
    const row = this.database
      .prepare(
        `SELECT id, tenant_id, email, display_name, roles_json, password_salt, password_hash
         FROM users
         WHERE email_normalized = ? AND active = 1
         ORDER BY tenant_id ASC LIMIT 1`,
      )
      .get(normalized) as UserRow | undefined;
    if (!row || typeof row.password_salt !== "string" || typeof row.password_hash !== "string") {
      throw new ApplicationError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    if (row.password_salt === PASSWORD_SENTINEL || row.password_hash === PASSWORD_SENTINEL) {
      throw new ApplicationError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
    }

    const actual = Buffer.from(hashPassword(password, row.password_salt), "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ApplicationError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    return this.issueSession(String(row.tenant_id), String(row.id), this.now().toISOString());
  }

  authenticate(request: Request): Principal {
    assertApplicationAuthenticationAvailable(this.environment);
    const review = isPublicReviewMode(this.environment);
    if (review) assertPublicReviewOpen(this.environment, this.now());
    if (isGoogleIapMode(this.environment)) {
      return this.iapPrincipal(verifyIapRequest(request, this.environment, this.now()));
    }
    const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
    if (!token) {
      throw new ApplicationError(401, review ? "PUBLIC_REVIEW_SESSION_REQUIRED" : "AUTHENTICATION_REQUIRED", review ? "이 브라우저의 상담 기록을 준비합니다." : "로그인이 필요합니다.");
    }
    const row = this.database
      .prepare(
        `SELECT s.tenant_id, s.user_id, s.expires_at,
                u.email, u.display_name, u.roles_json
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND u.active = 1`,
      )
      .get(sha256(token)) as SessionRow | undefined;
    if (!row || String(row.expires_at) <= this.now().toISOString()) {
      throw new ApplicationError(401, review ? "PUBLIC_REVIEW_SESSION_REQUIRED" : "SESSION_EXPIRED", "세션이 없거나 만료되었습니다.");
    }
    if (review && (!String(row.tenant_id).startsWith("review-") ||
      !String(row.user_id).startsWith("review-") || String(row.roles_json) !== '["INTERVIEWER"]')) {
      throw new ApplicationError(403, "REVIEW_IDENTITY_REQUIRED", "공개 심사에서는 방문자 기록만 이용할 수 있습니다.");
    }
    return {
      tenantId: String(row.tenant_id),
      userId: String(row.user_id),
      email: String(row.email),
      displayName: String(row.display_name),
      roles: safeJsonArray(row.roles_json),
    };
  }

  getSession(request: Request): {
    principal: Principal; expiresAt: string;
    authMode?: "google-iap" | "public-review"; logoutSupported?: boolean;
  } {
    if (isGoogleIapMode(this.environment)) {
      assertApplicationAuthenticationAvailable(this.environment);
      const identity = verifyIapRequest(request, this.environment, this.now());
      return {
        principal: this.iapPrincipal(identity), expiresAt: identity.expiresAt,
        authMode: "google-iap", logoutSupported: false,
      };
    }
    const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
    const principal = this.authenticate(request);
    const row = this.database
      .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
      .get(sha256(token ?? ""));
    return { principal, expiresAt: String(row?.expires_at ?? ""), ...(isPublicReviewMode(this.environment) ? { authMode: "public-review" as const, logoutSupported: false } : {}) };
  }

  startPublicReview(request: Request): AuthSessionResult | Omit<AuthSessionResult, "token"> {
    if (!isPublicReviewMode(this.environment)) {
      throw new ApplicationError(404, "NOT_FOUND", "지원되지 않는 요청입니다.");
    }
    assertPublicReviewOpen(this.environment, this.now());
    try { return this.getSession(request); } catch (error) {
      if (!(error instanceof ApplicationError) || error.status !== 401) throw error;
    }
    const tenantId = `review-${randomUUID()}`;
    const userId = `review-${randomUUID()}`;
    const now = this.now().toISOString();
    const email = `${userId}@visitor.invalid`;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      reserveReviewUsage(this.database, "visitor", tenantId, 1, this.environment, this.now());
      this.database.prepare("INSERT INTO tenants(id, slug, name, created_at) VALUES (?, ?, ?, ?)")
        .run(tenantId, tenantId, "이 브라우저의 상담 기록", now);
      this.database.prepare(`INSERT INTO users(id, tenant_id, email, email_normalized, display_name,
        password_salt, password_hash, roles_json, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(userId, tenantId, email, email, "이 브라우저의 상담 기록", PASSWORD_SENTINEL, PASSWORD_SENTINEL, '["INTERVIEWER"]', now);
      const session = this.issueSession(tenantId, userId, now);
      this.database.exec("COMMIT;");
      return session;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  logout(request: Request): void {
    assertApplicationAuthenticationAvailable(this.environment);
    if (isGoogleIapMode(this.environment)) {
      // Clearing this application's cookie cannot revoke Google's IAP cookie.
      // Do not claim a successful logout while the next request stays signed in.
      verifyIapRequest(request, this.environment, this.now());
      throw new ApplicationError(
        409, "IAP_LOGOUT_EXTERNAL_REQUIRED",
        "Google IAP 로그인은 이 화면에서 종료할 수 없습니다. 사용한 브라우저 프로필을 닫거나 Google 계정에서 로그아웃해 주세요.",
      );
    }
    const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
    if (!token) return;
    this.database
      .prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .run(this.now().toISOString(), sha256(token));
  }

  private iapPrincipal(identity: IapIdentity): Principal {
    const tenantId = identity.tenantId;
    // Subject, not email, is the durable identity. A second Google subject
    // cannot take over an existing account merely by presenting the same email.
    const userId = `google-iap-${sha256(`${tenantId}\0${identity.subject}`)}`;
    const roles = ["ADMIN", "INTERVIEWER"];
    const principal = { tenantId, userId, email: identity.email, displayName: identity.email, roles };
    const current = this.database.prepare(
      "SELECT active, email, email_normalized, display_name, roles_json FROM users WHERE tenant_id = ? AND id = ?",
    ).get(tenantId, userId);
    if (current?.active === 0) {
      throw new ApplicationError(403, "IAP_ACCOUNT_DISABLED", "운영 계정을 사용할 수 없습니다.");
    }
    // Frequent interview polling must not rewrite the same identity to disk.
    if (current?.active === 1 && current.email === identity.email &&
      current.email_normalized === identity.email && current.display_name === identity.email &&
      current.roles_json === JSON.stringify(roles)) {
      return principal;
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare(
        `INSERT INTO tenants(id, slug, name, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(tenantId, `google-iap-${sha256(tenantId).slice(0, 32)}`, "동행금융 운영 작업공간", now);
      const existing = this.database.prepare(
        "SELECT id, active FROM users WHERE tenant_id = ? AND id = ?",
      ).get(tenantId, userId);
      const emailOwner = this.database.prepare(
        "SELECT id FROM users WHERE tenant_id = ? AND email_normalized = ?",
      ).get(tenantId, identity.email);
      if ((existing && existing.active !== 1) || (emailOwner && emailOwner.id !== userId)) {
        throw new ApplicationError(403, "IAP_ACCOUNT_DISABLED", "운영 계정을 사용할 수 없습니다.");
      }
      if (existing) {
        this.database.prepare(
          "UPDATE users SET email = ?, email_normalized = ?, display_name = ?, roles_json = ? WHERE tenant_id = ? AND id = ?",
        ).run(identity.email, identity.email, identity.email, JSON.stringify(roles), tenantId, userId);
      } else {
        this.database.prepare(
          `INSERT INTO users(id, tenant_id, email, email_normalized, display_name,
             password_salt, password_hash, roles_json, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        ).run(userId, tenantId, identity.email, identity.email, identity.email,
          PASSWORD_SENTINEL, PASSWORD_SENTINEL, JSON.stringify(roles), now);
      }
      this.database.exec("COMMIT;");
      return principal;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private issueSession(tenantId: string, userId: string, now: string): AuthSessionResult {
    const user = this.database
      .prepare(
        `SELECT id, tenant_id, email, display_name, roles_json, password_salt, password_hash
         FROM users WHERE tenant_id = ? AND id = ? AND active = 1`,
      )
      .get(tenantId, userId) as UserRow | undefined;
    if (!user) {
      throw new ApplicationError(500, "LOCAL_IDENTITY_MISSING", "로컬 데모 계정을 찾을 수 없습니다.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = isPublicReviewMode(this.environment)
      ? new Date(this.environment.DONGHAENG_REVIEW_CLOSES_AT!).toISOString()
      : new Date(new Date(now).getTime() + SESSION_DURATION_MS).toISOString();
    this.database
      .prepare(
        `INSERT INTO auth_sessions(
          id, tenant_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(randomUUID(), tenantId, userId, sha256(token), now, expiresAt, now);
    return {
      principal: {
        tenantId,
        userId,
        email: String(user.email),
        displayName: String(user.display_name),
        roles: safeJsonArray(user.roles_json),
      },
      expiresAt,
      token,
    };
  }
}
