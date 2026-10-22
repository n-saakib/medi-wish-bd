# `src/storefront/Breadcrumb.tsx`

Source: [`src/storefront/Breadcrumb.tsx`](../../../src/storefront/Breadcrumb.tsx)

## Purpose

Renders the localized breadcrumb shared by the category and Product details pages.

## Behavior

The navigation landmark uses the translated `storefront.breadcrumb` label and always links Home to `/`. When the Product has a category, it adds that category name linked to its public category page. Products without a category keep the Home-only breadcrumb.

## Verification

The mounted storefront tests exercise the breadcrumb links for a category and for a Product without a category. These tests were authored for Ticket 17 and remain unrun while the baseline browser run uses the existing `.next` output.
