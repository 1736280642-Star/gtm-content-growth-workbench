export const workbenchTimeZone = "Asia/Shanghai";

export const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function getDateTextInTimeZone(date = new Date(), timeZone = workbenchTimeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function addDateDays(dateText: string, offset: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function getWeekStartForDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDateDays(dateText, mondayOffset);
}

export function getCurrentWorkbenchWeek(date = new Date()) {
  const today = getDateTextInTimeZone(date);
  const weekStart = getWeekStartForDate(today);

  return {
    today,
    weekStart,
    weekEnd: addDateDays(weekStart, 6)
  };
}

export function getWeekdayLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  return weekdayLabels[date.getUTCDay()] || dateText;
}

export function isDateInWeek(dateText: string | undefined, weekStart: string) {
  if (!dateText) {
    return false;
  }

  const date = dateText.slice(0, 10);
  return date >= weekStart && date <= addDateDays(weekStart, 6);
}
