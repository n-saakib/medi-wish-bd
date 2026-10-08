# `src/app/(store)/account/profile/page.tsx`

Source: [`src/app/(store)/account/profile/page.tsx`](../../../../../../src/app/(store)/account/profile/page.tsx)

This server route maps `/account/profile` to the client [`ProfileForm`](../../../../account/ProfileForm.tsx.md) inside the shared store layout. The form enforces the browser session guard before loading caller-owned data. `generateMetadata` uses the translated Profile title. The page adds no server-side personal-data fetch or URL parameter.
