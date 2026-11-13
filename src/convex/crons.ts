/**
 * Scheduled sweeps.
 *
 * `vip.expireRequests` is idempotent by construction — it only flips rows
 * that are still `pending` and past their deadline — so an overlapping or
 * repeated run is harmless. The billing reminder sweep stays externally
 * scheduled on purpose; see the comment at the top of `expiry.ts`.
 */
import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

crons.interval("expire stale vip requests", { minutes: 30 }, api.vip.expireRequests, {});

export default crons;
