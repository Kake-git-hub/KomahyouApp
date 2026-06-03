function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeObjectEntries(entries: Array<[string, unknown]>) {
  const sanitizedObject: Record<string, unknown> = {}

  entries.forEach(([key, entry]) => {
    const sanitizedEntry = sanitizeFirestoreValue(entry)
    if (typeof sanitizedEntry !== 'undefined') {
      sanitizedObject[key] = sanitizedEntry
    }
  })

  return sanitizedObject
}

function sanitizeFirestoreValue(value: unknown): unknown {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Set) return Array.from(value, (entry) => {
    const sanitizedEntry = sanitizeFirestoreValue(entry)
    return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
  })
  if (value instanceof Map) return sanitizeObjectEntries(Array.from(value.entries()).map(([key, entry]) => [String(key), entry]))
  if (typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)) return null

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
    })
  }

  if (isPlainObject(value)) {
    return sanitizeObjectEntries(Object.entries(value))
  }

  if (typeof value === 'object') {
    const jsonValue = typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as { toJSON: () => unknown }).toJSON()
      : null
    if (jsonValue !== null) return sanitizeFirestoreValue(jsonValue)

    const enumerableEntries = Object.entries(value as Record<string, unknown>)
    if (enumerableEntries.length > 0) return sanitizeObjectEntries(enumerableEntries)
    return null
  }

  return value
}

export function sanitizeForFirestore<T>(value: T): T {
  return sanitizeFirestoreValue(value) as T
}
