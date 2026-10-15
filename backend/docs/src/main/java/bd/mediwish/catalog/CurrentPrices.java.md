# `CurrentPrices.java`

Shared current-pricing boundary for one Product, active public Product or a bounded Product page. Reads Products and candidates in a repeatable-read transaction, captures today once, fetches candidates once per batch, and omits unpriced Products. Category matching uses current membership; later cart/order consumers copy the immutable EffectivePrice.
