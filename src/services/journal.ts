import type { CalioDatabase } from "../db/database";
import { draftSchema, journalSchema, type DiaryNote } from "../db/records";

export class JournalConflict extends Error {
  constructor() {
    super("journal_revision_conflict");
  }
}

export async function invalidateDates(db: CalioDatabase, dates: string[]) {
  const contains = (period: { start: string; end: string }) =>
    dates.some((date) => date >= period.start && date <= period.end);
  const reports = await db.ai_reports
    .filter((report) => report.status === "ready" && contains(report.period))
    .toArray();
  await db.ai_reports.bulkPut(
    reports.map((report) => ({ ...report, status: "stale" })),
  );
  await db.processing_queue
    .filter((job) => job.period !== null && contains(job.period))
    .modify((job) => {
      job.stage =
        reports.some((report) => report.period.id === job.period?.id) ||
        job.stage === "stale"
          ? "stale"
          : "pending";
      job.leaseOwner = null;
      job.leaseUntil = null;
      job.retryAt = null;
    });
  await db.messages
    .filter(
      (message) =>
        message.kind === "weekly_ready" &&
        message.period !== null &&
        contains(message.period),
    )
    .delete();
}

async function discardDerivations(db: CalioDatabase, entryId: string) {
  await db.parsed_entries.where("entryId").equals(entryId).delete();
  await db.meal_items.where("entryId").equals(entryId).delete();
  await db.drinks
    .filter((row) => row.matchedMeal?.entryId === entryId)
    .modify({ matchedMeal: null });
  await db.supplement_logs
    .filter((row) => row.matchedMeal?.entryId === entryId)
    .modify({ matchedMeal: null });
}

function affectedTables(db: CalioDatabase) {
  return [
    db.journal_entries,
    db.journal_draft,
    db.parsed_entries,
    db.meal_items,
    db.drinks,
    db.supplement_logs,
    db.ai_reports,
    db.processing_queue,
    db.messages,
  ];
}

export function persistDraft(
  db: CalioDatabase,
  input: { localDate: string; text: string },
  now = new Date(),
  editing?: Pick<DiaryNote, "id" | "revision">,
) {
  return db.journal_draft.put(
    draftSchema.parse({
      ...input,
      id: editing?.id ?? "journal",
      revision: editing?.revision,
      updatedAt: now.toISOString(),
    }),
  );
}

export async function saveNote(
  db: CalioDatabase,
  input: Pick<DiaryNote, "text" | "localDate" | "time">,
  previous?: Pick<DiaryNote, "id" | "revision">,
  now = new Date(),
): Promise<DiaryNote> {
  return db.transaction("rw", affectedTables(db), async () => {
    const existing = previous
      ? await db.journal_entries.get(previous.id)
      : undefined;
    if (previous && existing?.revision !== previous.revision)
      throw new JournalConflict();
    const at = now.toISOString();
    const note = journalSchema.parse({
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      revision: (existing?.revision ?? 0) + 1,
      status: "pending",
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    if (existing) await discardDerivations(db, note.id);
    await invalidateDates(
      db,
      existing ? [existing.localDate, note.localDate] : [note.localDate],
    );
    await db.journal_entries.put(note);
    const draftId = existing?.id ?? "journal";
    const draft = await db.journal_draft.get(draftId);
    if (
      draft?.text === input.text &&
      draft.localDate === input.localDate &&
      draft.revision === existing?.revision
    ) {
      await db.journal_draft.delete(draftId);
    }
    return note;
  });
}

export async function deleteNote(
  db: CalioDatabase,
  expected: Pick<DiaryNote, "id" | "revision">,
): Promise<void> {
  await db.transaction("rw", affectedTables(db), async () => {
    const note = await db.journal_entries.get(expected.id);
    if (!note) return;
    if (note.revision !== expected.revision) throw new JournalConflict();
    await discardDerivations(db, note.id);
    await invalidateDates(db, [note.localDate]);
    await db.journal_entries.delete(note.id);
    await db.journal_draft.delete(note.id);
  });
}
