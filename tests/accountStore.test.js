import assert from "node:assert/strict";
import test from "node:test";

import { createAccountStore } from "../src/accountStore.js";

function createDeterministicAccountStore() {
  let id = 0;
  let now = 1_000;

  return {
    advanceTime(ms) {
      now += ms;
    },
    store: createAccountStore({
      clock: () => now,
      idGenerator: () => `account-${++id}`,
      passwordHasher: (password) => `hash:${password}`,
      passwordVerifier: (password, passwordHash) => passwordHash === `hash:${password}`,
      touchThrottleMs: 0,
    }),
  };
}

test("signUp creates an account with a unique username", () => {
  const { store } = createDeterministicAccountStore();
  const account = store.signUp("  Alice  ", "secret");

  assert.deepEqual(account, {
    id: "account-1",
    username: "Alice",
  });
});

test("getAvailability marks an existing username as used regardless of case", () => {
  const { store } = createDeterministicAccountStore();

  store.signUp("john", "secret");

  assert.deepEqual(store.getAvailability("John"), {
    username: "John",
    available: false,
    reason: "Used",
  });
});

test("signUp rejects duplicate usernames", () => {
  const { store } = createDeterministicAccountStore();

  store.signUp("Mia", "secret");

  assert.throws(() => {
    store.signUp("mia", "another-secret");
  }, /used/i);
});

test("signIn returns the account when username and password match", () => {
  const { store } = createDeterministicAccountStore();

  store.signUp("Niko", "1234");

  assert.deepEqual(store.signIn("niko", "1234"), {
    id: "account-1",
    username: "Niko",
  });
});

test("signIn throws no such account when the username or password is wrong", () => {
  const { store } = createDeterministicAccountStore();

  store.signUp("Lena", "1234");

  assert.throws(() => {
    store.signIn("Lena", "wrong");
  }, /no such account/i);

  assert.throws(() => {
    store.signIn("Unknown", "1234");
  }, /no such account/i);
});

test("cleanupExpiredAccounts removes accounts unused for a week and frees the username", () => {
  const { store, advanceTime } = createDeterministicAccountStore();

  store.signUp("OldName", "secret");
  advanceTime(7 * 24 * 60 * 60 * 1000);

  assert.deepEqual(store.cleanupExpiredAccounts(), ["OldName"]);
  assert.deepEqual(store.getAvailability("OldName"), {
    username: "OldName",
    available: true,
    reason: "",
  });
});

test("touchByUsername keeps an active account from expiring", () => {
  const { store, advanceTime } = createDeterministicAccountStore();

  store.signUp("ActiveUser", "secret");
  advanceTime(6 * 24 * 60 * 60 * 1000);
  assert.equal(store.touchByUsername("ActiveUser"), true);
  advanceTime(2 * 24 * 60 * 60 * 1000);

  assert.deepEqual(store.cleanupExpiredAccounts(), []);
  assert.throws(() => {
    store.signIn("ActiveUser", "wrong");
  }, /no such account/i);
  assert.deepEqual(store.signIn("ActiveUser", "secret"), {
    id: "account-1",
    username: "ActiveUser",
  });
});
