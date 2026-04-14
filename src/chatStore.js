const DEFAULT_MAX_MESSAGES = 120;
const DEFAULT_MAX_NAME_LENGTH = 24;
const DEFAULT_MAX_TEXT_LENGTH = 280;

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeNameKey(value) {
  return value.toLocaleLowerCase();
}

function buildSystemMessage(text, createId, clock) {
  return {
    id: createId(),
    type: "system",
    text,
    name: "System",
    createdAt: clock(),
  };
}

function buildChatMessage(name, text, createId, clock) {
  return {
    id: createId(),
    type: "chat",
    text,
    name,
    createdAt: clock(),
  };
}

export function createChatStore({
  idGenerator = () => crypto.randomUUID(),
  clock = () => Date.now(),
  maxMessages = DEFAULT_MAX_MESSAGES,
} = {}) {
  const sessions = new Map();
  const messages = [];

  function pushMessage(message) {
    messages.push(message);

    if (messages.length > maxMessages) {
      messages.splice(0, messages.length - maxMessages);
    }
  }

  function getSnapshot() {
    const participants = [...sessions.values()]
      .map((session) => ({
        id: session.id,
        name: session.name,
      }))
      .sort((first, second) => first.name.localeCompare(second.name));

    return {
      onlineCount: participants.length,
      participants,
      messages: messages.map((message) => ({ ...message })),
    };
  }

  function createSession(name) {
    const normalizedName = normalizeText(name, DEFAULT_MAX_NAME_LENGTH);

    if (!normalizedName) {
      throw new Error("Please enter a display name.");
    }

    const isNameTaken = [...sessions.values()].some((session) => {
      return normalizeNameKey(session.name) === normalizeNameKey(normalizedName);
    });

    if (isNameTaken) {
      throw new Error("That name is already in use. Please choose another one.");
    }

    const session = {
      id: idGenerator(),
      name: normalizedName,
      lastSeenAt: clock(),
    };
    sessions.set(session.id, session);
    return session;
  }

  function join(name) {
    const session = createSession(name);
    const event = buildSystemMessage(`${session.name} joined the room.`, idGenerator, clock);
    pushMessage(event);
    return { session: { id: session.id, name: session.name }, event };
  }

  function leave(sessionId) {
    const session = sessions.get(sessionId);

    if (!session) {
      return null;
    }

    sessions.delete(sessionId);
    const event = buildSystemMessage(`${session.name} left the room.`, idGenerator, clock);
    pushMessage(event);
    return event;
  }

  function addMessage(sessionId, text) {
    const session = sessions.get(sessionId);

    if (!session) {
      throw new Error("Session expired. Please join again.");
    }

    const normalizedText = normalizeText(text, DEFAULT_MAX_TEXT_LENGTH);

    if (!normalizedText) {
      throw new Error("Please enter a message.");
    }

    session.lastSeenAt = clock();
    const message = buildChatMessage(session.name, normalizedText, idGenerator, clock);
    pushMessage(message);
    return message;
  }

  function touchSession(sessionId) {
    const session = sessions.get(sessionId);

    if (!session) {
      throw new Error("Session expired. Please join again.");
    }

    session.lastSeenAt = clock();
  }

  function removeInactiveSessions(maxIdleMs) {
    const removedEvents = [];
    const now = clock();

    for (const session of sessions.values()) {
      if (now - session.lastSeenAt > maxIdleMs) {
        sessions.delete(session.id);
        const event = buildSystemMessage(
          `${session.name} disconnected.`,
          idGenerator,
          clock,
        );
        pushMessage(event);
        removedEvents.push(event);
      }
    }

    return removedEvents;
  }

  function hasSession(sessionId) {
    return sessions.has(sessionId);
  }

  return {
    addMessage,
    getSnapshot,
    hasSession,
    join,
    leave,
    removeInactiveSessions,
    touchSession,
  };
}
