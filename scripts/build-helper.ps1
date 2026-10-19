# 用 Windows 內建的 .NET Framework 編譯器把 native/lockhelper.cs 編成 resources/lockhelper.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Force (Join-Path $root 'resources') | Out-Null
& $csc /nologo /optimize+ /target:winexe "/out:$(Join-Path $root 'resources\lockhelper.exe')" (Join-Path $root 'native\lockhelper.cs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
