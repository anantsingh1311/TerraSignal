import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import path from "node:path";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const defaultUserPath = () => process.env.TERRASIGNAL_USERS_PATH || "data/users.json";
const tokenTtlSeconds = () => Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 12);
const isDevelopment = () => String(process.env.NODE_ENV || "development").toLowerCase() === "development";
const jwtSecret = () => process.env.JWT_SECRET || process.env.TERRASIGNAL_JWT_SECRET || "";
const failedLoginLimit = () => Number(process.env.AUTH_FAILED_LOGIN_LIMIT || 5);
const failedLoginWindowMs = () => Number(process.env.AUTH_FAILED_LOGIN_WINDOW_MS || 15 * 60 * 1000);
const failedLoginLockMs = () => Number(process.env.AUTH_FAILED_LOGIN_LOCK_MS || 15 * 60 * 1000);

const base64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const fromBase64url = (value) => {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const passwordErrors = (password) => {
  const value = String(password || "");
  const errors = [];
  if (value.length < 12) errors.push("at least 12 characters");
  if (!/[a-z]/.test(value)) errors.push("one lowercase letter");
  if (!/[A-Z]/.test(value)) errors.push("one uppercase letter");
  if (!/[0-9]/.test(value)) errors.push("one number");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("one symbol");
  return errors;
};

export const validateAuthConfiguration = () => {
  const secret = jwtSecret();
  if (!secret && !isDevelopment()) {
    throw new Error("JWT_SECRET is required in production. Set JWT_SECRET before starting TerraSignal.");
  }
  if (secret && secret.length < 32 && !isDevelopment()) {
    throw new Error("JWT_SECRET must be at least 32 characters in production.");
  }
};

const requireJwtSecret = () => {
  const secret = jwtSecret();
  if (!secret) {
    const error = new Error("JWT_SECRET is required before authentication tokens can be issued or verified.");
    error.status = 500;
    throw error;
  }
  return secret;
};

const readUsers = (filePath = defaultUserPath()) => {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) return [];
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
};

const writeUsers = (users, filePath = defaultUserPath()) => {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writeFileSync(resolved, JSON.stringify({ users }, null, 2));
};

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const incoming = Buffer.from(scryptSync(String(password), salt, 64).toString("hex"), "hex");
  const saved = Buffer.from(hash, "hex");
  return incoming.length === saved.length && timingSafeEqual(incoming, saved);
};

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  company: user.company,
  role: user.role,
  plan: user.plan,
  createdAt: user.createdAt,
});

export const ensureAuthSeed = () => {
  if (process.env.TERRASIGNAL_SEED_PILOT === "true") {
    const email = normalizeEmail(process.env.TERRASIGNAL_PILOT_EMAIL);
    const password = process.env.TERRASIGNAL_PILOT_PASSWORD;
    if (!email || !password) {
      throw new Error("TERRASIGNAL_PILOT_EMAIL and TERRASIGNAL_PILOT_PASSWORD are required when TERRASIGNAL_SEED_PILOT=true.");
    }
    const policyErrors = passwordErrors(password);
    if (policyErrors.length) {
      throw new Error(`Seed pilot password must include ${policyErrors.join(", ")}.`);
    }
    const users = readUsers();
    if (!users.some((user) => user.email === email)) {
      users.push({
        id: String(process.env.TERRASIGNAL_PILOT_USER_ID || "terrasignal-pilot-user"),
        email,
        name: String(process.env.TERRASIGNAL_PILOT_NAME || "Pilot User"),
        company: String(process.env.TERRASIGNAL_PILOT_COMPANY || "TerraSignal Pilot"),
        role: "user",
        plan: "free-demo",
        passwordHash: hashPassword(password),
        createdAt: now(),
      });
      writeUsers(users);
    }
  }

  if (process.env.TERRASIGNAL_SEED_ADMIN !== "true" || !isDevelopment()) return;

  const users = readUsers();
  if (users.length) return;

  const email = normalizeEmail(process.env.TERRASIGNAL_ADMIN_EMAIL);
  const password = process.env.TERRASIGNAL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("TERRASIGNAL_ADMIN_EMAIL and TERRASIGNAL_ADMIN_PASSWORD are required when TERRASIGNAL_SEED_ADMIN=true.");
  }
  const policyErrors = passwordErrors(password);
  if (policyErrors.length) {
    throw new Error(`Seed admin password must include ${policyErrors.join(", ")}.`);
  }
  users.push({
    id: randomUUID(),
    email,
    name: "Pilot Admin",
    company: "TerraSignal Pilot",
    role: "admin",
    plan: "enterprise",
    passwordHash: hashPassword(password),
    createdAt: now(),
  });
  writeUsers(users);
};

export const createToken = (user) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + tokenTtlSeconds(),
  };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", requireJwtSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
};

export const verifyToken = (token) => {
  const [header, body, signature] = String(token || "").split(".");
  if (!header || !body || !signature) return null;
  const secret = jwtSecret();
  if (!secret) return null;
  const expected = base64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  const incoming = Buffer.from(signature);
  const saved = Buffer.from(expected);
  if (incoming.length !== saved.length || !timingSafeEqual(incoming, saved)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body));
    if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const registerUser = ({ email, password, name, company }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    const error = new Error("A valid work email is required.");
    error.status = 422;
    throw error;
  }
  const policyErrors = passwordErrors(password);
  if (policyErrors.length) {
    const error = new Error(`Password must include ${policyErrors.join(", ")}.`);
    error.status = 422;
    throw error;
  }

  const users = readUsers();
  if (users.some((user) => user.email === normalizedEmail)) {
    const error = new Error("An account already exists for this email.");
    error.status = 409;
    throw error;
  }

  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    name: String(name || normalizedEmail.split("@")[0]).trim(),
    company: String(company || "Pilot workspace").trim(),
    role: "user",
    plan: "free-demo",
    passwordHash: hashPassword(password),
    createdAt: now(),
  };
  users.push(user);
  writeUsers(users);
  return { user: publicUser(user), token: createToken(user) };
};

export const loginUser = ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);
  const users = readUsers();
  const userIndex = users.findIndex((candidate) => candidate.email === normalizedEmail);
  const user = users[userIndex];
  const currentTime = Date.now();
  if (user?.lockedUntil && Date.parse(user.lockedUntil) > currentTime) {
    const error = new Error("Too many failed login attempts. Try again later or reset the account through an administrator.");
    error.status = 429;
    throw error;
  }
  if (!user || !verifyPassword(password, user.passwordHash)) {
    if (user) {
      const lastFailedAt = user.lastFailedLoginAt ? Date.parse(user.lastFailedLoginAt) : 0;
      const withinWindow = lastFailedAt && currentTime - lastFailedAt < failedLoginWindowMs();
      const nextCount = withinWindow ? Number(user.failedLoginCount || 0) + 1 : 1;
      users[userIndex] = {
        ...user,
        failedLoginCount: nextCount,
        lastFailedLoginAt: now(),
        lockedUntil: nextCount >= failedLoginLimit() ? new Date(currentTime + failedLoginLockMs()).toISOString() : null,
      };
      writeUsers(users);
    }
    const error = new Error("Invalid email or password.");
    error.status = 401;
    throw error;
  }
  if (user.failedLoginCount || user.lastFailedLoginAt || user.lockedUntil) {
    users[userIndex] = {
      ...user,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
    };
    writeUsers(users);
  }
  return { user: publicUser(user), token: createToken(user) };
};

export const getUserById = (id) => {
  const user = readUsers().find((candidate) => candidate.id === id);
  return user ? publicUser(user) : null;
};

export const listUsers = () => readUsers().map(publicUser);

export const authenticateRequest = (req) => {
  const header = req.headers.authorization || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.sub);
};
