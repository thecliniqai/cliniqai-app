import { z } from "zod";

/**
 * The `client_request_id` every write command takes (V2-07 R-2, PWA-06a): one UUID per logical submit. The same id
 * replays the first result and writes nothing new. Shared by the services whose actions call a command RPC.
 */
export const clientRequestIdSchema = z.string().uuid("Invalid request ID");
