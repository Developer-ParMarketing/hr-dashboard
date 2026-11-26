/**
 * Dates written in the question, worked out by code (not by the AI), so "on Tuesday" always means
 * the right day. Returns null when the question names no date.
 *
 * Understands: today/aaj, yesterday/kal, parso, "3 days ago", weekday names (English + Hindi,
 * "last tuesday" / "pichle mangalvar"), "25 nov", "nov 25", "25th november", "25/11", "2026-11-25",
 * and a month on its own ("in october", "last month" is left to the router).
 */

export type QuestionDate = { from: string; to: string; single: boolean };

const WEEKDAYS: Array<[number, RegExp]> = [
    [0, /\b(sunday|ravivar|itwar|itvar)\b/],
    [1, /\b(monday|mon|somvar|somwar)\b/],
    [2, /\b(tuesday|tues|tue|mangalvar|mangalwar)\b/],
    [3, /\b(wednesday|wed|budhvar|budhwar)\b/],
    [4, /\b(thursday|thurs|thu|guruvar|guruwar|veervar)\b/],
    [5, /\b(friday|fri|shukravar|shukrawar)\b/],
    [6, /\b(saturday|shanivar|shaniwar)\b/],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function iso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function utc(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m, d));
}

function addDays(dateIso: string, n: number): string {
    const d = new Date(`${dateIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return iso(d);
}

function monthIndex(word: string): number {
    return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/** A day/month without a year: this year, or last year if that date is still in the future. */
function pastDate(today: string, month: number, day: number): string | null {
    const y = Number(today.slice(0, 4));
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let d = utc(y, month, day);
    if (d.getUTCMonth() !== month) return null; // 31 Feb etc.
    if (iso(d) > today) d = utc(y - 1, month, day);
    return iso(d);
}

function single(date: string): QuestionDate {
    return { from: date, to: date, single: true };
}

export function dateFromQuestion(question: string, today: string): QuestionDate | null {
    const q = ` ${question.toLowerCase()} `;

    // 2026-11-25
    const isoM = q.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
    if (isoM) {
        const d = utc(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
        if (!Number.isNaN(d.getTime())) return single(iso(d));
    }

    // 25/11, 25/11/2026, 25-11-2026 (not "1-2 days")
    const dm = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d|\d\d))?\b/) ?? q.match(/\b(\d{1,2})-(\d{1,2})-(20\d\d)\b/);
    if (dm) {
        const day = Number(dm[1]);
        const month = Number(dm[2]) - 1;
        if (dm[3]) {
            const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
            const d = utc(y, month, day);
            if (d.getUTCMonth() === month) return single(iso(d));
        } else {
            const d = pastDate(today, month, day);
            if (d) return single(d);
        }
    }

    // 25 nov, 25th november, nov 25, november 25th
    const dayFirst = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\b`));
    const monthFirst = q.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (dayFirst) {
        const d = pastDate(today, monthIndex(dayFirst[2]!), Number(dayFirst[1]));
        if (d) return single(d);
    }
    if (monthFirst) {
        const d = pastDate(today, monthIndex(monthFirst[1]!), Number(monthFirst[2]));
        if (d) return single(d);
    }

    // "3 days ago", "2 din pehle"
    const ago = q.match(/\b(\d{1,2})\s*(days?|din)\s*(ago|pehle|pahle|back)\b/);
    if (ago) return single(addDays(today, -Number(ago[1])));

    if (/\b(day before yesterday|parso|parson)\b/.test(q)) return single(addDays(today, -2));
    if (/\b(yesterday|kal)\b/.test(q)) return single(addDays(today, -1));

    // weekday: the most recent one on or before today.
    // "last tuesday" on a Tuesday = a week ago; "tuesday of last week" / "pichle hafte" = previous Mon-Sun week.
    const lastWord = /\b(last|previous|pichle|pichhle|pichla|pichhla)\b/.test(q);
    const lastWeek = /\b(last|previous|pichle|pichhle|pichla|pichhla)\s+(week|hafte|hafta)\b/.test(q);
    for (const [dow, re] of WEEKDAYS) {
        if (!re.test(q)) continue;
        const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
        if (lastWeek) {
            const lastWeekMonday = addDays(today, -(((todayDow + 6) % 7) + 7));
            return single(addDays(lastWeekMonday, (dow + 6) % 7));
        }
        let back = (todayDow - dow + 7) % 7;
        if (lastWord && back === 0) back = 7;
        return single(addDays(today, -back));
    }

    if (/\b(today|aaj|abhi)\b/.test(q)) return single(today);

    // a month on its own: "in october", "october ka" -> that whole month (up to today)
    const monthOnly = q.match(new RegExp(`\\b${MONTH_RE}\\b`));
    // "may" is also an English word ("may I apply leave") - only a month with "in may" / "may month".
    const isMayWord = monthOnly?.[1] === "may" && !/\b(in|of|during) may\b|\bmay (month|mahine|me|mein|ka|ki)\b/.test(q);
    if (monthOnly && !isMayWord && !/\b(this|last|pichle) month\b/.test(q)) {
        const m = monthIndex(monthOnly[1]!);
        let y = Number(today.slice(0, 4));
        if (m > Number(today.slice(5, 7)) - 1) y -= 1;
        const from = iso(utc(y, m, 1));
        const end = iso(utc(y, m + 1, 0));
        return { from, to: end > today ? today : end, single: false };
    }
    return null;
}