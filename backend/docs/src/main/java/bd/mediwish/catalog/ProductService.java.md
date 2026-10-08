# `ProductService.java`

Transactional Product create, edit, pricing, list, and detail behavior. A create inserts inactive/unpriced under an active category and compares a repeated UUID against normalized create fields. Edits lock the Product, recognize identical retries before checking version, enforce permissions and purchasability, and write typed history in the same transaction.

All Product mutation timestamps use PostgreSQL's microsecond precision before persistence. Immediate update responses and later reads/retries therefore return identical stored timestamps, including audit times, without adding a refresh query.
