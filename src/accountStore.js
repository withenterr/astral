import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_USERNAME_LENGTH = 24;
const DEFAULT_MAX_PASSWORD_LENGTH = 72;
const DEFAULT_MAX_UNUSED_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TOUCH_THROTTLE_MS = 60 * 60 * 1000;

function normalizeUsername(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DEFAULT_MAX_USERNAME_LENGTH);
}

function normalizeUsernameKey(value) {
  return normalizeUsername(value).toLocaleLowerCase();
}

function validatePassword(value) {
  const password = String(value || "");

  if (!password.trim()) {
    throw new Error("Please enter a password.");
  }

  if (password.length > DEFAULT_MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be ${DEFAULT_MAX_PASSWORD_LENGTH} characters or fewer.`);
  }

  return password;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${digest.toString("hex")}`;
}

function verifyPassword(password, passwordHash) {
  const [saltHex, digestHex] = String(passwordHash || "").split(":");

  if (!saltHex || !digestHex) {
    return false;
  }

  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

function serializeAccount(account) {
  return {
    id: account.id,
    username: account.username,
    passwordHash: account.passwordHash,
    lastUsedAt: account.lastUsedAt,
  };
}

function serializePublicAccount(account) {
  return {
    id: account.id,
    username: account.username,
  };
}

export function createAccountStore({
  accounts = [],
  clock = () => Date.now(),
  idGenerator = () => crypto.randomUUID(),
  maxUnusedMs = DEFAULT_MAX_UNUSED_MS,
  passwordHasher = hashPassword,
  passwordVerifier = verifyPassword,
  touchThrottleMs = DEFAULT_TOUCH_THROTTLE_MS,
} = {}) {
  const accountsById = new Map();
  const accountIdsByUsername = new Map();

  for (const account of accounts) {
    if (!account?.id || !account?.username || !account?.passwordHash) {
      continue;
    }

    const username = normalizeUsername(account.username);

    if (!username) {
      continue;
    }

    const normalizedAccount = {
      id: String(account.id),
      username,
      passwordHash: String(account.passwordHash),
      lastUsedAt: Number.isFinite(account.lastUsedAt) ? account.lastUsedAt : clock(),
    };

    accountsById.set(normalizedAccount.id, normalizedAccount);
    accountIdsByUsername.set(normalizeUsernameKey(username), normalizedAccount.id);
  }

  function markUsed(account, force = false) {
    const now = clock();

    if (!force && now - account.lastUsedAt < touchThrottleMs) {
      return false;
    }

    account.lastUsedAt = now;
    return true;
  }

  function removeAccount(account) {
    accountsById.delete(account.id);
    accountIdsByUsername.delete(normalizeUsernameKey(account.username));
  }

  function getAvailability(username) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      return {
        username: "",
        available: false,
        reason: "Please enter a username.",
      };
    }

    const used = accountIdsByUsername.has(normalizeUsernameKey(normalizedUsername));

    return {
      username: normalizedUsername,
      available: !used,
      reason: used ? "Used" : "",
    };
  }

  function signUp(username, password) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      throw new Error("Please enter a username.");
    }

    if (!getAvailability(normalizedUsername).available) {
      throw new Error("Used");
    }

    const account = {
      id: idGenerator(),
      username: normalizedUsername,
      passwordHash: passwordHasher(validatePassword(password)),
      lastUsedAt: clock(),
    };

    accountsById.set(account.id, account);
    accountIdsByUsername.set(normalizeUsernameKey(account.username), account.id);

    return serializePublicAccount(account);
  }

  function signIn(username, password) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedPassword = String(password || "");
    const accountId = accountIdsByUsername.get(normalizeUsernameKey(normalizedUsername));

    if (!normalizedUsername || !normalizedPassword || !accountId) {
      throw new Error("No such account.");
    }

    const account = accountsById.get(accountId);

    if (!account || !passwordVerifier(normalizedPassword, account.passwordHash)) {
      throw new Error("No such account.");
    }

    markUsed(account, true);

    return serializePublicAccount(account);
  }

  function touchByUsername(username) {
    const normalizedUsername = normalizeUsername(username);
    const accountId = accountIdsByUsername.get(normalizeUsernameKey(normalizedUsername));

    if (!accountId) {
      return false;
    }

    const account = accountsById.get(accountId);

    if (!account) {
      return false;
    }

    return markUsed(account);
  }

  function cleanupExpiredAccounts() {
    const now = clock();
    const removedUsernames = [];

    for (const account of accountsById.values()) {
      if (now - account.lastUsedAt >= maxUnusedMs) {
        removedUsernames.push(account.username);
        removeAccount(account);
      }
    }

    return removedUsernames;
  }

  function serializeAccounts() {
    return [...accountsById.values()]
      .sort((first, second) => first.username.localeCompare(second.username))
      .map(serializeAccount);
  }

  return {
    cleanupExpiredAccounts,
    getAvailability,
    serializeAccounts,
    signIn,
    signUp,
    touchByUsername,
  };
}
