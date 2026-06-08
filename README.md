# Solar Panel Pathways - Project Documentation

## Project Overview
**SolarTrace — PV Waste Flow Intelligence** is a web-based application designed to track and analyze end-of-life photovoltaic (PV) solar panel waste flows and U.S. landfill acceptance policies.

## Technology Stack
The application is structured as a monorepo containing a modern web frontend. The architectural stack includes:
- **Framework**: React 18 with Vite for fast bundling and hot module replacement (HMR).
- **Language**: TypeScript (`.ts` and `.tsx`).
- **Styling**: Tailwind CSS with Radix UI primitives and `clsx`/`tailwind-merge` for class management. Includes `@tailwindcss/typography` and `tailwindcss-animate`.
- **UI Components**: Shadcn UI architecture.
- **Mapping**: Leaflet and React-Leaflet for rich interactive geographic maps.
- **Charts & Data Visualization**: Recharts for dynamic visual intelligence.
- **Routing**: `react-router-dom` for client-side navigation.
- **Data Fetching**: `@tanstack/react-query` for asynchronous state management.
- **Forms & Validation**: `react-hook-form` coupled with `zod` schema validation.
- **Testing**: Playwright for end-to-end (E2E) testing and Vitest for unit testing.

## Directory Structure
- `/frontend`: Contains all the client-facing UI logic, React components, and static assets.
  - `src/`: Main source directory containing components, hooks, pages, and utility functions.
  - `public/`: Static assets such as placeholder images and vector icons.
  - `index.html`: Main HTML entry point.
  - Config Files: `vite.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `playwright.config.ts`.
- `/backend`: FastAPI service for scene detection (SAM 3 / YOLO) and Street View imagery, with optional cached transit entrance data under `backend/data/`.

## Setup & Local Development
1. Navigate into the frontend folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   bun install
   ```
   *(Alternatively, use `npm install`)*
3. Run the development server:
   ```bash
   bun run dev
   ```
4. Access the application at `http://localhost:8080`.

## Testing
- **E2E Tests** (Playwright): `bun run test:e2e` (Ensure playwright is configured to run).
- **Unit Tests** (Vitest): `bun run test` (Runs Vitest).
