$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mod.json') -Raw | ConvertFrom-Json
$output = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$files = Get-ChildItem -LiteralPath $PSScriptRoot -Force | Where-Object { $_.Name -notin 'dist','test','.gitignore','build.ps1' } | Select-Object -ExpandProperty FullName
$archive = Join-Path $output "jiafee-together-listen-$($manifest.version).zip"
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
Get-FileHash -LiteralPath $archive -Algorithm SHA256
