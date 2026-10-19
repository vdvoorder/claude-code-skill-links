import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fileUrl } from './register'

const SKILL_PATH = String.raw`C:\Users\me\.claude\skills\design-system\SKILL.md`
const CONFIG = 'C:/Users/me/.claude'
const FIGMA_ROOT = String.raw`C:\Users\me\.claude\plugins\cache\official\figma\2.2.157`
const LINKS_ON = { FORCE_HYPERLINK: '1' }

const slashed = (path: string) => path.replace(/\\/g, '/')
const isAbsolute = (path: string) => /^([A-Za-z]:)?\//.test(slashed(path))

const disk = (on: On, existing: Record<string, string>) => {
  const lookup = (asked: string) => {
    const key = Object.keys(existing).find(k =>
      isAbsolute(k) ? slashed(asked) === slashed(k) : slashed(asked).endsWith(`/${slashed(k)}`),
    )
    return key === undefined ? undefined : existing[key]
  }

  on('fs.stat', ($, e) => {
    const realPath = lookup(e.path)
    return realPath === undefined
      ? { deny: `ENOENT: ${e.path}` }
      : { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath } }
  })
  on('fs.read', ($, e) =>
    slashed(e.path) === `${CONFIG}/plugins/installed_plugins.json`
      ? {
          value: JSON.stringify({
            version: 2,
            plugins: { 'figma@official': [{ scope: 'user', installPath: FIGMA_ROOT }] },
          }),
        }
      : { deny: `ENOENT: ${e.path}` },
  )
}

type Boot = {
  env?: Record<string, string>
  existing?: Record<string, string>
  stored?: Record<string, string>
}

const boot = async ($: Engine, on: On, options: Boot = {}) => {
  mock.store(on, options.stored ? { paths: options.stored } : {})
  mock.env(on, options.env ?? LINKS_ON)
  disk(on, options.existing ?? {})
  on('session.start', () => ({ cwd: '.' }))
  on('skill.prompt', () => ({ text: 'body' }))
  on('tool.call', () => ({ result: { success: true, commandName: 'x' } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
}

const skillCall = (skill: string) => ({ tool: 'Skill' as const, skill, tool_use_id: 'toolu_1' })

const row = (overrides: Record<string, unknown> = {}) => ({
  plugin: 'skill-links',
  surface: 'terminal' as const,
  component: 'ToolUse' as const,
  props: {
    tool_use_id: 'toolu_1',
    tool: 'Skill',
    input: { skill: 'design-system' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    ...overrides,
  },
})

test('fileUrl turns a Windows path into a file URI', () => {
  expect(fileUrl(String.raw`C:\Users\Ruben Van\a#b\SKILL.md`)).toBe(
    'file:///C:/Users/Ruben%20Van/a%23b/SKILL.md',
  )
  expect(fileUrl('/home/me/SKILL.md')).toBe('file:///home/me/SKILL.md')
})

test('a loaded skill gets a link to its SKILL.md', async ($, on) => {
  await boot($, on)
  await $.skill.prompt({ skill: 'design-system', text: 'body', path: SKILL_PATH })

  const ui = await $.ui.mount(row())
  const link = await ui.find({ type: 'Link' })

  expect(link?.props.href).toBe(fileUrl(SKILL_PATH))
  expect(link?.children).toEqual(['design-system'])
})

test('a plugin skill is found under plugin:name', async ($, on) => {
  await boot($, on)
  await $.skill.prompt({ skill: 'figma-use', pluginName: 'figma', text: 'body', path: SKILL_PATH })

  const ui = await $.ui.mount(row({ input: { skill: 'figma:figma-use' } }))

  expect((await ui.find({ type: 'Link' }))?.children).toEqual(['figma:figma-use'])
})

test('a stored path survives into a new session', async ($, on) => {
  await boot($, on, { stored: { 'design-system': SKILL_PATH } })

  const ui = await $.ui.mount(row())

  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(fileUrl(SKILL_PATH))
})

test('unknown, running, errored and non-Skill rows stay the engine row', async ($, on) => {
  await boot($, on)
  await $.skill.prompt({ skill: 'design-system', text: 'body', path: SKILL_PATH })

  for (const props of [
    { input: { skill: 'never-loaded' } },
    { isRunning: true },
    { isErrored: true },
    { isInterrupted: true },
    { tool: 'Bash', input: { command: 'ls' } },
  ]) {
    const ui = await $.ui.mount(row(props))
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  }

  const desktop = await $.ui.mount({ ...row(), surface: 'desktop' })
  expect(await desktop.find({ type: 'Link' })).toBeUndefined()
})

test('without skill.prompt, a user skill is found in the config folder', async ($, on) => {
  await boot($, on, {
    env: { ...LINKS_ON, USERPROFILE: 'C:/Users/me' },
    existing: {
      [`${CONFIG}/skills/my-skill/SKILL.md`]: String.raw`C:\Users\me\dotfiles\skills\my-skill\SKILL.md`,
    },
  })
  await $.tool.call(skillCall('my-skill'))

  const ui = await $.ui.mount(row({ input: { skill: 'my-skill' } }))

  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(
    'file:///C:/Users/me/dotfiles/skills/my-skill/SKILL.md',
  )
})

test('without skill.prompt, a project skill wins over a user skill', async ($, on) => {
  await boot($, on, {
    env: { ...LINKS_ON, CLAUDE_CONFIG_DIR: CONFIG },
    existing: {
      '.claude/skills/deploy/SKILL.md': 'C:/repo/.claude/skills/deploy/SKILL.md',
      [`${CONFIG}/skills/deploy/SKILL.md`]: `${CONFIG}/skills/deploy/SKILL.md`,
    },
  })
  await $.tool.call(skillCall('deploy'))

  const ui = await $.ui.mount(row({ input: { skill: 'deploy' } }))

  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(
    'file:///C:/repo/.claude/skills/deploy/SKILL.md',
  )
})

test('without skill.prompt, a plugin skill is found in its installed version', async ($, on) => {
  const skillFile = `${FIGMA_ROOT}${String.raw`\skills\figma-use\SKILL.md`}`
  await boot($, on, {
    env: { ...LINKS_ON, CLAUDE_CONFIG_DIR: CONFIG },
    existing: { [skillFile]: skillFile },
  })
  await $.tool.call(skillCall('figma:figma-use'))

  const ui = await $.ui.mount(row({ input: { skill: 'figma:figma-use' } }))

  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(fileUrl(skillFile))
})

test('a skill found nowhere, or with an odd name, keeps the engine row', async ($, on) => {
  await boot($, on, { env: { ...LINKS_ON, CLAUDE_CONFIG_DIR: CONFIG } })

  for (const skill of ['missing', '../escape', 'a/b']) {
    await $.tool.call(skillCall(skill))
    const ui = await $.ui.mount(row({ input: { skill } }))
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  }
})

for (const [label, env, expected] of [
  ['FORCE_HYPERLINK=1', { FORCE_HYPERLINK: '1' }, true],
  ['FORCE_HYPERLINK=0', { FORCE_HYPERLINK: '0', WT_SESSION: 'x' }, false],
  ['Windows Terminal', { WT_SESSION: 'x' }, true],
  ['VS Code 1.90', { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.90.0' }, true],
  ['VS Code 1.71', { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.71.2' }, false],
  ['WezTerm', { TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20240203-110809-5046fc22' }, true],
  ['GNOME Terminal', { VTE_VERSION: '7600' }, true],
  ['macOS Terminal', { TERM_PROGRAM: 'Apple_Terminal', TERM_PROGRAM_VERSION: '455' }, false],
  ['tmux', { TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-1000/default,1,0' }, false],
  ['nothing known', {}, false],
] as const) {
  test(`links ${expected ? 'drawn' : 'left to Claude Code'}: ${label}`, async ($, on) => {
    await boot($, on, { env, stored: { 'design-system': SKILL_PATH } })

    const ui = await $.ui.mount(row())
    const link = await ui.find({ type: 'Link' })

    expect(link !== undefined).toBe(expected)
  })
}
