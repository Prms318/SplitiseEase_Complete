param(
    [string]$BaseUrl = "http://localhost:8080",
    [PSCredential]$AdminCredential
)

$ErrorActionPreference = "Stop"

function Invoke-Json([string]$Method, [string]$Path, [object]$Body = $null, [string]$Token = "") {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = $Body | ConvertTo-Json -Depth 10
    }
    Invoke-RestMethod @params
}

function Assert-HttpStatus([scriptblock]$Action, [int]$ExpectedStatus) {
    try {
        & $Action | Out-Null
        return $false
    } catch {
        return ([int]$_.Exception.Response.StatusCode -eq $ExpectedStatus)
    }
}

$adminSession = Invoke-Json POST "/auth/login" @{ email = $AdminCredential.UserName; password = $AdminCredential.GetNetworkCredential().Password }
$adminToken = $adminSession.access_token
Write-Host "Platform admin login passed."
$summary = Invoke-Json GET "/admin/summary" $null $adminToken
Write-Host "Admin summary authorization passed."

$tag = [guid]::NewGuid().ToString("N")
$normal = Invoke-Json POST "/auth/register" @{
    email = "ordinary-admin-test-$tag@example.com"
    password = "OrdinarySmokePass!2026"
    display_name = "Ordinary Smoke User"
}
$normalDenied = Assert-HttpStatus { Invoke-Json GET "/admin/summary" $null $normal.access_token } 403
Write-Host "Ordinary user denial passed."

$invite = Invoke-Json POST "/admin/users/invitations" @{
    email = "invited-admin-test-$tag@example.com"
    display_name = "Invited Admin Smoke User"
} $adminToken
Write-Host "Admin invitation creation passed."
$invited = Invoke-Json POST "/auth/accept-invitation" @{
    token = $invite.invite_token
    password = "InvitedSmokePass!2026"
}
Write-Host "Invitation acceptance passed."
$inviteTokenReuseDenied = Assert-HttpStatus {
    Invoke-Json POST "/auth/accept-invitation" @{ token = $invite.invite_token; password = "AnotherSmokePass!2026" }
} 400

$grant = Invoke-Json POST "/admin/users/$($invited.user.id)/pro-grants" @{
    reason = "Admin smoke test grant"
    expires_at = $null
} $adminToken
Write-Host "Pro grant passed."
$proVisibleOnUser = (Invoke-Json GET "/auth/me" $null $invited.access_token).is_pro
Write-Host "Pro entitlement visible to invited user."
$revoke = Invoke-Json DELETE "/admin/users/$($invited.user.id)/pro-grants/$($grant.active_pro_grant.id)?reason=Admin%20smoke%20test%20complete" $null $adminToken
Write-Host "Pro grant revocation passed."

$statusSuspended = Invoke-Json PATCH "/admin/users/$($invited.user.id)/status" @{
    is_active = $false
    reason = "Admin smoke test suspension"
} $adminToken
$suspendedLoginDenied = Assert-HttpStatus {
    Invoke-Json POST "/auth/login" @{ email = $invited.user.email; password = "InvitedSmokePass!2026" }
} 401
$suspendedAccessDenied = Assert-HttpStatus {
    Invoke-Json GET "/api/v1/groups" $null $invited.access_token
} 401
$statusReactivated = Invoke-Json PATCH "/admin/users/$($invited.user.id)/status" @{
    is_active = $true
    reason = "Admin smoke test complete"
} $adminToken

$regularSession = Invoke-Json POST "/auth/login" @{ email = $invited.user.email; password = "InvitedSmokePass!2026" }
$sessionRevocation = Invoke-Json POST "/admin/users/$($invited.user.id)/sessions/revoke" @{
    reason = "Admin smoke test session revoke"
} $adminToken
$oldRefreshDenied = Assert-HttpStatus {
    Invoke-Json POST "/auth/refresh" @{ refresh_token = $regularSession.refresh_token }
} 401
$audit = Invoke-Json GET "/admin/audit?limit=100" $null $adminToken
$actions = @($audit | ForEach-Object { $_.action })

$checks = [ordered]@{
    adminSummaryAccessible = ($summary.users -gt 0)
    ordinaryUserDeniedAdminApi = $normalDenied
    invitationAccepted = ($invited.user.email -eq $invite.email)
    invitationTokenSingleUse = $inviteTokenReuseDenied
    proGrantVisibleToUser = $proVisibleOnUser
    proGrantRevoked = (!$revoke.is_pro)
    accountSuspended = (!$statusSuspended.is_active)
    suspendedAccountCannotLogin = $suspendedLoginDenied
    suspendedAccessTokenRejected = $suspendedAccessDenied
    accountReactivated = $statusReactivated.is_active
    sessionRefreshRevoked = $oldRefreshDenied
    sessionRevocationCount = ($sessionRevocation.revoked_sessions -gt 0)
    auditRecordsCreated = ($actions -contains "user.invited" -and $actions -contains "pro.granted" -and $actions -contains "pro.revoked" -and $actions -contains "user.status_changed" -and $actions -contains "user.sessions_revoked")
}
$checks.GetEnumerator() | ForEach-Object { "{0}: {1}" -f $_.Key, $_.Value }
if ($checks.Values -contains $false) { throw "One or more platform-admin smoke checks failed." }
