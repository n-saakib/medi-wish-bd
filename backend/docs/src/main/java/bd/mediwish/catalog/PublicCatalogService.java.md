# `PublicCatalogService.java`

Read-only public catalog projections. `categories` maps the ordered listable-category query; `categoryPage` verifies an active category, checks the listed-item count before calculating the 24-item page, batches position-zero `PublicCatalogImage` values and current prices, and skips any Product whose price snapshot is unexpectedly missing. `product` reads one active priced Product, ordered images and its current price. Product details keep the Product readable when its Category is inactive, but omit that Category from the public projection. Equipment never exposes medicine-only generic-name or dosage-form values.

Category pages and details run in read-only `REPEATABLE_READ` transactions so Product rows, counts, images, category state and discount candidates share one snapshot. The nested `CurrentPrices.forProducts` call joins that transaction. The service does not create or update schema objects.
