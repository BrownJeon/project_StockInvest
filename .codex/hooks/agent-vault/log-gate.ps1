$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$dir = Get-Item -LiteralPath $payload.cwd
$project = $null
while ($dir) {
    if ((Test-Path (Join-Path $dir.FullName 'agent-vault')) -and (Test-Path (Join-Path $dir.FullName '.codex/hooks/agent-vault'))) { $project = $dir.FullName; break }
    $dir = $dir.Parent
}
if (-not $project) { exit 0 }
$commonDir = & git -C $project rev-parse --path-format=absolute --git-common-dir 2>$null
if ($LASTEXITCODE -ne 0 -or -not $commonDir -or (Split-Path -Leaf $commonDir) -cne '.git' -or
    -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $commonDir) 'agent-vault') -PathType Container)) {
    [Console]::Error.WriteLine("StockInvest 원본 Vault 경로를 확인할 수 없습니다 ($project).")
    exit 2
}
$project = Split-Path -Parent $commonDir
$today = Get-Date -Format 'yyyy-MM-dd'
$log = Join-Path $project "agent-vault/20-Log/$today.md"
if (-not (Test-Path -LiteralPath $log -PathType Leaf)) {
    [Console]::Error.WriteLine("오늘($today) $log 에 아직 기록이 없습니다. 완료 전에 '- [HH:MM][역할] task-<id> 완료 → [[task-<id>-<slug>]]' 한 줄을 기록하세요. (규약: docs/agent-vault-protocol.md)")
    exit 2
}
exit 0