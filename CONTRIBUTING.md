# Contributing

Issues and pull requests are welcome. I maintain this mod in my spare time, so a reply can take a while.

## Issues

Include:

- the Claude Code version (`claude --version`);
- your operating system and terminal;
- what the `Skill(...)` row looked like, and what you expected.

## Pull requests

- Keep each pull request to one fix or one feature.
- Add or update a test in `hooks/register.test.tsx` for the behaviour you change.
- Run `claude plugin validate .` and `claude plugin test .` before you open the pull request. Both must pass.
- Match the style of the existing code.
- Do not bump the version. Versions change at release time.
- Target `main`, with a short title that starts with `feat:`, `fix:` or `docs:`.

By opening a pull request you agree that your contribution is licensed under the [MIT license](LICENSE) of this repository.
