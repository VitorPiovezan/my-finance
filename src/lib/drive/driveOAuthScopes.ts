/**
 * Mesmos escopos Drive no GIS (`requestDriveAccessToken`) e no Firebase
 * (`GoogleAuthProvider.addScope`) para um único consentimento quando possível.
 */
export const DRIVE_OAUTH_SCOPE_URLS = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const

export const DRIVE_OAUTH_SCOPES = DRIVE_OAUTH_SCOPE_URLS.join(' ')
