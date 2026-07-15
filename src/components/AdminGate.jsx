import { useState } from 'react'
import { API } from '../api'

// Shared PIN gate for every admin surface (/admin, /admin/launch/:address).
// The PIN is validated server-side (ADMIN_PIN) and never ships in the bundle; a
// pass sets sessionStorage 'adm' so the whole admin area unlocks for the session.
export default function AdminGate({ children }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem('adm') === '1')
  const [entry, setEntry] = useState('')
  const [err, setErr] = useState(false)

  async function submit(e) {
    e.preventDefault()
    try {
      const r = await fetch(API + '/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: entry }) }).then((x) => x.json())
      if (r.ok) { sessionStorage.setItem('adm', '1'); setAuthed(true) } else { setEntry(''); setErr(true) }
    } catch { setEntry(''); setErr(true) }
  }

  if (authed) return children
  return (
    <div className="main adm-gate">
      <form className="adm-pin" onSubmit={submit}>
        <div className="adm-pin-t">Admin access</div>
        <input autoFocus inputMode="numeric" maxLength={4} value={entry} onChange={(e) => { setEntry(e.target.value.replace(/\D/g, '')); setErr(false) }} placeholder="••••" style={err ? { borderColor: 'var(--red)' } : undefined} />
        <button type="submit">Enter</button>
      </form>
    </div>
  )
}
