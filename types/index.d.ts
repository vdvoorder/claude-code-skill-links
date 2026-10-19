export type SkillPaths = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'skill-links': { paths: SkillPaths; canLink: boolean }
  }
}
