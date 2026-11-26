// Calendar composition based on the PersianLabs consumer Calendar.
import { DayPicker as PersianDayPicker, faIR } from "@daypicker/persian";
import { DayPicker } from "react-day-picker";
import { enUS } from "react-day-picker/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  formatDate,
  shiftDate,
  dateInTimeZone,
  numberingSystem,
} from "../../domain/dates";
import { useCalio } from "../../app/state";
import { Button, Modal } from "../ui/primitives";

export function DatePicker({
  value,
  onChange,
  step = false,
  label,
  quickDates = false,
}: {
  value: string;
  onChange: (value: string) => void;
  step?: boolean;
  label?: string;
  quickDates?: boolean;
}) {
  const { settings, locale, t, today } = useCalio();
  const [open, setOpen] = useState(false);
  const Calendar =
    settings.calendar === "persian" ? PersianDayPicker : DayPicker;
  const selected = new Date(`${value}T12:00:00Z`);
  const accessibleLabel = label ?? t("انتخاب تاریخ", "Choose date");
  function selectDate(date: string) {
    onChange(date);
    setOpen(false);
  }
  return (
    <div className="date-row">
      {step && (
        <Button
          className="icon-button"
          tone="quiet"
          aria-label={t("روز پیش", "Previous day")}
          onClick={() => onChange(shiftDate(value, -1))}
        >
          <ChevronLeft className="directional" size={17} />
        </Button>
      )}
      <Button
        tone="quiet"
        aria-label={`${accessibleLabel} · ${formatDate(value, locale, settings.calendar)}`}
        onClick={() => setOpen(true)}
      >
        <CalendarDays aria-hidden size={17} />
        {formatDate(value, locale, settings.calendar)}
      </Button>
      {step && (
        <Button
          className="icon-button"
          tone="quiet"
          aria-label={t("روز بعد", "Next day")}
          onClick={() => onChange(shiftDate(value, 1))}
        >
          <ChevronRight className="directional" size={17} />
        </Button>
      )}
      <Modal title={accessibleLabel} open={open} onOpenChange={setOpen}>
        {quickDates && (
          <div className="actions calendar-shortcuts">
            <Button tone="quiet" onClick={() => selectDate(today)}>
              {t("امروز", "Today")}
            </Button>
            <Button
              tone="quiet"
              onClick={() => selectDate(shiftDate(today, -1))}
            >
              {t("دیروز", "Yesterday")}
            </Button>
          </div>
        )}
        <Calendar
          className="cal-calendar"
          dir={locale === "fa" ? "rtl" : "ltr"}
          locale={locale === "fa" ? faIR : enUS}
          numerals={numberingSystem(locale)}
          today={new Date(`${today}T12:00:00Z`)}
          timeZone="UTC"
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={locale === "fa" ? 6 : 1}
          onSelect={(date) => {
            if (!date) return;
            selectDate(dateInTimeZone(date, "UTC"));
          }}
        />
        <Button tone="quiet" onClick={() => setOpen(false)}>
          {t("بستن", "Close")}
        </Button>
      </Modal>
    </div>
  );
}
