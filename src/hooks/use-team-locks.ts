import type { ProfileLockInfo } from "@/types";

/** Team locks belonged to the vendor's paid plan. */
export function useTeamLocks(_currentUserId?: string) {
  return {
    locks: [] as ProfileLockInfo[],
    isProfileLocked: (_profileId: string) => false,
    getLockInfo: (_profileId: string) => undefined as ProfileLockInfo | undefined,
  };
}
