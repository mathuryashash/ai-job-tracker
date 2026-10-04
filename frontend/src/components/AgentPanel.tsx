import { useState } from 'react';

// Agent panel: streams NDJSON steps from /api/agent/run, shows the approval gate
// for writes (save_to_tracker) and resumes the paused run via /api/agent/resume.
type Ev = Record<string, any>;

async function streamNdjson(url: string, body: object, onEvent: (e: Ev) => void) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

function describe(e: Ev): string {
  if (e.event === 'step') {
    if (e.node === 'agent') return e.tool_calls?.length
      ? `agent → ${e.tool_calls.map((c: Ev) => `${c.name}(${c.args})`).join(', ')}`
      : 'agent → final answer';
    if (e.node === 'tools') return `${e.tool}: ${e.ok ? 'ok' : 'ERROR ' + e.error}${e.attempts > 1 ? ` (attempts ${e.attempts})` : ''} ${JSON.stringify(e.result || {})}`;
    if (e.node === 'approval') return `human: approved ${e.approved.length}, rejected ${e.rejected.length}`;
    if (e.node === 'reflect') return `check: ${e.verdict}${e.issues?.length ? ' — ' + e.issues.join(' ') : ''}`;
  }
  if (e.event === 'paused') return 'paused — waiting for your approval';
  if (e.event === 'finished') return `finished: ${e.status} (steps ${e.steps}, tokens ${e.tokens}, saves ${e.saves_done})`;
  return '';
}

export default function AgentPanel({ onSaved }: { onSaved?: () => void }) {
  const [task, setTask] = useState('find remote python backend jobs and shortlist the best 3');
  const [events, setEvents] = useState<Ev[]>([]);
  const [pending, setPending] = useState<Ev[] | null>(null);
  const [thread, setThread] = useState('');
  const [final, setFinal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onEvent = (e: Ev) => {
    if (e.thread_id) setThread(e.thread_id);
    if (e.event === 'interrupt') setPending(e.payload.flatMap((p: Ev) => p.pending || []));
    if (e.event === 'finished') { setFinal(e.final || ''); setPending(null); if (e.saves_done) onSaved?.(); }
    if (e.event !== 'interrupt') setEvents(prev => [...prev, e]);
  };

  const go = async (url: string, body: object) => {
    setBusy(true); setError('');
    try { await streamNdjson(url, body, onEvent); } catch (err: any) { setError(String(err.message || err)); }
    setBusy(false);
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h2>Job Agent</h2>
      <p className="text-muted text-sm">Plans with tools (search, fetch, analyze fit, tailor bullets, save). Every write waits for your approval.</p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input className="input" style={{ flex: 1 }} value={task} onChange={e => setTask(e.target.value)} disabled={busy} />
        <button className="btn btn-primary" disabled={busy || task.trim().length < 3}
          onClick={() => { setEvents([]); setFinal(''); setPending(null); go('/api/agent/run', { task }); }}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </div>
      {error && <div className="text-sm" style={{ color: '#ef4444' }}>{error}</div>}
      <ol className="text-sm" style={{ fontFamily: 'monospace', lineHeight: 1.6 }}>
        {events.map((e, i) => describe(e) && <li key={i}>{describe(e)}</li>)}
      </ol>
      {pending && pending.length > 0 && !busy && (
        <div className="card" style={{ padding: 16, border: '1px solid #f59e0b' }}>
          <strong>Approval required</strong>
          <ul>{pending.map(p => <li key={p.call_id}>{p.tool}: {p.job?.title} @ {p.job?.company} ({p.args?.status || 'todo'})</li>)}</ul>
          <button className="btn btn-primary" onClick={() => go('/api/agent/resume', { thread_id: thread, decision: 'approve' })}>Approve</button>{' '}
          <button className="btn" onClick={() => go('/api/agent/resume', { thread_id: thread, decision: 'reject' })}>Reject</button>
        </div>
      )}
      {final && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{final}</pre>}
    </div>
  );
}
