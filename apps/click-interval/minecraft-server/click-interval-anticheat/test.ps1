$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("click-interval-ac-tests-" + [guid]::NewGuid().ToString('N'))
$Classes = Join-Path $TempRoot 'classes'

try {
    New-Item -ItemType Directory -Force -Path $Classes | Out-Null
    $CoreSources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src/main/java/com/clickinterval/anticheat/core') -Filter '*.java' | ForEach-Object FullName
    $TestSources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src/test/java') -Recurse -Filter '*.java' | ForEach-Object FullName
    $Sources = @($CoreSources) + @($TestSources)
    & javac --release 21 -encoding UTF-8 -d $Classes $Sources
    if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
    & java -ea -cp $Classes com.clickinterval.anticheat.core.AllTests
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }
    & java -ea -cp $Classes com.clickinterval.anticheat.core.ReachCheckMathTests
    if ($LASTEXITCODE -ne 0) { throw "Reach tests failed with exit code $LASTEXITCODE" }
}
finally {
    $ResolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $ResolvedTarget = [System.IO.Path]::GetFullPath($TempRoot)
    if ($ResolvedTarget.StartsWith($ResolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedTarget)) {
        Remove-Item -LiteralPath $ResolvedTarget -Recurse -Force
    }
}
