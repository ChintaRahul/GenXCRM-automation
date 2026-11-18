import axios from "axios";

export const NO_ACCESS_MESSAGE = "You don't have access to this. Ask your admin if you need it.";

// User-facing message for a failed data load: a friendly no-access line for 403, else `fallback`.
export const loadErrorMessage = (err: unknown, fallback: string): string =>
  axios.isAxiosError(err) && err.response?.status === 403 ? NO_ACCESS_MESSAGE : fallback;
