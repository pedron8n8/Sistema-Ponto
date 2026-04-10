$ProgressPreference = 'SilentlyContinue'

$apiKey = $env:SUPABASE_KEY
$supabaseUrl = $env:SUPABASE_URL
$authUrl = if ($supabaseUrl) { "$supabaseUrl/auth/v1/token?grant_type=password" } else { '' }
$base = if ($env:BACKEND_BASE_URL) { $env:BACKEND_BASE_URL } else { 'http://localhost:3000' }
$api = "$base/api/v1"

function Get-Token([string]$email, [string]$password) {
  if (-not $apiKey -or -not $authUrl -or -not $email -or -not $password) {
    return ''
  }

  try {
    $payload = @{ email = $email; password = $password } | ConvertTo-Json
    $resp = Invoke-RestMethod -Method Post -Uri $authUrl -Headers @{ apikey = $apiKey } -ContentType 'application/json' -Body $payload -TimeoutSec 20
    return $resp.access_token
  }
  catch {
    return ''
  }
}

function Invoke-ApiStatus([string]$method, [string]$url, [string]$token, [object]$body = $null, [int]$timeoutSec = 15, [string]$clientKey = 'qa-default') {
  try {
    $headers = @{ 'x-forwarded-for' = $clientKey }
    if ($token) { $headers.Authorization = "Bearer $token" }

    if ($null -ne $body) {
      $json = $body | ConvertTo-Json -Depth 10
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -Method $method -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec $timeoutSec -ErrorAction Stop
    }
    else {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -Method $method -Headers $headers -TimeoutSec $timeoutSec -ErrorAction Stop
    }

    return [int]$resp.StatusCode
  }
  catch {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    return -1
  }
}

function Invoke-ApiStatusWithRetry([string]$method, [string]$url, [string]$token, [object]$body = $null, [string]$clientKey = 'qa-default') {
  $status = Invoke-ApiStatus $method $url $token $body 15 $clientKey

  if ($status -eq 429) {
    Start-Sleep -Seconds 65
    $status = Invoke-ApiStatus $method $url $token $body 15 $clientKey
  }

  Start-Sleep -Milliseconds 650
  return $status
}

$memberEmail = if ($env:MATRIX_MEMBER_EMAIL) { $env:MATRIX_MEMBER_EMAIL } else { 'colaborador1@empresa.com' }
$supervisorEmail = if ($env:MATRIX_SUPERVISOR_EMAIL) { $env:MATRIX_SUPERVISOR_EMAIL } else { 'supervisor1@empresa.com' }
$hrEmail = if ($env:MATRIX_HR_EMAIL) { $env:MATRIX_HR_EMAIL } else { 'rh@empresa.com' }
$adminEmail = if ($env:MATRIX_ADMIN_EMAIL) { $env:MATRIX_ADMIN_EMAIL } else { 'admin@empresa.com' }

$tokens = @{
  none = ''
  member = Get-Token $memberEmail $env:MATRIX_MEMBER_PASSWORD
  supervisor = Get-Token $supervisorEmail $env:MATRIX_SUPERVISOR_PASSWORD
  hr = Get-Token $hrEmail $env:MATRIX_HR_PASSWORD
  admin = Get-Token $adminEmail $env:MATRIX_ADMIN_PASSWORD
}

$users = @()
try { $users = (Invoke-RestMethod -Uri "$api/users" -Headers @{ Authorization = "Bearer $($tokens.admin)" } -TimeoutSec 15).users } catch {}
$firstUserId = if ($users.Count -gt 0) { $users[0].id } else { '00000000-0000-0000-0000-000000000000' }
$memberRecord = $users | Where-Object { $_.role -eq 'MEMBER' } | Select-Object -First 1
$memberId = if ($memberRecord) { $memberRecord.id } else { $firstUserId }

$timeEntries = @()
try { $timeEntries = (Invoke-RestMethod -Uri "$api/time/me?page=1&limit=5" -Headers @{ Authorization = "Bearer $($tokens.member)" } -TimeoutSec 15).entries } catch {}
$firstTimeEntryId = if ($timeEntries.Count -gt 0) { $timeEntries[0].id } else { '00000000-0000-0000-0000-000000000000' }

$pendingEntries = @()
try { $pendingEntries = (Invoke-RestMethod -Uri "$api/supervisor/entries" -Headers @{ Authorization = "Bearer $($tokens.supervisor)" } -TimeoutSec 15).entries } catch {}
$firstPendingId = if ($pendingEntries.Count -gt 0) { $pendingEntries[0].id } else { $firstTimeEntryId }

$reportList = @()
try { $reportList = (Invoke-RestMethod -Uri "$api/reports/list" -Headers @{ Authorization = "Bearer $($tokens.admin)" } -TimeoutSec 15).reports } catch {}
$firstFilename = if ($reportList.Count -gt 0) { $reportList[0].filename } else { 'nao_existe.csv' }

$vacReqs = @()
try { $vacReqs = (Invoke-RestMethod -Uri "$api/vacations/team/requests?status=ALL" -Headers @{ Authorization = "Bearer $($tokens.supervisor)" } -TimeoutSec 15).requests } catch {}
$firstVacationId = if ($vacReqs.Count -gt 0) { $vacReqs[0].id } else { '00000000-0000-0000-0000-000000000000' }

$endpoints = @(
  @{ name = 'GET /health'; m = 'GET'; u = "$base/health"; b = $null },
  @{ name = 'GET /api/v1/health'; m = 'GET'; u = "$api/health"; b = $null },
  @{ name = 'GET /api/v1/protected'; m = 'GET'; u = "$api/protected"; b = $null },
  @{ name = 'GET /api/v1/admin-only'; m = 'GET'; u = "$api/admin-only"; b = $null },
  @{ name = 'GET /api/v1/supervisor-access'; m = 'GET'; u = "$api/supervisor-access"; b = $null },
  @{ name = 'GET /api/v1/auth/me'; m = 'GET'; u = "$api/auth/me"; b = $null },
  @{ name = 'GET /api/v1/auth/profile'; m = 'GET'; u = "$api/auth/profile"; b = $null },
  @{ name = 'GET /api/v1/users/me/face'; m = 'GET'; u = "$api/users/me/face"; b = $null },
  @{ name = 'POST /api/v1/users/me/face/enroll'; m = 'POST'; u = "$api/users/me/face/enroll"; b = @{} },
  @{ name = 'DELETE /api/v1/users/me/face'; m = 'DELETE'; u = "$api/users/me/face"; b = $null },
  @{ name = 'GET /api/v1/users'; m = 'GET'; u = "$api/users"; b = $null },
  @{ name = 'GET /api/v1/users/:id'; m = 'GET'; u = "$api/users/$memberId"; b = $null },
  @{ name = 'POST /api/v1/users'; m = 'POST'; u = "$api/users"; b = @{} },
  @{ name = 'PATCH /api/v1/users/:id'; m = 'PATCH'; u = "$api/users/$memberId"; b = @{} },
  @{ name = 'DELETE /api/v1/users/:id'; m = 'DELETE'; u = "$api/users/00000000-0000-0000-0000-000000000000"; b = $null },
  @{ name = 'POST /api/v1/time/terminal/qr'; m = 'POST'; u = "$api/time/terminal/qr"; b = @{ terminalId = 'terminal-sp-01' } },
  @{ name = 'POST /api/v1/time/clock-in'; m = 'POST'; u = "$api/time/clock-in"; b = @{ notes = 'qa-check' } },
  @{ name = 'POST /api/v1/time/clock-out'; m = 'POST'; u = "$api/time/clock-out"; b = @{ notes = 'qa-check' } },
  @{ name = 'GET /api/v1/time/current'; m = 'GET'; u = "$api/time/current"; b = $null },
  @{ name = 'GET /api/v1/time/today'; m = 'GET'; u = "$api/time/today"; b = $null },
  @{ name = 'GET /api/v1/time/geofence'; m = 'GET'; u = "$api/time/geofence"; b = $null },
  @{ name = 'GET /api/v1/time/me'; m = 'GET'; u = "$api/time/me?page=1&limit=5"; b = $null },
  @{ name = 'GET /api/v1/time/bank-hours/me'; m = 'GET'; u = "$api/time/bank-hours/me"; b = $null },
  @{ name = 'PATCH /api/v1/time/:id/notes'; m = 'PATCH'; u = "$api/time/$firstTimeEntryId/notes"; b = @{ notes = 'ajuste teste' } },
  @{ name = 'GET /api/v1/time/:id'; m = 'GET'; u = "$api/time/$firstTimeEntryId"; b = $null },
  @{ name = 'GET /api/v1/supervisor/team'; m = 'GET'; u = "$api/supervisor/team"; b = $null },
  @{ name = 'GET /api/v1/supervisor/presence'; m = 'GET'; u = "$api/supervisor/presence"; b = $null },
  @{ name = 'GET /api/v1/supervisor/kpis/hours'; m = 'GET'; u = "$api/supervisor/kpis/hours?period=weekly"; b = $null },
  @{ name = 'GET /api/v1/supervisor/entries'; m = 'GET'; u = "$api/supervisor/entries"; b = $null },
  @{ name = 'GET /api/v1/supervisor/entries/:id'; m = 'GET'; u = "$api/supervisor/entries/$firstPendingId"; b = $null },
  @{ name = 'PATCH /api/v1/supervisor/approve/:id'; m = 'PATCH'; u = "$api/supervisor/approve/$firstPendingId"; b = @{} },
  @{ name = 'PATCH /api/v1/supervisor/reject/:id'; m = 'PATCH'; u = "$api/supervisor/reject/$firstPendingId"; b = @{ comment = 'x' } },
  @{ name = 'PATCH /api/v1/supervisor/request-edit/:id'; m = 'PATCH'; u = "$api/supervisor/request-edit/$firstPendingId"; b = @{ comment = 'x' } },
  @{ name = 'PATCH /api/v1/supervisor/team/:userId/bank-hours'; m = 'PATCH'; u = "$api/supervisor/team/$memberId/bank-hours"; b = @{ minutes = 15; reason = 'qa' } },
  @{ name = 'GET /api/v1/supervisor/team/bank-hours/overview'; m = 'GET'; u = "$api/supervisor/team/bank-hours/overview"; b = $null },
  @{ name = 'PATCH /api/v1/supervisor/team/:userId/bank-hours/pay'; m = 'PATCH'; u = "$api/supervisor/team/$memberId/bank-hours/pay"; b = @{ minutes = 15; reason = 'qa' } },
  @{ name = 'PATCH /api/v1/supervisor/team/:userId/work-settings'; m = 'PATCH'; u = "$api/supervisor/team/$memberId/work-settings"; b = @{} },
  @{ name = 'GET /api/v1/supervisor/presence/stream'; m = 'GET'; u = "$api/supervisor/presence/stream"; b = $null },
  @{ name = 'POST /api/v1/reports/export'; m = 'POST'; u = "$api/reports/export"; b = @{} },
  @{ name = 'GET /api/v1/reports/status/:jobId'; m = 'GET'; u = "$api/reports/status/00000000-0000-0000-0000-000000000000"; b = $null },
  @{ name = 'GET /api/v1/reports/list'; m = 'GET'; u = "$api/reports/list"; b = $null },
  @{ name = 'GET /api/v1/reports/download/:filename'; m = 'GET'; u = "$api/reports/download/$firstFilename"; b = $null },
  @{ name = 'GET /api/v1/reports/daily-breakdown'; m = 'GET'; u = "$api/reports/daily-breakdown"; b = $null },
  @{ name = 'DELETE /api/v1/reports/:filename'; m = 'DELETE'; u = "$api/reports/$firstFilename"; b = $null },
  @{ name = 'GET /api/v1/admin/stats'; m = 'GET'; u = "$api/admin/stats"; b = $null },
  @{ name = 'GET /api/v1/admin/team-overview'; m = 'GET'; u = "$api/admin/team-overview"; b = $null },
  @{ name = 'GET /api/v1/admin/audit/:timeEntryId'; m = 'GET'; u = "$api/admin/audit/$firstTimeEntryId"; b = $null },
  @{ name = 'GET /api/v1/admin/users/:userId/entries'; m = 'GET'; u = "$api/admin/users/$memberId/entries"; b = $null },
  @{ name = 'PATCH /api/v1/admin/users/:userId/supervisor'; m = 'PATCH'; u = "$api/admin/users/$memberId/supervisor"; b = @{ supervisorId = $null } },
  @{ name = 'PATCH /api/v1/admin/users/:userId/pin'; m = 'PATCH'; u = "$api/admin/users/$memberId/pin"; b = @{ pin = '1234' } },
  @{ name = 'DELETE /api/v1/admin/users/:userId/pin'; m = 'DELETE'; u = "$api/admin/users/$memberId/pin"; b = $null },
  @{ name = 'PATCH /api/v1/admin/users/:userId/bank-hours'; m = 'PATCH'; u = "$api/admin/users/$memberId/bank-hours"; b = @{ minutes = 10; reason = 'qa' } },
  @{ name = 'GET /api/v1/admin/bank-hours/overview'; m = 'GET'; u = "$api/admin/bank-hours/overview"; b = $null },
  @{ name = 'PATCH /api/v1/admin/users/:userId/bank-hours/pay'; m = 'PATCH'; u = "$api/admin/users/$memberId/bank-hours/pay"; b = @{ minutes = 10; reason = 'qa' } },
  @{ name = 'PATCH /api/v1/admin/users/:userId/work-settings'; m = 'PATCH'; u = "$api/admin/users/$memberId/work-settings"; b = @{} },
  @{ name = 'GET /api/v1/admin/location-settings'; m = 'GET'; u = "$api/admin/location-settings"; b = $null },
  @{ name = 'PATCH /api/v1/admin/location-settings'; m = 'PATCH'; u = "$api/admin/location-settings"; b = @{} },
  @{ name = 'GET /api/v1/vacations/me'; m = 'GET'; u = "$api/vacations/me"; b = $null },
  @{ name = 'POST /api/v1/vacations/request'; m = 'POST'; u = "$api/vacations/request"; b = @{} },
  @{ name = 'GET /api/v1/vacations/team/requests'; m = 'GET'; u = "$api/vacations/team/requests?status=ALL"; b = $null },
  @{ name = 'GET /api/v1/vacations/hr/requests'; m = 'GET'; u = "$api/vacations/hr/requests?status=ALL"; b = $null },
  @{ name = 'PATCH /api/v1/vacations/:id/supervisor-review'; m = 'PATCH'; u = "$api/vacations/$firstVacationId/supervisor-review"; b = @{ decision = 'APPROVE' } },
  @{ name = 'PATCH /api/v1/vacations/:id/hr-review'; m = 'PATCH'; u = "$api/vacations/$firstVacationId/hr-review"; b = @{ decision = 'CONFIRM' } },
  @{ name = 'GET /api/v1/vacations/team/calendar'; m = 'GET'; u = "$api/vacations/team/calendar?year=2026&month=3"; b = $null }
)

$roles = @('none', 'member', 'supervisor', 'hr', 'admin')
$rows = @()

foreach ($ep in $endpoints) {
  $row = [ordered]@{
    Endpoint = $ep.name
    Method = $ep.m
  }

  foreach ($role in $roles) {
    $clientKey = "qa-matrix-$role"
    $status = Invoke-ApiStatusWithRetry $ep.m $ep.u $tokens[$role] $ep.b $clientKey

    $label = if ($status -eq 401 -or $status -eq 403) {
      'BLOQUEADO'
    }
    elseif ($status -eq 429) {
      'LIMITADO'
    }
    elseif ($status -eq -1) {
      'ERRO_CLIENTE'
    }
    else {
      'PERMITIDO'
    }

    $row[$role] = "$label ($status)"
  }

  $rows += [pscustomobject]$row
}

$summary = [pscustomobject]@{
  totalEndpoints = $rows.Count
  blockedByRole = [pscustomobject]@{
    none = ($rows | Where-Object { $_.none -like 'BLOQUEADO*' }).Count
    member = ($rows | Where-Object { $_.member -like 'BLOQUEADO*' }).Count
    supervisor = ($rows | Where-Object { $_.supervisor -like 'BLOQUEADO*' }).Count
    hr = ($rows | Where-Object { $_.hr -like 'BLOQUEADO*' }).Count
    admin = ($rows | Where-Object { $_.admin -like 'BLOQUEADO*' }).Count
  }
  limitedAny = ($rows | Where-Object {
      $_.none -like 'LIMITADO*' -or
      $_.member -like 'LIMITADO*' -or
      $_.supervisor -like 'LIMITADO*' -or
      $_.hr -like 'LIMITADO*' -or
      $_.admin -like 'LIMITADO*'
    }).Count
}

$reportPath = Join-Path (Split-Path $PSScriptRoot -Parent) '..\MATRIZ_AUTORIZACAO_API_2026-03-26.md'
$jsonPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.authorization-matrix-results.json'

$md = @()
$md += '# Matriz de Autorizacao da API'
$md += ''
$md += 'Data: 2026-03-26'
$md += 'Base URL: http://localhost:3000/api/v1'
$md += ''
$md += 'Criterio de classificacao:'
$md += '- BLOQUEADO: status 401 ou 403'
$md += '- PERMITIDO: qualquer outro status HTTP'
$md += '- LIMITADO: status 429 (rate limit, nao representa regra de autorizacao)'
$md += '- ERRO_CLIENTE: falha local sem resposta HTTP'
$md += ''
$md += 'Resumo:'
$md += "- Endpoints verificados: $($summary.totalEndpoints)"
$md += "- Bloqueios sem token: $($summary.blockedByRole.none)"
$md += "- Bloqueios MEMBER: $($summary.blockedByRole.member)"
$md += "- Bloqueios SUPERVISOR: $($summary.blockedByRole.supervisor)"
$md += "- Bloqueios HR: $($summary.blockedByRole.hr)"
$md += "- Bloqueios ADMIN: $($summary.blockedByRole.admin)"
$md += "- Endpoints com alguma ocorrencia de LIMITADO (429): $($summary.limitedAny)"
$md += ''
$md += '## Tabela completa'
$md += ''
$md += '| Endpoint | Metodo | Sem token | MEMBER | SUPERVISOR | HR | ADMIN |'
$md += '|---|---|---|---|---|---|---|'

foreach ($r in $rows) {
  $md += "| $($r.Endpoint) | $($r.Method) | $($r.none) | $($r.member) | $($r.supervisor) | $($r.hr) | $($r.admin) |"
}

Set-Content -Path $reportPath -Value $md -Encoding utf8
$rows | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonPath -Encoding utf8

Write-Output "matrix-regenerated:$reportPath"
Write-Output "limitedAny:$($summary.limitedAny)"
