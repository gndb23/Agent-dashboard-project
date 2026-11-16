# agents/

One YAML manifest per agent: `agents/<agent-id>.yaml`. The dashboard watches this folder, so changes appear without a restart.

- Copy `_template.yaml.example` to get started, or click **Create manifest** on an unregistered agent in the UI.
- Files starting with `_` are ignored.
- Full reference: [docs/ONBOARDING.md](../docs/ONBOARDING.md).

The `portfolio-research`, `pr-reviewer` and `inbox-triage` manifests are **demo agents** created by `npm run seed`.
Remove them and their data with `npm run seed -- --remove`.
