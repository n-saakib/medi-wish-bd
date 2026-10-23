# `tests/BackupCodesPanel.test.ts`

Source: [`tests/BackupCodesPanel.test.ts`](../../tests/BackupCodesPanel.test.ts)

## Purpose

Mounted jsdom coverage for [`BackupCodesPanel`](../src/auth/BackupCodesPanel.tsx.md) with the ten synthetic codes from [`fakeApi`](fakeApi.ts.md), a replaceable `navigator.clipboard` and a mocked router.

## Verification

- The heading, warning, labelled list with every code once, and no status or alert at first.
- `Copy all` writes the codes one per line and shows `Copied`.
- A denied clipboard, and a missing clipboard, show the copy-it-yourself alert and keep the codes visible.
- `I’ve saved them` calls `onSaved` once and opens `/staff`. That the codes then disappear is covered in [`MfaEnrollment.test.ts`](MfaEnrollment.test.ts.md).

Ticket 09 table-tests the four notice texts and success/warning tones. A regeneration presentation test confirms `steps={false}` omits enrollment progress.

The integrated replacement notice contract uses verified-contacts wording for `SENT` and `FAILED`, covering mobile and email without disclosing recipients; the other two outcome messages remain unchanged.
