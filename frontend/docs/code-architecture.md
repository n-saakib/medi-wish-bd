# Frontend code architecture

This is the living code map for the current Next.js frontend. The source tree
remains authoritative; this page documents the route structure, the
server/client boundary, the shared session state and the small API client
seams.

**Last reviewed:** 2026-09-26<br/>
**Current scope:** application shell, English localization, health probe
boundary, and the Ticket 03.01 designed storefront routes: home, sign-in,
registration (Ticket 02) and account with sign-out (Ticket 03 browser session).
Product catalog, search, cart, orders, staff UI, OTP, MFA, recovery and OAuth
screens are not implemented in this slice.

## Application dependency diagram

```mermaid
flowchart TD
    BROWSER[Browser]

    subgraph APP[src/app - Next.js routes]
        LAYOUT[layout.tsx<br/>server document shell]
        CSS[globals.css<br/>ported design tokens]
        STORE["(store)/layout.tsx<br/>store group"]
        HOME["(store)/page.tsx<br/>/"]
        ACCOUNTPAGE["(store)/account/page.tsx<br/>/account"]
        AUTH["(auth)/layout.tsx<br/>auth group"]
        SIGNINPAGE["(auth)/sign-in/page.tsx<br/>/sign-in"]
        REGISTERPAGE["(auth)/register/page.tsx<br/>/register"]
    end

    subgraph AUTHF[src/auth - client]
        PROVIDER[SessionProvider.tsx<br/>shared session state]
        REDIRECT[sessionRedirect.ts<br/>browser redirect rules]
        SIGNIN[SignInForm.tsx]
        REGISTER[RegistrationForm.tsx]
        NOTICE[SignOutNotice.tsx]
    end

    subgraph ACCOUNTF[src/account - client]
        SUMMARY[AccountSummary.tsx]
    end

    subgraph SHELL[src/shell]
        SITEHEADER[SiteHeader.tsx<br/>client]
        AUTHHEADER[AuthHeader.tsx]
        PARTS[Logo, Icon, Alert]
    end

    subgraph LIB[src/lib - client seams]
        SESSION[session.ts<br/>memory-only access session]
        USER[user.ts<br/>registration + profile client]
        HEALTH[health.ts<br/>health response probe]
    end

    I18N[src/i18n/request.ts + messages/en.json]
    API[Spring Boot API<br/>127.0.0.1:8080 by default]
    TESTS[tests + tools<br/>unit, integration and health probe]

    BROWSER --> LAYOUT
    LAYOUT --> I18N
    LAYOUT --> CSS
    LAYOUT --> PROVIDER
    LAYOUT --> STORE
    LAYOUT --> AUTH
    STORE --> SITEHEADER
    STORE --> HOME
    STORE --> ACCOUNTPAGE
    AUTH --> AUTHHEADER
    AUTH --> SIGNINPAGE
    AUTH --> REGISTERPAGE
    HOME --> NOTICE
    ACCOUNTPAGE --> SUMMARY
    SIGNINPAGE --> SIGNIN
    REGISTERPAGE --> REGISTER
    SITEHEADER --> PARTS
    AUTHHEADER --> PARTS
    SIGNIN --> REDIRECT
    REGISTER --> REDIRECT
    SUMMARY --> REDIRECT
    REDIRECT --> PROVIDER
    SIGNIN --> PROVIDER
    REGISTER --> PROVIDER
    NOTICE --> PROVIDER
    SUMMARY --> PROVIDER
    SITEHEADER --> PROVIDER
    PROVIDER --> SESSION
    REGISTER -->|registerUser, userErrorMessage| USER
    SIGNIN -->|userErrorMessage| USER
    SESSION -->|csrf/login/refresh/logout<br/>authenticatedFetch client seam| API
    USER -->|POST /api/auth/register<br/>GET /api/user/me| API
    HEALTH -->|GET /actuator/health/*| API
    TESTS --> PROVIDER
    TESTS --> USER
    TESTS --> SESSION
    TESTS --> HEALTH
```

`layout.tsx`, the route-group layouts, the page files, `request.ts` and message
loading run on the server side of the Next.js boundary, and every route is
statically generated. `AuthHeader` and `Logo` have no client directive and
render on the server inside the auth layout. `SessionProvider`, the forms,
`SignOutNotice`, `AccountSummary`, `SiteHeader` and `Alert` are client
components because they own state, browser events, focus or navigation.
`(store)` and `(auth)` are route groups, so they add no URL segment.

## Session state and redirects

The root layout mounts one `SessionProvider` above both route groups, so the
state survives client-side navigation between them. The provider is the only
React consumer of `src/lib/session.ts`; forms, the header and the account page
read it through `useSession`.

```mermaid
sequenceDiagram
    participant V as Visitor
    participant R as Page (component + sessionRedirect)
    participant P as SessionProvider
    participant S as src/lib/session.ts
    participant U as src/lib/user.ts
    participant A as Spring Boot API

    V->>R: open any page
    R->>P: read state (restoring, so no redirect yet)
    P->>S: restoreSession (once per page load)
    S->>A: Same-origin exclusive lock, CSRF bootstrap and refresh cookie
    A-->>S: rotated session or bounded authentication failure
    S-->>P: profile, none, or error
    P-->>R: restoring ends and the guard picks a target or stays

    alt register on /register
        V->>R: submit username, mobile, optional email, password
        R->>U: registerUser (blank email omitted)
        U->>A: POST /api/auth/register
        A-->>U: 201 public RegisteredUser or bounded error
        Note over R,U: an error shows one alert and stops here
        R->>P: signIn with the same username and password
        Note over R,P: success - guest guard opens /account<br/>failure - accountCreated notice and replace /sign-in
    else sign in on /sign-in
        V->>R: submit identifier and password
        R->>P: signIn(identifier, password)
        P->>S: signIn
        S->>A: POST /api/auth/login with credentials include
        A-->>S: SessionResponse + refresh cookie
        S-->>P: public profile, access token kept in module memory
        Note over R,P: guest guard opens /account
    else sign out on /account
        V->>R: press Sign out
        R->>P: signOut
        P->>S: signOut (token cleared locally first)
        S->>A: POST /api/auth/logout
        Note over R,P: signedOut or signOutError notice<br/>account guard opens / and SignOutNotice announces it
    end
```

`sessionRedirect` is a pure function of the guard and the provider state:

- nothing moves while the restore is running, because the refresh credential
  is an HttpOnly cookie on the API origin and the session is known only in the
  browser;
- the `account` guard sends signed-out visitors to `/sign-in`, sends them to `/`
  right after a sign-out (`signedOut` or `signOutError`), and stays put while
  sign-out is pending;
- the `guest` guard (sign-in and registration) sends signed-in users to
  `/account`. Sign-in success reaches `/account` this way, not by an explicit
  navigation in the form.

Redirects use `router.replace` with fixed paths; no identifier, credential or
token is placed in a URL. The store header renders no account link until the
restore finishes. The provider clears local state even when the server
sign-out fails, because the session client drops the in-memory token before it
calls the API.

## Session client seam

The session module serializes cookie-mutating sign-in/refresh/logout
operations within each client and obtains one same-origin exclusive Web Lock
across each full request and response-validation operation, including CSRF
bootstrap for refresh and logout. This prevents same-origin tabs from applying
cookie updates out of order. Browsers without Web Locks retain only the
per-client queue, and distinct frontend origins do not coordinate. The module
uses an epoch to discard stale in-memory results and is the only browser seam
for access credentials: it bootstraps a bounded CSRF nonce response and echoes
it in the required header, while the API manages the matching non-secret
cookie. It keeps the access JWT in module memory without localStorage,
sessionStorage, IndexedDB, URL, console or durable application state. The
one-time protected-request retry belongs to `authenticatedFetch`, not to
`restoreSession`.

The mounted UI calls `signIn`, `restoreSession`, `signOut` and
`isAuthenticated` through the provider, and `registerUser` and
`userErrorMessage` from `user.ts`. It does not call `loadUserProfile` or
`authenticatedFetch`; those exports are the protected-data client seam for
future consumers, and the single-refresh retry is covered by
`session.test.ts`, not by a mounted page.

## Module responsibilities

| Module | Responsibility | Boundary |
| --- | --- | --- |
| `src/app/layout.tsx` | Root HTML shell, metadata title template, `NextIntlClientProvider` and the single `SessionProvider`. | Server component boundary. |
| `src/app/(store)/*` | Store layout with `SiteHeader`; home page (`/`) and account page (`/account`). | Server route files composing client components. |
| `src/app/(auth)/*` | Auth layout with `AuthHeader` and centered card; sign-in (`/sign-in`) and registration (`/register`) pages. | Server route files composing client components. |
| `src/app/globals.css` | Design tokens and component styles ported from `agent-docs/ui-design/assets/styles.css`, limited to the current pages. | Global stylesheet. |
| `src/auth/` | Session provider and reducer, redirect rules, sign-in and registration forms, sign-out notice. | Client UI and state; network only through `src/lib`. |
| `src/account/` | Read-only account summary and sign-out button. | Client UI; no API calls of its own. |
| `src/shell/` | Store and auth headers, logo, decorative icons and the alert component. | Presentation; `SiteHeader` reads session state. |
| `src/lib/session.ts` | Login, CSRF bootstrap, memory-only access token, per-client cookie mutation queue, same-origin cross-tab cookie-mutation Web Lock, refresh single-flight/retry, epoch invalidation, restore and logout cleanup. | Injectable browser session seam; refresh credentials remain cookie-backed. |
| `src/lib/user.ts` | Registration request construction, same-origin Bearer profile delegation, bounded error/request-ID mapping and response validation. | Network seam to the backend; no credential persistence. |
| `src/lib/health.ts` | Parallel liveness/readiness probe with bounded result states and timeout. | Operational probe seam. |
| `src/i18n/request.ts` | Selects the English locale and loads the message catalog. | Server localization boundary. |
| `messages/en.json` | User-visible English strings by feature namespace (`metadata`, `header`, `home`, `signIn`, `register`, `account`, `errors`). | Externalized message source. |
| `tests/` and `tools/` | Exercise the API seams, provider and redirect rules, mounted pages' components, health integration and the supported probe path. | Verification boundary; synthetic data only. |

## Frontend safety rules

- Keep credentials, tokens, OTPs, personal data and order data out of browser
  storage, URLs, logs and ordinary error text.
- Keep backend error handling bounded and use translated client fallbacks when
  a response is malformed or lacks a safe message.
- Keep `session.ts`, `user.ts` and `health.ts` injectable through their fetch or
  cookie options, and `SessionProvider` injectable through its `source`, so
  unit tests do not require a running backend; reserve real API behavior for
  integration/browser checks.
- Keep all user-visible strings in `messages/`, render alerts only when they
  occur, and move focus to notices that replace the page's context.

## Update checklist

Update this page whenever a route, route group, server/client boundary,
component, library API, message namespace, network contract or test/tool
boundary changes. Keep the diagrams aligned with the current source and tested
behavior. Add future OTP, catalog, cart or order nodes only when their
implementation and contract are actually introduced.
