import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  GlobalStyles,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material'
import { StyledEngineProvider } from '@mui/material/styles'
import { useState, type ReactNode } from 'react'
import { BRAND, MARK, PORTAL_BLUE, SAMPLE, segments } from './sample'

/*
 * Прототип нового дизайна (выбран 02.10.2026). Модуль не показывает отчёт о проверке, а заполняет саму форму
 * карточки: взятое из текста подсвечено, ошибка видна на поле, исправление — выбор в этом же поле.
 */

const theme = createTheme({
  palette: {
    primary: { main: PORTAL_BLUE },
    background: { default: '#f4f6f9' },
  },
  typography: {
    fontFamily: "'Onest Variable', system-ui, sans-serif",
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
})

type Field = {
  key: string
  label: string
  required: boolean
  options?: string[]
  unit?: string
  initial: string
  source?: string
  normalizedFrom?: string
}

const FIELDS: Field[] = [
  {
    key: 'format',
    label: 'Формат',
    required: true,
    options: ['А3', 'А4', 'А5'],
    initial: 'А4',
    source: 'А4',
  },
  {
    key: 'color',
    label: 'Цветность',
    required: true,
    options: ['Белая', 'Цветная'],
    initial: 'Цветная',
    source: 'цветная',
  },
  {
    key: 'intensity',
    label: 'Интенсивность цвета',
    required: true,
    options: ['Интенсив', 'Медиум', 'Неон', 'Пастель'],
    initial: 'Белый',
    source: 'Белый',
  },
  {
    key: 'mass',
    label: 'Масса бумаги площадью 1 м2',
    required: true,
    options: ['<80 г/м2', '>=80 … <90 г/м2', '>=90 г/м2'],
    initial: '>=80 … <90 г/м2',
    source: '80',
    normalizedFrom: '80',
  },
  {
    key: 'sheets',
    label: 'Количество листов в пачке',
    required: true,
    unit: 'шт',
    initial: '500',
    source: '500',
  },
  {
    key: 'colors',
    label: 'Количество цветов в пачке',
    required: false,
    unit: 'шт',
    initial: '',
  },
]

const BAD_NAME = '500л'
const EXAMPLE = [SAMPLE.name, ...SAMPLE.description].join('\n')
const EXAMPLES = [
  { label: 'Бумага с ошибками', text: EXAMPLE },
  {
    label: 'Перчатки',
    text: 'Перчатки смотровые нитриловые нестерильные неопудренные, размер M',
  },
  { label: 'Батарейка', text: 'Батарейка AA щелочная 1,5 В' },
]

function fieldError(f: Field, value: string): string | null {
  if (!value) return f.required ? 'Обязательная характеристика: в описании не нашли' : null
  if (f.options && !f.options.includes(value)) return `«${value}» нет в справочнике. Выберите значение из списка`
  if (f.unit && !/^\d+$/.test(value)) return 'Нужно целое число'
  return null
}

function helper(f: Field, value: string, error: string | null): ReactNode {
  if (error) return error
  if (value !== f.initial) return 'Изменено вами'
  if (!value) return 'В описании не нашли, можно оставить пустым'
  if (f.normalizedFrom) return `Из «${f.normalizedFrom}» в описании, приведено к значению справочника`
  return `Из описания: «${f.source}»`
}

function SourceText({ active }: { active: string | null }) {
  const marks = FIELDS.flatMap((f) => (f.source ? [f.source] : []))
  const activeSource = FIELDS.find((f) => f.key === active)?.source
  const render = (text: string) =>
    segments(text, marks).map((s, i) =>
      s.mark ? (
        <Box
          key={i}
          component="mark"
          sx={{
            background: MARK,
            color: 'inherit',
            borderRadius: '3px',
            px: '2px',
            outline: s.text === activeSource ? `2px solid ${PORTAL_BLUE}` : 'none',
            transition: 'outline-color .15s',
          }}
        >
          {s.text}
        </Box>
      ) : (
        <span key={i}>{s.text}</span>
      ),
    )
  return (
    <Box className="flex flex-col gap-1.5">
      <Typography variant="subtitle1" component="p" sx={{ fontWeight: 600 }}>
        {render(SAMPLE.name)}
      </Typography>
      {SAMPLE.description.map((line) => (
        <Typography key={line} variant="body2">
          {render(line)}
        </Typography>
      ))}
    </Box>
  )
}

function Composer({ onFill }: { onFill: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Paper variant="outlined" className="mx-auto mt-10 max-w-[760px] p-6 md:p-8">
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
        Новая СТЕ
      </Typography>
      <Typography variant="body1" color="text.secondary" className="mt-1">
        Вставьте наименование и описание товара как есть. Мы подберём позицию КТРУ и заполним характеристики.
      </Typography>
      <TextField
        className="mt-5"
        label="Наименование и описание"
        multiline
        minRows={5}
        fullWidth
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Box className="mt-3 flex flex-wrap items-center gap-2">
        <Typography variant="body2" color="text.secondary">
          Примеры:
        </Typography>
        {EXAMPLES.map((ex) => (
          <Chip key={ex.label} label={ex.label} onClick={() => setText(ex.text)} variant="outlined" />
        ))}
      </Box>
      <Box className="mt-6 flex justify-end">
        <Button variant="contained" size="large" disableElevation disabled={!text.trim()} onClick={() => onFill(text)}>
          Заполнить карточку
        </Button>
      </Box>
    </Paper>
  )
}

function FilledForm({ onRestart }: { onRestart: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, f.initial])))
  const [name, setName] = useState(SAMPLE.name)
  const [active, setActive] = useState<string | null>(null)
  const nameError = name.includes(BAD_NAME)
  const errors = FIELDS.filter((f) => fieldError(f, values[f.key]))
  const left = errors.length + (nameError ? 1 : 0)
  const auto = FIELDS.filter((f) => f.initial && values[f.key] === f.initial).length

  return (
    <Box className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Paper variant="outlined" className="overflow-hidden">
        <Box className="px-5 pt-5 pb-2 md:px-6">
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
            Новая СТЕ
          </Typography>
          <Typography variant="body2" color="text.secondary" className="mt-0.5">
            Заполнили {auto} из {FIELDS.length} характеристик по вашему описанию. Проверьте поля и отправьте карточку.
          </Typography>
        </Box>

        <Box className="flex flex-col gap-5 px-5 py-4 md:px-6">
          <TextField
            label="Наименование"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            helperText={
              nameError ? (
                <span className="flex flex-wrap items-center gap-x-2">
                  Значения с единицами указываются в характеристиках, а не в наименовании.
                  <Button size="small" onClick={() => setName(name.replace(` ${BAD_NAME}`, '').replace(BAD_NAME, ''))}>
                    Убрать «{BAD_NAME}»
                  </Button>
                </span>
              ) : (
                'Без значений с единицами: они идут в характеристики'
              )
            }
          />
          <TextField
            label="Позиция КТРУ"
            fullWidth
            value={`${SAMPLE.ktru.code}  ${SAMPLE.ktru.name}`}
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <Button size="small">Сменить</Button>
                  </InputAdornment>
                ),
              },
            }}
            helperText="Подобрали по словам: бумага, офисная, цветная, А4"
          />
        </Box>

        <Box className="px-5 pt-2 md:px-6">
          <Typography variant="h6" component="h2">
            Характеристики
          </Typography>
        </Box>
        <Box className="grid grid-cols-1 gap-x-5 gap-y-4 px-5 pt-3 pb-6 sm:grid-cols-2 md:px-6">
          {FIELDS.map((f) => {
            const value = values[f.key]
            const error = fieldError(f, value)
            const fromText = Boolean(f.source) && value === f.initial && !error
            const options = f.options && value && !f.options.includes(value) ? [...f.options, value] : f.options
            return (
              <TextField
                key={f.key}
                select={Boolean(f.options)}
                label={f.label}
                required={f.required}
                fullWidth
                value={value}
                error={Boolean(error)}
                helperText={helper(f, value, error)}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                onFocus={() => setActive(f.key)}
                onBlur={() => setActive(null)}
                sx={fromText ? { '& .MuiOutlinedInput-root': { bgcolor: '#fff9db' } } : undefined}
                slotProps={
                  f.unit
                    ? {
                        input: {
                          endAdornment: <InputAdornment position="end">{f.unit}</InputAdornment>,
                        },
                      }
                    : undefined
                }
              >
                {options?.map((o) => (
                  <MenuItem key={o} value={o} disabled={!f.options?.includes(o)}>
                    {f.options?.includes(o) ? o : `${o} (нет в справочнике)`}
                  </MenuItem>
                ))}
              </TextField>
            )
          })}
        </Box>

        <Box
          className="sticky bottom-0 flex flex-wrap items-center gap-3 px-5 py-3 md:px-6"
          sx={{
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }} color={left ? 'error' : 'success.main'}>
            {left ? `Осталось исправить: ${left}` : 'Карточка готова к отправке'}
          </Typography>
          <Box className="ml-auto flex gap-2">
            <Button startIcon={<RestartAltIcon />} onClick={onRestart}>
              Начать заново
            </Button>
            <Button variant="contained" disableElevation disabled={left > 0}>
              Отправить на модерацию
            </Button>
          </Box>
        </Box>
      </Paper>

      <Paper variant="outlined" className="p-5 lg:sticky lg:top-6">
        <Typography variant="overline" color="text.secondary">
          Ваше описание
        </Typography>
        <Box className="mt-1">
          <SourceText active={active} />
        </Box>
        <Typography variant="caption" color="text.secondary" className="mt-3 block">
          Жёлтым отмечено то, что мы взяли из текста. Фокус на поле показывает, откуда значение.
        </Typography>
      </Paper>
    </Box>
  )
}

type Role = 'supplier' | 'moderator'

/* Разделы каждой роли: поставщик заводит карточки, модератор портала их проверяет. */
const SECTIONS: Record<Role, { value: string; label: string }[]> = {
  supplier: [
    { value: 'create', label: 'Создание СТЕ' },
    { value: 'batch', label: 'Массовая загрузка' },
  ],
  moderator: [{ value: 'queue', label: 'Заявки' }],
}

const QUEUE = [
  { id: 12, name: SAMPLE.name, issues: 2 },
  { id: 11, name: 'Перчатки смотровые нитриловые нестерильные неопудренные, размер M', issues: 0 },
  { id: 10, name: 'Батарейка AA щелочная 1,5 В', issues: 0 },
]

/** Текст возврата поставщику из нарушений, найденных модулем. */
function remarks(): string {
  const lines = [`Наименование: значения с единицами указываются в характеристиках, а не в наименовании («${BAD_NAME}»).`]
  for (const f of FIELDS) {
    const error = fieldError(f, f.initial)
    if (error && f.options) lines.push(`${f.label}: «${f.initial}» нет в справочнике. Допустимые значения: ${f.options.join(', ')}.`)
    else if (error) lines.push(`${f.label}: ${error}.`)
  }
  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
}

function ModeratorView() {
  const [selected, setSelected] = useState(QUEUE[0].id)
  const [note, setNote] = useState(remarks)
  const [decision, setDecision] = useState<'approved' | 'returned' | null>(null)
  const item = QUEUE.find((q) => q.id === selected) ?? QUEUE[0]
  const withIssues = item.issues > 0
  return (
    <Box className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Paper variant="outlined" className="overflow-hidden">
        <Typography variant="h6" component="h2" className="px-4 pt-4 pb-2">
          Очередь
        </Typography>
        <List disablePadding>
          {QUEUE.map((q) => (
            <ListItemButton
              key={q.id}
              selected={q.id === selected}
              divider
              onClick={() => {
                setSelected(q.id)
                setDecision(null)
              }}
            >
              <ListItemText
                primary={q.name}
                secondary={
                  <Typography component="span" variant="caption" color={q.issues ? 'error' : 'success.main'}>
                    № {q.id}, {q.issues ? `замечаний модуля: ${q.issues}` : 'без замечаний'}
                  </Typography>
                }
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Paper variant="outlined" className="overflow-hidden">
        <Box className="px-5 pt-5 pb-2 md:px-6">
          <Typography variant="overline" color="text.secondary">
            Заявка № {item.id}
          </Typography>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
            {item.name}
          </Typography>
        </Box>
        {withIssues ? (
          <>
            <Box className="flex flex-col gap-5 px-5 py-4 md:px-6">
              <TextField
                label="Наименование"
                fullWidth
                value={item.name}
                error
                helperText="Модуль: значения с единицами указываются в характеристиках, а не в наименовании"
                slotProps={{ input: { readOnly: true } }}
              />
              <TextField
                label="Позиция КТРУ"
                fullWidth
                value={`${SAMPLE.ktru.code}  ${SAMPLE.ktru.name}`}
                slotProps={{ input: { readOnly: true } }}
              />
            </Box>
            <Box className="grid grid-cols-1 gap-x-5 gap-y-4 px-5 pt-1 pb-6 sm:grid-cols-2 md:px-6">
              {FIELDS.map((f) => {
                const error = fieldError(f, f.initial)
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    fullWidth
                    value={f.initial || 'не указано'}
                    error={Boolean(error)}
                    helperText={error ? `Модуль: ${error.replace('. Выберите значение из списка', '')}` : f.source ? `Взято из описания поставщика: «${f.source}»` : ' '}
                    sx={!error && f.source ? { '& .MuiOutlinedInput-root': { bgcolor: '#fff9db' } } : undefined}
                    slotProps={{
                      input: {
                        readOnly: true,
                        endAdornment: f.unit ? <InputAdornment position="end">{f.unit}</InputAdornment> : undefined,
                      },
                    }}
                  />
                )
              })}
            </Box>
          </>
        ) : (
          <Box className="px-5 pb-4 md:px-6">
            <Alert severity="success">Модуль не нашёл нарушений: карточку можно одобрить.</Alert>
          </Box>
        )}
        <Box className="flex flex-col gap-3 px-5 py-4 md:px-6" sx={{ borderTop: 1, borderColor: 'divider' }}>
          {decision ? (
            <Alert severity={decision === 'approved' ? 'success' : 'warning'}>
              {decision === 'approved' ? `Заявка № ${item.id} одобрена` : `Заявка № ${item.id} возвращена поставщику`}
            </Alert>
          ) : (
            <>
              {withIssues && (
                <TextField
                  label="Замечания поставщику"
                  helperText="Модуль подготовил текст по найденным нарушениям, его можно править"
                  multiline
                  minRows={3}
                  fullWidth
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
              <Box className="flex flex-wrap justify-end gap-2">
                {withIssues && (
                  <Button variant="contained" disableElevation onClick={() => setDecision('returned')}>
                    Вернуть с замечаниями
                  </Button>
                )}
                <Button variant={withIssues ? 'outlined' : 'contained'} disableElevation onClick={() => setDecision('approved')}>
                  Одобрить
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Paper>
    </Box>
  )
}

function Loading() {
  return (
    <Paper variant="outlined" className="overflow-hidden">
      <LinearProgress />
      <Box className="flex flex-col gap-4 p-6">
        <Typography variant="body2" color="text.secondary">
          Подбираем позицию КТРУ и заполняем характеристики…
        </Typography>
        {[0, 1, 2].map((i) => (
          <Box key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        ))}
      </Box>
    </Paper>
  )
}

export default function MuiFormScreen() {
  const [stage, setStage] = useState<'compose' | 'loading' | 'filled'>('filled')
  const [role, setRole] = useState<Role>('supplier')
  return (
    <StyledEngineProvider enableCssLayer>
      {/* Порядок слоёв объявляется первым стилем документа: MUI сильнее сброса Tailwind, утилиты Tailwind сильнее MUI. */}
      <GlobalStyles styles="@layer theme, base, mui, components, utilities;" />
      <ThemeProvider theme={theme}>
        <Box
          className="min-h-dvh"
          sx={{
            bgcolor: 'background.default',
            color: 'text.primary',
            fontFamily: theme.typography.fontFamily,
          }}
        >
          <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Toolbar className="mx-auto w-full max-w-[1280px] flex-wrap gap-x-6 gap-y-2 py-2 md:flex-nowrap md:py-0">
              <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
                {BRAND.name}
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                color="primary"
                value={role}
                onChange={(_, v: Role | null) => v && setRole(v)}
                aria-label="Роль"
              >
                <ToggleButton value="supplier">Поставщик</ToggleButton>
                <ToggleButton value="moderator">Модератор</ToggleButton>
              </ToggleButtonGroup>
              <Tabs
                value={SECTIONS[role][0].value}
                sx={{ alignSelf: 'stretch', '& .MuiTab-root': { minHeight: 64 } }}
                variant="scrollable"
                scrollButtons={false}
              >
                {SECTIONS[role].map((section) => (
                  <Tab key={section.value} value={section.value} label={section.label} />
                ))}
              </Tabs>
              <Box className="ml-auto hidden gap-1 md:flex">
                <Button color="inherit">Метрики</Button>
                <Button color="inherit">API</Button>
              </Box>
            </Toolbar>
          </AppBar>
          <Box component="main" className="mx-auto max-w-[1280px] px-4 pt-6 pb-12 md:px-6">
            {role === 'moderator' && <ModeratorView />}
            {role === 'supplier' && stage === 'compose' && (
              <Composer
                onFill={() => {
                  setStage('loading')
                  setTimeout(() => setStage('filled'), 900)
                }}
              />
            )}
            {role === 'supplier' && stage === 'loading' && <Loading />}
            {role === 'supplier' && stage === 'filled' && <FilledForm onRestart={() => setStage('compose')} />}
          </Box>
        </Box>
      </ThemeProvider>
    </StyledEngineProvider>
  )
}
