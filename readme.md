# [Platform Name] — Backend

Production-grade REST API for the cybersecurity practice platform. Handles authentication via Clerk webhooks, challenge management, auto-graded submissions, leaderboard, subscriptions via Paystack, and file delivery via AWS S3.

---

## Tech Stack

| Tool              | Purpose                         |
| ----------------- | ------------------------------- |
| Node.js + Express | Core runtime + framework        |
| TypeScript        | Type safety                     |
| PostgreSQL        | Primary database                |
| Prisma ORM        | Database access + migrations    |
| Clerk             | Auth (webhook sync to DB)       |
| Paystack          | Subscription payments           |
| AWS S3            | Challenge file storage          |
| Redis             | Rate limiting + caching         |
| Zod               | Request validation              |
| Jest + Supertest  | Testing                         |
| PM2               | Process management (production) |
| Nginx             | Reverse proxy (production)      |

---

## Features

### Auth

- Clerk handles auth entirely on the frontend
- Backend syncs user data via Clerk webhooks (user.created, user.updated, user.deleted)
- Role-based access control — USER, PRO_USER, ADMIN
- Middleware guards protect routes by role

### Challenges

- CRUD for challenges (admin only)
- Challenges belong to a domain and difficulty tier
- Free vs Pro flag per challenge
- Downloadable file URL served via signed S3 URLs (expire after 15 mins)
- Questions + answer keys stored securely (answer keys never exposed to client)
- Filtering by domain, difficulty, free/pro

### Submissions

- User submits answers to auto-graded questions
- Backend compares answers against stored answer key
- Score calculated and stored
- Google Docs URL stored alongside submission
- Submission attempts tracked per user per challenge
- Completed flag set on first passing submission

### Leaderboard

- Ranked by total challenges completed
- Filterable by domain
- Cached in Redis (invalidated on new submission)

### Subscriptions (Paystack)

- Create subscription — monthly ($5) or yearly ($48)
- Paystack webhook handler — subscription.create, subscription.disable, charge.success
- Subscription status synced to user record
- Pro access gate middleware checks subscription status

### Admin

- Full challenge CRUD
- View all users with subscription status
- View all submissions per challenge
- Upload challenge files to S3 (presigned upload URL endpoint)
- Dashboard stats — total users, active subs, total submissions, challenge completion rates

---

## Project Structure

```
src/
├── config/
│   ├── db.ts                  # Prisma client instance
│   ├── redis.ts               # Redis client
│   ├── s3.ts                  # AWS S3 client
│   └── env.ts                 # Validated env variables (Zod)
├── modules/
│   ├── users/
│   │   ├── user.routes.ts
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   └── user.types.ts
│   ├── challenges/
│   │   ├── challenge.routes.ts
│   │   ├── challenge.controller.ts
│   │   ├── challenge.service.ts
│   │   └── challenge.types.ts
│   ├── submissions/
│   │   ├── submission.routes.ts
│   │   ├── submission.controller.ts
│   │   ├── submission.service.ts
│   │   └── submission.types.ts
│   ├── leaderboard/
│   │   ├── leaderboard.routes.ts
│   │   ├── leaderboard.controller.ts
│   │   └── leaderboard.service.ts
│   ├── subscriptions/
│   │   ├── subscription.routes.ts
│   │   ├── subscription.controller.ts
│   │   └── subscription.service.ts
│   ├── admin/
│   │   ├── admin.routes.ts
│   │   ├── admin.controller.ts
│   │   └── admin.service.ts
│   └── webhooks/
│       ├── clerk.webhook.ts
│       └── paystack.webhook.ts
├── middleware/
│   ├── auth.middleware.ts      # Clerk JWT verification
│   ├── role.middleware.ts      # Role guard (PRO_USER, ADMIN)
│   ├── rateLimit.middleware.ts # Redis-backed rate limiting
│   ├── validate.middleware.ts  # Zod request validation
│   └── error.middleware.ts     # Global error handler
├── prisma/
│   └── schema.prisma
├── utils/
│   ├── s3.ts                  # Sign URLs, upload helpers
│   ├── grader.ts              # Auto-grade submission logic
│   ├── ApiError.ts            # Custom error class
│   └── ApiResponse.ts         # Consistent response shape
├── tests/
│   ├── challenges.test.ts
│   ├── submissions.test.ts
│   └── leaderboard.test.ts
├── app.ts                     # Express app setup
└── server.ts                  # Entry point
```

---

## Database Schema (Prisma)

```prisma
model User {
  id               String       @id @default(uuid())
  clerkId          String       @unique
  username         String       @unique
  email            String       @unique
  avatar           String?
  bio              String?
  role             Role         @default(USER)
  subscriptionStatus SubscriptionStatus @default(FREE)
  paystackCustomerId String?
  submissions      Submission[]
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}

model Challenge {
  id           String       @id @default(uuid())
  title        String
  description  String
  scenario     String
  domain       Domain
  difficulty   Difficulty
  isFree       Boolean      @default(true)
  points       Int          @default(100)
  fileKey      String       # S3 object key
  questions    Question[]
  submissions  Submission[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}

model Question {
  id           String     @id @default(uuid())
  challengeId  String
  challenge    Challenge  @relation(fields: [challengeId], references: [id])
  text         String
  answerKey    String     # Never exposed to client
  order        Int
}

model Submission {
  id            String     @id @default(uuid())
  userId        String
  user          User       @relation(fields: [userId], references: [id])
  challengeId   String
  challenge     Challenge  @relation(fields: [challengeId], references: [id])
  answers       Json       # { questionId: answer }
  score         Int
  passed        Boolean
  reportUrl     String?    # Google Docs URL
  attemptNumber Int
  createdAt     DateTime   @default(now())
}

enum Role {
  USER
  PRO_USER
  ADMIN
}

enum SubscriptionStatus {
  FREE
  PRO
}

enum Domain {
  APPSEC
  SOC
  NETWORK
  WIRESHARK
  GRC
}

enum Difficulty {
  BEGINNER
  INTERMEDIATE
}
```

---

## API Endpoints

### Auth (Clerk Webhook)

```
POST   /webhooks/clerk          # Sync user from Clerk
```

### Users

```
GET    /api/v1/users/me                    # Get current user
PATCH  /api/v1/users/me                    # Update profile
GET    /api/v1/users/:username             # Get public profile
```

### Challenges

```
GET    /api/v1/challenges                  # List challenges (filter by domain, difficulty, tier)
GET    /api/v1/challenges/:id              # Get challenge detail
GET    /api/v1/challenges/:id/download     # Get signed S3 URL
POST   /api/v1/challenges                  # Create challenge (admin)
PATCH  /api/v1/challenges/:id              # Update challenge (admin)
DELETE /api/v1/challenges/:id              # Delete challenge (admin)
```

### Submissions

```
POST   /api/v1/submissions                 # Submit answers + report URL
GET    /api/v1/submissions/me              # Get own submission history
GET    /api/v1/submissions/:challengeId    # Get own submissions for a challenge
GET    /api/v1/submissions/public          # Public submissions gallery
```

### Leaderboard

```
GET    /api/v1/leaderboard                 # Full leaderboard
GET    /api/v1/leaderboard?domain=APPSEC   # Filtered by domain
```

### Subscriptions

```
POST   /api/v1/subscriptions/initialize    # Initialize Paystack transaction
POST   /api/v1/subscriptions/cancel        # Cancel subscription
GET    /api/v1/subscriptions/status        # Get current subscription status
POST   /webhooks/paystack                  # Paystack webhook handler
```

### Admin

```
GET    /api/v1/admin/stats                 # Dashboard stats
GET    /api/v1/admin/users                 # All users
PATCH  /api/v1/admin/users/:id/ban         # Ban user
GET    /api/v1/admin/submissions           # All submissions
POST   /api/v1/admin/upload-url            # Get presigned S3 upload URL
```

---

## Environment Variables

```env
# Server
NODE_ENV=development
PORT=5000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/platform_db

# Clerk
CLERK_SECRET_KEY=sk_test_xxx
CLERK_WEBHOOK_SECRET=whsec_xxx

# AWS S3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=eu-north-1
AWS_S3_BUCKET=platform-challenges

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_WEBHOOK_SECRET=xxx

# Redis
REDIS_URL=redis://localhost:6379

# Frontend
CLIENT_URL=http://localhost:5173
```

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/yourusername/platform-backend.git
cd platform-backend

# Install dependencies
npm install

# Copy env
cp .env.example .env
# Fill in your environment variables

# Run migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

---

## Scripts

```bash
npm run dev          # Start with ts-node-dev (hot reload)
npm run build        # Compile TypeScript
npm run start        # Run compiled output (production)
npm run migrate      # Run Prisma migrations
npm run test         # Run Jest tests
npm run lint         # ESLint
npm run typecheck    # TypeScript check
```

---

## Deployment

**Recommended:** AWS EC2 (Ubuntu 22.04, t3.small) — same setup as your existing treasure-server.

Stack:

- **PM2** — process management
- **Nginx** — reverse proxy + SSL termination
- **Let's Encrypt** — free SSL
- **GitHub Actions** — CI/CD (compile on runner, deploy compiled output via SCP)
- **Neon or Supabase** — managed PostgreSQL (avoid running Postgres on same EC2)
- **Upstash** — managed Redis (free tier is enough for rate limiting + cache)

```bash
# Production start
npm run build
pm2 start dist/server.js --name platform-api
```

---

## CI/CD (GitHub Actions)

Build on runner → SCP compiled output to EC2 → PM2 reload. Same pattern you use for CSK and Connect Four. No TypeScript compilation on the server.

---

## License

MIT
