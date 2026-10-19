import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SkillPaths } from '../types'

const paths = atom({ plugin: 'skill-links', key: 'paths' } as const, {} as SkillPaths)
const canLink = atom({ plugin: 'skill-links', key: 'canLink' } as const, false)
const STORE_KEY = 'paths'
const SKILL_NAME = /^[\w.-]+(:[\w.-]+)?$/

const atLeast = (version: string | undefined, minimum: number[]) => {
  const parts = (version ?? '').split('.').map(part => parseInt(part, 10) || 0)

  for (const [i, wanted] of minimum.entries()) {
    const have = parts[i] ?? 0
    if (have !== wanted) {
      return have > wanted
    }
  }

  return version !== undefined
}

export const detectLinks = async ($: EngineInterface): Promise<boolean> => {
  const forced = await $.env.get('FORCE_HYPERLINK')
  if (forced !== undefined) {
    return !(forced.length > 0 && parseInt(forced, 10) === 0)
  }

  if (await $.env.get('WT_SESSION')) {
    return true
  }

  const program = await $.env.get('TERM_PROGRAM')
  const version = await $.env.get('TERM_PROGRAM_VERSION')

  switch (program) {
    case 'iTerm.app':
      return atLeast(version, [3, 1])
    case 'WezTerm':
      return atLeast(version, [20200620])
    case 'vscode':
      return atLeast(version, [1, 72])
    case 'ghostty':
      return true
  }

  return parseInt((await $.env.get('VTE_VERSION')) ?? '', 10) > 5000
}

export const fileUrl = (path: string): string => {
  const slashed = path.replace(/\\/g, '/')
  const url = slashed.startsWith('/') ? `file://${slashed}` : `file:///${slashed}`

  return encodeURI(url).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

const isPaths = (value: unknown): value is SkillPaths =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(v => typeof v === 'string')

const remember = async ($: EngineInterface, entries: SkillPaths) => {
  const merged = await update($, paths, held => ({ ...held, ...entries }))
  await $.store.set(STORE_KEY, merged)
}

const configDir = async ($: EngineInterface): Promise<string | undefined> => {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) {
    return explicit
  }

  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home ? `${home}/.claude` : undefined
}

const files = (root: string, skill: string) => [
  `${root}/skills/${skill}/SKILL.md`,
  `${root}/commands/${skill}.md`,
]

const pluginRoots = async ($: EngineInterface, config: string, plugin: string) => {
  const raw = await $.fs.read(`${config}/plugins/installed_plugins.json`).catch(() => undefined)
  if (typeof raw !== 'string') {
    return []
  }

  const installed = JSON.parse(raw)?.plugins ?? {}

  return Object.entries(installed)
    .filter(([id]) => id.split('@')[0] === plugin)
    .flatMap(([, installs]) => (Array.isArray(installs) ? installs : []))
    .map(install => install?.installPath)
    .filter((path): path is string => typeof path === 'string')
}

export const locate = async ($: EngineInterface, name: string): Promise<string | undefined> => {
  if (!SKILL_NAME.test(name) || name.split(':').includes('..')) {
    return undefined
  }

  const config = await configDir($)
  const [plugin, skill] = name.includes(':') ? name.split(':') : [undefined, name]

  const candidates = plugin
    ? config
      ? (await pluginRoots($, config, plugin)).flatMap(root => files(root, skill!))
      : []
    : [...files('.claude', name), ...(config ? files(config, name) : [])]

  for (const candidate of candidates) {
    const stat = await $.fs.stat(candidate, { resolve: true }).catch(() => undefined)

    if (stat?.kind === 'file') {
      return stat.realPath ?? candidate
    }
  }

  return undefined
}

const learn = async ($: EngineInterface, skill: string) => {
  const name = skill.replace(/^\//, '')

  if (!(await read($, paths))[name]) {
    const path = await locate($, name)

    if (path) {
      await remember($, { [name]: path })
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const detected = await detectLinks($).catch(() => false)
    await update($, canLink, () => detected)

    const stored = await $.store.get(STORE_KEY)

    if (isPaths(stored)) {
      await update($, paths, held => ({ ...stored, ...held }))
    }

    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)

    if (e.path) {
      const names = [e.skill]

      if (e.pluginName && !e.skill.includes(':')) {
        names.push(`${e.pluginName}:${e.skill}`)
      }

      await remember($, Object.fromEntries(names.map(name => [name, e.path as string])))
    }

    return result
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    await learn($, e.skill).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, input, isRunning, isErrored, isInterrupted } = e.props
    const isSettled = !isRunning && !isErrored && !isInterrupted

    if (tool !== 'Skill' || e.surface !== 'terminal' || !isSettled || !(await read($, canLink))) {
      return next(e)
    }

    const skill = (input as { skill?: unknown } | null)?.skill
    const name = typeof skill === 'string' ? skill.replace(/^\//, '') : undefined
    const path = name ? (await read($, paths))[name] : undefined

    if (!name || !path) {
      return next(e)
    }

    const { Box, Text, Link } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text color="success">●</Text>
        </Box>
        <Box flexShrink={0}>
          <Text bold>Skill</Text>
        </Box>
        <Text>
          (
          <Text underline>
            <Link href={fileUrl(path)}>{name}</Link>
          </Text>
          )
        </Text>
      </Box>
    )
  })
}
