param([switch]$RebuildEnvironment)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw | ConvertFrom-Json
foreach ($dir in @('downloads', 'vendor', 'output', 'data/temp')) {
    New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot $dir) | Out-Null
}
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PIP_CACHE_DIR = Join-Path $PSScriptRoot 'downloads/pip-cache'
$env:TEMP = Join-Path $PSScriptRoot 'data/temp'
$env:TMP = $env:TEMP
$py = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $py) -or $RebuildEnvironment) {
    # Recreate in place if the project was moved; never remove user artwork or settings.
    & py -3.12 -m venv (Join-Path $PSScriptRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required to create the tool environment.' }
}
$source = Join-Path $PSScriptRoot 'vendor/pyxelate'
if (!(Test-Path -LiteralPath (Join-Path $source 'setup.py'))) {
    & git clone $manifest.pyxelate.repository $source
    if ($LASTEXITCODE -ne 0) { throw 'Unable to download Pyxelate source.' }
    & git -C $source checkout --detach $manifest.pyxelate.commit
    if ($LASTEXITCODE -ne 0) { throw 'Unable to check out the pinned Pyxelate revision.' }
}
$revision = & git -C $source rev-parse HEAD
if ($revision -ne $manifest.pyxelate.commit) {
    throw 'Unexpected Pyxelate revision. Use the commit recorded in toolchain.json.'
}
& $py -m pip install -r (Join-Path $PSScriptRoot 'requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Unable to install Python dependencies.' }
& $py -m pip install --no-deps $source
if ($LASTEXITCODE -ne 0) { throw 'Unable to install Pyxelate.' }
$editor = Join-Path $PSScriptRoot 'Pixelorama/Pixelorama-Windows-64bit/Pixelorama.exe'
if (!(Test-Path -LiteralPath $editor)) {
    $archive = Join-Path $PSScriptRoot 'downloads/Pixelorama-Windows-64bit.zip'
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest $manifest.pixelorama.url -OutFile $archive -UseBasicParsing
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $manifest.pixelorama.sha256) { throw 'Pixelorama SHA256 mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $PSScriptRoot 'Pixelorama') -Force
}
& $py (Join-Path $PSScriptRoot 'configure.py')
if ($LASTEXITCODE -ne 0) { throw 'Unable to configure tool palettes.' }
Write-Host 'Ready. Open tools/PixelTools.bat or tools/Pixelorama.bat.'
