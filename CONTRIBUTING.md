# Contributing

Keep the runtime portable and the trust model explicit.

Before proposing a change:

```bash
npm run check
npm test
npm run smoke
```

New orchestration features should include deterministic tests with `FunctionProvider` so CI never depends on an external model service. Avoid adding runtime dependencies when a Node standard-library implementation is reasonable. Never commit provider credentials, model tokens, memory logs or `.smm/` state.
