import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TRY_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.jsx']

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return nextResolve(specifier, context)
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const candidates = [
      ...TRY_EXTS.map((ext) => specifier + ext),
      ...TRY_EXTS.map((ext) => `${specifier}/index${ext}`),
    ]
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context)
      } catch {
        // следующий вариант
      }
    }
    throw error
  }
}

const LOADERS = new Map([
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
  ['.jsx', 'jsx'],
])

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context)
  const path = fileURLToPath(url)
  const ext = path.slice(path.lastIndexOf('.'))
  const loader = LOADERS.get(ext)
  if (!loader) return nextLoad(url, context)
  const source = readFileSync(path, 'utf8')
  const { code } = transformSync(source, {
    loader,
    format: 'esm',
    sourcefile: path,
    sourcemap: 'inline',
    jsx: 'automatic',
    target: 'es2022',
  })
  return { format: 'module', source: code, shortCircuit: true }
}
