# `tests/UserAccessPanel.test.ts`

Source: [`tests/UserAccessPanel.test.ts`](../../tests/UserAccessPanel.test.ts)

## Purpose

Static client-component coverage for the user access panel’s login contract and accessibility regions.

## Verification

The test renders through the real typed `NextIntlClientProvider` with the English catalog and checks the username/mobile/email label, stable status and alert regions, and the absence of the removed Basic label and storage terminology. Interactive browser behavior remains a later real-browser verification responsibility.
