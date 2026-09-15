/*
 * قارئ إيصال مدى — دالة Vercel (Node runtime).
 * مولَّد من worker/src و vercel/src في مستودع sales-report-system.
 * لا تحرّره هنا؛ عدّل المصدر ثم أعد توليده بـ node worker/build.mjs
 */

/**
 * The one link either middleman will open, and the limits both hold to.
 *
 * This lives apart from the handlers on purpose: the check is the whole of the
 * security story, so there is one copy of it, used by the Cloudflare Worker and
 * by the Vercel function alike. Two copies would drift, and the drift would be
 * a hole.
 */
const ALLOWED_ORIGIN = 'https://basemoq.github.io';
const ALLOWED_HOST = 'd.surepay.sa';
const ALLOWED_PATH = '/r';
/** A receipt link is a few hundred characters; anything longer is not one. */
const MAX_URL_LENGTH = 4096;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const BROWSER_HEADERS = {
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'ar,en;q=0.8',
    // The receipt page is meant for a phone browser, and a host may turn away
    // anything that does not look like one.
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
/**
 * Everything is checked explicitly rather than by a pattern over the string:
 * scheme, host as a whole (so `d.surepay.sa.evil.com` and any other subdomain
 * are refused), path, and the presence of the receipt's own parameter.
 * Credentials in the URL are refused too — they have no place in a receipt link
 * and are a way to dress one host up as another.
 */
function checkReceiptUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return { error: 'أرسل رابط الإيصال في الحقل url.' };
    }
    if (value.length > MAX_URL_LENGTH)
        return { error: 'الرابط أطول مما يقبله الإيصال.' };
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        return { error: 'الرابط غير صالح.' };
    }
    if (url.protocol !== 'https:')
        return { error: 'يجب أن يكون الرابط عبر HTTPS.' };
    if (url.username !== '' || url.password !== '')
        return { error: 'الرابط غير صالح.' };
    if (url.hostname.toLowerCase() !== ALLOWED_HOST) {
        return { error: `لا يُقبل إلا رابط ${ALLOWED_HOST}.` };
    }
    if (url.pathname !== ALLOWED_PATH)
        return { error: 'مسار الرابط ليس مسار الإيصال.' };
    if ((url.searchParams.get('r') ?? '') === '')
        return { error: 'الرابط لا يحمل رمز الإيصال.' };
    return { url };
}
/** The Arabic a caller sees for the receipt server's own answer. */
function upstreamMessage(status) {
    if (status >= 300 && status < 400) {
        return { status: 502, message: 'الإيصال يحوّل إلى عنوان آخر، ولم يُتابَع التحويل.' };
    }
    if (status === 404 || status === 410) {
        return { status: 404, message: 'لم يعد هذا الإيصال متاحًا على خادم مدى.' };
    }
    if (status === 401 || status === 403) {
        return { status: 502, message: 'خادم الإيصال رفض الطلب.' };
    }
    return { status: 502, message: 'خادم الإيصال لم يُرجع صفحة صالحة.' };
}

/**
 * Reads a mada reconciliation receipt out of the HTML SurePay serves for a
 * terminal's QR link.
 *
 * The page is a printed receipt turned into a web page: the same labels the
 * paper receipt carries, each with a count and an amount beside it, in Arabic
 * and English. Nothing here depends on the order of the rows or on line
 * numbers — every figure is found by its own label, so a page that grows a row
 * or reorders its sections still reads correctly.
 */
/** The labels the receipt prints, against the names this returns them under. */
const ROW_LABELS = [
    { key: 'totalDb', label: 'TOTAL DB' },
    { key: 'totalCr', label: 'TOTAL CR' },
    { key: 'naqd', label: 'NAQD' },
    { key: 'cadv', label: 'C/ADV' },
    { key: 'auth', label: 'AUTH' },
];
const ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    nbsp: ' ',
};
/**
 * The page as plain lines. Every element that lays out a row — a table row, a
 * cell, a div, a break — ends a line, so a label and its figures stay together
 * on one line however the page nests them.
 */
function textLines(html) {
    return html
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(tr|div|p|h[1-6]|li|table)\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(td|th|span)\s*>/gi, ' \t ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#?\w+);/g, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
        .split('\n')
        .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
        .filter((line) => line !== '');
}
const AMOUNT = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g;
const COUNT = /(?<![\d.,])\d{1,6}(?![\d.,])/g;
const toNumber = (text) => Number(text.replace(/,/g, ''));
/**
 * The count and amount printed against a label. The amount is the figure with
 * halalas and the count the bare integer, so neither depends on which side of
 * the label its column sits — the receipt is laid out right to left, and the
 * page may or may not keep that order.
 *
 * A label whose figures were split into the following lines is still read: the
 * next couple of lines are considered, and the search stops at the next label
 * so one row can never borrow another's numbers.
 */
function rowFor(lines, label) {
    const others = ROW_LABELS.map(({ label: other }) => other).filter((other) => other !== label);
    const index = lines.findIndex((line) => hasLabel(line, label));
    if (index === -1)
        return null;
    const row = { count: null, amount: null };
    for (let cursor = index; cursor < Math.min(index + 3, lines.length); cursor += 1) {
        if (cursor > index && others.some((other) => hasLabel(lines[cursor], other)))
            break;
        const line = lines[cursor];
        const amounts = line.match(AMOUNT) ?? [];
        // The label's own text must not be mined for digits (C/ADV, 3D, and so on).
        const rest = line.replace(new RegExp(escape(label), 'gi'), ' ');
        const counts = (rest.replace(AMOUNT, ' ').match(COUNT) ?? []).map(Number);
        // A row printed on one line gives both at once; one broken across lines
        // gives them a line at a time, so each is taken the first time it appears.
        if (row.amount === null && amounts.length > 0)
            row.amount = toNumber(amounts[amounts.length - 1]);
        if (row.count === null && counts.length > 0)
            row.count = counts[0];
        if (row.amount !== null && row.count !== null)
            break;
    }
    return row;
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** `TOTAL DB` must not match inside `TOTAL DBX`, and spacing may vary. */
function hasLabel(line, label) {
    const pattern = new RegExp(`(?<![A-Za-z])${escape(label).replace(/\s+/g, '\\s+')}(?![A-Za-z])`, 'i');
    return pattern.test(line);
}
const DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const TIME = /\b(\d{2}):(\d{2})(?::(\d{2}))?\b/;
/** The receipt's own reference: a long run of digits, unbroken. */
const REFERENCE = /(?<![\d])\d{14,20}(?![\d])/;
function parseReceiptHtml(html) {
    const lines = textLines(html);
    const all = lines.join('\n');
    const rows = {};
    const missing = [];
    for (const { key, label } of ROW_LABELS) {
        const row = rowFor(lines, label);
        if (row === null)
            missing.push(label);
        else
            rows[key] = row;
    }
    const date = DATE.exec(all);
    const time = TIME.exec(all);
    const reference = REFERENCE.exec(all.replace(/[\s,]/g, ' '));
    const matched = /totals\s*matched|المجاميع\s*متوافقة/i.test(all);
    const notMatched = /totals\s*not\s*matched|المجاميع\s*غير\s*متوافقة/i.test(all);
    return {
        merchant: merchantOf(lines),
        reference: reference?.[0] ?? null,
        date: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
        time: time ? `${time[1]}:${time[2]}:${time[3] ?? '00'}` : null,
        totalsMatched: notMatched ? false : matched ? true : null,
        rows,
        missing,
    };
}
/**
 * The shop the receipt is for: the heading above the date. Taken by position in
 * the heading block rather than by a label, because the receipt prints the name
 * with no label of its own — so it is the one field returned on a best effort.
 */
function merchantOf(lines) {
    const end = lines.findIndex((line) => DATE.test(line));
    const heading = (end === -1 ? lines.slice(0, 6) : lines.slice(0, end))
        .map((line) => line.trim())
        .filter((line) => /[A-Za-z؀-ۿ]/.test(line) &&
        !/^mada$/i.test(line) &&
        !/^مدى$/.test(line) &&
        !/^\d+$/.test(line));
    return heading.length === 0 ? null : heading.join(' ').replace(/\s+/g, ' ').trim();
}

const header = (request, name) => {
    const value = request.headers[name];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};
/**
 * Best effort, and honestly so: a serverless function is many short-lived
 * instances, so a counter held in one of them sees only its own share of the
 * traffic. It stops a loop hammering a single instance; it is not a promise.
 */
const SEEN = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
function withinRate(key) {
    const now = Date.now();
    const hits = (SEEN.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    hits.push(now);
    SEEN.set(key, hits);
    // The map must not grow without bound across a warm instance's life.
    if (SEEN.size > 5000)
        SEEN.clear();
    return hits.length <= RATE_LIMIT;
}
function send(response, status, body, origin) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    // The receipt is a live figure and must never be held anywhere.
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('vary', 'Origin');
    if (origin === ALLOWED_ORIGIN) {
        response.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
        response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
        response.setHeader('access-control-allow-headers', 'content-type');
        response.setHeader('access-control-max-age', '86400');
    }
    response.end(status === 204 ? undefined : JSON.stringify(body));
}
const fail = (response, status, message, origin, upstream) => send(response, status, upstream === undefined ? { ok: false, error: message } : { ok: false, error: message, upstream }, origin);
/** Vercel parses JSON bodies itself; a string body is read as one anyway. */
function bodyOf(request) {
    if (typeof request.body === 'string') {
        try {
            return JSON.parse(request.body);
        }
        catch {
            return null;
        }
    }
    return request.body ?? null;
}
export default async function handler(request, response) {
    const origin = header(request, 'origin');
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
        return fail(response, 403, 'هذا الطلب ليس من موقع التقارير.', null);
    }
    if (request.method === 'OPTIONS')
        return send(response, 204, null, origin);
    if (request.method !== 'POST') {
        return fail(response, 405, 'استخدم POST مع رابط الإيصال في JSON.', origin);
    }
    if (!(header(request, 'content-type') ?? '').includes('application/json')) {
        return fail(response, 415, 'أرسل المحتوى بصيغة JSON.', origin);
    }
    if (Number(header(request, 'content-length') ?? '0') > MAX_BODY_BYTES) {
        return fail(response, 413, 'حجم الطلب أكبر مما يلزم.', origin);
    }
    if (!withinRate(header(request, 'x-forwarded-for') ?? 'unknown')) {
        return fail(response, 429, 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.', origin);
    }
    const body = bodyOf(request);
    if (body === null) {
        return fail(response, 400, 'تعذّرت قراءة الطلب: صيغته ليست JSON صالحة.', origin);
    }
    const checked = checkReceiptUrl(body.url);
    if ('error' in checked)
        return fail(response, 400, checked.error, origin);
    let upstream;
    try {
        upstream = await fetch(checked.url.toString(), {
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: BROWSER_HEADERS,
        });
    }
    catch (cause) {
        const timedOut = cause.name === 'TimeoutError';
        return fail(response, 504, timedOut ? 'انتهت مهلة جلب الإيصال.' : 'تعذّر الوصول إلى خادم الإيصال.', origin);
    }
    if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
        const { status, message } = upstreamMessage(upstream.status);
        return fail(response, status, message, origin, upstream.status);
    }
    const html = await upstream.text();
    if (html.length > MAX_PAGE_BYTES) {
        return fail(response, 502, 'صفحة الإيصال أكبر من الحد المسموح.', origin);
    }
    const receipt = parseReceiptHtml(html);
    if (receipt.rows.totalDb === undefined && receipt.rows.totalCr === undefined) {
        return fail(response, 422, 'الصفحة لا تبدو إيصال موازنة مدى.', origin);
    }
    // Only the figures leave here; the page itself is dropped with this scope.
    send(response, 200, { ok: true, receipt }, origin);
}
