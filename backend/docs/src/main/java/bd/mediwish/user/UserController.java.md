# UserController

Exposes `POST /api/auth/register` and the authenticated common `GET /api/user/me` profile boundary. Registration remains under `/api/auth` because this slice creates the User credential boundary; Ticket 03 can split the future login/session endpoints once that surface exists. Registration returns only public User data and an explicit marker that mobile verification remains deferred. Invalid JSON, invalid input and duplicate registrations use the externalized bounded API error contract, including request correlation.
