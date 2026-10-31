import { useState } from 'react'
import { api } from '../api.js'
import { Modal, Button, Field, inputClass, Alert } from './ui.jsx'
import { AlertCircle } from 'lucide-react'
import Dropdown from './Dropdown.jsx'

const MODES = [
  { value: 'standalone', label: 'Standalone' },
  { value: 'managed', label: 'Managed by MM' }
]

const EMPTY = { name: '', ipAddress: '', port: '4343', mode: 'standalone', configNodePath: '', username: '', password: '' }

/** Add (controller = null) or edit an existing controller. */
export default function ControllerForm({ open, controller, onClose, onSaved }) {
  const editing = Boolean(controller)
  const [form, setForm] = useState(() =>
    controller ? { ...EMPTY, ...controller, port: String(controller.port), password: '' } : EMPTY
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const input = { ...form, port: form.port === '' ? 4343 : Number(form.port) }
      const saved = editing ? await api.controllers.update(controller.id, input) : await api.controllers.create(input)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit controller' : 'Add controller'}
      subtitle="Aruba Mobility Controller running ArubaOS 8.x (REST API)"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} type="submit" form="controller-form">
            {editing ? 'Save changes' : 'Add controller'}
          </Button>
        </>
      }
    >
      <form id="controller-form" onSubmit={submit} className="space-y-4">
        {error && (
          <Alert tone="red" icon={AlertCircle}>
            {error}
          </Alert>
        )}
        <Field label="Name" required>
          <input className={inputClass} value={form.name} onChange={set('name')} placeholder="HQ Mobility Controller" autoFocus />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="IP Address" required>
            <input className={inputClass} value={form.ipAddress} onChange={set('ipAddress')} placeholder="10.0.0.2" />
          </Field>
          <Field label="Port">
            <input
              className={inputClass}
              value={form.port}
              inputMode="numeric"
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
              placeholder="4343"
            />
          </Field>
        </div>
        <Field as="div" label="Mode" required>
          <Dropdown options={MODES} value={form.mode} onChange={(mode) => setForm((f) => ({ ...f, mode }))} ariaLabel="Mode" />
        </Field>
        <Field
          label="Config Node Path"
          hint="For example /mm/mynode. Some controllers need it even in Standalone mode, or writes fail with 401. Leave empty to not send config_path."
        >
          <input className={inputClass} value={form.configNodePath} onChange={set('configNodePath')} placeholder="/mm/mynode" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" required>
            <input className={inputClass} value={form.username} onChange={set('username')} autoComplete="off" />
          </Field>
          <Field label="Password" required={!editing} hint={editing ? 'Leave empty to keep the saved password.' : undefined}>
            <input className={inputClass} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
        </div>
        <p className="text-xs text-subtle">
          The password is encrypted with this computer's {window.zeta.platform === 'win32' ? 'Windows (DPAPI)' : 'macOS Keychain'}{' '}
          secure storage and never leaves Zeta.
        </p>
      </form>
    </Modal>
  )
}
