# `messages/en.json`

Source: [`../../messages/en.json`](../../messages/en.json)

## Purpose

This is the English message catalog consumed by `next-intl`. Keeping user-visible copy in a catalog gives server components a consistent translation boundary and prevents product text from being duplicated in JSX.

## Message namespaces

- `metadata.title` (`Medi Wish`) and `metadata.description` (`Medi Wish online medical store.`) feed `generateMetadata` in the root layout.
- `home.title` (`Medi Wish`) and `home.description` (`Our online store is being prepared. Please check back soon.`) feed the current home page.

The namespace names are part of the call-site contract: `getTranslations('metadata')` and `getTranslations('home')` resolve the nested keys within the matching object. A new message should be added under the namespace of the feature that owns it, then referenced through `getTranslations` rather than hard-coded in a component.

## Current boundary

Only English is configured today. The file contains no product data, prices, medical advice, user input, or backend responses; it is static presentation copy. The product name is a brand term, so spellcheck warnings for `Medi` do not indicate a source typo.

## Verification

The Next.js build verifies that the JSON can be imported by the request configuration and that all current keys resolve. Changes to keys should be followed by a typecheck/build and a browser check of the affected page or metadata.
