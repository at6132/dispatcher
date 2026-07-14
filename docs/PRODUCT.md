# Dispatcher — product brief

Canonical product intent for humans and coding agents. Prefer this over inventing marketplace/Uber patterns.

## Mission

Simple **shared drive board** for ~500–600 drivers (WhatsApp replacement in the Catskills / upstate NY network). Anyone can post a drive as **free-text route** (not maps). Others apply. Poster picks one. Passenger contact unlocks only after accept. Complete the job → log cost → **10% balance** owed to the poster by the completing driver (pay **outside** the app; settle **inside**). One board for everyone.

## Main goals (every feature)

1. **Extremely simple** — almost no learning curve; WhatsApp mental model
2. **Bad-service friendly** — poor / no cell is normal, not an edge case
3. **Privacy** — phone/address unlock only after accept
4. **One shared board** — whole network; no groups in v1

### Bad-service rule

Assume weak Catskills signal. Cache what they see. Queue what they do. Retry when connected. Never lose a form. Show clear offline / pending / synced status. Prefer text, small payloads, no maps or heavy media.

Goal: **use the app offline, catch up in a few seconds of signal** — not “works forever with zero connection.”

## Roles

No special roles. **Anyone can post and apply.**

## Post a drive

| Field | Required | Notes |
|---|---|---|
| Route text | Yes | e.g. `Monticello → Brooklyn`, `Monticello local` — **not** GPS/map |
| Passenger phone | Yes | **Hidden** until a driver is accepted |
| Address | No | Optional; often call the passenger and ask |
| Trip type tag | Yes (intent) | **One-way** or **Round-trip** — visible on board |
| Waiting tag | Yes (intent) | **Waiting included** or **Waiting not included** — visible on board |

Example board line: `Monticello → Brooklyn` · **Round-trip** · **Waiting included**

Must work offline: draft / queue post until signal returns.

## Apply / accept

1. Drive appears on shared board (route + tags; no passenger phone)
2. Drivers apply with **exact location** (cache last known location; don’t require a fresh GPS lock every tap)
3. Poster sees applicants (profiles + locations) and picks one
4. Accepted driver unlocks **phone** (+ address if provided); **all other applicants auto-rejected**
5. Poster can **unassign** later
6. After unassign: other applications **still exist**; chosen applicant must **re-confirm still available** before assign again

Must work offline: browse cached board; queue apply/accept/unassign; confirm sync so two people don’t both think they got the job.

## Complete a job

Accepted driver enters:

- **Total cost** (required)
- **Explanation** (optional free text)
- **Mileage** (free text)
- **Waiting time** (free text)

Completed jobs appear on the driver’s profile. All completed jobs are visible to all users; posters can **hide** trips they posted.

## Money (no in-app payments)

- On complete: store cost; create **10% balance owed to the poster by the completing driver**
- Driver pays poster **outside the app** (Zelle, Venmo, cash, etc.)
- Poster marks **Got paid / settled** in-app
- If not settled by **Sunday 11:59pm** → **completing driver’s account locked** until cleared

## Privacy

Board shows **route + tags only**. Phone/address unlock **only after accept**.

## Build order (offline is part of done)

| Step | Feature |
|---|---|
| 1 | Local cache + sync/queue foundation |
| 2 | Post drive |
| 3 | Shared open-drives feed |
| 4 | Apply (+ exact location) |
| 5 | Accept / unlock / auto-reject |
| 6 | Unassign + re-confirm availability |
| 7 | Complete job form |
| 8 | Profiles / completed jobs + hide posted |
| 9 | 10% balance, settle, Sunday lock |

Do **not** ship a feature that only works on good Wi‑Fi and “add offline later.”

## Definition of done (any screen)

- [ ] Usable with no signal using last cached data
- [ ] User actions never silently disappear
- [ ] Offline / pending / failed / synced are obvious
- [ ] Retries happen automatically
- [ ] No large downloads required to use the screen
- [ ] Still extremely simple

## Not the product

- Not a general consumer rideshare (Uber/Lyft)
- Not in-app payments / Stripe pay-in (settlement tracking only)
- Not map-first routing or turn-by-turn
- Not multi-group boards in v1

## Repo pointers

- UI design: `AGENTS.md`, `.cursor/rules/design-profile.mdc`
- API: `server/README.md`, `server/openapi.json`
- Agent product rule: `.cursor/rules/product.mdc`
