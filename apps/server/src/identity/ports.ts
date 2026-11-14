// F-22: the ports other modules register on identity (registries and their defaults).
import type { DbHandle } from "../platform/db/types.js";

export interface DeletionBlocker {
  kind: "sole_admin_shared_account";
  id: string;
  name: string;
  memberCount: number;
}

export interface DeletionPrecheck {
  module: string;
  blockers(h: DbHandle, userId: string): Promise<readonly DeletionBlocker[]>;
}

export interface ErasureParticipant {
  module: string;
  order: number;
  erase(
    h: DbHandle,
    userId: string,
    ctx: { requestedBy: "self" | "owner" | "ban" | null; replay: boolean },
  ): Promise<void>;
}

export interface ExportSection {
  /** `<module>.<entity>` */
  name: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number | boolean | null)[])[];
}

export interface ExportParticipant {
  module: string;
  order: number;
  collect(h: DbHandle, userId: string): Promise<readonly ExportSection[]>;
}

export interface InvitePolicy {
  canSendInvitations(h: DbHandle, userId: string): Promise<boolean>;
}

export interface InvitationContextProvider {
  contextLine(h: DbHandle, invitationId: string, locale: string): Promise<string | null>;
}

export interface IdentityPorts {
  deletionPrechecks: DeletionPrecheck[];
  erasureParticipants: ErasureParticipant[];
  exportParticipants: ExportParticipant[];
  invitePolicy: InvitePolicy;
  invitationContext: InvitationContextProvider;
}

/** Empty lists, a policy allowing everyone, and no context line. */
export function defaultPorts(): IdentityPorts {
  return {
    deletionPrechecks: [],
    erasureParticipants: [],
    exportParticipants: [],
    invitePolicy: { canSendInvitations: () => Promise.resolve(true) },
    invitationContext: { contextLine: () => Promise.resolve(null) },
  };
}
