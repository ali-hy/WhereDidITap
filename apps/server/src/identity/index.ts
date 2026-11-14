// The only file other modules import from identity (§5.7). It exports exactly what exists so far;
// later slices add requireConfirmed, the readers and the owner services.
export type { Principal } from "../platform/http/context.js";
export type {
  DeletionBlocker,
  DeletionPrecheck,
  ErasureParticipant,
  ExportParticipant,
  ExportSection,
  IdentityPorts,
  InvitationContextProvider,
  InvitePolicy,
} from "./ports.js";
export type { IdentityEventName, IdentityEventPayloads, IdentityEvents } from "./eventsService.js";
export * from "./identityErrors.js";
