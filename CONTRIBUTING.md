# Contributing

Thanks for helping improve opencode-multi-auth-codex.

## Before opening an issue

- Search existing issues and pull requests.
- Include your OpenCode version, Node.js version, operating system, and install
  method.
- Remove account names, email addresses, tokens, cookies, and screenshots that
  contain private information.
- Provide the smallest reproducible example you can.

## Pull requests

Keep pull requests focused on one problem. A strong pull request includes:

- a concise description of the problem and intended behavior
- tests for behavior changes
- documentation updates for user-facing changes
- `bun run lint` and the relevant test suites passing locally

Start with an issue before proposing a large feature or architectural change.

## Development

```bash
bun install --frozen-lockfile
bun run lint
bun test
bun run build
```

The project supports Bun 1.3 and newer.

## Responsible use

Contributions must not add credential theft, account sharing, disposable
account provisioning, provider enforcement evasion, or collection of secrets.
Use only accounts you own or are authorized to operate, and follow the terms
and policies of every service you connect.
