# Respaldo de Pedro: chats y configuracion de Claude Code + datos de IADEMIN que no van a GitHub.
# Copia ACUMULATIVA: nunca borra nada del destino (si algo se borra en origen, el respaldo lo conserva).
# Uso: doble clic en "Respaldar ahora.bat" o:  powershell -ExecutionPolicy Bypass -File respaldar.ps1

$ErrorActionPreference = 'Continue'
$destino = Join-Path $env:OneDrive 'Respaldos'
$log     = Join-Path $destino 'ultimo_respaldo.log'
New-Item -ItemType Directory -Force $destino | Out-Null

$iademin = Join-Path $env:USERPROFILE 'Documents\IADEMIN\Script generar expedientes de contratacion\EXPEDIENTES'

# Cada item: origen, subcarpeta en destino, carpetas a excluir, archivos a excluir
$trabajos = @(
  @{ Origen = Join-Path $env:USERPROFILE '.claude'
     Destino = 'claude-code\.claude'
     XD = @('cache','plugins','shell-snapshots','session-env','ide','state','sessions')
     XF = @('.credentials.json','mcp-needs-auth-cache.json') },
  @{ Origen = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
     Destino = 'claude-code\app-sessions'
     XD = @(); XF = @() },
  @{ Origen = Join-Path $iademin 'datos'
     Destino = 'iademin\datos'
     XD = @(); XF = @() },
  @{ Origen = Join-Path $iademin 'salida'
     Destino = 'iademin\salida'
     XD = @(); XF = @() }
)

"Respaldo iniciado: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Set-Content -Encoding utf8 $log
$fallos = 0
foreach ($t in $trabajos) {
  if (-not (Test-Path $t.Origen)) { "OMITIDO (no existe): $($t.Origen)" | Tee-Object -FilePath $log -Append; continue }
  $dst = Join-Path $destino $t.Destino
  $args = @($t.Origen, $dst, '/E', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NP', '/XO')
  if ($t.XD.Count) { $args += '/XD'; $args += $t.XD }
  if ($t.XF.Count) { $args += '/XF'; $args += $t.XF }
  & robocopy @args | Out-Null
  # robocopy: codigos 0-7 = correcto, 8 o mas = error
  if ($LASTEXITCODE -ge 8) { $fallos++; "ERROR ($LASTEXITCODE): $($t.Origen)" | Tee-Object -FilePath $log -Append }
  else { "OK: $($t.Origen)" | Tee-Object -FilePath $log -Append }
}
"Respaldo terminado: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | fallos: $fallos" | Tee-Object -FilePath $log -Append
if ($fallos -gt 0) { exit 1 }
