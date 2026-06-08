import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  PROJECT_ARCHIVE_SCHEMA_VERSION,
  type ProjectArchiveFile,
  type ProjectArchiveManifest,
  type ProjectWorkspaceSnapshot,
} from '../types/archive'

const MANIFEST_PATH = 'manifest.json'
const WORKSPACE_PATH = 'workspace.json'
const SOURCE_PRD_PATH = 'sources/prd.md'

function parseJsonFile<T>(files: Record<string, Uint8Array>, path: string): T {
  const bytes = files[path]
  if (!bytes) throw new Error(`Archive is missing ${path}`)
  return JSON.parse(strFromU8(bytes)) as T
}

function assertArchiveManifest(manifest: ProjectArchiveManifest) {
  if (manifest.schemaVersion !== PROJECT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported project archive version: ${manifest.schemaVersion}`)
  }
  if (manifest.app !== 'GameUX PromptForge') {
    throw new Error('This file is not a GameUX PromptForge archive')
  }
}

export function buildProjectArchiveFile(workspace: ProjectWorkspaceSnapshot): ProjectArchiveFile {
  const now = new Date().toISOString()
  return {
    manifest: {
      schemaVersion: PROJECT_ARCHIVE_SCHEMA_VERSION,
      app: 'GameUX PromptForge',
      projectName: workspace.settings.projectName,
      createdAt: workspace.sourceDocument?.importedAt ?? now,
      savedAt: now,
      sourceFilename: workspace.sourceDocument?.filename ?? null,
    },
    workspace,
  }
}

export function encodeProjectArchive(archive: ProjectArchiveFile): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(archive.manifest, null, 2)),
    [WORKSPACE_PATH]: strToU8(JSON.stringify(archive.workspace, null, 2)),
  }

  if (archive.workspace.sourceDocument?.text) {
    files[SOURCE_PRD_PATH] = strToU8(archive.workspace.sourceDocument.text)
  }

  return zipSync(files, { level: 6 })
}

export function decodeProjectArchive(bytes: Uint8Array): ProjectArchiveFile {
  const files = unzipSync(bytes)
  const manifest = parseJsonFile<ProjectArchiveManifest>(files, MANIFEST_PATH)
  assertArchiveManifest(manifest)
  const workspace = parseJsonFile<ProjectWorkspaceSnapshot>(files, WORKSPACE_PATH)

  if (!workspace.sourceDocument?.text && files[SOURCE_PRD_PATH]) {
    workspace.sourceDocument = {
      filename: manifest.sourceFilename ?? 'prd.md',
      text: strFromU8(files[SOURCE_PRD_PATH]),
      importedAt: manifest.createdAt,
    }
  }

  return { manifest, workspace }
}
