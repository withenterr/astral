import assert from "node:assert/strict";
import test from "node:test";

import { createChatStore } from "../src/chatStore.js";

function createDeterministicStore() {
  let id = 0;
  let time = 0;

  return createChatStore({
    idGenerator: () => `id-${++id}`,
    clock: () => ++time,
    maxMessages: 3,
  });
}

test("join adds a participant and emits a system message", () => {
  const store = createDeterministicStore();
  const { session, event } = store.join("  Alice   ");
  const snapshot = store.getSnapshot();

  assert.equal(session.name, "Alice");
  assert.equal(event.type, "system");
  assert.equal(snapshot.onlineCount, 1);
  assert.deepEqual(snapshot.participants, [{ id: session.id, name: "Alice" }]);
});

test("addMessage stores a trimmed chat message for the joined user", () => {
  const store = createDeterministicStore();
  const { session } = store.join("Bob");
  const message = store.addMessage(session.id, "   Hello     world   ");

  assert.equal(message.type, "chat");
  assert.equal(message.name, "Bob");
  assert.equal(message.text, "Hello world");
});

test("join rejects duplicate names even with different casing", () => {
  const store = createDeterministicStore();

  store.join("john");

  assert.throws(() => {
    store.join("John");
  }, /already in use/i);
});

test("leave removes the participant and appends a system event", () => {
  const store = createDeterministicStore();
  const { session } = store.join("Cara");
  const event = store.leave(session.id);
  const snapshot = store.getSnapshot();

  assert.equal(event.type, "system");
  assert.equal(snapshot.onlineCount, 0);
});

test("removeInactiveSessions drops idle users", () => {
  const store = createDeterministicStore();
  const { session } = store.join("Dee");

  store.removeInactiveSessions(0);

  assert.equal(store.hasSession(session.id), false);
});

test("message history respects the configured cap", () => {
  const store = createDeterministicStore();
  const { session } = store.join("Eli");

  store.addMessage(session.id, "one");
  store.addMessage(session.id, "two");
  store.addMessage(session.id, "three");

  const snapshot = store.getSnapshot();

  assert.equal(snapshot.messages.length, 3);
  assert.equal(snapshot.messages[0].text, "one");
  assert.equal(snapshot.messages[2].text, "three");
});
