import { findByCode, findByMoment, parseReceiptPayload } from '../core/scan'
import type { CacoTransaction } from '../core/sources/caco'
import { formatMoney } from './format'
import { Icon } from './Icon'

/**
 * What the code on an uploaded photograph turned out to be.
 *
 * It sits with the upload rather than in a scanner of its own: the photograph
 * is already being taken for the receipt's figures, and the code on it is read
 * from the same picture. There is nothing here to press and nothing to read
 * when no photograph carried a code — the section simply is not there.
 */
export function ReceiptCode({
  found,
  transactions,
}: {
  found: { code: string; payload: string | null } | null
  transactions: readonly CacoTransaction[]
}) {
  if (found === null) return null

  const receipt = parseReceiptPayload(found.payload ?? found.code)

  // The receipt may be inside the code rather than named by it, so both the
  // code and what it unpacks to are searched.
  const byNumber = findByCode([found.code, found.payload].filter(Boolean).join('\n'), transactions)

  // The code's reference belongs to the payment network, not to CACO, so most
  // receipts are found by the moment they stamp instead.
  const byMoment = byNumber.length === 0 ? findByMoment(receipt, transactions) : []
  const matches = byNumber.length > 0 ? byNumber : byMoment

  const isLink = /^https?:\/\//i.test(found.code.trim())

  return (
    <div className="panel-card no-print">
      <h3>
        <Icon name="scan" />
        باركود الإيصال
      </h3>

      <div className="note ok">
        <Icon name="success" />
        <p>قُرئ الباركود من الصورة المرفوعة.</p>
      </div>

      {/*
        * The receipt itself lives on the issuer's server, not in the code, and
        * a browser will not let this page read another site's response. So the
        * link is opened rather than fetched — from there the browser's own
        * «حفظ بصيغة PDF» produces a file that can be uploaded here like any
        * other mada receipt.
        */}
      {isLink && (
        <div className="upload-actions">
          <a
            className="button-link"
            href={found.code}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="document" />
            فتح إيصال مدى
          </a>
        </div>
      )}

      {matches.length > 0 && (
        <>
          {byNumber.length === 0 && (
            <p className="muted">
              لم يحمل الرمز رقمًا من أرقام CACO، فعُثر على العمليات بوقت الإيصال نفسه.
            </p>
          )}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الوقت</th>
                  <th>المبلغ</th>
                  <th>الوصف</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((transaction, index) => (
                  <tr key={`${transaction.receiptNo ?? index}-${index}`}>
                    <td>{transaction.userFullName ?? transaction.userId}</td>
                    <td>{transaction.time ?? '—'}</td>
                    <td className="num">{formatMoney(transaction.amount)}</td>
                    <td>{transaction.orderType ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
