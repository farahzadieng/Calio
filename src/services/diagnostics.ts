import type { CalioDatabase } from "../db/database";
import { records, type Row } from "../db/records";

const capacity = 150;

export function recordDiagnostic(
  db: CalioDatabase,
  input: Pick<Row<"diagnostics">, "code" | "outcome" | "test">,
  now = new Date(),
) {
  const row = records.diagnostics.parse({
    ...input,
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
  });
  return db.transaction("rw", db.diagnostics, async () => {
    await db.diagnostics.add(row);
    const excess = (await db.diagnostics.count()) - capacity;
    if (excess > 0) {
      const ids = await db.diagnostics
        .orderBy("createdAt")
        .limit(excess)
        .primaryKeys();
      await db.diagnostics.bulkDelete(ids);
    }
    return row;
  });
}

export function redactedDiagnostics(db: CalioDatabase) {
  return db.diagnostics
    .orderBy("createdAt")
    .reverse()
    .toArray()
    .then((rows) =>
      rows.map(({ code, outcome, test, createdAt }) => ({
        code,
        outcome,
        test,
        createdAt,
      })),
    );
}

export async function testMessage(
  db: CalioDatabase,
  severity: Row<"messages">["severity"],
  now = new Date(),
) {
  if (db.mode !== "demo") throw new Error("test_mode_required");
  return db.messages.put({
    id: `test:${severity}`,
    kind: "test_message",
    test: true,
    severity,
    createdAt: now.toISOString(),
    period: null,
    seen: false,
  });
}
