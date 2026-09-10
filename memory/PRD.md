# Moontir — Product Requirements Document

## Overview
Moontir is an at-home 4-wheeled vehicle detailing and maintenance app for the Indonesian market.
Client-side app orders services (wash, detailing, checkup, premium) that a specialist performs at
the customer's home. Designed to be portable to Android Studio for future native work.

## Design language
- Moon-lit dark theme (blue/purple + gray + black) with translucent card surfaces and glow accents.
- Mechanical / automotive motifs (gears, wrench, tire, gauge iconography) alongside the moon.
- Bilingual UI (English / Bahasa Indonesia), toggled from Auth and centralized in Profile.
- Color tokens live in `src/theme.ts` (dark-first palette). No hex literals in screens.

## Core user flows (MVP)
1. **Auth** — email + password (JWT). Register / login / logout. Bilingual toggle.
2. **Home** — greeting, hero CTA to book, active order chip, featured services, categories.
3. **Services catalog** — full list of packages.
4. **Booking wizard (5 steps)**
   1. Select service
   2. Choose vehicle (from garage)
   3. Address (manual input + reverse geocoding + interactive Leaflet map with draggable pin)
   4. Schedule (next 5 days × 4 time slots + notes)
   5. Review with itemized price breakdown → confirm
5. **Garage CRUD** — add vehicle (nickname, make, model, year, plate, body type Sedan/Hatchback/MPV/SUV/Pickup/Truck).
6. **Orders** — list, tracking timeline, itemized invoice detail (unpaid; pay after service).
7. **Profile** — edit display name, centralized language switch, payment/support info, logout.

## Automatic pricing
- Base service price × vehicle-type multiplier (Sedan 1.00, Hatchback 1.00, MPV 1.15, SUV 1.25,
  Pickup 1.30, Truck 1.40); rounded to nearest Rp 500.
- Surcharge exposed as its own line item on Review + Invoice ("SUV handling surcharge" etc.).

## Backend
- FastAPI + MongoDB (Motor) + JWT (30 day expiry) + bcrypt password hashing.
- Free geocoding via Nominatim (OpenStreetMap) — no API key.
- Endpoints (all under `/api`):
  - `POST /auth/register`, `POST /auth/login`, `GET /me`, `PATCH /me`
  - `GET /services`, `POST /quote`
  - `GET /vehicles`, `POST /vehicles`
  - `GET /geocode?q=`, `GET /reverse-geocode?lat=&lon=`
  - `GET /orders`, `POST /orders`
- Collections: `users`, `vehicles`, `orders`. Never returns Mongo `_id`.

## Frontend
- Expo SDK 57 / React Native / expo-router.
- Interactive map: `react-native-webview` + Leaflet + OSM tiles, dark tile filter, draggable moon-pin.
- In-app toast provider (no native `Alert`).
- Local storage via `@/src/utils/storage` (KV + secure token).
- `SafeAreaProvider` at root; screens respect insets.

## Non-goals (for now)
- Online payment (design assumes pay-after-service).
- Real-time push notifications (in-app toast covers status feedback for the MVP).
- Admin / specialist app (client only in this build).

## Future upgrades
- Payment integration (Midtrans / Stripe).
- Specialist app + live tracking with WebSockets.
- Native Android Studio export path (already package-configured).
