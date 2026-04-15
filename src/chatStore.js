const DEFAULT_MAX_MESSAGES = 120;
const DEFAULT_MAX_NAME_LENGTH = 24;
const DEFAULT_MAX_TEXT_LENGTH = 280;
const ROLE_MEMBER = "member";
const ROLE_ADMIN = "admin";

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

function serializeSession(session) {
  return {
    id: session.id,
    name: session.name,
    role: session.role,
    isMuted: session.isMuted,
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
      .map(serializeSession)
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
      role: ROLE_MEMBER,
      isMuted: false,
      lastSeenAt: clock(),
    };
    sessions.set(session.id, session);
    return session;
  }

  function getSessionOrThrow(sessionId, errorMessage = "Session expired. Please join again.") {
    const session = sessions.get(sessionId);

    if (!session) {
      throw new Error(errorMessage);
    }

    return session;
  }

  function assertAdmin(sessionId) {
    const session = getSessionOrThrow(sessionId);

    if (session.role !== ROLE_ADMIN) {
      throw new Error("Only admins can do that.");
    }

    return session;
  }

  function join(name) {
    const session = createSession(name);
    const event = buildSystemMessage(`${session.name} joined the room.`, idGenerator, clock);
    pushMessage(event);
    return { session: serializeSession(session), event };
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
    const session = getSessionOrThrow(sessionId);

    if (session.isMuted) {
      throw new Error("You are muted and cannot send messages.");
    }

    const normalizedText = normalizeText(text, DEFAULT_MAX_TEXT_LENGTH);

    if (!normalizedText) {
      throw new Error("Please enter a message.");
    }

    session.lastSeenAt = clock();
    const message = buildChatMessage(session.name, normalizedText, idGenerator, clock);
    message.role = session.role;
    pushMessage(message);
    return message;
  }

  function touchSession(sessionId) {
    const session = getSessionOrThrow(sessionId);
    session.lastSeenAt = clock();
    return serializeSession(session);
  }

  function grantRole(sessionId, role) {
    const session = getSessionOrThrow(sessionId);

    if (session.role === role) {
      return { session: serializeSession(session), event: null };
    }

    session.role = role;
    const event = buildSystemMessage(`${session.name} is now an admin.`, idGenerator, clock);
    pushMessage(event);
    return { session: serializeSession(session), event };
  }

  function setMuted(actorSessionId, targetSessionId, muted) {
    const actor = assertAdmin(actorSessionId);

    if (actorSessionId === targetSessionId) {
      throw new Error("You can't mute yourself.");
    }

    const target = getSessionOrThrow(targetSessionId, "That person is no longer in the room.");
    target.isMuted = Boolean(muted);
    target.lastSeenAt = clock();

    const event = buildSystemMessage(
      `${target.name} was ${target.isMuted ? "muted" : "unmuted"} by ${actor.name}.`,
      idGenerator,
      clock,
    );
    pushMessage(event);
    return { target: serializeSession(target), event };
  }

  function kick(actorSessionId, targetSessionId) {
    const actor = assertAdmin(actorSessionId);

    if (actorSessionId === targetSessionId) {
      throw new Error("You can't kick yourself.");
    }

    const target = getSessionOrThrow(targetSessionId, "That person is no longer in the room.");
    sessions.delete(target.id);

    const event = buildSystemMessage(`${target.name} was kicked by ${actor.name}.`, idGenerator, clock);
    pushMessage(event);
    return { target: serializeSession(target), event };
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
    grantRole,
    getSnapshot,
    hasSession,
    join,
    kick,
    leave,
    removeInactiveSessions,
    setMuted,
    touchSession,
  };
}
