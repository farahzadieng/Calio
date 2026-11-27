import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen, Sparkles, Pencil, Trash2 } from "lucide-react";
import { Coffee, Droplet, PenLine } from "lucide-react";
import { Link } from "react-router";
import { Button, Modal, Textarea } from "../components/ui/primitives";
import { DatePicker } from "../components/calio/date-picker";
import { deleteNote, persistDraft, saveNote } from "../services/journal";
import { type DiaryNote } from "../db/records";
import { Page, useCalio } from "./state";
import { SupplementTracker } from "./supplements";
import { runManualAnalysis } from "./processing";
import landscape from "../../assets/illustrations/landscape.webp";

export default function Journal() {
  const { db, today, locale, notify, t } = useCalio();
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<DiaryNote | null>(null);
  const [deleting, setDeleting] = useState<DiaryNote | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const composer = useRef<HTMLFormElement>(null);
  const notes = useLiveQuery(
    () => db.journal_entries.where("localDate").equals(date).toArray(),
    [db, date],
    [],
  );
  const latest = useLiveQuery(
    () => db.messages.where("kind").equals("weekly_ready").last(),
    [db],
  );
  useEffect(() => {
    let active = true;
    void db.journal_draft
      .toArray()
      .then(async (drafts) => {
        const sorted = drafts.sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
        for (const draft of sorted) {
          const edited =
            draft.id === "journal"
              ? undefined
              : await db.journal_entries.get(draft.id);
          if (!active) return;
          if (
            draft.id !== "journal" &&
            (!edited || edited.revision !== draft.revision)
          )
            continue;
          setDate(draft.localDate);
          setText(draft.text);
          setEditing(edited ?? null);
          break;
        }
        if (active) setDraftLoaded(true);
      })
      .catch(() => {
        if (active) setDraftLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [db]);

  function updateDraft(nextText: string, nextDate: string) {
    if (!draftLoaded) return;
    void persistDraft(
      db,
      { text: nextText, localDate: nextDate },
      new Date(),
      editing ?? undefined,
    ).catch(() =>
      notify(
        "ذخیرهٔ پیش‌نویس ممکن نشد.",
        "The draft could not be saved.",
        "error",
      ),
    );
  }

  async function openEdit(note: DiaryNote) {
    setDraftLoaded(false);
    try {
      const draft = await db.journal_draft.get(note.id);
      const matches = draft?.revision === note.revision;
      setEditing(note);
      setDate(matches ? draft.localDate : note.localDate);
      setText(matches ? draft.text : note.text);
      setError("");
    } finally {
      setDraftLoaded(true);
      requestAnimationFrame(() =>
        composer.current?.querySelector("textarea")?.focus(),
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setError(t("متن یادداشت را وارد کنید.", "Write a note first."));
      composer.current?.querySelector("textarea")?.focus();
      return;
    }
    setWorking(true);
    try {
      await saveNote(
        db,
        { text, localDate: date, time: editing?.time ?? null },
        editing ?? undefined,
      );
      const originalDraft = editing
        ? await db.journal_draft.get("journal")
        : undefined;
      setText(originalDraft?.text ?? "");
      if (originalDraft) setDate(originalDraft.localDate);
      setEditing(null);
      setError("");
      notify(
        navigator.onLine ? "یادداشت ذخیره شد." : "یادداشت آفلاین ذخیره شد.",
        navigator.onLine ? "Note saved." : "Note saved offline.",
        "success",
      );
    } catch {
      setError(
        t(
          "ذخیره نشد. اگر در برگهٔ دیگری ویرایش کرده‌اید، یادداشت را دوباره باز کنید.",
          "Save failed. If another tab edited the note, reopen it first.",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function analyze() {
    setWorking(true);
    try {
      const result = await runManualAnalysis(db, locale, date);
      if (result === "unavailable")
        notify(
          "سرویس AI هنوز فعال نیست. تنظیمات اتصال را بررسی کنید.",
          "AI is unavailable. Check integration settings.",
          "warning",
        );
      else if (result === "empty")
        notify(
          "در این تاریخ یادداشت در انتظار تحلیل وجود ندارد.",
          "There are no pending notes for this date.",
        );
      else if (result === "done")
        notify("پردازش یادداشت‌ها انجام شد.", "Notes processed.", "success");
      else
        notify(
          "پردازش کامل نشد. وضعیت را در تنظیمات بررسی کنید.",
          "Processing did not finish. Check Settings.",
          "error",
        );
    } catch {
      notify("پردازش ناموفق بود.", "Analysis failed.", "error");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Page
      className="journal-page"
      title={t("دفترچهٔ غذا", "Food journal")}
      actions={
        <DatePicker
          value={date}
          step
          quickDates
          onChange={(next) => {
            setDate(next);
            updateDraft(text, next);
          }}
        />
      }
    >
      {latest && !latest.test && latest.period && (
        <Link className="notice" to={`/insights/week/${latest.period.id}`}>
          {t("گزارش هفتگی آماده است.", "Your weekly report is ready.")}
        </Link>
      )}
      <form
        className="panel form journal-composer"
        ref={composer}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="journal-composer-title">
          <PenLine size={19} aria-hidden />
          <h2>
            {editing
              ? t("ویرایش یادداشت", "Edit note")
              : t("یادداشت روز", "Daily note")}
          </h2>
        </div>
        <Textarea
          label={t(
            "غذا، نوشیدنی و حال‌وهوای امروز",
            "Food, drinks, and how you felt",
          )}
          value={text}
          disabled={!draftLoaded}
          error={error}
          maxLength={32000}
          placeholder={t(
            "مثلاً ناهار دو لقمه الویه و نصف لیوان چای…",
            "For example, two bites of salad and half a glass of tea…",
          )}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
            updateDraft(event.target.value, date);
          }}
        />
        <div className="actions">
          <Button type="submit" disabled={working || !draftLoaded}>
            <NotebookPen size={17} aria-hidden />
            {t("ذخیره", "Save note")}
          </Button>
          {editing && (
            <Button
              tone="quiet"
              onClick={() => {
                void db.journal_draft.delete(editing.id);
                setEditing(null);
                setError("");
                void db.journal_draft.get("journal").then((draft) => {
                  setText(draft?.text ?? "");
                  if (draft) setDate(draft.localDate);
                });
              }}
            >
              {t("انصراف", "Cancel")}
            </Button>
          )}
          <Button
            tone="quiet"
            disabled={working}
            onClick={() => void analyze()}
          >
            <Sparkles size={17} aria-hidden />
            {t("تحلیل یادداشت‌ها", "Analyze notes")}
          </Button>
        </div>
      </form>
      <SupplementTracker
        key={date}
        date={date}
        quickLinks={
          <>
            <Link to="/drinks" state={{ date }}>
              <Droplet size={23} aria-hidden />
              {t("آب", "Water")}
            </Link>
            <Link to="/drinks" state={{ date, drink: "coffee" }}>
              <Coffee size={23} aria-hidden />
              {t("قهوه", "Coffee")}
            </Link>
          </>
        }
      />
      <section className={notes.length ? "panel" : "panel journal-hero"}>
        {notes.length === 0 && (
          <img
            className="hero-art"
            src={landscape}
            alt=""
            width="560"
            height="315"
          />
        )}
        <div>
          <h2>{t("یادداشت‌ها", "Notes")}</h2>
          {notes.length === 0 && (
            <p className="muted">
              {t(
                "برای این تاریخ هنوز چیزی ثبت نشده است.",
                "No entries for this date yet.",
              )}
            </p>
          )}
        </div>
        {!!notes.length && (
          <div className="rows">
            {[...notes]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((note) => (
                <article className="row-item stack tight" key={note.id}>
                  <p className="note-body" dir="auto">
                    {note.text}
                  </p>
                  <div className="row between">
                    <p className="muted small">
                      {note.status === "pending"
                        ? t("در انتظار تحلیل", "Awaiting analysis")
                        : note.status === "needs_review"
                          ? t("نیاز به بررسی", "Needs review")
                          : ""}
                    </p>
                    <div className="actions">
                      <Button
                        tone="quiet"
                        className="icon-button"
                        aria-label={t("ویرایش یادداشت", "Edit note")}
                        onClick={() => {
                          void openEdit(note).catch(() =>
                            notify(
                              "باز کردن پیش‌نویس ممکن نشد.",
                              "The draft could not be opened.",
                              "error",
                            ),
                          );
                        }}
                      >
                        <Pencil size={17} />
                      </Button>
                      <Button
                        tone="quiet"
                        className="icon-button"
                        aria-label={t("حذف یادداشت", "Delete note")}
                        onClick={() => setDeleting(note)}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("حذف یادداشت", "Delete note")}
        description={t(
          "یادداشت و داده‌های محاسبه‌شدهٔ وابسته حذف می‌شوند.",
          "The note and its derived data will be deleted.",
        )}
      >
        <div className="actions">
          <Button
            tone="danger"
            onClick={() => {
              if (!deleting) return;
              void deleteNote(db, deleting)
                .then(() => {
                  setDeleting(null);
                  notify("یادداشت حذف شد.", "Note deleted.", "success");
                })
                .catch(() =>
                  notify("حذف ممکن نشد.", "Deletion failed.", "error"),
                );
            }}
          >
            {t("حذف", "Delete")}
          </Button>
          <Button tone="quiet" onClick={() => setDeleting(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
    </Page>
  );
}
