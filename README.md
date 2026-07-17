# SplitEase

A Splitwise-style expense-sharing app. FastAPI + PostgreSQL, containerized with Docker.

## Team setup — first time (each developer runs this on their own machine)

1. **Clone the repo**
   ```bash
   git clone https://github.com/yourteam/splitease.git
   cd splitease
   ```

2. **Copy the environment template**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if you want, but the defaults work fine for local dev. Never commit `.env`.

3. **Start everything**
   ```bash
   docker compose up -d
   ```
   This starts Postgres, pgAdmin, and the FastAPI app.

4. **Run migrations**
   ```bash
   docker compose exec api alembic upgrade head
   ```

5. **Check it's working**
   - API: http://localhost:8000/health
   - Interactive docs: http://localhost:8000/docs
   - pgAdmin: http://localhost:5050 (login with the email/password from your `.env`)

## Day-to-day workflow

```bash
# start your stack
docker compose up -d

# view logs
docker compose logs -f api

# stop everything
docker compose down

# stop and wipe the database too (careful)
docker compose down -v
```

Code changes in `app/` hot-reload automatically — no restart needed.

## Making schema changes

1. Edit or add a model in `app/models/`
2. Generate a migration:
   ```bash
   docker compose exec api alembic revision --autogenerate -m "describe your change"
   ```
3. Review the generated file in `alembic/versions/` — autogenerate isn't perfect, check it
4. Apply it:
   ```bash
   docker compose exec api alembic upgrade head
   ```
5. Commit both the model change and the migration file together

## Running tests

```bash
docker compose exec api pytest -v
```

## Branching

- `main` — always deployable
- `develop` — integration branch
- `feature/your-feature-name` — your work, PR into `develop`

## Project structure

```
app/
├── core/          # config, database connection
├── models/        # SQLAlchemy models
├── schemas/       # Pydantic request/response models
├── services/       # business logic (splitting, balances, etc.)
└── api/routers/   # FastAPI route handlers
alembic/           # database migrations
tests/             # pytest tests
```
