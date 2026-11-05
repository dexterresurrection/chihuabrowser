import type { CloudAuthState, CloudUser } from "@/types";

interface UseCloudAuthReturn {
  user: CloudUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  exchangeDeviceCode: (code: string) => Promise<CloudAuthState>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<CloudUser>;
}

const unavailable = () => Promise.reject(new Error("No account in this browser"));

/** Nothing here needs a vendor account. */
export function useCloudAuth(): UseCloudAuthReturn {
  return {
    user: null,
    isLoggedIn: false,
    isLoading: false,
    exchangeDeviceCode: unavailable,
    logout: () => Promise.resolve(),
    refreshProfile: unavailable,
  };
}
