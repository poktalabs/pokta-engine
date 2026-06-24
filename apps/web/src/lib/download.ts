/**
 * Trigger a client-side file download from in-memory text — no network round
 * trip and (deliberately) no public static-asset URL. The report data lives in
 * the app bundle, so a download is a Blob + object-URL click. This keeps the
 * file off a guessable `/reports/x.csv` path; true per-tenant isolation is a
 * later authed `GET /v1/reports/:id/download` endpoint (deferred).
 */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
