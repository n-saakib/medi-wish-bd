# `tests/browser/addressesDemo.spec.ts`

Source: [`../../../tests/browser/addressesDemo.spec.ts`](../../../tests/browser/addressesDemo.spec.ts)

One serial `@t12-demo` test follows the plan’s ten reviewer steps through the real browser, API and guarded PostgreSQL schema. It requires an absolute `MEDI_WISH_DEMO_DIR` and creates a unique `<MEDI_WISH_DEMO_DIR>/<project>/run-<suffix>/` directory for each invocation, containing `01.png` through `10.png` and `steps.txt`. The log contains step numbers and observed behavior without personal values. Earlier artifacts remain intact, and a partial rerun cannot inherit screenshots from a previous run. Screenshots contain synthetic fixtures. It covers registration/navigation, allowance notices, persistence/default selection, the full-book race, default removal/promotion, weekly quota refusal, read-only closure, address-only writes/schema snapshot boundary, and ownership refusal. Step 9 compares unrelated-table fingerprints after each create, edit and delete so a later command cannot conceal an earlier unrelated write.

Step 4 seeds two saved rows, then races six creates for the single remaining slot: one insertion and five bounded capacity refusals.

The file intentionally skips when `MEDI_WISH_DEMO_DIR` is absent, as plan T8 requires. All acceptance specs run without this variable. A configured demo refuses to start near a Dhaka week/month boundary. Real monthly and exact rollover proof belongs to fixed-calendar backend ITs, and real Order snapshots/post-order save are assigned to Ticket 25.

Run with a built backend jar, PostgreSQL 18 UTF8 on `TEST_DB_PORT=55433`, and an absolute `MEDI_WISH_DEMO_DIR`: `npm run test:browser -- --grep @t12-demo`. No completed demo or screenshot evidence is claimed before the feature exists and this run succeeds.
