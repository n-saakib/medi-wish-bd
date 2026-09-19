# AccessTokenCodec

Small public seam for issuing and verifying access tokens. It exposes typed issued-token metadata and verified identity/session claims while hiding the JOSE library from controllers and filters. Claims exclude roles, contacts, passwords, refresh values and OTP data.
