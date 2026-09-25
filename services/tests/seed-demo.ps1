param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$Password = $env:SPLITEASE_DEMO_PASSWORD
)

$ErrorActionPreference = "Stop"
if (-not $Password) { $Password = "LocalDemoPass!2026" }

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

function Get-OrCreateUser([string]$Email, [string]$DisplayName) {
    try {
        Invoke-Json POST "/auth/register" @{ email = $Email; password = $Password; display_name = $DisplayName }
    } catch {
        if ([int]$_.Exception.Response.StatusCode -ne 409) { throw }
        Invoke-Json POST "/auth/login" @{ email = $Email; password = $Password }
    }
}

function Ensure-Group([string]$Name, [string[]]$MemberIds, [string]$OwnerToken) {
    $groups = Invoke-Json GET "/api/v1/groups" $null $OwnerToken
    $group = $groups | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $group) {
        $group = Invoke-Json POST "/api/v1/groups" @{ name = $Name; currency = "USD"; member_ids = $MemberIds } $OwnerToken
    }
    $members = Invoke-Json GET "/api/v1/groups/$($group.id)/members" $null $OwnerToken
    $existingIds = @($members | ForEach-Object { $_.user_id })
    foreach ($memberId in $MemberIds) {
        if ($existingIds -notcontains $memberId) {
            Invoke-Json POST "/api/v1/groups/$($group.id)/members" @{ user_id = $memberId; role = "member" } $OwnerToken | Out-Null
        }
    }
    $group
}

function Add-SampleExpense($Group, [string]$Description, [long]$AmountMinor, [string]$PayerId, [string[]]$MemberIds, [string]$OwnerToken, [int]$DaysAgo) {
    $existing = Invoke-Json GET "/api/v1/groups/$($Group.id)/expenses?limit=100" $null $OwnerToken
    if ($existing | Where-Object { $_.description -eq $Description }) { return }

    $orderedIds = @($MemberIds | Sort-Object)
    $baseShare = [long][Math]::Floor($AmountMinor / $orderedIds.Count)
    $remainder = $AmountMinor - ($baseShare * $orderedIds.Count)
    $splits = @()
    for ($index = 0; $index -lt $orderedIds.Count; $index++) {
        $share = $baseShare
        if ($index -lt $remainder) { $share++ }
        $splits += @{ user_id = $orderedIds[$index]; owed_minor = $share }
    }
    $occurredAt = (Get-Date).ToUniversalTime().AddDays(-$DaysAgo).ToString("yyyy-MM-ddTHH:mm:ssZ")
    Invoke-Json POST "/api/v1/groups/$($Group.id)/expenses" @{
        client_mutation_id = [guid]::NewGuid().ToString()
        description = $Description
        amount_minor = $AmountMinor
        currency = "USD"
        split_method = "exact"
        paid_by_user_id = $PayerId
        occurred_at = $occurredAt
        splits = $splits
    } $OwnerToken | Out-Null
}

$demo = Get-OrCreateUser "demo@splitease.example.com" "Jordan Davis"
$maya = Get-OrCreateUser "maya@splitease.example.com" "Maya Chen"
$alex = Get-OrCreateUser "alex@splitease.example.com" "Alex Rivera"

$trip = Ensure-Group "Copenhagen weekend" @($maya.user.id, $alex.user.id) $demo.access_token
$homeGroup = Ensure-Group "Apartment 4B" @($maya.user.id, $alex.user.id) $demo.access_token

Add-SampleExpense $trip "Canal boat tickets" 17400 $demo.user.id @($demo.user.id, $maya.user.id, $alex.user.id) $demo.access_token 12
Add-SampleExpense $trip "Dinner at Bar Moro" 28640 $maya.user.id @($demo.user.id, $maya.user.id, $alex.user.id) $demo.access_token 1
Add-SampleExpense $homeGroup "September utilities" 9250 $alex.user.id @($demo.user.id, $maya.user.id, $alex.user.id) $demo.access_token 3
Add-SampleExpense $homeGroup "Green Market groceries" 6432 $demo.user.id @($demo.user.id, $maya.user.id, $alex.user.id) $demo.access_token 1

$friendGroup = $null
$allGroups = Invoke-Json GET "/api/v1/groups" $null $demo.access_token
foreach ($candidate in ($allGroups | Where-Object { $_.kind -eq "friend" })) {
    $candidateMembers = Invoke-Json GET "/api/v1/groups/$($candidate.id)/members" $null $demo.access_token
    if (@($candidateMembers.user_id) -contains $maya.user.id) { $friendGroup = $candidate; break }
}
$friendExpenses = @()
if ($friendGroup) { $friendExpenses = Invoke-Json GET "/api/v1/groups/$($friendGroup.id)/expenses?limit=100" $null $demo.access_token }
if (-not ($friendExpenses | Where-Object { $_.description -eq "Coffee with Maya" })) {
    Invoke-Json POST "/api/v1/friends/$($maya.user.id)/expenses" @{
        client_mutation_id = [guid]::NewGuid().ToString()
        description = "Coffee with Maya"
        amount_minor = 1250
        currency = "USD"
    } $demo.access_token | Out-Null
}

Write-Host "SplitEase demo data is ready."
Write-Host "Login email: demo@splitease.example.com"
Write-Host "Password: $Password"
Write-Host "Maya: maya@splitease.example.com"
Write-Host "Alex: alex@splitease.example.com"
