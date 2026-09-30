import { useEffect, useState } from 'react'

type Dependency = {
  name: string
  ok: boolean
  required: boolean
  detail: string
  latency_ms: number
}
type Readiness = { status: 'ok' | 'degraded' | 'fail'; dependencies: Dependency[] }
type JobState = { job_id: string; status: 'queued' | 'done' | 'failed'; detail: string }

const SUMMARY: Record<Readiness['status'], { text: string; tone: string }> = {
  ok: { text: 'Все зависимости в порядке', tone: 'text-emerald-700' },
  degraded: { text: 'Обязательные в порядке, необязательные — нет', tone: 'text-amber-700' },
  fail: { text: 'Обязательная зависимость недоступна', tone: 'text-red-700' },
}

async function fetchReadiness(): Promise<Readiness> {
  // 503 тоже приходит с телом: какие зависимости легли и почему.
  const resp = await fetch('/api/health/ready')
  return (await resp.json()) as Readiness
}

async function runPingJob(): Promise<string> {
  const started = performance.now()
  const resp = await fetch('/api/jobs/ping', { method: 'POST' })
  if (!resp.ok) throw new Error(`POST /api/jobs/ping вернул ${resp.status}`)
  const { status_url } = (await resp.json()) as { status_url: string }
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const job = (await (await fetch(status_url)).json()) as JobState
    if (job.status === 'done') {
      return `${job.detail}, ${Math.round(performance.now() - started)} мс`
    }
  }
  throw new Error('воркер не ответил за 5 с')
}

function DependencyRow({ dep }: { dep: Dependency }) {
  const state = dep.ok ? 'в порядке' : dep.required ? 'недоступна' : 'недоступна (необязательная)'
  const dot = dep.ok ? 'bg-emerald-500' : dep.required ? 'bg-red-500' : 'bg-amber-400'
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-900">{dep.name}</span>
          <span className="text-sm text-slate-500">{state}</span>
          <span className="ml-auto text-xs tabular-nums text-slate-400">{dep.latency_ms} мс</span>
        </div>
        <p className="break-words text-sm text-slate-600">{dep.detail}</p>
      </div>
    </li>
  )
}

export default function App() {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ping, setPing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchReadiness().then(
      (result) => {
        if (cancelled) return
        setReadiness(result)
        setError(null)
      },
      (e: unknown) => {
        if (cancelled) return
        setReadiness(null)
        setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const checkQueue = async () => {
    setBusy(true)
    setPing(null)
    try {
      setPing(`Очередь работает: ${await runPingJob()}`)
    } catch (e) {
      setPing(`Очередь не работает: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-[#1f4e8c]">TenderHack Казань 2026</p>
        <h1 className="mt-1 text-2xl font-semibold">Каркас: состояние системы</h1>
        <p className="mt-2 text-slate-600">
          Кейс «Автозаполнение ключевых характеристик в СТЕ». Интерфейс продукта появится на
          хакатоне; пока здесь проверка инфраструктуры.
        </p>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Зависимости</h2>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Проверить снова
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-700">API не отвечает: {error}</p>}
          {readiness && (
            <>
              <p className={`mt-3 text-sm font-medium ${SUMMARY[readiness.status].tone}`}>
                {SUMMARY[readiness.status].text}
              </p>
              <ul className="mt-2 divide-y divide-slate-100">
                {readiness.dependencies.map((dep) => (
                  <DependencyRow key={dep.name} dep={dep} />
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Очередь задач</h2>
          <p className="mt-1 text-sm text-slate-600">
            API → RabbitMQ → воркер → Redis: проверочная задача проходит весь путь.
          </p>
          <button
            type="button"
            onClick={() => void checkQueue()}
            disabled={busy}
            className="mt-3 rounded-md bg-[#1f4e8c] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#183f72] disabled:opacity-60"
          >
            {busy ? 'Ждём воркер…' : 'Отправить задачу'}
          </button>
          {ping && <p className="mt-3 text-sm text-slate-700">{ping}</p>}
        </section>
      </div>
    </main>
  )
}
