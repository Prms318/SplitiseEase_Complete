# Platform Admin Console

The web admin console is available only to an account whose `users.is_platform_admin` flag is set. Public registration never assigns this flag, and no public API can promote accounts.

## Bootstrap the first local administrator

Start the Compose stack and create/sign in to the account to promote. From the repository root, run:

```powershell
.\services\tests\bootstrap-admin.ps1 -Email "demo@splitease.example.com"
```

The operator script executes inside the Auth container, requires an existing active account, sets the platform-admin flag, and records an audit event. It uses `services/.env` if present, otherwise `services/.env.example`. Sign out and back in so the browser receives an access token with the updated admin claim.

The default local demo account is `demo@splitease.example.com` / `LocalDemoPass!2026`; these are development-only credentials.

## Console capabilities

- Search accounts by display name or email, with status and effective Pro entitlement.
- Create seven-day, single-use invitations. The API stores only a token digest; the raw token is shown once so it can be shared securely. The invited person sets their own password at `/auth/accept-invitation`.
- Suspend/reactivate an account with a required reason. Suspension revokes refresh sessions. Authenticated services check the account's active state through the private Auth service, so already-issued access tokens are rejected immediately. Protected requests fail closed if Auth is unavailable.
- Revoke all refresh sessions for a user with a required reason.
- Grant manual Pro access with a reason and optional expiry; revoke manual grants with a reason. Manual grants are audited and do not represent payment or a subscription.
- View recent admin actions and reasons in the audit tab.

## Security notes

Admin API routes are guarded server-side by the database-backed platform-admin flag; hiding UI elements is not the security boundary. Bootstrap access requires Docker/operator privileges. For production, use a controlled bootstrap process, MFA, secret management, and role separation for support and billing staff.

A suspended user's refresh tokens are revoked and Auth-backed token checks reject their existing access token immediately. The current admin console does not expose password resets or view passwords. Invitation delivery is manual; an email provider integration is not included yet.

## Verification

Run the admin workflow suite with a PowerShell credential prompt; the password is not stored in the test script:

```powershell
$adminCredential = Get-Credential
.\services\tests\platform-admin-smoke.ps1 -AdminCredential $adminCredential
```
