# Security

## Scope

SMM is an inference orchestrator. Its security boundary includes HTTP parsing, provider credentials, persistent memory, trace metadata and configured upstream inference endpoints.

## Defaults

- server binds to `127.0.0.1` by default
- request bodies are capped at 1 MiB
- requests are rate-limited per source IP
- provider calls have timeouts
- common token formats are redacted from logged provider errors
- the browser UI uses a restrictive Content Security Policy
- static file resolution is constrained to `public/`
- no third-party JavaScript is loaded by the UI
- no runtime npm packages are required

## Deployment guidance

Do not expose the default server directly to the public Internet. Put it behind a reverse proxy or ingress that provides TLS and authentication. Set `SMM_CORS_ORIGIN` to the exact caller origin. Use a dedicated provider credential with the minimum required scope.

Persistent memory may contain conversation content. Protect the `.smm/` directory like any application database. Set `SMM_MEMORY_ENABLED=false` for stateless/sensitive deployments or periodically clear memory through the API.

## Prompt injection

SMM does not claim that multi-agent verification solves prompt injection. Recalled memory and user text are untrusted data passed to model nodes. Do not attach privileged tools to SMM without adding explicit capability policy and per-tool authorization.

## Reporting

For vulnerabilities, open a private GitHub security advisory for this repository rather than a public issue when possible.
