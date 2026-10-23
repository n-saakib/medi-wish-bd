# `src/account/EmailVerificationDialog.tsx`

Native modal for a saved email code. It validates six digits, links bounded errors, clears/refocuses a refused code, and offers resend with a success status; after a successful resend focus returns to **Code** once it is enabled again. Code and action buttons respect parent busy/closing state plus a synchronous submission guard. Cancel/Escape and external close clear secrets and feedback; focus returns after close. A queued old close event cannot close a reopened modal. The dialog reuses profile styling because no dedicated design exists.
