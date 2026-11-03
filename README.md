# HabitQuest

Habit quests for kids, with an AI habit coach. One repo, two apps:

```mermaid
flowchart LR
    subgraph repo["habbit-quest"]
        FE["frontend/<br/>React + Vite<br/>port 5180"]
        BE["backend/<br/>Python API + Postgres<br/>port 8000"]
    end
    Kid["Parents & kids<br/>(browser)"] --> FE
    FE -- "VITE_API_URL<br/>/v1/..." --> BE
    BE --> DB[("Postgres")]
    BE --> AI["AI coach<br/>(OpenAI-compatible)"]
```

| Folder | What it is | Start here |
|---|---|---|
| [frontend/](frontend/) | The web app families use | [frontend/README.md](frontend/README.md) |
| [backend/](backend/) | The API, database and AI coach | [backend/README.md](backend/README.md), [backend/docs/localsetup.md](backend/docs/localsetup.md) |

## Run both locally

From the repository root, `npm run dev`, `npm run build` and `npm test` run the frontend's scripts.

```mermaid
flowchart TD
    A["cd backend<br/>follow docs/localsetup.md"] --> B["uvicorn on :8000<br/>.env has DEV_LOGIN_PASSWORD"]
    C["cd frontend<br/>npm install"] --> D["frontend/.env<br/>VITE_API_URL=http://127.0.0.1:8000"]
    B --> E["npm run dev → http://localhost:5180"]
    D --> E
    E --> F["Sign in: parent + your DEV_LOGIN_PASSWORD"]
```

## Where things run

- **CI**: [.github/workflows/test.yml](.github/workflows/test.yml) runs the backend checks when `backend/` changes.
- **Render**: [render.yaml](render.yaml) deploys the API from `backend/` (`rootDir: backend`).

## Backend upstream

`backend/` was brought in with `git subtree` from [rahulwarekar20/habitquest-backend](https://github.com/rahulwarekar20/habitquest-backend)
(a fork of [nagv/habitquest-backend](https://github.com/nagv/habitquest-backend)). To pull their later changes:

```bash
git subtree pull --prefix=backend https://github.com/nagv/habitquest-backend.git main
```
