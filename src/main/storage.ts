import { promises as fs } from 'fs'
import path from 'path'

const DATA_DIR = path.join(__dirname, '..', '..', 'data')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

let writeQueue: Promise<void> = Promise.resolve()

function writeJson(file: string, data: unknown): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const target = path.join(DATA_DIR, file)
    const tmp = target + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, target)
  })
  return writeQueue
}

export const storage = {
  load: readJson,
  save: writeJson
}
