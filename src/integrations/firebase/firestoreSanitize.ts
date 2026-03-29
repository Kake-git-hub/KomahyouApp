function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeFirestoreValue(value: unknown): unknown {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
    })
  }

  if (isPlainObject(value)) {
    const sanitizedObject: Record<string, unknown> = {}

    Object.entries(value).forEach(([key, entry]) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      if (typeof sanitizedEntry !== 'undefined') {
        sanitizedObject[key] = sanitizedEntry
      }
    })

    return sanitizedObject
  }

  return value
}

export function sanitizeForFirestore<T>(value: T): T {
  return sanitizeFirestoreValue(value) as T
}