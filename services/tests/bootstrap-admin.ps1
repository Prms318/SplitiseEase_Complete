param(
    [string]$Email = "demo@splitease.example.com",
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
if (-not $EnvFile) {
    $EnvFile = if (Test-Path (Join-Path $repositoryRoot "services/.env")) { "services/.env" } else { "services/.env.example" }
}
Push-Location $repositoryRoot
try {
    docker compose --env-file $EnvFile exec auth-service `
        python -m services.auth.app.bootstrap_admin $Email
    if ($LASTEXITCODE -ne 0) {
        throw "Could not bootstrap platform-admin access. Confirm the account exists and the Auth service is running."
    }
} finally {
    Pop-Location
}
