# `ProductRules.java`

Pure validation and comparison rules for trimmed catalog fields, medicine/equipment attributes, positive exact BDT pricing, MRP bounds, activation, role permissions, idempotent create identity, and audit change types. Services apply these rules before writing.

Forbidden controls are rejected in the submitted text before trimming, including leading/trailing controls. Edit normalization preserves invalid controls so they cannot become an identical no-op; changed stale intent still precedes field validation. Description alone accepts carriage returns and line feeds.


Blank submitted dosage is preserved during no-op comparison, so Equipment requires null even on an otherwise identical edit; changed stale intent still wins before field validation.
