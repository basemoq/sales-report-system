# قارئ إيصال مدى (Cloudflare Worker)

وسيط واحد الغرض: يجلب صفحة إيصال موازنة مدى التي يفتحها باركود جهاز SurePay،
ويعيد أرقامها بصيغة JSON. سبب وجوده أن المتصفح لا يستطيع قراءة استجابة نطاق آخر
(CORS)، وليس أكثر من ذلك.

**ليس بروكسي عامًا.** يرفض أي رابط قبل إرسال أي طلب ما لم يكن:
`https` + المضيف `d.surepay.sa` بالضبط + المسار `/r` + معامل `r` غير فارغ.
ويرفض النطاقات الفرعية، والنطاق المجرّد، والروابط التي تحمل اسم مستخدم/كلمة مرور.

## ما يضمنه

| المتطلب | التنفيذ |
|---|---|
| الرابط في الجسم لا في الـ query | `POST` + JSON `{ "url": "..." }` فقط؛ `GET` يُرد بـ405 |
| CORS | `https://basemoq.github.io` وحده؛ أي أصل آخر يُرد بـ403 بلا ترويسة |
| منع التحويل | `redirect: "manual"`، وأي 3xx يُرد بـ502 ولا يُتابَع |
| مهلة | 10 ثوانٍ عبر `AbortSignal.timeout` |
| حد الحجم | 512KB للصفحة ويُقطع التحميل عند تجاوزه، و8KB للطلب |
| معدل الطلبات | 20 طلبًا/دقيقة لكل عنوان (`RECEIPT_LIMITER`) |
| بلا تخزين | لا KV ولا D1 ولا R2، `observability` مطفأ، و`cache-control: no-store` |
| بلا تسجيل | لا يُطبع الرابط ولا محتواه، ولا يُعاد في نص أي خطأ |
| أخطاء عربية | كل الرسائل عربية ولا تكرّر المُدخل |
| بلا أسرار | لا مفاتيح ولا رموز، لا في الـ Worker ولا في الواجهة |

## النشر — من لوحة Cloudflare، بلا طرفية

`dist/worker.js` ملف واحد جاهز للصق:

1. افتح <https://dash.cloudflare.com> وسجّل الدخول (أنشئ حسابًا مجانيًا إن لزم).
2. من القائمة اليمنى: **Compute (Workers)** ← **Create**.
3. **Start with Hello World!** ← **Get started**.
4. الاسم: `surepay-receipt-reader` ← **Deploy**.
5. بعد النشر: **Edit code**.
6. حدّد كل الكود (Ctrl+A) واحذفه، ثم الصق محتوى `worker/dist/worker.js` كاملًا.
7. **Deploy** ← **Save and deploy**.
8. انسخ العنوان: `https://surepay-receipt-reader.<اسم-حسابك>.workers.dev`

### تحديد معدل الطلبات (بعد النشر)

محرّر اللوحة لا يقرأ `wrangler.toml`، فيُضاف الربط يدويًا:
**Settings** ← **Bindings** ← **Add binding** ← **Rate limiting** ← الاسم
`RECEIPT_LIMITER`، الحد `20` لكل `60` ثانية ← **Deploy**.
الكود يعمل بدونه لكن بلا أي حدّ للطلبات.

### أو من الطرفية

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy      # يقرأ wrangler.toml ومعه ربط تحديد المعدل
```

## الاختبار على إيصال حقيقي

امسح باركودًا **حديثًا** من الجهاز، وضع رابطه مكان `RECEIPT_URL`:

```bash
WORKER=https://surepay-receipt-reader.<اسم-حسابك>.workers.dev
RECEIPT_URL='https://d.surepay.sa/r?r=...'

curl -s -X POST "$WORKER" \
  -H 'content-type: application/json' \
  -H 'origin: https://basemoq.github.io' \
  -d "{\"url\":\"$RECEIPT_URL\"}"
```

النتيجة المتوقعة:

```json
{
  "ok": true,
  "receipt": {
    "merchant": "WINDTEL Telecom ...",
    "reference": "2332054800406708",
    "date": "2026-09-14",
    "time": "23:50:01",
    "totalsMatched": true,
    "rows": {
      "totalDb": { "count": 14, "amount": 1406.85 },
      "totalCr": { "count": 0, "amount": 0 },
      "naqd": { "count": 0, "amount": 0 },
      "cadv": { "count": 0, "amount": 0 },
      "auth": { "count": 0, "amount": 0 }
    },
    "missing": []
  }
}
```

`missing` يسرد أي حقل لم يُعثر عليه.

وللتأكد من أنه ليس بروكسيًا عامًا:

```bash
curl -s -X POST "$WORKER" -H 'content-type: application/json' \
  -H 'origin: https://basemoq.github.io' \
  -d '{"url":"https://example.com/r?r=1"}'
# {"ok":false,"error":"لا يُقبل إلا رابط d.surepay.sa."}
```

## التطوير

```bash
npx wrangler dev --local --port 8788   # تشغيل محلي
npm run typecheck
node build.mjs                         # يعيد توليد dist/worker.js من المصدر
npx vitest run worker/src              # من جذر المستودع: 41 اختبارًا
```

`dist/worker.js` مولَّد — عدّل `src/` ثم أعد توليده؛ ولا تحرّره في لوحة
Cloudflare، فالتحرير هناك يضيع مع أول إعادة نشر.
