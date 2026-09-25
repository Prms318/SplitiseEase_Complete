param(
    [string]$BaseUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$suffix = [guid]::NewGuid().ToString("N")
$password = "LocalSmokePass!739"

function Post-Json([string]$Path, [hashtable]$Body, [string]$Token = "") {
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    Invoke-RestMethod -Method Post -Uri "$BaseUrl$Path" -Headers $headers `
        -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
}

$userA = Post-Json "/auth/register" @{ email = "a$suffix@example.com"; password = $password; display_name = "Smoke Test A" }
$userB = Post-Json "/auth/register" @{ email = "b$suffix@example.com"; password = $password; display_name = "Smoke Test B" }
$outsider = Post-Json "/auth/register" @{ email = "x$suffix@example.com"; password = $password; display_name = "Smoke Test X" }
Write-Host "Auth registration passed."

$oldRefreshToken = $userA.refresh_token
$rotated = Post-Json "/auth/refresh" @{ refresh_token = $oldRefreshToken }
$oldRefreshRejected = $false
try {
    Post-Json "/auth/refresh" @{ refresh_token = $oldRefreshToken } | Out-Null
} catch {
    $oldRefreshRejected = ([int]$_.Exception.Response.StatusCode -eq 401)
}
$userA.access_token = $rotated.access_token
$userA.refresh_token = $rotated.refresh_token
Write-Host "Refresh-token rotation passed."

$friendExpense = Post-Json "/api/v1/friends/$($userB.user.id)/expenses" @{
    client_mutation_id = [guid]::NewGuid().ToString()
    description = "Coffee with a friend"
    amount_minor = 1250
    currency = "USD"
} $userA.access_token
Write-Host "Direct friend expense passed."
$thirdMemberDenied = $false
try {
    Post-Json "/api/v1/groups/$($friendExpense.group_id)/members" `
        @{ user_id = $outsider.user.id; role = "member" } $userA.access_token | Out-Null
} catch {
    $thirdMemberDenied = ([int]$_.Exception.Response.StatusCode -eq 409)
}
Write-Host "Friend ledger membership boundary checked."

$group = Post-Json "/api/v1/groups" @{
    name = "Smoke test group"
    currency = "USD"
    member_ids = @($userB.user.id)
} $userA.access_token
Write-Host "Group creation passed."

$mutationId = [guid]::NewGuid().ToString()
$pushBody = @{
    device_id = [guid]::NewGuid().ToString()
    mutations = @(@{
        client_mutation_id = $mutationId
        kind = "group_expense.create"
        group_id = $group.id
        description = "Offline groceries"
        amount_minor = 3400
        currency = "USD"
        split_method = "exact"
        occurred_at = "2026-09-25T16:00:00+02:00"
        splits = @(
            @{ user_id = $userA.user.id; owed_minor = 1700 },
            @{ user_id = $userB.user.id; owed_minor = 1700 }
        )
    })
}
$push1 = Post-Json "/sync/push" $pushBody $userA.access_token
$push2 = Post-Json "/sync/push" $pushBody $userA.access_token
Write-Host "Offline push and idempotent retry passed."
$pull = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sync/pull?cursor=0" `
    -Headers @{ Authorization = "Bearer $($userA.access_token)" }

$balances = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/groups/$($group.id)/balances" `
    -Headers @{ Authorization = "Bearer $($userA.access_token)" }
$debtor = $balances.balances | Where-Object { $_.net_minor -lt 0 } | Select-Object -First 1
$creditor = $balances.balances | Where-Object { $_.net_minor -gt 0 } | Select-Object -First 1
$settlementAmount = [Math]::Min([Math]::Abs($debtor.net_minor), $creditor.net_minor)
$settlementBody = @{
    idempotency_key = [guid]::NewGuid().ToString()
    payer_user_id = $debtor.user_id
    payee_user_id = $creditor.user_id
    amount_minor = $settlementAmount
    currency = "USD"
}
$settlement1 = Post-Json "/api/v1/groups/$($group.id)/settlements" $settlementBody $userA.access_token
$settlement2 = Post-Json "/api/v1/groups/$($group.id)/settlements" $settlementBody $userA.access_token
$afterSettlement = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/groups/$($group.id)/balances" `
    -Headers @{ Authorization = "Bearer $($userA.access_token)" }
Write-Host "Settlement and balance reconciliation passed."

$outsiderDenied = $false
try {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/groups/$($group.id)/expenses" `
        -Headers @{ Authorization = "Bearer $($outsider.access_token)" } | Out-Null
} catch {
    $outsiderDenied = ([int]$_.Exception.Response.StatusCode -eq 404)
}

$checks = [ordered]@{
    friendExpenseCreated = ($friendExpense.id -ne $null)
    groupCreated = ($group.id -ne $null)
    offlinePushCompleted = ($push1.results[0].status -eq "completed")
    retryReturnedSameExpense = ($push1.results[0].result.id -eq $push2.results[0].result.id)
    refreshTokenRotated = ($rotated.refresh_token -ne $oldRefreshToken)
    oldRefreshTokenRejected = $oldRefreshRejected
    cursorAdvanced = ($pull.cursor -gt 0)
    pulledAtLeastOneChange = ($pull.changes.Count -gt 0)
    timestampNormalizedToUtc = ($push1.results[0].result.occurred_at -eq "2026-09-25T14:00:00Z")
    thirdFriendMemberDenied = $thirdMemberDenied
    settlementRetryReturnedSameRecord = ($settlement1.id -eq $settlement2.id)
    settlementClearedBalances = (@($afterSettlement.balances | Where-Object { $_.net_minor -ne 0 }).Count -eq 0)
    unrelatedUserHidden = $outsiderDenied
}

$checks.GetEnumerator() | ForEach-Object {
    "{0}: {1}" -f $_.Key, $_.Value
}
if ($checks.Values -contains $false) {
    throw "One or more SplitEase API smoke checks failed."
}