// Re-exports of SDK types used throughout the extension.
// Import from here rather than directly from @opencode-ai/sdk to decouple
// the rest of the codebase from the SDK's exact export paths.

export type {
  Session,
  Message,
  AssistantMessage,
  Part,
  Permission,
  Provider,
  Model,

  // Input part types for sendPrompt
  TextPartInput,
  FilePartInput,
  AgentPartInput,
  SubtaskPartInput,

  // Event union (all possible event shapes)
  Event,

  // Message events
  EventMessageUpdated,
  EventMessagePartUpdated,
  EventMessageRemoved,

  // Permission events
  EventPermissionUpdated,
  EventPermissionReplied,

  // Session events
  EventSessionCreated,
  EventSessionUpdated,
  EventSessionDeleted,
} from '@opencode-ai/sdk';

/** What the UI calls the user's permission choice. */
export type PermissionDecision = 'allow' | 'once' | 'deny';

/** Maps UI decision labels to the wire values the API accepts. */
export const decisionToWire = {
  allow: 'always',
  once: 'once',
  deny: 'reject',
} as const;
