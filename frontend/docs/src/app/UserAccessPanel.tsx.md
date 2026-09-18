# `src/app/UserAccessPanel.tsx`

Source: [`src/app/UserAccessPanel.tsx`](../../../src/app/UserAccessPanel.tsx)

## Purpose

Client component for the reduced Ticket 02 shared User flow. It provides accessible registration and username sign-in forms, presents only bounded server status/error text, and keeps entered credentials in component state for the active request only.

## Behavior

Registration posts the username, mobile, optional email and password to the public API and clears the password field after either success or failure. Sign-in calls the protected profile endpoint using an in-memory HTTP Basic header and clears the password after the request. Registration and sign-in have independent busy, status and error state, so one form does not overwrite the other; editing a form clears only that form's feedback. Missing API messages use the account translation catalog, while bounded server messages remain available. Each form keeps polite status and assertive error live regions mounted so assistive technology receives one announcement without a programmatic focus jump.

## Verification

Strict TypeScript checking and the production Next.js build validate the component and its translation provider. API request/response behavior and translated fallback selection are covered by `tests/user.test.ts`; the current in-built browser check covers rendering, keyboard/form interaction and synthetic input, while the live registration/sign-in/wrong-password journey is covered by the backend `UserIT` suite because final account submission is confirmation-gated in the browser tool.
