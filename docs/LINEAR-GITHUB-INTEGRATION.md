# Linear ↔ GitHub Integration

## Overview

We use Linear (team `HEY`) for project management and GitHub for code. This doc explains how they connect.

## Native Linear GitHub Integration (Primary)

Linear has a built-in GitHub integration that automatically links commits, PRs, and branches to tickets.

### Setup (one-time, done in Linear UI)

1. Go to **Linear Settings → Integrations → GitHub**
2. Click **Connect** and authorize the GitHub org (`heybeaux`)
3. Connect repos: `heybeaux/engram` and `heybeaux/engram-dashboard`
4. Enable **auto-close**: PRs with `fixes HEY-XXX` or `closes HEY-XXX` in the title/description will auto-move tickets to Done on merge

### What it does automatically

- **Branch names** containing `hey-123` link to the ticket
- **Commit messages** referencing `HEY-123` show up on the ticket
- **PR titles/descriptions** with `HEY-123` get linked
- **Auto-close**: `fixes HEY-123` or `closes HEY-123` in PR title/body → ticket moves to Done on merge

## CI Backup (Secondary)

A GitHub Actions workflow (`.github/workflows/linear-sync.yml`) runs on pushes to `main` and PRs. It extracts `HEY-XXX` references from commit messages and posts a comment on the Linear ticket via API.

This requires a `LINEAR_API_KEY` secret in both GitHub repos.

## Commit Message Conventions

Always include the ticket ID:

```
feat: add trust history endpoint (HEY-284)
fix: resolve embedding timeout (HEY-290)
```

### PR Titles

```
[HEY-284] Add trust history endpoint
```

### Auto-close on Merge

Include in PR title or description:
```
fixes HEY-284
closes HEY-284
```

## Manual Linking

If you forget to reference a ticket:
1. Open the Linear ticket
2. Click **Link** → **GitHub PR/Commit**
3. Paste the URL

Or just add a comment on the ticket with the commit/PR URL — Linear will auto-detect it.
