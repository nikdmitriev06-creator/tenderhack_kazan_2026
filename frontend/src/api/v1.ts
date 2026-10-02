// Клиент модуля автозаполнения. Типы — из OpenAPI бэкенда (schema.d.ts, `npm run gen:api`), руками не пишутся.
import { ApiError, getJson, postForm, postJson } from './http.ts'
import type { components } from './schema'

type S = components['schemas']
export type AutofillOut = S['AutofillOut']
export type CharacteristicOut = S['CharacteristicOut']
export type KtruState = S['KtruState']
export type Question = S['Question']
export type Option = S['Option']
export type Candidate = S['Candidate']
export type Span = S['Span']
export type Issue = S['Issue']
export type CardIn = S['CardIn']
export type CharIn = S['CharIn']
export type CheckOut = S['CheckOut']
export type Position = S['Position']
export type BatchState = S['BatchState']
export type BatchRowResult = S['BatchRowResult']
export type BatchAccepted = S['BatchAccepted']
export type MetricsOut = S['MetricsOut']
export type MetricRow = S['MetricRow']
export type PortalReport = S['PortalReport']
export type AuditRule = S['AuditRule']
export type AuditExample = S['AuditExample']
export type Submission = S['Submission']
export type SubmissionView = S['SubmissionView']
export type SubmissionIn = S['SubmissionIn']
export type DecisionIn = S['DecisionIn']

export { ApiError }

const V1 = '/api/v1'
const DEMO = '/api/demo'

export const api = {
  autofill: (name: string, description: string) => postJson<AutofillOut>(`${V1}/autofill`, { name, description }),
  answer: (sessionId: string, characteristic: string, value: string) =>
    postJson<AutofillOut>(`${V1}/autofill/${encodeURIComponent(sessionId)}/answer`, { characteristic, value }),
  check: (card: CardIn) => postJson<CheckOut>(`${V1}/check`, card),
  ktru: (code: string) => getJson<Position>(`${V1}/ktru/${encodeURIComponent(code)}`),
  uploadBatch: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return postForm<BatchAccepted>(`${V1}/batch`, form)
  },
  batch: (jobId: string) => getJson<BatchState>(`${V1}/batch/${encodeURIComponent(jobId)}`),
  batchResultUrl: (jobId: string) => `${V1}/batch/${encodeURIComponent(jobId)}/result.xlsx`,
  /** null — оценка ещё не запускалась (404). */
  metrics: async (): Promise<MetricsOut | null> => {
    try {
      return await getJson<MetricsOut>(`${V1}/metrics`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  /** null — отчёт по карточкам портала ещё не собран (404). */
  portalReport: async (): Promise<PortalReport | null> => {
    try {
      return await getJson<PortalReport>(`${V1}/metrics/portal`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  submit: (s: SubmissionIn) => postJson<Submission>(`${DEMO}/submissions`, s),
  submissions: () => getJson<Submission[]>(`${DEMO}/submissions`),
  submission: (id: number) => getJson<SubmissionView>(`${DEMO}/submissions/${id}`),
  decide: (id: number, d: DecisionIn) => postJson<Submission>(`${DEMO}/submissions/${id}/decision`, d),
}
