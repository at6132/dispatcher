# Dispatcher — agent notes

## Product (read first)

Canonical brief: **[docs/PRODUCT.md](./docs/PRODUCT.md)** · always-on rule: `.cursor/rules/product.mdc`

Dispatcher is a **simple shared drive board** for ~500–600 drivers (WhatsApp replacement). Free-text routes (not maps), apply → accept → unlock passenger phone, complete with cost, **10% balance** to poster paid off-app, Sunday lock if unsettled. **Extremely simple** + **bad-service / offline-first** on every feature.

Do not turn this into Uber, Stripe pay-in, or a map-heavy product.

# Expo

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Design profile

Dispatcher UI is **mid dusk liquid glass — low-profile, minimal, easy**.

- Tokens + `MistBackdrop` + `GlassSurface`: `src/theme`
- Always-on agent rule: `.cursor/rules/design-profile.mdc` (matches the shipping product)
- Cormorant Garamond display + DM Sans UI; steel accent on dusk canvas
- Icons: Lucide via `Icon` + `src/theme/icons` — Home / Plus / Landmark for the floating bottom dock
- Forms on mist (no glass cards for auth/onboarding); glass for key listing / chrome surfaces (incl. `BottomNav`)
- No logo chrome. No AI-aesthetic (purple gradients, glow, pill clusters, cosmic black)
- One mode only — no light/dark toggle. Prefer clarity and spacing over decoration
