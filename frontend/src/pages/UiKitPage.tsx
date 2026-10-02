import { useState, type ReactNode } from 'react'
import { IconBolt, IconDeviceFloppy, IconInbox } from '@tabler/icons-react'
import { PageBody, PageHeader } from '../layout/Layout'
import {
  Badge,
  Button,
  Checkbox,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  Input,
  Kbd,
  Notice,
  Panel,
  Radio,
  Select,
  Skeleton,
  Steps,
  Table,
  Tabs,
  Textarea,
  type Column,
} from '../ui'

const NBSP = String.fromCharCode(160)

const COLORS: Array<{ token: string; role: string }> = [
  { token: 'ink', role: 'текст и главная кнопка' },
  { token: 'muted', role: 'вторичный текст' },
  { token: 'mark', role: 'маркер: найдено в описании' },
  { token: 'pencil', role: 'карандаш: исправлено, ошибка' },
  { token: 'surface', role: 'лист, панели' },
  { token: 'raised', role: 'наведение, поля' },
  { token: 'line', role: 'разделители' },
  { token: 'canvas', role: 'фон страницы' },
]

const TYPE_SCALE = [
  { role: 'Заголовок экрана', spec: 'Onest 26 / 600', className: 'text-[26px] font-semibold tracking-tight' },
  { role: 'Текст документа поставщика', spec: 'PT Serif 17', className: 'font-serif text-[17px]' },
  { role: 'Основной текст', spec: 'sans 14 / 400', className: 'text-sm' },
  { role: 'Подпись', spec: 'sans 12 / 400', className: 'text-xs text-muted' },
  { role: '0123-456789, 4 812,5', spec: 'mono 13 / 500', className: 'font-mono text-[13px] font-medium' },
]

type Service = { name: string; image: string; port: string; up: boolean; note: string }

const SERVICES: Service[] = [
  { name: 'postgres', image: 'pgvector/pgvector:pg17', port: '5432', up: true, note: 'справочники' },
  { name: 'redis', image: 'redis:7-alpine', port: '6379', up: true, note: 'кэш' },
  { name: 'rabbitmq', image: 'rabbitmq:4-management-alpine', port: '5672', up: true, note: 'очередь' },
  { name: 'api', image: 'tenderhack-kazan-backend', port: '8000', up: true, note: 'FastAPI' },
  { name: 'ollama', image: 'ollama/ollama', port: '11434', up: false, note: 'модель не подключена' },
]

const SERVICE_COLUMNS: Column<Service>[] = [
  { key: 'name', header: 'Сервис', render: (s) => <span className="font-medium" translate="no">{s.name}</span> },
  { key: 'image', header: 'Образ', render: (s) => <span className="break-all font-mono text-[12px] text-muted" translate="no">{s.image}</span> },
  { key: 'note', header: 'Роль', render: (s) => s.note },
  { key: 'state', header: 'Состояние', render: (s) => <Badge tone={s.up ? 'success' : 'danger'}>{s.up ? 'Запущен' : 'Остановлен'}</Badge> },
  { key: 'port', header: 'Порт', align: 'right', render: (s) => s.port },
]

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium text-muted">{title}</h3>
      {children}
    </div>
  )
}

function Foundation() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Panel title="Цвета" description="Цвет только со смыслом: маркер отмечает найденное, красный карандаш исправленное.">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map((c) => (
            <li key={c.token} className="flex flex-col gap-2">
              <span
                className="h-14 rounded-(--radius-ui) border border-line"
                style={{ backgroundColor: `var(--color-${c.token})` }}
                aria-hidden="true"
              />
              <span className="font-mono text-[12px] font-medium" translate="no">{c.token}</span>
              <span className="-mt-1.5 text-xs text-muted">{c.role}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Шрифты" description="Onest для интерфейса, PT Serif для текста документа, JetBrains Mono для кодов. Всё из своих файлов.">
        <ul className="flex flex-col divide-y divide-line">
          {TYPE_SCALE.map((t) => (
            <li key={t.role} className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <span className={t.className}>{t.role}</span>
              <span className="shrink-0 font-mono text-[11px] text-subtle">{t.spec}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

function Controls() {
  const [mode, setMode] = useState('online')
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Кнопки">
        <div className="flex flex-col gap-6">
          <Group title="Варианты">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<IconBolt />}>Разобрать</Button>
              <Button>Отмена</Button>
              <Button variant="ghost">Подробнее</Button>
              <Button kbd="Ctrl K">Команды</Button>
            </div>
          </Group>
          <Group title="Размеры и состояния">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" icon={<IconDeviceFloppy />}>Сохранить</Button>
              <Button variant="primary" loading loadingText="Сохраняем…">Сохранить</Button>
              <Button size="sm">Маленькая</Button>
              <Button disabled>Недоступно</Button>
            </div>
          </Group>
          <Group title="Клавиши">
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              Палитра команд <Kbd>Ctrl</Kbd><Kbd>K</Kbd>, применить исправление <Kbd>Enter</Kbd>
            </p>
          </Group>
        </div>
      </Panel>
      <Panel title="Поля" description="Подпись над полем, подсказка и ошибка под ним.">
        <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Провайдер">
              {({ id, describedBy }) => (
                <Select id={id} name="llm_provider" aria-describedby={describedBy} defaultValue="ollama">
                  <option value="ollama">Ollama</option>
                  <option value="openai">OpenAI-совместимый сервер</option>
                </Select>
              )}
            </Field>
            <Field label="Модель чата" error="Модель qwen3:8b не найдена на сервере">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="llm_chat_model"
                  autoComplete="off"
                  spellCheck={false}
                  translate="no"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  defaultValue="qwen3:8b"
                  className="font-mono text-[13px]"
                />
              )}
            </Field>
          </div>
          <Field label="Адрес сервера" hint="Например, http://gpu-server:8000/v1" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="llm_base_url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy}
                placeholder="http://…"
                required
                className="font-mono text-[13px]"
              />
            )}
          </Field>
          <Field label="Комментарий">
            {({ id, describedBy }) => (
              <Textarea id={id} name="comment" autoComplete="off" aria-describedby={describedBy} placeholder="Что проверяли и с каким результатом…" />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-[13px] font-medium">Режим обработки</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Radio name="mode" value="online" label="Онлайн" checked={mode === 'online'} onChange={() => setMode('online')} />
              <Radio name="mode" value="batch" label="Пакетный" checked={mode === 'batch'} onChange={() => setMode('batch')} />
              <Radio name="mode" value="off" label="Выключен" disabled />
            </div>
          </fieldset>
          <Checkbox label="Не запускать API без модели" />
        </form>
      </Panel>
    </div>
  )
}

function Statuses() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Сообщения">
        <div className="flex flex-col gap-3">
          <Notice tone="accent" title="Технические работы">Сервер моделей будет недоступен с 20:00 до 22:00.</Notice>
          <Notice tone="success" title="Проверка пройдена">Все сервисы на связи.</Notice>
          <Notice tone="warning" title="Модель не отвечает">Решение работает без функций, которым нужна модель.</Notice>
          <Notice tone="danger" title="База недоступна">Проверьте, что контейнер postgres запущен.</Notice>
        </div>
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel title="Бейджи">
          <div className="flex flex-wrap gap-2">
            <Badge>Черновик</Badge>
            <Badge tone="accent">В работе</Badge>
            <Badge tone="success">На связи</Badge>
            <Badge tone="warning">Уточнить</Badge>
            <Badge tone="danger">Ошибка</Badge>
            <Badge tone="neutral" mono>ОКЕИ 796</Badge>
          </div>
        </Panel>
        <Panel title="Пусто и загрузка">
          <div className="flex flex-col gap-5">
            <EmptyState icon={<IconInbox />} title="Задач пока нет">
              Здесь появятся пакетные задачи. Проверочную можно отправить на странице состояния.
            </EmptyState>
            <div className="flex flex-col gap-2" aria-label="Пример скелетона">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function DataViews() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Таблица" description="Строка с ошибкой подсвечена. На узком экране строки становятся карточками." flush>
        <Table
          caption="Сервисы docker compose"
          columns={SERVICE_COLUMNS}
          rows={SERVICES}
          rowKey={(s) => s.name}
          rowTone={(s) => (s.up ? undefined : 'danger')}
        />
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Параметры" description="Пунктир ведёт от названия к значению.">
          <DefinitionList
            items={[
              { term: 'Провайдер', value: 'Ollama' },
              { term: 'Модель чата', value: <span className="font-mono text-[13px]">qwen3:4b</span> },
              { term: 'Модель эмбеддингов', value: <span className="font-mono text-[13px]">bge-m3</span> },
              { term: 'Рассуждения', value: 'выключены' },
              { term: 'Ожидание ответа при проверке', value: `2${NBSP}с` },
            ]}
          />
        </Panel>
        <Panel title="Этапы и диалог">
          <div className="flex flex-col gap-6">
            <Steps
              label="Пример этапов"
              steps={[
                { id: 'parse', label: 'Разбор описания', state: 'done', hint: '8 характеристик' },
                { id: 'norm', label: 'Нормализация', state: 'done', hint: '3 единицы' },
                { id: 'ktru', label: 'Сужение КТРУ', state: 'active', hint: 'осталось 3 кода' },
                { id: 'check', label: 'Проверка', state: 'todo' },
              ]}
            />
            <div>
              <Button onClick={() => setOpen(true)}>Открыть диалог</Button>
            </div>
          </div>
        </Panel>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Как читать статусы"
        footer={<Button variant="primary" onClick={() => setOpen(false)}>Понятно</Button>}
      >
        <DefinitionList
          items={[
            { term: 'Зелёный', value: <Badge tone="success">На связи</Badge> },
            { term: 'Жёлтый', value: <Badge tone="warning">Уточнить</Badge> },
            { term: 'Красный', value: <Badge tone="danger">Ошибка</Badge> },
          ]}
        />
      </Dialog>
    </div>
  )
}

const TABS = ['foundation', 'controls', 'statuses', 'data']

/** Вкладка живёт в ?tab=: ссылку на раздел витрины можно отправить коллеге. */
function tabFromUrl(): string {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab && TABS.includes(tab) ? tab : TABS[0]
}

export function UiKitPage() {
  const [tab, setTabState] = useState(tabFromUrl)
  const setTab = (id: string) => {
    setTabState(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.replaceState(null, '', url)
  }
  return (
    <>
      <PageHeader title="Компоненты" description="Дизайн-система: токены, компоненты и состояния. Правила в DESIGN.md." />
      <Tabs
        label="Разделы витрины"
        value={tab}
        onChange={setTab}
        className="mt-4"
        listClassName="mx-auto max-w-[1320px]"
        items={[
          { id: 'foundation', label: 'Основа', content: <PageBody><Foundation /></PageBody> },
          { id: 'controls', label: 'Кнопки и поля', content: <PageBody><Controls /></PageBody> },
          { id: 'statuses', label: 'Статусы', content: <PageBody><Statuses /></PageBody> },
          { id: 'data', label: 'Данные', count: SERVICES.length, content: <PageBody><DataViews /></PageBody> },
        ]}
      />
    </>
  )
}
