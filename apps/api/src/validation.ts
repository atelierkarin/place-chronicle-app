export class InputError extends Error {
  constructor(public fields: Record<string, string>) {
    super('Invalid input')
  }
}

type RecordValue = Record<string, unknown>
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseUuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new InputError({ [field]: 'UUIDを指定してください' })
  return value
}

export function asObject(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InputError({ body: 'JSONオブジェクトを指定してください' })
  return value as RecordValue
}

function stringField(value: unknown, field: string, max: number, required = false): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string') throw new InputError({ [field]: '文字列を指定してください' })
  const trimmed = value.trim()
  if (required && !trimmed) throw new InputError({ [field]: '必須です' })
  if (trimmed.length > max) throw new InputError({ [field]: `${max}文字以内で指定してください` })
  return trimmed || null
}

function coordinate(value: unknown, field: string, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) > 0.00001
  ) {
    throw new InputError({
      [field]: `${min}〜${max}、小数6桁以内の数値を指定してください`,
    })
  }
  return value
}

export function parsePlace(value: unknown, partial = false) {
  const body = asObject(value)
  const result: Record<string, string | number | null> = {}
  if (!partial || 'name' in body) result.name = stringField(body.name, 'name', 200, true)
  if (!partial || 'latitude' in body)
    result.latitude = coordinate(body.latitude, 'latitude', -90, 90)
  if (!partial || 'longitude' in body)
    result.longitude = coordinate(body.longitude, 'longitude', -180, 180)
  for (const [field, max] of [
    ['category', 80],
    ['address', 500],
    ['note', 10_000],
  ] as const) {
    if (field in body) result[field] = stringField(body[field], field, max)
  }
  if (partial && !Object.keys(result).length)
    throw new InputError({ body: '更新項目を指定してください' })
  return result
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new InputError({ visitedAt: '日時を指定してください' })
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match)
    throw new InputError({
      visitedAt: 'タイムゾーン付きのISO 8601日時を指定してください',
    })
  const [, year, month, day, hour, minute, second, offset] = match
  const local = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
  if (
    local.getUTCFullYear() !== +year ||
    local.getUTCMonth() + 1 !== +month ||
    local.getUTCDate() !== +day ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59
  ) {
    throw new InputError({ visitedAt: '実在する日時を指定してください' })
  }
  if (offset !== 'Z' && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59))
    throw new InputError({ visitedAt: '無効な時差です' })
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new InputError({ visitedAt: '無効な日時です' })
  return parsed.toISOString()
}

export function parseVisit(value: unknown, partial = false) {
  const body = asObject(value)
  const result: Record<string, string> = {}
  if (!partial) result.placeId = parseUuid(body.placeId, 'placeId')
  if (!partial || 'visitedAt' in body) result.visitedAt = timestamp(body.visitedAt)
  if (!partial || 'text' in body) {
    if (body.text != null && typeof body.text !== 'string')
      throw new InputError({ text: '文字列を指定してください' })
    const text = (body.text as string | null | undefined) ?? ''
    if (text.length > 10_000) throw new InputError({ text: '10000文字以内で指定してください' })
    result.text = text
  }
  if (partial && (!Object.keys(result).length || 'placeId' in body))
    throw new InputError({ body: '訪問日時か本文を指定してください' })
  return result
}

export type Page = {
  limit: number
  cursor: { key: string; id: string } | null
}
export function parsePage(params: URLSearchParams): Page {
  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? 20 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new InputError({ limit: '1〜50の整数を指定してください' })
  const rawCursor = params.get('cursor')
  if (!rawCursor) return { limit, cursor: null }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
    const cursor = asObject(decoded)
    if (typeof cursor.key !== 'string' || !Number.isFinite(Date.parse(cursor.key)))
      throw new Error('key')
    return { limit, cursor: { key: cursor.key, id: parseUuid(cursor.id) } }
  } catch {
    throw new InputError({ cursor: '無効なカーソルです' })
  }
}

export function nextCursor(key: Date | string, id: string): string {
  return Buffer.from(JSON.stringify({ key: new Date(key).toISOString(), id })).toString('base64url')
}
