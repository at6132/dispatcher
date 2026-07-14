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
