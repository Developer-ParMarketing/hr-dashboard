/**
 * eSSL eTimeTrackLite Web API client (SOAP `GetTransactionsLog`).
 *
 * The biometric server returns every punch as a line in <strDataList>:
 *   EMPCODE \t YYYY-MM-DD HH:MM:SS \t ...
 *
 * Config (backend/.env):
 *   ESSL_API_URL         http://192.168.10.30:84/iclock/webapiservice.asmx
 *   ESSL_SERIAL_NUMBERS  CQQC222760172            (comma-separate several devices)
 *   ESSL_USERNAME        api
 *   ESSL_PASSWORD        ...
 */

export type EsslPunch = {
    code: string;
    /** YYYY-MM-DD (machine local time) */
    date: string;
    /** HH:MM:SS (machine local time) */
    time: string;
};

export type EsslConfig = {
    apiUrl: string;
    serialNumbers: string[];
    username: string;
    password: string;
    timeoutMs: number;
};

const SOAP_ACTION = "http://tempuri.org/GetTransactionsLog";

export function esslConfig(): EsslConfig | null {
    const apiUrl = process.env.ESSL_API_URL?.trim() ?? "";
    const serialNumbers = (process.env.ESSL_SERIAL_NUMBERS ?? process.env.ESSL_SERIAL_NUMBER ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const username = process.env.ESSL_USERNAME?.trim() ?? "";
    const password = process.env.ESSL_PASSWORD ?? "";
    if (!apiUrl || serialNumbers.length === 0 || !username) return null;
    const timeoutMs = Number.parseInt(process.env.ESSL_TIMEOUT_MS ?? "120000", 10) || 120_000;
    return { apiUrl, serialNumbers, username, password, timeoutMs };
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function xmlUnescape(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, "&");
}

function soapBody(cfg: EsslConfig, serial: string, fromDate: string, toDate: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
      <FromDateTime>${xmlEscape(fromDate)}</FromDateTime>
      <ToDateTime>${xmlEscape(toDate)}</ToDateTime>
      <SerialNumber>${xmlEscape(serial)}</SerialNumber>
      <UserName>${xmlEscape(cfg.username)}</UserName>
      <UserPassword>${xmlEscape(cfg.password)}</UserPassword>
      <strDataList>100000</strDataList>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>`;
}

/** Parse `<strDataList>` lines into punches. Exported for tests. */
export function parseEsslPunches(xml: string): EsslPunch[] {
    const m = xml.match(/<strDataList>([\s\S]*?)<\/strDataList>/);
    if (!m) return [];
    const punches: EsslPunch[] = [];
    for (const line of xmlUnescape(m[1]).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const lm = t.match(/^(\S+)\s+(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!lm) continue;
        const code = lm[1].trim().toUpperCase();
        const dm = [lm[0], lm[2], lm[3], lm[4], lm[5]] as const;
        const time = `${dm[2].padStart(2, "0")}:${dm[3]}:${dm[4] ?? "00"}`;
        punches.push({ code, date: dm[1], time });
    }
    return punches;
}

async function fetchOneDevice(
    cfg: EsslConfig,
    serial: string,
    fromDate: string,
    toDate: string,
): Promise<EsslPunch[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
        const res = await fetch(cfg.apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                SOAPAction: `"${SOAP_ACTION}"`,
            },
            body: soapBody(cfg, serial, fromDate, toDate),
            signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`eSSL device ${serial}: HTTP ${res.status} ${text.slice(0, 200)}`);
        }
        const result = text.match(/<GetTransactionsLogResult>([\s\S]*?)<\/GetTransactionsLogResult>/)?.[1]?.trim();
        const punches = parseEsslPunches(text);
        if (punches.length === 0 && result && /(invalid|error|fail|incorrect|denied|unauthori|wrong)/i.test(result)) {
            throw new Error(`eSSL device ${serial}: ${xmlUnescape(result).slice(0, 200)}`);
        }
        return punches;
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            throw new Error(`eSSL device ${serial}: no response after ${Math.round(cfg.timeoutMs / 1000)}s (${cfg.apiUrl})`);
        }
        if (e instanceof Error && !e.message.startsWith("eSSL device")) {
            throw new Error(`eSSL device ${serial}: ${e.message} (${cfg.apiUrl})`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * All punches between fromDate and toDate (YYYY-MM-DD, inclusive) from every configured device.
 * The API's ToDateTime is treated as exclusive by some eSSL builds, so we ask for one extra day
 * and filter locally. Duplicate punches (same code + second) are removed.
 */
export async function fetchEsslPunches(fromDate: string, toDate: string): Promise<EsslPunch[]> {
    const cfg = esslConfig();
    if (!cfg) {
        throw new Error("eSSL is not configured. Set ESSL_API_URL, ESSL_SERIAL_NUMBERS, ESSL_USERNAME, ESSL_PASSWORD in backend/.env");
    }
    const end = new Date(`${toDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const toExclusive = end.toISOString().slice(0, 10);

    const seen = new Set<string>();
    const out: EsslPunch[] = [];
    for (const serial of cfg.serialNumbers) {
        const punches = await fetchOneDevice(cfg, serial, fromDate, toExclusive);
        for (const p of punches) {
            if (p.date < fromDate || p.date > toDate) continue;
            const key = `${p.code}|${p.date}|${p.time}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
    }
    return out;
}