# Moontir — Product Requirements Document

## Overview
Moontir is an at-home 4-wheeled vehicle detailing and maintenance app for the Indonesian
market. Client-side app orders services (light service, detailing, special-care bundles)
that a specialist performs at the customer's home.

## Brand & design language (iteration 4)
- **Palette** — matcha #D8E2AE, mist #EBF0D5, cream #F5F0E6, charcoal #403A35.
- **Logo** — bespoke MOONTIR wordmark (crescent moon replaces the "oo").
- **Aesthetic** — MOYA-inspired warm minimal: generous whitespace, rounded 16–24px cards,
  charcoal pill buttons with cream text, small circular action buttons, thin outline icons.
- **Themes** — Light (default, cream) + Dark (deep charcoal with matcha accents). User can
  cycle System → Light → Dark from the Profile screen; preference persisted via storage.
- **Language** — English + Bahasa Indonesia (toggle in top bar and Profile).

## Core user flows
1. **Auth** — email + password (JWT), MOONTIR wordmark hero.
2. **Home** — greeting, hero card with BOOK NOW, active dispatch chip, three EXPLORE circles
   (Light Service / Car Detailing / Moontir Special Care) that link to a pre-filtered Services tab,
   featured services list, recent orders preview.
3. **Services** — search bar (matches across all groups when active) + filter chips + grouped
   list (Light Service / Car Detailing / Moontir Special Care).
4. **Booking wizard (5 steps)** — service → vehicle → address (manual + Leaflet map with
   draggable pin) → schedule → review with itemized breakdown.
5. **Garage** — vehicle cards with edit (pencil) and delete (trash) actions; add-vehicle CTA
   that opens the same bottom-sheet used for edit.
6. **Orders** — full history with tap-to-open invoice modal (tracking timeline + itemized invoice).
7. **Profile** — edit display name, Appearance cycle, Language toggle, payment/support info, logout.

## Automatic pricing
- Base × vehicle-type multiplier (Sedan/Hatchback 1.00, MPV 1.15, SUV 1.25, Pickup 1.30,
  Truck 1.40), rounded to nearest Rp 500; surcharge shown as its own invoice line.

## Backend
- FastAPI + MongoDB (Motor) + JWT (30-day) + bcrypt.
- Free geocoding via Nominatim (OpenStreetMap).
- Endpoints (all under `/api`):
  - `POST /auth/register`, `POST /auth/login`, `GET /me`, `PATCH /me`
  - `GET /services` (each carries a `group` of `light | detail | special`), `POST /quote`
  - `GET /vehicles`, `POST /vehicles`, `PATCH /vehicles/{id}`, `DELETE /vehicles/{id}`
  - `GET /geocode?q=`, `GET /reverse-geocode?lat=&lon=`
  - `GET /orders`, `POST /orders`

## Frontend stack
- Expo SDK 57, React Native, expo-router.
- Interactive map: react-native-webview + Leaflet + OSM tiles + draggable pin.
- Toast notifications, SafeAreaProvider, storage-backed lang + theme preferences.

## Non-goals (current build)
- Online payment (pay-after-service).
- Real-time push notifications.
- Admin / specialist companion app.
