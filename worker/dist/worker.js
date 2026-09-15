/*
 * قارئ إيصال مدى — ملف واحد للصق في محرّر Cloudflare Workers.
 * المصدر: worker/src في مستودع sales-report-system. لا تحرّره هنا؛ عدّل المصدر ثم
 * أعد توليد هذا الملف بـ node build.mjs
 */

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

/**
 * A single-purpose reader for one thing: the mada reconciliation receipt that a
 * SurePay terminal's QR code points at. The browser cannot read that page
 * itself — it is another origin and sends no CORS headers — so this stands in
 * the middle, and is deliberately narrow: one host, one path, one shape of
 * request, and nothing kept afterwards.
 *
 * It is not a proxy. A link to anywhere else is refused before any request is
 * made, and the page's HTML never leaves here — only the figures read out of it.
 */
const ALLOWED_ORIGIN = 'https://basemoq.github.io';
const ALLOWED_HOST = 'd.surepay.sa';
const ALLOWED_PATH = '/r';
/** A receipt link is a few hundred characters; anything longer is not one. */
const MAX_URL_LENGTH = 4096;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
/**
 * Arabic, and never an echo of what was sent: the input is not repeated back.
 * `upstream` carries the receipt server's own status code when it answered —
 * a number, never any of its content — because without it a failure cannot be
 * told apart from an expired link.
 */
const fail = (status, message, origin, upstream) => json(upstream === undefined ? { ok: false, error: message } : { ok: false, error: message, upstream }, status, origin);
function json(body, status, origin) {
    // 204 carries no body, so a preflight answers with headers alone.
    return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: responseHeaders(origin),
    });
}
function responseHeaders(origin) {
    const headers = new Headers({
        'content-type': 'application/json; charset=utf-8',
        // The receipt is a live figure and must never be held anywhere.
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        vary: 'Origin',
    });
    if (origin === ALLOWED_ORIGIN) {
        headers.set('access-control-allow-origin', ALLOWED_ORIGIN);
        headers.set('access-control-allow-methods', 'POST, OPTIONS');
        headers.set('access-control-allow-headers', 'content-type');
        headers.set('access-control-max-age', '86400');
    }
    return headers;
}
/**
 * The one link this accepts. Everything is checked explicitly rather than by a
 * pattern over the string: scheme, host as a whole (so `d.surepay.sa.evil.com`
 * and any other subdomain are refused), path, and the presence of the receipt's
 * own parameter. Credentials in the URL are refused too — they have no place in
 * a receipt link and are a way to dress one host up as another.
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
/** Reads at most the cap, and stops the transfer rather than buffering more. */
async function readCapped(response) {
    const body = response.body;
    if (body === null)
        return null;
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > MAX_PAGE_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(merged);
}
/**
 * The shapes a request to the receipt server can take. The first is what a
 * normal read uses; the rest exist because the page opens in a phone browser
 * but answered a plain request with 401, and the only way to find out which
 * part of a browser's request it wants is to ask it.
 */
const VARIANTS = [
    {
        name: 'browser',
        headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'ar,en;q=0.8',
            'user-agent': BROWSER_UA,
        },
    },
    {
        name: 'full-browser',
        headers: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'ar-SA,ar;q=0.9,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'user-agent': BROWSER_UA,
        },
    },
    { name: 'bare', headers: {} },
    {
        name: 'android',
        headers: {
            accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
            'accept-language': 'ar-SA,ar;q=0.9',
            'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
        },
    },
];
/**
 * Tries each shape and reports what came back — the status, the size, and
 * whether the page carried the receipt's own heading. Never any of the content
 * itself. This is how a refusal is diagnosed without redeploying per guess.
 */
async function probe(url) {
    const results = [];
    for (const { name, headers } of VARIANTS) {
        try {
            const response = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers,
            });
            const body = response.ok ? await readCapped(response) : null;
            results.push({
                variant: name,
                status: response.status,
                bytes: body?.length,
                looksLikeReceipt: body === null ? undefined : /TOTAL\s*DB/i.test(body),
            });
        }
        catch (cause) {
            results.push({ variant: name, status: cause.name });
        }
    }
    return results;
}
export default {
    async fetch(request, env) {
        const origin = request.headers.get('origin');
        // A browser may only call this from the app; a call with no origin at all
        // (curl, a health check) is allowed but gets no CORS grant.
        if (origin !== null && origin !== ALLOWED_ORIGIN) {
            return fail(403, 'هذا الطلب ليس من موقع التقارير.', null);
        }
        if (request.method === 'OPTIONS')
            return json({ ok: true }, 204, origin);
        if (request.method !== 'POST') {
            return fail(405, 'استخدم POST مع رابط الإيصال في JSON.', origin);
        }
        if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
            return fail(415, 'أرسل المحتوى بصيغة JSON.', origin);
        }
        const length = Number(request.headers.get('content-length') ?? '0');
        if (length > MAX_BODY_BYTES)
            return fail(413, 'حجم الطلب أكبر مما يلزم.', origin);
        if (env.RECEIPT_LIMITER) {
            const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
            const { success } = await env.RECEIPT_LIMITER.limit({ key });
            if (!success)
                return fail(429, 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.', origin);
        }
        let body;
        try {
            body = await request.json();
        }
        catch {
            return fail(400, 'تعذّرت قراءة الطلب: صيغته ليست JSON صالحة.', origin);
        }
        const checked = checkReceiptUrl(body?.url);
        if ('error' in checked)
            return fail(400, checked.error, origin);
        // `diagnose` reports which shape of request the receipt server accepts,
        // and returns statuses only — never a line of the page.
        if (body.diagnose === true) {
            return json({ ok: true, probe: await probe(checked.url.toString()) }, 200, origin);
        }
        let upstream;
        try {
            upstream = await fetch(checked.url.toString(), {
                // A redirect is never followed: the check above would be worthless if
                // the first response could send this anywhere it liked.
                redirect: 'manual',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: {
                    accept: 'text/html,application/xhtml+xml',
                    'accept-language': 'ar,en;q=0.8',
                    // The receipt page is meant for a phone browser and some hosts turn
                    // away anything that does not look like one.
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
                },
            });
        }
        catch (cause) {
            const timedOut = cause.name === 'TimeoutError';
            return fail(504, timedOut ? 'انتهت مهلة جلب الإيصال.' : 'تعذّر الوصول إلى خادم الإيصال.', origin);
        }
        if (upstream.status >= 300 && upstream.status < 400) {
            return fail(502, 'الإيصال يحوّل إلى عنوان آخر، ولم يُتابَع التحويل.', origin, upstream.status);
        }
        if (upstream.status === 404 || upstream.status === 410) {
            return fail(404, 'لم يعد هذا الإيصال متاحًا على خادم مدى.', origin, upstream.status);
        }
        if (upstream.status === 403 || upstream.status === 401) {
            return fail(502, 'خادم الإيصال رفض الطلب.', origin, upstream.status);
        }
        if (!upstream.ok) {
            return fail(502, 'خادم الإيصال لم يُرجع صفحة صالحة.', origin, upstream.status);
        }
        const html = await readCapped(upstream);
        if (html === null)
            return fail(502, 'صفحة الإيصال أكبر من الحد المسموح.', origin);
        const receipt = parseReceiptHtml(html);
        if (receipt.rows.totalDb === undefined && receipt.rows.totalCr === undefined) {
            return fail(422, 'الصفحة لا تبدو إيصال موازنة مدى.', origin);
        }
        // Only the figures leave here; the page itself is dropped with this scope.
        return json({ ok: true, receipt }, 200, origin);
    },
};
