import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { AuthoringSettingsStatus } from "../../shared/authoring/auth.js";
import type {
  InstallationAuthoringSettings,
  InstallationSettingsRepository,
} from "../registry/installation-settings-repository.js";

const DIGEST_PREFIX = "scrypt:v1";
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function deriveKey(token: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(token, salt, KEY_BYTES, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

async function digestToken(token: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(token, salt);
  return `${DIGEST_PREFIX}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

async function tokenMatches(token: string, digest: string): Promise<boolean> {
  const [algorithm, version, saltText, expectedText, extra] = digest.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || extra !== undefined ||
      saltText === undefined || expectedText === undefined) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(expectedText, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await deriveKey(token, salt);
  return timingSafeEqual(actual, expected);
}

function status(settings: InstallationAuthoringSettings): AuthoringSettingsStatus {
  return {
    enabled: settings.enabled,
    configured: settings.tokenDigest !== null,
    tokenHint: settings.tokenHint,
    tokenCreatedAt: settings.tokenCreatedAt,
    tokenRotatedAt: settings.tokenRotatedAt,
    updatedAt: settings.updatedAt,
  };
}

export interface AuthoringAuthService {
  getStatus(): AuthoringSettingsStatus;
  enable(): Promise<{ status: AuthoringSettingsStatus; token: string | null }>;
  rotate(): Promise<{ status: AuthoringSettingsStatus; token: string }>;
  disable(): AuthoringSettingsStatus;
  verify(token: string): Promise<boolean>;
}

export function createAuthoringAuthService(options: {
  repository: InstallationSettingsRepository;
  now?: () => Date;
  generateToken?: () => string;
}): AuthoringAuthService {
  const now = options.now ?? (() => new Date());
  const generateToken = options.generateToken ?? (() => randomBytes(32).toString("base64url"));

  async function issue(rotation: boolean): Promise<{ status: AuthoringSettingsStatus; token: string }> {
    const current = options.repository.getAuthoring();
    const token = generateToken();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Authoring Token generator failed");
    const timestamp = now().toISOString();
    const next: InstallationAuthoringSettings = {
      enabled: rotation ? current.enabled : true,
      tokenDigest: await digestToken(token),
      tokenHint: `${token.slice(0, 4)}…${token.slice(-4)}`,
      tokenCreatedAt: current.tokenCreatedAt ?? timestamp,
      tokenRotatedAt: rotation ? timestamp : current.tokenRotatedAt,
      updatedAt: timestamp,
    };
    options.repository.replaceAuthoring(next);
    return { status: status(next), token };
  }

  return {
    getStatus() {
      return status(options.repository.getAuthoring());
    },
    async enable() {
      const current = options.repository.getAuthoring();
      if (current.tokenDigest === null) return issue(false);
      const next = { ...current, enabled: true, updatedAt: now().toISOString() };
      options.repository.replaceAuthoring(next);
      return { status: status(next), token: null };
    },
    rotate() {
      return issue(true);
    },
    disable() {
      const current = options.repository.getAuthoring();
      const next = { ...current, enabled: false, updatedAt: now().toISOString() };
      options.repository.replaceAuthoring(next);
      return status(next);
    },
    async verify(token) {
      const current = options.repository.getAuthoring();
      return current.enabled && current.tokenDigest !== null
        ? tokenMatches(token, current.tokenDigest)
        : false;
    },
  };
}
