# Debate App

Structured debates on a decentralized knowledge graph.

Debate App is a social debate platform where every contribution is decomposed into semantic triples (subject-predicate-object) and published on-chain via the [Intuition](https://intuition.systems) protocol. Debates accumulate into a reusable reasoning graph rather than resetting each time.

## Features

- **LLM extraction pipeline** — free-form text is automatically decomposed into structured semantic triples through a multi-stage agent pipeline (selection, decomposition, graph extraction, relation detection)
- **On-chain publishing** — triples are published as atoms and triples on the Intuition protocol, creating a permanent, queryable knowledge graph
- **Stance system** — replies take an explicit stance (support or refute) against a parent claim, with signal deposits
- **Nested relations** — the pipeline detects inter-claim relations (conditions, attributions, causal links) and publishes them as supporting context
- **Multi-post atomic publishing** — users can split complex arguments into multiple posts, published in a single idempotent transaction
- **Theme-based organization** — debates are grouped by theme for browsable exploration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19 |
| Database | PostgreSQL 16, Prisma 7 |
| LLM | Vercel AI SDK, Groq |
| Testing | Vitest |
| Package manager | pnpm 10 (workspaces) |

## Project Structure

```
debate-app/
├── apps/
│   └── web/                 # Next.js application (frontend + API routes)
│       ├── src/
│       │   ├── app/         # App router (pages + API routes)
│       │   ├── features/    # Domain logic (extraction flow, proposals)
│       │   ├── components/  # Shared UI components
│       │   ├── lib/         # Utilities (vocabulary, Intuition helpers)
│       │   └── server/      # Backend (auth, database)
│       └── prisma/          # Schema, migrations, seed
│
├── packages/
│   ├── agents/              # LLM extraction pipeline
│   │   └── src/
│   │       ├── agents/      # 5 specialized agents (selection, decomposition,
│   │       │                #   graph-extractor, relation, stance-verification)
│   │       ├── providers/   # LLM provider configs (Groq)
│   │       └── claimify/    # Sentence splitting utilities
│   │
└── docker-compose.yml       # PostgreSQL 16
```

**`packages/agents`** implements the extraction pipeline and deterministic post-processing using the Vercel AI SDK, Groq, and local helpers for canonicalization, nested edges, stance checks, and atom matching.

**`apps/web`** is the Next.js application handling both the UI (React 19 + Radix) and the API layer. Proposals live in React state during the composition flow and are published atomically on-chain via the Intuition SDK.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+ (or Docker)

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd debate-app

# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Configure environment
cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env with your values (see Environment Variables below)

# Run database migrations and seed
cd apps/web
pnpm prisma migrate deploy
pnpm seed
cd ../..

# Start the dev server
pnpm dev
```

The app runs at `http://localhost:3000`.

### Build

```bash
pnpm build   # compiles all packages + Next.js
pnpm start   # runs the production server (from apps/web)
```

## Environment Variables

Copy `apps/web/.env.example` to `apps/web/.env` and fill in the values:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Random string, min 32 characters (required in production) |
| `NEXT_PUBLIC_INTUITION_CHAIN_ID` | Intuition network chain ID (`13579` for testnet) |
| `NEXT_PUBLIC_INTUITION_GRAPHQL_URL` | Intuition GraphQL endpoint |
| `GROQ_API_KEY` | Groq API key |
| `GROQ_MODEL` | Groq model name |

## Architecture

### Extraction Pipeline

When a user submits text, it goes through a multi-stage LLM pipeline:

```
User text
  │
  ▼
Selection ──► keeps relevant claims, resolves pronouns, classifies kind
  │
  ▼
Decomposition ──► splits multi-claim sentences on discourse markers
  │                (but, because, if, which...)
  ▼
Graph Extraction ──► extracts core {subject, predicate, object} + modifiers
  │
  ▼
Relation Detection ──► identifies inter-claim relations (cause, contrast, condition)
  │
  ▼
Stance Verification ──► checks alignment with user's declared stance (optional)
  │
  ▼
Proposals (React state) ──► user reviews, splits into drafts, publishes on-chain
```

Guard-rails skip agent calls when discourse markers are absent, saving LLM round-trips.

### Data Flow

1. **Extraction** — `/api/extract` calls `runExtraction()` from `@db/agents`, returns proposals to the client
2. **Composition** — proposals live in React state only; users review, split into draft posts, select stances
3. **Resolution** — client resolves atom labels to on-chain term IDs via the Intuition SDK
4. **Publishing** — `/api/publish` creates all posts, atoms, triples, and links in a single idempotent transaction

### Database

The local database (5 tables) stores references only — never duplicates Intuition on-chain data:

- **User** — wallet address, display name
- **Theme** — debate topics (slug as PK for clean URLs)
- **Post** — body, stance, theme, parent post link
- **PostTripleLink** — maps posts to on-chain triple IDs with role (primary/supporting)
- **Submission** — tracks extraction workflow state

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/siwe` | POST | Sign-In with Ethereum |
| `/api/auth/session` | GET | Current session |
| `/api/extract` | POST | Extract triples from text |
| `/api/publish/prepare` | POST | Lock submission for publish |
| `/api/publish` | POST | Publish posts on-chain (multi-post) |
| `/api/publish/cancel` | POST | Abort publish |
| `/api/intuition/config` | GET | Chain config, stance atom IDs |
| `/api/intuition/search` | POST | Search atoms/triples |
| `/api/intuition/resolve-atoms` | POST | Resolve labels to term IDs |
| `/api/intuition/resolve-triples` | POST | Resolve triples to term IDs |
| `/api/search/posts` | GET | Search posts by text |
| `/api/triples/[id]` | GET | Triple details |
| `/api/vaults/[tripleId]` | GET | Vault data (signals, shares) |
| `/api/themes` | GET | List themes |

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Specific package
cd apps/web && pnpm test
cd packages/agents && pnpm test
```

Tests cover extraction pipeline logic, draft management, multi-post publishing, body composition, and on-chain resolution.

## Scripts

| Script | Scope | Description |
|--------|-------|-------------|
| `pnpm dev` | root | Start Next.js dev server |
| `pnpm build` | root | Build all packages |
| `pnpm lint` | root | Lint all packages |
| `pnpm test` | apps/web | Run tests |
| `pnpm typecheck` | apps/web | TypeScript check |
| `pnpm studio` | apps/web | Open Prisma Studio |
| `pnpm seed` | apps/web | Seed database with themes |

## Roadmap

- **Themes as on-chain atoms** — publish theme metadata to Intuition for cross-app discoverability
- **Atom UX + Explore Drawer** — usage stats, reuse suggestions when composing triples
- **Web2 onboarding** — energy-based system (no wallet required) for frictionless onboarding
- **LLM optimization** — parallelize agent calls, batch operations, response caching

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm test` and `pnpm typecheck` to verify
5. Open a pull request

### Conventions

- UI labels go in `apps/web/src/lib/vocabulary.ts` (no hardcoded web3 jargon)
- Components use CSS Modules (`.module.css`)
- Shared design tokens live in `apps/web/src/styles/design-system.css`

## License

TBD
