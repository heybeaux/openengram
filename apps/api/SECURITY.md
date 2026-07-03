# Security Policy

Engram handles personal memories and safety-critical data (allergies, medications, emergency contacts). We take security seriously and appreciate responsible disclosure from the community.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.0.x (current) | ✅ |

As the project matures, older major/minor versions may leave support. This table will be updated accordingly.

## Reporting a Vulnerability

**Email:** [security@engram.ai](mailto:security@engram.ai)

Please **do not** open a public GitHub issue for security vulnerabilities.

### What to Include

- **Description** — Clear summary of the vulnerability and affected component(s).
- **Reproduction steps** — Minimal, reliable steps to trigger the issue.
- **Impact assessment** — What an attacker could achieve (data access, privilege escalation, etc.).
- **Environment** — Engram version, OS, Node.js version, LLM/vector provider in use.
- **Proof of concept** — Code, logs, or screenshots if available.

The more detail you provide, the faster we can triage and fix.

## Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within **48 hours** of report |
| Initial assessment | Within **7 days** |
| Status update (if fix is ongoing) | Every **7 days** |
| Fix release | As soon as practical; critical issues are prioritized |

## Disclosure Policy

We follow **coordinated disclosure**:

1. Reporter submits the vulnerability privately via the email above.
2. We acknowledge, investigate, and develop a fix.
3. We release the fix and publish an advisory.
4. Reporter may disclose publicly **90 days** after the initial report, or once a fix is released — whichever comes first.

We ask that you refrain from public disclosure before the 90-day window unless we have already shipped a fix or have been unresponsive.

## What Qualifies as a Vulnerability

- Injection attacks (SQL, NoSQL, prompt injection affecting server behavior)
- Authentication or authorization bypass (API key leakage, privilege escalation)
- Data leakage (unauthorized access to another user's memories)
- Safety-critical data exposure (allergies, medications, emergency contacts)
- Server-side request forgery (SSRF)
- Remote code execution
- Path traversal or file disclosure
- Insecure defaults that expose sensitive data
- Dependency vulnerabilities with a demonstrated exploit path

## Out of Scope

- Social engineering or phishing attacks against maintainers or users
- Denial of service (DoS) without a significant amplification factor
- Issues requiring physical access to a user's machine
- Vulnerabilities in upstream dependencies without a demonstrated impact on Engram
- Self-hosted misconfiguration (e.g., running without TLS, default credentials left unchanged)
- Automated scanner output without a verified, exploitable finding
- Spam, rate-limiting, or brute-force attacks against a single account on a self-hosted instance

## Credit & Acknowledgment

We believe in recognizing the people who help keep Engram secure:

- Confirmed reporters will be credited by name (or handle) in the release notes and security advisory, unless they prefer to remain anonymous.
- We maintain a **Security Hall of Fame** for significant contributions — reach out if you'd like to be listed.

## Questions

If you're unsure whether something qualifies as a security issue, err on the side of caution and email us at [security@engram.ai](mailto:security@engram.ai). We'd rather receive a false alarm than miss a real vulnerability.

---

Thank you for helping keep Engram — and the agents that depend on it — safe.
