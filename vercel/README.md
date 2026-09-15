# قارئ إيصال مدى — نسخة Vercel

نفس الوسيط الموجود في `worker/`، على Vercel بدل Cloudflare.

**سبب وجوده:** SurePay يرد على Cloudflare Workers بـ**401** مهما كان شكل الطلب —
جُرّبت أربعة أشكال (Chrome كامل الترويسات، بلا ترويسات، أندرويد، والافتراضي)
وكلها رُفضت — بينما يُسلّم الصفحة نفسها لجهاز منزلي (`200`، و17,478 بايت، وفيها
`TOTAL DB`). فالحجب على عناوين Cloudflare. هذه النسخة تختبر ما إذا كان مركز
بيانات آخر يُعامَل معاملة مختلفة.

**لا يُوعد بالنجاح:** إن كان الحجب على مراكز البيانات عمومًا فسيُرفض هذا أيضًا.
الاختبار وحده يحسم.

**Node runtime لا Edge** — عمدًا: Edge في Vercel يعمل على شبكة Cloudflare نفسها،
وهي العناوين المرفوضة.

## ما يضمنه — نفس ضمانات النسخة الأولى

فحص الرابط والمهلة والحدود مشتركة حرفيًا مع الـ Worker (`worker/src/receiptUrl.ts`)،
ومحلّل الإيصال مشترك كذلك (`worker/src/parse.ts`)، فلا يمكن أن يفترق الاثنان:

| المتطلب | التنفيذ |
|---|---|
| الرابط في الجسم | `POST` + JSON `{ "url": "..." }`؛ `GET` يُرد بـ405 |
| النطاق | `d.surepay.sa` بالضبط، المسار `/r`، ومعامل `r` غير فارغ، وHTTPS |
| منع التحويل | `redirect: "manual"`، وأي 3xx يُرد بـ502 |
| مهلة | 10 ثوانٍ للجلب، و15 ثانية سقفًا للدالة |
| حد الحجم | 512KB للصفحة، 8KB للطلب |
| CORS | `https://basemoq.github.io` وحده |
| معدل الطلبات | 20/دقيقة لكل عنوان — **بذل وسع لا ضمان**: الدوال بلا حالة مشتركة، فالعدّاد يرى نصيب نسخته فقط |
| بلا تخزين ولا تسجيل | لا قاعدة بيانات، `cache-control: no-store`، ولا يُطبع الرابط ولا محتواه |
| JSON فقط | HTML الصفحة لا يغادر الدالة |

## النشر — من لوحة Vercel، بلا طرفية

1. <https://vercel.com/signup> ← **Continue with GitHub**.
2. **Add New…** ← **Project**.
3. اختر مستودع `sales-report-system` ← **Import**.
4. **مهم:** افتح **Root Directory** ← **Edit** ← اختر مجلّد `vercel` ← **Continue**.
5. Framework Preset: **Other** (ولا حاجة لأي أمر بناء).
6. **Deploy**.

ينتهي بعنوان مثل `https://<اسم-المشروع>.vercel.app`، ونقطة الدالة:
`https://<اسم-المشروع>.vercel.app/api/receipt`

كل دفعة إلى `main` تُحدّث الدالة تلقائيًا بعد ذلك.

## الاختبار

```powershell
$b = '{"url":"https://d.surepay.sa/r?r=...رابط الباركود..."}'
try { Invoke-RestMethod -Uri "https://<اسم-المشروع>.vercel.app/api/receipt" -Method Post -ContentType "application/json" -Body $b | ConvertTo-Json -Depth 6 }
catch { $_.ErrorDetails.Message }
```

- `{"ok":true,"receipt":{...}}` ← مرّ، ونكمل لربط الواجهة.
- `{"ok":false,...,"upstream":401}` ← Vercel محجوب أيضًا؛ عندها المسار الآلي مسدود
  من أي خادم عام، ويبقى «فتح الإيصال ← حفظ PDF ← رفعه».

## التطوير

المصدر في `src/handler.ts`، و`api/receipt.js` **مولَّد**:

```bash
node worker/build.mjs          # من جذر المستودع: يولّد نسختي Cloudflare وVercel
npx vitest run vercel/src      # 10 اختبارات
```
