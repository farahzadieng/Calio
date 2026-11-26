import type { CalioDatabase } from "../db/database";
import type { Job } from "../db/records";
import { AiFailure } from "../ai/contracts";

const leaseMs = 120_000;
const maxRetryDelayMs = 60 * 60_000;
const maxAutomaticAttempts = 4;

export type JobSeed = Pick<Job, "id" | "period" | "inputHash">;

export async function claimJob(
  db: CalioDatabase,
  seed: JobSeed,
  explicit: boolean,
  now = new Date(),
): Promise<Job | null> {
  return db.transaction("rw", db.processing_queue, async () => {
    const previous = await db.processing_queue.get(seed.id);
    const at = now.toISOString();
    if (previous?.leaseUntil && previous.leaseUntil > at) return null;
    if (previous?.stage === "ready" || previous?.stage === "processed")
      return null;
    if (
      previous &&
      !explicit &&
      (previous.restored ||
        previous.stage === "stale" ||
        previous.stage === "failed" ||
        previous.stage === "needs_review" ||
        (previous.attempt >= maxAutomaticAttempts && previous.error !== null) ||
        (previous.retryAt && previous.retryAt > at))
    )
      return null;

    const job: Job = {
      ...seed,
      stage: "pending",
      attempt: (previous?.attempt ?? 0) + 1,
      leaseOwner: crypto.randomUUID(),
      leaseUntil: new Date(now.valueOf() + leaseMs).toISOString(),
      error: null,
      retryAt: null,
      restored: false,
      updatedAt: at,
    };
    await db.processing_queue.put(job);
    return job;
  });
}

export async function requireLease(db: CalioDatabase, job: Job) {
  const current = await db.processing_queue.get(job.id);
  if (!current?.leaseOwner || current.leaseOwner !== job.leaseOwner)
    throw new AiFailure("job_stale");
  return current;
}

export function advanceJob(
  db: CalioDatabase,
  job: Job,
  stage: Job["stage"],
  now = new Date(),
) {
  return db.transaction("rw", db.processing_queue, async () => {
    const current = await requireLease(db, job);
    await db.processing_queue.put({
      ...current,
      stage,
      updatedAt: now.toISOString(),
      leaseUntil: new Date(now.valueOf() + leaseMs).toISOString(),
    });
  });
}

export async function releaseJob(
  db: CalioDatabase,
  job: Job,
  stage: Job["stage"],
  failure: AiFailure | null = null,
  now = new Date(),
) {
  return db.transaction("rw", db.processing_queue, async () => {
    const current = await db.processing_queue.get(job.id);
    if (!current || current.leaseOwner !== job.leaseOwner) return;
    const retryDelay = failure?.retryable
      ? Math.min(
          maxRetryDelayMs,
          Math.max(
            failure.retryAfterMs ?? 0,
            1500 * 2 ** Math.min(10, current.attempt),
          ),
        )
      : null;
    await db.processing_queue.put({
      ...current,
      stage,
      leaseOwner: null,
      leaseUntil: null,
      error: failure?.code ?? null,
      retryAt:
        retryDelay === null
          ? null
          : new Date(now.valueOf() + retryDelay).toISOString(),
      updatedAt: now.toISOString(),
    });
  });
}
