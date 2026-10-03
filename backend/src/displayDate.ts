/** User-facing calendar dates: DD-MM-YYYY (storage/API stays ISO YYYY-MM-DD). */

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "";
  const s = iso.trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function formatDisplayDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    const date = formatDisplayDate(iso);
    const time = iso.slice(11, 16);
    return `${date} ${time}`;
  }
  const text = String(value);
  if (text.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = formatDisplayDate(text);
    if (text.length >= 16) {
      const time = text.slice(11, 16).replace("T", " ");
      return `${date} ${time}`;
    }
    return date;
  }
  return text.length >= 16 ? text.slice(0, 16).replace("T", " ") : text;
}

export function formatDisplayDateRange(start: string, end: string): string {
  const a = formatDisplayDate(start);
  const b = formatDisplayDate(end);
  if (!a) return b || start;
  if (!b || a === b) return a;
  return `${a} - ${b}`;
}
