import type { CloudUser } from "@/types";

export interface Entitlements {
  active: boolean;
  browserAutomation: boolean;
  crossOsFingerprints: boolean;
  cloudBackup: boolean;
  teamCollaboration: boolean;
  profileLimit?: number;
}

/** Every feature of this browser is free for everyone. */
export function getEntitlements(_user?: CloudUser | null): Entitlements {
  return {
    active: true,
    browserAutomation: true,
    crossOsFingerprints: true,
    cloudBackup: true,
    teamCollaboration: false,
  };
}
