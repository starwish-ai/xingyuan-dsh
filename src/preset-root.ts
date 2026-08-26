/**
 * preset-root：把包内 presets/xingyuan 发布到 $DSH_HOME/.agent-presets/xingyuan（用户根）。
 *
 * 为什么不用 bundle patch 追加 roots：CLI profile-boot 会用自带的 SHIPPED_PRESET_ROOT
 * 整体覆盖 agent-presets 行的 roots 键，bundle 层无法追加根目录。
 * 用户根目录是官方 roster 的常备扫描位（includeUserRoot 默认 true），复制即生效；
 * 以内容指纹做幂等升级，插件卸载后残留目录不影响其它部署（可手动删除）。
 * 组装行用裸包名子路径导出（见 agent.cordis.yml），副本位置不影响模块解析。
 */
import { cp, rm, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = '.xingyuan-version'

/** 包内 presets/xingyuan 绝对路径。 */
function sourcePresetDir(): string {
  // 本文件编译产物在 lib/index.js → 包根/presets/xingyuan
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'xingyuan')
}

/** 用户根目标目录。 */
function targetPresetDir(): string {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh')
  return join(home, '.agent-presets', 'xingyuan')
}

/** 发布指纹：源文件内容哈希（内容变即重拷，升级/HMR 均正确）。 */
async function sourceFingerprint(src: string): Promise<string> {
  const hash = createHash('sha256')
  for (const name of ['agent.cordis.yml', 'preset.yml']) {
    hash.update(name)
    hash.update(await readFile(join(src, name), 'utf8'))
  }
  return hash.digest('hex').slice(0, 16)
}

async function isUpToDate(src: string, dst: string): Promise<boolean> {
  try {
    const stamped = await readFile(join(dst, MARKER), 'utf8')
    return stamped.trim() === (await sourceFingerprint(src))
  } catch {}
  return false
}

/** 同步发布 preset（指纹变化才重拷，HMR 重载零成本）。 */
export async function publishPreset(): Promise<string> {
  const src = sourcePresetDir()
  const dst = targetPresetDir()
  if (await isUpToDate(src, dst)) return dst
  await rm(dst, { recursive: true, force: true })
  await cp(src, dst, { recursive: true, verbatimSymlinks: false })
  await writeFile(join(dst, MARKER), `${await sourceFingerprint(src)}\n`, 'utf8')
  return dst
}

/** 激活期发布（失败随调用方 promise 链响亮浮出）。 */
export async function ensurePresetRoot(): Promise<string> {
  return publishPreset()
}
