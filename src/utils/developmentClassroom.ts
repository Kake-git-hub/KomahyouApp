export type DevelopmentClassroomIdentity = {
  id?: string | null
  name?: string | null
}

export function isDevelopmentClassroom(classroom: DevelopmentClassroomIdentity | null | undefined) {
  const id = classroom?.id?.trim().toLowerCase() ?? ''
  const name = classroom?.name?.trim() ?? ''
  return id === 'development'
    || id === 'dev'
    || id.includes('development')
    || id.startsWith('dev_')
    || name === '開発用教室'
    || name.includes('開発用教室')
}
