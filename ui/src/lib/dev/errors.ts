import { ApiError } from "@/lib/api";

/** A refused Dev action: the message is shown to the user as written. */
export class DevError extends ApiError {
  constructor(status: 400 | 403 | 404 | 409 | 500, message: string) {
    super(
      status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "VALIDATION",
      message,
      status,
    );
  }
}
